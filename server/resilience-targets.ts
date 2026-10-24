/** 固定本地来源与合成数据；保存草稿不创建 VM。
 * Pin local sources and synthetic inputs without creating a VM on save. */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { ResilienceTargetsV1 } from './service-contracts/resilience-lab.ts';
import {
  resilienceTargetInputSchema,
  resilienceTargetSchema,
  resilienceRefSchema,
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
  syntheticSamples,
  type ResilienceAuthorize,
} from './resilience-store.ts';
const schema = z.object({ rows: z.array(resilienceTargetSchema).max(1000) }).strict();
export class ResilienceTargets implements ResilienceTargetsV1 {
  private store: ResilienceStore<z.infer<typeof schema>>;
  constructor(metadata: PluginMetadata<unknown>, authorize: ResilienceAuthorize) {
    this.store = new ResilienceStore(metadata, schema, () => ({ rows: [] }), authorize);
  }
  async view(scope: Scope) {
    return (await this.store.read(scope)).rows.filter((x) => sameScope(x.scope, scope));
  }
  async register(scope: Scope, raw: z.input<typeof resilienceTargetInputSchema>) {
    const input = resilienceTargetInputSchema.parse(raw);
    return this.store.mutate(scope, (s) => {
      const row = resilienceTargetSchema.parse({
        ...input,
        id: resilienceId(),
        scope,
        createdAt: resilienceNow(),
        sampleDigest: resilienceHash(syntheticSamples(input.sampleCount)),
        revision: resilienceHash(input),
      });
      s.rows.push(row);
      return row;
    });
  }
  async get(scope: Scope, ref: Ref) {
    resilienceRefSchema.parse(ref);
    const row = (await this.view(scope)).find((x) => x.id === ref.id && x.revision === ref.revision);
    return row || resilienceError('目标固定修订不存在');
  }
}
