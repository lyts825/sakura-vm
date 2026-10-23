/** 流水线图校验与选择；省略依赖沿用线性顺序。
 * Pipeline graph validation/selection; omitted dependencies preserve legacy order. */
import { AppError } from '../shared/errors.ts';

export type GraphStep = { id?: string; dependsOn?: string[]; rerunnable?: boolean };
export type GraphNode = { id: string; dependencies: string[]; index: number };

/** 展开隐式边并拒绝重复标识、未知节点和环。Expand implicit edges and reject invalid DAGs. */
export function pipelineGraph(steps: GraphStep[]): GraphNode[] {
  const nodes = steps.map((step, index) => ({ id: step.id || `step-${index + 1}`, index,
    dependencies: step.dependsOn ?? (index ? [steps[index - 1].id || `step-${index}`] : []) }));
  const byId = new Map(nodes.map(node => [node.id, node]));
  if (byId.size !== nodes.length) throw new AppError('流水线步骤标识不能重复');
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new AppError('流水线依赖存在循环');
    if (visited.has(id)) return;
    const node = byId.get(id);
    if (!node) throw new AppError(`流水线依赖不存在：${id}`);
    if (new Set(node.dependencies).size !== node.dependencies.length) throw new AppError('步骤依赖不能重复');
    visiting.add(id);
    node.dependencies.forEach(visit);
    visiting.delete(id); visited.add(id);
  };
  nodes.forEach(node => visit(node.id));
  return nodes;
}

/** 重跑选中节点、下游及它们需要的全部祖先；不复用命令结果。
 * Rerun selected nodes, descendants and all their prerequisites; never cache command outcomes. */
export function pipelineSelection(nodes: GraphNode[], selected: string[]): Set<string> {
  const result = new Set(selected), byId = new Map(nodes.map(node => [node.id, node]));
  if (!selected.length || result.size !== selected.length || selected.some(id => !byId.has(id)))
    throw new AppError('请选择有效且不重复的重跑步骤');
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (!result.has(node.id) && node.dependencies.some(id => result.has(id))) {
      result.add(node.id); changed = true;
    }
  }
  const include = (id: string) => {
    for (const dependency of byId.get(id)!.dependencies) if (!result.has(dependency)) {
      result.add(dependency); include(dependency);
    }
  };
  [...result].forEach(include);
  return result;
}

/** 有界调度；失败阻断后继，独立分支继续。取消或异常时等候全部已启动任务收尾。
 * Bounded scheduling blocks failed descendants while independent branches continue; drain on exit. */
export async function schedulePipeline(nodes: GraphNode[], concurrency: number, selected: Set<string>,
  signal: AbortSignal, execute: (index: number) => Promise<void>, blocked: (index: number, reason: string) => void) {
  const pending = new Set(nodes.filter(node => selected.has(node.id)).map(node => node.id));
  const completed = new Set<string>(), failed = new Set<string>(), active = new Map<string, Promise<void>>();
  const errors: unknown[] = [];
  try {
    while (pending.size || active.size) {
      if (!signal.aborted) for (const node of nodes) {
        if (!pending.has(node.id)) continue;
        if (node.dependencies.some(id => failed.has(id))) {
          pending.delete(node.id); failed.add(node.id); blocked(node.index, '依赖失败，未执行'); continue;
        }
        if (active.size >= concurrency || node.dependencies.some(id => !completed.has(id))) continue;
        pending.delete(node.id);
        const task = Promise.resolve().then(() => execute(node.index)).then(() => { completed.add(node.id); },
          error => { failed.add(node.id); errors.push(error); }).finally(() => { active.delete(node.id); });
        active.set(node.id, task);
      }
      if (active.size) await Promise.race(active.values());
      else break;
    }
  } finally {
    await Promise.allSettled(active.values());
    for (const node of nodes) if (pending.has(node.id)) blocked(node.index, signal.aborted ? '运行已取消，未执行' : '依赖未完成，未执行');
  }
  // 清理失败优先于普通步骤失败或取消。Cleanup uncertainty takes precedence over ordinary failure/cancellation.
  const cleanup = errors.find(error => error instanceof AppError && /_CLEANUP_FAILED$/.test(error.code || ''));
  if (cleanup) throw cleanup;
  if (errors.length) throw errors[0];
  signal.throwIfAborted();
}
