/**
 * 模块职责（中文）：把当前项目显式绑定到适用的工作区 URL，并保留请求能力的缓存作用域身份。
 * Module responsibility (English): Explicitly binding project URLs while retaining request-capability scope.
 * 详细范围（中文）：公开入口包括 WorkspaceRequest, workspacePath, workspaceRequest；职责覆盖显式绑定项目 URL 并保留请求能力作用域，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include WorkspaceRequest, workspacePath, workspaceRequest. The scope covers Explicitly binding project URLs while retaining request-capability scope. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { resourceRequestScope, setResourceRequestScope } from './resource-cache';

export type WorkspaceRequest = /** 中文：声明按路径/操作和请求选项传输数据的能力，返回类型由调用契约决定；取消和错误由实现能力传回 | English: Declare a transport capability accepting paths/operations and request options; the call contract determines result type, with cancellation/errors propagated by the implementation | 中文：输入：path：目标文件或请求路径；method：请求 HTTP 方法；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命 | English: Inputs: path: target file/request path; method: request HTTP method; body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation | 中文：结果：Promise<T>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<T>; callers depend on this type contract, with promise rejection representing asynchronous failure */ <T = unknown>(
  path: string,
  method?: string,
  body?: unknown,
  signal?: AbortSignal,
) => Promise<T>;

/**
 * Keep project selection in the URL so every scoped VM request uses the same
 * development workspace, even when the server's persisted active project
 * changes between requests.
 */
/**
 * 中文：对带实例的 API 地址显式附加项目查询作用域，保留已有查询参数；无项目或非实例路由沿用原地址。
 * English: Explicitly attach project query scope to VM API addresses while preserving existing query fields; retain the original address for no project or non-VM routes.
 * 中文：输入：path：目标文件或请求路径；projectId：当前项目标识
 * English: Inputs: path: target file/request path; projectId: current project identifier
 */
export function workspacePath(path: string, projectId?: string) {
  if (!projectId) return path;
  const [pathname, query = ''] = path.split('?', 2);
  // Host jobs, catalogs and shared configuration keep their own request contracts.
  if (!/^\/(?:api\/)?vms\//.test(pathname) &&
    !['/access/terminal-shares', '/api/access/terminal-shares'].includes(pathname)) return path;
  const params = new URLSearchParams(query);
  params.set('project', projectId);
  const serialized = params.toString();
  return serialized ? `${pathname}?${serialized}` : pathname;
}

/**
 * 中文：创建绑定实例/项目的请求包装器，并转交原请求能力的资源作用域元数据，确保缓存仍按权限能力隔离。
 * English: Create a VM/project-bound request wrapper and forward the original capability's resource-scope metadata so caches remain authority-isolated.
 * 中文：输入：request：带身份和权限作用域的传输能力；projectId：当前项目标识
 * English: Inputs: request: transport capability bound to identity/authority scope; projectId: current project identifier
 * 中文：结果：WorkspaceRequest，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: WorkspaceRequest carrying the described computation/transport result; throwing branches do not provide success
 */
export function workspaceRequest(request: WorkspaceRequest, projectId?: string): WorkspaceRequest {
  if (!projectId) return request;
  /**
   * 中文：先计算当前项目作用域 URL 再委托原传输，保留原有选项、信号和返回类型。
   * English: Compute the current project-scoped URL before delegating to the original transport, retaining options/signals/return type.
   * 中文：输入：path：目标文件或请求路径；method：请求 HTTP 方法（缺省 'GET'）；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
   * English: Inputs: path: target file/request path; method: request HTTP method (default 'GET'); body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
   */
  const scoped: WorkspaceRequest = <T = unknown>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) =>
    request<T>(workspacePath(path, projectId), method, body, signal);
  const identity = resourceRequestScope(request);
  if (identity) setResourceRequestScope(scoped, identity);
  return scoped;
}
