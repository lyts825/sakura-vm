/** 演练编排仅调用声明服务；每个副作用先写意图，重启不重放。
 * Orchestration uses declared services; durable intents precede effects and restart never replays them. */
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import type { PluginMetadata } from './plugin-metadata.ts';
import { Jobs } from './jobs.ts';
import type {
  ResilienceRunsV1,
  ResilienceTargetsV1,
  ResilienceFixturesV1,
  ResilienceGuardV1,
  ResilienceFaultsV1,
  ResilienceProbesV1,
  ResilienceRecoveryV1,
  ResilienceScenariosV1,
} from './service-contracts/resilience-lab.ts';
import {
  resilienceRunSchema,
  resiliencePlanSchema,
  type ResilienceScope as Scope,
  type ResilienceRef as Ref,
  type ResilienceRun as Run,
} from '../shared/contracts/resilience-lab.ts';
import {
  ResilienceStore,
  resilienceHash,
  resilienceId,
  resilienceNow,
  resilienceError,
  resilienceActor,
  sameScope,
  type ResilienceAuthorize,
} from './resilience-store.ts';
const schema = z
  .object({
    generation: z.string().nullable(),
    runs: z.array(resilienceRunSchema).max(1000),
    plans: z.array(resiliencePlanSchema).max(1000),
    approvals: z
      .array(
        z.object({ planId: z.uuid(), actor: z.string(), digest: z.string(), consumed: z.boolean() }).strict(),
      )
      .max(1000),
  })
  .strict();
