/**
 * 模块职责：聚合领域恢复来源和持久索引，重试或重建前核对原记录摘要与当前领域证据。
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, open, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import {
  recoveryBinding,
  recoveryRecord,
  recoveryRequest,
  recoveryRebuildRequest,
  type RecoveryBinding,
  type RecoveryRecord,
  type RecoveryView,
  type RecoveryDiagnostics,
  type RecoveryCatalogView,
} from '../shared/contracts/recovery.ts';
import { fileHash, writeStore } from './local-store.ts';
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
export const RECOVERY_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxRecords: 4096,
  resolvedRetention: 256,
});
const envelope = z
  .object({
    version: z.literal(1),
    records: z.array(recoveryRecord).max(RECOVERY_LIMITS.maxRecords),
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
  private fault?: { code: string; message: string };
  private sourceFailures: string[] = [];
  private quarantineFile?: string;
  private revision = randomUUID();
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
    try {
      const info = await lstat(this.file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      if (info) {
        if (!info.isFile() || info.isSymbolicLink() || info.size > RECOVERY_LIMITS.maxBytes)
          throw new AppError('恢复目录类型或大小无效', 503, 'RECOVERY_CORRUPT');
        const bytes = await readFile(this.file);
        if (bytes.byteLength > RECOVERY_LIMITS.maxBytes)
          throw new AppError('恢复目录超过读取容量', 503, 'RECOVERY_CORRUPT');
        let saved: unknown;
        try {
          saved = JSON.parse(bytes.toString('utf8'));
        } catch {
          throw new AppError('恢复目录 JSON 损坏', 503, 'RECOVERY_CORRUPT');
        }
        const parsed = envelope.safeParse(saved);
        if (!parsed.success || checksum(parsed.data.records) !== parsed.data.digest)
          throw new AppError('恢复目录校验失败', 503, 'RECOVERY_CORRUPT');
        const loaded = new Map<string, RecoveryRecord>();
        for (const record of parsed.data.records) {
          if (record.id !== checksum(record.binding) || loaded.has(record.id))
            throw new AppError('恢复记录身份不匹配', 503, 'RECOVERY_CORRUPT');
          loaded.set(record.id, record.state === 'attempting' ? { ...record, state: 'pending' } : record);
        }
        this.records = loaded;
      }
    } catch (error) {
      this.degrade(error);
    }
    this.initialized = true;
    await this.refresh();
  }
  private degrade(error: unknown) {
    const code = error instanceof AppError ? error.code : undefined;
    this.fault ||= {
      code: code || 'RECOVERY_STORAGE_UNAVAILABLE',
      message:
        code === 'RECOVERY_CAPACITY'
          ? '恢复目录容量不足，未覆盖原文件；请先通过所属服务处理待恢复票据。'
          : code === 'RECOVERY_SOURCE_UNAVAILABLE'
            ? '部分原领域无法完成核验，目录只读；请恢复领域服务后重建。'
            : '恢复目录不可用，原文件已保留；可隔离原文件并根据原领域票据重建。',
    };
  }
  diagnostics(): RecoveryDiagnostics {
    return {
      state: this.fault ? 'degraded' : 'healthy',
      ...this.fault,
      revision: checksum({
        revision: this.revision,
        fault: this.fault,
        sources: [...this.sources.keys()],
        sourceFailures: this.sourceFailures,
        saved: this.lastSaved,
      }),
      ...RECOVERY_LIMITS,
      recordCount: this.records.size,
      sourceFailures: [...this.sourceFailures],
      quarantineFile: this.quarantineFile,
    };
  }
  private assertHealthy() {
    if (this.fault) throw new AppError('恢复目录处于只读降级状态，请先诊断并重建', 503, 'RECOVERY_DEGRADED');
  }
  private serial<T>(work: () => Promise<T>) {
    const pending = this.queue.catch(() => {}).then(work);
    this.queue = pending;
    return pending;
  }
  private publication() {
    const resolved = [...this.records.values()]
      .filter((record) => record.state === 'resolved')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    for (const record of resolved.slice(RECOVERY_LIMITS.resolvedRetention)) this.records.delete(record.id);
    const records = [...this.records.values()];
    const digest = checksum(records);
    const value = { version: 1 as const, records, digest };
    // writeStore uses this exact UTF-8 representation. A published file must be readable next boot.
    if (
      records.length > RECOVERY_LIMITS.maxRecords ||
      Buffer.byteLength(JSON.stringify(value, null, 2)) > RECOVERY_LIMITS.maxBytes
    )
      throw new AppError('恢复目录达到持久容量上限', 503, 'RECOVERY_CAPACITY');
    envelope.parse(value);
    return value;
  }
  private async save() {
    const value = this.publication(),
      { digest } = value;
    if (this.lastSaved === digest) return;
    // Publication is a cleanup receipt. Request revocation cannot invalidate already completed cleanup.
    await control(() => writeStore(this.file, value));
    this.lastSaved = digest;
  }
  private async discover(readonly = false) {
    if (!this.initialized) throw new Error('恢复目录尚未初始化');
    const current = new Map<string, RecoveryCandidate>();
    const next = new Map([...this.records].map(([id, record]) => [id, structuredClone(record)]));
    const resolved = [...next.values()]
      .filter((record) => record.state === 'resolved')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    for (const record of resolved.slice(RECOVERY_LIMITS.resolvedRetention)) next.delete(record.id);
    this.sourceFailures = [];
    // Keep memory bounded too: indented record bytes are the same bytes used by writeStore.
    const recordBytes = (record: RecoveryRecord) =>
      Buffer.byteLength(JSON.stringify(record, null, 2).replace(/^/gm, '    ')) + 2;
    const sizes = new Map([...next].map(([id, record]) => [id, recordBytes(record)]));
    let bytes = [...sizes.values()].reduce((sum, value) => sum + value, 160);
    for (const source of this.sources.values()) {
      try {
        for (const candidate of await source.discover()) {
          const binding = recoveryBinding.parse(candidate.binding);
          if (binding.domain !== source.id) throw new Error('恢复领域声明不匹配');
          const id = checksum(binding),
            prior = next.get(id),
            now = new Date().toISOString();
          const resourceIds = [...new Set(candidate.resourceIds)].sort();
          const ticketRevision = recoveryRecord.shape.ticketRevision.parse(candidate.ticketRevision);
          const discoveryError = recoveryRecord.shape.discoveryError.parse(candidate.error);
          const normalized = { ...candidate, binding, resourceIds };
          const changed =
            !prior ||
            prior.state === 'resolved' ||
            JSON.stringify(prior.resourceIds) !== JSON.stringify(resourceIds) ||
            prior.ticketRevision !== ticketRevision ||
            prior.discoveryError !== discoveryError;
          const record = recoveryRecord.parse(
            prior
              ? {
                  ...prior,
                  resourceIds,
                  ticketRevision,
                  discoveryError,
                  state: prior.state === 'resolved' ? 'pending' : prior.state,
                  updatedAt: changed ? now : prior.updatedAt,
                }
              : {
                  id,
                  binding,
                  ticketRevision,
                  resourceIds,
                  state: 'pending',
                  firstSeenAt: now,
                  updatedAt: now,
                  attempts: 0,
                  discoveryError,
                },
          );
          const size = recordBytes(record),
            delta = size - (sizes.get(id) || 0);
          while (
            next.size + (prior ? 0 : 1) > RECOVERY_LIMITS.maxRecords ||
            bytes + delta > RECOVERY_LIMITS.maxBytes
          ) {
            const terminal = [...next.values()]
              .filter((value) => value.state === 'resolved' && value.id !== id)
              .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
            if (!terminal) throw new AppError('恢复目录达到持久容量上限', 503, 'RECOVERY_CAPACITY');
            bytes -= sizes.get(terminal.id) || 0;
            sizes.delete(terminal.id);
            next.delete(terminal.id);
          }
          bytes += delta;
          sizes.set(id, size);
          next.set(id, record);
          current.set(id, normalized);
        }
      } catch (error) {
        this.sourceFailures.push(source.id);
        if (error instanceof AppError && error.code === 'RECOVERY_CAPACITY') throw error;
      }
    }
    if (this.sourceFailures.length) throw new AppError('原领域发现失败', 503, 'RECOVERY_SOURCE_UNAVAILABLE');
    this.records = next;
    this.candidates = current;
    if (readonly) return;
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
      try {
        await this.discover(!!this.fault);
      } catch (error) {
        this.degrade(error);
      }
      return this.view();
    });
  }
  view(): RecoveryView[] {
    return [...this.records.values()].map((record) => {
      const candidate = this.candidates.get(record.id),
        source = this.sources.get(record.binding.domain);
      const available =
        !this.fault &&
        record.state !== 'resolved' &&
        !!candidate &&
        !!source?.recover &&
        candidate.actions.length > 0;
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
      this.assertHealthy();
      await check();
      try {
        await this.discover();
      } catch (error) {
        this.degrade(error);
        throw error;
      }
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
      try {
        await this.save();
      } catch (error) {
        this.degrade(error);
        throw error;
      }
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
        try {
          await this.save();
        } catch (storageError) {
          this.degrade(storageError);
        }
        throw error;
      }
      record.updatedAt = new Date().toISOString();
      try {
        await this.save();
      } catch (error) {
        this.degrade(error);
        throw error;
      }
      return this.view().find((item) => item.id === record.id)!;
    });
  }
  /** Rebuild only the index. Domain budgets, original receipts and VM fences are never modified here. */
  rebuild(input: unknown): Promise<RecoveryCatalogView> {
    const request = recoveryRebuildRequest.parse(input),
      check = captureOperationCheck();
    return this.serial(async () => {
      if (this.closed) throw new AppError('恢复目录正在关闭', 503, 'RECOVERY_CLOSED');
      if (!this.initialized) throw new AppError('恢复目录尚未初始化', 503, 'RECOVERY_UNAVAILABLE');
      await check();
      if (request.revision !== this.diagnostics().revision)
        throw new AppError('目录诊断已变化，请刷新后重试', 409, 'RECOVERY_STALE');
      try {
        // A discovery-only pass cannot resolve a receipt, even if a source claims confirmation.
        await this.discover(true);
        const value = this.publication();
        await check();
        const info = await lstat(this.file).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return undefined;
        });
        if (info) {
          if (!info.isFile() || info.isSymbolicLink())
            throw new AppError('恢复目录路径必须是普通文件，请先修复路径', 503, 'RECOVERY_CORRUPT');
          const isolated = this.file + '.quarantine-' + randomUUID();
          await control(() => copyFile(this.file, isolated, constants.COPYFILE_EXCL));
          this.quarantineFile = basename(isolated);
          const backup = await open(isolated, 'r+');
          try {
            await backup.sync();
          } finally {
            await backup.close();
          }
          // Detect changes during copying. The data-directory owner excludes other controllers;
          // operators must keep arbitrary external writers stopped throughout rebuilding.
          if ((await fileHash(isolated)) !== (await fileHash(this.file)))
            throw new AppError('隔离期间目录发生变化，原文件未覆盖', 409, 'RECOVERY_STALE');
        }
        await check();
        await control(() => writeStore(this.file, value));
        this.lastSaved = value.digest;
        this.fault = undefined;
        this.revision = randomUUID();
        return { version: 1, records: this.view(), diagnostics: this.diagnostics() };
      } catch (error) {
        this.degrade(error);
        throw error;
      }
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const pending = this.serial(async () => {
      if (this.initialized) {
        // A diagnosed read-only index owns no native resources. Shutdown must not turn its known
        // storage fault into a fictitious cleanup lease, or attempt to overwrite the evidence.
        if (this.fault) return;
        try {
          await control(() => this.discover());
        } catch (error) {
          this.degrade(error);
          throw error;
        }
      }
    });
    this.closing = pending;
    void pending.catch(() => {
      if (this.closing === pending) this.closing = undefined;
    });
    return pending;
  }
}
