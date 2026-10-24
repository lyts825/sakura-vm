/** 已批准恢复与安全收尾分离；检查点交接保留旧副本身份。
 * Approved recovery is separate from containment and preserves the retired replica identity. */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { DrillSupervisionV1 } from './service-contracts/drill-supervision.ts';
import type {
  ResilienceRecoveryV1,
  ResilienceGuardV1,
  ResilienceFixturesV1,
  ResilienceProbesV1,
} from './service-contracts/resilience-lab.ts';
import {
  resilienceRecoveryPlanSchema,
  type ResilienceScope as Scope,
  type ResilienceRecoveryPlan as Plan,
} from '../shared/contracts/resilience-lab.ts';
import {
  ResilienceStore,
  resilienceHash,
  resilienceId,
  resilienceError,
  sameScope,
  type ResilienceAuthorize,
} from './resilience-store.ts';
const schema = z.object({ rows: z.array(resilienceRecoveryPlanSchema).max(1000) }).strict();
export class ResilienceRecovery implements ResilienceRecoveryV1 {
  private store: ResilienceStore<z.infer<typeof schema>>;
  constructor(
    metadata: PluginMetadata<unknown>,
    private guard: ResilienceGuardV1,
    private fixtures: ResilienceFixturesV1,
    private core: DrillSupervisionV1,
    private probes: ResilienceProbesV1,
    authorize: ResilienceAuthorize,
  ) {
    this.store = new ResilienceStore(metadata, schema, () => ({ rows: [] }), authorize);
  }
  async preview(scope: Scope, runId: string, strategy: Plan['strategy']) {
    const binding = await this.guard.binding(scope, runId),
      fault = binding.plan.scenario.parameters.fault;
    const required = fault === 'checkpoint' ? 'checkpoint' : fault === 'process' ? 'restart' : 'observe';
    if (strategy !== required) resilienceError('恢复动作不在原场景批准中');
    const data = {
      id: resilienceId(),
      scope,
      runId,
      strategy,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      consumed: false,
    };
    return this.store.mutate(scope, (s) => {
      const plan = resilienceRecoveryPlanSchema.parse({
        ...data,
        digest: resilienceHash({
          ...data,
          planDigest: binding.plan.digest,
          identity: binding.replica.identity,
        }),
      });
      s.rows.push(plan);
      return plan;
    });
  }
  async apply(scope: Scope, id: string, digest: string) {
    const plan = await this.store.mutate(scope, (s) => {
      const p = s.rows.find((x) => sameScope(x.scope, scope) && x.id === id && x.digest === digest);
      if (!p || p.consumed || Date.now() >= Date.parse(p.expiresAt)) resilienceError('恢复计划过期或已消费');
      p.consumed = true;
      return p;
    });
    if (plan.strategy === 'observe') return this.guard.withdraw(scope, plan.runId);
    if (plan.strategy === 'restart') {
      await this.guard.withdraw(scope, plan.runId);
      return this.core.recover(await this.guard.ticket(scope, plan.runId, 3));
    }
    const binding = await this.guard.binding(scope, plan.runId);
    const checkpoint = await this.fixtures.checkpoint(scope, binding.replica.id);
    if (!checkpoint.checkpoint) resilienceError('未取得检查点');
    const baseline = (await this.probes.view(scope, plan.runId)).find(
      (x) => x.phase === 'baseline' && x.passed,
    );
    if (!baseline) resilienceError('缺少已确认的基线写入集合');
    const replica = await this.fixtures.restore(
      scope,
      binding.replica.id,
      plan.runId,
      baseline.samples.filter((x) => x.ok).map((x) => x.requestId),
    );
    await this.guard.handoff(scope, plan.runId, replica);
    return this.guard.withdraw(scope, plan.runId);
  }
}
