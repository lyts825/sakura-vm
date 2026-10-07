/**
 * 模块职责：将备份恢复到临时实例并检查启动及选定文件，用实际恢复结果验证灾备可用性。
 * Module purpose: Restores backups into temporary VMs and checks startup and selected files to measure actual recovery success.
 */
import type { BackupsV1, BundlesV1 } from './service-contracts/v1.ts';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';

import { AppError } from '../shared/errors.ts';
import { guestPath } from '../shared/paths.ts';

const pathSchema = z.string().max(4096).refine((value) => {
  try { guestPath(value); return true; } catch { return false; }
}, '需要有效的客户机绝对路径');
export const disasterRecoveryInput = z.object({
  mode: z.enum(['status', 'run']).default('status'),
  backupId: z.uuid().optional(),
  probePath: pathSchema.optional(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine((value) => !value.expectedSha256 || !!value.probePath,
  '指定预期 SHA-256 时必须指定检查文件路径');

/**
 * 入口 / Entry: quote.
 * 功能：从当前输入或状态计算 ``'${value.replaceAll("'", "'\\''")}'``，供调用方后续验证或使用。
 * Purpose: Computes ``'${value.replaceAll("'", "'\\''")}'`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: string
 * 输出 / Returns: ``'${value.replaceAll("'", "'\\''")}'``.
 * 副作用 / Effects: `value.replaceAll`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export class DisasterRecoveryDrill {
  /**
   * 入口 / Entry: DisasterRecoveryDrill.constructor.
   * 功能：建立 DisasterRecoveryDrill 的将备份恢复到临时实例并检查启动及选定文件上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the DisasterRecoveryDrill context for this module's responsibility: Restores backups into temporary VMs and checks startup and selected files to measure actual recovery success. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; backups: BackupsV1; bundles: BundlesV1
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines, private backups: BackupsV1, private bundles: BundlesV1) {}

  /**
   * 入口 / Entry: DisasterRecoveryDrill.status.
   * 功能：在将备份恢复到临时实例并检查启动及选定文件中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ backups: state.items.map((item) => ({ id: item.id, createdAt: item.createdAt, bytes: item.bytes, encrypted: item.encrypted,…` 供上层消费（`DisasterRecoveryDrill`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `DisasterRecoveryDrill`; this entry produces `{ backups: state.items.map((item) => ({ id: item.id, createdAt: item.createdAt, bytes: item.bytes, encrypted: item.encrypted,…` for its caller. Module context: Restores backups into temporary VMs and checks startup and selected files to measure actual recovery success.
   * 处理：通过 `this.backups.view`, `state.items.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.backups.view`, `state.items.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ backups: state.items.map((item) => ({ id: item.id, createdAt: item.createdAt, bytes: item.bytes, encrypted: item.encrypted,…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async status(id: string) {
    const state = await this.backups.view(id);
    return { backups: state.items.map((item) => ({ id: item.id,
      createdAt: item.createdAt, bytes: item.bytes, encrypted: item.encrypted,
      storage: item.storage, verifiedAt: item.verifiedAt || null })) };
  }

  /**
   * 入口 / Entry: DisasterRecoveryDrill.run.
   * 功能：在将备份恢复到临时实例并检查启动及选定文件中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...(await this.status(id)), ready: true, executed: false }` / `{ ready: !problem && !cleanupError, executed: true, backupId: value.backupId, probePath: path, ...(probeSha256 ? { probeSha25…` 供上层消费（`DisasterRecoveryDrill`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DisasterRecoveryDrill`; this entry produces `{ ...(await this.status(id)), ready: true, executed: false }` / `{ ready: !problem && !cleanupError, executed: true, backupId: value.backupId, probePath: path, ...(probeSha256 ? { probeSha25…` for its caller. Module context: Restores backups into temporary VMs and checks startup and selected files to measure actual recovery success.
   * 处理：通过 `disasterRecoveryInput.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.status` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `disasterRecoveryInput.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.status`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `action === 'check' || value.mode === 'status'`; `restoredId`.
   * 输入 / Inputs: id: string; input: unknown; action: 'check' | 'run'; signal: AbortSignal optional; log: (line: string) => void default=() => {}
   * 输出 / Returns: `{ ...(await this.status(id)), ready: true, executed: false }`; `{ ready: !problem && !cleanupError, executed: true, backupId: value.backupId, probePath: path, ...(probeSha256 ? { probeSha25…`.
   * 副作用 / Effects: `AbortSignal.timeout`; `AbortSignal.any`; `this.machines.stop`; `this.machines.delete`; 更新 / updates `problem`, `cleanupError`.
   * 拒绝 / Refusals: 条件 / conditions `!value.backupId`; 异常 / errors `new AppError('请选择要演练的备份', 400)`.
   * 失败处理：catch 分支执行 `problem = deadline.aborted && !signal?.aborted ? '灾备演练超过 6 分钟' : String((error as Error).message || error);`; `log(`演练失败：${problem}\n`);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `problem = deadline.aborted && !signal?.aborted ? '灾备演练超过 6 分钟' : String((error as Error).message || error);`; `log(`演练失败：${problem}\n`);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async run(id: string, input: unknown, action: 'check' | 'run', signal?: AbortSignal,
    log: (line: string) => void = () => {}) {
    const value = disasterRecoveryInput.parse(input);
    this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (action === 'check' || value.mode === 'status')
      return { ...(await this.status(id)), ready: true, executed: false };
    if (!value.backupId) throw new AppError('请选择要演练的备份', 400);
    const started = performance.now();
    const deadline = AbortSignal.timeout(360_000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const name = 'drill-' + randomBytes(5).toString('hex');
    const path = value.probePath || '/workspace';
    let restoredId: string | undefined;
    let restoreMs: number | undefined;
    let bootMs: number | undefined;
    let probeSha256: string | undefined;
    let problem: string | undefined;
    let cleanupError: string | undefined;
    try {
      log(`正在校验备份 ${value.backupId} 并恢复临时实例…\n`);
      /**
       * 入口 / Entry: DisasterRecoveryDrill.run.callback@59.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.backups.withVerifiedFile）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.backups.withVerifiedFile).
       * 输入 / Inputs: file; lease
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `createReadStream`; `this.machines.start`; `this.machines.exec`; `inline.exec`; 更新 / updates `restoredId`, `restoreMs`, `bootMs`, `probeSha256`.
       * 拒绝 / Refusals: 条件 / conditions `['stopped', 'error'].includes(this.machines.state(vm.id))`; `probe.code !== 0`; `value.expectedSha256`; 异常 / errors `new AppError('恢复实例未能启动，请查看演练日志', 409)`; `new AppError(`恢复实例中无法验证 ${path}`, 409)`.
       */
      await this.backups.withVerifiedFile(id, value.backupId, undefined, combined,
        async (file, lease) => {
          combined.throwIfAborted();
          const vm = await this.bundles.import(name, createReadStream(file), combined, undefined, undefined,
            lease.cleanupPending, lease);
          restoredId = vm.id;
          restoreMs = Math.round(performance.now() - started);
          log(`备份已恢复到临时实例 ${name}；正在启动并检查。\n`);
          this.machines.requireUnlocked(id);
          const bootStarted = performance.now();
          await this.machines.start(vm.id);
          while (this.machines.state(vm.id) !== 'running') {
            combined.throwIfAborted();
            if (['stopped', 'error'].includes(this.machines.state(vm.id)))
              throw new AppError('恢复实例未能启动，请查看演练日志', 409);
            await delay(300, undefined, { signal: combined });
          }
          bootMs = Math.round(performance.now() - bootStarted);
          const command = value.expectedSha256
            ? `sha256sum -- ${quote(path)}` : `test -e ${quote(path)}`;
          const probe = await this.machines.exec(vm.id, command, 30_000, combined);
          combined.throwIfAborted();
          if (probe.code !== 0) throw new AppError(`恢复实例中无法验证 ${path}`, 409);
          if (value.expectedSha256) {
            probeSha256 = /^([a-f0-9]{64})\s/.exec(probe.stdout)?.[1];
            if (probeSha256 !== value.expectedSha256)
              throw new AppError(`恢复文件 ${path} 的 SHA-256 不匹配`, 409);
          }
          log(`恢复实例启动成功，路径 ${path} 检查通过。\n`);
        });
    } catch (error) {
      problem = deadline.aborted && !signal?.aborted ? '灾备演练超过 6 分钟' :
        String((error as Error).message || error);
      log(`演练失败：${problem}\n`);
    }
    if (restoredId) {
      try {
        await this.machines.stop(restoredId, true);
        await this.machines.delete(restoredId);
        log('临时恢复实例已清理。\n');
      } catch (error) {
        cleanupError = String((error as Error).message || error);
        log(`临时实例 ${name} 清理失败：${cleanupError}\n`);
      }
    }
    return { ready: !problem && !cleanupError, executed: true,
      backupId: value.backupId, probePath: path,
      ...(probeSha256 ? { probeSha256 } : {}),
      restoreMs: restoreMs ?? null, bootMs: bootMs ?? null,
      totalMs: Math.round(performance.now() - started),
      restoredName: name, temporaryVmId: restoredId || null,
      temporaryVmRemoved: !!restoredId && !cleanupError,
      ...(problem ? { error: problem } : {}),
      ...(cleanupError ? { cleanupError } : {}) };
  }
}
