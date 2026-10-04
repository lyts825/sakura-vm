import { PLUGINS, PLUGIN_PACKS, type HttpContribution } from '../../shared/plugins.ts';
import { validateCatalog } from '../../shared/plugin-selection.ts';
import { loaders } from './loaders.generated.ts';
export { loaders } from './loaders.generated.ts';
export type { PluginModule } from '../plugin-api.ts';
/** Exact dispatch endpoints. Prefix declarations remain package ownership metadata only. */
export function pluginHttpRoutes() {
  return PLUGINS.flatMap((plugin) => plugin.contributes.routes.map((route) => ({
    ...route, owner: plugin.id, methods: [route.method] as HttpContribution['methods'],
    projectScoped: route.policy.projectScoped,
  })));
}
export function matchOperationPath(pattern: string, path: string): Record<string, string> | undefined {
  const expected = pattern.replace(/:([a-zA-Z0-9_]+)/g, '{$1}').split('/');
  const actual = path.split('/');
  if (expected.length !== actual.length) return;
  const parameters: Record<string, string> = {};
  for (let i = 0; i < expected.length; i++) {
    const variable = /^\{([a-zA-Z0-9_]+)\}$/.exec(expected[i]);
    if (!variable) { if (actual[i] !== expected[i]) return; continue; }
    let value: string;
    try { value = decodeURIComponent(actual[i]); } catch { return; }
    if (!value || value === '.' || value === '..' || /[\\/\x00-\x1f\x7f]/.test(value) ||
        (variable[1] === 'vmId' && value === 'batch')) return;
    parameters[variable[1]] = value;
  }
  return parameters;
}
export function validateRegistry() {
  validateCatalog(PLUGINS, PLUGIN_PACKS);
  if (
    Object.keys(loaders).length !== PLUGINS.length ||
    PLUGINS.some((plugin) => !Object.hasOwn(loaders, plugin.id))
  )
    throw new Error('插件声明与服务入口不一致');
}
export function routeContribution(path: string): (HttpContribution & { owner: string }) | undefined {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'api') return undefined;
  // Task aggregation is a host endpoint; it only sees services of active plugins.
  if ((parts[1] === 'events' && parts.length === 2) ||
      (parts[1] === 'jobs' && (parts.length === 2 || (parts.length === 4 && ['cancel', 'retry', 'result'].includes(parts[3])))))
    return {
      owner: 'tasks',
      path: '/api/' + parts[1],
      methods: parts.length === 4 && parts[3] !== 'result' ? ['POST'] : ['GET'],
      projectScoped: false,
    };
  const matches = pluginHttpRoutes().filter((route) => matchOperationPath(route.path, path))
    .sort((left, right) => (left.path.match(/[:{]/g)?.length || 0) - (right.path.match(/[:{]/g)?.length || 0));
  const first = matches[0];
  if (!first) return;
  return { ...first, methods: matches.filter(route => route.path === first.path).flatMap(route => route.methods) };
}
export const routeOwner = (path: string) => routeContribution(path)?.owner;
export function socketOwner(channel: 'desktop' | 'terminal-session') {
  return PLUGINS.find((plugin) => plugin.contributes.sockets.includes(channel))?.id;
}
