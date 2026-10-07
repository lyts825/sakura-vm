/**
 * 模块职责：向界面提供已启用插件集合，并通过上下文查询或门控组件控制插件内容可见性。
 */
import { createContext, useContext, type ReactNode } from 'react';

export const PluginContext = createContext<readonly string[]>([]);
export const usePlugins = () => useContext(PluginContext);
export const usePlugin = (id: string) => usePlugins().includes(id);
export function PluginGate({ id, children }: { id: string; children: ReactNode }) {
  return usePlugin(id) ? children : null;
}
