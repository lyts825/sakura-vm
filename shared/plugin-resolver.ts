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

function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label}重复`);
}
const segments = (path: string) => path.split('/').filter(Boolean);
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
        !['bootstrap', 'system', 'plugins', 'jobs', 'events', 'downloads', 'vms', 'audit', 'monitor', 'openapi', 'sdk', 'log-retention', 'graphql', 'graphql-schema', 'session', 'webhooks', 'assistant', 'native-integration', 'native-clipboard'].includes(parts[1]);
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
  const checkCycles = (keys: string[], next: (key: string) => string[], label: string) => {
    const visiting = new Set<string>(),
      visited = new Set<string>();
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

export function resolveSelection(selection: PluginSelection, plugins: PluginManifest[], packs: PluginPack[]) {
  pluginSelectionSchema.parse(selection);
  validateCatalog(plugins, packs);
  const byId = new Map(plugins.map((item) => [item.id, item]));
  const packById = new Map(packs.map((item) => [item.id, item]));
  const visited = new Set<string>(),
    visitedPacks = new Set<string>(),
    order: string[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    const plugin = byId.get(id);
    if (!plugin) throw new Error(`插件不存在：${id}`);
    [...plugin.requires].sort((a, b) => a.id.localeCompare(b.id)).forEach((item) => visit(item.id));
    visited.add(id);
    order.push(id);
  };
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
function zSelection(input: unknown) {
  const version = (input as { schemaVersion?: unknown })?.schemaVersion;
  if (version === 1) return legacySelectionSchema.parse(input);
  if (version === 2) return legacySelectionSchemaV2.parse(input);
  return pluginSelectionSchema.parse(input);
}

export function selectionReasons(selection: PluginSelection, plugins: PluginManifest[], packs: PluginPack[]) {
  const reasons: Record<string, PluginRoot[]> = Object.create(null);
  for (const kind of ['plugin', 'pack'] as const)
    for (const id of selection[kind === 'plugin' ? 'plugins' : 'packs']) {
      const root = { ...emptySelection(), [kind === 'plugin' ? 'plugins' : 'packs']: [id] };
      for (const child of resolveSelection(root, plugins, packs)) (reasons[child] ||= []).push({ kind, id });
    }
  return reasons;
}
