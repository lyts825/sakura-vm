import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as ideServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { z } from 'zod';
import { Ide } from '../../server/ide.ts';
export async function activate(host: PluginContext) {
  host.provide(ideServices.ide, new Ide(host.vm, host.workspaces));
  await host.ide.update();
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
  if (parts.length === 4) {
    if (action === 'ide') {
      if (req.method === 'GET') {
        send(await this.ide.view(id));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({ action: z.enum(['install', 'stop']).default('install') })
          .strict()
          .parse((await body(req)) || {});
        send(input.action === 'stop' ? await this.ide.stop(id) : await this.ide.install(id, signal));
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.vms.vmId.ide": route,
  "legacy.post.vms.vmId.ide": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("ide");
