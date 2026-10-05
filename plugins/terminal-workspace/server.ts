import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as terminalWorkspaceServices } from './services.ts';
import { services as projectsServices } from '../projects/services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';

import { ProjectCatalog } from '../../server/project-catalog.ts';

export async function activate(host: PluginContext) {
  host.provide(terminalWorkspaceServices.terminals, host.capabilities.sessions.terminals());
}
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: Parameters<PluginRoute>[3],
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  const send = (data: unknown, status = 200) => sendJson(res, data, status);
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'terminal-session' && req.method === 'POST') {
      const input = httpRouteRequests["terminal-workspace.legacy.post.vms.vmId.terminal-session"]
        .parse(await body(req, signal));
      const projects = this.optional(projectsServices.workspaces)?.projects || new ProjectCatalog(this.vm);
      const projectId = await projects.with(id, url.searchParams.get('project'),
        async () => projects.current(id));
      await this.use(terminalWorkspaceServices.terminals).stop(id, projectId,
        'session' in input ? input.session : undefined, signal);
      send({ ok: true, projectId });
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, PluginRoute> = {
  "legacy.post.vms.vmId.terminal-session": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("terminal-workspace");
