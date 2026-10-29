/**
 * 模块职责（中文）：校验插件目录并解析插件/插件包选择，检测版本、依赖、路由重叠和循环并迁移旧配置。
 * Module responsibility (English): Validating catalogs and expanding dependencies, packs and legacy selection migrations.
 * 详细范围（中文）：公开入口包括 validateCatalog, resolveSelection, createPluginSelectionResolver, migrateSelection, selectionReasons；职责覆盖校验目录并展开依赖、插件包和旧配置迁移，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include validateCatalog, resolveSelection, createPluginSelectionResolver, migrateSelection, selectionReasons. The scope covers validating catalogs and expanding dependencies, packs and legacy selection migrations. Types, validation branches and cleanup paths define its data/behavior boundaries.
 */
import {
  pluginManifestSchema,
  pluginPackSchema,
  pluginSelectionSchema,
  legacySelectionSchema,
  legacySelectionSchemaV2,
} from './plugin-schema.ts';
import {
  PLUGIN_API_VERSION,
  emptySelection,
  type PluginManifest,
  type PluginPack,
  type PluginSelection,
  type PluginRoot,
} from './plugin-protocol.ts';

/**
 * 中文：比较集合与原数组长度，重复声明时抛出带标签错误；只校验，不改变顺序或自动去重。
 * English: Compare set/array lengths and throw a labeled error for duplicate declarations; validate without changing order or silently deduplicating.
 * 中文：输入：values：签名所示 string[] 业务值；label：签名所示 string 业务值
 * English: Inputs: values: the string[] domain value in the signature; label: the string domain value in the signature
 * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
 * English: Result: deliver through the described state/resource effects without returning business data
 */
