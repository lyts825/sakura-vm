/**
 * 模块职责（中文）：根据生成的 WebSocket 通道契约构造路径和查询，统一编码参数并校验查询输入。
 * Module responsibility (English): Encoding WebSocket URLs from generated channel contracts.
 * 详细范围（中文）：公开入口包括 socketPath；职责覆盖依据生成通道契约编码 WebSocket URL，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include socketPath. The scope covers Encoding WebSocket URLs from generated channel contracts. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { socketRoutes, type SocketChannel, type SocketPath, type SocketQuery } from './contracts/websocket-client.generated.ts';

/** Build a relative upgrade URL without opening a connection or replaying any input. */
/**
 * 中文：按生成通道描述编码必需路径参数和非 undefined 查询值，缺少路径值时抛错；返回相对路径供连接创建者选择 ws/wss。
 * English: Encode required path fields and nonundefined query values from the generated channel description. Throw for missing path fields and return a relative path so the connection creator can select ws/wss.
 * 中文：输入：channel：签名所示 C 业务值；path：目标文件或请求路径；query：签名所示 SocketQuery<NoInfer<C>> 业务值
 * English: Inputs: channel: the C domain value in the signature; path: target file/request path; query: the SocketQuery<NoInfer<C>> domain value in the signature
 * 中文：结果：string，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: string carrying the described computation/transport result; throwing branches do not provide success
 */
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
