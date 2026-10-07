/**
 * 模块职责（中文）：按 operation ID 构造有类型的 API 客户端，统一路径参数、查询、请求体和响应模式，响应读取与解码由传入的 transport 执行。
 * Module responsibility (English): Building typed requests from operation IDs and delegating transport decoding.
 * 详细范围（中文）：公开入口包括 OperationOptions, OperationTransport, createOperationClient；职责覆盖根据 operation ID 构造强类型请求并委托传输解码，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include OperationOptions, OperationTransport, createOperationClient. The scope covers Building typed requests from operation IDs and delegating transport decoding. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { apiPath } from './api-document.ts';
import {
  operationRoutes,
  type OperationContractMap,
  type OperationId,
  type OperationRequest,
  type OperationResponse,
  type OperationPath,
  type OperationQuery,
  type OperationHeaders,
} from './contracts/api-client.generated.ts';
import { resolveOperationBody } from './http-transport.ts';

type OperationInput<Id extends OperationId> = OperationContractMap[Id] extends { input: infer Input }
  ? Input
  : ({} extends OperationQuery<Id> ? { query?: OperationQuery<Id> } : { query: OperationQuery<Id> }) &
    (undefined extends OperationRequest<Id> ? { body?: OperationRequest<Id> } : { body: OperationRequest<Id> });

export type OperationOptions<Id extends OperationId> = {
  signal?: AbortSignal;
  query?: OperationQuery<Id>;
  body?: OperationRequest<Id>;
} & OperationInput<Id> &
  ({} extends OperationHeaders<Id> ? { headers?: OperationHeaders<Id> } : { headers: OperationHeaders<Id> }) &
  (keyof OperationPath<Id> extends never ? { path?: OperationPath<Id> } : { path: OperationPath<Id> });
export type OperationTransport = /** 中文：声明按路径/操作和请求选项传输数据的能力，返回类型由调用契约决定；取消和错误由实现能力传回 | English: Declare a transport capability accepting paths/operations and request options; the call contract determines result type, with cancellation/errors propagated by the implementation | 中文：输入：path：目标文件或请求路径；options：本次连接、传输或显示配置 | English: Inputs: path: target file/request path; options: connection/transport/presentation configuration | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ (
  path: string,
  options: {
    method: string;
    body?: unknown;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    transport: 'json' | 'binary' | 'form' | 'websocket';
    bodyKind: 'none' | 'json' | 'binary' | 'form';
    response: 'json' | 'text' | 'binary' | 'event-stream' | 'empty';
    authenticated: boolean;
    allowLocked: boolean;
  },
) => Promise<unknown>;

/** Adapts an authenticated transport without replaying or changing its cancellation behavior. */
/**
 * 中文：提交 route.method path，完成根据 operation ID 构造强类型请求并委托传输解码的数据交互；异步失败传给此处的捕获分支或外层动作反馈
 * English: Perform route.method path for Building typed requests from operation IDs and delegating transport decoding. Propagate asynchronous failure to this catch path or the outer action feedback
 * 中文：输入：request：带身份和权限作用域的传输能力
 * English: Inputs: request: transport capability bound to identity/authority scope
 * 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用
 * English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary
 */
export function createOperationClient(request: OperationTransport) {
  /**
   * 中文：提交 route.method path，完成根据 operation ID 构造强类型请求并委托传输解码的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform route.method path for Building typed requests from operation IDs and delegating transport decoding. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：id：目标资源标识；arguments_：签名所示 {} extends OperationOptions<Id> ? [options?: OperationOptions<Id>] : [options: OperationOptions<Id>] 业务值
   * English: Inputs: id: target resource identifier; arguments_: the {} extends OperationOptions<Id> ? [options?: OperationOptions<Id>] : [options: OperationOptions<Id>] domain value in the signature
   * 中文：结果：Promise<OperationResponse<Id>>，包含上述计算或传输完成值；抛错分支不提供成功结果
   * English: Result: Promise<OperationResponse<Id>> carrying the described computation/transport result; throwing branches do not provide success
   * 中文：拒绝原因：此操作需要请求体；此操作不接受请求体。这些错误交给直接调用者或本函数 catch 处理
   * English: Refusal reasons: 此操作需要请求体; 此操作不接受请求体. These errors reach the direct caller or this function's catch handler
   */
  return async <Id extends OperationId>(
    id: Id,
    ...arguments_: {} extends OperationOptions<Id>
      ? [options?: OperationOptions<Id>]
      : [options: OperationOptions<Id>]
  ): Promise<OperationResponse<Id>> => {
    const route = operationRoutes[id];
    const options = arguments_[0];
    const body = resolveOperationBody({ kind: route.body, required: route.bodyRequired,
      ...('bodylessQuery' in route ? { bodylessQuery: route.bodylessQuery } : {}) },
      options?.query as Record<string, unknown>);
    if (body.required && options?.body === undefined) throw new Error('此操作需要请求体');
    if (body.kind === 'none' && options?.body !== undefined) throw new Error('此操作不接受请求体');
    const path = apiPath(
      route.path,
      (options?.path || {}) as Record<string, string>,
      options?.query as Record<string, string>,
    );
    // The schema-generated assertion belongs at the adapter; application callers never default to any.
    return (await request(path, {
      method: route.method,
      body: options?.body,
      signal: options?.signal,
      headers: options?.headers as Record<string, string>,
      transport: route.transport,
      bodyKind: body.kind,
      response: route.response,
      authenticated: route.access === 'controller',
      allowLocked: route.session === 'allow-locked',
    })) as OperationResponse<Id>;
  };
}
