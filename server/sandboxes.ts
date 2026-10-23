/**
 * 模块职责：创建、执行并控制临时沙箱，协调到期清理和产物收集生命周期。
 * Module purpose: Creates/runs/controls temporary sandboxes, coordinating expiration cleanup and artifact collection.
 */
import type { JobsV1 } from './service-contracts/v1.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import {
  sandboxExpired,
  sandboxPolicySchema,
  type SandboxExecution,
  type SandboxPolicy,
} from '../shared/sandbox.ts';
import { quote } from './shell.ts';
import { Jobs } from './jobs.ts';
import { type JobView } from '../shared/contracts/jobs.ts';
import { BOOT_TIMEOUT_MS } from '../shared/contracts/vm.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { createSchema, type VMView } from '../shared/contracts/vm.ts';
import { SandboxArtifacts, artifactPathSchema } from './sandbox-artifacts.ts';
import { repairFilesSchema } from '../shared/contracts/repair-session.ts';
import { sandboxInputDirectory, stageSandboxInputs } from './sandbox-inputs.ts';
import { withOperationCheck } from './operation-context.ts';

export const sandboxCreateSchema = z
  .object({
    name: createSchema.shape.name,
    distro: createSchema.shape.distro,
    accelerator: createSchema.shape.accelerator,
    memoryMiB: z.number().int().min(256).max(4096).default(512),
    cpus: z.number().int().min(1).max(4).default(1),
    diskGiB: z.number().int().min(2).max(32).default(4),
    lifetimeMinutes: z.number().int().min(5).max(1440).default(60),
    network: sandboxPolicySchema.shape.network.default('isolated'),
    onExpire: sandboxPolicySchema.shape.onExpire.default('delete'),
    storage: sandboxPolicySchema.shape.storage,
  })
  .strict();

export const sandboxRunSchema = z
  .object({
    inputFiles: repairFilesSchema.optional(),
    command: z
      .string()
      .trim()
      .min(1)
      .max(8192)
      .refine((s) => !s.includes('\0'), '命令不能包含空字符'),
    cwd: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^\/[^\x00-\x1f]*$/, '需要 Linux 绝对路径')
      .default('/workspace'),
    timeoutSeconds: z.number().int().min(1).max(3600).default(60),
    artifacts: z
      .array(artifactPathSchema)
      .max(8)
      .default([])
      .refine((paths) => new Set(paths).size === paths.length, '产物路径不能重复'),
  })
  .strict().refine(value => !value.inputFiles || value.cwd === sandboxInputDirectory,
    '文本输入只允许写入沙箱专用目录 /workspace/sakura-input');

export type SandboxView = VMView & { sandbox: SandboxPolicy; expired: boolean };
export type SandboxOverview = { sandboxes: SandboxView[]; runs: JobView[]; persistenceError?: string };

export class Sandboxes {
  readonly jobs: JobsV1;
  private busy = new Set<string>();
  private closed = false;

