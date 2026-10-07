/**
 * 模块职责：定义核心 HTTP 上下文并合并处理器目录，拒绝重复或无效操作处理器。
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
      requireService<I extends Extract<K, keyof SystemServiceContracts>>(id: I): SystemServiceContracts[I];
    } : {});
  body(req: IncomingMessage, limit?: number, signal?: AbortSignal): Promise<any>;
  authorizedBody(req: IncomingMessage, limit?: number, signal?: AbortSignal): Promise<any>;
  authorized(req: IncomingMessage): Principal | { role: 'owner' };
  requirePasskeyOrigin(req: IncomingMessage): void;
  terminateAccountSockets(accountId: string): void;
  terminateCredentialSockets(credential: string): void;
  terminateTerminalGrantSockets(grantId: string): void;
  terminateSockets(): void;
  samlPost(req: IncomingMessage): Promise<any>;
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
