/**
 * 模块职责（中文）：导出内置插件目录并查询界面贡献的归属/启用状态，供导航和插件门控使用。
 * Module responsibility (English): Querying ownership and enabled state of builtin plugin contributions.
 * 详细范围（中文）：公开入口包括 PluginRuntimeView, pluginSurfaceOwner, pluginSurfaceEnabled, developmentSections；职责覆盖查询内置插件贡献的归属和启用状态，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include PluginRuntimeView, pluginSurfaceOwner, pluginSurfaceEnabled, developmentSections. The scope covers Querying ownership and enabled state of builtin plugin contributions. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { PLUGINS, PLUGIN_PACKS } from './plugin-catalog.generated.ts';
export { PLUGINS, PLUGIN_PACKS } from './plugin-catalog.generated.ts';
export * from './plugin-protocol.ts';
import type { PluginInstanceView } from './contracts/plugin-runtime.ts';
export type PluginRuntimeView = { version: number; instances: PluginInstanceView[] };
/**
 * 中文：优先从运行时 running 的官方安装精确贡献中查页面/分区归属；无运行时视图时只查已启用的内置清单。
 * English: Prefer exact page/tab contributions from running official runtime installations; without a runtime view inspect only enabled builtin manifests.
 * 中文：输入：active：签名所示 readonly string[] 业务值；kind：签名所示 'pages' | 'tabs' 业务值；id：目标资源标识；runtime：签名所示 PluginRuntimeView 业务值
 * English: Inputs: active: the readonly string[] domain value in the signature; kind: the 'pages' | 'tabs' domain value in the signature; id: target resource identifier; runtime: the PluginRuntimeView domain value in the signature
 */
export function pluginSurfaceOwner(active: readonly string[], kind: 'pages' | 'tabs', id: string, runtime?: PluginRuntimeView) {
  if (runtime) return runtime.instances.find(instance => instance.source === 'official' && instance.phase === 'running' &&
    instance.contributions?.some(item => item.kind === (kind === 'pages' ? 'page' : 'tab') && item.target === id))?.pluginId;
  return PLUGINS.find(item => active.includes(item.id) && item.contributes[kind].includes(id))?.id;
}
/**
 * 中文：基础页面和终端/配置分区始终可见，任务页需要至少一个插件，其他入口必须有当前有效贡献归属。
 * English: Keep base pages and terminal/config tabs visible, require at least one plugin for tasks, and require current contribution ownership for other surfaces.
 * 中文：输入：active：签名所示 readonly string[] 业务值；kind：签名所示 'pages' | 'tabs' 业务值；id：目标资源标识；runtime：签名所示 PluginRuntimeView 业务值
 * English: Inputs: active: the readonly string[] domain value in the signature; kind: the 'pages' | 'tabs' domain value in the signature; id: target resource identifier; runtime: the PluginRuntimeView domain value in the signature
 */
export function pluginSurfaceEnabled(active: readonly string[], kind: 'pages' | 'tabs', id: string, runtime?: PluginRuntimeView) {
  if ((kind === 'pages' ? ['workspace', 'plugins', 'settings'] : ['terminal', 'config']).includes(id))
    return true;
  if (kind === 'pages' && id === 'tasks') return active.length > 0;
  return !!pluginSurfaceOwner(active, kind, id, runtime);
}
/**
 * 中文：收集已启用内置清单的开发分区并按首次出现顺序去重，供开发界面装配。
 * English: Collect development sections from enabled builtin manifests and deduplicate by first occurrence for UI composition.
 * 中文：输入：active：签名所示 readonly string[] 业务值
 * English: Inputs: active: the readonly string[] domain value in the signature
 */
export function developmentSections(active: readonly string[]) {
  return [
    ...new Set(
      PLUGINS.filter((item) => active.includes(item.id)).flatMap(
        (item) => item.contributes.developmentSections,
      ),
    ),
  ];
}