export class ResilienceRuns implements ResilienceRunsV1 {
  readonly jobs = new Jobs('resilience-runs');
  private store: ResilienceStore<z.infer<typeof schema>>;
  private generation = resilienceId();
  private controllers = new Map<string, AbortController>();
  private reconciliations = new Set<string>();
  constructor(
    metadata: PluginMetadata<unknown>,
    private targets: ResilienceTargetsV1,
    private fixtures: ResilienceFixturesV1,
    private guard: ResilienceGuardV1,
    private faults: ResilienceFaultsV1,
    private probes: ResilienceProbesV1,
    private recovery: ResilienceRecoveryV1,
    private scenarios: ResilienceScenariosV1,
    authorize: ResilienceAuthorize,
  ) {
    this.store = new ResilienceStore(
      metadata,
      schema,
      () => ({ generation: null, runs: [], plans: [], approvals: [] }),
      authorize,
    );
  }
  async init() {
    await this.store.recover((s) => {
      if (s.generation !== this.generation) {
        for (const r of s.runs)
          if (r.state !== 'completed') {
            r.state = 'reconcile-required';
            r.outcome = 'inconclusive';
            r.containment = 'unknown';
            r.cleanup = 'unknown';
            r.error = '控制器重启，核销原资源后才能运行新计划';
          }
        s.generation = this.generation;
      }
    });
  }
  async view(scope: Scope) {
    return (await this.store.read(scope)).runs.filter((x) => sameScope(x.scope, scope));
  }
  async get(scope: Scope, id: string) {
    return (await this.view(scope)).find((x) => x.id === id) || resilienceError('原运行不存在');
  }
  async preview(scope: Scope, ref: Ref) {
    const scenario = await this.scenarios.get(scope, ref),
      target = await this.targets.get(scope, scenario.target),
      capabilities = await this.guard.view(scope);
    const base = {
      id: resilienceId(),
      scope,
      scenario,
      target,
      createdAt: resilienceNow(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      state: 'previewed' as const,
      gaps: capabilities.available
        ? []
        : capabilities.gaps.length
          ? capabilities.gaps
          : ['双层监管尚未通过实机验证'],
      budget: {
        replicas: 2 as const,
        memoryMiB: target.memoryMiB * 2,
        cpus: target.cpus * 2,
        diskGiB: 64 as const,
        runSeconds: 1200 as const,
      },
    };
    const plan = resiliencePlanSchema.parse({ ...base, digest: resilienceHash(base) });
    return this.store.mutate(scope, (s) => {
      s.plans.push(plan);
      return plan;
    });
  }
  async approve(scope: Scope, id: string, digest: string) {
    return this.store.mutate(scope, (s) => {
      const p = s.plans.find((x) => x.id === id && sameScope(x.scope, scope));
      if (!p || p.digest !== digest || p.state !== 'previewed' || Date.now() >= Date.parse(p.expiresAt))
        resilienceError('预览修订失效或已批准');
      if (p.gaps.length) resilienceError(p.gaps.join('；'), 'RESILIENCE_GUARD_UNAVAILABLE');
      p.state = 'approved';
      s.approvals.push({ planId: id, actor: resilienceActor(), digest, consumed: false });
      return p;
    });
  }
  async start(scope: Scope, id: string) {
    const run = await this.store.mutate(scope, (s) => {
      const p = s.plans.find((x) => x.id === id && sameScope(x.scope, scope)),
        a = s.approvals.find((x) => x.planId === id);
      if (
        !p ||
        !a ||
        a.actor !== resilienceActor() ||
        a.consumed ||
        p.state !== 'approved' ||
        Date.now() >= Date.parse(p.expiresAt)
      )
        resilienceError('批准不属于当前 owner 或已消费');
      if (s.runs.some((x) => x.state !== 'completed'))
        resilienceError('已有运行或核销责任未结束', 'RESILIENCE_RESOURCE_BUSY');
      a.consumed = true;
      p.state = 'consumed';
      const r = resilienceRunSchema.parse({
        id: resilienceId(),
        scope,
        plan: p,
        state: 'queued',
        outcome: 'inconclusive',
        containment: 'pending',
        cleanup: 'pending',
        createdAt: resilienceNow(),
        updatedAt: resilienceNow(),
        replicas: [],
        segments: [],
        evidence: [],
        intents: [],
        error: '',
        jobId: null,
        cancelled: false,
      });
      s.runs.push(r);
      return r;
    });
    const controller = new AbortController();
    this.controllers.set(run.id, controller);
    const job = this.jobs.start(run.id, async (_log, jobSignal) => {
      const signal = AbortSignal.any([controller.signal, jobSignal]);
      try {
        await this.execute(scope, run.id, signal);
      } finally {
        this.controllers.delete(run.id);
      }
    });
    await this.patch(scope, run.id, (r) => {
      r.jobId = job.id || null;
    });
    return this.get(scope, run.id);
  }
  private patch(scope: Scope, id: string, fn: (r: Run) => void) {
    return this.store.mutate(scope, (s) => {
      const r = s.runs.find((x) => x.id === id && sameScope(x.scope, scope));
      if (!r) resilienceError('运行不存在');
      fn(r);
      r.updatedAt = resilienceNow();
      return r;
    });
  }
  private async intent<T>(scope: Scope, id: string, step: string, fn: () => Promise<T>) {
    const intent = resilienceId();
    await this.patch(scope, id, (r) => {
      r.intents.push({ id: intent, step, at: resilienceNow(), status: 'pending' });
    });
    try {
      const value = await fn();
      await this.patch(scope, id, (r) => {
        r.intents.find((x) => x.id === intent)!.status = 'confirmed';
      });
      return value;
    } catch (e) {
      await this.patch(scope, id, (r) => {
        r.intents.find((x) => x.id === intent)!.status = 'unknown';
      });
      throw e;
    }
  }
  private async execute(scope: Scope, id: string, signal: AbortSignal) {
    let armed = false;
    try {
      const run = await this.get(scope, id);
      await this.targets.get(scope, run.plan.scenario.target);
      await this.scenarios.get(scope, { id: run.plan.scenario.id, revision: run.plan.scenario.revision });
      signal.throwIfAborted();
      await this.patch(scope, id, (r) => {
        r.state = 'preparing';
      });
      const replica = await this.intent(scope, id, 'create-replica', () =>
        this.fixtures.prepare(scope, run.plan.scenario.target, id),
      );
      await this.patch(scope, id, (r) => {
        r.replicas.push(replica.id);
      });
      signal.throwIfAborted();
      armed = true;
      await this.intent(scope, id, 'arm', () => this.guard.arm(scope, run.plan, replica, id));
      await this.patch(scope, id, (r) => {
        r.state = 'baselining';
      });
      const baseline = await this.probes.collect(scope, id, 'baseline', run.plan.scenario, signal);
      await this.patch(scope, id, (r) => {
        r.segments.push(baseline.id);
      });
      if (!baseline.passed) resilienceError('正常基线未通过，未注入故障', 'RESILIENCE_RECOVERY_FAILED');
      signal.throwIfAborted();
      await this.patch(scope, id, (r) => {
        r.state = 'injecting';
      });
      const fault = await this.intent(scope, id, 'inject', () =>
        this.faults.inject(scope, id, resilienceId()),
      );
      await this.patch(scope, id, (r) => {
        r.evidence.push(fault);
      });
      if (fault.effect !== 'observed') resilienceError('故障副作用未观察到', 'RESILIENCE_EFFECT_UNKNOWN');
      if (run.plan.scenario.parameters.fault !== 'checkpoint') {
        await this.patch(scope, id, (r) => {
          r.state = 'observing';
        });
        const observed = await this.probes.collect(scope, id, 'fault', run.plan.scenario, signal);
        await this.patch(scope, id, (r) => {
          r.segments.push(observed.id);
        });
        if (!observed.count) resilienceError('故障阶段没有业务样本');
      }
      signal.throwIfAborted();
      await this.patch(scope, id, (r) => {
        r.state = 'recovering';
      });
      const strategy =
        run.plan.scenario.parameters.fault === 'checkpoint'
          ? 'checkpoint'
          : run.plan.scenario.parameters.fault === 'process'
            ? 'restart'
            : 'observe';
      const recovery = await this.recovery.preview(scope, id, strategy);
      const restored = await this.intent(scope, id, 'recover', () =>
        this.recovery.apply(scope, recovery.id, recovery.digest),
      );
      await this.patch(scope, id, (r) => {
        r.evidence.push(restored);
      });
      const all = (await this.fixtures.view(scope)).filter((x) => x.runId === id);
      await this.patch(scope, id, (r) => {
        r.replicas = all.map((x) => x.id);
        r.state = 'verifying';
      });
      const verified = await this.probes.collect(scope, id, 'recovery', run.plan.scenario, signal);
      await this.patch(scope, id, (r) => {
        r.segments.push(verified.id);
      });
      if (!verified.passed) resilienceError('恢复业务与读回断言未通过', 'RESILIENCE_RECOVERY_FAILED');
      await this.patch(scope, id, (r) => {
        r.outcome = 'passed';
      });
    } catch (e) {
      await this.patch(scope, id, (r) => {
        r.outcome = signal.aborted ? 'cancelled' : 'failed';
        r.error = String(e).slice(0, 4096);
        r.cancelled = signal.aborted;
      });
    } finally {
      await this.finish(scope, id, armed);
    }
  }
  private async finish(scope: Scope, id: string, armed: boolean) {
    await this.patch(scope, id, (r) => {
      r.state = 'containing';
    });
    let contained = !armed;
    try {
      if (armed) {
        await this.guard.contain(scope, id);
        let evidence = await this.guard.reconcile(scope, id);
        for (let i = 0; i < 100 && evidence.containment !== 'confirmed'; i++) {
          await delay(50);
          evidence = await this.guard.reconcile(scope, id);
        }
        contained = evidence.containment === 'confirmed';
        await this.patch(scope, id, (r) => {
          r.containment = evidence.containment;
          r.evidence.push(evidence);
          if (evidence.deadlineBreach) r.outcome = 'failed';
        });
      } else
        await this.patch(scope, id, (r) => {
          r.containment = 'confirmed';
        });
      if (!contained) resilienceError('原副作用尚未核销', 'RESILIENCE_CLEANUP_PENDING');
      await this.patch(scope, id, (r) => {
        r.state = 'cleaning';
      });
      const replicas = (await this.fixtures.view(scope)).filter((x) => x.runId === id);
      await this.patch(scope, id, (r) => {
        r.replicas = replicas.map((x) => x.id);
      });
      for (const replica of replicas) {
        if (replica.cleanup !== 'confirmed')
          await this.intent(scope, id, 'cleanup-' + replica.id, async () =>
            this.fixtures.cleanup(scope, await this.fixtures.cleanupPreview(scope, replica.id)),
          );
      }
      if (armed) await this.guard.release(scope, id);
      await this.patch(scope, id, (r) => {
        r.cleanup = 'confirmed';
        r.state = 'completed';
        if (r.intents.some((x) => x.status !== 'confirmed') && r.outcome === 'passed')
          r.outcome = 'inconclusive';
      });
    } catch (e) {
      await this.patch(scope, id, (r) => {
        r.state = 'reconcile-required';
        r.cleanup = 'unknown';
        if (r.outcome === 'passed') r.outcome = 'inconclusive';
        r.error = (r.error + '；' + String(e)).slice(-4096);
      });
    }
  }
  async cancel(scope: Scope, id: string) {
    const current = await this.get(scope, id);
    if (current.state === 'completed') return current;
    const run = await this.patch(scope, id, (r) => {
      if (r.state !== 'completed') r.cancelled = true;
    });
    if (run.state === 'completed') return run;
    const controller = this.controllers.get(id);
    if (controller) {
      controller.abort(new Error('用户取消演练'));
      // Fence the core lease immediately, including while inject is waiting for its fixed window.
      if (run.intents.some((intent) => intent.step === 'arm')) {
        try {
          await this.guard.contain(scope, id);
        } catch (error) {
          await this.patch(scope, id, (r) => {
            r.error = ('取消收尾待核销：' + String(error)).slice(0, 4096);
          });
        }
      }
      return this.get(scope, id);
    }
    return this.reconcile(scope, id);
  }
  async reconcile(scope: Scope, id: string) {
    return this.reconcileLocked(scope, id);
  }
  /** 仅由原插件装配的委派适配器调用；未加入既有 ResilienceRunsV1 公共面。 */
  async reconcileDelegated(
    scope: Scope,
    id: string,
    expectedDigest: string,
    signal: AbortSignal,
    beforeDispatch: () => Promise<void>,
  ) {
    return this.reconcileLocked(scope, id, async (run) => {
      signal.throwIfAborted();
      if (resilienceHash(run) !== expectedDigest) resilienceError('原运行修订已改变，请重新预览和批准');
      await beforeDispatch();
      signal.throwIfAborted();
    });
  }
  private async reconcileLocked(scope: Scope, id: string, beforeDispatch?: (run: Run) => Promise<void>) {
    if (this.reconciliations.has(id)) resilienceError('原运行正在核销', 'RESILIENCE_RESOURCE_BUSY');
    this.reconciliations.add(id);
    try {
      const run = await this.get(scope, id);
      if (this.controllers.has(id)) resilienceError('活动运行须先取消，等待原处理器收尾');
      await beforeDispatch?.(run);
      if (run.state === 'completed') {
        if (run.cleanup === 'confirmed' && run.intents.some((intent) => intent.step === 'arm'))
          await this.guard.release(scope, id);
        return run;
      }
      await this.finish(
        scope,
        id,
        run.intents.some((x) => x.step === 'arm'),
      );
      return this.get(scope, id);
    } finally {
      this.reconciliations.delete(id);
    }
  }
  async close() {
    for (const c of this.controllers.values()) c.abort(new Error('插件停用'));
    await this.jobs.close();
  }
}
