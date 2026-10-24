/** 固定模拟负载配置；执行仍通过受管运行器。 Fixed mock load profiles using the runner service. */
import type { PluginMetadata } from './plugin-metadata.ts';
import type {
  IntegrationLoadV1,
  IntegrationSpecsV1,
  IntegrationRunnersV1,
  IntegrationScenariosV1,
  IntegrationEnvironmentsV1,
} from './service-contracts/integration-lab.ts';
import { IntegrationDefinitions, ilSealed, ilFail } from './integration-store.ts';
import {
  loadProfileSchema,
  type IntegrationLoadProfile,
  type IntegrationScope,
  type IntegrationRef,
} from '../shared/contracts/integration-lab.ts';
export class IntegrationLoad
  extends IntegrationDefinitions<IntegrationLoadProfile>
  implements IntegrationLoadV1
{
  constructor(
    meta: PluginMetadata,
    specs: IntegrationSpecsV1,
    private runners: IntegrationRunnersV1,
    private scenarios: IntegrationScenariosV1,
    private environments: IntegrationEnvironmentsV1,
  ) {
    super(meta, loadProfileSchema, specs, 'load');
  }
  protected override dependencyRefs(v: IntegrationLoadProfile) {
    return [v.run.scenario, v.run.assertions, ...(v.run.mock ? [v.run.mock] : [])];
  }
  protected override async validate(scope: IntegrationScope, value: IntegrationLoadProfile) {
    const scenario = (await ilSealed(this.scenarios, scope, value.run.scenario)).content;
    const env = (await ilSealed(this.environments, scope, scenario.environment)).content;
    if (
      env.target.kind !== 'mock' ||
      !value.run.mock ||
      value.run.durationSeconds > 60 ||
      scenario.nodes.some((n) => n.bindings.length || n.condition)
    )
      ilFail('LOAD_ONLY_FIXED_MOCK');
  }
  async preview(scope: IntegrationScope, ref: IntegrationRef) {
    const row = await ilSealed(this, scope, ref);
    await this.validate(scope, row.content);
    return this.runners.preview(scope, row.content.run);
  }
  async apply(scope: IntegrationScope, input: { planId: string; digest: string; approveWrites: boolean }) {
    const plan = (await this.runners.plans(scope)).find((p) => p.id === input.planId);
    if (plan?.mode !== 'load') ilFail('LOAD_PLAN_REQUIRED');
    return this.runners.apply(scope, input);
  }
}
