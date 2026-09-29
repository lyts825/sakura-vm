import { setTimeout as delay } from 'node:timers/promises';
import type { Machines } from './machines.ts';
import type { HostPeers } from './host-peers.ts';
import { AppError, type VMConfig } from './model.ts';
import { freePort, qmp } from './qmp.ts';
import type { LiveMigrationProjects } from './live-migration-projects.ts';

type PrepareInput = { requesterId: string; transferId: string; sourceVmId: string;
  config: VMConfig; key: string; seed: Buffer; projects?: LiveMigrationProjects };

export class LiveMigrationReceiver {
  private finalizing = new Set<string>();
  constructor(private machines: Machines, private peers: HostPeers,
    private requireAvailable: () => void = () => {}) {}

  async prepare(input: PrepareInput) {
    this.requireAvailable();
    const created = await this.machines.createIncomingTarget(input.config,
      { key: input.key, seed: input.seed }, {
        sourceHostId: input.requesterId, sourceVmId: input.sourceVmId,
        transferId: input.transferId,
      }, input.projects);
    let sessionId: string | undefined;
    try {
      this.requireAvailable();
      await this.machines.startIncoming(created.id);
      const live = this.machines.live.get(created.id);
      if (!live) throw new AppError('目标 QEMU 未启动', 502);
      const deadline = Date.now() + 15_000;
      let ready = false;
      while (Date.now() < deadline) {
        this.requireAvailable();
        if (this.machines.live.get(created.id) !== live)
          throw new AppError('目标 QEMU 已退出', 502);
        try {
          const state = await qmp(live.qmpPort, 'query-status', undefined, 1000) as
            { running?: boolean; status?: string };
          if (state.running !== false || !['inmigrate', 'prelaunch'].includes(state.status || ''))
            throw new AppError('目标 QEMU 未保持迁移等待状态', 502);
          ready = true;
          break;
        } catch (error) {
          if (error instanceof AppError) throw error;
          await delay(100);
        }
      }
      if (!ready) throw new AppError('目标 QMP 启动超时', 502);
      const blocks = await qmp(live.qmpPort, 'query-block') as Array<{
        device?: string; inserted?: { ro?: boolean; 'node-name'?: string;
          image?: { 'virtual-size'?: number } } }>;
      if (!Array.isArray(blocks)) throw new AppError('目标 QEMU 未返回磁盘列表', 502);
      const writable = blocks.filter((block) => block.inserted?.ro === false);
      const disk = writable[0];
      const targetDiskNode = disk?.inserted?.['node-name'];
      if (writable.length !== 1 || disk.device !== 'sakura-disk' ||
          typeof targetDiskNode !== 'string' ||
          disk.inserted?.image?.['virtual-size'] !== input.config.diskGiB * 1024 ** 3)
        throw new AppError('目标 QEMU 磁盘与迁移配置不匹配', 502);
      const [diskPort, statePort] = await Promise.all([freePort(), freePort()]);
      if (diskPort === statePort) throw new AppError('目标迁移端口冲突', 502);
      this.requireAvailable();
      sessionId = this.peers.registerMigrationSession(input.requesterId, {
        disk: diskPort, state: statePort, qmp: live.qmpPort, targetDiskNode,
        targetVmId: created.id, transferId: input.transferId,
      });
      return { targetVmId: created.id, sessionId, targetDiskNode,
        diskPort, statePort };
    } catch (error) {
      if (sessionId) this.peers.closeMigrationSession(sessionId);
      await this.machines.stop(created.id, true).catch(() => {});
      await this.machines.delete(created.id).catch(() => {});
      throw error;
    }
  }

  status(input: { requesterId: string; transferId: string; targetVmId: string }) {
    this.requireAvailable();
    const vm = this.machines.get(input.targetVmId);
    const origin = vm.liveMigrationOrigin;
    if (!origin || origin.sourceHostId !== input.requesterId ||
        origin.transferId !== input.transferId)
      throw new AppError('在线迁移目标身份不匹配', 409);
    return { targetVmId: vm.id, status: this.machines.state(vm.id),
      originStatus: origin.status };
  }

  async complete(input: { requesterId: string; transferId: string;
    targetVmId: string; sessionId: string }) {
    this.requireAvailable();
    if (this.finalizing.has(input.targetVmId))
      throw new AppError('目标实例正在完成在线迁移操作', 409);
    this.finalizing.add(input.targetVmId);
    try {
      const before = this.status(input);
      if (before.originStatus !== 'prepared') return before;
      if (!this.peers.matchesMigrationSession(input.sessionId, input.requesterId,
        input.targetVmId, input.transferId))
        throw new AppError('在线迁移会话与目标实例不匹配', 409);
      await this.machines.completeIncoming(input.targetVmId);
      this.peers.closeMigrationSession(input.sessionId);
      return this.status(input);
    } finally { this.finalizing.delete(input.targetVmId); }
  }

  async abort(input: { requesterId: string; transferId: string;
    targetVmId: string; sessionId: string; sourceRunning: true }) {
    this.requireAvailable();
    if (this.finalizing.has(input.targetVmId))
      throw new AppError('目标实例正在完成在线迁移操作', 409);
    this.finalizing.add(input.targetVmId);
    try {
      const before = this.status(input);
      if (before.originStatus !== 'prepared')
        throw new AppError('目标实例已接收迁移，不能取消', 409);
      if (!this.peers.matchesMigrationSession(input.sessionId, input.requesterId,
        input.targetVmId, input.transferId))
        throw new AppError('在线迁移会话与目标实例不匹配', 409);
      // Revoke all active migration streams before checking whether the receiver
      // can still run; a late QEMU switchover must never race target deletion.
      this.peers.closeMigrationSession(input.sessionId);
      const live = this.machines.live.get(input.targetVmId);
      if (live) {
        const state = await qmp(live.qmpPort, 'query-status') as { running?: boolean };
        if (state.running !== false)
          throw new AppError('目标 QEMU 状态不确定，保留目标实例', 409);
      }
      await this.machines.stop(input.targetVmId, true);
      await this.machines.delete(input.targetVmId);
      return { targetVmId: input.targetVmId, aborted: true as const };
    } finally { this.finalizing.delete(input.targetVmId); }
  }
}
