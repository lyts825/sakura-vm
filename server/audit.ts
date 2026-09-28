import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readFile, stat, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { z, ZodError } from 'zod';
import { DATA, AppError } from './model.ts';
import { readStore, writeStore } from './local-store.ts';

const hex = z.string().regex(/^[a-f0-9]{64}$/);
const eventSchema = z
  .object({
    time: z.iso.datetime(),
    kind: z.enum(['request', 'job', 'connection']),
    phase: z.enum(['start', 'end']),
    traceId: z.string().regex(/^[a-f0-9]{32}$/),
    spanId: z.string().regex(/^[a-f0-9]{16}$/),
    parentSpanId: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional(),
    name: z.string().min(1).max(200),
    vmId: z.uuid().optional(),
    projectId: z.string().max(32).optional(),
    status: z.number().int().min(0).max(599).optional(),
    jobId: z.uuid().optional(),
    actorId: z.uuid().optional(),
  })
  .strict();
const recordSchema = z
  .object({ sequence: z.number().int().positive(), previous: hex, event: eventSchema, hash: hex })
  .strict();
export type AuditEvent = z.infer<typeof eventSchema>;
export type AuditRecord = z.infer<typeof recordSchema>;
type TraceContext = Pick<AuditEvent, 'traceId' | 'spanId' | 'parentSpanId'>;
const context = new AsyncLocalStorage<TraceContext>();
const zero = '0'.repeat(64);

export class AuditLog {
  private queue: Promise<unknown> = Promise.resolve();
  private key?: Buffer;
  private cached?: { sequence: number; hash: string; bytes: number; mtime: number };
  constructor(private directory = join(DATA, 'audit')) {}
  private file() {
    return join(this.directory, 'events.jsonl');
  }
  private async secret() {
    if (this.key) return this.key;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, 'key');
    try {
      this.key = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (
        (await stat(this.file()).catch(() => null)) ||
        (await stat(join(this.directory, 'seal.json')).catch(() => null))
      )
        throw new AppError('审计密钥缺失，请从备份恢复');
      await writeFile(path, randomBytes(32), { flag: 'wx', mode: 0o600, flush: true });
      this.key = await readFile(path);
    }
    if (this.key.length !== 32) throw new AppError('审计校验密钥损坏');
    return this.key;
  }
  private async signature(value: unknown) {
    return createHmac('sha256', await this.secret())
      .update(JSON.stringify(value))
      .digest('hex');
  }
  private async seal(sequence: number, hash: string) {
    await writeStore(join(this.directory, 'seal.json'), {
      sequence,
      hash,
      mac: await this.signature(['seal', sequence, hash]),
    });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(work);
    this.queue = next;
    return next;
  }
  private async scan(limit: number, vmId?: string) {
    await this.secret();
    const info = await stat(this.file()).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 128 * 1024 ** 2))
      throw new AppError('审计日志类型或大小超过限制');
    const anchor = await readStore<{ sequence: number; hash: string; mac: string } | null>(
      join(this.directory, 'seal.json'),
      () => null,
    );
    if (
      anchor &&
      (anchor.mac !== (await this.signature(['seal', anchor.sequence, anchor.hash])) ||
        !Number.isSafeInteger(anchor.sequence) ||
        anchor.sequence < 0)
    )
      throw new AppError('审计封印校验失败');
    let sequence = 0,
      hash = zero,
      anchored = !anchor || (anchor.sequence === 0 && anchor.hash === zero);
    const records: AuditRecord[] = [];
    if (info) {
      if (info.size) {
        const handle = await open(this.file(), 'r');
        try {
          const last = Buffer.alloc(1);
          await handle.read(last, 0, 1, info.size - 1);
          if (last[0] !== 10) throw new AppError('审计日志最后一条记录截断');
        } finally {
          await handle.close();
        }
      }
      const input = createReadStream(this.file()),
        lines = createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (!line || line.length > 8192) throw new AppError('审计记录截断或超过长度限制');
          const entry = recordSchema.parse(JSON.parse(line));
          if (
            entry.sequence !== sequence + 1 ||
            entry.previous !== hash ||
            entry.hash !== (await this.signature([entry.sequence, entry.previous, entry.event]))
          )
            throw new AppError('审计日志链校验失败：第 ' + (sequence + 1) + ' 条');
          sequence = entry.sequence;
          hash = entry.hash;
          if (anchor?.sequence === sequence) anchored = anchor.hash === hash;
          if (limit && (!vmId || entry.event.vmId === vmId)) {
            records.push(entry);
            if (records.length > limit) records.shift();
          }
        }
      } finally {
        lines.close();
        input.destroy();
      }
    }
    if (!anchored || (anchor && anchor.sequence > sequence) || (sequence && !anchor))
      throw new AppError('审计日志被截断或缺少封印');
    // A complete authenticated append may survive a crash before its seal write.
    this.cached = { sequence, hash, bytes: info?.size || 0, mtime: info?.mtimeMs || 0 };
    return { valid: true as const, sequence, hash, records, bytes: info?.size || 0 };
  }
  async read(limit = 200, vmId?: string) {
    return this.serial(async () => {
      try {
        return await this.scan(Math.max(0, Math.min(2000, limit)), vmId);
      } catch (error) {
        this.cached = undefined;
        return { valid: false as const, records: [], error: (error as Error).message };
      }
    });
  }
  record(value: AuditEvent) {
    const event = eventSchema.parse(value);
    return this.serial(async () => {
      try {
        const info = await stat(this.file()).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        });
        if (
          !this.cached ||
          (info?.size || 0) !== this.cached.bytes ||
          (info?.mtimeMs || 0) !== this.cached.mtime
        )
          await this.scan(0);
        const previous = this.cached!.hash,
          sequence = this.cached!.sequence + 1;
        if (this.cached!.bytes > 128 * 1024 ** 2 - 8192)
          throw new AppError('审计存储已达到 128 MiB 上限，请归档后维护数据目录');
        if (sequence === 1) await this.seal(0, zero);
        const entry: AuditRecord = {
          sequence,
          previous,
          event,
          hash: await this.signature([sequence, previous, event]),
        };
        await appendFile(this.file(), JSON.stringify(entry) + '\n', { mode: 0o600, flush: true });
        await this.seal(sequence, entry.hash);
        const saved = await stat(this.file());
        this.cached = { sequence, hash: entry.hash, bytes: saved.size, mtime: saved.mtimeMs };
        return entry;
      } catch (error) {
        this.cached = undefined;
        throw new AppError('审计写入失败：' + (error as Error).message, 503, 'AUDIT_UNAVAILABLE');
      }
    });
  }
  async span<T>(
    event: Pick<AuditEvent, 'kind' | 'name' | 'vmId' | 'projectId' | 'jobId' | 'actorId'>,
    work: () => Promise<T>,
    status: () => number = () => 200,
  ) {
    const parent = context.getStore();
    const span: TraceContext = {
      traceId: parent?.traceId || randomBytes(16).toString('hex'),
      spanId: randomBytes(8).toString('hex'),
      ...(parent ? { parentSpanId: parent.spanId } : {}),
    };
    await this.record({ ...event, ...span, time: new Date().toISOString(), phase: 'start' });
    return context.run(span, async () => {
      let code = 500;
      try {
        const result = await work();
        code = status();
        return result;
      } catch (error) {
        code =
          error instanceof AppError
            ? error.status
            : error instanceof ZodError
              ? 400
              : (error as Error).name === 'AbortError'
                ? 499
                : 500;
        throw error;
      } finally {
        await this.record({ ...event, ...span, time: new Date().toISOString(), phase: 'end', status: code });
      }
    });
  }
  async close() {
    await this.queue;
  }
}

