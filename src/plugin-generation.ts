/**
 * 模块职责：跟踪安装身份对应的权限与运行代次，权限、产物或阶段变化时取消旧生命周期的请求。
 */
import { PLUGINS } from '../shared/plugins';
import type { PluginInstanceView } from '../shared/contracts/plugin-runtime';

type Lifetime = { fingerprint: string; running: boolean; controller: AbortController };
type Listener = (identities: readonly string[]) => void;

/** Each installed identity owns its authority lifetime; a replacement never inherits it. */
export class PluginGeneration {
  private initialized = false;
  private lifetimes = new Map<string, Lifetime>();
  private instances: PluginInstanceView[] = [];
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private lifetime(identity: string) {
    let lifetime = this.lifetimes.get(identity);
    if (!lifetime) {
      lifetime = { fingerprint: '', running: !this.initialized, controller: new AbortController() };
      if (!lifetime.running) lifetime.controller.abort(new Error('插件当前不可用'));
      this.lifetimes.set(identity, lifetime);
    }
    return lifetime;
  }

  update(view?: { version: number; instances: PluginInstanceView[] }) {
    if (!view) return false;
    const incoming = new Map(view.instances.map(instance => [instance.identity, instance]));
    const changed: string[] = [];
    for (const identity of new Set([...this.lifetimes.keys(), ...incoming.keys()])) {
      const instance = incoming.get(identity);
      // 运行代次、阶段、权限集合和产物摘要共同决定访问能力；仅插件 ID 相同不能沿用旧请求权限。
      const fingerprint = instance ? JSON.stringify([instance.generation, instance.phase,
        [...instance.permissions].sort(), instance.artifactDigest]) : 'absent';
      const previous = this.lifetimes.get(identity);
      if (previous?.fingerprint === fingerprint) continue;
      previous?.controller.abort(new Error('插件运行状态已变化，请重新操作'));
      const next = { fingerprint, running: instance?.phase === 'running', controller: new AbortController() };
      if (!next.running) next.controller.abort(new Error(instance?.error || '插件当前不可用'));
      this.lifetimes.set(identity, next);
      changed.push(identity);
    }
    const wasInitialized = this.initialized;
    this.initialized = true;
    this.instances = view.instances;
    if (changed.length) for (const listener of this.listeners) listener(changed);
    return wasInitialized && changed.length > 0;
  }

  snapshot(identity: string) { return this.lifetime(identity).fingerprint; }
  available(identity: string) { return this.lifetime(identity).running; }
  captureIdentity(identity: string) { return this.lifetime(identity).controller.signal; }

  // 路由归属按最长匹配前缀确定，社区扩展路径则使用其安装身份，避免落入插件管理器的权限作用域。
  identityFor(path: string, method = 'GET') {
    const pathname = path.split('?')[0].replace(/^\/api(?=\/)/, '');
    // Community routes carry their installed identity, rather than the manager's identity.
    const community = /^\/community-plugins\/extensions\/([^/]+)\//.exec(pathname);
    if (community) return `community:${community[1]}`;
    const parts = pathname.split('/').filter(Boolean);
    const matches = PLUGINS.flatMap(plugin => plugin.contributes.http
      .filter(route => route.methods.some(value => value === method.toUpperCase()))
      .map(route => ({ identity: `official:${plugin.id}`, parts: route.path.replace(/^\/api/, '').split('/').filter(Boolean) })))
      .filter(route => route.parts.length <= parts.length && route.parts.every((value, index) => value.startsWith(':') || value === parts[index]))
      .sort((a, b) => b.parts.length - a.parts.length);
    if (matches[0]) return matches[0].identity;
    return this.instances.find(instance => instance.contributions?.some(item =>
      item.kind === 'http' && item.target.replace(/^\/api(?=\/)/, '') === pathname))?.identity;
  }

  capture(path: string, method = 'GET') {
    const identity = this.identityFor(path, method);
    return identity ? this.captureIdentity(identity) : undefined;
  }
}
export const pluginGeneration = new PluginGeneration();
