/**
 * 模块职责：定义核心 HTTP 上下文并合并处理器目录，拒绝重复或无效操作处理器。
 * Module purpose: Defines core HTTP context and combines handler directories, rejecting invalid or duplicated operations.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApplicationServices } from './application-services.ts';
import type { Principal } from './access-control.ts';
import type { OperationGateway, HttpOperationHandler } from './operation-gateway.ts';
import type { OperationResults } from './operation-results.ts';
import type { DocumentResponseCache } from './document-response-cache.ts';
import type { SystemServiceContracts } from './service-contracts.ts';

/** Each domain declares the service ports it consumes; transport authority stays in the adapter. */
export type CoreHttpContext<K extends keyof ApplicationServices> = {
  services: Omit<Pick<ApplicationServices, K>, 'requireService'> &
    ('requireService' extends K ? {
      /**
       * 签名 / Signature: CoreHttpContext.requireService.
       * 功能：为定义核心 HTTP 上下文并合并处理器目录声明 requireService 的输入与结果契约，所属容器为 CoreHttpContext。
       * Purpose: Declares the input/result contract for requireService in CoreHttpContext. Module responsibility: Defines core HTTP context and combines handler directories, rejecting invalid or duplicated operations.
       * 输入 / Inputs: id: I
       * 输出 / Returns: SystemServiceContracts[I].
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      requireService<I extends Extract<K, keyof SystemServiceContracts>>(id: I): SystemServiceContracts[I];
    } : {});
  /**
   * 签名 / Signature: CoreHttpContext.body.
   * 功能：为定义核心 HTTP 上下文并合并处理器目录声明 body 的输入与结果契约，所属容器为 CoreHttpContext。
   * Purpose: Declares the input/result contract for body in CoreHttpContext. Module responsibility: Defines core HTTP context and combines handler directories, rejecting invalid or duplicated operations.
   * 输入 / Inputs: req: IncomingMessage; limit: number optional; signal: AbortSignal optional
   * 输出 / Returns: Promise<any>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  body(req: IncomingMessage, limit?: number, signal?: AbortSignal): Promise<any>;
  /**
   * 签名 / Signature: CoreHttpContext.authorizedBody.
   * 功能：为定义核心 HTTP 上下文并合并处理器目录声明 authorizedBody 的输入与结果契约，所属容器为 CoreHttpContext。
   * Purpose: Declares the input/result contract for authorizedBody in CoreHttpContext. Module responsibility: Defines core HTTP context and combines handler directories, rejecting invalid or duplicated operations.
   * 输入 / Inputs: req: IncomingMessage; limit: number optional; signal: AbortSignal optional
   * 输出 / Returns: Promise<any>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  authorizedBody(req: IncomingMessage, limit?: number, signal?: AbortSignal): Promise<any>;
  /**
   * 签名 / Signature: CoreHttpContext.authorized.
   * 功能：为定义核心 HTTP 上下文并合并处理器目录声明 authorized 的输入与结果契约，所属容器为 CoreHttpContext。
   * Purpose: Declares the input/result contract for authorized in CoreHttpContext. Module responsibility: Defines core HTTP context and combines handler directories, rejecting invalid or duplicated operations.
   * 输入 / Inputs: req: IncomingMessage
   * 输出 / Returns: Principal | { role: 'owner' }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  authorized(req: IncomingMessage): Principal | { role: 'owner' };
  /**
   * 签名 / Signature: CoreHttpContext.requirePasskeyOrigin.
   * 功能：为定义核心 HTTP 上下文并合并处理器目录声明 requirePasskeyOrigin 的输入与结果契约，所属容器为 CoreHttpContext。
   * Purpose: Declares the input/result contract for requirePasskeyOrigin in CoreHttpContext. Module responsibility: Defines core HTTP context and combines handler directories, rejecting invalid or duplicated operations.
   * 输入 / Inputs: req: IncomingMessage
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  requirePasskeyOrigin(req: IncomingMessage): void;
  /**
   * 签名 / Signature: CoreHttpContext.terminateAccountSockets.
   * 功能：为定义核心 HTTP 上下文并合并处理器目录声明 terminateAccountSockets 的输入与结果契约，所属容器为 CoreHttpContext。
   * Purpose: Declares the input/result contract for terminateAccountSockets in CoreHttpContext. Module responsibility: Defines core HTTP context and combines handler directories, rejecting invalid or duplicated operations.
   * 输入 / Inputs: accountId: string
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  terminateAccountSockets(accountId: string): void;
  /**
   * 签名 / Signature: CoreHttpContext.terminateCredentialSockets.
   * 功能：为定义核心 HTTP 上下文并合并处理器目录声明 terminateCredentialSockets 的输入与结果契约，所属容器为 CoreHttpContext。
   * Purpose: Declares the input/result contract for terminateCredentialSockets in CoreHttpContext. Module responsibility: Defines core HTTP context and combines handler directories, rejecting invalid or duplicated operations.
   * 输入 / Inputs: credential: string
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  terminateCredentialSockets(credential: string): void;
  /**
   * 签名 / Signature: CoreHttpContext.terminateTerminalGrantSockets.
   * 功能：为定义核心 HTTP 上下文并合并处理器目录声明 terminateTerminalGrantSockets 的输入与结果契约，所属容器为 CoreHttpContext。
   * Purpose: Declares the input/result contract for terminateTerminalGrantSockets in CoreHttpContext. Module responsibility: Defines core HTTP context and combines handler directories, rejecting invalid or duplicated operations.
   * 输入 / Inputs: grantId: string
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  terminateTerminalGrantSockets(grantId: string): void;
  /**
   * 签名 / Signature: CoreHttpContext.terminateSockets.
   * 功能：为定义核心 HTTP 上下文并合并处理器目录声明 terminateSockets 的输入与结果契约，所属容器为 CoreHttpContext。
   * Purpose: Declares the input/result contract for terminateSockets in CoreHttpContext. Module responsibility: Defines core HTTP context and combines handler directories, rejecting invalid or duplicated operations.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  terminateSockets(): void;
  /**
   * 签名 / Signature: CoreHttpContext.samlPost.
   * 功能：为定义核心 HTTP 上下文并合并处理器目录声明 samlPost 的输入与结果契约，所属容器为 CoreHttpContext。
   * Purpose: Declares the input/result contract for samlPost in CoreHttpContext. Module responsibility: Defines core HTTP context and combines handler directories, rejecting invalid or duplicated operations.
   * 输入 / Inputs: req: IncomingMessage
   * 输出 / Returns: Promise<any>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  samlPost(req: IncomingMessage): Promise<any>;
  /**
   * 签名 / Signature: CoreHttpContext.sendSsoPage.
   * 功能：为定义核心 HTTP 上下文并合并处理器目录声明 sendSsoPage 的输入与结果契约，所属容器为 CoreHttpContext。
   * Purpose: Declares the input/result contract for sendSsoPage in CoreHttpContext. Module responsibility: Defines core HTTP context and combines handler directories, rejecting invalid or duplicated operations.
   * 输入 / Inputs: res: ServerResponse; origin: string | null; state: string; result: unknown optional; error: string optional
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  sendSsoPage(
    res: ServerResponse,
    origin: string | null,
    state: string,
    result?: unknown,
    error?: string,
  ): void;
  operationResults: OperationResults;
  gateway: OperationGateway;
  documentResponses: DocumentResponseCache;
};

export type CoreHttpHandlers = Record<string, HttpOperationHandler>;

/** Duplicate or non-function registrations are composition errors, never last-writer-wins. */
/**
 * 入口 / Entry: combineHttpHandlers.
 * 功能：在定义核心 HTTP 上下文并合并处理器目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `handlers` 供上层消费（`http-core-context.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-core-context.ts`; this entry produces `handlers` for its caller. Module context: Defines core HTTP context and combines handler directories, rejecting invalid or duplicated operations.
 * 输入 / Inputs: groups: CoreHttpHandlers[]
 * 输出 / Returns: CoreHttpHandlers；结果来自 / values from `handlers`.
 * 副作用 / Effects: 更新 / updates `handlers[id]`.
 * 拒绝 / Refusals: 条件 / conditions `Object.hasOwn(handlers, id) || typeof handler !== 'function'`; 异常 / errors `new Error('重复或无效的 HTTP 处理器：' + id)`.
 */
export function combineHttpHandlers(...groups: CoreHttpHandlers[]): CoreHttpHandlers {
  const handlers: CoreHttpHandlers = {};
  for (const group of groups)
    for (const [id, handler] of Object.entries(group)) {
      if (Object.hasOwn(handlers, id) || typeof handler !== 'function')
        throw new Error('重复或无效的 HTTP 处理器：' + id);
      handlers[id] = handler;
    }
  return handlers;
}
