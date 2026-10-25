/** 仅核对固定图、材料字节与事件链；来源声明不证明原服务实际执行。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as F from '../shared/contracts/flow-studio.ts';
import { suitePortableClaim } from '../shared/contracts/suite-portable.ts';
import { verifySuiteGraph, offlineKey, offlineHash } from './suite-offline.ts';
import { flowTopology } from './flow-analysis.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
export const flowPortable = suitePortableClaim
  .extend({
    claims: z
      .object({ sourceId: S.suiteId, value: S.suiteJson, providerResults: z.array(S.suiteJson).max(24) })
      .strict(),
  })
  .strict();
export const flowSchemas = {
  'flow-definitions': F.flowDefinition,
  'flow-inputs': F.flowInput,
  'flow-plans': F.flowPlan,
  'flow-approvals': F.flowApproval,
  'flow-journal': F.flowEvent,
  'flow-runs': F.flowRun,
  'flow-timers': F.flowTimer,
} as const;
export function verifyFlowBundle(bytes: Uint8Array) {
  const graph = verifySuiteGraph(bytes, 'sakura-flow-studio/1', Object.keys(flowSchemas), 'flow-inputs'),
    values = new Map<string, unknown>(),
    claims = new Map<string, z.infer<typeof flowPortable>>();
  for (const row of graph.rows) {
    if (row.origin !== 'imported') throw new Error('FLOW_VERIFY_SOURCE_CLAIM');
    if (row.kind === 'source') continue;
    const claim = flowPortable.parse(row.content),
      schema = flowSchemas[row.domain as keyof typeof flowSchemas];
    if (!schema) throw new Error('FLOW_VERIFY_DOMAIN');
    claims.set(offlineKey(row), claim);
    values.set(offlineKey(row), schema.parse(claim.claims.value));
  }
  const value = <T>(reference: S.SuiteRef, schema: z.ZodType<T>, owner?: S.SuiteRecord) => {
    graph.get(reference, owner);
    return schema.parse(values.get(offlineKey(reference)));
  };
  let definitions = 0,
    runs = 0,
    events = 0;
  for (const row of graph.rows) {
    if (row.kind === 'source') continue;
    const v = values.get(offlineKey(row));
    if (row.domain === 'flow-definitions') {
      const d = F.flowDefinition.parse(v);
      if (offlineHash(flowTopology(d)) !== offlineHash(d.order)) throw new Error('FLOW_VERIFY_TOPOLOGY');
      definitions++;
    }
    if (row.domain === 'flow-inputs') {
      const input = F.flowInput.parse(v),
        source = graph.get(input.source, row),
        material = S.suiteMaterial.parse(source.content),
        bytes = graph.materials.get(offlineKey(source));
      if (
        !bytes ||
        material.digest !== input.sourceDigest ||
        offlineHash(parseSuiteJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 1024 ** 2)) !==
          offlineHash(input.bindings)
      )
        throw new Error('FLOW_VERIFY_INPUT');
    }
    if (row.domain === 'flow-plans') {
      const plan = F.flowPlan.parse(v),
        definition = value(plan.definition, F.flowDefinition, row);
      value(plan.inputs, F.flowInput, row);
      if (plan.kind === 'graph') {
        if (offlineHash(plan.order) !== offlineHash(definition.order))
          throw new Error('FLOW_VERIFY_PLAN_GRAPH');
      } else if (
        plan.providerPlan !== null ||
        offlineHash(plan.node) !== offlineHash(definition.nodes.find((n) => n.id === plan.node.id))
      )
        throw new Error('FLOW_VERIFY_STEP');
    }
    if (row.domain === 'flow-runs') {
      const run = F.flowRun.parse(v),
        definition = value(run.definition, F.flowDefinition, row),
        source = claims.get(offlineKey(row))!.claims.sourceId;
      value(run.inputs, F.flowInput, row);
      value(run.graphPlan, F.flowGraphPlan, row);
      if (
        run.nodes.length !== definition.nodes.length ||
        new Set(run.nodes.map((n) => n.id)).size !== run.nodes.length ||
        run.nodes.some((n) => !definition.nodes.some((d) => d.id === n.id) || n.receipt !== null)
      )
        throw new Error('FLOW_VERIFY_RUN');
      let previous: string | null = null;
      for (let index = 0; index < run.journal.length; index++) {
        const r = run.journal[index],
          event = value(r, F.flowEvent, row),
          claim = claims.get(offlineKey(r))!;
        if (event.runId !== source || event.index !== index + 1 || event.previous !== previous)
          throw new Error('FLOW_VERIFY_JOURNAL');
        previous = claim.sourceRecordDigest;
        events++;
      }
      for (const node of run.nodes) {
        if (node.plan) value(node.plan, F.flowStepPlan, row);
        if (node.approval) value(node.approval, F.flowApproval, row);
        if (node.event && !run.journal.some((r) => offlineKey(r) === offlineKey(node.event!)))
          throw new Error('FLOW_VERIFY_EVENT_BINDING');
      }
      runs++;
    }
  }
  if (!runs) throw new Error('FLOW_VERIFY_RUN_REQUIRED');
  return {
    valid: true,
    format: 'sakura-flow-studio/1',
    objects: graph.rows.length,
    definitions,
    runs,
    events,
    sourceTrust: 'unauthenticated',
    executionAllowed: false,
    approvalsTransferred: false,
    originalProviderExecutionVerified: false,
    manifestDigest: graph.manifestDigest,
  };
}
