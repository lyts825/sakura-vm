/**
 * 模块职责：收集并发送匹配事件的 Webhook，校验目标 URL 与配置并管理后台投递状态。
 * Module purpose: Collects/sends matching event hooks, validating target URLs/settings and owning scheduled delivery state.
 */
import { networkFor } from './network/index.ts';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import type { JobView } from '../shared/contracts/jobs.ts';
import type { AlertEvent } from './feature-suite.ts';
import {
  webhookTypes,
  webhookJobStatuses,
  webhookAlertKinds,
  type WebhookEvent,
  type WebhookFilter,
  type WebhookView,
  type WebhookDelivery,
} from '../shared/webhooks.ts';

const { fetch } = networkFor('core:webhooks');

const limits = { subscriptions: 16, pending: 500, history: 200, attempts: 5, sourceHours: 24 };
const hour = 3600000;
const time = z.number().finite().nonnegative();
const label = z.string().trim().min(1).max(24);
/**
 * 入口 / Entry: unique.
 * 功能：在收集并发送匹配事件的 Webhook中，执行此领域的具体处理步骤并返回其结果；本入口产生 `z .array(schema) .max(max) .refine((values) => new Set(values).size === values.length, '条目不能重复')` 供上层消费（`webhooks.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `webhooks.ts`; this entry produces `z .array(schema) .max(max) .refine((values) => new Set(values).size === values.length, '条目不能重复')` for its caller. Module context: Collects/sends matching event hooks, validating target URLs/settings and owning scheduled delivery state.
 * 处理：通过 `z.array().max().refine`, `z.array().max`, `z.array` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `z.array().max().refine`, `z.array().max`, `z.array`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: schema: T; max: number
 * 输出 / Returns: `z .array(schema) .max(max) .refine((values) => new Set(values).size === values.length, '条目不能重复')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const unique = <T extends z.ZodType>(schema: T, max: number) =>
  z
    .array(schema)
    .max(max)
    .refine((values) => new Set(values).size === values.length, '条目不能重复');
const filter = {
  types: unique(z.enum(webhookTypes), 2).min(1),
  vmIds: unique(z.uuid(), 50).default([]),
  projectIds: unique(z.string().min(1).max(64), 50).default([]),
  tags: unique(label, 12).default([]),
  statuses: unique(z.enum(webhookJobStatuses), 4).default([]),
  kinds: unique(z.enum(webhookAlertKinds), 7).default([]),
};
/**
 * 入口 / Entry: callback@47.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.string().max().refine / 使用 HTTPS 接收地址（本机测试可用 HTTP），不允许账号、查询参数或片段）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.string().max().refine / 使用 HTTPS 接收地址（本机测试可用 HTTP），不允许账号、查询参数或片段).
 * 输入 / Inputs: value
 * 输出 / Returns: `( !url.username && !url.password && !url.hash && !url.search && (url.protocol === 'https:' || (url.protocol === 'http:' && ['…`; `false`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return false;`; these statements determine whether a failure is absorbed or rejected again.
 */
const destination = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        !url.hash &&
        !url.search &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      );
    } catch {
      return false;
    }
  }, '使用 HTTPS 接收地址（本机测试可用 HTTP），不允许账号、查询参数或片段');
const subscriptionInput = z
  .object({
    name: z.string().trim().min(1).max(64),
    url: destination,
    enabled: z.boolean(),
    ...filter,
  })
  .strict();
export const eventSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    type: z.enum([...webhookTypes, 'test']),
    occurredAt: z.iso.datetime(),
    vmId: z.uuid().optional(),
    projectId: z.string().min(1).max(64).optional(),
    jobId: z.uuid().optional(),
    scope: z.string().min(1).max(64).optional(),
    status: z.enum(webhookJobStatuses).optional(),
    kind: z.enum(webhookAlertKinds).optional(),
    tags: unique(label, 12),
  })
  .strict();
