import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';

import { NextFeatures } from '../next-features.ts';

export const services = ['next'] as const;
export async function activate(host: Features) {
  const m = host.machines;
  host.next = new NextFeatures(m, host.workspaces);
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
  if (parts[1] === 'next-features' && parts.length === 2 && req.method === 'GET') {
    send(await this.next.catalog());
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  if (parts.length === 4) {
    if (action === 'next-features') {
      if (req.method === 'GET') {
        send(await this.next.view(id));
        return true;
      }
      if (req.method === 'POST') {
        send(await this.next.action(id, await body(req), signal), 202);
        return true;
      }
    }
  }
  return false;
}
