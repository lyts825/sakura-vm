import type { HostPeersV1 } from './service-contracts/v1.ts';
import { setTimeout as delay } from 'node:timers/promises';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { type VMConfig, type VMRecord } from '../shared/contracts/vm.ts';
import { freePort, qmp } from './qmp.ts';
import type { LiveMigrationProjects } from './live-migration-projects.ts';

type PrepareInput = { requesterId: string; transferId: string; sourceVmId: string;
  config: VMConfig; key: string; seed: Buffer; projects?: LiveMigrationProjects;
  completionProtocol?: 1;
  organization?: VMRecord['organization'] };

export class LiveMigrationReceiver {
  private finalizing = new Set<string>();
  constructor(private machines: Machines, private peers: HostPeersV1,
    private requireAvailable: () => void = () => {}, private query: typeof qmp = qmp) {}

  async prepare(input: PrepareInput) {
    this.requireAvailable();
    const created = await this.machines.createIncomingTarget(input.config,
      { key: input.key, seed: input.seed }, {
        sourceHostId: input.requesterId, sourceVmId: input.sourceVmId,
        transferId: input.transferId,
        ...(input.completionProtocol ? { completionProtocol: input.completionProtocol } : {}),
      }, input.projects, input.organization);
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
          const state = await this.query(live.qmpPort, 'query-status', undefined, 1000) as
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
      const blocks = await this.query(live.qmpPort, 'query-block') as Array<{
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
        diskPort, statePort, ...(input.completionProtocol ? { completionProtocol: input.completionProtocol } : {}) };
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
      originStatus: origin.status,
      ...(origin.completionProtocol === 1 && origin.sessionId && origin.projectsDigest ? {
        sourceHostId: origin.sourceHostId, sourceVmId: origin.sourceVmId, transferId: origin.transferId,
        sessionId: origin.sessionId, projectsDigest: origin.projectsDigest,
      } : {}) };
  }

  /** A running label alone is insufficient: verify this exact target QEMU and recheck origin after I/O. */
  async verifiedStatus(input: { requesterId: string; transferId: string; targetVmId: string }) {
    const before = this.status(input);
    if (before.status !== 'running' || !before.sessionId) return before;
    const live = this.machines.live.get(input.targetVmId);
    if (!live) throw new AppError('目标原进程不可用', 409);
    const state = await this.query(live.qmpPort, 'query-status') as { running?: boolean; status?: string };
    this.requireAvailable();
    const after = this.status(input);
    if (this.machines.live.get(input.targetVmId) !== live || after.sessionId !== before.sessionId ||
      after.sourceVmId !== before.sourceVmId || after.projectsDigest !== before.projectsDigest ||
      state.running !== true || state.status !== 'running' || after.status !== 'running')
      throw new AppError('目标原迁移进程尚未确认运行', 409);
    return { ...after, targetVerifiedAt: new Date().toISOString() };
  }

  async complete(input: { requesterId: string; transferId: string;
    targetVmId: string; sessionId: string }) {
    this.requireAvailable();
    if (this.finalizing.has(input.targetVmId))
      throw new AppError('目标实例正在完成在线迁移操作', 409);
    this.finalizing.add(input.targetVmId);
    try {
      const before = this.status(input);
      if (before.originStatus !== 'prepared') {
        if (before.sessionId && before.sessionId !== input.sessionId)
          throw new AppError('原在线迁移会话已变化', 409);
        return this.verifiedStatus(input);
      }
      if (!this.peers.matchesMigrationSession(input.sessionId, input.requesterId,
        input.targetVmId, input.transferId))
        throw new AppError('在线迁移会话与目标实例不匹配', 409);
      await this.machines.completeIncoming(input.targetVmId, undefined, input.sessionId);
      this.peers.closeMigrationSession(input.sessionId);
      return this.verifiedStatus(input);
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
        const state = await this.query(live.qmpPort, 'query-status') as { running?: boolean };
        if (state.running !== false)
          throw new AppError('目标 QEMU 状态不确定，保留目标实例', 409);
      }
      await this.machines.stop(input.targetVmId, true);
      await this.machines.delete(input.targetVmId);
      return { targetVmId: input.targetVmId, aborted: true as const };
    } finally { this.finalizing.delete(input.targetVmId); }
  }
}
