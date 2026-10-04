import { randomUUID } from 'node:crypto';
import { pluginAuthority, withPluginAuthority } from './plugin-authority.ts';

/** A registration receipt can only remove the callback it originally installed. */
export class ManagedHooks<A extends unknown[]> {
  private callbacks = new Map<string, { run: (...args: A) => Promise<void> | void; active: () => boolean }>();
  register(run: (...args: A) => Promise<void> | void): () => void {
    const instance = pluginAuthority(), id = randomUUID();
    instance?.check('events', true);
    this.callbacks.set(id, { run: (...args) => instance ? withPluginAuthority(instance, () => run(...args)) : run(...args),
      active: () => !instance || instance.phase === 'running' && !instance.signal.aborted });
    const unregister = () => { this.callbacks.delete(id); };
    if (instance) {
      instance.signal.addEventListener('abort', unregister, { once: true });
      instance.scope.add(() => { unregister(); instance.signal.removeEventListener('abort', unregister); });
    }
    return unregister;
  }
  async dispatch(...args: A) {
    for (const callback of [...this.callbacks.values()]) if (callback.active()) await callback.run(...args);
  }
  get size() { return this.callbacks.size; }
}
