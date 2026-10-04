import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import {
  recoveryBinding,
  recoveryRecord,
  recoveryRequest,
  type RecoveryBinding,
  type RecoveryRecord,
  type RecoveryView,
} from '../shared/contracts/recovery.ts';
import { readStore, writeStore } from './local-store.ts';
import { withNewResourceContext, withResourceContext } from './host-runtime/context.ts';
import { captureOperationCheck, withoutOperationContext } from './operation-context.ts';
import { withoutPluginAuthority } from './plugin-authority.ts';

export type RecoveryCandidate = {
  binding: RecoveryBinding;
  /** Revision of the original domain ticket, included in the management compare-and-swap. */
  ticketRevision?: string;
  error?: string;
  resourceIds: string[];
  actions: readonly { id: string; title: string }[];
};
export type RecoverySource = {
  id: string;
  discover(): Promise<RecoveryCandidate[]> | RecoveryCandidate[];
  /** Must confirm the original domain ticket. This directory has no budget release capability. */
  recover?(candidate: RecoveryCandidate, action: string): Promise<void>;
  confirmed?(record: RecoveryRecord): boolean | Promise<boolean>;
};
const checksum = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const control = <T>(work: () => T): T =>
  withoutOperationContext(() =>
    withoutPluginAuthority(() => withNewResourceContext({ owner: 'core:recovery' }, work)),
  );
