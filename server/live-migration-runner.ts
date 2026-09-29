import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { HostPeers } from './host-peers.ts';
import { AppError, createSchema, vmDir } from './model.ts';
import { qmp } from './qmp.ts';
import { migrateQemuWithMirroredDisk } from './live-migration-transport.ts';
import { readLiveMigrationProjects } from './live-migration-projects.ts';

export const runLiveMigrationInput = z.object({
  targetHostId: z.uuid(),
  targetName: createSchema.shape.name.optional(),
}).strict();

type Query = typeof qmp;
type Transport = typeof migrateQemuWithMirroredDisk;

function sourceDiskNode(value: unknown) {
  if (!Array.isArray(value)) throw new AppError('来源 QEMU 磁盘列表无效', 502);
  const writable = value.filter((block) => block?.inserted?.ro === false);
  const node = writable[0]?.inserted?.['node-name'];
  if (writable.length !== 1 || writable[0]?.device !== 'sakura-disk' ||
      typeof node !== 'string' || !node)
    throw new AppError('在线迁移需要唯一的 Sakura 可写磁盘', 409);
  return node;
}

/** Coordinates one source-side transfer; the durable fence remains on the VM if cutover is uncertain. */
export class LiveMigrationRunner {
  private active = new Set<string>();
  constructor(private machines: Machines, private peers: HostPeers,
    private query: Query = qmp, private transport: Transport = migrateQemuWithMirroredDisk) {}

  async run(id: string, raw: unknown, signal?: AbortSignal,
    log: (line: string) => void = () => {}) {
    const input = runLiveMigrationInput.parse(raw);
    if (this.active.has(id)) throw new AppError('此实例已有在线迁移任务', 409);
    this.active.add(id);
    try { return await this.execute(id, input, signal, log); }
    finally { this.active.delete(id); }
  }

