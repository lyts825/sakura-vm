/**
 * 模块职责：根据生成的 WebSocket 通道契约构造路径和查询，统一编码参数并校验查询输入。
 */
import { socketRoutes, type SocketChannel, type SocketPath, type SocketQuery } from './contracts/websocket-client.generated.ts';

/** Build a relative upgrade URL without opening a connection or replaying any input. */
export function socketPath<C extends SocketChannel>(channel: C, path: SocketPath<NoInfer<C>>,
  query: SocketQuery<NoInfer<C>>): string {
  const route = socketRoutes[channel];
  const pathname = route.path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = (path as Record<string, string>)[key];
    if (!value) throw new Error('Missing WebSocket path parameter: ' + key);
    return encodeURIComponent(value);
  });
  // Keep encodeURIComponent and omit only undefined, matching existing browser URLs.
  const search = Object.entries(query).filter(([, value]) => value !== undefined)
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value))).join('&');
  return pathname + (search ? '?' + search : '');
}
