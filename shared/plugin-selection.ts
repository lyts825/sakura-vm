/**
 * 模块职责（中文）：以项目内置插件目录封装选择解析、依赖解释和旧版本配置迁移。
 * Module responsibility (English): Wrapping selection resolution and dependency explanation with the builtin catalog.
 * 详细范围（中文）：公开入口包括 resolvePlugins, explainPlugins, migratePlugins；职责覆盖以内置目录封装选择解析和依赖解释，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include resolvePlugins, explainPlugins, migratePlugins. The scope covers Wrapping selection resolution and dependency explanation with the builtin catalog. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { PLUGINS, PLUGIN_PACKS } from './plugins.ts';
import { resolveSelection, selectionReasons, migrateSelection } from './plugin-resolver.ts';
import type { PluginSelection } from './plugin-protocol.ts';
export { validateCatalog } from './plugin-resolver.ts';
/**
 * 中文：用内置插件/包目录解析用户选择，返回展开依赖后的插件及启用顺序。
 * English: Resolve user selection against the builtin plugin/pack catalog, returning expanded dependencies and activation order.
 * 中文：输入：selection：签名所示 PluginSelection 业务值；plugins：此处理器的调用值（缺省 PLUGINS）；packs：此处理器的调用值（缺省 PLUGIN_PACKS）
 * English: Inputs: selection: the PluginSelection domain value in the signature; plugins: the invocation value for this handler (default PLUGINS); packs: the invocation value for this handler (default PLUGIN_PACKS)
 */
export const resolvePlugins = (selection: PluginSelection, plugins = PLUGINS, packs = PLUGIN_PACKS) =>
  resolveSelection(selection, plugins, packs);
/**
 * 中文：对内置目录中的选择生成插件启用原因，帮助界面解释显式选择、包成员和依赖来源。
 * English: Explain enabled plugins in a builtin-catalog selection, distinguishing explicit selection, pack membership and required dependencies.
 * 中文：输入：selection：签名所示 PluginSelection 业务值
 * English: Inputs: selection: the PluginSelection domain value in the signature
 */
export const explainPlugins = (selection: PluginSelection) =>
  selectionReasons(selection, PLUGINS, PLUGIN_PACKS);
/**
 * 中文：按内置目录将旧版本选择迁移到当前选择协议，返回迁移后的选择和可显示变更记录。
 * English: Migrate legacy selections with the builtin catalog, returning current-protocol selection and displayable migration records.
 * 中文：输入：input：尚待校验的输入数据
 * English: Inputs: input: input data requiring validation
 */
export const migratePlugins = (input: unknown) => migrateSelection(input, PLUGIN_PACKS);
