/** 校验插件清单、整合包和操作声明的对应关系，并结合源码契约与版本服务接口检查可用边界。 */
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { loaders, validateRegistry } from '../server/plugins/registry.ts';
import { resolvePlugins } from '../shared/plugin-selection.ts';
import { PLUGINS, PLUGIN_PACKS, emptySelection } from '../shared/plugins.ts';
import { syncPluginCatalog } from './sync-plugin-catalog.ts';
import { assertPluginSourceContracts } from './plugin-source-contracts.ts';
import { pluginRouteResponses } from '../shared/contracts/plugin-route-responses.ts';

await syncPluginCatalog(true);
validateRegistry();
assertPluginSourceContracts(PLUGINS);
for (const plugin of PLUGINS) {
  const module = await loaders[plugin.id]();
  assert.deepEqual(module.manifest, plugin, `${plugin.id}: manifest and entry point must agree`);
  assert.equal(typeof module.activate, 'function', `${plugin.id}: missing activate`);
  assert.equal(typeof module.route, 'function', `${plugin.id}: missing route`);
  assert.deepEqual(Object.keys(module.httpHandlers || {}).sort(),
    plugin.contributes.routes.filter(item => item.handler === 'route').map(item => item.id).sort(),
    `${plugin.id}: exact HTTP handler registrations differ`);
  for (const handler of Object.values(module.httpHandlers || {}))
    assert.equal(typeof handler, 'function', `${plugin.id}: missing exact HTTP handler`);
  assert.deepEqual(
    Object.keys(module.operations || {}).sort(),
    plugin.contributes.operations.map((item) => item.id).sort(),
    `${plugin.id}: operation entry points differ`,
  );
  for (const operation of Object.values(module.operations || {})) {
    assert.equal(typeof operation.execute, 'function', `${plugin.id}: missing operation handler`);
    assert.equal(typeof operation.response?.parse, 'function', `${plugin.id}: missing response schema`);
  }
  for (const route of plugin.contributes.routes) {
    const contract = pluginRouteResponses[`${plugin.id}.${route.id}` as keyof typeof pluginRouteResponses];
    assert.ok(contract?.statuses.some(status => status === route.status), `${plugin.id}.${route.id}: default status differs from public response contract`);
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
