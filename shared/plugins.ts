/**
 * 模块职责（中文）：导出内置插件目录并查询界面贡献的归属/启用状态，供导航和插件门控使用。
 * Module responsibility (English): Querying ownership and enabled state of builtin plugin contributions.
 * 详细范围（中文）：公开入口包括 PluginRuntimeView, pluginSurfaceOwner, pluginSurfaceEnabled, developmentSections；职责覆盖查询内置插件贡献的归属和启用状态，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include PluginRuntimeView, pluginSurfaceOwner, pluginSurfaceEnabled, developmentSections. The scope covers Querying ownership and enabled state of builtin plugin contributions. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import {PLUGINS} from './plugin-catalog.generated.ts';
import {createPluginSurfaceQueries} from './plugin-surface-queries.ts';
export {PLUGINS,PLUGIN_PACKS} from './plugin-catalog.generated.ts';
export * from './plugin-protocol.ts';
export type {PluginRuntimeView} from './plugin-surface-queries.ts';
export const {pluginSurfaceOwner,pluginSurfaceEnabled,developmentSections}=createPluginSurfaceQueries(PLUGINS);