const subscriptionSchema = subscriptionInput
  .extend({
    id: z.uuid(),
    version: z.number().int().positive(),
    createdAt: time,
    secret: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const deliverySchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    subscriptionId: z.uuid(),
    version: z.number().int().positive(),
    event: eventSchema,
    status: z.enum(['pending', 'sending', 'delivered', 'failed', 'cancelled']),
    attempts: z.number().int().min(0).max(limits.attempts),
    nextAttemptAt: time,
    updatedAt: time,
    httpStatus: z.number().int().min(100).max(599).optional(),
    error: z.string().max(200).optional(),
  })
  .strict();
const stateSchema = z
  .object({
    version: z.literal(1),
    subscriptions: z.array(subscriptionSchema).max(limits.subscriptions),
    deliveries: z.array(deliverySchema).max(limits.pending + limits.history),
    observed: z.record(z.string().regex(/^[a-f0-9]{64}$/), time),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
export const webhookRequest = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('save'),
      id: z.uuid().optional(),
      version: z.number().int().positive().optional(),
      subscription: subscriptionInput,
    })
    .strict(),
  z.object({ action: z.literal('remove'), id: z.uuid(), version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('rotate'), id: z.uuid(), version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('test'), id: z.uuid(), version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('retry'), id: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal('cancel'), id: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
/**
 * 入口 / Entry: digest.
 * 功能：在收集并发送匹配事件的 Webhook中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(value).digest('hex')` 供上层消费（`webhooks.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `webhooks.ts`; this entry produces `createHash('sha256').update(value).digest('hex')` for its caller. Module context: Collects/sends matching event hooks, validating target URLs/settings and owning scheduled delivery state.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `createHash('sha256').update(value).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
/**
 * 入口 / Entry: waiting.
 * 功能：从当前输入或状态计算 `['pending', 'sending'].includes(delivery.status)`，供调用方后续验证或使用。
 * Purpose: Computes `['pending', 'sending'].includes(delivery.status)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: delivery: WebhookDelivery
 * 输出 / Returns: `['pending', 'sending'].includes(delivery.status)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const waiting = (delivery: WebhookDelivery) => ['pending', 'sending'].includes(delivery.status);
/**
 * 入口 / Entry: matchesWebhook.
 * 功能：在收集并发送匹配事件的 Webhook中，执行此领域的具体处理步骤并返回其结果；本入口产生 `( event.type !== 'test' && rule.types.includes(event.type) && (!rule.vmIds.length || (!!event.vmId && rule.vmIds.includes(eve…` 供上层消费（`webhooks.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `webhooks.ts`; this entry produces `( event.type !== 'test' && rule.types.includes(event.type) && (!rule.vmIds.length || (!!event.vmId && rule.vmIds.includes(eve…` for its caller. Module context: Collects/sends matching event hooks, validating target URLs/settings and owning scheduled delivery state.
 * 处理：通过 `rule.types.includes`, `rule.vmIds.includes`, `rule.projectIds.includes`, `rule.tags.every` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `rule.types.includes`, `rule.vmIds.includes`, `rule.projectIds.includes`, `rule.tags.every`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: rule: WebhookFilter; event: WebhookEvent
 * 输出 / Returns: `( event.type !== 'test' && rule.types.includes(event.type) && (!rule.vmIds.length || (!!event.vmId && rule.vmIds.includes(eve…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function matchesWebhook(rule: WebhookFilter, event: WebhookEvent) {
  return (
    event.type !== 'test' &&
    rule.types.includes(event.type) &&
    (!rule.vmIds.length || (!!event.vmId && rule.vmIds.includes(event.vmId))) &&
    (!rule.projectIds.length || (!!event.projectId && rule.projectIds.includes(event.projectId))) &&
    rule.tags.every((tag) => event.tags.includes(tag)) &&
    (event.type !== 'job.finished' ||
      !rule.statuses.length ||
      (!!event.status && rule.statuses.includes(event.status))) &&
    (event.type !== 'alert.raised' || !rule.kinds.length || (!!event.kind && rule.kinds.includes(event.kind)))
  );
}

/** A fixed metadata allowlist; commands, titles, messages, values and logs never enter the payload. */
/**
 * 入口 / Entry: collectWebhookEvents.
 * 功能：在收集并发送匹配事件的 Webhook中，执行此领域的具体处理步骤并返回其结果；本入口产生 `candidates.flatMap((candidate) => { const value = eventSchema.safeParse(candidate); return value.success ? [value.data] : [];…` 供上层消费（`webhooks.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `webhooks.ts`; this entry produces `candidates.flatMap((candidate) => { const value = eventSchema.safeParse(candidate); return value.success ? [value.data] : [];…` for its caller. Module context: Collects/sends matching event hooks, validating target URLs/settings and owning scheduled delivery state.
 * 处理：通过 `jobs.filter().map`, `jobs.filter`, `alerts.map`, `candidates.flatMap` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `jobs.filter().map`, `jobs.filter`, `alerts.map`, `candidates.flatMap`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Pick<Machines, 'records'>; jobs: JobView[]; alerts: AlertEvent[]
 * 输出 / Returns: WebhookEvent[]；结果来自 / values from `candidates.flatMap((candidate) => { const value = eventSchema.safeParse(candidate); return value.success ? [value.data] : [];…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function collectWebhookEvents(
  machines: Pick<Machines, 'records'>,
  jobs: JobView[],
  alerts: AlertEvent[],
): WebhookEvent[] {
  /**
   * 入口 / Entry: collectWebhookEvents.tags.
   * 功能：从当前输入或状态计算 `(id ? [...new Set(machines.records.get(id)?.organization?.tags || [])] : [])`，供调用方后续验证或使用。
   * Purpose: Computes `(id ? [...new Set(machines.records.get(id)?.organization?.tags || [])] : [])` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string optional
   * 输出 / Returns: `(id ? [...new Set(machines.records.get(id)?.organization?.tags || [])] : [])`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const tags = (id?: string) => (id ? [...new Set(machines.records.get(id)?.organization?.tags || [])] : []);
  const candidates = [
    ...jobs
      .filter((job) => job.id && job.finishedAt && job.status !== 'running')
      .map((job) => ({
        id: digest(`job:${job.id}:${job.status}:${job.finishedAt}`),
        type: 'job.finished',
        occurredAt: job.finishedAt,
        vmId: job.vmId,
        projectId: job.projectId,
        jobId: job.id,
        status: job.status,
        scope: job.scope,
        tags: tags(job.vmId),
      })),
    ...alerts.map((alert) => ({
      id: digest(`alert:${alert.id}`),
      type: 'alert.raised',
      occurredAt: alert.createdAt,
      vmId: alert.vmId,
      projectId: alert.projectId,
      jobId: alert.jobId,
      kind: alert.kind,
      tags: tags(alert.vmId),
    })),
  ];
  return candidates.flatMap((candidate) => {
    const value = eventSchema.safeParse(candidate);
    return value.success ? [value.data] : [];
  });
}

export class Webhooks {
  private state: State = { version: 1, subscriptions: [], deliveries: [], observed: {} };
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ScheduleHandle;
  private pending?: Promise<void>;
  private active?: { id: string; subscriptionId: string; abort: AbortController };
  private closed = false;
  private error?: string;
  /**
   * 入口 / Entry: Webhooks.constructor.
   * 功能：建立 Webhooks 的收集并发送匹配事件的 Webhook上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Webhooks context for this module's responsibility: Collects/sends matching event hooks, validating target URLs/settings and owning scheduled delivery state. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: source: () => Promise<WebhookEvent[]>; file: default=join(DATA, 'webhooks.json'); fetcher: typeof fetch default=fetch; now: default=Date.now; blocked: () => boolean default=() => false; mutation: (delta: number) => void default=() => {}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private source: () => Promise<WebhookEvent[]>,
    private file = join(DATA, 'webhooks.json'),
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
  ) {}
  /**
   * 入口 / Entry: Webhooks.init.
   * 功能：在收集并发送匹配事件的 Webhook中，初始化并核对当前领域状态；处理结果记录到 `this.state`, `this.timer`（`Webhooks`）。
   * Purpose: Initializes and verifies current domain state in `Webhooks`; the outcome is recorded in `this.state`, `this.timer`. Module context: Collects/sends matching event hooks, validating target URLs/settings and owning scheduled delivery state.
   * 处理：通过 `stat().catch`, `stat`, `info.isFile`, `stateSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stat().catch`, `stat`, `info.isFile`, `stateSchema.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `schedule`.
   * 输入 / Inputs: schedule: default=true
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.state`, `this.timer`.
   * 拒绝 / Refusals: 条件 / conditions `info && (!info.isFile() || info.size > 16 * 1024 ** 2)`; `new Set(this.state.subscriptions.map((value) => value.id)).size !== this.state.subscriptions.length || new Set(this.state.del…`; 异常 / errors `new AppError('Webhook 存储类型或大小无效')`; `new AppError('Webhook 存储记录无效')`.
   */
  async init(schedule = true) {
    const info = await stat(this.file).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 16 * 1024 ** 2))
      throw new AppError('Webhook 存储类型或大小无效');
    this.state = stateSchema.parse(await readStore(this.file, () => this.state));
    if (
      new Set(this.state.subscriptions.map((value) => value.id)).size !== this.state.subscriptions.length ||
      new Set(this.state.deliveries.map((value) => value.id)).size !== this.state.deliveries.length ||
      Object.keys(this.state.observed).length > 20000
    )
      throw new AppError('Webhook 存储记录无效');
    if (schedule) {
      this.timer = scheduler.register({ owner: 'core:webhooks', label: 'Webhook 事件投递', intervalMs: 5000,
        immediate: true, overlap: 'skip', backoff: { initialMs: 5000, maxMs: 60000 },
        /**
         * 入口 / Entry: Webhooks.init.run.
         * 功能：在收集并发送匹配事件的 Webhook中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Webhooks`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `Webhooks`; the calls and state transitions below complete the operation. Module context: Collects/sends matching event hooks, validating target URLs/settings and owning scheduled delivery state.
         * 处理：通过 `this.tick` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `this.tick`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 拒绝 / Refusals: 条件 / conditions `this.error`; 异常 / errors `new AppError(this.error, 503)`.
         */
        run: async () => {
          await this.tick();
          if (this.error) throw new AppError(this.error, 503);
        } });
    }
  }
  /**
   * 入口 / Entry: Webhooks.view.
   * 功能：在收集并发送匹配事件的 Webhook中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ subscriptions: this.state.subscriptions.map(({ secret, ...value }) => ({ ...value, hasSecret: !!secret, })), deliveries: st…` 供上层消费（`Webhooks`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Webhooks`; this entry produces `{ subscriptions: this.state.subscriptions.map(({ secret, ...value }) => ({ ...value, hasSecret: !!secret, })), deliveries: st…` for its caller. Module context: Collects/sends matching event hooks, validating target URLs/settings and owning scheduled delivery state.
   * 处理：通过 `this.state.subscriptions.map`, `structuredClone().sort`, `structuredClone` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.state.subscriptions.map`, `structuredClone().sort`, `structuredClone`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: WebhookView；结果来自 / values from `{ subscriptions: this.state.subscriptions.map(({ secret, ...value }) => ({ ...value, hasSecret: !!secret, })), deliveries: st…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(): WebhookView {
    return {
      subscriptions: this.state.subscriptions.map(({ secret, ...value }) => ({
        ...value,
        hasSecret: !!secret,
      })),
      deliveries: structuredClone(this.state.deliveries).sort((a, b) => b.updatedAt - a.updatedAt),
      error: this.error,
      collecting: !!this.pending,
      limits,
    };
  }
  /**
   * 入口 / Entry: Webhooks.serial.
   * 功能：在收集并发送匹配事件的 Webhook中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`Webhooks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Webhooks`; this entry produces `task` for its caller. Module context: Collects/sends matching event hooks, validating target URLs/settings and owning scheduled delivery state.
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
   * 入口 / Entry: Webhooks.change.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: edit: (next: State) => T
   * 输出 / Returns: Promise<T>；结果来自 / values from `this.serial(async () => { const next = structuredClone(this.state), result = edit(next); const completed = next.deliveries .f…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async change<T>(edit: (next: State) => T): Promise<T> {
    /**
     * 入口 / Entry: Webhooks.change.callback@240.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `result`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `next.deliveries`, `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `next.deliveries.filter(waiting).length > limits.pending`; 异常 / errors `new AppError('Webhook 待投递队列已满，请处理积压', 409)`.
     */
    return this.serial(async () => {
      const next = structuredClone(this.state),
        result = edit(next);
      const completed = next.deliveries
        .filter((item) => !waiting(item))
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(-limits.history);
      const keep = new Set(completed.map((item) => item.id));
      next.deliveries = next.deliveries.filter((item) => waiting(item) || keep.has(item.id));
      if (next.deliveries.filter(waiting).length > limits.pending)
        throw new AppError('Webhook 待投递队列已满，请处理积压', 409);
      if (JSON.stringify(next) !== JSON.stringify(this.state)) await writeStore(this.file, next);
      this.state = next;
      return result;
    });
  }
  /**
   * 入口 / Entry: Webhooks.configure.
   * 功能：按动作保存订阅、重试或取消待投递记录，核对配置和队列边界。
   * Purpose: Saves subscriptions or retries/cancels delivery records under configuration/queue bounds.
   * 设计：变更在串行持久状态内完成，进行中的投递以原身份检查；计数与维护状态 finally 恢复。
   * Design: Mutations serialize against durable state and active deliveries retain identity checks; finally restores accounting/maintenance state.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `{ ...this.view(), ...(secret ? { secret } : {}) }`.
   * 副作用 / Effects: `this.active.abort.abort`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.mutation(-1);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.mutation(-1);`; these steps also apply to exceptional exits.
   */
  async configure(input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const value = webhookRequest.parse(input);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    this.mutation(1);
    try {
      let secret: string | undefined;
      /**
       * 入口 / Entry: Webhooks.configure.callback@263.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
       * 输入 / Inputs: next
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `next.subscriptions.push`; 更新 / updates `delivery.status`, `delivery.error`, `delivery.updatedAt`, `delivery.attempts`.
       * 拒绝 / Refusals: 条件 / conditions `value.action === 'retry' || value.action === 'cancel'`; `!delivery`; `value.action === 'cancel'`; 异常 / errors `new AppError('投递记录不存在', 404)`; `new AppError('只能取消等待或投递中的记录', 409)`.
       */
      await this.change((next) => {
        if (value.action === 'retry' || value.action === 'cancel') {
          const delivery = next.deliveries.find((item) => item.id === value.id);
          if (!delivery) throw new AppError('投递记录不存在', 404);
          if (value.action === 'cancel') {
            if (!waiting(delivery)) throw new AppError('只能取消等待或投递中的记录', 409);
            delivery.status = 'cancelled';
            delivery.error = '用户取消';
            delivery.updatedAt = this.now();
          } else {
            if (delivery.status !== 'failed') throw new AppError('只能重试失败的记录', 409);
            const subscription = next.subscriptions.find((item) => item.id === delivery.subscriptionId);
            if (!subscription?.enabled || subscription.version !== delivery.version)
              throw new AppError('订阅已停用或变更，请使用当前配置测试投递', 409);
            delivery.status = 'pending';
            delivery.attempts = 0;
            delivery.nextAttemptAt = this.now();
            delivery.error = undefined;
            delivery.httpStatus = undefined;
          }
          return;
        }
        const existing = value.id ? next.subscriptions.find((item) => item.id === value.id) : undefined;
        if (value.id && !existing) throw new AppError('订阅不存在', 404);
        if (existing && existing.version !== value.version)
          throw new AppError('订阅已改变，请刷新后重试', 409);
        if (value.action === 'save') {
          if (!existing && next.subscriptions.length >= limits.subscriptions)
            throw new AppError('最多登记 16 个接收端', 409);
          const subscription = {
            ...value.subscription,
            id: existing?.id || randomUUID(),
            version: (existing?.version || 0) + 1,
            createdAt: this.now(),
            secret: existing?.secret || randomBytes(32).toString('hex'),
          };
          if (!existing) {
            next.subscriptions.push(subscription);
            secret = subscription.secret;
          } else Object.assign(existing, subscription);
        } else if (value.action === 'remove')
          next.subscriptions = next.subscriptions.filter((item) => item.id !== value.id);
        else if (value.action === 'rotate') {
          secret = randomBytes(32).toString('hex');
          existing!.secret = secret;
          existing!.version++;
          existing!.createdAt = this.now();
        } else if (value.action === 'test') {
          const event: WebhookEvent = {
            id: digest(randomUUID()),
            type: 'test',
            occurredAt: new Date(this.now()).toISOString(),
            tags: [],
          };
          this.enqueue(next, existing!, event);
          return;
        }
        // Recipient or filter changes cannot silently reroute an earlier private payload.
        if (existing)
          for (const delivery of next.deliveries)
            if (delivery.subscriptionId === existing.id && waiting(delivery)) {
              delivery.status = 'cancelled';
              delivery.error = '订阅已改变';
              delivery.updatedAt = this.now();
            }
      });
      if (
        this.active &&
        !this.state.deliveries.some((item) => item.id === this.active!.id && item.status === 'sending')
      )
        this.active.abort.abort();
      return { ...this.view(), ...(secret ? { secret } : {}) };
    } finally {
      this.mutation(-1);
    }
  }
  /**
   * 入口 / Entry: Webhooks.enqueue.
   * 功能：在收集并发送匹配事件的 Webhook中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`Webhooks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Webhooks`; this entry produces `void` for its caller. Module context: Collects/sends matching event hooks, validating target URLs/settings and owning scheduled delivery state.
   * 处理：通过 `digest`, `next.deliveries.some`, `next.deliveries.push`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `digest`, `next.deliveries.some`, `next.deliveries.push`, `this.now`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `next.deliveries.some((item) => item.id === id)`.
   * 输入 / Inputs: next: State; subscription: State['subscriptions'][number]; event: WebhookEvent
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `next.deliveries.push`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private enqueue(next: State, subscription: State['subscriptions'][number], event: WebhookEvent) {
    const id = digest(`${subscription.id}:${subscription.version}:${event.id}`);
    if (next.deliveries.some((item) => item.id === id)) return;
    next.deliveries.push({
      id,
      subscriptionId: subscription.id,
      version: subscription.version,
      event,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: this.now(),
      updatedAt: this.now(),
    });
  }
  /**
   * 入口 / Entry: Webhooks.collect.
   * 功能：在收集并发送匹配事件的 Webhook中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`Webhooks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Webhooks`; this entry produces `void` for its caller. Module context: Collects/sends matching event hooks, validating target URLs/settings and owning scheduled delivery state.
   * 处理：通过 `this.blocked`, `this.state.subscriptions.some`, `inline.map().filter().sort`, `inline.map().filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.state.subscriptions.some`, `inline.map().filter().sort`, `inline.map().filter`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || this.blocked() || !this.state.subscriptions.some((item) => item.enabled)`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `full`; 异常 / errors `new AppError('Webhook 队列或去重窗口已满，部分新事件等待下轮采集', 409)`.
   */
  async collect() {
    if (this.closed || this.blocked() || !this.state.subscriptions.some((item) => item.enabled)) return;
    const events = (await this.source())
      .map((event) => eventSchema.parse(event))
      .filter(
        (event) =>
          Date.parse(event.occurredAt) >= this.now() - limits.sourceHours * hour &&
          Date.parse(event.occurredAt) <= this.now(),
      )
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    let full = false;
    /**
     * 入口 / Entry: Webhooks.collect.callback@364.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
     * 输入 / Inputs: next
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `full`, `queued`, `next.observed[event.id]`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    await this.change((next) => {
      for (const [id, at] of Object.entries(next.observed))
        if (at < this.now() - 48 * hour) delete next.observed[id];
      let count = 0,
        remembered = Object.keys(next.observed).length,
        queued = next.deliveries.filter(waiting).length;
      for (const event of events) {
        if (Object.hasOwn(next.observed, event.id)) continue;
        const matches = next.subscriptions.filter(
          (subscription) =>
            subscription.enabled &&
            Date.parse(event.occurredAt) >= subscription.createdAt &&
            matchesWebhook(subscription, event),
        );
        if (remembered >= 20000 || queued + matches.length > limits.pending) {
          full = true;
          break;
        }
        for (const subscription of matches) this.enqueue(next, subscription, event);
        queued += matches.length;
        remembered++;
        next.observed[event.id] = this.now();
        if (++count === 512) break;
      }
    });
    if (full) throw new AppError('Webhook 队列或去重窗口已满，部分新事件等待下轮采集', 409);
  }
  /**
   * 入口 / Entry: Webhooks.tick.
   * 功能：在收集并发送匹配事件的 Webhook中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.resolve()` / `this.pending` 供上层消费（`Webhooks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Webhooks`; this entry produces `Promise.resolve()` / `this.pending` for its caller. Module context: Collects/sends matching event hooks, validating target URLs/settings and owning scheduled delivery state.
   * 处理：通过 `this.blocked`, `Promise.resolve`, `this.mutation`, `inline().finally` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `Promise.resolve`, `this.mutation`, `inline().finally`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || this.blocked()`; `this.pending`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `Promise.resolve()`; `this.pending`; `task`.
   * 副作用 / Effects: 更新 / updates `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  tick(): Promise<void> {
    if (this.closed || this.blocked()) return Promise.resolve();
    if (this.pending) return this.pending;
    this.mutation(1);
    /**
     * 入口 / Entry: Webhooks.tick.callback@395.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `this.error`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 `this.error = '事件采集或存储失败，请检查队列容量与数据目录。';`; `this.error = '投递记录保存失败，待恢复后继续；接收端应按投递标识去重。';`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `this.error = '事件采集或存储失败，请检查队列容量与数据目录。';`; `this.error = '投递记录保存失败，待恢复后继续；接收端应按投递标识去重。';`; these statements determine whether a failure is absorbed or rejected again.
     */
    const task = (async () => {
      this.error = undefined;
      try {
        await this.collect();
      } catch {
        this.error = '事件采集或存储失败，请检查队列容量与数据目录。';
      }
      try {
        for (let i = 0; i < 10 && !this.closed && !this.blocked(); i++) if (!(await this.deliver())) break;
      } catch {
        this.error = '投递记录保存失败，待恢复后继续；接收端应按投递标识去重。';
      }
    })().finally(() => {
      this.pending = undefined;
      this.mutation(-1);
    });
    this.pending = task;
    return task;
  }
  /**
   * 入口 / Entry: Webhooks.deliver.
   * 功能：按原订阅签名并发送事件，记录响应、重试期限和最终投递状态。
   * Purpose: Signs/sends events under the original subscription and records responses, retry deadlines and terminal delivery state.
   * 设计：实际发送前重查订阅，HTTPS 目标与输出有界；网络结果和持久终态分开确认，失败不会丢失原投递记录。
   * Design: Subscription is rechecked before bounded HTTPS delivery; network results and persistence are distinct, preserving failed delivery evidence.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `false`; `true`.
   * 副作用 / Effects: `createHmac().update().digest`; `createHmac().update`; `createHmac`; `this.fetcher`; `AbortSignal.any`; 更新 / updates `this.active`, `status`, `retryAfter`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `this.active = undefined;`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.active = undefined;`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 ，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute ; these statements determine whether a failure is absorbed or rejected again.
   */
  private async deliver() {
    const candidate = this.state.deliveries.find((item) => waiting(item) && item.nextAttemptAt <= this.now());
    if (!candidate) return false;
    const subscription = this.state.subscriptions.find((item) => item.id === candidate.subscriptionId);
    if (
      !subscription ||
      subscription.version !== candidate.version ||
      (!subscription.enabled && candidate.event.type !== 'test')
    ) {
      await this.change((next) => {
        const item = next.deliveries.find((item) => item.id === candidate.id);
        if (item && waiting(item)) {
          item.status = 'cancelled';
          item.error = '订阅已停用或移除';
        }
      });
      return true;
    }
    let admitted: WebhookDelivery | undefined;
    /**
     * 入口 / Entry: Webhooks.deliver.callback@433.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
     * 输入 / Inputs: next
     * 输出 / Returns: `void`.
     * 副作用 / Effects: 更新 / updates `item.status`, `item.error`, `item.updatedAt`, `admitted`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    await this.change((next) => {
      const item = next.deliveries.find((item) => item.id === candidate.id);
      const current = next.subscriptions.find((rule) => rule.id === candidate.subscriptionId);
      if (!item || !waiting(item) || !current || current.version !== subscription.version) return;
      if (item.attempts >= limits.attempts) {
        item.status = 'failed';
        item.error = '已达到自动重试次数上限';
        return;
      }
      item.status = 'sending';
      item.attempts++;
      item.updatedAt = this.now();
      admitted = structuredClone(item);
    });
    if (!admitted) return true;
    const abort = new AbortController();
    this.active = { id: admitted.id, subscriptionId: subscription.id, abort };
    const current = this.state.deliveries.find((item) => item.id === admitted!.id);
    if (current?.status !== 'sending') {
      this.active = undefined;
      return true;
    }
    const timestamp = String(Math.floor(this.now() / 1000)),
      payload = JSON.stringify({ version: 1, ...admitted.event });
    const signature = createHmac('sha256', Buffer.from(subscription.secret, 'hex'))
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    let status: number | undefined,
      retryAfter = 0;
    try {
      const response = await this.fetcher(subscription.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
        headers: {
          'content-type': 'application/json',
          'x-sakura-event': admitted.event.type,
          'x-sakura-delivery': admitted.id,
          'x-sakura-timestamp': timestamp,
          'x-sakura-signature': 'sha256=' + signature,
          'idempotency-key': admitted.id,
        },
        body: payload,
      });
      status = response.status;
      if (status === 429 || status === 503) {
        const value = Number(response.headers.get('retry-after'));
        if (Number.isFinite(value)) retryAfter = Math.min(3600, Math.max(0, value)) * 1000;
      }
      await response.body?.cancel();
    } catch {
      /* Receiver response bodies and connection details are not stored. */
    } finally {
      this.active = undefined;
    }
    if (this.closed) return false; // Persisted 'sending' is retried with the same delivery id after restart.
    /**
     * 入口 / Entry: Webhooks.deliver.callback@489.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
     * 输入 / Inputs: next
     * 输出 / Returns: `void`.
     * 副作用 / Effects: 更新 / updates `item.httpStatus`, `item.updatedAt`, `item.status`, `item.error`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    await this.change((next) => {
      const item = next.deliveries.find((value) => value.id === admitted!.id);
      if (!item || item.status !== 'sending') return;
      item.httpStatus = status;
      item.updatedAt = this.now();
      if (status !== undefined && status >= 200 && status < 300) {
        item.status = 'delivered';
        item.error = undefined;
      } else {
        const transient = status === undefined || status === 408 || status === 429 || status >= 500;
        item.status = transient && item.attempts < limits.attempts ? 'pending' : 'failed';
        item.error = status ? `接收端返回 HTTP ${status}` : '连接失败或超时';
        item.nextAttemptAt =
          this.now() + Math.max(retryAfter, [30000, 120000, 600000, 1800000][Math.min(item.attempts - 1, 3)]);
      }
    });
    return true;
  }
  /**
   * 入口 / Entry: Webhooks.close.
   * 功能：在收集并发送匹配事件的 Webhook中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`Webhooks`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Webhooks`; the outcome is recorded in `this.closed`. Module context: Collects/sends matching event hooks, validating target URLs/settings and owning scheduled delivery state.
   * 处理：通过 `this.active.abort.abort`, `this.timer.close`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.active.abort.abort`, `this.timer.close`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.active.abort.abort`; `this.timer.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.active?.abort.abort();
    await this.timer?.close();
    await this.pending;
    await this.queue.catch(() => {});
  }
}
import { scheduler, type ScheduleHandle } from './scheduler.ts';
