import { services as filesServices } from '../files/services.ts';
import { services as snapshotsServices } from '../snapshots/services.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as transfersServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { Downloads, downloadSchema } from '../../server/downloads.ts';
import { retryTarget } from '../../server/plugins/retry.ts';

export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(transfersServices.downloads, new Downloads(m, {
    get files() {
      return host.optional(filesServices.files);
    },
    get bundles() {
      return host.optional(snapshotsServices.bundles);
    },
  }));
  host.registerJobs(host.use(transfersServices.downloads).jobs, async (job) => {
    host.require('snapshots');
    return host.use(transfersServices.downloads).issue(retryTarget(job), { type: 'export' });
  });
}
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: (req: IncomingMessage, signal?: AbortSignal) => Promise<any>,
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  const send = (data: unknown, status = 200) => sendJson(res, data, status);
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'download' && req.method === 'POST') {
      const input = downloadSchema.parse(await body(req, signal));
      this.require(input.type === 'export' ? 'snapshots' : 'files');
      send(await this.use(transfersServices.downloads).issue(id, input), 201);
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.post.vms.vmId.download": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("transfers");
