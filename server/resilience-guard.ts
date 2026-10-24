/** guard 管理准入与安全收尾，动作票据只交给计划登记的实际消费者。
 * Guard owns admission and containment; action tickets go only to their declared consumers. */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { DrillSupervisionV1 } from './service-contracts/drill-supervision.ts';
import type { ResilienceGuardV1, ResilienceFixturesV1 } from './service-contracts/resilience-lab.ts';
import { drillTokenSchema } from '../shared/contracts/drill-supervision.ts';
import {
  resilienceScopeSchema,
  resiliencePlanSchema,
  resilienceReplicaSchema,
  type ResilienceScope as Scope,
  type ResiliencePlan as Plan,
  type ResilienceReplica as Replica,
} from '../shared/contracts/resilience-lab.ts';
import {
  ResilienceStore,
  resilienceError,
  sameScope,
  resilienceConsumer,
  type ResilienceAuthorize,
} from './resilience-store.ts';
const schema = z
  .object({
    rows: z
      .array(
        z
          .object({
            scope: resilienceScopeSchema,
            runId: z.uuid(),
            plan: resiliencePlanSchema,
            replica: resilienceReplicaSchema,
            lease: drillTokenSchema.nullable(),
            delegation: drillTokenSchema.nullable().default(null),
            runDeadline: z.iso.datetime().nullable().default(null),
            state: z.enum(['arming', 'armed', 'released', 'unknown']),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
const steps = [
  { id: 0, consumer: 'resilience-probes', action: 'baseline' },
  { id: 1, consumer: 'resilience-faults', action: 'inject' },
  { id: 2, consumer: 'resilience-probes', action: 'observe' },
  { id: 3, consumer: 'resilience-recovery', action: 'restart' },
  { id: 4, consumer: 'resilience-probes', action: 'verify' },
] as const;
export class ResilienceGuard implements ResilienceGuardV1 {
  private store: ResilienceStore<z.infer<typeof schema>>;
  constructor(
    metadata: PluginMetadata<unknown>,
    private fixtures: ResilienceFixturesV1,
    private core: DrillSupervisionV1,
    authorize: ResilienceAuthorize,
  ) {
    this.store = new ResilienceStore(metadata, schema, () => ({ rows: [] }), authorize);
  }
  async view(scope: Scope) {
    await this.store.authorize(scope);
    return this.core.capabilities();
  }
  private async row(scope: Scope, runId: string) {
    return (
      (await this.store.read(scope)).rows.find((x) => sameScope(x.scope, scope) && x.runId === runId) ||
      resilienceError('监管原租约不存在')
    );
  }
  private async recover(scope: Scope, runId: string) {
    const r = await this.row(scope, runId);
    if (r.lease || !r.delegation) return r;
    try {
      const lease = await this.core.recoverLease(r.delegation);
      await this.store.mutate(scope, (s) => {
        s.rows.find((x) => x.runId === runId)!.lease = lease;
      });
      return { ...r, lease };
    } catch {
      return r;
    }
  }
  async arm(scope: Scope, plan: Plan, replica: Replica, runId: string) {
    resilienceConsumer('resilience-runs');
    if (
      plan.state !== 'consumed' ||
      !sameScope(plan.scope, scope) ||
      replica.target.id !== plan.target.id ||
      replica.target.revision !== plan.target.revision
    )
      resilienceError('批准计划与副本不匹配');
    await this.store.mutate(scope, (s) => {
      if (s.rows.some((x) => x.state !== 'released'))
        resilienceError('已有未核销监管责任', 'RESILIENCE_RESOURCE_BUSY');
      s.rows.push({
        scope,
        runId,
        plan,
        replica,
        lease: null,
        delegation: null,
        runDeadline: null,
        state: 'arming',
      });
    });
    try {
      const now = Date.now(),
        delegation = await this.fixtures.authorizeDrill(scope, replica.id, {
          runId: replica.id,
          planDigest: plan.digest,
          parameters: plan.scenario.parameters,
          steps: [...steps],
          faultDeadline: new Date(
            now + 90000 + plan.scenario.parameters.durationSeconds * 1000,
          ).toISOString(),
          runDeadline: new Date(Math.min(now + 1200000, Date.parse(plan.createdAt) + 1200000)).toISOString(),
        });
      await this.store.mutate(scope, (s) => {
        const r = s.rows.find((x) => x.runId === runId)!;
        r.delegation = delegation;
        r.runDeadline = new Date(Math.min(now + 1200000, Date.parse(plan.createdAt) + 1200000)).toISOString();
      });
      const lease = await this.core.arm(delegation);
      await this.store.mutate(scope, (s) => {
        const r = s.rows.find((x) => x.runId === runId)!;
        r.lease = lease;
        r.state = 'armed';
      });
    } catch (e) {
      await this.store.mutate(scope, (s) => {
        s.rows.find((x) => x.runId === runId)!.state = 'unknown';
      });
      throw e;
    }
  }
  async ticket(scope: Scope, runId: string, stepId: number) {
    const step = steps.find((s) => s.id === stepId);
    if (!step) resilienceError('步骤未登记');
    resilienceConsumer(step.consumer);
    const r = await this.row(scope, runId);
    if (!r.lease || r.state !== 'armed') resilienceError('原管理租约不可用');
    return this.core.authorizeStep(r.lease, stepId);
  }
  async binding(scope: Scope, runId: string) {
    resilienceConsumer('resilience-recovery');
    const r = await this.row(scope, runId);
    return { plan: r.plan, replica: r.replica };
  }
  async handoff(scope: Scope, runId: string, replica: Replica) {
    resilienceConsumer('resilience-recovery');
    const r = await this.row(scope, runId);
    if (!r.lease || r.plan.scenario.parameters.fault !== 'checkpoint' || replica.runId !== runId)
      resilienceError('恢复交接不在原计划中');
    const old = await this.core.release(r.lease);
    if (old.containment !== 'confirmed') resilienceError('旧执行权未撤销');
    const now = Date.now(),
      d = await this.fixtures.authorizeDrill(scope, replica.id, {
        runId: replica.id,
        planDigest: r.plan.digest,
        parameters: r.plan.scenario.parameters,
        steps: [...steps],
        faultDeadline: new Date(now + 60000).toISOString(),
        runDeadline: r.runDeadline || resilienceError('原运行绝对截止缺失'),
      });
    await this.store.mutate(scope, (s) => {
      const row = s.rows.find((x) => x.runId === runId)!;
      row.delegation = d;
      row.lease = null;
      row.replica = replica;
      row.state = 'arming';
    });
    const lease = await this.core.arm(d);
    await this.core.contain(lease, 'withdraw');
    await this.store.mutate(scope, (s) => {
      const row = s.rows.find((x) => x.runId === runId)!;
      row.replica = replica;
      row.lease = lease;
      row.state = 'armed';
    });
  }
  async withdraw(scope: Scope, runId: string) {
    resilienceConsumer('resilience-runs', 'resilience-recovery');
    const r = await this.row(scope, runId);
    if (!r.lease) resilienceError('缺少原管理租约');
    return this.core.contain(r.lease, 'withdraw');
  }
  async contain(scope: Scope, runId: string) {
    const r = await this.recover(scope, runId);
    if (!r.lease && r.delegation) {
      const evidence = await this.core.retireDelegation(r.delegation);
      await this.store.mutate(scope, (s) => {
        s.rows.find((x) => x.runId === runId)!.state = 'released';
      });
      return evidence;
    }
    if (!r.lease) resilienceError('原监管启动未知，保留核销入口', 'RESILIENCE_CLEANUP_PENDING');
    return this.core.contain(r.lease, 'cancelled');
  }
  async reconcile(scope: Scope, runId: string) {
    const r = await this.recover(scope, runId);
    if (!r.lease && r.delegation) return this.core.retireDelegation(r.delegation);
    if (!r.lease) resilienceError('监管启动无回执，须在本体核销', 'RESILIENCE_CLEANUP_PENDING');
    return this.core.reconcile(r.lease);
  }
  async release(scope: Scope, runId: string) {
    resilienceConsumer('resilience-runs');
    const r = await this.recover(scope, runId);
    if (!r.lease && r.delegation) {
      const evidence = await this.core.retireDelegation(r.delegation);
      await this.store.mutate(scope, (s) => {
        s.rows.find((x) => x.runId === runId)!.state = 'released';
      });
      return evidence;
    }
    if (!r.lease) resilienceError('原监管无回执');
    const ev = await this.core.release(r.lease);
    await this.store.mutate(scope, (s) => {
      s.rows.find((x) => x.runId === runId)!.state = 'released';
    });
    return ev;
  }
}
