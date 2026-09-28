import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import type { Machines } from './machines.ts';
import type { JobView } from './jobs.ts';
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

const limits = { subscriptions: 16, pending: 500, history: 200, attempts: 5, sourceHours: 24 };
const hour = 3600000;
const time = z.number().finite().nonnegative();
const label = z.string().trim().min(1).max(24);
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
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const waiting = (delivery: WebhookDelivery) => ['pending', 'sending'].includes(delivery.status);
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
export function collectWebhookEvents(
  machines: Pick<Machines, 'records'>,
  jobs: JobView[],
  alerts: AlertEvent[],
): WebhookEvent[] {
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
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private active?: { id: string; subscriptionId: string; abort: AbortController };
  private closed = false;
  private error?: string;
  constructor(
    private source: () => Promise<WebhookEvent[]>,
    private file = join(DATA, 'webhooks.json'),
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
  ) {}
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
      this.timer = setInterval(() => void this.tick(), 5000);
      this.timer.unref();
      void this.tick();
    }
  }
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
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.catch(() => {}).then(work);
    this.queue = task;
    return task;
  }
  private async change<T>(edit: (next: State) => T): Promise<T> {
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
  async configure(input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const value = webhookRequest.parse(input);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    this.mutation(1);
    try {
      let secret: string | undefined;
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
  tick(): Promise<void> {
    if (this.closed || this.blocked()) return Promise.resolve();
    if (this.pending) return this.pending;
    this.mutation(1);
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
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.active?.abort.abort();
    await this.pending;
    await this.queue.catch(() => {});
  }
}
