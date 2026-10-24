/** 场景每次保存生成新修订；阈值与固定模板共同参与摘要。
 * Saving creates immutable scenarios with thresholds and template parameters in the digest. */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { ResilienceScenariosV1, ResilienceTargetsV1 } from './service-contracts/resilience-lab.ts';
import {
  resilienceScenarioInputSchema,
  resilienceScenarioSchema,
  resilienceTemplates,
  type ResilienceScope as Scope,
  type ResilienceRef as Ref,
} from '../shared/contracts/resilience-lab.ts';
import {
  ResilienceStore,
  resilienceHash,
  resilienceId,
  resilienceNow,
  resilienceError,
  sameScope,
  type ResilienceAuthorize,
} from './resilience-store.ts';
const schema = z.object({ rows: z.array(resilienceScenarioSchema).max(2000) }).strict();
export class ResilienceScenarios implements ResilienceScenariosV1 {
  private store: ResilienceStore<z.infer<typeof schema>>;
  constructor(
    metadata: PluginMetadata<unknown>,
    private targets: ResilienceTargetsV1,
    authorize: ResilienceAuthorize,
  ) {
    this.store = new ResilienceStore(metadata, schema, () => ({ rows: [] }), authorize);
  }
  async view(scope: Scope) {
    return (await this.store.read(scope)).rows.filter((x) => sameScope(x.scope, scope));
  }
  async templates(scope: Scope) {
    await this.store.authorize(scope);
    return structuredClone(resilienceTemplates);
  }
  async save(scope: Scope, raw: z.input<typeof resilienceScenarioInputSchema>) {
    const input = resilienceScenarioInputSchema.parse(raw);
    await this.targets.get(scope, input.target);
    const template = resilienceTemplates.find((x) => x.id === input.template)!;
    if (template.fault.fault !== input.parameters.fault) resilienceError('模板和故障类型不符');
    return this.store.mutate(scope, (s) => {
      const value = resilienceScenarioSchema.parse({
        ...input,
        id: resilienceId(),
        scope,
        createdAt: resilienceNow(),
        revision: resilienceHash(input),
      });
      s.rows.push(value);
      return value;
    });
  }
  async get(scope: Scope, ref: Ref) {
    return (
      (await this.view(scope)).find((x) => x.id === ref.id && x.revision === ref.revision) ||
      resilienceError('场景固定修订不存在')
    );
  }
}