function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label}重复`);
}
/**
 * 中文：按斜杠拆分路由并移除空段，供前缀与参数重叠判断。
 * English: Split routes by slashes/drop empty segments for prefix/parameter-overlap checks.
 * 中文：输入：path：目标文件或请求路径
 * English: Inputs: path: target file/request path
 */
const segments = (path: string) => path.split('/').filter(Boolean);
/**
 * 中文：比较两路由共有长度的段，vmId 参数视为可匹配任意实例；批量路由与实例子路由有明确例外，避免误报。
 * English: Compare segments over shared route length, treating vmId as matching any VM; explicitly exclude batch-versus-instance-child overlap to avoid false positives.
 * 中文：输入：a：签名所示 string 业务值；b：签名所示 string 业务值
 * English: Inputs: a: the string domain value in the signature; b: the string domain value in the signature
 */
function overlaps(a: string, b: string) {
  if (
    (a === '/api/vms/batch' && b.startsWith('/api/vms/:vmId/')) ||
    (b === '/api/vms/batch' && a.startsWith('/api/vms/:vmId/'))
  )
    return false;
  const left = segments(a),
    right = segments(b);
  return left
    .slice(0, Math.min(left.length, right.length))
    .every((part, i) => part === right[i] || part === ':vmId' || right[i] === ':vmId');
}
/**
 * 中文：校验所有清单、精确版本依赖与服务/路由/界面归属，要求 HTTP 前缀拥有显式精确操作策略并检查未选中的依赖循环。发布在服务启动前拒绝歧义目录。
 * English: Validate every manifest, exact dependency version and service/route/UI owner. Require explicit exact-operation policies under HTTP prefixes and detect cycles even in unselected entries, rejecting ambiguous releases before services start.
 * 中文：输入：plugins：签名所示 PluginManifest[] 业务值；packs：签名所示 PluginPack[] 业务值
 * English: Inputs: plugins: the PluginManifest[] domain value in the signature; packs: the PluginPack[] domain value in the signature
 * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
 * English: Result: deliver through the described state/resource effects without returning business data
 */
export function validateCatalog(plugins: PluginManifest[], packs: PluginPack[]) {
  plugins.forEach((item) => pluginManifestSchema.parse(item));
  packs.forEach((item) => pluginPackSchema.parse(item));
  unique(
    plugins.map((item) => item.id),
    '插件标识',
  );
  unique(
    packs.map((item) => item.id),
    '整合包标识',
  );
  const byId = new Map(plugins.map((item) => [item.id, item]));
  const packById = new Map(packs.map((item) => [item.id, item]));
  const services = new Set<string>(),
    sockets = new Set<string>(),
    routes: string[] = [],
    aliases = new Set<string>();
  const customPages = new Set<string>(), customTabs = new Set<string>(), customSections = new Set<string>();
  const reservedServices = new Set([
    'machines',
    'enabled',
    'errors',
    'modules',
    'contexts',
    'mutations',
    'importing',
    'closed',
    'closing',
    'active',
    'require',
    'route',
    'jobStores',
    'retryHandler',
    'close',
    'create',
    'validateConfig',
    'serviceValue',
    'provideService',
    'registerPluginJobs',
    'socketEnabled',
    'provide',
    'use',
    'optional',
    'onDispose',
    'registerJobs',
    'signal',
    'dataFile',
  ]);
  for (const plugin of plugins) {
    if (plugin.apiVersion !== PLUGIN_API_VERSION) throw new Error(`插件 API 版本不兼容：${plugin.id}`);
    unique(
      [...plugin.requires, ...plugin.optional].map((item) => item.id),
      `${plugin.id} 的依赖声明`,
    );
    for (const dependency of [...plugin.requires, ...plugin.optional]) {
      if (!byId.has(dependency.id)) throw new Error(`依赖插件不存在：${plugin.id} → ${dependency.id}`);
      if (byId.get(dependency.id)!.version !== dependency.version)
        throw new Error(`依赖版本不匹配：${plugin.id} → ${dependency.id}`);
    }
    for (const service of plugin.services) {
      if (reservedServices.has(service) || services.has(service)) throw new Error(`服务归属冲突：${service}`);
      services.add(service);
    }
    for (const socket of plugin.contributes.sockets) {
      if (sockets.has(socket)) throw new Error(`WebSocket 归属冲突：${socket}`);
      sockets.add(socket);
    }
    for (const field of ['pages', 'tabs', 'developmentSections'] as const)
      unique(plugin.contributes[field], `${plugin.id} 的 ${field}`);
    for (const page of plugin.contributes.pages) {
      if (['workspace', 'plugins', 'tasks', 'settings'].includes(page)) throw new Error(`插件不能占用核心页面：${page}`);
      if (!['images', 'library', 'features'].includes(page)) {
        if (customPages.has(page)) throw new Error(`插件页面归属冲突：${page}`);
        customPages.add(page);
      }
    }
    for (const tab of plugin.contributes.tabs) {
      if (['terminal', 'config'].includes(tab)) throw new Error(`插件不能占用核心标签：${tab}`);
      if (!['files', 'snapshots', 'project', 'git', 'containers', 'sync', 'services', 'development', 'metrics', 'desktop', 'maintenance'].includes(tab)) {
        if (customTabs.has(tab)) throw new Error(`插件标签归属冲突：${tab}`);
        customTabs.add(tab);
      }
    }
    for (const section of plugin.contributes.developmentSections)
      if (!['tools', 'network', 'secrets', 'commands', 'pipelines', 'runtimes'].includes(section)) {
        if (customSections.has(section)) throw new Error(`开发区归属冲突：${section}`);
        customSections.add(section);
      }
    for (const route of plugin.contributes.http) {
      const parts = segments(route.path);
      const global =
        parts.length === 2 &&
        !['bootstrap', 'system', 'network-runtime', 'plugins', 'jobs', 'events', 'downloads', 'vms', 'audit', 'monitor', 'openapi', 'sdk', 'log-retention', 'graphql', 'graphql-schema', 'session', 'webhooks', 'assistant', 'trusted-updates', 'native-integration', 'native-clipboard'].includes(parts[1]);
      const vm =
        parts.length === 4 &&
        parts[1] === 'vms' &&
        parts[2] === ':vmId' &&
        !['start', 'stop', 'exec', 'logs', 'lockdown'].includes(parts[3]);
      if (!global && !vm && route.path !== '/api/vms/batch')
        throw new Error(`路由占用核心入口或路径不支持：${route.path}`);
      if (routes.some((path) => overlaps(path, route.path))) throw new Error(`路由归属冲突：${route.path}`);
      if (
        route.projectScoped &&
        (!vm ||
          (plugin.id !== 'projects' &&
            ![...plugin.requires, ...plugin.optional].some((item) => item.id === 'projects')))
      )
        throw new Error(`项目作用域必须声明 projects 依赖：${plugin.id}`);
      unique(route.methods, `${route.path} 的 HTTP 方法`);
      routes.push(route.path);
    }
    unique(plugin.contributes.operations.map((item) => item.id), `${plugin.id} 的操作标识`);
    unique(plugin.contributes.operations.map((item) => `${item.method}:${item.path}`), `${plugin.id} 的操作路径`);
    for (const operation of plugin.contributes.operations) {
      const path = segments(operation.path);
      if (!plugin.contributes.http.some((route) => {
        const prefix = segments(route.path);
        return route.methods.includes(operation.method) && prefix.length <= path.length &&
          prefix.every((part, index) => part === path[index]);
      })) throw new Error(`操作不属于插件 HTTP 命名空间：${plugin.id}.${operation.id}`);
      const route = plugin.contributes.routes.find(item => item.id === operation.id && item.handler === 'operation');
      /**
       * 中文：把冒号路径参数统一为契约花括号形状，供精确路径与操作描述比较。
       * English: Normalize colon path parameters to contract braces for exact route/operation-description comparisons.
       * 中文：输入：value：待校验、转换或保存的输入值
       * English: Inputs: value: input value to validate/transform/save
       */
      const normalize = (value: string) => value.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
      if (!route || route.method !== operation.method || normalize(route.path) !== normalize(operation.path) ||
          route.status !== operation.status)
        throw new Error(`类型化操作缺少一致的策略和处理器登记：${plugin.id}.${operation.id}`);
    }
    unique(plugin.contributes.routes.map(item => item.id), `${plugin.id} 的精确操作标识`);
    unique(plugin.contributes.routes.map(item => item.method + ':' + item.path), `${plugin.id} 的精确操作路径`);
    for (const route of plugin.contributes.routes) {
      /**
       * 中文：把冒号路径参数统一为契约花括号形状，供精确路径与操作描述比较。
       * English: Normalize colon path parameters to contract braces for exact route/operation-description comparisons.
       * 中文：输入：value：待校验、转换或保存的输入值
       * English: Inputs: value: input value to validate/transform/save
       */
      const normalize = (value: string) => value.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
      if (!plugin.contributes.http.some(prefix => {
        const base = normalize(prefix.path), path = normalize(route.path);
        return (path === base || path.startsWith(base + '/')) && prefix.methods.includes(route.method);
      })) throw new Error(`精确操作没有 HTTP 归属：${plugin.id}.${route.id}`);
      if (route.handler === 'operation' && !plugin.contributes.operations.some(item => item.id === route.id))
        throw new Error(`精确操作缺少类型化处理器：${plugin.id}.${route.id}`);
    }
    for (const prefix of plugin.contributes.http) {
      /**
       * 中文：把冒号路径参数统一为契约花括号形状，供精确路径与操作描述比较。
       * English: Normalize colon path parameters to contract braces for exact route/operation-description comparisons.
       * 中文：输入：value：待校验、转换或保存的输入值
       * English: Inputs: value: input value to validate/transform/save
       */
      const normalize = (value: string) => value.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
      for (const method of prefix.methods)
        if (!plugin.contributes.routes.some(route => route.method === method &&
            (normalize(route.path) === normalize(prefix.path) || normalize(route.path).startsWith(normalize(prefix.path) + '/'))))
          throw new Error(`HTTP 入口缺少显式操作策略：${plugin.id} ${method} ${prefix.path}`);
    }
  }
  for (const pack of packs) {
    unique(
      pack.members.map((item) => `${item.kind}:${item.id}`),
      `${pack.id} 的成员`,
    );
    for (const member of pack.members) {
      const target = member.kind === 'plugin' ? byId.get(member.id) : packById.get(member.id);
      if (!target) throw new Error(`整合包成员不存在：${pack.id} → ${member.id}`);
      if (target.version !== member.version)
        throw new Error(`整合包 ${pack.id} 的成员版本不匹配：${member.id}@${member.version}`);
    }
    for (const alias of pack.replacesPlugins) {
      if (byId.has(alias) || aliases.has(alias)) throw new Error(`旧插件迁移标识冲突：${alias}`);
      aliases.add(alias);
    }
  }
  // Validate unused packages too, so a broken release fails before any services start.
  /**
   * 中文：用 visiting 检测当前 DFS 环、visited 避免重复遍历，覆盖全部目录键；循环错误携带依赖链供修复清单。
   * English: Use visiting for the current DFS cycle/visited for reuse across all catalog keys, reporting dependency chains to repair manifests.
   * 中文：输入：keys：签名所示 string[] 业务值；next：待采用的新状态或数据；label：签名所示 string 业务值
   * English: Inputs: keys: the string[] domain value in the signature; next: new state/data to adopt; label: the string domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const checkCycles = (keys: string[], next: /** 中文：返回当前目录键的直接依赖供 DFS 检测循环；这是 validateCatalog.checkCycles 的调用契约 | English: Return direct dependencies of a catalog key for DFS cycle detection; this is the callable contract of validateCatalog.checkCycles | 中文：输入：key：签名所示 string 业务值 | English: Inputs: key: the string domain value in the signature | 中文：结果：string[]；调用者依赖此类型约定 | English: Result: string[]; callers depend on this type contract */ (key: string) => string[], label: string) => {
    const visiting = new Set<string>(),
      visited = new Set<string>();
    /**
     * 中文：在校验目录并展开依赖、插件包和旧配置迁移流程中登记集合或存储条目，删除匹配条目；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Validating catalogs and expanding dependencies, packs and legacy selection migrations, register collection/storage entries, delete matching entries. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：输入：key：签名所示 string 业务值
     * English: Inputs: key: the string domain value in the signature
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    const visit = (key: string) => {
      if (visiting.has(key)) throw new Error(`${label}依赖循环：${[...visiting, key].join(' → ')}`);
      if (visited.has(key)) return;
      visiting.add(key);
      next(key).forEach(visit);
      visiting.delete(key);
      visited.add(key);
    };
    keys.forEach(visit);
  };
  checkCycles([...byId.keys()], (key) => byId.get(key)!.requires.map((item) => item.id), '插件');
  checkCycles(
    [...packById.keys()],
    (key) =>
      packById
        .get(key)!
        .members.filter((item) => item.kind === 'pack')
        .map((item) => item.id),
    '整合包',
  );
}

// 只自动启用 requires；optional 必须已被其他选择启用。依赖先于插件入序，排序使结果不受用户选择顺序影响。
/**
 * 中文：先校验整个目录，再排序展开用户选中的插件/插件包并递归加入 requires；依赖先入序，optional 不自动启用，结果不受选择输入顺序影响。
 * English: Validate the whole catalog, then deterministically expand selected plugins/packs and recursively add required dependencies. Dependencies enter first, optional dependencies are not enabled automatically, and selection input order does not affect the result.
 * 中文：输入：selection：签名所示 PluginSelection 业务值；plugins：签名所示 PluginManifest[] 业务值；packs：签名所示 PluginPack[] 业务值
 * English: Inputs: selection: the PluginSelection domain value in the signature; plugins: the PluginManifest[] domain value in the signature; packs: the PluginPack[] domain value in the signature
 */
export function resolveSelection(selection: PluginSelection, plugins: PluginManifest[], packs: PluginPack[]) {
  pluginSelectionSchema.parse(selection);
  validateCatalog(plugins, packs);
  const byId = new Map(plugins.map((item) => [item.id, item]));
  const packById = new Map(packs.map((item) => [item.id, item]));
  return resolveCatalogSelection(selection, byId, packById);
}

/**
 * 中文：复制并校验一次目录，在同一快照内解析多项选择。闭包不暴露目录，原始输入后续变化不会绕过校验；调用者在目录状态变化时重建。
 * English: Copy and validate one catalog snapshot for repeated selection resolution. The closure keeps the catalog private, so later input mutations cannot bypass validation; callers rebuild when catalog state changes.
 */
export function createPluginSelectionResolver(plugins: PluginManifest[], packs: PluginPack[]) {
  const snapshot = structuredClone({ plugins, packs });
  validateCatalog(snapshot.plugins, snapshot.packs);
  const byId = new Map(snapshot.plugins.map((item) => [item.id, item]));
  const packById = new Map(snapshot.packs.map((item) => [item.id, item]));
  return (selection: PluginSelection) => {
    pluginSelectionSchema.parse(selection);
    return resolveCatalogSelection(selection, byId, packById);
  };
}

/** 中文：只展开已校验目录，保持依赖、嵌套包及确定性顺序。 English: Expand only a validated catalog, preserving dependencies, nested packs and deterministic order. */
function resolveCatalogSelection(
  selection: PluginSelection,
  byId: ReadonlyMap<string, PluginManifest>,
  packById: ReadonlyMap<string, PluginPack>,
) {
  const visited = new Set<string>(),
    visitedPacks = new Set<string>(),
    order: string[] = [];
  /**
   * 中文：在校验目录并展开依赖、插件包和旧配置迁移流程中登记集合或存储条目；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Validating catalogs and expanding dependencies, packs and legacy selection migrations, register collection/storage entries. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：id：目标资源标识
   * English: Inputs: id: target resource identifier
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const visit = (id: string) => {
    if (visited.has(id)) return;
    const plugin = byId.get(id);
    if (!plugin) throw new Error(`插件不存在：${id}`);
    [...plugin.requires].sort((a, b) => a.id.localeCompare(b.id)).forEach((item) => visit(item.id));
    visited.add(id);
    order.push(id);
  };
  /**
   * 中文：在校验目录并展开依赖、插件包和旧配置迁移流程中登记集合或存储条目；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Validating catalogs and expanding dependencies, packs and legacy selection migrations, register collection/storage entries. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：id：目标资源标识
   * English: Inputs: id: target resource identifier
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const visitPack = (id: string) => {
    if (visitedPacks.has(id)) return;
    const pack = packById.get(id);
    if (!pack) throw new Error(`整合包不存在：${id}`);
    visitedPacks.add(id);
    for (const item of pack.members) item.kind === 'plugin' ? visit(item.id) : visitPack(item.id);
  };
  [...new Set(selection.plugins)].sort().forEach(visit);
  [...new Set(selection.packs)].sort().forEach(visitPack);
  return order;
}

// 旧版 automation 的调度能力拆成独立插件；迁移保留原先的调度意图，当前版选择不自动增加它。
/**
 * 中文：按输入 schemaVersion 校验旧选择，把拆分的旧插件映射为插件包，并为旧 automation 选择保留调度器；去重排序并返回可解释的迁移记录，不改变当前版用户选择意图。
 * English: Validate legacy selections by schemaVersion, map split legacy plugins to packs and preserve the scheduler for old automation selections. Deduplicate/sort and return explanatory migration records without changing current-version intent.
 * 中文：输入：input：尚待校验的输入数据；packs：签名所示 PluginPack[] 业务值
 * English: Inputs: input: input data requiring validation; packs: the PluginPack[] domain value in the signature
 * 中文：结果：包含 selection、migrations 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing selection, migrations for caller state reads/operations
 */
export function migrateSelection(input: unknown, packs: PluginPack[]) {
  const source = zSelection(input);
  const selection = {
    ...source,
    schemaVersion: 3 as const,
    plugins: [...source.plugins],
    packs: [...source.packs],
  };
  const migrations: string[] = [];
  if (source.schemaVersion < 3 && selection.plugins.includes('automation')) {
    selection.plugins.push('automation-scheduler');
    migrations.push('原自动化插件的计划任务已保留为 automation-scheduler 插件');
  }
  for (const pack of packs)
    for (const alias of pack.replacesPlugins) {
      if (!selection.plugins.includes(alias)) continue;
      selection.plugins = selection.plugins.filter((id) => id !== alias);
      selection.packs.push(pack.id);
      migrations.push(`原插件 ${alias} 已拆分，保留为整合包 ${pack.id}`);
    }
  selection.plugins = [...new Set(selection.plugins)].sort();
  selection.packs = [...new Set(selection.packs)].sort();
  return { selection, migrations };
}
/**
 * 中文：在校验目录并展开依赖、插件包和旧配置迁移流程中按指定 Schema 校验并解码；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
 * English: In Validating catalogs and expanding dependencies, packs and legacy selection migrations, validate/decode with the specified schema. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
 * 中文：输入：input：尚待校验的输入数据
 * English: Inputs: input: input data requiring validation
 */
function zSelection(input: unknown) {
  const version = (input as { schemaVersion?: unknown })?.schemaVersion;
  if (version === 1) return legacySelectionSchema.parse(input);
  if (version === 2) return legacySelectionSchemaV2.parse(input);
  return pluginSelectionSchema.parse(input);
}

/**
 * 中文：逐个用户插件或包根独立展开依赖，把每个启用插件关联到导致其启用的根列表，避免仅按最终集合丢失来源。
 * English: Independently expand each selected plugin/pack root and associate enabled plugins with every causing root, retaining provenance lost by a final-set-only view.
 * 中文：输入：selection：签名所示 PluginSelection 业务值；plugins：签名所示 PluginManifest[] 业务值；packs：签名所示 PluginPack[] 业务值
 * English: Inputs: selection: the PluginSelection domain value in the signature; plugins: the PluginManifest[] domain value in the signature; packs: the PluginPack[] domain value in the signature
 */
export function selectionReasons(selection: PluginSelection, plugins: PluginManifest[], packs: PluginPack[]) {
  const reasons: Record<string, PluginRoot[]> = Object.create(null);
  for (const kind of ['plugin', 'pack'] as const)
    for (const id of selection[kind === 'plugin' ? 'plugins' : 'packs']) {
      const root = { ...emptySelection(), [kind === 'plugin' ? 'plugins' : 'packs']: [id] };
      for (const child of resolveSelection(root, plugins, packs)) (reasons[child] ||= []).push({ kind, id });
    }
  return reasons;
}
