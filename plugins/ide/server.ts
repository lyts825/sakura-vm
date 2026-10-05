import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as ideServices } from './services.ts';
import { services as projectsServices } from '../projects/services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { Ide } from '../../server/ide.ts';
export async function activate(host: PluginContext) {
  const ide = host.provide(ideServices.ide, new Ide(host.vm, host.use(projectsServices.workspaces)));
  await ide.update();
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
    if (action === 'ide') {
      const ide = this.use(ideServices.ide);
      if (req.method === 'GET') {
        send(await ide.view(id));
        return true;
      }
      if (req.method === 'POST') {
        const input = httpRouteRequests["ide.legacy.post.vms.vmId.ide"]
          .parse((await body(req, signal)) || {});
        send(input.action === 'stop' ? await ide.stop(id) : await ide.install(id, signal));
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, PluginRoute> = {
  "legacy.get.vms.vmId.ide": route,
  "legacy.post.vms.vmId.ide": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("ide");
