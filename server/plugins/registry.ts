import { PLUGINS, PLUGIN_PACKS, type HttpContribution } from '../../shared/plugins.ts';
import { validateCatalog } from '../../shared/plugin-selection.ts';
import { loaders } from './loaders.generated.ts';
export { loaders } from './loaders.generated.ts';
export type { PluginModule } from '../plugin-api.ts';
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
  if (['jobs', 'events'].includes(parts[1]))
    return {
      owner: 'tasks',
      path: '/api/' + parts[1],
      methods: parts[1] === 'jobs' ? ['GET', 'POST'] : ['GET'],
      projectScoped: false,
    };
  for (const plugin of PLUGINS)
    for (const route of plugin.contributes.http) {
      const pattern = route.path.split('/').filter(Boolean);
      if (parts.length < pattern.length) continue;
      if (
        pattern.every((part, i) =>
          part === ':vmId' ? !!parts[i] && parts[i] !== 'batch' : part === parts[i],
        )
      )
        return { ...route, owner: plugin.id };
    }
}
export const routeOwner = (path: string) => routeContribution(path)?.owner;
export function socketOwner(channel: 'desktop' | 'terminal-session') {
  return PLUGINS.find((plugin) => plugin.contributes.sockets.includes(channel))?.id;
}
