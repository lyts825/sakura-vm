import { createContext, useContext, type ReactNode } from 'react';

export const PluginContext = createContext<readonly string[]>([]);
export const usePlugins = () => useContext(PluginContext);
export const usePlugin = (id: string) => usePlugins().includes(id);
export function PluginGate({ id, children }: { id: string; children: ReactNode }) {
  return usePlugin(id) ? children : null;
}
