import { PLUGINS, PLUGIN_PACKS } from './plugin-catalog.generated.ts';
export { PLUGINS, PLUGIN_PACKS } from './plugin-catalog.generated.ts';
export * from './plugin-protocol.ts';
import type { PluginInstanceView } from './contracts/plugin-runtime.ts';
export type PluginRuntimeView = { version: number; instances: PluginInstanceView[] };
export function pluginSurfaceOwner(active: readonly string[], kind: 'pages' | 'tabs', id: string, runtime?: PluginRuntimeView) {
  if (runtime) return runtime.instances.find(instance => instance.source === 'official' && instance.phase === 'running' &&
    instance.contributions?.some(item => item.kind === (kind === 'pages' ? 'page' : 'tab') && item.target === id))?.pluginId;
  return PLUGINS.find(item => active.includes(item.id) && item.contributes[kind].includes(id))?.id;
}
export function pluginSurfaceEnabled(active: readonly string[], kind: 'pages' | 'tabs', id: string, runtime?: PluginRuntimeView) {
  if ((kind === 'pages' ? ['workspace', 'plugins', 'settings'] : ['terminal', 'config']).includes(id))
    return true;
  if (kind === 'pages' && id === 'tasks') return active.length > 0;
  return !!pluginSurfaceOwner(active, kind, id, runtime);
}
export function developmentSections(active: readonly string[]) {
  return [
    ...new Set(
      PLUGINS.filter((item) => active.includes(item.id)).flatMap(
        (item) => item.contributes.developmentSections,
      ),
    ),
  ];
}