let current: AuditLog | undefined;
export function hostAudit() {
  return (current ||= new AuditLog());
}
export function traceExport(records: AuditRecord[]) {
  const starts = new Map<string, AuditEvent>(),
    spans: Record<string, unknown>[] = [];
  for (const record of records) {
    const event = record.event,
      key = event.traceId + ':' + event.spanId;
    if (event.phase === 'start') {
      starts.set(key, event);
      continue;
    }
    const start = starts.get(key);
    if (!start) continue;
    spans.push({
      traceId: event.traceId,
      spanId: event.spanId,
      parentSpanId: event.parentSpanId,
      name: event.name,
      kind: event.kind === 'request' ? 2 : 1,
      startTimeUnixNano: String(BigInt(Date.parse(start.time)) * 1000000n),
      endTimeUnixNano: String(BigInt(Date.parse(event.time)) * 1000000n),
      attributes: [
        { key: 'sakura.kind', value: { stringValue: event.kind } },
        ...(event.vmId ? [{ key: 'sakura.vm.id', value: { stringValue: event.vmId } }] : []),
        ...(event.jobId ? [{ key: 'sakura.job.id', value: { stringValue: event.jobId } }] : []),
      ],
      status: { code: (event.status || 0) >= 400 ? 2 : 1 },
    });
  }
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'sakura' } }] },
        scopeSpans: [{ scope: { name: 'sakura.controller', version: '1' }, spans }],
      },
    ],
  };
}
