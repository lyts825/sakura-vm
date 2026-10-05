import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as secretsServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';


import { Secrets } from '../../server/secrets.ts';

export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(secretsServices.secrets, new Secrets(m));
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
  if (parts.length === 4 && action === 'secret-rotation') {
    if (req.method === 'GET') return send({ items: await this.use(secretsServices.secrets).rotation(id) });
    if (req.method === 'PATCH') return send({ items: await this.use(secretsServices.secrets).setRotation(id, await body(req, signal)) });
  }
  if (parts.length === 4) {
    if (action === 'secrets') {
      if (req.method === 'GET') {
        send({ items: await this.use(secretsServices.secrets).list(id) });
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.use(secretsServices.secrets).save(id, await body(req, signal)));
        return true;
      }
      if (req.method === 'DELETE') {
        const input = httpRouteRequests["secrets.legacy.delete.vms.vmId.secrets"]
          .parse(await body(req, signal));
        send(await this.use(secretsServices.secrets).remove(id, input.name));
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.vms.vmId.secrets": route,
  "legacy.put.vms.vmId.secrets": route,
  "legacy.delete.vms.vmId.secrets": route,
  "legacy.get.vms.vmId.secret-rotation": route,
  "legacy.patch.vms.vmId.secret-rotation": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("secrets");
