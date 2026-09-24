import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';

import { z } from 'zod';

export const services = [] as const;
export async function activate(host: Features) {}
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
  if (parts[1] === 'vms' && parts[2] === 'batch' && parts.length === 3 && req.method === 'POST') {
    const { ids, action } = z
      .object({ ids: z.array(z.string().uuid()).min(1).max(32), action: z.enum(['start', 'stop']) })
      .strict()
      .parse(await body(req));
    const results = [];
    for (const id of new Set(ids)) {
      signal.throwIfAborted();
      try {
        await this.machines[action](id);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error: (error as Error).message });
      }
    }
    send({ results });
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  if (parts.length === 4) {
    if (action === 'organization' && req.method === 'PUT') {
      send(await this.machines.organize(id, await body(req)));
      return true;
    }
  }
  return false;
}
