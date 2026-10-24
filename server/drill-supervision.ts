/** 专属监管账本；有限委派、管理租约与动作票据互不替代。
 * Dedicated supervision ledger; delegation, management leases and action tickets are distinct authorities. */
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { DrillSupervisionV1 } from './service-contracts/drill-supervision.ts';
import type { DrillMachinePort, DrillWatchdogPort, DrillWatchdogEvent } from './drill-machine-port.ts';
import { AppError } from '../shared/errors.ts';
import { captureOperationCheck } from './operation-context.ts';
import {
  drillDelegationSchema,
  drillTokenSchema,
  drillPreparationSchema,
  drillEvidenceSchema,
  drillSampleSchema,
  drillCapabilitySchema,
  type DrillDelegation,
  type DrillToken,
  type DrillEvidence,
  type DrillPreparation,
} from '../shared/contracts/drill-supervision.ts';
const principal = z.object({ identity: z.string().min(1), generation: z.string().min(1) }).strict();
const row = z
  .object({
    input: drillDelegationSchema,
    owner: principal,
    guard: principal,
    consumers: z.record(z.string(), principal),
    delegation: drillTokenSchema,
    lease: drillTokenSchema.nullable(),
    state: z.enum([
      'delegated',
      'arming',
      'armed',
      'injecting',
      'injected',
      'withdrawn',
      'containing',
      'stopped',
      'released',
      'unknown',
    ]),
    cancelled: z.boolean(),
    // Older records cannot prove that launch was never attempted.
    watchdogIntent: z.boolean().default(true),
    tickets: z.array(
      z.object({ token: drillTokenSchema, step: z.number().int(), consumer: principal }).strict(),
    ),
    intent: z.string().nullable(),
    evidence: drillEvidenceSchema.nullable(),
  })
  .strict();
