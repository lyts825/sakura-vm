import { apiPath } from './api-document.ts';
import {
  operationRoutes,
  type OperationId,
  type OperationRequest,
  type OperationResponse,
  type OperationPath,
  type OperationQuery,
  type OperationHeaders,
} from './contracts/api-client.generated.ts';

export type OperationOptions<Id extends OperationId> = {
  signal?: AbortSignal;
} & ({} extends OperationQuery<Id> ? { query?: OperationQuery<Id> } : { query: OperationQuery<Id> }) &
  ({} extends OperationHeaders<Id> ? { headers?: OperationHeaders<Id> } : { headers: OperationHeaders<Id> }) &
  (keyof OperationPath<Id> extends never ? { path?: OperationPath<Id> } : { path: OperationPath<Id> }) &
  (undefined extends OperationRequest<Id> ? { body?: OperationRequest<Id> } : { body: OperationRequest<Id> });
export type OperationTransport = (
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
export function createOperationClient(request: OperationTransport) {
  return async <Id extends OperationId>(
    id: Id,
    ...arguments_: {} extends OperationOptions<Id>
      ? [options?: OperationOptions<Id>]
      : [options: OperationOptions<Id>]
  ): Promise<OperationResponse<Id>> => {
    const route = operationRoutes[id];
    const options = arguments_[0];
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
      bodyKind: route.body,
      response: route.response,
      authenticated: route.access === 'controller',
      allowLocked: route.session === 'allow-locked',
    })) as OperationResponse<Id>;
  };
}
