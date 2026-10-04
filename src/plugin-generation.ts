import { PLUGINS } from '../shared/plugins';
import type { PluginInstanceView } from '../shared/contracts/plugin-runtime';

export class PluginGeneration {
  private fingerprint = '';
  private lifetime = new AbortController();
  update(view?: { version: number; instances: PluginInstanceView[] }) {
    if (!view) return false;
    const next = JSON.stringify(view.instances.map(item => [item.identity, item.generation, item.phase, item.permissions]).sort());
    if (next === this.fingerprint) return false;
    const previous = this.fingerprint; this.fingerprint = next;
    if (previous) this.lifetime.abort(new Error('插件运行状态已变化，请重新操作'));
    this.lifetime = new AbortController(); return !!previous;
  }
  capture(path: string) {
    const parts = path.split('?')[0].split('/').filter(Boolean);
    const plugin = PLUGINS.some(item => item.contributes.http.some(route => {
      const declared = route.path.replace(/^\/api/, '').split('/').filter(Boolean);
      return declared.length <= parts.length && declared.every((value, index) => value === ':vmId' || value === parts[index]);
    }));
    return plugin ? this.lifetime.signal : undefined;
  }
}
export const pluginGeneration = new PluginGeneration();
