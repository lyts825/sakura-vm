/**
 * 模块职责（中文）：向界面提供已启用插件集合，并通过上下文查询或门控组件控制插件内容可见性。
 * Module responsibility (English): Querying enabled plugins and controlling visibility of their UI contributions.
 * 详细范围（中文）：公开入口包括 PluginContext, usePlugins, usePlugin, PluginGate；职责覆盖查询已启用插件并控制界面贡献可见性，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include PluginContext, usePlugins, usePlugin, PluginGate. The scope covers Querying enabled plugins and controlling visibility of their UI contributions. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { createContext, useContext, type ReactNode } from 'react';

export const PluginContext = createContext<readonly string[]>([]);
/**
 * 中文：读取当前插件上下文中的启用集合和请求能力；必须在 provider 范围内调用。
 * English: Read enabled plugins and request authority from the current plugin context; call within its provider.
 */
export const usePlugins = () => useContext(PluginContext);
/**
 * 中文：根据插件 ID 在当前启用集合中查找清单，未启用时返回未设置值供调用者隐藏入口。
 * English: Find a manifest by plugin ID in the current enabled set, returning an unset value when disabled so callers can hide its surface.
 * 中文：输入：id：目标资源标识
 * English: Inputs: id: target resource identifier
 */
export const usePlugin = (id: string) => usePlugins().includes(id);
/**
 * 中文：仅在指定插件启用时呈现 children，否则使用 fallback，为贡献界面提供一致的可见性判断。
 * English: Render children only while the specified plugin is enabled, otherwise use fallback, providing consistent contribution visibility.
 * 中文：输入：{ id, children } 提供 id（目标资源标识）、children（children 状态） 上下文字段
 * English: Inputs: { id, children } provides context fields id (target resource identifier), children (children state)
 */
export function PluginGate({ id, children }: { id: string; children: ReactNode }) {
  return usePlugin(id) ? children : null;
}
