import { resourceRequestScope, setResourceRequestScope } from './resource-cache';

export type WorkspaceRequest = <T = unknown>(
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

export function workspaceRequest(request: WorkspaceRequest, projectId?: string): WorkspaceRequest {
  if (!projectId) return request;
  const scoped: WorkspaceRequest = <T = unknown>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) =>
    request<T>(workspacePath(path, projectId), method, body, signal);
  const identity = resourceRequestScope(request);
  if (identity) setResourceRequestScope(scoped, identity);
  return scoped;
}