const stateSchema = z.object({ version: z.literal(1), rows: z.array(row).max(1000) }).strict();
type Row = z.infer<typeof row>;
type State = z.infer<typeof stateSchema>;
const token = (): DrillToken => ({ id: randomUUID(), secret: randomBytes(32).toString('hex') });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function fail(message: string, code = 'RESILIENCE_IDENTITY_STALE'): never {
  throw new AppError(message, 409, code);
}
export class DrillSupervision implements DrillSupervisionV1 {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private metadata: Pick<PluginMetadata<unknown>, 'read' | 'replace'>,
    private machines: DrillMachinePort,
    private watchdogs: DrillWatchdogPort,
  ) {}
  private async read() {
    const s = await this.metadata.read();
    return { ...s, value: stateSchema.parse(s.value ?? { version: 1, rows: [] }) };
  }
  private transaction<T>(work: (s: State) => Promise<T> | T) {
    const p = this.queue.then(async () => {
      const s = await this.read();
      const value = await work(s.value);
      await this.metadata.replace(stateSchema.parse(s.value), { expectedRevision: s.revision });
      return structuredClone(value);
    });
    this.queue = p.catch(() => {});
    return p;
  }
  private caller(plugin: string) {
    const c = this.machines.caller(),
      expected = this.machines.consumer(plugin);
    if (!same(c, expected)) fail('真实服务消费者与授权对象不符');
    return c;
  }
  async capabilities() {
    const v = await this.watchdogs.verified();
    return drillCapabilitySchema.parse({
      available: v.host && v.guest,
      platform: process.platform,
      hostVerified: v.host,
      guestVerified: v.guest,
      gaps: v.gaps,
      catalogueVersion: '1.0.0',
    });
  }
  async prepare(raw: DrillPreparation) {
    await captureOperationCheck()();
    const input = drillPreparationSchema.parse(raw),
      caller = this.caller('resilience-fixtures');
    await this.machines.assertOwnership(input.replica, caller.identity);
    return this.machines.prepare(input);
  }
  async delegate(raw: DrillDelegation) {
    await captureOperationCheck()();
    const input = drillDelegationSchema.parse(raw),
      owner = this.caller('resilience-fixtures');
    await this.machines.assertOwnership(input.replica, owner.identity);
    await this.machines.assertIdentity(input.identity);
    if (input.replica.vmId !== input.identity.vmId || input.replica.createdAt !== input.identity.createdAt)
      fail('副本原身份不符');
    if (
      Date.parse(input.faultDeadline) <= Date.now() ||
      Date.parse(input.faultDeadline) - Date.now() > 90000 + input.parameters.durationSeconds * 1000 ||
      Date.parse(input.runDeadline) - Date.now() > 1200000 ||
      Date.parse(input.runDeadline) <= Date.parse(input.faultDeadline)
    )
      fail('监管期限超过预算', 'RESILIENCE_BUDGET_EXCEEDED');
    const allowed = {
      inject: 'resilience-faults',
      baseline: 'resilience-probes',
      observe: 'resilience-probes',
      verify: 'resilience-probes',
      restart: 'resilience-recovery',
      checkpoint: 'resilience-recovery',
    };
    if (
      new Set(input.steps.map((s) => s.id)).size !== input.steps.length ||
      input.steps.some((s) => allowed[s.action] !== s.consumer) ||
      input.steps.filter((s) => s.action === 'inject').length !== 1
    )
      fail('步骤消费者或故障数量无效');
    return this.transaction((s) => {
      if (s.rows.some((r) => r.state !== 'released'))
        fail('原演练仍占用监管额度', 'RESILIENCE_RESOURCE_BUSY');
      const d = token();
      s.rows.push({
        input,
        owner,
        guard: this.machines.consumer('resilience-guard'),
        consumers: Object.fromEntries(
          ['resilience-faults', 'resilience-probes', 'resilience-recovery'].map((id) => [
            id,
            this.machines.consumer(id),
          ]),
        ),
        delegation: d,
        lease: null,
        state: 'delegated',
        cancelled: false,
        watchdogIntent: false,
        tickets: [],
        intent: null,
        evidence: null,
      });
      return d;
    });
  }
  private find(s: State, t: DrillToken, kind: 'delegation' | 'lease', cleanup = false) {
    drillTokenSchema.parse(t);
    const r = s.rows.find((r) => same(r[kind], t));
    if (!r) fail('监管权能无效');
    const caller = this.caller('resilience-guard');
    if (cleanup ? caller.identity !== r.guard.identity : !same(caller, r.guard)) fail('管理租约代次已变化');
    return r;
  }
  /** 仅查回原管理租约并撤销业务权，不能重放监管启动或故障。
   * Recover only the original lease and revoke business authority, without replaying effects. */
  async recoverLease(delegation: DrillToken) {
    return this.transaction((s) => {
      const r = this.find(s, delegation, 'delegation', true);
      if (!r.lease) fail('原委派未取得租约，保留本体核销', 'RESILIENCE_CLEANUP_PENDING');
      r.cancelled = true;
      return r.lease;
    });
  }
  async retireDelegation(delegation: DrillToken) {
    return this.transaction((s) => {
      const r = this.find(s, delegation, 'delegation', true);
      if (r.lease || !['delegated', 'released'].includes(r.state))
        fail('监管可能已启动，不能直接注销委派', 'RESILIENCE_CLEANUP_PENDING');
      r.state = 'released';
      r.cancelled = true;
      return this.evidence(
        r,
        'absent',
        'confirmed',
        '账本确认未签发监管租约或故障动作票据；VM 销毁仍归 fixtures',
      );
    });
  }
  async arm(t: DrillToken) {
    await captureOperationCheck()();
    if (!(await this.capabilities()).available)
      fail('双层监管实机验证尚未通过', 'RESILIENCE_GUARD_UNAVAILABLE');
    const r = await this.transaction((s) => {
      const r = this.find(s, t, 'delegation');
      if (r.state !== 'delegated') fail('委派已经消费');
      r.state = 'arming';
      r.lease = token();
      return r;
    });
    try {
      await this.machines.reserve(r.input.identity, r.input.runId);
      await this.machines.assertIdentity(r.input.identity);
      await this.transaction((s) => {
        const current = this.find(s, r.lease!, 'lease');
        if (current.cancelled) fail('监管启动已取消');
        current.watchdogIntent = true;
      });
      await this.watchdogs.start(r.input.identity, r.input.runId, r.input.faultDeadline, r.input.runDeadline);
      const ready = z
        .object({ ready: z.literal(true), bootId: z.uuid(), deadline: z.string() })
        .strict()
        .parse(
          await this.machines.guest(r.input.identity, 'arm', {
            runId: r.input.runId,
            parameters: r.input.parameters,
            faultDeadline: r.input.faultDeadline,
          }),
        );
      if (ready.bootId !== r.input.identity.bootId || ready.deadline !== r.input.faultDeadline)
        fail('客户机监管身份或期限不符');
      await this.transaction((s) => {
        const current = this.find(s, r.lease!, 'lease');
        current.state = 'armed';
      });
      return r.lease!;
    } catch (e) {
      const current = this.find((await this.read()).value, r.lease!, 'lease', true);
      if (!current.watchdogIntent) {
        await this.retireUnstarted(current);
        throw e;
      }
      await this.transaction((s) => {
        s.rows.find((x) => x.input.runId === r.input.runId)!.state = 'unknown';
      });
      try {
        await (await this.watchdogs.reconnect(r.input.runId)).contain();
      } catch {}
      throw e;
    }
  }
  protected async retireUnstartedForShutdown(runId: string): Promise<boolean> {
    const r = (await this.read()).value.rows.find((item) => item.input.runId === runId);
    if (!r || r.state === 'released') return true;
    if (r.watchdogIntent) return false;
    await this.retireUnstarted(r);
    return true;
  }
  private async retireUnstarted(r: Row) {
    await this.transaction((s) => {
      const current = s.rows.find((x) => x.input.runId === r.input.runId)!;
      if (current.watchdogIntent || current.intent || current.tickets.length)
        fail('启动状态无法证明未产生副作用', 'RESILIENCE_CLEANUP_PENDING');
      current.cancelled = true;
      current.state = 'containing';
    });
    await this.machines.release(r.input.identity, r.input.runId);
    const ev = this.evidence(
      r,
      'absent',
      'confirmed',
      '持久账本确认未签发监管启动或故障动作；原 VM 仍由 fixtures 核销',
    );
    await this.transaction((s) => {
      const current = s.rows.find((x) => x.input.runId === r.input.runId)!;
      if (current.watchdogIntent || current.intent || current.tickets.length)
        fail('监管启动已发生变化', 'RESILIENCE_CLEANUP_PENDING');
      current.cancelled = true;
      current.state = 'released';
      current.evidence = ev;
    });
    return ev;
  }
  async authorizeStep(t: DrillToken, id: number) {
    await captureOperationCheck()();
    return this.transaction(async (s) => {
      const r = this.find(s, t, 'lease'),
        step = r.input.steps.find((x) => x.id === id);
      if (!step) fail('步骤不在原批准计划中');
      if (
        r.cancelled ||
        Date.now() >= Date.parse(r.input.runDeadline) ||
        !['armed', 'injected', 'withdrawn'].includes(r.state)
      )
        fail('原运行已封锁');
      if (
        step.action === 'inject' &&
        (r.state !== 'armed' || Date.now() >= Date.parse(r.input.faultDeadline))
      )
        fail('故障授权已失效');
      if (['restart', 'checkpoint', 'verify'].includes(step.action) && r.state !== 'withdrawn')
        fail('必须先确认原故障撤回');
      await this.machines.assertIdentity(r.input.identity);
      const consumer = this.machines.consumer(step.consumer);
      if (!same(consumer, r.consumers[step.consumer])) fail('消费者代次变化');
      const old = r.tickets.find((x) => x.step === id);
      if (old) return old.token;
      const ticket = token();
      r.tickets.push({ token: ticket, step: id, consumer });
      return ticket;
    });
  }
  private async action(t: DrillToken, actions: string[]) {
    drillTokenSchema.parse(t);
    const s = await this.read();
    for (const r of s.value.rows) {
      const found = r.tickets.find((x) => same(x.token, t));
      if (!found) continue;
      const step = r.input.steps.find((x) => x.id === found.step)!;
      if (
        !actions.includes(step.action) ||
        !same(this.machines.caller(), found.consumer) ||
        !same(this.machines.consumer(step.consumer), found.consumer)
      )
        fail('动作票据消费者或动作不符');
      if (
        r.cancelled ||
        ['containing', 'stopped', 'released', 'unknown'].includes(r.state) ||
        Date.now() >= Date.parse(r.input.runDeadline)
      )
        fail('业务权能已撤销');
      if (step.action === 'inject' && Date.now() >= Date.parse(r.input.faultDeadline)) fail('故障已到期');
      await captureOperationCheck()();
      await this.machines.assertIdentity(r.input.identity);
      return r;
    }
    return fail('动作票据无效');
  }
  private evidence(
    r: Row,
    effect: DrillEvidence['effect'],
    containment: DrillEvidence['containment'],
    detail: string,
    deadlineBreach = false,
  ) {
    return drillEvidenceSchema.parse({
      id: randomUUID(),
      runId: r.input.runId,
      identity: r.input.identity,
      at: new Date().toISOString(),
      effect,
      containment,
      detail,
      deadlineBreach,
    });
  }
  async inject(t: DrillToken, key: string) {
    z.uuid().parse(key);
    let r = await this.action(t, ['inject']);
    // 基线有固定准入余量；仅在不可变截止前的已批准故障窗口内开始注入。
    // Baseline admission has a fixed margin; injection begins only inside the approved window ending at the immutable deadline.
    const startsAt = Date.parse(r.input.faultDeadline) - r.input.parameters.durationSeconds * 1000;
    while (Date.now() < startsAt) {
      await delay(Math.min(100, startsAt - Date.now()));
      r = await this.action(t, ['inject']);
    }
    if (Date.parse(r.input.faultDeadline) - Date.now() > 120000)
      fail('故障剩余期限超过 120 秒', 'RESILIENCE_BUDGET_EXCEEDED');
    if (!(await (await this.watchdogs.reconnect(r.input.runId)).alive()))
      fail('宿主独立监管原进程已丢失', 'RESILIENCE_GUARD_UNAVAILABLE');
    if (r.intent) {
      if (r.intent === key && r.evidence) return r.evidence;
      fail('原意图已存在，必须核销，不能重放', 'RESILIENCE_EFFECT_UNKNOWN');
    }
    await this.transaction((s) => {
      const x = s.rows.find((x) => x.input.runId === r.input.runId)!;
      if (x.intent || x.state !== 'armed' || x.cancelled) fail('故障准入已变化');
      x.intent = key;
      x.state = 'injecting';
    });
    try {
      if (r.input.parameters.fault === 'checkpoint') {
        const watcher = await this.watchdogs.reconnect(r.input.runId);
        await watcher.contain();
        const deadline = Date.now() + 5000;
        let stopped = false;
        while (Date.now() < deadline) {
          stopped = (await watcher.read()).some((e) => e.kind === 'stopped');
          if (stopped) break;
          await delay(25);
        }
        const ev = this.evidence(
          r,
          stopped ? 'observed' : 'unknown',
          stopped ? 'confirmed' : 'unknown',
          '检查点故障：原 VM 精确进程停止' + (stopped ? '已确认' : '未确认'),
        );
        await this.transaction((s) => {
          const x = s.rows.find((x) => x.input.runId === r.input.runId)!;
          x.state = stopped ? 'withdrawn' : 'unknown';
          x.evidence = ev;
        });
        return ev;
      }
      const observed = z
        .object({ effect: z.enum(['observed', 'absent', 'unknown']), detail: z.string().max(4096) })
        .strict()
        .parse(
          await this.machines.guest(r.input.identity, 'inject', {
            runId: r.input.runId,
            parameters: r.input.parameters,
          }),
        );
      const ev = this.evidence(r, observed.effect, 'pending', observed.detail);
      await this.transaction((s) => {
        const x = s.rows.find((x) => x.input.runId === r.input.runId)!;
        x.evidence = ev;
        if (!x.cancelled) x.state = observed.effect === 'observed' ? 'injected' : 'unknown';
      });
      return ev;
    } catch (e) {
      await this.transaction((s) => {
        s.rows.find((x) => x.input.runId === r.input.runId)!.state = 'unknown';
      });
      throw e;
    }
  }
  async observe(t: DrillToken) {
    const r = await this.action(t, ['inject', 'observe']);
    const result = z
      .object({ effect: z.enum(['observed', 'absent', 'unknown']), detail: z.string().max(4096) })
      .strict()
      .parse(await this.machines.guest(r.input.identity, 'observe', { runId: r.input.runId }));
    return this.evidence(r, result.effect, 'pending', result.detail);
  }
  async probe(t: DrillToken, requestId: string) {
    z.string()
      .regex(/^[a-z0-9-]{1,100}$/)
      .parse(requestId);
    const r = await this.action(t, ['baseline', 'observe', 'verify']);
    return drillSampleSchema.parse(
      await this.machines.guest(r.input.identity, 'probe', { runId: r.input.runId, requestId }),
    );
  }
  async recover(t: DrillToken) {
    const r = await this.action(t, ['restart']);
    if (r.state !== 'withdrawn') fail('原故障尚未撤回');
    const result = z
      .object({ effect: z.enum(['observed', 'absent', 'unknown']), detail: z.string().max(4096) })
      .strict()
      .parse(await this.machines.guest(r.input.identity, 'restart', { runId: r.input.runId }));
    return this.evidence(r, result.effect, 'confirmed', result.detail);
  }
  async contain(t: DrillToken, reason: 'cancelled' | 'expired' | 'reconcile' | 'withdraw') {
    z.enum(['cancelled', 'expired', 'reconcile', 'withdraw']).parse(reason);
    const r = await this.transaction((s) => {
      const r = this.find(s, t, 'lease', reason !== 'withdraw');
      if (reason !== 'withdraw') r.cancelled = true;
      if (r.state !== 'released') r.state = 'containing';
      return r;
    });
    if (r.state === 'released' && r.evidence) return r.evidence;
    if (!r.watchdogIntent) return this.retireUnstarted(r);
    let guard;
    try {
      guard = await this.watchdogs.reconnect(r.input.runId);
    } catch {
      return this.reconcile(t);
    }
    try {
      await this.machines.assertIdentity(r.input.identity);
      const result = z
        .object({ effect: z.enum(['observed', 'absent', 'unknown']), detail: z.string().max(4096) })
        .strict()
        .parse(await this.machines.guest(r.input.identity, 'withdraw', { runId: r.input.runId }));
      if (result.effect !== 'absent') throw new Error('原故障撤回未确认');
      if (reason === 'withdraw' && !r.cancelled && Date.now() < Date.parse(r.input.faultDeadline)) {
        await guard.withdrawn();
        const ev = this.evidence(r, 'absent', 'confirmed', result.detail);
        await this.transaction((s) => {
          const x = s.rows.find((x) => x.input.runId === r.input.runId)!;
          x.state = x.cancelled ? 'containing' : 'withdrawn';
          x.evidence = ev;
        });
        return ev;
      }
    } catch {}
    await guard.contain();
    return this.reconcile(t);
  }
  async reconcile(t: DrillToken) {
    const r = this.find((await this.read()).value, t, 'lease', true);
    if (r.state === 'released' && r.evidence) return r.evidence;
    if (!r.watchdogIntent) return this.retireUnstarted(r);
    let events: DrillWatchdogEvent[] = [];
    let queryFailed = false;
    try {
      events = await (await this.watchdogs.reconnect(r.input.runId)).read();
    } catch {
      queryFailed = true;
    }
    const stopped = events.find((e) => e.kind === 'stopped');
    let independentlyStopped = false;
    if (!stopped && this.machines.confirmStopped) {
      try {
        independentlyStopped = await this.machines.confirmStopped(r.input.identity);
      } catch {
        queryFailed = true;
      }
    }
    const confirmed = !!stopped || independentlyStopped;
    const ev = this.evidence(
      r,
      confirmed ? 'absent' : 'unknown',
      confirmed ? 'confirmed' : 'unknown',
      stopped
        ? '原精确进程句柄已退出'
        : independentlyStopped
          ? '本体核验原 PID 与创建时间对应进程已不存在；仅用于资源核销，不证明故障截止及时性'
          : queryFailed
            ? '原进程退出证据查询失败，保留未知状态'
            : '监管未提供原进程退出证据',
      !!stopped &&
        stopped.at > Date.parse(r.input.faultDeadline) + 5000 &&
        stopped.reason === 'fault-deadline',
    );
    if (confirmed)
      await this.transaction((s) => {
        const x = s.rows.find((x) => x.input.runId === r.input.runId)!;
        if (x.state !== 'released') x.state = 'stopped';
        x.cancelled = true;
        x.evidence = ev;
      });
    return ev;
  }
  async release(t: DrillToken) {
    const ev = await this.reconcile(t);
    if (ev.containment !== 'confirmed')
      fail('原进程停止未确认，保留账本和额度', 'RESILIENCE_CLEANUP_PENDING');
    const r = this.find((await this.read()).value, t, 'lease', true);
    await this.machines.release(r.input.identity, r.input.runId);
    await this.transaction((s) => {
      this.find(s, t, 'lease', true).state = 'released';
    });
    return ev;
  }
}
