export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { Images } from '../../server/images.ts';

export async function activate(host: PluginContext) {
  host.images = new Images();
  host.registerJobs(host.images.jobs, (job) => host.images.prepare(job.key!));
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
  if (parts[1] === 'images') {
    if (parts.length === 2 && req.method === 'GET') {
      send(this.images.list());
      return true;
    }
    if (parts.length === 3 && req.method === 'POST') {
      send(this.images.prepare(parts[2]), 202);
      return true;
    }
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  return false;
}
