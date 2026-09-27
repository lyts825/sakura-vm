import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import type { Machines } from './machines.ts';
import { matchesWebhook } from './webhooks.ts';
import {
  webhookAlertKinds, webhookJobStatuses, webhookTypes,
  type WebhookEvent, type WebhookFilter,
} from '../shared/webhooks.ts';

const hour = 3600_000;
const limits = { rules: 24, history: 300, observed: 20_000, dailyActions: 25 };
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
export type RunbookExecutor = (id: string, steps: RunbookStep[], projectId: string | undefined,
  signal: AbortSignal) => Promise<{ code: number; results?: Array<{ code: number; skipped?: boolean }> }>;
export const automationRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('save'), id: z.uuid().optional(), version: z.number().int().positive().optional(),
    rule: ruleInput, approval: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  z.object({ operation: z.literal('remove'), id: z.uuid(), version: z.number().int().positive() }).strict(),
  z.object({ operation: z.literal('preview'), id: z.uuid() }).strict(),
]);
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const defaultState = (): State => ({
  version: 1, rules: [], executions: [], observed: {}, lastAttempt: {}, daily: {},
});

export class AutomationRules {
  private readonly approvalKey = randomBytes(32);
  private readonly activeRunbooks = new Set<AbortController>();
  private state: State = defaultState();
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private closed = false;
  private error?: string;
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
  private approval(id: string, version: number, rule: z.infer<typeof ruleInput>) {
    const reviewed = { name: rule.name, filter: rule.filter, action: rule.action,
      steps: rule.steps, cooldownSeconds: rule.cooldownSeconds };
    return createHmac('sha256', this.approvalKey)
      .update(JSON.stringify({ id, version, reviewed })).digest('hex');
  }
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
      this.timer = setInterval(() => void this.tick(), 5000);
      this.timer.unref();
      void this.tick();
    }
  }
  view(): AutomationView {
    return {
      rules: structuredClone(this.state.rules),
      executions: structuredClone(this.state.executions).reverse(),
      error: this.error, collecting: !!this.pending, limits,
    };
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.catch(() => {}).then(work);
    this.queue = task;
    return task;
  }
  private async change<T>(edit: (next: State) => T): Promise<T> {
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
  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const controller of this.activeRunbooks) controller.abort();
    await this.pending;
    await this.queue.catch(() => {});
  }
}
