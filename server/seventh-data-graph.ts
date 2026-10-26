/** 固定节点与关系的有界图算法；分析结果和显示布局分开。 */
import { z } from 'zod';
import {
  dataCompare,
  dataId,
  dataRow,
  dataError,
  checkDataSignal,
  uniqueDataIds,
  stableData,
  makeDataRng,
} from '../shared/seventh-data-contracts.ts';

export const graphNodeSchema = z
  .object({ id: dataId, type: dataId.optional(), attributes: dataRow.default({}) })
  .strict();
export const graphEdgeSchema = z
  .object({
    id: dataId,
    source: dataId,
    target: dataId,
    type: dataId.default('relation'),
    weight: z.number().finite().default(1),
    attributes: dataRow.default({}),
  })
  .strict();
export const graphSchema = z
  .object({
    nodes: z.array(graphNodeSchema).max(100000),
    edges: z.array(graphEdgeSchema).max(500000),
    directed: z.boolean().default(true),
  })
  .strict();
export type FiniteGraph = z.infer<typeof graphSchema>;
export function validateGraph(raw: unknown) {
  const graph = graphSchema.parse(raw);
  uniqueDataIds(
    graph.nodes.map((n) => n.id),
    '节点',
  );
  uniqueDataIds(
    graph.edges.map((n) => n.id),
    '边',
  );
  const nodes = new Set(graph.nodes.map((n) => n.id));
  for (const edge of graph.edges)
    if (!nodes.has(edge.source) || !nodes.has(edge.target))
      dataError('GRAPH_DANGLING_EDGE', '边引用不存在的节点：' + edge.id);
  return {
    ...graph,
    nodes: graph.nodes.sort((a, b) => dataCompare(a.id, b.id)),
    edges: graph.edges.sort((a, b) => dataCompare(a.id, b.id)),
  };
}
export function graphAdjacency(graph: FiniteGraph, reverse = false, weak = false) {
  const result = new Map(
    graph.nodes.map((n) => [n.id, [] as { node: string; edge: string; weight: number }[]]),
  );
  for (const e of graph.edges) {
    result
      .get(reverse ? e.target : e.source)!
      .push({ node: reverse ? e.source : e.target, edge: e.id, weight: e.weight });
    if (!graph.directed || weak)
      result
        .get(reverse ? e.source : e.target)!
        .push({ node: reverse ? e.target : e.source, edge: e.id, weight: e.weight });
  }
  for (const list of result.values())
    list.sort((a, b) => dataCompare(a.node, b.node) || dataCompare(a.edge, b.edge));
  return result;
}
export function graphComponents(graph: FiniteGraph, signal?: AbortSignal) {
  const outgoing = graphAdjacency(graph),
    incoming = graphAdjacency(graph, true);
  const visited = new Set<string>(),
    order: string[] = [];
  for (const root of graph.nodes.map((n) => n.id)) {
    if (visited.has(root)) continue;
    visited.add(root);
    const stack = [{ node: root, at: 0 }];
    while (stack.length) {
      checkDataSignal(signal);
      const frame = stack[stack.length - 1],
        edges = outgoing.get(frame.node)!;
      if (frame.at < edges.length) {
        const next = edges[frame.at++].node;
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ node: next, at: 0 });
        }
      } else {
        order.push(frame.node);
        stack.pop();
      }
    }
  }
  visited.clear();
  const components: string[][] = [];
  for (const root of order.reverse()) {
    if (visited.has(root)) continue;
    const component: string[] = [],
      stack = [root];
    visited.add(root);
    while (stack.length) {
      checkDataSignal(signal);
      const node = stack.pop()!;
      component.push(node);
      for (const edge of incoming.get(node)!)
        if (!visited.has(edge.node)) {
          visited.add(edge.node);
          stack.push(edge.node);
        }
    }
    components.push(component.sort());
  }
  return components.sort((a, b) => dataCompare(a[0], b[0]));
}
const graphRunSchema = z
  .object({
    graph: graphSchema,
    algorithm: z.enum(['components', 'degree', 'shortest-path', 'paths', 'pagerank']),
    source: dataId.optional(),
    target: dataId.optional(),
    maxDepth: z.number().int().min(0).max(100).default(100),
    maxPaths: z.number().int().min(1).max(10000).default(1000),
    maxVisits: z.number().int().min(1).max(1000000).default(1000000),
    weighted: z.boolean().default(true),
    relationTypes: z.array(dataId).max(100).optional(),
    damping: z.number().min(0).max(0.99).default(0.85),
    tolerance: z.number().positive().max(1).default(1e-10),
    iterations: z.number().int().min(1).max(1000).default(100),
  })
  .strict();
