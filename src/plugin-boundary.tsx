/**
 * 模块职责：隔离插件界面的渲染错误、重试和请求权限生命周期，仅重挂载所属插件的界面。
 */
import { Component, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Request } from './feature-shared';
import { pluginGeneration } from './plugin-generation';
import { setResourceRequestScope } from './resource-cache';

export class PluginErrorBoundary extends Component<{ children: ReactNode; retry: () => void; label: string; retryLabel?: string }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <section className="plugin-error content-panel" role="alert">
      <h3>{this.props.label}暂时无法显示</h3>
      <p>{this.state.error.message}</p>
      <button className="secondary compact" onClick={this.props.retry}>{this.props.retryLabel || '重试此插件'}</button>
    </section>;
  }
}

function PluginMount({ identity, request, children }: { identity: string; request: Request; children: (request: Request) => ReactNode }) {
  const lifetime = useRef(new AbortController());
  useLayoutEffect(() => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    return () => lifetime.current.abort(new Error('插件界面已关闭'));
  }, []);
  const scopedRequest = useMemo(() => {
    // 组合安装身份代次、界面挂载寿命和调用者信号；返回之后再检查一次，阻止撤权后的结果进入组件。
    const generationSignal = pluginGeneration.captureIdentity(identity);
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
export function PluginBoundary({ identity, request, label = '插件界面', children }: {
  identity: string; request: Request; label?: string; children: (request: Request, lifetime: string) => ReactNode;
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
