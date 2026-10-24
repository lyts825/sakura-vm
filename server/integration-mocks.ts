/** 有限状态规则编译，活动进程由运行器管理。 Finite mock definitions, runner-owned processes. */
import type { PluginMetadata } from './plugin-metadata.ts';
import type {
  IntegrationMocksV1,
  IntegrationSpecsV1,
  IntegrationFixturesV1,
} from './service-contracts/integration-lab.ts';
import { IntegrationDefinitions, ilSealed, ilFail, ilBytes } from './integration-store.ts';
import {
  mockSchema,
  type IntegrationMock,
  type IntegrationScope,
} from '../shared/contracts/integration-lab.ts';
export class IntegrationMocks extends IntegrationDefinitions<IntegrationMock> implements IntegrationMocksV1 {
  constructor(
    meta: PluginMetadata,
    specs: IntegrationSpecsV1,
    private fixtures: IntegrationFixturesV1,
  ) {
    super(meta, mockSchema, specs, 'mocks');
  }
  protected override dependencyRefs(v: IntegrationMock) {
    return [v.contract, ...v.fixtures];
  }
  protected override async validate(scope: IntegrationScope, v: IntegrationMock) {
    const contract = (await ilSealed(this.specs, scope, v.contract)).content;
    const fixtures = await Promise.all(v.fixtures.map((r) => ilSealed(this.fixtures, scope, r)));
    if (
      !v.states.includes(v.initialState) ||
      new Set(v.states).size !== v.states.length ||
      new Set(v.rules.map((r) => r.id)).size !== v.rules.length
    )
      ilFail('MOCK_STATE_INVALID');
    for (const r of v.rules) {
      if (
        !contract.operations.some((o) => o.operationId === r.operationId) ||
        (r.state && !v.states.includes(r.state)) ||
        (r.nextState && !v.states.includes(r.nextState))
      )
        ilFail('MOCK_RULE_INVALID');
      if (r.fixture && !fixtures[r.fixture.index]?.content.rows[r.fixture.row])
        ilFail('MOCK_FIXTURE_INVALID');
      if (
        ilBytes(r.body) > 2 * 1024 ** 2 ||
        Object.entries(r.headers).some(
          ([k, val]) =>
            /[\r\n]/.test(val) ||
            ['connection', 'transfer-encoding', 'content-length', 'location'].includes(k.toLowerCase()),
        )
      )
        ilFail('MOCK_RESPONSE_INVALID');
    }
  }
}
