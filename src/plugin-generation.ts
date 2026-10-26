/**
 * 模块职责（中文）：跟踪安装身份对应的权限与运行代次，权限、产物或阶段变化时取消旧生命周期的请求。
 * Module responsibility (English): Revoking old access capabilities when generation, phase, permissions or artifacts change.
 * 详细范围（中文）：公开入口包括 PluginGeneration, pluginGeneration；职责覆盖在运行代次、阶段、权限或产物变化时撤销旧访问能力，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include PluginGeneration, pluginGeneration. The scope covers Revoking old access capabilities when generation, phase, permissions or artifacts change. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { PLUGINS } from './plugin-surfaces.ts';
import type { PluginInstanceView } from '../shared/contracts/plugin-runtime';

type Lifetime = { fingerprint: string; running: boolean; controller: AbortController };
type Listener = /** 中文：声明同步接收变化安装身份列表的观察者，只更新所属插件边界与缓存。 | English: Declare a synchronous observer receiving changed installation identities for updating only their plugin boundaries/caches. | 中文：输入：identities：待撤销的插件安装身份集合 | English: Inputs: identities: plugin installation identities to revoke | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (identities: readonly string[]) => void;

/** Each installed identity owns its authority lifetime; a replacement never inherits it. */
export class PluginGeneration {
  private initialized = false;
  private lifetimes = new Map<string, Lifetime>();
  private instances: PluginInstanceView[] = [];
  private listeners = new Set<Listener>();

  /**
   * 中文：登记插件身份变化观察者，返回仅移除此观察者的退订函数。
   * English: Register an observer of changed plugin identities and return an unsubscribe removing only that observer.
   * 中文：输入：listener：本订阅的变化观察者
   * English: Inputs: listener: change observer for this subscription
   * 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用
   * English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary
   */
  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /**
   * 中文：按安装身份懒建取消寿命；首次运行时视图到来前允许加载，初始化后未知身份立即取消，避免未安装插件取得有效请求能力。
   * English: Lazily create an installation-scoped cancellation lifetime. Permit loading before the first runtime view, but abort unknown identities after initialization so absent plugins cannot obtain live request authority.
   * 中文：输入：identity：插件安装或资源权限身份
   * English: Inputs: identity: plugin installation/resource authority identity
   */
  private lifetime(identity: string) {
    let lifetime = this.lifetimes.get(identity);
    if (!lifetime) {
      lifetime = { fingerprint: '', running: !this.initialized, controller: new AbortController() };
      if (!lifetime.running) lifetime.controller.abort(new Error('插件当前不可用'));
      this.lifetimes.set(identity, lifetime);
    }
    return lifetime;
  }

  /**
   * 中文：用激活代次、阶段、排序权限和产物摘要计算安装身份指纹。变化时撤销旧 AbortController，创建新寿命，非 running 状态立即取消；只通知变化身份，避免无关插件被重挂载。
   * English: Fingerprint each installation with its activation generation, phase, sorted permissions and artifact digest. Revoke changed controllers and create new lifetimes, immediately aborting non-running instances. Notify only changed identities to avoid remounting unrelated plugins.
   * 中文：输入：view：本次收到的服务端视图
   * English: Inputs: view: newly received server view
   */
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

  /**
   * 中文：读取指定身份的稳定指纹，作为外部存储订阅的快照和插件重挂载键。
   * English: Read the identity's stable fingerprint for external-store snapshots and plugin remount keys.
   * 中文：输入：identity：插件安装或资源权限身份
   * English: Inputs: identity: plugin installation/resource authority identity
   */
  snapshot(identity: string) { return this.lifetime(identity).fingerprint; }
  /**
   * 中文：读取身份当前 running 标记，以便界面在撤权或停用后显示不可用状态。
   * English: Read the identity's running flag so the UI can show unavailability after revocation or disablement.
   * 中文：输入：identity：插件安装或资源权限身份
   * English: Inputs: identity: plugin installation/resource authority identity
   */
  available(identity: string) { return this.lifetime(identity).running; }
  /**
   * 中文：捕获当前安装寿命的 AbortSignal；代次改变时旧信号保持取消，新请求必须重新捕获。
   * English: Capture the current installation lifetime's AbortSignal; after generation changes the old signal remains aborted and new requests must capture again.
   * 中文：输入：identity：插件安装或资源权限身份
   * English: Inputs: identity: plugin installation/resource authority identity
   */
  captureIdentity(identity: string) { return this.lifetime(identity).controller.signal; }

  // 路由归属按最长匹配前缀确定，社区扩展路径则使用其安装身份，避免落入插件管理器的权限作用域。
  /**
   * 中文：先识别社区扩展安装身份，否则按方法和最长匹配 HTTP 前缀寻找官方插件，再查运行时精确贡献。管理器路由与扩展路由必须拥有各自权限寿命。
   * English: Recognize community extension identities first; otherwise use method and longest matching HTTP prefix for official plugins, then exact runtime contributions. Manager and extension routes must retain separate authority lifetimes.
   * 中文：输入：path：目标文件或请求路径；method：请求 HTTP 方法（缺省 'GET'）
   * English: Inputs: path: target file/request path; method: request HTTP method (default 'GET')
   */
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

  /**
   * 中文：根据方法和路径识别所属安装后返回其取消信号；无插件归属的控制面路由返回 undefined。
   * English: Resolve ownership from method/path and return the installation's cancellation signal; controller routes without plugin ownership return undefined.
   * 中文：输入：path：目标文件或请求路径；method：请求 HTTP 方法（缺省 'GET'）
   * English: Inputs: path: target file/request path; method: request HTTP method (default 'GET')
   */
  capture(path: string, method = 'GET') {
    const identity = this.identityFor(path, method);
    return identity ? this.captureIdentity(identity) : undefined;
  }
}
export const pluginGeneration = new PluginGeneration();
