export type WorkspaceRequest = <T = any>(
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
  const params = new URLSearchParams(query);
  params.set('project', projectId);
  const serialized = params.toString();
  return serialized ? `${pathname}?${serialized}` : pathname;
}

export function workspaceRequest(request: WorkspaceRequest, projectId?: string): WorkspaceRequest {
  if (!projectId) return request;
  return <T = any>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) =>
    request<T>(workspacePath(path, projectId), method, body, signal);
}