  private async execute(id: string, input: z.infer<typeof runLiveMigrationInput>,
    signal: AbortSignal | undefined, log: (line: string) => void) {
    signal?.throwIfAborted();
    const vm = this.machines.get(id), live = this.machines.live.get(id);
    if (vm.liveMigrationFence || vm.haPromotion || vm.haRetirement)
      throw new AppError('来源实例已有切换栅栏或故障接管记录', 409);
    if (!live || live.status !== 'running' || live.accelerator !== 'tcg')
      throw new AppError('来源实例必须由 TCG 运行且已就绪', 409);
    if (vm.architecture === 'aarch64' || vm.firmware === 'uefi' ||
        vm.hardware?.devices?.graphics === 'virgl' || vm.diskEncryption ||
        vm.sandbox || vm.snapshots.length || vm.pendingResize || vm.branchOrigin)
      throw new AppError('此实例的硬件、磁盘或快照配置尚不能安全在线迁移', 409);
    const peer = this.peers.view().outbound.find((entry) =>
      entry.remoteId === input.targetHostId);
    if (!peer) throw new AppError('目标主机未配对或已移除', 404);
    const score = await this.peers.score({ cpus: vm.cpus, memoryMiB: vm.memoryMiB });
    const target = score.candidates.find((candidate) => candidate.source === 'peer' &&
      candidate.id === input.targetHostId);
    const local = score.candidates.find((candidate) => candidate.source === 'local');
    if (!target?.eligible || !target.status || !local?.status ||
        target.status.platform !== local.status.platform ||
        target.status.arch !== local.status.arch)
      throw new AppError(`目标主机当前不可选：${target?.reasons.join('；') || '平台、架构或资源不兼容'}`, 409);
    const sourceState = await this.query(live.qmpPort, 'query-status') as
      { running?: boolean; status?: string };
    const migration = await this.query(live.qmpPort, 'query-migrate') as { status?: string };
    if (sourceState.running !== true || sourceState.status !== 'running' ||
        (migration.status && !['none', 'completed', 'failed', 'cancelled'].includes(migration.status)))
      throw new AppError(`来源 QEMU 当前不能开始在线迁移（运行状态 ${sourceState.status || '未知'}，迁移状态 ${migration.status || '未知'}）`, 409);
    const diskNode = sourceDiskNode(await this.query(live.qmpPort, 'query-block'));
    const targetConfig = createSchema.parse({
      name: input.targetName || vm.name, memoryMiB: vm.memoryMiB, cpus: vm.cpus,
      diskGiB: vm.diskGiB, accelerator: 'tcg', firmware: vm.firmware,
      distro: vm.distro, architecture: vm.architecture, template: vm.template,
      hardware: vm.hardware, forwards: vm.forwards,
    });
    const [key, seed, projects] = await Promise.all([
      readFile(join(vmDir(id), 'id_rsa'), 'utf8'),
      readFile(join(vmDir(id), 'seed.iso')),
      readLiveMigrationProjects(id),
    ]);
    signal?.throwIfAborted();
    const transferId = randomUUID();
    log(`准备目标主机 ${peer.name} 的在线迁移接收实例。\n`);
    const prepared = await this.peers.prepareLiveTarget(peer.id, {
      sourceVmId: id, transferId, config: targetConfig,
      key, seedBase64: seed.toString('base64'), projects,
      organization: vm.organization,
    });
    log(`目标实例 ${prepared.targetVmId} 已暂停，迁移标识 ${transferId}。\n`);
    const forwards: Array<Awaited<ReturnType<HostPeers['openMigrationForward']>>> = [];
    let completed = false;
    try {
      signal?.throwIfAborted();
      const disk = await this.peers.openMigrationForward(peer.id, prepared.sessionId, 'disk');
      forwards.push(disk);
      const state = await this.peers.openMigrationForward(peer.id, prepared.sessionId, 'state');
      forwards.push(state);
      const targetQmp = async (command: string, args?: Record<string, unknown>,
        timeoutMs?: number) => {
        try {
          return await this.peers.targetMigrationQmp(peer.id, prepared.sessionId,
            command, args, timeoutMs);
        } catch (error) {
          log(`目标 QMP ${command} 失败：${String(error)}\n`);
          throw error;
        }
      };
      log('开始镜像磁盘并预复制客户机内存。\n');
      await this.transport({
        source: (command, args, timeoutMs) => this.query(live.qmpPort, command,
          args, timeoutMs),
        target: targetQmp,
        sourceDiskNode: diskNode,
        targetDiskNode: prepared.targetDiskNode,
        nbdListen: { type: 'inet', data: { host: '127.0.0.1',
          port: String(prepared.diskPort) } },
        nbdConnect: { type: 'inet', host: '127.0.0.1',
          port: String(disk.port) },
        incomingUri: `tcp:127.0.0.1:${prepared.statePort}`,
        outgoingUri: `tcp:127.0.0.1:${state.port}`,
        fenceSource: async () => {
          await this.machines.fenceForLiveMigration(id, {
            targetHostId: input.targetHostId, targetVmId: prepared.targetVmId,
            transferId,
          }, this.query);
          log('来源实例已持久封锁，开始完成切换。\n');
        },
        signal,
      });
      for (const forward of forwards.splice(0)) await forward.close();
      let receipt = await this.peers.completeLiveTarget(peer.id, {
        targetVmId: prepared.targetVmId, transferId, sessionId: prepared.sessionId,
      });
      const deadline = Date.now() + 120_000;
      while (receipt.originStatus !== 'ready' || receipt.status !== 'running') {
        if (Date.now() >= deadline)
          throw new AppError('目标客户机就绪超时；来源仍被封锁，请核对目标状态', 504);
        await delay(1000);
        receipt = await this.peers.inspectLiveTarget(peer.id, {
          targetVmId: prepared.targetVmId, transferId,
        });
      }
      await this.machines.stop(id, true);
      completed = true;
      log('目标客户机已就绪，来源 QEMU 已停止并保留封锁记录。\n');
      return { ready: true, executed: true, sourceVmId: id,
        targetHostId: input.targetHostId, targetVmId: prepared.targetVmId,
        transferId, targetStatus: receipt.status, sourceRetained: true };
    } catch (error) {
      log(`在线迁移中断：${String(error)}\n`);
      const fenced = !!this.machines.get(id).liveMigrationFence;
      if (!fenced) {
        const status = await this.query(live.qmpPort, 'query-status').catch(() => null) as
          { running?: boolean } | null;
        if (status?.running === true) {
          try {
            await this.peers.abortLiveTarget(peer.id, {
              targetVmId: prepared.targetVmId, transferId,
              sessionId: prepared.sessionId, sourceRunning: true,
            });
            log('来源继续运行；暂停目标已撤销。\n');
          } catch (abortError) {
            log(`目标取消未确认，保留目标 ${prepared.targetVmId} 供核对：${String(abortError)}\n`);
          }
        } else log(`来源状态未确认，保留目标 ${prepared.targetVmId} 供核对。\n`);
      } else if (!completed) {
        log(`来源已封锁，保留目标 ${prepared.targetVmId} 供核对；不能自动回退。\n`);
      }
      throw error;
    } finally {
      await Promise.allSettled(forwards.map((forward) => forward.close()));
    }
  }
}
