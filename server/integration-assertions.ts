/** 仅接收原运行器的有界证据；公开结果不包含响应值。 Runner-authenticated assertion evaluation. */
import { randomUUID } from 'node:crypto';
import type {
  IntegrationAssertionsV1,
  IntegrationSpecsV1,
  IntegrationScenariosV1,
} from './service-contracts/integration-lab.ts';
import type { IntegrationMetadataFactory } from './integration-specs.ts';
import {
  IntegrationDefinitions,
  IntegrationRows,
  ilSealed,
  ilConsumer,
  ilFail,
  ilHash,
  ilBytes,
} from './integration-store.ts';
import { pointer, matches, validateShape } from './integration-validation.ts';
import {
  assertionSchema,
  evaluationSchema,
  requestEvidenceSchema,
  type IntegrationAssertion,
  type IntegrationScope,
  type IntegrationRef,
  type IntegrationEvidence,
  type IntegrationEvaluation,
} from '../shared/contracts/integration-lab.ts';
export class IntegrationAssertions
  extends IntegrationDefinitions<IntegrationAssertion>
  implements IntegrationAssertionsV1
{
  private results;
  constructor(
    meta: IntegrationMetadataFactory,
    specs: IntegrationSpecsV1,
    private scenarios: IntegrationScenariosV1,
  ) {
    super(meta('assertions'), assertionSchema, specs, 'assertions');
    this.results = new IntegrationRows(meta('evaluations'), evaluationSchema);
  }
  protected override dependencyRefs(v: IntegrationAssertion) {
    return [v.scenario];
  }
  protected override async validate(scope: IntegrationScope, v: IntegrationAssertion) {
    const scenario = (await ilSealed(this.scenarios, scope, v.scenario)).content;
    if (new Set(v.rules.map((r) => r.id)).size !== v.rules.length) ilFail('ASSERTION_ID_DUPLICATE');
    for (const r of v.rules) {
      if (
        !scenario.nodes.some((n) => n.id === r.node) ||
        (r.kind === 'relation' && !scenario.nodes.some((n) => n.id === r.otherNode))
      )
        ilFail('ASSERTION_NODE_UNKNOWN');
      if (r.kind === 'shape') validateShape(r.shape);
    }
  }
  async evaluate(
    scope: IntegrationScope,
    runId: string,
    ref: IntegrationRef,
    evidence: IntegrationEvidence[],
  ) {
    ilConsumer('integration-runners');
    const definition = await ilSealed(this, scope, ref);
    requestEvidenceSchema.array().max(6000).parse(evidence);
    if (ilBytes(evidence) > 64 * 1024 ** 2) ilFail('EVIDENCE_BUDGET');
    const previous = (await this.evaluations(scope, runId)).find((r) => r.assertion.id === ref.id);
    if (previous) {
      if (previous.evidenceDigest !== ilHash(evidence)) ilFail('EVIDENCE_ALREADY_EVALUATED');
      return previous;
    }
    const results: IntegrationEvaluation['results'] = definition.content.rules.map((rule) => {
      const samples = evidence.filter((e) => e.node === rule.node);
      const evaluated = (samples.length ? samples : [undefined]).map(
        (e): IntegrationEvaluation['results'][number] => {
          let outcome: 'satisfied' | 'violated' | 'unevaluated' = 'unevaluated',
            reason = 'RESPONSE_UNAVAILABLE';
          if (e?.complete) {
            let ok = false,
              ready = true;
            switch (rule.kind) {
              case 'status':
                ok = e.status === rule.equals;
                break;
              case 'header':
                ok = e.headers[rule.name] === rule.equals;
                break;
              case 'duration':
                ok = e.durationMs <= rule.maxMs;
                break;
              case 'value':
                ready = e.body !== undefined;
                ok = ilHash(pointer(e.body, rule.pointer) ?? null) === ilHash(rule.equals);
                break;
              case 'shape':
                ready = e.body !== undefined;
                ok = matches(pointer(e.body, rule.pointer), rule.shape);
                break;
              case 'member': {
                ready = e.body !== undefined;
                const v = pointer(e.body, rule.pointer);
                ok = Array.isArray(v) && v.some((x) => ilHash(x) === ilHash(rule.value));
                break;
              }
              case 'relation': {
                const other = evidence.find((x) => x.node === rule.otherNode && x.complete);
                ready =
                  e.body !== undefined &&
                  other?.body !== undefined &&
                  evidence.filter((x) => x.node === rule.otherNode).length === 1;
                const a = pointer(e.body, rule.pointer),
                  b = pointer(other?.body, rule.otherPointer);
                if (rule.relation === 'eq' || rule.relation === 'ne')
                  ok = (ilHash(a ?? null) === ilHash(b ?? null)) === (rule.relation === 'eq');
                else if (typeof a === 'number' && typeof b === 'number')
                  ok =
                    rule.relation === 'lt'
                      ? a < b
                      : rule.relation === 'le'
                        ? a <= b
                        : rule.relation === 'gt'
                          ? a > b
                          : a >= b;
                break;
              }
            }
            outcome = ready ? (ok ? 'satisfied' : 'violated') : 'unevaluated';
            reason = ready ? (ok ? 'MATCH' : 'MISMATCH') : 'BODY_UNAVAILABLE';
          }
          return {
            id: rule.id,
            node: rule.node,
            outcome,
            reason,
            evidence: e ? { sequence: e.sequence, start: 0, end: e.bytes } : null,
          };
        },
      );
      return (
        evaluated.find((result) => result.outcome === 'unevaluated') ??
        evaluated.find((result) => result.outcome === 'violated') ??
        evaluated[0]
      );
    });
    const row = evaluationSchema.parse({
      id: randomUUID(),
      workspaceId: scope.workspaceId,
      runId,
      assertion: ref,
      evidenceDigest: ilHash(evidence),
      results,
    });
    const bytes = ilBytes(row);
    const capacity = await this.specs.reserveCapacity(scope, {
      objects: 1,
      revisions: 1,
      bytes: bytes * 2,
      metadataBytes: bytes,
      controlBytes: 0,
    });
    await this.results.change((rows) => rows.push(row));
    await this.specs.commitCapacity(scope, capacity.token);
    return row;
  }
  async evaluations(scope: IntegrationScope, runId: string) {
    await this.specs.assertWorkspace(scope);
    return (await this.results.all()).filter((r) => r.workspaceId === scope.workspaceId && r.runId === runId);
  }
  override async close() {
    await super.close();
    await this.results.close();
  }
}
