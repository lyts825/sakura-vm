/** 原提供者的一次票据账本。只在原动作返回后脱离请求上下文保存证明，不增授业务权能。 */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import {
  delegatedInputSchema,
  delegatedPlanSchema,
  delegatedReceiptSchema,
  delegatedTicketSchema,
  delegatedIntentSchema,
  type DelegatedAdapter,
  type DelegatedInput,
  type DelegatedPlan,
  type DelegatedReceipt,
  type DelegatedTicket,
  type DelegatedIntent,
} from '../shared/contracts/delegated-actions.ts';
import { suiteJson as suiteJsonSchema, type SuiteJson } from '../shared/contracts/suite-common.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { resourceContext } from './host-runtime/context.ts';
import { captureOperationCheck } from './operation-context.ts';
import { pluginAuthority, withPluginCleanup, withPluginContinuation } from './plugin-authority.ts';
import type { DelegatedActionProvider as ProviderContract } from './service-contracts/delegated-actions.ts';

export const delegatedHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(message: string, code = 'DELEGATED_TICKET_STALE'): never {
  throw new AppError(message, 409, code);
}
const rowSchema = z.object({ receipt: delegatedReceiptSchema, grant: suiteJsonSchema }).strict();
const ledgerSchema = z.object({ format: z.literal(1), rows: z.array(rowSchema).max(1256) }).strict();
type Row = z.infer<typeof rowSchema>;
export interface OriginalActionAdapter {
  id: DelegatedAdapter;
  preview(
    input: DelegatedInput,
    signal: AbortSignal,
  ): Promise<{ summary: SuiteJson; resourceDigest: string; grant: SuiteJson; expiresAt?: string }>;
  /** beforeDispatch 必须位于原票据核对之后、首次业务副作用之前；原执行器继续核对资源并持锁。 */
  execute(
    input: DelegatedInput,
    grant: SuiteJson,
    resourceDigest: string,
    signal: AbortSignal,
    beforeDispatch: () => Promise<void>,
  ): Promise<SuiteJson>;
}

