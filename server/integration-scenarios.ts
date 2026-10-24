/** 固定输入与串行 DAG 编译；依赖变量只能写入声明字段。 Frozen scenario compilation. */
import type { PluginMetadata } from './plugin-metadata.ts';
import type {
  IntegrationScenariosV1,
  IntegrationSpecsV1,
  IntegrationFixturesV1,
  IntegrationEnvironmentsV1,
} from './service-contracts/integration-lab.ts';
import { IntegrationDefinitions, ilSealed, ilFail } from './integration-store.ts';
import { compileScenario } from './integration-validation.ts';
import {
  scenarioSchema,
  type IntegrationScenario,
  type IntegrationScope,
  type IntegrationRef,
} from '../shared/contracts/integration-lab.ts';
export class IntegrationScenarios
  extends IntegrationDefinitions<IntegrationScenario>
  implements IntegrationScenariosV1
{
  constructor(
    meta: PluginMetadata,
    specs: IntegrationSpecsV1,
    private fixtures: IntegrationFixturesV1,
    private environments: IntegrationEnvironmentsV1,
  ) {
    super(meta, scenarioSchema, specs, 'scenarios');
  }
  protected override dependencyRefs(v: IntegrationScenario) {
    return [v.contract, v.environment, ...v.fixtures];
  }
  protected override async validate(scope: IntegrationScope, v: IntegrationScenario) {
    const contract = await ilSealed(this.specs, scope, v.contract);
    await ilSealed(this.environments, scope, v.environment);
    const fixtures = await Promise.all(v.fixtures.map((r) => ilSealed(this.fixtures, scope, r)));
    for (const node of v.nodes)
      if (node.fixture && !fixtures[node.fixture.index]?.content.rows[node.fixture.row])
        ilFail('SCENARIO_FIXTURE_INVALID');
    compileScenario(v, contract.content);
  }
  async compile(scope: IntegrationScope, ref: IntegrationRef) {
    const row = await ilSealed(this, scope, ref);
    await this.validate(scope, row.content);
    return compileScenario(row.content, (await ilSealed(this.specs, scope, row.content.contract)).content);
  }
}
