/**
 * 模块职责（中文）：隔离插件界面的渲染错误、重试和请求权限生命周期，仅重挂载所属插件的界面。
 * Module responsibility (English): Isolating plugin render errors, retries and authority lifetimes.
 * 详细范围（中文）：公开入口包括 PluginErrorBoundary, PluginBoundary；职责覆盖隔离插件渲染错误、重试与权限生命周期，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include PluginErrorBoundary, PluginBoundary. The scope covers Isolating plugin render errors, retries and authority lifetimes. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { Component, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Request } from './feature-shared';
import { pluginGeneration } from './plugin-generation';
import { setResourceRequestScope } from './resource-cache';

export class PluginErrorBoundary extends Component<{ children: ReactNode; retry: /** 中文：重新建立该插件的渲染和权限寿命以重试失败界面；这是 PluginErrorBoundary 的调用契约 | English: Reestablish this plugin's rendering/authority lifetime to retry its failed surface; this is the callable contract of PluginErrorBoundary | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void; label: string; retryLabel?: string }, { error?: Error }> {
  state: { error?: Error } = {};
  /**
   * 中文：为隔离插件渲染错误、重试与权限生命周期构造包含 error 的局部数据对象，字段取自本次输入和明确默认值，供后续表单或状态流程使用
   * English: Build a local data object containing error for Isolating plugin render errors, retries and authority lifetimes, using current inputs/explicit defaults for subsequent form/state processing
   * 中文：输入：error：签名所示 unknown 业务值
   * English: Inputs: error: the unknown domain value in the signature
   * 中文：结果：包含 error 的对象，字段供调用者读取状态或调用操作
   * English: Result: an object containing error for caller state reads/operations
   */
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  /**
   * 中文：无渲染错误时透传 children，有错误时展示插件名称、错误和独立重试入口，避免插件异常覆盖整个应用。
   * English: Pass children through without rendering errors; otherwise show plugin name/error/an independent retry entry so plugin failure cannot replace the whole app.
   * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
   * English: Result: React nodes for current state; branches without display conditions may return an empty node
   */
  render() {
    if (!this.state.error) return this.props.children;
    return <section className="plugin-error content-panel" role="alert">
      <h3>{this.props.label}暂时无法显示</h3>
      <p>{this.state.error.message}</p>
      <button className="secondary compact" onClick={this.props.retry}>{this.props.retryLabel || '重试此插件'}</button>
    </section>;
  }
}

/**
 * 中文：为挂载界面创建可撤销寿命，并把请求绑定到安装身份与调用者信号；调用前后均复核取消，防止撤权后迟到结果写入界面，卸载时取消界面请求。
 * English: Create a revocable mount lifetime and bind requests to installation identity and caller signals. Check cancellation before and after transport so late replies cannot enter the UI after revocation, and cancel mount-owned requests on unmount.
 * 中文：输入：{ identity, request, children } 提供 identity（插件安装或资源权限身份）、request（带身份和权限作用域的传输能力）、children（children 状态） 上下文字段
 * English: Inputs: { identity, request, children } provides context fields identity (plugin installation/resource authority identity), request (transport capability bound to identity/authority scope), children (children state)
 */
