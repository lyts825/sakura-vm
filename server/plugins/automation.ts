import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';

import { FeatureSuite } from '../feature-suite.ts';

export const services = ['suite'] as const;
export async function activate(host: Features) {
  const m = host.machines;
  host.suite = new FeatureSuite(m, host.workspaces);
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
  if (parts[1] === 'feature-suite' && parts.length === 2 && req.method === 'GET') {
    send(await this.suite.catalog());
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  if (parts.length === 4 && req.method === 'POST' && action === 'suspend')
    return send(await this.machines.suspend(id));
  if (parts.length === 4 && req.method === 'POST' && action === 'resume')
    return send(await this.machines.resume(id));
  if (parts.length === 4) {
    if (action === 'advanced') {
      if (req.method === 'GET') {
        send(await this.suite.view(id, Number(url.searchParams.get('limit') || 120)));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.suite.update(id, await body(req)));
        return true;
      }
      if (req.method === 'POST') {
        send(await this.suite.action(id, await body(req), signal), 202);
        return true;
      }
    }
  }
  return false;
}