const envelope = z
  .object({
    version: z.literal(1),
    records: z.array(recoveryRecord).max(4096),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/** A durable index of domain receipts, not a replacement for their cleanup authority. */
export class RecoveryCatalog {
  private sources = new Map<string, RecoverySource>();
  private records = new Map<string, RecoveryRecord>();
  private candidates = new Map<string, RecoveryCandidate>();
  private queue: Promise<unknown> = Promise.resolve();
  private initialized = false;
  private lastSaved?: string;
  private closed = false;
  private closing?: Promise<void>;
  constructor(
    private file: string,
    private activeResources: () => readonly { id: string }[],
  ) {}
  register(source: RecoverySource) {
    if (this.closed) throw new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED');
    if (this.sources.has(source.id)) throw new Error('重复恢复领域：' + source.id);
    if (source.recover && !source.confirmed)
      throw new Error('可执行恢复领域必须提供原票据确认：' + source.id);
    this.sources.set(source.id, source);
  }
  async init() {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (info && (!info.isFile() || info.size > 8 * 1024 * 1024))
      throw new AppError('恢复目录类型或大小无效', 503, 'RECOVERY_CORRUPT');
    const saved = await readStore<unknown>(this.file, () => undefined);
    if (saved !== undefined) {
      const parsed = envelope.safeParse(saved);
      if (!parsed.success || checksum(parsed.data.records) !== parsed.data.digest)
        throw new AppError('恢复目录校验失败，保留原记录等待修复', 503, 'RECOVERY_CORRUPT');
      for (const record of parsed.data.records) {
        if (record.id !== checksum(record.binding) || this.records.has(record.id))
          throw new AppError('恢复记录身份不匹配', 503, 'RECOVERY_CORRUPT');
        this.records.set(record.id, record.state === 'attempting' ? { ...record, state: 'pending' } : record);
      }
    }
    this.initialized = true;
    await this.refresh();
  }
  private serial<T>(work: () => Promise<T>) {
    const pending = this.queue.catch(() => {}).then(work);
    this.queue = pending;
    return pending;
  }
  private async save() {
    const records = [...this.records.values()];
    const digest = checksum(records);
    if (this.lastSaved === digest) return;
    // Publication is a cleanup receipt. Request revocation cannot invalidate already completed cleanup.
    await control(() => writeStore(this.file, { version: 1, records, digest }));
    this.lastSaved = digest;
  }
  private async discover() {
    if (!this.initialized) throw new Error('恢复目录尚未初始化');
    const current = new Map<string, RecoveryCandidate>();
    for (const source of this.sources.values())
      for (const candidate of await source.discover()) {
        const binding = recoveryBinding.parse(candidate.binding);
        if (binding.domain !== source.id) throw new Error('恢复领域声明不匹配');
        const id = checksum(binding),
          prior = this.records.get(id),
          now = new Date().toISOString();
        const resourceIds = [...new Set(candidate.resourceIds)].sort();
        const ticketRevision = recoveryRecord.shape.ticketRevision.parse(candidate.ticketRevision);
        const discoveryError = recoveryRecord.shape.discoveryError.parse(candidate.error);
        const normalized = { ...candidate, binding, resourceIds };
        current.set(id, normalized);
        if (!prior) {
          if (this.records.size >= 4096) {
            const resolved = [...this.records].find(([, record]) => record.state === 'resolved');
            if (resolved) this.records.delete(resolved[0]);
            else throw new AppError('恢复目录已满，需先完成领域恢复', 503, 'RECOVERY_CAPACITY');
          }
          this.records.set(
            id,
            recoveryRecord.parse({
              id,
              binding,
              ticketRevision,
              resourceIds,
              state: 'pending',
              firstSeenAt: now,
              updatedAt: now,
              attempts: 0,
              discoveryError,
            }),
          );
        } else if (prior.state === 'resolved') {
          // A recurring receipt is a new incident even if a domain reused its opaque ticket id.
          prior.state = 'pending';
          prior.resourceIds = resourceIds;
          prior.ticketRevision = ticketRevision;
          prior.discoveryError = discoveryError;
          prior.updatedAt = now;
        } else if (JSON.stringify(prior.resourceIds) !== JSON.stringify(resourceIds) ||
          prior.ticketRevision !== ticketRevision || prior.discoveryError !== discoveryError) {
          prior.resourceIds = resourceIds;
          prior.ticketRevision = ticketRevision;
          prior.discoveryError = discoveryError;
          prior.updatedAt = now;
        }
      }
    this.candidates = current;
    const active = new Set(this.activeResources().map((resource) => resource.id));
    for (const record of this.records.values()) {
      if (
        record.state === 'resolved' ||
        current.has(record.id) ||
        record.resourceIds.some((id) => active.has(id))
      )
        continue;
      if (await this.sources.get(record.binding.domain)?.confirmed?.(record)) {
        record.state = 'resolved';
        record.error = undefined;
        record.updatedAt = new Date().toISOString();
      }
    }
    await this.save();
  }
  refresh() {
    if (this.closed) return Promise.reject(new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'));
    return this.serial(async () => {
      await this.discover();
      return this.view();
    });
  }
  view(): RecoveryView[] {
    return [...this.records.values()].map((record) => {
      const candidate = this.candidates.get(record.id),
        source = this.sources.get(record.binding.domain);
      const available =
        record.state !== 'resolved' && !!candidate && !!source?.recover && candidate.actions.length > 0;
      return {
        ...structuredClone(record),
        error: record.error || record.discoveryError,
        digest: checksum(record),
        available,
        actions: available ? candidate!.actions.map((action) => ({ ...action })) : [],
      };
    });
  }
  retry(input: unknown) {
    if (this.closed) return Promise.reject(new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED'));
    const request = recoveryRequest.parse(input);
    const check = captureOperationCheck();
    return this.serial(async () => {
      if (this.closed) throw new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED');
      await check();
      await this.discover();
      const record = this.records.get(request.id),
        candidate = this.candidates.get(request.id);
      if (!record || !candidate || record.state === 'resolved')
        throw new AppError('原恢复票据当前不可用', 409, 'RECOVERY_UNAVAILABLE');
      if (checksum(record) !== request.digest)
        throw new AppError('恢复记录已变化，请刷新后重试', 409, 'RECOVERY_STALE');
      const source = this.sources.get(record.binding.domain)!;
      if (!source.recover || !candidate.actions.some((action) => action.id === request.action))
        throw new AppError('领域未提供此恢复动作', 403, 'RECOVERY_ACTION_DENIED');
      await check();
      record.state = 'attempting';
      record.attempts++;
      record.updatedAt = new Date().toISOString();
      await this.save();
      try {
        await check();
        // Domain retries can perform new work (for example, re-copying a migration).
        // Keep request revocation active; only original domain cleanup receipts may detach from it.
        await withResourceContext({ ...record.binding, recoveryId: record.id }, () =>
          source.recover!(candidate, request.action),
        );
        // A successful callback alone is insufficient while original resources remain registered.
        const active = new Set(this.activeResources().map((resource) => resource.id));
        if (record.resourceIds.some((id) => active.has(id)) || !(await source.confirmed?.(record)))
          throw new AppError('原资源尚未确认核销', 503, 'RECOVERY_CLEANUP_PENDING');
        record.state = 'resolved';
        record.error = undefined;
      } catch (error) {
        record.state = 'pending';
        record.error = String(error).slice(0, 1024);
        record.updatedAt = new Date().toISOString();
        await this.save();
        throw error;
      }
      record.updatedAt = new Date().toISOString();
      await this.save();
      return this.view().find((item) => item.id === record.id)!;
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const pending = this.serial(async () => {
      if (this.initialized) await control(() => this.discover());
    });
    this.closing = pending;
    void pending.catch(() => {
      if (this.closing === pending) this.closing = undefined;
    });
    return pending;
  }
}
