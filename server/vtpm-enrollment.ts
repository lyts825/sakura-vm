/**
 * 模块职责：保存并检查 vTPM 登记状态，校验持久记录类型及指纹唯一性。
 * Module purpose: Persists/checks vTPM enrollment, validating record types and unique fingerprints.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import type { VmAccess as Machines } from './vm-access.ts';

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
/**
 * 入口 / Entry: initial.
 * 功能：从当前输入或状态计算 `({ version: 1, records: {} })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: 1, records: {} })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Store；结果来自 / values from `({ version: 1, records: {} })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const initial = (): Store => ({ version: 1, records: {} });

export class VtpmEnrollment {
  private store: Store = initial();
  private writes = Promise.resolve();
  private closed = false;
  /**
   * 入口 / Entry: VtpmEnrollment.constructor.
   * 功能：建立 VtpmEnrollment 的保存并检查 vTPM 登记状态上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the VtpmEnrollment context for this module's responsibility: Persists/checks vTPM enrollment, validating record types and unique fingerprints. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; file: default=join(DATA, 'vtpm-enrollment.json')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private file = join(DATA, 'vtpm-enrollment.json'),
  ) {}

  /**
   * 入口 / Entry: VtpmEnrollment.init.
   * 功能：在保存并检查 vTPM 登记状态中，初始化并核对当前领域状态；处理结果记录到 `this.store`（`VtpmEnrollment`）。
   * Purpose: Initializes and verifies current domain state in `VtpmEnrollment`; the outcome is recorded in `this.store`. Module context: Persists/checks vTPM enrollment, validating record types and unique fingerprints.
   * 处理：通过 `stat().catch`, `stat`, `info.isFile`, `storeSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stat().catch`, `stat`, `info.isFile`, `storeSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.store`.
   * 拒绝 / Refusals: 条件 / conditions `info && (!info.isFile() || info.size > 128 * 1024)`; `new Set(records.map((item) => item.fingerprint)).size !== records.length`; 异常 / errors `new AppError('vTPM 登记记录类型或大小无效')`; `new AppError('vTPM 登记记录存在重复指纹')`.
   */
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
  /**
   * 入口 / Entry: VtpmEnrollment.status.
   * 功能：在保存并检查 vTPM 登记状态中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ ready: true, executed: false, records, overdueCount: records.filter((item) => item.overdue).length, dueSoonCount: records.f…` 供上层消费（`VtpmEnrollment`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `VtpmEnrollment`; this entry produces `{ ready: true, executed: false, records, overdueCount: records.filter((item) => item.overdue).length, dueSoonCount: records.f…` for its caller. Module context: Persists/checks vTPM enrollment, validating record types and unique fingerprints.
   * 处理：通过 `this.machines.get`, `inline.map`, `records.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `inline.map`, `records.filter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; at: default=new Date()
   * 输出 / Returns: `{ ready: true, executed: false, records, overdueCount: records.filter((item) => item.overdue).length, dueSoonCount: records.f…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
  /**
   * 入口 / Entry: VtpmEnrollment.serial.
   * 功能：在保存并检查 vTPM 登记状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`VtpmEnrollment`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VtpmEnrollment`; this entry produces `task` for its caller. Module context: Persists/checks vTPM enrollment, validating record types and unique fingerprints.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch`, `task.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`, `task.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `task`.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
  /**
   * 入口 / Entry: VtpmEnrollment.action.
   * 功能：在保存并检查 vTPM 登记状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...this.status(id), ...(value.mode === 'save' ? { preview: { ...value, rotateDueAt: new Date( new Date(value.enrolledAt || …` / `this.status(id)` 供上层消费（`VtpmEnrollment`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VtpmEnrollment`; this entry produces `{ ...this.status(id), ...(value.mode === 'save' ? { preview: { ...value, rotateDueAt: new Date( new Date(value.enrolledAt || …` / `this.status(id)` for its caller. Module context: Persists/checks vTPM enrollment, validating record types and unique fingerprints.
   * 处理：通过 `vtpmEnrollmentInput.parse`, `this.machines.get`, `this.status`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `vtpmEnrollmentInput.parse`, `this.machines.get`, `this.status`, `this.serial`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `action === 'check'`; `value.mode === 'status'`.
   * 输入 / Inputs: id: string; raw: unknown; action: 'check' | 'run'
   * 输出 / Returns: `{ ...this.status(id), ...(value.mode === 'save' ? { preview: { ...value, rotateDueAt: new Date( new Date(value.enrolledAt || …`; `this.status(id)`; `this.serial(async () => { const next = structuredClone(this.store); const records = (next.records[id] ||= []); if (value.mode…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
    /**
     * 入口 / Entry: VtpmEnrollment.action.callback@112.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ ...this.status(id), executed: true }`.
     * 副作用 / Effects: `records.splice`; `records.push`; `writeStore`; 更新 / updates `next.records[id]`, `records[index]`, `this.store`.
     * 拒绝 / Refusals: 条件 / conditions `value.mode === 'remove'`; `index < 0`; `records.length >= 32`; 异常 / errors `new AppError('未找到此 vTPM 密钥登记', 404)`; `new AppError('单实例最多登记 32 个密钥指纹', 409)`.
     */
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
  /**
   * 入口 / Entry: VtpmEnrollment.close.
   * 功能：在保存并检查 vTPM 登记状态中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`VtpmEnrollment`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `VtpmEnrollment`; the outcome is recorded in `this.closed`. Module context: Persists/checks vTPM enrollment, validating record types and unique fingerprints.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   */
  async close() {
    this.closed = true;
    await this.writes;
  }
}
