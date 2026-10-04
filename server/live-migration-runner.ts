import type { HostPeersV1 } from './service-contracts/v1.ts';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { createSchema, type LiveMigrationFence } from '../shared/contracts/vm.ts';
import { liveMigrationPrepareReceiptSchema, liveMigrationTargetStatusSchema } from '../shared/contracts/live-migration.ts';
import { captureOperationCheck } from './operation-context.ts';
import { migrationDigest, type LiveMigrationCompletionPort } from './live-migration-proof.ts';
import { pluginAuthority } from './plugin-authority.ts';
import { vmHostIdentity } from './vm-reference.ts';
import { vmDir } from './paths.ts';
import { qmp } from './qmp.ts';
import { migrateQemuWithMirroredDisk } from './live-migration-transport.ts';
import { readLiveMigrationProjects } from './live-migration-projects.ts';
import { readStore, writeStore } from './local-store.ts';

export const runLiveMigrationInput = z.object({
  targetHostId: z.uuid(),
  targetName: createSchema.shape.name.optional(),
  transferId: z.uuid().optional(),
}).strict();

const attemptSchema = z.object({
  sourceVmId: z.uuid(), sourceHostId: z.uuid(), targetHostId: z.uuid(), peerId: z.uuid(),
  transferId: z.uuid(), requestDigest: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.iso.datetime(),
  prepared: liveMigrationPrepareReceiptSchema.optional(),
}).strict();

type Query = typeof qmp;
type Transport = typeof migrateQemuWithMirroredDisk;
type MigrationResult = {
  ready: boolean; executed: boolean; sourceVmId: string; targetHostId: string;
  targetVmId: string; transferId: ReturnType<typeof randomUUID>; targetStatus: 'running'; sourceRetained: boolean;
};

