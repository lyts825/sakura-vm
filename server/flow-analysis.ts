/** 固定图校验和就绪判定；不执行表达式、脚本或动态节点。 */
import { AppError } from '../shared/errors.ts';
import type * as F from '../shared/contracts/flow-studio.ts';
import type { z } from 'zod';
const fail = (code: string): never => {
  throw new AppError(code, 400, code);
};
export function flowTopology(graph: z.infer<typeof F.flowGraph>) {
  const ids = graph.nodes.map((n) => n.id);
  if (new Set(ids).size !== ids.length) fail('FLOW_DUPLICATE_NODE');
  const keys = graph.edges.map((e) => e.from + ':' + e.to);
  if (new Set(keys).size !== keys.length) fail('FLOW_DUPLICATE_EDGE');
  for (const e of graph.edges)
    if (e.from === e.to || !ids.includes(e.from) || !ids.includes(e.to)) fail('FLOW_INVALID_EDGE');
  const order: string[] = [],
    remaining = new Set(ids);
  while (remaining.size) {
    const ready = [...remaining]
      .filter((id) => graph.edges.every((e) => e.to !== id || order.includes(e.from)))
      .sort();
    if (!ready.length) fail('FLOW_CYCLE');
    for (const id of ready) {
      remaining.delete(id);
      order.push(id);
    }
  }
  return order;
}
export function flowReady(definition: F.FlowDefinition, run: F.FlowRun, nodeId: string) {
  if (run.cancelled || run.status === 'cancelled') return false;
  const node = run.nodes.find((n) => n.id === nodeId);
  if (!node || !['blocked', 'ready', 'awaiting-approval'].includes(node.status)) return false;
  const dependencies = definition.edges.filter((e) => e.to === nodeId);
  return dependencies.every((e) => {
    const prior = run.nodes.find((n) => n.id === e.from)!;
    if (!['completed', 'failed'].includes(prior.status)) return false;
    return e.on === 'always' || (e.on === 'success' ? prior.outcome === true : prior.outcome === false);
  });
}
export function flowRefresh(definition: F.FlowDefinition, run: F.FlowRun) {
  for (const id of definition.order) {
    const node = run.nodes.find((n) => n.id === id)!;
    if (!['blocked', 'ready', 'awaiting-approval'].includes(node.status)) continue;
    const edges = definition.edges.filter((e) => e.to === id);
    const terminal = edges.every((e) =>
      ['completed', 'failed', 'cancelled'].includes(run.nodes.find((n) => n.id === e.from)!.status),
    );
    if (edges.length && terminal && !flowReady(definition, run, id)) {
      node.status = 'cancelled';
      node.error = '条件未选中此分支';
    } else
      node.status = flowReady(definition, run, node.id)
        ? node.plan
          ? 'awaiting-approval'
          : 'ready'
        : 'blocked';
  }
  if (run.cancelled) run.status = 'cancelled';
  else if (run.nodes.some((n) => n.status === 'unknown')) run.status = 'interrupted';
  else if (run.nodes.some((n) => n.status === 'waiting')) run.status = 'waiting';
  else if (run.nodes.every((n) => ['completed', 'failed', 'cancelled'].includes(n.status)))
    run.status = 'completed';
  else run.status = 'active';
  return run;
}
