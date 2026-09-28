import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import type { Machines } from './machines.ts';

const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
export const vtpmEnrollmentInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('status') }).strict(),
  z
    .object({
      mode: z.literal('save'),
      fingerprint,
      label: z.string().trim().min(1).max(80),
      enrolledAt: z.iso.datetime().optional(),
      rotateAfterDays: z.number().int().min(1).max(3650),
    })
    .strict(),
  z.object({ mode: z.literal('remove'), fingerprint }).strict(),
]);
const record = z
  .object({
    fingerprint,
    label: z.string().min(1).max(80),
    enrolledAt: z.iso.datetime(),
    rotateAfterDays: z.number().int().min(1).max(3650),
    updatedAt: z.iso.datetime(),
  })
  .strict();
const storeSchema = z
  .object({ version: z.literal(1), records: z.record(z.uuid(), z.array(record).max(32)) })
  .strict();
type Store = z.infer<typeof storeSchema>;
const initial = (): Store => ({ version: 1, records: {} });

export class VtpmEnrollment {
  private store: Store = initial();
  private writes = Promise.resolve();
  private closed = false;
  constructor(
    private machines: Machines,
    private file = join(DATA, 'vtpm-enrollment.json'),
  ) {}

  async init() {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 128 * 1024)) throw new AppError('vTPM 登记记录类型或大小无效');
    this.store = storeSchema.parse(await readStore(this.file, initial));
    for (const records of Object.values(this.store.records))
      if (new Set(records.map((item) => item.fingerprint)).size !== records.length)
        throw new AppError('vTPM 登记记录存在重复指纹');
  }
  status(id: string, at = new Date()) {
    this.machines.get(id);
    const records = (this.store.records[id] || []).map((item) => {
      const due = new Date(new Date(item.enrolledAt).getTime() + item.rotateAfterDays * 86400000);
      return {
        ...item,
        rotateDueAt: due.toISOString(),
        overdue: due <= at,
        dueSoon: due > at && due.getTime() - at.getTime() <= 30 * 86400000,
      };
    });
    return {
      ready: true,
      executed: false,
      records,
      overdueCount: records.filter((item) => item.overdue).length,
      dueSoonCount: records.filter((item) => item.dueSoon).length,
      message: '仅登记公钥 SHA-256 指纹和轮换日期；不会存储密钥、验证 TPM 报价或创建虚拟 TPM。',
    };
  }
  private serial<T>(work: () => Promise<T>) {
    const task = this.writes
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new AppError('vTPM 登记服务正在关闭', 503);
        return work();
      });
    this.writes = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  async action(id: string, raw: unknown, action: 'check' | 'run') {
    const value = vtpmEnrollmentInput.parse(raw);
    this.machines.get(id);
    if (action === 'check')
      return {
        ...this.status(id),
        ...(value.mode === 'save'
          ? {
              preview: {
                ...value,
                rotateDueAt: new Date(
                  new Date(value.enrolledAt || Date.now()).getTime() + value.rotateAfterDays * 86400000,
                ).toISOString(),
              },
            }
          : {}),
      };
    if (value.mode === 'status') return this.status(id);
    return this.serial(async () => {
      const next = structuredClone(this.store);
      const records = (next.records[id] ||= []);
      if (value.mode === 'remove') {
        const index = records.findIndex((item) => item.fingerprint === value.fingerprint);
        if (index < 0) throw new AppError('未找到此 vTPM 密钥登记', 404);
        records.splice(index, 1);
      } else {
        const item = {
          fingerprint: value.fingerprint,
          label: value.label,
          enrolledAt: value.enrolledAt || new Date().toISOString(),
          rotateAfterDays: value.rotateAfterDays,
          updatedAt: new Date().toISOString(),
        };
        const index = records.findIndex((record) => record.fingerprint === value.fingerprint);
        if (index >= 0) records[index] = item;
        else {
          if (records.length >= 32) throw new AppError('单实例最多登记 32 个密钥指纹', 409);
          records.push(item);
        }
      }
      await writeStore(this.file, next);
      this.store = next;
      return { ...this.status(id), executed: true };
    });
  }
  async close() {
    this.closed = true;
    await this.writes;
  }
}
