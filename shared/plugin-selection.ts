/**
 * 模块职责：以项目内置插件目录封装选择解析、依赖解释和旧版本配置迁移。
 */
import { PLUGINS, PLUGIN_PACKS } from './plugins.ts';
import { resolveSelection, selectionReasons, migrateSelection } from './plugin-resolver.ts';
import type { PluginSelection } from './plugin-protocol.ts';
export { validateCatalog } from './plugin-resolver.ts';
export const resolvePlugins = (selection: PluginSelection, plugins = PLUGINS, packs = PLUGIN_PACKS) =>
  resolveSelection(selection, plugins, packs);
export const explainPlugins = (selection: PluginSelection) =>
  selectionReasons(selection, PLUGINS, PLUGIN_PACKS);
export const migratePlugins = (input: unknown) => migrateSelection(input, PLUGIN_PACKS);
