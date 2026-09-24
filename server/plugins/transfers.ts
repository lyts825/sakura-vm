import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';

import { Files } from '../files.ts';
import { Bundles } from '../bundles.ts';
import { Downloads } from '../downloads.ts';

export const services = ['files', 'bundles', 'downloads'] as const;
export async function activate(host: Features) {
  const m = host.machines;
  host.files = new Files(m);
  host.bundles = new Bundles(m);
  host.downloads = new Downloads(m, host.files, host.bundles);
}
export async function route(
  this: Features,
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