// No lookup is exported. Plugin callers can run the admitted migration coordinator but
// cannot obtain, replace or independently invoke its original-owner proof closures.
const completionPorts = new WeakMap<object, LiveMigrationCompletionPort>();
export function registerLiveMigrationCompletionPort(owner: object, port: LiveMigrationCompletionPort) {
  if (pluginAuthority() || vmHostIdentity(owner) !== owner)
    throw new AppError('迁移证明端口仅允许系统装配', 403, 'LIVE_MIGRATION_SYSTEM_ONLY');
  if (completionPorts.has(owner)) throw new Error('在线迁移完成核验端口已装配');
  completionPorts.set(owner, port);
  return () => { if (completionPorts.get(owner) === port) completionPorts.delete(owner); };
}

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
  #active = new Set<string>();
  #machines: Machines;
  #peers: HostPeersV1;
  #query: Query;
  #transport: Transport;
  #completion: LiveMigrationCompletionPort | undefined;
  constructor(machines: Machines, peers: HostPeersV1,
    query: Query = qmp, transport: Transport = migrateQemuWithMirroredDisk,
    completion?: LiveMigrationCompletionPort) {
    if (pluginAuthority() && (completion || query !== qmp || transport !== migrateQemuWithMirroredDisk))
      throw new AppError('迁移证明与传输注入仅允许系统装配', 403, 'LIVE_MIGRATION_SYSTEM_ONLY');
    this.#machines = machines;
    this.#peers = peers;
    this.#query = query;
    this.#transport = transport;
    this.#completion = completion || completionPorts.get(vmHostIdentity(machines));
  }

  async run(id: string, raw: unknown, signal?: AbortSignal,
    log: (line: string) => void = () => {}): Promise<MigrationResult> {
    const input = runLiveMigrationInput.parse(raw);
    if (this.#active.has(id)) throw new AppError('此实例已有在线迁移任务', 409);
    this.#active.add(id);
    try { return await this.#execute(id, input, signal, log); }
    finally { this.#active.delete(id); }
  }

  async #execute(id: string, input: z.infer<typeof runLiveMigrationInput>,
    signal: AbortSignal | undefined, log: (line: string) => void): Promise<MigrationResult> {
    const admitted = captureOperationCheck();
    const check = async () => { signal?.throwIfAborted(); await admitted(); signal?.throwIfAborted(); };
    await check();
    if (!this.#completion) throw new AppError('原在线迁移完成核验端口尚未装配', 503);
    const vm = this.#machines.get(id), live = this.#machines.live.get(id);
    if (vm.liveMigrationFence) {
      const fence = vm.liveMigrationFence;
      if (input.targetHostId !== fence.targetHostId ||
          input.transferId && input.transferId !== fence.transferId)
        throw new AppError('恢复请求不属于原在线迁移目标或迁移标识', 409);
      log(`核验原迁移 ${fence.transferId}；来源继续保持封锁。\n`);
      const confirmed = await this.#completion.confirm(id, fence);
      return { ready: true, executed: true, sourceVmId: id,
        targetHostId: confirmed.targetHostId, targetVmId: confirmed.targetVmId,
        transferId: z.uuid().parse(confirmed.transferId) as ReturnType<typeof randomUUID>,
        targetStatus: 'running', sourceRetained: true };
    }
    if (vm.haPromotion || vm.haRetirement)
      throw new AppError('来源实例已有切换栅栏或故障接管记录', 409);
    if (!live || live.status !== 'running' || live.accelerator !== 'tcg')
      throw new AppError('来源实例必须由 TCG 运行且已就绪', 409);
    if (vm.architecture === 'aarch64' || vm.firmware === 'uefi' ||
        vm.hardware?.devices?.graphics === 'virgl' || vm.diskEncryption ||
        vm.sandbox || vm.snapshots.length || vm.pendingResize || vm.branchOrigin)
      throw new AppError('此实例的硬件、磁盘或快照配置尚不能安全在线迁移', 409);
    const peer = this.#peers.view().outbound.find((entry) =>
      entry.remoteId === input.targetHostId);
    if (!peer) throw new AppError('目标主机未配对或已移除', 404);
    const attemptFile = join(vmDir(id), 'live-migration-attempt.json');
    const stored = await readStore<unknown>(attemptFile, () => null);
    let attempt = stored === null ? undefined : attemptSchema.parse(stored);
    const sourceHostId = this.#peers.view().hostId;
    if (attempt && (attempt.sourceVmId !== id || attempt.sourceHostId !== sourceHostId ||
        attempt.targetHostId !== input.targetHostId || attempt.peerId !== peer.id ||
        input.transferId && input.transferId !== attempt.transferId))
      throw new AppError('存在未核对的原迁移准备记录；请使用相同目标、名称和迁移标识重入', 409, 'LIVE_MIGRATION_ATTEMPT_CHANGED');
    const score = await this.#peers.score({ cpus: vm.cpus, memoryMiB: vm.memoryMiB });
    const target = score.candidates.find((candidate) => candidate.source === 'peer' &&
      candidate.id === input.targetHostId);
    const local = score.candidates.find((candidate) => candidate.source === 'local');
    if (!target || (!attempt && !target.eligible) || !target?.status || !local?.status ||
        target.status.platform !== local.status.platform ||
        target.status.arch !== local.status.arch)
      throw new AppError(`目标主机当前不可选：${target?.reasons.join('；') || '平台、架构或资源不兼容'}`, 409);
    const sourceState = await this.#query(live.qmpPort, 'query-status') as
      { running?: boolean; status?: string };
    const migration = await this.#query(live.qmpPort, 'query-migrate') as { status?: string };
    if (sourceState.running !== true || sourceState.status !== 'running' ||
        (migration.status && !['none', 'completed', 'failed', 'cancelled'].includes(migration.status)))
      throw new AppError(`来源 QEMU 当前不能开始在线迁移（运行状态 ${sourceState.status || '未知'}，迁移状态 ${migration.status || '未知'}）`, 409);
    const diskNode = sourceDiskNode(await this.#query(live.qmpPort, 'query-block'));
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
    await check();
    const requestDigest = migrationDigest({ config: targetConfig, key,
      seedBase64: seed.toString('base64'), projects: projects || null, organization: vm.organization || null });
    if (attempt && attempt.requestDigest !== requestDigest)
      throw new AppError('存在未核对的原迁移准备记录；请使用相同目标、名称和迁移标识重入', 409, 'LIVE_MIGRATION_ATTEMPT_CHANGED');
    if (!attempt) {
      attempt = attemptSchema.parse({ sourceVmId: id, sourceHostId, targetHostId: input.targetHostId,
        peerId: peer.id, transferId: input.transferId || randomUUID(), requestDigest, createdAt: new Date().toISOString() });
      await writeStore(attemptFile, attempt);
    }
    const transferId = attempt.transferId as ReturnType<typeof randomUUID>;
    log(`准备目标主机 ${peer.name} 的在线迁移接收实例。\n`);
    const prepared = await this.#peers.prepareLiveTarget(peer.id, {
      sourceVmId: id, transferId, config: targetConfig,
      key, seedBase64: seed.toString('base64'), projects,
      organization: vm.organization,
      completionProtocol: 1,
    });
    attempt = { ...attempt, prepared: liveMigrationPrepareReceiptSchema.parse(prepared) };
    await writeStore(attemptFile, attempt);
    log(`目标实例 ${prepared.targetVmId} 已暂停，迁移标识 ${transferId}。\n`);
    const forwards: Array<Awaited<ReturnType<HostPeersV1['openMigrationForward']>>> = [];
    let completed = false;
    let fence: LiveMigrationFence | undefined;
    try {
      await check();
      if (prepared.completionProtocol !== 1)
        throw new AppError('目标主机未确认持久迁移完成证明协议，来源尚未暂停', 409, 'LIVE_MIGRATION_PROTOCOL_UNSUPPORTED');
      const disk = await this.#peers.openMigrationForward(peer.id, prepared.sessionId, 'disk');
      forwards.push(disk);
      const state = await this.#peers.openMigrationForward(peer.id, prepared.sessionId, 'state');
      forwards.push(state);
      const targetQmp = async (command: string, args?: Record<string, unknown>,
        timeoutMs?: number) => {
        try {
          return await this.#peers.targetMigrationQmp(peer.id, prepared.sessionId,
            command, args, timeoutMs);
        } catch (error) {
          log(`目标 QMP ${command} 失败：${String(error)}\n`);
          throw error;
        }
      };
      log('开始镜像磁盘并预复制客户机内存。\n');
      await this.#transport({
        source: (command, args, timeoutMs) => command === 'cont' ? this.#machines.locked(id, async () => {
          if (this.#machines.get(id).liveMigrationFence)
            throw new AppError('来源实例已为在线迁移设置栅栏，不能恢复客户机运行',
              409, 'LIVE_MIGRATION_SOURCE_FENCED');
          const current = this.#machines.live.get(id);
          if (current !== live || current.qmpPort !== live.qmpPort)
            throw new AppError('来源原迁移进程已变化，不能恢复客户机运行', 409);
          return this.#query(live.qmpPort, command, args, timeoutMs);
        }) : this.#query(live.qmpPort, command, args, timeoutMs),
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
          await check();
          fence = await this.#machines.fenceForLiveMigration(id, {
            targetHostId: input.targetHostId, targetVmId: prepared.targetVmId,
            transferId, peerId: peer.id, sourceHostId: this.#peers.view().hostId,
            sessionId: prepared.sessionId, projectsDigest: migrationDigest(projects || null),
          }, this.#query);
          log('来源实例已持久封锁，开始完成切换。\n');
        },
        signal,
      });
      for (const forward of forwards.splice(0)) await forward.close();
      await check();
      let receipt = await this.#peers.completeLiveTarget(peer.id, {
        targetVmId: prepared.targetVmId, transferId, sessionId: prepared.sessionId,
      });
      const deadline = Date.now() + 120_000;
      while (receipt.originStatus !== 'ready' || receipt.status !== 'running') {
        await check();
        if (Date.now() >= deadline)
          throw new AppError('目标客户机就绪超时；来源仍被封锁，请核对目标状态', 504);
        await delay(1000);
        receipt = await this.#peers.inspectLiveTarget(peer.id, {
          targetVmId: prepared.targetVmId, transferId,
        });
      }
      const targetProof = liveMigrationTargetStatusSchema.parse(receipt);
      if (!fence || targetProof.targetVmId !== fence.targetVmId || targetProof.transferId !== fence.transferId ||
        targetProof.sourceVmId !== id || targetProof.sourceHostId !== fence.sourceHostId ||
        targetProof.sessionId !== fence.sessionId || targetProof.projectsDigest !== fence.projectsDigest || !targetProof.targetVerifiedAt)
        throw new AppError('目标没有返回原迁移会话与项目身份的运行证明，来源保持封锁', 409, 'LIVE_MIGRATION_TARGET_UNCONFIRMED');
      await check();
      const stopped = await this.#completion.stop(id, fence);
      await check();
      await this.#completion.confirm(id, stopped);
      completed = true;
      log('目标原会话已确认运行，来源 QEMU 退出与迁移完成证明已持久化；封锁记录仍保留。\n');
      return { ready: true, executed: true, sourceVmId: id,
        targetHostId: input.targetHostId, targetVmId: prepared.targetVmId,
        transferId, targetStatus: receipt.status, sourceRetained: true };
    } catch (error) {
      log(`在线迁移中断：${String(error)}\n`);
      const fenced = !!this.#machines.get(id).liveMigrationFence;
      if (!fenced) {
        const status = await this.#query(live.qmpPort, 'query-status').catch(() => null) as
          { running?: boolean } | null;
        if (status?.running === true) {
          try {
            await this.#peers.abortLiveTarget(peer.id, {
              targetVmId: prepared.targetVmId, transferId,
              sessionId: prepared.sessionId, sourceRunning: true,
            });
            await rm(attemptFile, { force: true });
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
