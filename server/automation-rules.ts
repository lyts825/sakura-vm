/**
 * 模块职责：保存事件自动化与 Runbook 执行记录；动作成功但回执写入失败时保留待核对状态。
 * Module purpose: Persists event rules and Runbook execution state; successful effects with lost persistence retain pending evidence.
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { matchesWebhook } from './webhooks.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
import {
  webhookAlertKinds,
  webhookJobStatuses,
  webhookTypes,
  type WebhookEvent,
  type WebhookFilter,
} from '../shared/webhooks.ts';

const hour = 3600_000;
const limits = { rules: 24, history: 300, observed: 20_000, dailyActions: 25 };
/**
 * 入口 / Entry: unique.
 * 功能：在保存事件自动化与 Runbook 执行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `z.array(item).max(max) .refine((items) => new Set(items).size === items.length, '筛选值不能重复')` 供上层消费（`automation-rules.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `automation-rules.ts`; this entry produces `z.array(item).max(max) .refine((items) => new Set(items).size === items.length, '筛选值不能重复')` for its caller. Module context: Persists event rules and Runbook execution state; successful effects with lost persistence retain pending evidence.
 * 处理：通过 `z.array().max().refine`, `z.array().max`, `z.array` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `z.array().max().refine`, `z.array().max`, `z.array`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: item: T; max: number
 * 输出 / Returns: `z.array(item).max(max) .refine((items) => new Set(items).size === items.length, '筛选值不能重复')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const unique = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max)
  .refine((items) => new Set(items).size === items.length, '筛选值不能重复');
const filterSchema = z.object({
  types: unique(z.enum(webhookTypes), 2).min(1),
  vmIds: unique(z.uuid(), 50).default([]),
  projectIds: unique(z.string().min(1).max(64), 50).default([]),
  tags: unique(z.string().trim().min(1).max(24), 12).default([]),
  statuses: unique(z.enum(webhookJobStatuses), 4).default([]),
  kinds: unique(z.enum(webhookAlertKinds), 7).default([]),
}).strict();
const runbookStepSchema = z.object({
  name: z.string().trim().min(1).max(80),
  command: z.string().trim().min(1).max(2048),
  timeout: z.number().int().min(1).max(120),
}).strict();
export type RunbookStep = z.infer<typeof runbookStepSchema>;
const ruleInput = z.object({
  name: z.string().trim().min(1).max(64),
  enabled: z.boolean(),
  previewOnly: z.boolean().default(true),
  filter: filterSchema,
  action: z.enum(['start', 'stop', 'suspend', 'resume', 'runbook']),
  steps: z.array(runbookStepSchema).max(8).default([]),
  cooldownSeconds: z.number().int().min(60).max(86400).default(300),
}).strict().superRefine((rule, context) => {
  if (rule.action === 'runbook' && rule.steps.length === 0)
    context.addIssue({ code: 'custom', path: ['steps'], message: '自动修复至少需要一个步骤' });
  if (rule.action !== 'runbook' && rule.steps.length)
    context.addIssue({ code: 'custom', path: ['steps'], message: '实例操作不能包含 Runbook 步骤' });
  if (rule.steps.reduce((sum, step) => sum + step.timeout, 0) > 600)
    context.addIssue({ code: 'custom', path: ['steps'], message: '步骤总超时不能超过 600 秒' });
});
const ruleSchema = ruleInput.safeExtend({
  id: z.uuid(), version: z.number().int().positive(), createdAt: z.number().int().nonnegative(),
  activeSince: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}).strict();
const executionSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), ruleId: z.uuid(), ruleVersion: z.number().int().positive(),
  eventId: z.string().regex(/^[a-f0-9]{64}$/), vmId: z.uuid().optional(), action: ruleInput.shape.action,
  status: z.enum(['preview', 'pending', 'done', 'failed', 'skipped']),
  startedAt: z.number().int().nonnegative(), finishedAt: z.number().int().nonnegative().optional(),
  reason: z.string().max(300).optional(),
  steps: z.array(z.object({ name: z.string(), code: z.number().int() }).strict()).max(8).optional(),
}).strict();
const stateSchema = z.object({
  version: z.literal(1), rules: z.array(ruleSchema).max(limits.rules),
  executions: z.array(executionSchema).max(limits.history),
  observed: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.number().int().nonnegative()),
  lastAttempt: z.record(z.uuid(), z.number().int().nonnegative()).default({}),
  daily: z.record(z.uuid(), z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    count: z.number().int().nonnegative().max(limits.dailyActions) }).strict()),
}).strict();
type State = z.infer<typeof stateSchema>;
export type AutomationRule = State['rules'][number];
export type AutomationExecution = State['executions'][number];
export type AutomationView = {
  rules: AutomationRule[]; executions: AutomationExecution[]; error?: string; collecting: boolean;
  limits: typeof limits;
};
/**
 * 签名 / Signature: RunbookExecutor.RunbookExecutor.
 * 功能：为保存事件自动化与 Runbook 执行记录声明 RunbookExecutor 的输入与结果契约，所属容器为 RunbookExecutor。
 * Purpose: Declares the input/result contract for RunbookExecutor in RunbookExecutor. Module responsibility: Persists event rules and Runbook execution state; successful effects with lost persistence retain pending evidence.
 * 输入 / Inputs: id: string; steps: RunbookStep[]; projectId: string | undefined; signal: AbortSignal
 * 输出 / Returns: Promise<{ code: number; results?: Array<{ code: number; skipped?: boolean }> }>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
export type RunbookExecutor = (id: string, steps: RunbookStep[], projectId: string | undefined,
  signal: AbortSignal) => Promise<{ code: number; results?: Array<{ code: number; skipped?: boolean }> }>;
export const automationRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('save'), id: z.uuid().optional(), version: z.number().int().positive().optional(),
    rule: ruleInput, approval: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  z.object({ operation: z.literal('remove'), id: z.uuid(), version: z.number().int().positive() }).strict(),
  z.object({ operation: z.literal('preview'), id: z.uuid() }).strict(),
]);
/**
 * 入口 / Entry: digest.
 * 功能：在保存事件自动化与 Runbook 执行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(text).digest('hex')` 供上层消费（`automation-rules.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `automation-rules.ts`; this entry produces `createHash('sha256').update(text).digest('hex')` for its caller. Module context: Persists event rules and Runbook execution state; successful effects with lost persistence retain pending evidence.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: text: string
 * 输出 / Returns: `createHash('sha256').update(text).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
/**
 * 入口 / Entry: defaultState.
 * 功能：从当前输入或状态计算 `({ version: 1, rules: [], executions: [], observed: {}, lastAttempt: {}, daily: {}, })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: 1, rules: [], executions: [], observed: {}, lastAttempt: {}, daily: {}, })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: State；结果来自 / values from `({ version: 1, rules: [], executions: [], observed: {}, lastAttempt: {}, daily: {}, })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const defaultState = (): State => ({
  version: 1, rules: [], executions: [], observed: {}, lastAttempt: {}, daily: {},
});

export class AutomationRules {
  private readonly approvalKey = randomBytes(32);
  private readonly activeRunbooks = new Set<AbortController>();
  private state: State = defaultState();
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ScheduleHandle;
  private pending?: Promise<void>;
  private closed = false;
  private error?: string;
  /**
   * 入口 / Entry: AutomationRules.constructor.
   * 功能：建立 AutomationRules 的保存事件自动化与 Runbook 执行记录上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the AutomationRules context for this module's responsibility: Persists event rules and Runbook execution state; successful effects with lost persistence retain pending evidence. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: source: () => Promise<WebhookEvent[]>; machines: Pick<Machines, 'get' | 'requireUnlocked' | 'start' | 'stop' | 'suspend' | 'resume'> &…; file: default=join(DATA, 'automation-rules.json'); now: default=Date.now; blocked: () => boolean default=() => false; mutation: (delta: number) => void default=() => {}; runbook: RunbookExecutor optional
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private source: () => Promise<WebhookEvent[]>,
    private machines: Pick<Machines, 'get' | 'requireUnlocked' | 'start' | 'stop' | 'suspend' | 'resume'> &
      Partial<Pick<Machines, 'on' | 'off'>>,
    private file = join(DATA, 'automation-rules.json'),
    private now = Date.now,
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    private runbook?: RunbookExecutor,
  ) {}
  /**
   * 入口 / Entry: AutomationRules.approval.
   * 功能：在保存事件自动化与 Runbook 执行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHmac('sha256', this.approvalKey) .update(JSON.stringify({ id, version, reviewed })).digest('hex')` 供上层消费（`AutomationRules`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AutomationRules`; this entry produces `createHmac('sha256', this.approvalKey) .update(JSON.stringify({ id, version, reviewed })).digest('hex')` for its caller. Module context: Persists event rules and Runbook execution state; successful effects with lost persistence retain pending evidence.
   * 处理：通过 `createHmac().update().digest`, `createHmac().update`, `createHmac` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `createHmac().update().digest`, `createHmac().update`, `createHmac`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; version: number; rule: z.infer<typeof ruleInput>
   * 输出 / Returns: `createHmac('sha256', this.approvalKey) .update(JSON.stringify({ id, version, reviewed })).digest('hex')`.
   * 副作用 / Effects: `createHmac().update().digest`; `createHmac().update`; `createHmac`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private approval(id: string, version: number, rule: z.infer<typeof ruleInput>) {
    const reviewed = { name: rule.name, filter: rule.filter, action: rule.action,
      steps: rule.steps, cooldownSeconds: rule.cooldownSeconds };
    return createHmac('sha256', this.approvalKey)
      .update(JSON.stringify({ id, version, reviewed })).digest('hex');
  }
  /**
   * 入口 / Entry: AutomationRules.init.
   * 功能：在保存事件自动化与 Runbook 执行记录中，初始化并核对当前领域状态；处理结果记录到 `this.state`, `this.timer`（`AutomationRules`）。
   * Purpose: Initializes and verifies current domain state in `AutomationRules`; the outcome is recorded in `this.state`, `this.timer`. Module context: Persists event rules and Runbook execution state; successful effects with lost persistence retain pending evidence.
   * 处理：通过 `stat().catch`, `stat`, `info.isFile`, `stateSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stat().catch`, `stat`, `info.isFile`, `stateSchema.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `schedule`.
   * 输入 / Inputs: schedule: default=true
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.state`, `this.timer`.
   * 拒绝 / Refusals: 条件 / conditions `info && (!info.isFile() || info.size > 4 * 1024 ** 2)`; `new Set(this.state.rules.map((rule) => rule.id)).size !== this.state.rules.length || Object.keys(this.state.observed).length …`; 异常 / errors `new AppError('事件自动化存储类型或大小无效')`; `new AppError('事件自动化存储记录无效')`.
   */
  async init(schedule = true) {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 4 * 1024 ** 2))
      throw new AppError('事件自动化存储类型或大小无效');
    this.state = stateSchema.parse(await readStore(this.file, defaultState));
    if (new Set(this.state.rules.map((rule) => rule.id)).size !== this.state.rules.length ||
        Object.keys(this.state.observed).length > limits.observed ||
        Object.keys(this.state.lastAttempt).length > limits.rules)
      throw new AppError('事件自动化存储记录无效');
    if (schedule) {
      this.timer = scheduler.register({ owner: 'core:automation-rules', label: '事件自动化规则', intervalMs: 5000,
        immediate: true, overlap: 'skip', backoff: { initialMs: 5000, maxMs: 60000 },
        /**
         * 入口 / Entry: AutomationRules.init.run.
         * 功能：把本层请求转交 `this.tick`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `this.tick` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `this.tick()`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        run: () => this.tick() });
    }
  }
  /**
   * 入口 / Entry: AutomationRules.view.
   * 功能：在保存事件自动化与 Runbook 执行记录中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ rules: structuredClone(this.state.rules), executions: structuredClone(this.state.executions).reverse(), error: this.error, …` 供上层消费（`AutomationRules`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `AutomationRules`; this entry produces `{ rules: structuredClone(this.state.rules), executions: structuredClone(this.state.executions).reverse(), error: this.error, …` for its caller. Module context: Persists event rules and Runbook execution state; successful effects with lost persistence retain pending evidence.
   * 处理：通过 `structuredClone`, `structuredClone().reverse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `structuredClone`, `structuredClone().reverse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: AutomationView；结果来自 / values from `{ rules: structuredClone(this.state.rules), executions: structuredClone(this.state.executions).reverse(), error: this.error, …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(): AutomationView {
    return {
      rules: structuredClone(this.state.rules),
      executions: structuredClone(this.state.executions).reverse(),
      error: this.error, collecting: !!this.pending, limits,
    };
  }
  /**
   * 入口 / Entry: AutomationRules.serial.
   * 功能：在保存事件自动化与 Runbook 执行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`AutomationRules`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AutomationRules`; this entry produces `task` for its caller. Module context: Persists event rules and Runbook execution state; successful effects with lost persistence retain pending evidence.
   * 处理：通过 `this.queue.catch().then`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.queue.catch().then`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `task`.
   * 副作用 / Effects: 更新 / updates `this.queue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.catch(() => {}).then(work);
    this.queue = task;
    return task;
  }
  /**
   * 入口 / Entry: AutomationRules.change.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: edit: (next: State) => T
   * 输出 / Returns: Promise<T>；结果来自 / values from `this.serial(async () => { const next = structuredClone(this.state); const result = edit(next); next.executions = next.executi…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async change<T>(edit: (next: State) => T): Promise<T> {
    /**
     * 入口 / Entry: AutomationRules.change.callback@151.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `result`.
     * 副作用 / Effects: `next.executions.slice`; `writeStore`; 更新 / updates `next.executions`, `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `Object.keys(next.observed).length > limits.observed`; 异常 / errors `new AppError('事件自动化去重窗口已满，请稍后重试', 409)`.
     */
    return this.serial(async () => {
      const next = structuredClone(this.state);
      const result = edit(next);
      next.executions = next.executions.slice(-limits.history);
      for (const [key, at] of Object.entries(next.observed))
        if (at < this.now() - 48 * hour) delete next.observed[key];
      if (Object.keys(next.observed).length > limits.observed)
        throw new AppError('事件自动化去重窗口已满，请稍后重试', 409);
      if (JSON.stringify(next) !== JSON.stringify(this.state)) await writeStore(this.file, next);
      this.state = next;
      return result;
    });
  }
  /**
   * 入口 / Entry: AutomationRules.configure.
   * 功能：在保存事件自动化与 Runbook 执行记录中，校验并提交领域状态变更；本入口产生 `{ rule, ...(rule.action === 'runbook' ? { approval: this.approval(rule.id, rule.version, rule) } : {}), matches: events.filte…` / `this.view()` 供上层消费（`AutomationRules`）。
   * Purpose: Validates and commits a domain state change in `AutomationRules`; this entry produces `{ rule, ...(rule.action === 'runbook' ? { approval: this.approval(rule.id, rule.version, rule) } : {}), matches: events.filte…` / `this.view()` for its caller. Module context: Persists event rules and Runbook execution state; successful effects with lost persistence retain pending evidence.
   * 处理：通过 `this.blocked`, `automationRequest.parse`, `this.state.rules.find`, `this.source` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `automationRequest.parse`, `this.state.rules.find`, `this.source`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `{ rule, ...(rule.action === 'runbook' ? { approval: this.approval(rule.id, rule.version, rule) } : {}), matches: events.filte…`; `this.view()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; `value.operation === 'preview'`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.mutation(-1);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.mutation(-1);`; these steps also apply to exceptional exits.
   */
  async configure(input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = automationRequest.parse(input);
    if (value.operation === 'preview') {
      const rule = this.state.rules.find((candidate) => candidate.id === value.id);
      if (!rule) throw new AppError('自动化规则不存在', 404);
      const events = await this.source();
      return { rule, ...(rule.action === 'runbook' ?
        { approval: this.approval(rule.id, rule.version, rule) } : {}),
        matches: events.filter((event) => event.type !== 'test' &&
        matchesWebhook(rule.filter, event)).slice(-10).reverse().map((event) => ({
          event, targetVmId: event.vmId || null, action: rule.action, wouldExecute: rule.enabled &&
            !rule.previewOnly && !!event.vmId,
        })) };
    }
    this.mutation(1);
    try {
      /**
       * 入口 / Entry: AutomationRules.configure.callback@182.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
       * 输入 / Inputs: next
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `next.rules.splice`; `next.rules.push`; 更新 / updates `next.rules[index]`.
       * 拒绝 / Refusals: 条件 / conditions `value.operation === 'remove'`; `index < 0`; `next.rules[index].version !== value.version`; 异常 / errors `new AppError('自动化规则不存在', 404)`; `new AppError('规则已变化，请刷新', 409)`.
       */
      await this.change((next) => {
        const index = next.rules.findIndex((rule) => rule.id === value.id);
        if (value.operation === 'remove') {
          if (index < 0) throw new AppError('自动化规则不存在', 404);
          if (next.rules[index].version !== value.version) throw new AppError('规则已变化，请刷新', 409);
          next.rules.splice(index, 1);
          delete next.daily[value.id];
          delete next.lastAttempt[value.id];
          return;
        }
        if (value.id && index < 0) throw new AppError('自动化规则不存在', 404);
        if (index >= 0 && next.rules[index].version !== value.version)
          throw new AppError('规则已变化，请刷新', 409);
        if (index < 0 && next.rules.length >= limits.rules) throw new AppError('最多保存 24 条自动化规则');
        const time = this.now();
        const previous = index >= 0 ? next.rules[index] : undefined;
        if (value.rule.action === 'runbook' && !value.rule.previewOnly) {
          if (!this.runbook) throw new AppError('自动修复执行器不可用', 503);
          if (!previous || !previous.previewOnly || previous.action !== 'runbook' || !value.approval)
            throw new AppError('请先保存预览规则，检查步骤后再批准执行', 409);
          const expected = Buffer.from(this.approval(previous.id, previous.version, value.rule), 'hex');
          const provided = Buffer.from(value.approval, 'hex');
          if (!timingSafeEqual(expected, provided))
            throw new AppError('规则内容已变化，请保存并重新预览后批准', 409);
        }
        const rule = {
          ...value.rule, id: previous?.id || randomUUID(), version: (previous?.version || 0) + 1,
          createdAt: previous?.createdAt || time, activeSince: time, updatedAt: time,
        };
        if (index >= 0) next.rules[index] = rule;
        else next.rules.push(rule);
      });
      return this.view();
    } finally {
      this.mutation(-1);
    }
  }
  /**
   * 入口 / Entry: AutomationRules.tick.
   * 功能：在保存事件自动化与 Runbook 执行记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` / `this.pending` 供上层消费（`AutomationRules`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AutomationRules`; this entry produces `void` / `this.pending` for its caller. Module context: Persists event rules and Runbook execution state; successful effects with lost persistence retain pending evidence.
   * 处理：通过 `this.blocked`, `this.state.rules.some`, `this.mutation`, `this.collect().catch().finally` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.state.rules.some`, `this.mutation`, `this.collect().catch().finally`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || this.blocked()`; `!this.state.rules.some((rule) => rule.enabled)`; `this.pending`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `void`; `this.pending`; `task`.
   * 副作用 / Effects: 更新 / updates `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async tick(): Promise<void> {
    if (this.closed || this.blocked()) return;
    if (!this.state.rules.some((rule) => rule.enabled)) return;
    if (this.pending) return this.pending;
    this.mutation(1);
    const task = this.collect().catch(() => {
      this.error = '自动化事件采集或存储失败，请检查数据目录。';
    }).finally(() => {
      this.pending = undefined;
      this.mutation(-1);
    });
    this.pending = task;
    return task;
  }
  /**
   * 入口 / Entry: AutomationRules.collect.
   * 功能：从最近事件选择匹配规则，去重登记执行并触发实例动作或有期限的 Runbook。
   * Purpose: Selects matching recent events, records deduplicated executions and runs VM actions or deadline-bound Runbooks.
   * 设计：动作前保存 pending；动作成功而结束写入失败时保留待核对记录，避免重放已发生的外部效果。
   * Design: Pending intent is durable before effects; a lost terminal write after success retains evidence rather than replaying the action.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.state.executions.some`; `this.machines.start`; `this.machines.stop`; `this.activeRunbooks.add`; `this.activeRunbooks.delete`; 更新 / updates `this.error`, `stepResults`.
   * 拒绝 / Refusals: 条件 / conditions `this.blocked() || this.closed`; `!this.runbook`; `outcome.code !== 0`; 异常 / errors `new AppError('操作已停止', 409)`; `new AppError('自动修复执行器不可用', 503)`.
   * 收尾：退出 try 区域时始终执行 `this.machines.off?.('incident-lockdown', lockdown);`; `this.activeRunbooks.delete(controller);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.machines.off?.('incident-lockdown', lockdown);`; `this.activeRunbooks.delete(controller);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `await this.change((next) => { const entry = next.executions.find((item) => item.id === id); if (entry) { entry.status = 'fail…`; `continue;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await this.change((next) => { const entry = next.executions.find((item) => item.id === id); if (entry) { entry.status = 'fail…`; `continue;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async collect() {
    if (!this.state.rules.some((rule) => rule.enabled)) return;
    this.error = undefined;
    const events = (await this.source()).filter((event) => event.type !== 'test' &&
      Date.parse(event.occurredAt) >= this.now() - 24 * hour &&
      Date.parse(event.occurredAt) <= this.now()).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    for (const event of events) {
      if (this.closed || this.blocked()) break;
      for (const rule of this.state.rules) {
        if (!rule.enabled || Date.parse(event.occurredAt) < rule.activeSince ||
            !matchesWebhook(rule.filter as WebhookFilter, event)) continue;
        const key = digest(`${rule.id}:${rule.version}:${event.id}`);
        if (Object.hasOwn(this.state.observed, key)) continue;
        const lastAttempt = this.state.lastAttempt[rule.id];
        const day = new Date(this.now()).toISOString().slice(0, 10);
        const daily = this.state.daily[rule.id];
        const count = daily?.day === day ? daily.count : 0;
        const status = !event.vmId ? 'skipped' : rule.previewOnly ? 'preview' :
          lastAttempt !== undefined && this.now() - lastAttempt < rule.cooldownSeconds * 1000 ? 'skipped' :
            count >= limits.dailyActions ? 'skipped' : 'pending';
        const id = digest(`${rule.id}:${rule.version}:${event.id}`);
        const record: AutomationExecution = {
          id, ruleId: rule.id, ruleVersion: rule.version, eventId: event.id,
          ...(event.vmId ? { vmId: event.vmId } : {}), action: rule.action,
          status,
          startedAt: this.now(),
          ...(status === 'skipped' ? { reason: !event.vmId ? '事件没有实例目标' :
            '触发过于频繁或已达到每日操作上限' } : {}),
          ...(status !== 'pending' ? { finishedAt: this.now() } : {}),
        };
        /**
         * 入口 / Entry: AutomationRules.collect.callback@263.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
         * 输入 / Inputs: next
         * 输出 / Returns: `void`.
         * 副作用 / Effects: `next.executions.push`; 更新 / updates `next.observed[key]`, `next.daily[rule.id]`, `next.lastAttempt[rule.id]`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        await this.change((next) => {
          if (Object.hasOwn(next.observed, key)) return;
          if (!next.rules.some((candidate) => candidate.id === rule.id &&
              candidate.version === rule.version && candidate.enabled)) return;
          next.observed[key] = this.now();
          next.executions.push(record);
          if (status === 'pending') {
            next.daily[rule.id] = { day, count: count + 1 };
            next.lastAttempt[rule.id] = this.now();
          }
        });
        if (!this.state.executions.some((item) => item.id === id)) continue;
        if (status !== 'pending') continue;
        const current = this.state.rules.find((candidate) => candidate.id === rule.id);
        if (!current?.enabled || current.previewOnly || current.version !== rule.version) {
          /**
           * 入口 / Entry: AutomationRules.collect.callback@278.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
           * 输入 / Inputs: next
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: `next.executions.find`; 更新 / updates `entry.status`, `entry.finishedAt`, `entry.reason`, `next.lastAttempt[rule.id]`.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          await this.change((next) => {
            const entry = next.executions.find((item) => item.id === id);
            if (entry) { entry.status = 'skipped'; entry.finishedAt = this.now();
              entry.reason = '规则已变更或停用'; }
            const counter = next.daily[rule.id];
            if (counter?.day === day && counter.count > 0) counter.count--;
            if (lastAttempt === undefined || !next.rules.some((item) => item.id === rule.id))
              delete next.lastAttempt[rule.id];
            else next.lastAttempt[rule.id] = lastAttempt;
          });
          continue;
        }
        let stepResults: Array<{ name: string; code: number }> | undefined;
        try {
          this.machines.get(event.vmId!);
          this.machines.requireUnlocked(event.vmId!);
          if (this.blocked() || this.closed) throw new AppError('操作已停止', 409);
          if (rule.action === 'start') await this.machines.start(event.vmId!);
          else if (rule.action === 'stop') await this.machines.stop(event.vmId!, false);
          else if (rule.action === 'suspend') await this.machines.suspend(event.vmId!);
          else if (rule.action === 'resume') await this.machines.resume(event.vmId!);
          else {
            if (!this.runbook) throw new AppError('自动修复执行器不可用', 503);
            const controller = new AbortController();
            /**
             * 入口 / Entry: AutomationRules.collect.lockdown.
             * 功能：在保存事件自动化与 Runbook 执行记录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`AutomationRules`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `AutomationRules`; the calls and state transitions below complete the operation. Module context: Persists event rules and Runbook execution state; successful effects with lost persistence retain pending evidence.
             * 处理：通过 `controller.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `controller.abort`; the branches below determine continuation, return or refusal.
             * 分支 / Branches: `target === event.vmId`.
             * 输入 / Inputs: target: string
             * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
             * 副作用 / Effects: `controller.abort`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            const lockdown = (target: string) => {
              if (target === event.vmId) controller.abort(new AppError('实例已进入应急锁定', 409));
            };
            this.activeRunbooks.add(controller);
            this.machines.on?.('incident-lockdown', lockdown);
            try {
              const outcome = await this.runbook(event.vmId!, rule.steps, event.projectId, controller.signal);
              stepResults = (outcome.results || []).slice(0, rule.steps.length).map((item, index) => ({
                name: rule.steps[index].name,
                code: item.skipped ? -1 : item.code,
              }));
              if (outcome.code !== 0) throw new AppError('自动修复步骤失败', 409);
            } finally {
              this.machines.off?.('incident-lockdown', lockdown);
              this.activeRunbooks.delete(controller);
            }
          }
        } catch (error) {
          await this.change((next) => {
            const entry = next.executions.find((item) => item.id === id);
            if (entry) {
              entry.status = 'failed'; entry.finishedAt = this.now();
              entry.reason = String((error as Error).message || error).slice(0, 300);
              if (stepResults) entry.steps = stepResults;
            }
          });
          continue;
        }
        // If this write fails after the VM action succeeded, leave a durable pending
        // record rather than claiming failure or executing the action again.
        await this.change((next) => {
          const entry = next.executions.find((item) => item.id === id);
          if (entry) {
            entry.status = 'done'; entry.finishedAt = this.now();
            if (stepResults) entry.steps = stepResults;
          }
        });
      }
    }
  }
  /**
   * 入口 / Entry: AutomationRules.close.
   * 功能：在保存事件自动化与 Runbook 执行记录中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`AutomationRules`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `AutomationRules`; the outcome is recorded in `this.closed`. Module context: Persists event rules and Runbook execution state; successful effects with lost persistence retain pending evidence.
   * 处理：通过 `controller.abort`, `this.timer.close`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `controller.abort`, `this.timer.close`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `controller.abort`; `this.timer.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    for (const controller of this.activeRunbooks) controller.abort();
    await this.timer?.close();
    await this.pending;
    await this.queue.catch(() => {});
  }
}
