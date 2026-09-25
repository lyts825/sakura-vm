import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { loaders, validateRegistry } from '../server/plugins/registry.ts';
import { resolvePlugins } from '../shared/plugin-selection.ts';
import { PLUGINS, PLUGIN_PACKS, emptySelection } from '../shared/plugins.ts';
import { syncPluginCatalog } from './sync-plugin-catalog.ts';

await syncPluginCatalog(true);
validateRegistry();
for (const plugin of PLUGINS) {
  const module = await loaders[plugin.id]();
  assert.deepEqual(module.manifest, plugin, `${plugin.id}: manifest and entry point must agree`);
  assert.equal(typeof module.activate, 'function', `${plugin.id}: missing activate`);
  assert.equal(typeof module.route, 'function', `${plugin.id}: missing route`);
  assert.deepEqual(
    Object.keys(module.operations || {}).sort(),
    plugin.contributes.operations.map((item) => item.id).sort(),
    `${plugin.id}: operation entry points differ`,
  );
  for (const operation of Object.values(module.operations || {})) {
    assert.equal(typeof operation.execute, 'function', `${plugin.id}: missing operation handler`);
    assert.equal(typeof operation.response?.parse, 'function', `${plugin.id}: missing response schema`);
  }
  const customSurface =
    plugin.contributes.pages.length > 0 ||
    plugin.contributes.tabs.some((id) => id !== 'development') ||
    plugin.contributes.developmentSections.length > 0;
  if (customSurface)
    assert.ok(
      existsSync(new URL(`../plugins/${plugin.id}/client.tsx`, import.meta.url)),
      `${plugin.id}: missing client.tsx`,
    );
}
assert.deepEqual(resolvePlugins(emptySelection()), []);
for (const pack of PLUGIN_PACKS) resolvePlugins({ ...emptySelection(), packs: [pack.id] });
console.log(
  `Validated ${PLUGINS.length} plugin contracts and ${PLUGIN_PACKS.length} packs. No services activated.`,
);
