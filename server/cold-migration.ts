import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { Bundles } from './bundles.ts';
import type { HostPeers } from './host-peers.ts';
import type { Machines, MigrationFingerprint } from './machines.ts';
import { AppError, createSchema, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';

export const coldMigrationInput = z.object({
  peerId: z.uuid(),
  targetName: createSchema.shape.name,
  confirmSourceRemoval: z.boolean().default(false),
}).strict();
type Input = z.infer<typeof coldMigrationInput>;
export const maintenanceDrainInput = z.object({
  peerId: z.uuid(), confirmSourceRemoval: z.boolean().default(false),
  targetNames: z.record(z.uuid(), createSchema.shape.name).default({}),
}).strict();

const fingerprintSchema = z.object({
  recordHash: z.string().regex(/^[a-f0-9]{64}$/),
  diskSize: z.number().int().nonnegative(), diskMtimeMs: z.number().nonnegative(),
}).strict();
const queueEntry = z.object({
  vmId: z.uuid(), transferId: z.uuid(), peerId: z.uuid(),
  targetName: createSchema.shape.name, fingerprint: fingerprintSchema,
  status: z.enum(['queued', 'transferring', 'copied', 'moved', 'review']),
  remoteVmId: z.uuid().optional(), error: z.string().max(500).optional(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
}).strict();
const queueSchema = z.object({ version: z.literal(1), entries: z.array(queueEntry).max(128) }).strict();
type Queue = z.infer<typeof queueSchema>;

const sameFingerprint = (a: MigrationFingerprint, b: MigrationFingerprint) =>
  a.recordHash === b.recordHash && a.diskSize === b.diskSize && a.diskMtimeMs === b.diskMtimeMs;

export class ColdMigrations {
  private queue?: Queue;
  private writes: Promise<unknown> = Promise.resolve();
  private activeRuns = new Set<string>();
  private draining = false;
  constructor(private machines: Machines, private bundles: Bundles, private peers: HostPeers,
    private file = join(DATA, 'cold-migrations.json')) {}

  async init() {
    this.queue = queueSchema.parse(await readStore(this.file, () => ({ version: 1, entries: [] })));
    if (this.queue.entries.some((entry) => entry.status === 'transferring'))
      await this.change((queue) => {
        for (const entry of queue.entries) if (entry.status === 'transferring') {
          entry.status = 'review';
          entry.error = '服务重启中断传输；可用相同目标重试，先查询目标回执';
          entry.updatedAt = new Date().toISOString();
        }
      });
  }

  view() {
    return { enabled: true, entries: this.queue!.entries.slice(-128).reverse().map(({ fingerprint, ...entry }) => entry) };
  }

  private async change<T>(edit: (queue: Queue) => T): Promise<T> {
    const operation = this.writes.catch(() => {}).then(async () => {
      const next = structuredClone(this.queue!);
      const result = edit(next);
      await writeStore(this.file, next);
      this.queue = next;
      return result;
    });
    this.writes = operation;
    return operation;
  }

  private async target(id: string, input: Input, requireCapacity = true) {
    const vm = this.machines.get(id);
    this.machines.requireStopped(id);
    const peer = this.peers.view().outbound.find((item) => item.id === input.peerId);
    if (!peer) throw new AppError('目标主机未配对或已移除', 404);
    const scored = await this.peers.score({ cpus: vm.cpus, memoryMiB: vm.memoryMiB });
    const candidate = scored.candidates.find((item) => item.id === peer.remoteId && item.source === 'peer');
    if (!candidate?.status || candidate.reasons.some((reason) =>
        reason.startsWith('连接失败') || reason.startsWith('没有 90 秒')) ||
        (requireCapacity && !candidate.eligible))
      throw new AppError(`目标主机当前不可选：${candidate?.reasons.join('；') || '没有有效观测'}`, 409);
    const local = await this.peers.status();
    if (candidate.status.platform !== local.platform || candidate.status.arch !== local.arch)
      throw new AppError('目标主机平台或架构与源主机不一致', 409);
    return { peer, candidate };
  }

  private async existingReceipt(prior: Queue['entries'][number] | undefined,
    peerId: string, targetName: string) {
    if (!prior) return null;
    const receipt = await this.peers.importStatus(peerId, prior.transferId);
    if (receipt && (receipt.name !== targetName ||
        (prior.remoteVmId && receipt.id !== prior.remoteVmId)))
      throw new AppError('目标主机回执与迁移队列不一致，保留源实例', 409);
    return receipt;
  }

  async preview(id: string, input: unknown) {
    const parsed = coldMigrationInput.safeParse(input);
    if (!parsed.success)
      return { ready: false, executed: false,
        reason: '请选择已配对目标主机，填写目标实例名称与源实例移除确认。',
        queue: this.queue!.entries.filter((item) => item.vmId === id).slice(-8) };
    try {
      const prior = this.queue!.entries.findLast((entry) => entry.vmId === id &&
        entry.peerId === parsed.data.peerId && entry.targetName === parsed.data.targetName &&
        entry.status !== 'moved');
      const receipt = await this.existingReceipt(prior, parsed.data.peerId,
        parsed.data.targetName);
      const { peer, candidate } = await this.target(id, parsed.data, !receipt);
      const fingerprint = await this.machines.migrationFingerprint(id);
      if (prior && !sameFingerprint(prior.fingerprint, fingerprint))
        throw new AppError('源实例与之前的迁移队列记录不同；请改用新的目标名称重新迁移', 409);
      return { ready: true, executed: false, target: { id: peer.id, name: peer.name,
        hostId: peer.remoteId, score: candidate.score }, fingerprint,
        sourceRemovalRequested: parsed.data.confirmSourceRemoval,
        queue: this.queue!.entries.filter((item) => item.vmId === id).slice(-8),
        message: '先校验并导入完整实例包；只有目标回执有效、源实例未变化且明确确认移除时才删除源实例。' };
    } catch (error) {
      return { ready: false, executed: false, reason: (error as Error).message,
        queue: this.queue!.entries.filter((item) => item.vmId === id).slice(-8) };
    }
  }

  async run(id: string, input: unknown, signal: AbortSignal) {
    if (this.activeRuns.has(id)) throw new AppError('此实例已有迁移任务正在进行', 409);
    this.activeRuns.add(id);
    try { return await this.runOne(id, input, signal); }
    finally { this.activeRuns.delete(id); }
  }

  private async runOne(id: string, input: unknown, signal: AbortSignal) {
    const options = coldMigrationInput.parse(input);
    signal.throwIfAborted();
    const fingerprint = await this.machines.migrationFingerprint(id);
    const prior = this.queue!.entries.findLast((entry) => entry.vmId === id &&
      entry.peerId === options.peerId && entry.targetName === options.targetName &&
      entry.status !== 'moved');
    if (prior && !sameFingerprint(prior.fingerprint, fingerprint))
      throw new AppError('源实例与之前的迁移队列记录不同；请改用新的目标名称重新迁移', 409);
    const existing = await this.existingReceipt(prior, options.peerId, options.targetName);
    const { peer } = await this.target(id, options, !existing);
    const transferId = prior?.transferId || randomUUID();
    if (!prior) await this.change((queue) => {
      while (queue.entries.length >= 128) {
        const completed = queue.entries.findIndex((item) => item.status === 'moved');
        if (completed < 0) throw new AppError('迁移队列已达到上限', 409);
        queue.entries.splice(completed, 1);
      }
      queue.entries.push({ vmId: id, transferId, peerId: options.peerId,
        targetName: options.targetName, fingerprint, status: 'queued',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });
    const update = (status: Queue['entries'][number]['status'], remoteVmId?: string,
      error?: string) => this.change((queue) => {
      const entry = queue.entries.find((item) => item.transferId === transferId)!;
      entry.status = status;
      entry.updatedAt = new Date().toISOString();
      if (remoteVmId) entry.remoteVmId = remoteVmId;
      if (error) entry.error = error.slice(0, 500);
      else delete entry.error;
    });
    try {
      await update('transferring', prior?.remoteVmId);
      const receipt = await this.peers.upload(options.peerId, transferId, options.targetName,
        (target, uploadSignal) => this.bundles.export(id, target, () => {}, uploadSignal), signal);
      signal.throwIfAborted();
      if (receipt.name !== options.targetName ||
          (prior?.remoteVmId && receipt.id !== prior.remoteVmId))
        throw new AppError('目标主机回执与迁移队列不一致，保留源实例', 409);
      if (!sameFingerprint(fingerprint, await this.machines.migrationFingerprint(id))) {
        await update('review', receipt.id, '源实例在传输期间变化，保留源实例');
        throw new AppError('源实例在传输期间变化，目标副本已保留；请人工核对', 409);
      }
      await update('copied', receipt.id);
      if (!options.confirmSourceRemoval)
        return { ready: true, executed: true, phase: 'copied', transferId,
          sourceVmId: id, remoteVmId: receipt.id, targetHostId: peer.remoteId,
          sourceRemoved: false,
          message: '目标已导入并校验；源实例仍在。确认目标可用后重试并勾选移除源实例。' };
      const confirmed = await this.peers.importStatus(options.peerId, transferId);
      if (confirmed?.id !== receipt.id || confirmed.name !== options.targetName)
        throw new AppError('目标主机回执与导入结果不一致，保留源实例', 409);
      signal.throwIfAborted();
      await this.machines.delete(id, fingerprint);
      let queuePersisted = true;
      try { await update('moved', receipt.id); }
      catch { queuePersisted = false; }
      return { ready: true, executed: true, phase: 'moved', transferId,
        sourceVmId: id, remoteVmId: receipt.id, targetHostId: peer.remoteId,
        sourceRemoved: true, queuePersisted };
    } catch (error) {
      if (this.machines.records.has(id))
        await update('review', prior?.remoteVmId, (error as Error).message).catch(() => {});
      throw error;
    }
  }

  async previewDrain(input: unknown) {
    const parsed = maintenanceDrainInput.safeParse(input);
    if (!parsed.success) return { ready: false, executed: false,
      reason: '请选择已配对目标主机，并填写源实例移除确认。', machines: [] };
    const ids = [...this.machines.records.keys()].sort();
    if (Object.keys(parsed.data.targetNames).some((id) => !ids.includes(id)))
      return { ready: false, executed: false,
        reason: '目标名称映射包含本机不存在的实例 ID', machines: [] };
    const names = ids.map((id) => parsed.data.targetNames[id] || this.machines.get(id).name);
    if (new Set(names).size !== names.length)
      return { ready: false, executed: false,
        reason: '同一批次不能为多个实例使用相同目标名称', machines: [] };
    const machines = [];
    for (const id of ids) {
      const name = this.machines.get(id).name;
      const targetName = parsed.data.targetNames[id] || name;
      const options = { peerId: parsed.data.peerId,
        confirmSourceRemoval: parsed.data.confirmSourceRemoval, targetName };
      const entry = this.queue!.entries.findLast((item) => item.vmId === id &&
        item.peerId === options.peerId && item.targetName === targetName && item.status !== 'moved');
      if (parsed.data.confirmSourceRemoval &&
          (entry?.status !== 'copied' || !entry.remoteVmId)) {
        machines.push({ id, name, targetName, ready: false,
          reason: '尚无已确认的目标副本，请先复制整个批次' });
        continue;
      }
      if (parsed.data.confirmSourceRemoval) {
        try {
          if (!await this.existingReceipt(entry, options.peerId, targetName)) {
            machines.push({ id, name, targetName, ready: false,
              reason: '目标副本回执已失效，保留源实例' });
            continue;
          }
        } catch (error) {
          machines.push({ id, name, targetName, ready: false, reason: (error as Error).message });
          continue;
        }
      }
      const result = await this.preview(id, options);
      machines.push({ id, name, targetName, ready: result.ready,
        ...(result.ready ? { remoteVmId: entry?.remoteVmId } : { reason: result.reason }) });
    }
    const ready = machines.every((item) => item.ready);
    return { ready, executed: false, machines,
      ...(ready ? { message: parsed.data.confirmSourceRemoval
        ? '所有当前实例已有目标副本；执行后逐台复核并移除源实例。'
        : '执行后逐台复制当前停止实例，保留所有源实例供目标验证。' }
        : { reason: '部分实例未停止、目标不可用或缺少已确认副本' }) };
  }

  async runDrain(input: unknown, signal: AbortSignal) {
    const options = maintenanceDrainInput.parse(input);
    if (this.draining) throw new AppError('已有主机排空任务正在进行', 409);
    this.draining = true;
    try {
      signal.throwIfAborted();
      const preview = await this.previewDrain(options);
      if (!preview.ready) throw new AppError(preview.machines
        .filter((item) => !item.ready).map((item) => `${item.name}：${'reason' in item
          ? item.reason : '检查失败'}`).join('；').slice(0, 500) ||
        ('reason' in preview ? preview.reason : '主机排空检查失败'), 409);
      const completed = [];
      for (const vm of preview.machines) {
        signal.throwIfAborted();
        const result = await this.run(vm.id, { peerId: options.peerId,
          confirmSourceRemoval: options.confirmSourceRemoval,
          targetName: vm.targetName }, signal);
        completed.push({ sourceVmId: vm.id, name: vm.name, targetName: vm.targetName,
          remoteVmId: result.remoteVmId,
          sourceRemoved: result.sourceRemoved });
      }
      return { ready: true, executed: true,
        phase: options.confirmSourceRemoval ? 'moved' : 'copied', completed,
        remainingSourceVms: this.machines.records.size,
        message: options.confirmSourceRemoval
          ? '批次已逐台复核并移除源实例；若有新建实例，请再次检查。'
          : '当前实例已复制到目标，源实例仍保留；验证目标后再次执行并确认移除。' };
    } finally { this.draining = false; }
  }
}