class DistanceHeap {
  private entries: { node: string; cost: number }[] = [];
  push(value: { node: string; cost: number }) {
    this.entries.push(value);
    let i = this.entries.length - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (this.entries[p].cost <= value.cost) break;
      this.entries[i] = this.entries[p];
      i = p;
    }
    this.entries[i] = value;
  }
  pop() {
    const first = this.entries[0],
      last = this.entries.pop();
    if (this.entries.length && last) {
      let at = 0;
      while (true) {
        let child = at * 2 + 1;
        if (child >= this.entries.length) break;
        if (child + 1 < this.entries.length && this.entries[child + 1].cost < this.entries[child].cost)
          child++;
        if (this.entries[child].cost >= last.cost) break;
        this.entries[at] = this.entries[child];
        at = child;
      }
      this.entries[at] = last;
    }
    return first;
  }
  get length() {
    return this.entries.length;
  }
}
export function runGraph(raw: unknown, signal?: AbortSignal) {
  const input = graphRunSchema.parse(raw),
    graph = validateGraph(input.graph);
  if (input.relationTypes) graph.edges = graph.edges.filter((e) => input.relationTypes!.includes(e.type));
  const adjacency = graphAdjacency(graph);
  if (input.algorithm === 'components')
    return {
      algorithm: input.algorithm,
      components: graphComponents(graph, signal),
      definition: graph.directed ? 'strongly-connected' : 'connected',
      verdict: 'passed',
      coverage: 'full',
    };
  if (input.algorithm === 'degree') {
    const incoming = graphAdjacency(graph, true);
    return {
      algorithm: input.algorithm,
      rows: graph.nodes.map((n) => ({
        id: n.id,
        outDegree: adjacency.get(n.id)!.length,
        inDegree: incoming.get(n.id)!.length,
      })),
      directed: graph.directed,
      selfLoopContribution: graph.directed ? 'one-per-direction' : 'two',
      verdict: 'passed',
    };
  }
  if (input.algorithm === 'pagerank') {
    if (graph.edges.some((e) => e.weight < 0)) dataError('GRAPH_NEGATIVE_WEIGHT', '迭代权重须非负');
    const n = graph.nodes.length;
    if (!n)
      return {
        algorithm: input.algorithm,
        rows: [],
        converged: true,
        iterations: 0,
        residual: 0,
        verdict: 'passed',
      };
    if (graph.edges.length * input.iterations > 50000000)
      dataError('GRAPH_ITERATION_BUDGET', '迭代边展开超过 5000 万次');
    let scores = new Map(graph.nodes.map((v) => [v.id, 1 / n]));
    let residual = Infinity,
      iterations = 0;
    for (; iterations < input.iterations; iterations++) {
      checkDataSignal(signal);
      const next = new Map(graph.nodes.map((v) => [v.id, (1 - input.damping) / n]));
      let dangling = 0;
      for (const node of graph.nodes) {
        const edges = adjacency.get(node.id)!,
          weight = edges.reduce((s, e) => s + (input.weighted ? e.weight : 1), 0);
        if (!weight) dangling += scores.get(node.id)!;
        else
          for (const edge of edges)
            next.set(
              edge.node,
              next.get(edge.node)! +
                (input.damping * scores.get(node.id)! * (input.weighted ? edge.weight : 1)) / weight,
            );
      }
      for (const id of next.keys()) next.set(id, next.get(id)! + (input.damping * dangling) / n);
      residual = [...next].reduce((sum, [id, value]) => sum + Math.abs(value - scores.get(id)!), 0);
      scores = next;
      if (residual <= input.tolerance) {
        iterations++;
        break;
      }
    }
    return {
      algorithm: input.algorithm,
      rows: [...scores].map(([id, score]) => ({ id, score })),
      residual,
      iterations,
      converged: residual <= input.tolerance,
      verdict: residual <= input.tolerance ? 'passed' : 'inconclusive',
    };
  }
  if (!input.source || !input.target || !adjacency.has(input.source) || !adjacency.has(input.target))
    dataError('GRAPH_QUERY_ENDPOINT', '路径查询须指定存在的起终点');
  if (input.algorithm === 'shortest-path') {
    if (graph.edges.some((e) => e.weight < 0)) dataError('GRAPH_NEGATIVE_WEIGHT', '首版最短路径拒绝负权');
    const heap = new DistanceHeap(),
      costs = new Map<string, number>([[input.source, 0]]),
      parents = new Map<string, { node: string; edge: string }>();
    heap.push({ node: input.source, cost: 0 });
    let visits = 0,
      limited = false,
      found = false;
    while (heap.length) {
      checkDataSignal(signal);
      if (++visits > input.maxVisits) {
        limited = true;
        break;
      }
      const cur = heap.pop()!;
      if (cur.cost !== costs.get(cur.node)) continue;
      if (cur.node === input.target) {
        found = true;
        break;
      }
      for (const edge of adjacency.get(cur.node)!) {
        const cost = cur.cost + (input.weighted ? edge.weight : 1);
        if (!Number.isFinite(cost)) dataError('GRAPH_COST_OVERFLOW', '路径代价溢出');
        if (cost < (costs.get(edge.node) ?? Infinity)) {
          costs.set(edge.node, cost);
          parents.set(edge.node, { node: cur.node, edge: edge.edge });
          heap.push({ node: edge.node, cost });
        }
      }
    }
    const nodes = found ? [input.target] : [],
      edges: string[] = [];
    if (found) {
      let cur = input.target;
      while (cur !== input.source) {
        const parent = parents.get(cur)!;
        nodes.push(parent.node);
        edges.push(parent.edge);
        cur = parent.node;
      }
      nodes.reverse();
      edges.reverse();
    }
    return {
      algorithm: input.algorithm,
      nodes,
      edges,
      cost: found ? costs.get(input.target)! : null,
      found,
      visits: Math.min(visits, input.maxVisits),
      coverage: limited ? 'partial' : 'full',
      verdict: limited ? 'inconclusive' : 'passed',
      noPath: !found && !limited,
    };
  }
  const paths: { nodes: string[]; edges: string[] }[] = [],
    stack = [{ nodes: [input.source], edges: [] as string[] }];
  let visits = 0,
    limited = false,
    depthLimited = false;
  while (stack.length) {
    checkDataSignal(signal);
    if (++visits > input.maxVisits || paths.length >= input.maxPaths) {
      limited = true;
      break;
    }
    const path = stack.pop()!,
      node = path.nodes.at(-1)!;
    if (node === input.target) {
      paths.push(path);
      continue;
    }
    if (path.edges.length >= input.maxDepth) {
      if (adjacency.get(node)!.some((e) => !path.nodes.includes(e.node))) depthLimited = true;
      continue;
    }
    for (const edge of [...adjacency.get(node)!].reverse())
      if (!path.nodes.includes(edge.node))
        stack.push({ nodes: [...path.nodes, edge.node], edges: [...path.edges, edge.edge] });
  }
  return {
    algorithm: input.algorithm,
    paths,
    visits: Math.min(visits, input.maxVisits),
    coverage: limited || depthLimited ? 'partial' : 'full',
    verdict: limited || depthLimited ? 'inconclusive' : 'passed',
    stoppedBy: limited ? 'budget' : depthLimited ? 'depth' : null,
    pathSemantics: 'simple-paths',
  };
}
export function compareGraphs(raw: unknown) {
  const { left: a, right: b } = z.object({ left: graphSchema, right: graphSchema }).strict().parse(raw),
    left = validateGraph(a),
    right = validateGraph(b);
  const differences = (l: { id: string }[], r: { id: string }[]) => {
    const left = new Map(l.map((v) => [v.id, v])),
      right = new Set(r.map((v) => v.id));
    return {
      added: r.filter((v) => !left.has(v.id)).map((v) => v.id),
      removed: l.filter((v) => !right.has(v.id)).map((v) => v.id),
      changed: r
        .filter((v) => left.has(v.id) && stableData(v) !== stableData(left.get(v.id)))
        .map((v) => v.id),
    };
  };
  return {
    nodes: differences(left.nodes, right.nodes),
    edges: differences(left.edges, right.edges),
    comparable: left.directed === right.directed,
    conditions: left.directed === right.directed ? [] : ['direction-changed'],
  };
}
export function layoutGraph(raw: unknown) {
  const input = z
      .object({
        graph: graphSchema,
        seed: z.number().int().min(0).max(4294967295).default(1),
        width: z.number().positive().max(10000).default(1000),
        height: z.number().positive().max(10000).default(1000),
      })
      .strict()
      .parse(raw),
    graph = validateGraph(input.graph),
    random = makeDataRng(input.seed);
  return {
    seed: input.seed,
    algorithm: 'seeded-circle-v1',
    coordinates: graph.nodes.map((n, i) => {
      const angle = (2 * Math.PI * (i + random() * 0.1)) / Math.max(1, graph.nodes.length);
      return {
        id: n.id,
        x: input.width / 2 + Math.cos(angle) * input.width * 0.4,
        y: input.height / 2 + Math.sin(angle) * input.height * 0.4,
      };
    }),
    interpretation: 'display-only',
  };
}