export class DelegatedActionProvider implements ProviderContract {
  private queue: Promise<unknown> = Promise.resolve();
  private instance: PluginInstance;
  private pending = new Set<Promise<unknown>>();
  private controller = new AbortController();
  constructor(
    private metadata: PluginMetadata,
    private adapter: OriginalActionAdapter,
    private now = Date.now,
  ) {
    const instance = pluginAuthority();
    if (
      !instance ||
      instance.source !== 'official' ||
      instance.pluginId !== (adapter.id === 'maintenance-cleanup' ? 'maintenance' : 'resilience-runs')
    )
      fail('动作账本须由原提供者建立', 'DELEGATED_IDENTITY_STALE');
    this.instance = instance;
  }
  private identity() {
    this.instance.check('services', true);
    const c = resourceContext(),
      actorId = z.uuid().safeParse(c?.actorId);
    const consumer = c?.serviceConsumerPluginInstanceId,
      generation = c?.serviceConsumerPluginGeneration;
    if (
      !actorId.success ||
      !generation ||
      (consumer !== 'official:incident-actions' && consumer !== 'official:flow-connectors')
    )
      fail('缺少实际 owner 与受准入的执行消费者', 'DELEGATED_IDENTITY_STALE');
    return { actorId: actorId.data, consumer, consumerGeneration: generation } as const;
  }
  private checkOwner(
    row: Row,
    ticket: DelegatedTicket,
    current: ReturnType<DelegatedActionProvider['identity']>,
    writing: boolean,
  ) {
    const p = row.receipt.plan;
    if (
      p.ticket.id !== ticket.id ||
      p.ticket.digest !== ticket.digest ||
      p.ticket.adapter !== ticket.adapter ||
      p.actorId !== current.actorId ||
      p.consumer !== current.consumer
    )
      fail('票据不属于当前主体或消费者', 'DELEGATED_IDENTITY_STALE');
    if (
      writing &&
      (p.consumerGeneration !== current.consumerGeneration ||
        p.providerGeneration !== this.instance.generation)
    )
      fail('原动作代次已改变，必须重新预览和批准');
  }
  private async state() {
    const snapshot = await this.metadata.read();
    return {
      snapshot,
      value:
        snapshot.value == null
          ? { format: 1 as const, rows: [] as Row[] }
          : ledgerSchema.parse(snapshot.value),
    };
  }
  private edit<T>(work: (rows: Row[]) => Promise<T> | T): Promise<T> {
    const pending = this.queue.then(async () => {
      const { snapshot, value } = await this.state(),
        result = await work(value.rows);
      const parsed = ledgerSchema.parse(value);
      const resultReservations =
        parsed.rows.filter((row) => ['ready', 'consumed', 'dispatching'].includes(row.receipt.status))
          .length *
        (514 * 1024);
      if (Buffer.byteLength(JSON.stringify(parsed, null, 2)) + resultReservations > 8 * 1024 ** 2)
        fail('动作回执和待返回结果预留已达 8 MiB 上限', 'DELEGATED_CAPACITY');
      await this.metadata.replace(parsed, { expectedRevision: snapshot.revision });
      return structuredClone(result);
    });
    this.queue = pending.catch(() => {});
    return pending;
  }
  async init() {
    if (pluginAuthority() !== this.instance || this.instance.phase !== 'activating')
      fail('仅原提供者激活时恢复动作账本');
    await this.edit((rows) => {
      for (const row of rows) {
        if (row.receipt.status === 'ready') {
          row.receipt.status = 'expired';
          row.receipt.error = '提供者重新启动，旧批准已失效';
        } else if (row.receipt.status === 'consumed' || row.receipt.status === 'dispatching') {
          row.receipt.status = 'unknown';
          row.receipt.error = '动作曾被消费；只核对原状态，不自动重发';
        } else continue;
        row.grant = null;
        row.receipt.updatedAt = new Date(this.now()).toISOString();
      }
    });
  }
  async preview(raw: DelegatedInput): Promise<DelegatedPlan> {
    const input = delegatedInputSchema.parse(raw),
      identity = this.identity();
    if (input.adapter !== this.adapter.id) fail('动作不属于当前原提供者');
    const check = captureOperationCheck();
    await check();
    const original = await this.adapter.preview(input, this.controller.signal);
    await check();
    this.identity();
    const createdAt = new Date(this.now()).toISOString(),
      expiresAt = new Date(
        Math.min(this.now() + 300_000, original.expiresAt ? Date.parse(original.expiresAt) : Infinity),
      ).toISOString();
    const summary = suiteJsonSchema.parse(original.summary),
      grant = suiteJsonSchema.parse(original.grant);
    if (Buffer.byteLength(JSON.stringify({ summary, grant })) > 512 * 1024)
      fail('原计划超过委派上限，请回原功能页面选择范围', 'DELEGATED_PLAN_TOO_LARGE');
    const base = {
      ...identity,
      provider: this.instance.identity,
      providerGeneration: this.instance.generation,
      input,
      resourceDigest: original.resourceDigest,
      createdAt,
      expiresAt,
      summary,
    };
    const ticket = { id: randomUUID(), adapter: input.adapter, digest: delegatedHash(base) };
    const plan = delegatedPlanSchema.parse({ ...base, ticket });
    await this.edit((rows) => {
      const terminal = new Set(['returned', 'rejected', 'unknown', 'expired']);
      for (const row of rows)
        if (row.receipt.status === 'ready' && Date.parse(row.receipt.plan.expiresAt) <= this.now()) {
          row.receipt.status = 'expired';
          row.receipt.updatedAt = createdAt;
          row.grant = null;
        }
      // 保留最近 1000 份结束回执；未知状态保留为待人工核对，不在此压缩。
      const compactable = rows.filter(
        (row) => terminal.has(row.receipt.status) && row.receipt.status !== 'unknown',
      );
      const remove = new Set(compactable.slice(0, Math.max(0, compactable.length - 999)));
      for (let i = rows.length - 1; i >= 0; i--) if (remove.has(rows[i])) rows.splice(i, 1);
      if (
        rows.filter((row) => !terminal.has(row.receipt.status) || row.receipt.status === 'unknown').length >=
        256
      )
        fail('仍有过多待核对动作，请先回原功能页面核对', 'DELEGATED_CAPACITY');
      rows.push({
        receipt: {
          plan,
          status: 'ready',
          updatedAt: createdAt,
          intentDigest: null,
          result: null,
          error: null,
        },
        grant,
      });
    });
    return plan;
  }
  dispatch(
    ticket: DelegatedTicket,
    commitIntent: (plan: DelegatedPlan) => Promise<DelegatedIntent>,
    signal?: AbortSignal,
  ): Promise<DelegatedReceipt> {
    const pending = this.perform(delegatedTicketSchema.parse(ticket), commitIntent, signal);
    this.pending.add(pending);
    void pending.finally(() => this.pending.delete(pending)).catch(() => {});
    return pending;
  }
  private async perform(
    ticket: DelegatedTicket,
    commitIntent: (plan: DelegatedPlan) => Promise<DelegatedIntent>,
    signal?: AbortSignal,
  ) {
    const identity = this.identity(),
      check = captureOperationCheck();
    const combined = AbortSignal.any([
      this.controller.signal,
      this.instance.signal,
      ...(signal ? [signal] : []),
    ]);
    combined.throwIfAborted();
    await check();
    const row = await this.edit((rows) => {
      const row = rows.find((row) => row.receipt.plan.ticket.id === ticket.id) || fail('原动作票据不存在');
      this.checkOwner(row, ticket, identity, true);
      if (row.receipt.status !== 'ready' || Date.parse(row.receipt.plan.expiresAt) <= this.now())
        fail('票据已消费或到期');
      row.receipt.status = 'consumed';
      row.receipt.updatedAt = new Date(this.now()).toISOString();
      return row;
    });
    let dispatched = false;
    const settle = (status: DelegatedReceipt['status'], result: SuiteJson | null, error: string | null) => {
      const write = () =>
        this.edit((rows) => {
          const current = rows.find((r) => r.receipt.plan.ticket.id === ticket.id) || fail('原动作回执丢失');
          if (!['consumed', 'dispatching'].includes(current.receipt.status)) fail('原动作回执状态已变化');
          current.receipt.status = status;
          current.receipt.result = result;
          current.receipt.error = error;
          current.grant = null;
          current.receipt.updatedAt = new Date(this.now()).toISOString();
          return current.receipt;
        });
      // 仅写入本次已消费票据的结论。禁止在此闭包执行或重发原业务。
      return ['draining', 'cleanup-pending'].includes(this.instance.phase)
        ? withPluginCleanup(this.instance, write)
        : withPluginContinuation(this.instance, write);
    };
    try {
      const intent = delegatedIntentSchema.parse(await commitIntent(structuredClone(row.receipt.plan)));
      await check();
      combined.throwIfAborted();
      await this.edit((rows) => {
        const current = rows.find((r) => r.receipt.plan.ticket.id === ticket.id)!;
        current.receipt.intentDigest = intent.intentDigest;
      });
      const result = await this.adapter.execute(
        row.receipt.plan.input,
        row.grant,
        row.receipt.plan.resourceDigest,
        combined,
        async () => {
          await check();
          combined.throwIfAborted();
          this.checkOwner(row, ticket, this.identity(), true);
          if (Date.parse(row.receipt.plan.expiresAt) <= this.now())
            fail('批准等待期间票据已到期，请重新预览');
          await this.edit((rows) => {
            const current = rows.find((r) => r.receipt.plan.ticket.id === ticket.id)!;
            if (current.receipt.status !== 'consumed') fail('原动作派发状态已变化');
            current.receipt.status = 'dispatching';
            current.receipt.updatedAt = new Date(this.now()).toISOString();
          });
          dispatched = true;
          await check();
          combined.throwIfAborted();
        },
      );
      if (!dispatched) fail('原适配器没有记录派发边界', 'DELEGATED_DISPATCH_PROOF_MISSING');
      const parsed = suiteJsonSchema.parse(result);
      if (
        Buffer.byteLength(JSON.stringify({ rows: [{ receipt: { result: parsed } }] }, null, 2)) >
        512 * 1024
      )
        fail('原提供者结果超过回执上限');
      return await settle('returned', parsed, null);
    } catch (error) {
      // 错误消息只记录固定代码，避免原日志/密钥进入持久动作回执。
      const code =
        error instanceof AppError && /^[A-Z0-9_]{1,100}$/.test(error.code || '')
          ? error.code
          : 'DELEGATED_OPERATION_INTERRUPTED';
      return settle(dispatched ? 'unknown' : 'rejected', null, code!);
    }
  }
  async inspect(raw: DelegatedTicket): Promise<DelegatedReceipt> {
    const ticket = delegatedTicketSchema.parse(raw),
      identity = this.identity();
    await captureOperationCheck()();
    const { value } = await this.state();
    const row =
      value.rows.find((row) => row.receipt.plan.ticket.id === ticket.id) || fail('原动作票据不存在');
    this.checkOwner(row, ticket, identity, false);
    return structuredClone(row.receipt);
  }
  async close() {
    this.controller.abort(new AppError('原动作提供者关闭', 503, 'DELEGATED_PROVIDER_CLOSED'));
    await Promise.allSettled([...this.pending]);
    await this.queue;
  }
}
