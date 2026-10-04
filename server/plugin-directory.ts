import { AppError } from '../shared/errors.ts';
import type { PluginSource } from '../shared/contracts/plugin-runtime.ts';
import { PluginInstance } from './plugin-instance.ts';

/** Shared by trusted modules, system services and the signed WASM adapter. */
export class PluginDirectory {
  private instances = new Map<string, PluginInstance>();
  private desired = new Set<string>();
  private revision = 0;
  setDesired(source: PluginSource, ids: Iterable<string>) {
    for (const key of [...this.desired]) if (key.startsWith(source + ':')) this.desired.delete(key);
    for (const id of ids) this.desired.add(`${source}:${id}`);
    for (const instance of this.instances.values()) instance.desired = this.desired.has(instance.identity);
  }
  begin(source: PluginSource, id: string, version: string, digest: string, permissions?: readonly string[]) {
    const key = `${source}:${id}`, previous = this.instances.get(key);
    if (previous && !['inactive', 'failed', 'skipped'].includes(previous.phase))
      throw new AppError('原插件实例尚未确认清理', 409, 'PLUGIN_CLEANUP_PENDING');
    const instance = new PluginInstance(source, id, version, digest, permissions);
    instance.desired = source === 'system' || this.desired.has(key);
    this.instances.set(key, instance);
    return instance;
  }
  get(source: PluginSource, id: string) { return this.instances.get(`${source}:${id}`); }
  all() { return [...this.instances.values()]; }
  publish(instance: PluginInstance) { instance.check(undefined, true); instance.phase = 'running'; this.revision++; }
  changed() { this.revision++; }
  view() { return { version: this.revision, instances: this.all().map(instance => instance.view()) }; }
}
