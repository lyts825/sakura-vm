import { PLUGINS, PLUGIN_PACKS } from './plugin-catalog.generated.ts';
export { PLUGINS, PLUGIN_PACKS } from './plugin-catalog.generated.ts';
export * from './plugin-protocol.ts';
export function pluginSurfaceEnabled(active: readonly string[], kind: 'pages' | 'tabs', id: string) {
  if ((kind === 'pages' ? ['workspace', 'plugins', 'settings'] : ['terminal', 'config']).includes(id))
    return true;
  if (kind === 'pages' && id === 'tasks') return active.length > 0;
  return PLUGINS.some(
    (item) => active.includes(item.id) && item.contributes[kind].some((entry) => entry === id),
  );
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
