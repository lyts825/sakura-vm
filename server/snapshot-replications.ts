import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { Bundles } from './bundles.ts';
import type { HostPeers } from './host-peers.ts';
import type { Machines } from './machines.ts';
import { AppError, createSchema, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';

export const snapshotReplicationInput = z.object({
  peerId: z.uuid(), snapshotId: z.uuid(), targetName: createSchema.shape.name,
}).strict();
type Input = z.infer<typeof snapshotReplicationInput>;

const entrySchema = z.object({
  vmId: z.uuid(), snapshotId: z.uuid(), peerId: z.uuid(), transferId: z.uuid(),
  targetName: createSchema.shape.name, sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['queued', 'transferring', 'replicated', 'review']),
  remoteVmId: z.uuid().optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  error: z.string().max(500).optional(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
const storeSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(128) }).strict();
type Entry = z.infer<typeof entrySchema>;
type Receipt = NonNullable<Awaited<ReturnType<HostPeers['importStatus']>>>;

export class SnapshotReplications {
  private state?: z.infer<typeof storeSchema>;
  private writes: Promise<unknown> = Promise.resolve();
  private active = new Set<string>();
  constructor(private machines: Machines, private bundles: Bundles, private peers: HostPeers,
    private file = join(DATA, 'snapshot-replications.json')) {}

  async init() {
    this.state = storeSchema.parse(await readStore(this.file, () => ({ version: 1, entries: [] })));
    if (this.state.entries.some((entry) => entry.status === 'transferring'))
      await this.change((state) => {
        for (const entry of state.entries) if (entry.status === 'transferring') {
          entry.status = 'review';
          entry.error = '服务重启中断复制；重试将先查询目标回执';
          entry.updatedAt = new Date().toISOString();
        }
      });
  }

  view() {
    return { enabled: true, entries: [...this.state!.entries].reverse() };
  }

  private async change<T>(edit: (state: z.infer<typeof storeSchema>) => T) {
    const operation = this.writes.catch(() => {}).then(async () => {
      const next = structuredClone(this.state!);
      const result = edit(next);
      await writeStore(this.file, next);
      this.state = next;
      return result;
    });
    this.writes = operation;
    return operation;
  }

  private async source(id: string, snapshotId: string) {
    return this.machines.locked(id, async () => {
      this.machines.requireStopped(id);
      const vm = this.machines.get(id);
      const snapshot = vm.snapshots.find((item) => item.id === snapshotId);
      if (!snapshot) throw new AppError('快照不存在', 404);
      const identity = await this.machines.snapshotIdentity(id, snapshotId);
      const fingerprint = createHash('sha256').update(JSON.stringify({
        snapshot: { id: snapshot.id, createdAt: snapshot.createdAt,
          diskGiB: snapshot.diskGiB, pendingResize: snapshot.pendingResize },
        config: { memoryMiB: vm.memoryMiB, cpus: vm.cpus, accelerator: vm.accelerator,
          distro: vm.distro, architecture: vm.architecture,
          template: vm.template, hardware: vm.hardware,
          firmware: vm.firmware },
        key: identity.key, seed: identity.seed.toString('base64'),
      })).digest('hex');
      return { vm, snapshot, fingerprint };
    });
  }

  private prior(id: string, input: Input) {
    return this.state!.entries.findLast((entry) => entry.vmId === id &&
      entry.snapshotId === input.snapshotId && entry.peerId === input.peerId &&
      entry.targetName === input.targetName);
  }

  private checkReceipt(receipt: Receipt | null, id: string, input: Input,
    prior?: Entry) {
    if (receipt && (receipt.name !== input.targetName || receipt.sourceVmId !== id ||
        receipt.snapshotId !== input.snapshotId || !receipt.sha256 ||
        (prior?.remoteVmId && receipt.id !== prior.remoteVmId) ||
        (prior?.sha256 && receipt.sha256 !== prior.sha256) ||
        (prior?.sourceSha256 && receipt.sha256 !== prior.sourceSha256)))
      throw new AppError('目标快照副本回执与来源、名称或校验值不一致', 409);
    if (!receipt && prior?.remoteVmId)
      throw new AppError('目标快照副本已失效；请使用新的目标名称重新复制', 409);
    return receipt;
  }

  private async target(id: string, peerId: string, requireCapacity: boolean) {
    const vm = this.machines.get(id);
    const peer = this.peers.view().outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('目标主机未配对或已移除', 404);
    const scored = await this.peers.score({ cpus: vm.cpus, memoryMiB: vm.memoryMiB });
    const candidate = scored.candidates.find((item) => item.id === peer.remoteId &&
      item.source === 'peer');
    if (!candidate?.status || candidate.reasons.some((reason) =>
        reason.startsWith('连接失败') || reason.startsWith('没有 90 秒')) ||
        (requireCapacity && !candidate.eligible))
      throw new AppError(`目标主机当前不可选：${candidate?.reasons.join('；') || '没有有效观测'}`, 409);
    const local = await this.peers.status();
    if (candidate.status.platform !== local.platform || candidate.status.arch !== local.arch)
      throw new AppError('目标主机平台或架构与源主机不一致', 409);
    return peer;
  }

  async preview(id: string, input: unknown) {
    const parsed = snapshotReplicationInput.safeParse(input);
    if (!parsed.success) return { ready: false, executed: false,
      reason: '请选择快照、已配对目标主机并填写目标副本名称。' };
    try {
      const source = await this.source(id, parsed.data.snapshotId);
      const prior = this.prior(id, parsed.data);
      if (prior && prior.sourceFingerprint !== source.fingerprint)
        throw new AppError('快照来源配置已变化；请使用新的目标名称重新复制', 409);
      const receipt = prior ? this.checkReceipt(await this.peers.importStatus(
        parsed.data.peerId, prior.transferId), id, parsed.data, prior) : null;
      const peer = await this.target(id, parsed.data.peerId, !receipt);
      return { ready: true, executed: false, snapshot: {
        id: source.snapshot.id, name: source.snapshot.name,
        createdAt: source.snapshot.createdAt },
        target: { id: peer.id, hostId: peer.remoteId, name: peer.name },
        existingRemoteVmId: receipt?.id, existingSha256: receipt?.sha256,
        message: '选定历史快照将作为目标主机上的独立可启动实例导入；来源快照和实例保持不变。' };
    } catch (error) {
      return { ready: false, executed: false, reason: (error as Error).message };
    }
  }

  async run(id: string, input: unknown, signal: AbortSignal) {
    const options = snapshotReplicationInput.parse(input);
    const key = `${id}:${options.snapshotId}:${options.peerId}:${options.targetName}`;
    if (this.active.has(key)) throw new AppError('此快照复制任务仍在进行', 409);
    this.active.add(key);
    try { return await this.runOne(id, options, signal); }
    finally { this.active.delete(key); }
  }

  private async runOne(id: string, options: Input, signal: AbortSignal) {
    signal.throwIfAborted();
    const source = await this.source(id, options.snapshotId);
    const prior = this.prior(id, options);
    if (prior && prior.sourceFingerprint !== source.fingerprint)
      throw new AppError('快照来源配置已变化；请使用新的目标名称重新复制', 409);
    const existing = prior ? this.checkReceipt(await this.peers.importStatus(
      options.peerId, prior.transferId), id, options, prior) : null;
    const peer = await this.target(id, options.peerId, !existing);
    const transferId = prior?.transferId || randomUUID();
    if (!prior) await this.change((state) => {
      while (state.entries.length >= 128) {
        const finished = state.entries.findIndex((entry) => entry.status === 'replicated');
        if (finished < 0) throw new AppError('快照复制队列已达到上限', 409);
        state.entries.splice(finished, 1);
      }
      state.entries.push({ vmId: id, snapshotId: options.snapshotId,
        peerId: options.peerId, transferId, targetName: options.targetName,
        sourceFingerprint: source.fingerprint, status: 'queued',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });
    const update = (status: Entry['status'], receipt?: Receipt, error?: string,
      sourceSha256?: string) => this.change((state) => {
      const entry = state.entries.find((item) => item.transferId === transferId)!;
      entry.status = status;
      entry.updatedAt = new Date().toISOString();
      if (receipt) { entry.remoteVmId = receipt.id; entry.sha256 = receipt.sha256; }
      if (sourceSha256) entry.sourceSha256 = sourceSha256;
      if (error) entry.error = error.slice(0, 500);
      else delete entry.error;
    });
    let receipt: Receipt | undefined;
    try {
      await update('transferring', existing || undefined);
      let localSha: string | undefined;
      receipt = await this.peers.upload(options.peerId, transferId, options.targetName,
        async (target, uploadSignal) => {
          localSha = await this.bundles.export(id, target, () => {}, uploadSignal,
            0, options.snapshotId);
          await update('transferring', undefined, undefined, localSha);
        }, signal, { sourceVmId: id, snapshotId: options.snapshotId });
      this.checkReceipt(receipt, id, options, prior);
      if (localSha && receipt.sha256 !== localSha)
        throw new AppError('目标副本校验值与来源快照导出结果不一致', 409);
      signal.throwIfAborted();
      if ((await this.source(id, options.snapshotId)).fingerprint !== source.fingerprint)
        throw new AppError('快照来源在传输期间变化，目标副本需人工复核', 409);
      await update('replicated', receipt);
      return { ready: true, executed: true, transferId, sourceVmId: id,
        snapshotId: options.snapshotId, remoteVmId: receipt.id,
        targetHostId: peer.remoteId, sha256: receipt.sha256,
        message: '历史快照已校验并作为目标主机上的独立实例导入；来源未修改。' };
    } catch (error) {
      await update('review', receipt || existing || undefined, (error as Error).message)
        .catch(() => {});
      throw error;
    }
  }
}