function PluginMount({ identity, request, children }: { identity: string; request: Request; children: /** 中文：使用当前挂载作用域的 request 渲染插件子树，调用者不能沿用已撤销能力；这是 PluginMount 的调用契约 | English: Render the plugin subtree with mount-scoped request authority, without retaining revoked capability; this is the callable contract of PluginMount | 中文：输入：request：带身份和权限作用域的传输能力 | English: Inputs: request: transport capability bound to identity/authority scope | 中文：结果：ReactNode；调用者依赖此类型约定 | English: Result: ReactNode; callers depend on this type contract */ (request: Request) => ReactNode }) {
  const lifetime = useRef(new AbortController());
  useLayoutEffect(/** 中文：当依赖 [] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    /**
     * 中文：在隔离插件渲染错误、重试与权限生命周期流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Isolating plugin render errors, retries and authority lifetimes, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     */
    return () => lifetime.current.abort(new Error('插件界面已关闭'));
  }, []);
  const scopedRequest = useMemo(/**
   * 中文功能：为本安装身份和组件寿命建立 memo 化请求能力，组合调用者取消信号并登记资源作用域。
   * English: Create a memoized request capability for this installation identity/component lifetime, combine caller cancellation and register resource scope.
   * 输入 / Inputs: 无 / none.
   * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
   * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
   * 设计思路：提交前后均复核组合信号，阻止等待期间撤权的结果进入组件；WeakMap 作用域元数据使缓存仅在对应安装身份内共享与失效。
   * Design: Recheck combined signals before/after requests so revocation during a wait cannot publish into the component; WeakMap scope metadata keeps cache sharing/invalidation within the installation identity.
   */
  () => {
    // 组合安装身份代次、界面挂载寿命和调用者信号；返回之后再检查一次，阻止撤权后的结果进入组件。
    const generationSignal = pluginGeneration.captureIdentity(identity);
    /**
     * 中文：提交 method path，完成隔离插件渲染错误、重试与权限生命周期的数据交互；异步失败传给此处的捕获分支或外层动作反馈
     * English: Perform method path for Isolating plugin render errors, retries and authority lifetimes. Propagate asynchronous failure to this catch path or the outer action feedback
     * 中文：输入：path：目标文件或请求路径；method：请求 HTTP 方法（缺省 'GET'）；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
     * English: Inputs: path: target file/request path; method: request HTTP method (default 'GET'); body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
     * 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作
     * English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step
     */
    const scoped: Request = async <T = unknown,>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) => {
      const combined = AbortSignal.any([generationSignal, lifetime.current.signal, ...(signal ? [signal] : [])]);
      combined.throwIfAborted();
      const result = await request<T>(path, method, body, combined);
      combined.throwIfAborted();
      return result;
    };
    setResourceRequestScope(scoped, identity);
    return scoped;
  }, [identity, request]);
  return children(scopedRequest);
}

/** A retry and an authority transition remount only the owning surface. */
/**
 * 中文：订阅安装身份指纹，以身份、代次和重试次数构造 React key。只重挂载所属插件；不可用阶段显示状态，渲染错误由独立边界接住，重试重新建立 lazy/挂载寿命。
 * English: Subscribe to the installation fingerprint and build a React key from identity, generation and retry count. Remount only the owning plugin. Show status while unavailable, contain render failures in its own boundary, and recreate lazy/mount lifetimes on retry.
 * 中文：输入：{ identity, request, label = '插件界面', children } 提供 identity（插件安装或资源权限身份）、request（带身份和权限作用域的传输能力）、label（label 状态）、children（children 状态） 上下文字段
 * English: Inputs: { identity, request, label = '插件界面', children } provides context fields identity (plugin installation/resource authority identity), request (transport capability bound to identity/authority scope), label (label state), children (children state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function PluginBoundary({ identity, request, label = '插件界面', children }: {
  identity: string; request: Request; label?: string; children: /** 中文：使用当前挂载作用域的 request 渲染插件子树，调用者不能沿用已撤销能力；这是 PluginBoundary 的调用契约 | English: Render the plugin subtree with mount-scoped request authority, without retaining revoked capability; this is the callable contract of PluginBoundary | 中文：输入：request：带身份和权限作用域的传输能力；lifetime：签名所示 string 业务值 | English: Inputs: request: transport capability bound to identity/authority scope; lifetime: the string domain value in the signature | 中文：结果：ReactNode；调用者依赖此类型约定 | English: Result: ReactNode; callers depend on this type contract */ (request: Request, lifetime: string) => ReactNode;
}) {
  const revision = useSyncExternalStore(pluginGeneration.subscribe,
    () => pluginGeneration.snapshot(identity), () => '');
  const [attempt, retry] = useState(0);
  // 重试次数也进入 React key 和懒加载寿命，确保被缓存的加载失败能够通过新的组件实例重试。
  const lifetime = `${identity}:${revision}:${attempt}`;
  if (!pluginGeneration.available(identity)) return <p role="status">{label}当前不可用，请等待插件恢复。</p>;
  return <PluginErrorBoundary key={lifetime} label={label} retry={() => retry(value => value + 1)}>
    <PluginMount identity={identity} request={request}>
      {scoped => children(scoped, lifetime)}
    </PluginMount>
  </PluginErrorBoundary>;
}
