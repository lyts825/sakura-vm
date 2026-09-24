import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';

import { Containers } from '../containers.ts';

export const services = ['containers'] as const;
export async function activate(host: Features) {
  const m = host.machines;
  host.containers = new Containers(m, host.workspaces);
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
    if (action === 'containers') {
      if (req.method === 'GET') {
        send(
          url.searchParams.has('logs')
            ? await this.containers.logs(id, url.searchParams.get('logs')!, signal)
            : await this.containers.view(id, signal),
        );
        return true;
      }
      if (req.method === 'POST') {
        send(await this.containers.run(id, await body(req)), 202);
        return true;
      }
    }
  }
  return false;
}
