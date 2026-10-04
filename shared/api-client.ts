import { apiPath } from './api-document.ts';
import { operationRoutes, type OperationId, type OperationRequest, type OperationResponse, type OperationPath } from './contracts/api-client.generated.ts';

export type OperationOptions<Id extends OperationId> = {
  query?: Record<string, string>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
} & (keyof OperationPath<Id> extends never ? { path?: OperationPath<Id> } : { path: OperationPath<Id> })
  & (undefined extends OperationRequest<Id> ? { body?: OperationRequest<Id> } : { body: OperationRequest<Id> });
export type OperationTransport = (path: string, options: {
  method: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string>;
  transport: 'json' | 'binary' | 'form' | 'websocket';
}) => Promise<unknown>;

/** Adapts an authenticated transport without replaying or changing its cancellation behavior. */
export function createOperationClient(request: OperationTransport) {
  return async <Id extends OperationId>(id: Id, ...arguments_: {} extends OperationOptions<Id>
    ? [options?: OperationOptions<Id>] : [options: OperationOptions<Id>]): Promise<OperationResponse<Id>> => {
    const route = operationRoutes[id];
    const options = arguments_[0];
    const path = apiPath(route.path, (options?.path || {}) as Record<string, string>, options?.query);
    // The schema-generated assertion belongs at the adapter; application callers never default to any.
    return await request(path, { method: route.method, body: options?.body, signal: options?.signal,
      headers: options?.headers, transport: route.transport }) as OperationResponse<Id>;
  };
}
