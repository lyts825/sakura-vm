import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as secretsServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { z } from 'zod';

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
  body: (req: IncomingMessage) => Promise<any>,
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  const send = (data: unknown, status = 200) => sendJson(res, data, status);
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4 && action === 'secret-rotation') {
    if (req.method === 'GET') return send({ items: await this.secrets.rotation(id) });
    if (req.method === 'PATCH') return send({ items: await this.secrets.setRotation(id, await body(req)) });
  }
  if (parts.length === 4) {
    if (action === 'secrets') {
      if (req.method === 'GET') {
        send({ items: await this.secrets.list(id) });
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.secrets.save(id, await body(req)));
        return true;
      }
      if (req.method === 'DELETE') {
        const input = z
          .object({ name: z.string() })
          .strict()
          .parse(await body(req));
        send(await this.secrets.remove(id, input.name));
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
