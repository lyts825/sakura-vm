/**
 * 为固定操作声明建立路径索引；每次匹配重新解码参数，不保存请求或授权状态。
 * Indexes fixed operation declarations; each match decodes fresh parameters without retaining requests or authority.
 */
type Segment = string | { name: string };
type CompiledPath = readonly Segment[];

function compilePath(pattern: string): CompiledPath {
  return pattern.replace(/:([a-zA-Z0-9_]+)/g, '{$1}').split('/').map(segment => {
    const variable = /^\{([a-zA-Z0-9_]+)\}$/.exec(segment);
    return variable ? { name: variable[1] } : segment;
  });
}

function matchPath(expected: CompiledPath, actual: readonly string[]): Record<string, string> | undefined {
  if (expected.length !== actual.length) return;
  const parameters: Record<string, string> = {};
  for (let i = 0; i < expected.length; i++) {
    const segment = expected[i];
    if (typeof segment === 'string') {
      if (actual[i] !== segment) return;
      continue;
    }
    let value: string;
    try { value = decodeURIComponent(actual[i]); } catch { return; }
    if (!value || value === '.' || value === '..' || /[\\/\x00-\x1f\x7f]/.test(value) ||
        (segment.name === 'vmId' && value === 'batch')) return;
    parameters[segment.name] = value;
  }
  return parameters;
}

export function matchOperationPath(pattern: string, path: string): Record<string, string> | undefined {
  return matchPath(compilePath(pattern), path.split('/'));
}

/**
 * 声明在构造后保持固定；索引大小仅取决于声明数量，不随访问路径增长。
 * Declarations remain fixed after construction; index size depends only on declarations, never requested paths.
 * 保留调用方的路径优先级和同优先级的目录顺序，方法选择继续由调用方负责。
 * Preserves caller path priority and catalogue order for ties; callers retain method selection.
 */
export function createOperationPathIndex<T>(
  entries: readonly T[],
  pathOf: (entry: T) => string,
  priorityOf: (pattern: string) => number,
) {
  type Route = { entry: T; segments: CompiledPath; priority: number; order: number };
  const lengths = new Map<number, { literals: Map<string, Route[]>; variables: Route[] }>();
  entries.forEach((entry, order) => {
    const pattern = pathOf(entry), segments = compilePath(pattern);
    let group = lengths.get(segments.length);
    if (!group) lengths.set(segments.length, group = { literals: new Map(), variables: [] });
    const route = { entry, segments, priority: priorityOf(pattern), order };
    const last = segments[segments.length - 1];
    if (typeof last !== 'string') group.variables.push(route);
    else {
      let bucket = group.literals.get(last);
      if (!bucket) group.literals.set(last, bucket = []);
      bucket.push(route);
    }
  });
  return (path: string): { entry: T; parameters: Record<string, string> }[] => {
    const actual = path.split('/'), group = lengths.get(actual.length);
    if (!group) return [];
    const candidates = [...(group.literals.get(actual[actual.length - 1]) || []), ...group.variables];
    const matches: { route: Route; parameters: Record<string, string> }[] = [];
    for (const route of candidates) {
      const parameters = matchPath(route.segments, actual);
      if (parameters) matches.push({ route, parameters });
    }
    matches.sort((a, b) => a.route.priority - b.route.priority || a.route.order - b.route.order);
    return matches.map(({ route, parameters }) => ({ entry: route.entry, parameters }));
  };
}