  /**
   * 入口 / Entry: Sandboxes.constructor.
   * 功能：建立 Sandboxes 的创建、执行并控制临时沙箱上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Sandboxes context for this module's responsibility: Creates/runs/controls temporary sandboxes, coordinating expiration cleanup and artifact collection. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; jobs: default=new Jobs('sandbox'); artifacts: default=new SandboxArtifacts(machines)
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.jobs`.
   */
  constructor(
    private machines: Machines,
    jobs = new Jobs('sandbox'),
    private artifacts = new SandboxArtifacts(machines),
  ) {
    this.jobs = jobs;
  }
  /**
   * 入口 / Entry: Sandboxes.init.
   * 功能：在创建、执行并控制临时沙箱中，初始化并核对当前领域状态；完成下述调用及状态处理（`Sandboxes`）。
   * Purpose: Initializes and verifies current domain state in `Sandboxes`; the calls and state transitions below complete the operation. Module context: Creates/runs/controls temporary sandboxes, coordinating expiration cleanup and artifact collection.
   * 处理：通过 `this.artifacts.prune`, `this.jobs.list` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.artifacts.prune`, `this.jobs.list`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    await this.artifacts.prune(this.jobs.list());
  }
  /**
   * 入口 / Entry: Sandboxes.artifact.
   * 功能：在创建、执行并控制临时沙箱中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.artifacts.download(this.jobs.get(runId), artifactId)` 供上层消费（`Sandboxes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Sandboxes`; this entry produces `this.artifacts.download(this.jobs.get(runId), artifactId)` for its caller. Module context: Creates/runs/controls temporary sandboxes, coordinating expiration cleanup and artifact collection.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `this.artifacts.download`, `this.jobs.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `this.artifacts.download`, `this.jobs.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: runId: string; artifactId: string
   * 输出 / Returns: `this.artifacts.download(this.jobs.get(runId), artifactId)`.
   * 副作用 / Effects: `this.artifacts.download`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async artifact(runId: string, artifactId: string) {
    z.uuid().parse(runId);
    return this.artifacts.download(this.jobs.get(runId), artifactId);
  }
  /**
   * 入口 / Entry: Sandboxes.get.
   * 功能：在创建、执行并控制临时沙箱中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `vm as typeof vm & { sandbox: SandboxPolicy }` 供上层消费（`Sandboxes`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Sandboxes`; this entry produces `vm as typeof vm & { sandbox: SandboxPolicy }` for its caller. Module context: Creates/runs/controls temporary sandboxes, coordinating expiration cleanup and artifact collection.
   * 处理：通过 `this.machines.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `vm as typeof vm & { sandbox: SandboxPolicy }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!vm.sandbox`; 异常 / errors `new AppError('该实例不是沙箱', 409, 'NOT_A_SANDBOX')`.
   */
  private get(id: string) {
    const vm = this.machines.get(id);
    if (!vm.sandbox) throw new AppError('该实例不是沙箱', 409, 'NOT_A_SANDBOX');
    return vm as typeof vm & { sandbox: SandboxPolicy };
  }
  /**
   * 入口 / Entry: Sandboxes.available.
   * 功能：在创建、执行并控制临时沙箱中，执行此领域的具体处理步骤并返回其结果；本入口产生 `vm` 供上层消费（`Sandboxes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Sandboxes`; this entry produces `vm` for its caller. Module context: Creates/runs/controls temporary sandboxes, coordinating expiration cleanup and artifact collection.
   * 处理：通过 `this.get`, `sandboxExpired` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.get`, `sandboxExpired`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `vm`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `sandboxExpired(vm.sandbox)`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('沙箱已到期', 409, 'SANDBOX_EXPIRED')`.
   */
  private available(id: string) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const vm = this.get(id);
    if (sandboxExpired(vm.sandbox)) throw new AppError('沙箱已到期', 409, 'SANDBOX_EXPIRED');
    return vm;
  }
  /**
   * 入口 / Entry: Sandboxes.view.
   * 功能：在创建、执行并控制临时沙箱中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ ...(await this.machines.view(id)), sandbox: vm.sandbox, expired: sandboxExpired(vm.sandbox) }` 供上层消费（`Sandboxes`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Sandboxes`; this entry produces `{ ...(await this.machines.view(id)), sandbox: vm.sandbox, expired: sandboxExpired(vm.sandbox) }` for its caller. Module context: Creates/runs/controls temporary sandboxes, coordinating expiration cleanup and artifact collection.
   * 处理：通过 `this.get`, `this.machines.view`, `sandboxExpired` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.get`, `this.machines.view`, `sandboxExpired`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<SandboxView>；结果来自 / values from `{ ...(await this.machines.view(id)), sandbox: vm.sandbox, expired: sandboxExpired(vm.sandbox) }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string): Promise<SandboxView> {
    const vm = this.get(id);
    return { ...(await this.machines.view(id)), sandbox: vm.sandbox, expired: sandboxExpired(vm.sandbox) };
  }
  /**
   * 入口 / Entry: Sandboxes.list.
   * 功能：在创建、执行并控制临时沙箱中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ sandboxes: (await this.machines.list()) .filter((vm) => vm.sandbox && !vm.rescueOf) .map((vm) => ({ ...vm, sandbox: vm.sand…` 供上层消费（`Sandboxes`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Sandboxes`; this entry produces `{ sandboxes: (await this.machines.list()) .filter((vm) => vm.sandbox && !vm.rescueOf) .map((vm) => ({ ...vm, sandbox: vm.sand…` for its caller. Module context: Creates/runs/controls temporary sandboxes, coordinating expiration cleanup and artifact collection.
   * 处理：通过 `inline.filter().map`, `inline.filter`, `this.machines.list`, `this.jobs.list` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.filter().map`, `inline.filter`, `this.machines.list`, `this.jobs.list`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<SandboxOverview>；结果来自 / values from `{ sandboxes: (await this.machines.list()) .filter((vm) => vm.sandbox && !vm.rescueOf) .map((vm) => ({ ...vm, sandbox: vm.sand…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async list(): Promise<SandboxOverview> {
    return {
      sandboxes: (await this.machines.list())
        .filter((vm) => vm.sandbox && !vm.rescueOf)
        .map((vm) => ({ ...vm, sandbox: vm.sandbox!, expired: sandboxExpired(vm.sandbox!) })),
      runs: this.jobs.list(),
      persistenceError: this.jobs.persistenceError,
    };
  }
  /**
   * 入口 / Entry: Sandboxes.create.
   * 功能：在创建、执行并控制临时沙箱中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.view(vm.id)` 供上层消费（`Sandboxes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Sandboxes`; this entry produces `this.view(vm.id)` for its caller. Module context: Creates/runs/controls temporary sandboxes, coordinating expiration cleanup and artifact collection.
   * 处理：通过 `sandboxCreateSchema.parse`, `this.machines.create`, `this.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `sandboxCreateSchema.parse`, `this.machines.create`, `this.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.view(vm.id)`.
   * 副作用 / Effects: `this.machines.create`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; 异常 / errors `new AppError('服务正在关闭', 503)`.
   */
  async create(input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const { network, lifetimeMinutes, onExpire, storage, ...config } = sandboxCreateSchema.parse(input);
    const vm = await this.machines.create(
      { ...config, template: 'none', forwards: [] },
      {
        network,
        onExpire,
        ...(storage ? { storage } : {}),
        expiresAt: new Date(Date.now() + lifetimeMinutes * 60_000).toISOString(),
      },
    );
    return this.view(vm.id);
  }
  /**
   * 入口 / Entry: Sandboxes.control.
   * 功能：在创建、执行并控制临时沙箱中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ok: true as const }` 供上层消费（`Sandboxes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Sandboxes`; this entry produces `{ ok: true as const }` for its caller. Module context: Creates/runs/controls temporary sandboxes, coordinating expiration cleanup and artifact collection.
   * 处理：通过 `this.get`, `this.busy.has`, `this.busy.add`, `this.available` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.get`, `this.busy.has`, `this.busy.add`, `this.available`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.machines.records.has(id)`; `action === 'destroy' && this.machines.records.has(id)`.
   * 输入 / Inputs: id: string; action: 'start' | 'stop' | 'destroy'
   * 输出 / Returns: `{ ok: true as const }`.
   * 副作用 / Effects: `this.busy.add`; `this.machines.start`; `this.machines.delete`; `this.busy.delete`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.busy.has(id)`; `action === 'start'`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('另一项沙箱操作正在进行', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.busy.delete(id);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.busy.delete(id);`; these steps also apply to exceptional exits.
   */
  async control(id: string, action: 'start' | 'stop' | 'destroy', expectedCreatedAt?: string) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const original = this.get(id), createdAt = expectedCreatedAt ?? original.createdAt;
    /** 每个清理边界核对原沙箱，拒绝同标识的替代资源。 Check the original sandbox at cleanup boundaries and reject replacements. */
    const current = () => {
      const value = this.machines.records.get(id);
      if (value && value.createdAt !== createdAt) throw new AppError('沙箱身份已变化，拒绝操作替代资源', 409);
      return value;
    };
    current();
    if (this.busy.has(id)) throw new AppError('另一项沙箱操作正在进行', 409);
    this.busy.add(id);
    try {
      if (action === 'start') {
        this.available(id);
        if (this.jobs.view(id)?.status === 'running') throw new AppError('沙箱任务正在执行', 409);
        await withOperationCheck(async () => { current(); }, () => this.machines.start(id));
      } else {
        this.jobs.cancel(id);
        await this.jobs.wait(id);
        if (current()) {
          await withOperationCheck(async () => { current(); }, () => this.machines.terminateSandbox(id));
          if (action === 'destroy' && current())
            await withOperationCheck(async () => { current(); }, () => this.machines.delete(id));
        }
      }
      return { ok: true as const };
    } finally {
      this.busy.delete(id);
    }
  }
  /**
   * 入口 / Entry: Sandboxes.run.
   * 功能：登记有期限的沙箱任务，准备实例、执行命令并收集产物或结束临时运行。
   * Purpose: Registers deadline-bound sandbox work, prepares the VM, executes commands and collects artifacts or terminates temporary runtime.
   * 设计：沙箱到期和实例锁定取消任务，执行捕获原 Live 身份；失败与清理证据分别记录，不把取消视为资源退出。
   * Design: Expiry/lockdown cancel work against original Live identity; failure and cleanup evidence remain distinct because cancellation is not exit proof.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `job`.
   * 副作用 / Effects: `this.jobs.start`.
   * 拒绝 / Refusals: 条件 / conditions `this.busy.has(id)`; `['paused', 'stopping'].includes(this.machines.state(id))`; 异常 / errors `new AppError('另一项沙箱操作正在进行', 409)`; `new AppError('请先停止沙箱后再执行命令', 409)`.
   */
  run(id: string, input: unknown) {
    const vm = this.available(id);
    const config = sandboxRunSchema.parse(input);
    if (this.busy.has(id)) throw new AppError('另一项沙箱操作正在进行', 409);
    if (['paused', 'stopping'].includes(this.machines.state(id)))
      throw new AppError('请先停止沙箱后再执行命令', 409);
    const execution: SandboxExecution = {
      command: config.command,
      cwd: config.cwd,
      timeoutSeconds: config.timeoutSeconds,
      requestedArtifacts: config.artifacts,
      artifacts: [],
      timings: {},
    };
    /**
     * 入口 / Entry: Sandboxes.run.callback@159.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: log; signal; update
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `update`; `this.machines.start`; `setTimeout`; `AbortSignal.any`; `this.machines.exec`; 更新 / updates `runtime`, `execution.exitCode`, `execution.outcome`, `execution.timings[phase]`.
     * 拒绝 / Refusals: 条件 / conditions `state !== 'starting' || Date.now() >= bootDeadline`; `synced.code !== 0`; `result.code !== 0`; 异常 / errors `new AppError(this.machines.get(id).lastError || '沙箱启动失败，请查看实例启动日志', 409)`; `new AppError('沙箱磁盘同步失败')`.
     * 收尾：退出 try 区域时始终执行 `execution.timings[phase] = Math.round(performance.now() - phaseAt);`; `const shutdown = performance.now();`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `execution.timings[phase] = Math.round(performance.now() - phaseAt);`; `const shutdown = performance.now();`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `if (!signal.aborted && sandboxExpired(vm.sandbox)) { execution.outcome = 'expired'; throw new AppError('沙箱已到期，虚拟机已终止', 409, '…`; `execution.outcome ||= signal.aborted ? 'cancelled' : 'failed';`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (!signal.aborted && sandboxExpired(vm.sandbox)) { execution.outcome = 'expired'; throw new AppError('沙箱已到期，虚拟机已终止', 409, '…`; `execution.outcome ||= signal.aborted ? 'cancelled' : 'failed';`; these statements determine whether a failure is absorbed or rejected again.
     */
    const job: JobView = this.jobs.start(
      id,
      async (log, signal, update) => {
        let runtime: ReturnType<Machines['live']['get']>;
        const started = performance.now();
        let phase: 'bootMs' | 'commandMs' | 'artifactsMs' = 'bootMs';
        let phaseAt = started;
        /**
         * 入口 / Entry: Sandboxes.run.advance.
         * 功能：在创建、执行并控制临时沙箱中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `execution.timings[phase]`（`Sandboxes`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `Sandboxes`; the outcome is recorded in `execution.timings[phase]`. Module context: Creates/runs/controls temporary sandboxes, coordinating expiration cleanup and artifact collection.
         * 处理：通过 `performance.now`, `update` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `performance.now`, `update`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: next: typeof phase; label: string
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `update`; 更新 / updates `execution.timings[phase]`, `phase`, `phaseAt`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const advance = (next: typeof phase, label: string) => {
          execution.timings[phase] = Math.round(performance.now() - phaseAt);
          phase = next;
          phaseAt = performance.now();
          update(label);
        };
        try {
          signal.throwIfAborted();
          this.available(id);
          log('工作目录：' + config.cwd + '\n命令：' + config.command + '\n');
          if (vm.sandbox.storage === 'discard-on-stop')
            log('临时 COW 工作区：停止时丢弃磁盘写入，仅保留日志和已提取产物。\n');
          update('启动沙箱');
          await this.machines.start(id);
          runtime = this.machines.live.get(id);
          const bootDeadline = Date.now() + BOOT_TIMEOUT_MS;
          while (this.machines.state(id) !== 'running') {
            signal.throwIfAborted();
            this.available(id);
            const state = this.machines.state(id);
            if (state !== 'starting' || Date.now() >= bootDeadline)
              throw new AppError(this.machines.get(id).lastError || '沙箱启动失败，请查看实例启动日志', 409);
            await delay(100, undefined, { signal });
          }
          this.available(id);
          signal.throwIfAborted();
          advance('commandMs', '执行命令');
          const remaining = Date.parse(vm.sandbox.expiresAt) - Date.now();
          const timeoutMs = Math.max(1, Math.min(config.timeoutSeconds * 1000, remaining));
          const timeout = new AbortController();
          const timer = setTimeout(() => timeout.abort(), timeoutMs);
          const combined = AbortSignal.any([signal, timeout.signal]);
          try {
            // 输入与命令属于同一次启动，停止即丢弃。 Inputs and command share one boot; discard-on-stop remains unchanged.
            if (config.inputFiles) await stageSandboxInputs(this.machines, id, config.inputFiles, combined);
            // All script text is passed to the guest shell. Never evaluate it on the host.
            const result = await this.machines.exec(
              id,
              'cd ' + quote(config.cwd) + ' && exec sh -c ' + quote(config.command),
              timeoutMs,
              combined,
              log,
            );
            execution.exitCode = result.code;
            advance('artifactsMs', '同步磁盘与保存产物');
            log('\n退出码：' + result.code + '\n');
            // Flush completed file writes before powering off, within the same host deadline.
            const synced = await this.machines.exec(id, 'sync', Math.min(3000, timeoutMs), combined);
            if (synced.code !== 0) throw new AppError('沙箱磁盘同步失败');
            await this.artifacts.collect(
              id,
              job.id!,
              config.cwd,
              config.artifacts,
              (artifact) => {
                execution.artifacts.push(artifact);
                update('已保存产物：' + artifact.path);
              },
              combined,
            );
            if (result.code !== 0) throw new AppError('命令执行失败，退出码 ' + result.code);
            update('关闭沙箱');
          } catch (error) {
            if (timeout.signal.aborted && !signal.aborted) {
              execution.outcome = 'timeout';
              throw new AppError('沙箱命令执行超时，已终止虚拟机', 408);
            }
            throw error;
          } finally {
            clearTimeout(timer);
          }
        } catch (error) {
          if (!signal.aborted && sandboxExpired(vm.sandbox)) {
            execution.outcome = 'expired';
            throw new AppError('沙箱已到期，虚拟机已终止', 409, 'SANDBOX_EXPIRED');
          }
          execution.outcome ||= signal.aborted ? 'cancelled' : 'failed';
          throw error;
        } finally {
          execution.timings[phase] = Math.round(performance.now() - phaseAt);
          const shutdown = performance.now();
          // Stopping the entire VM also terminates detached or re-parented guest processes.
          try {
            if (runtime && this.machines.live.get(id) === runtime) await this.machines.terminateSandbox(id);
            execution.outcome ||= 'success';
          } catch (error) {
            execution.outcome = 'failed';
            throw error;
          } finally {
            execution.timings.shutdownMs = Math.round(performance.now() - shutdown);
            execution.timings.totalMs = Math.round(performance.now() - started);
          }
          await this.artifacts.prune(this.jobs.list());
        }
      },
      { vmId: id, title: vm.name + ' · 沙箱命令', action: 'sandbox-run', execution },
    );
    return job;
  }
  /**
   * 入口 / Entry: Sandboxes.close.
   * 功能：在创建、执行并控制临时沙箱中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`Sandboxes`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Sandboxes`; the outcome is recorded in `this.closed`. Module context: Creates/runs/controls temporary sandboxes, coordinating expiration cleanup and artifact collection.
   * 处理：通过 `this.jobs.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.jobs.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.jobs.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    await this.jobs.close();
  }
}
