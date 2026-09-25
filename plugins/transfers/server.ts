export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { Downloads } from '../../server/downloads.ts';
import { retryTarget } from '../../server/plugins/retry.ts';

export async function activate(host: PluginContext) {
  const m = host.machines;
  host.downloads = new Downloads(m, {
    get files() {
      return host.files;
    },
    get bundles() {
      return host.bundles;
    },
  });
  host.registerJobs(host.downloads.jobs, async (job) => {
    host.require('snapshots');
    return host.downloads.issue(retryTarget(job), { type: 'export' });
  });
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
  const send = (data: unknown, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data));
    return true;
  };
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  if (parts.length === 4) {
    if (action === 'download' && req.method === 'POST') {
      const input = await body(req);
      this.require(input?.type === 'export' ? 'snapshots' : 'files');
      send(await this.downloads.issue(id, input), 201);
      return true;
    }
  }
  return false;
}
