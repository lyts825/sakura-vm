import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';

import { z } from 'zod';

import { FolderSync } from '../sync.ts';

export const services = ['sync'] as const;
export async function activate(host: Features) {
  const m = host.machines;
  host.sync = new FolderSync(m, host.workspaces.projects);
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
    if (action === 'sync-preview' && req.method === 'POST') {
      send(await this.sync.preview(id, signal));
      return true;
    }
  }
  if (parts.length === 4) {
    if (action === 'sync') {
      if (req.method === 'GET') {
        send(await this.sync.view(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.sync.save(id, await body(req)));
        return true;
      }
      if (req.method === 'POST') {
        const { direction, token, decisions } = z
          .object({
            direction: z.enum(['both', 'push', 'pull']),
            token: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            decisions: z
              .record(
                z.string().max(4096),
                z.enum([
                  'push',
                  'pull',
                  'both',
                  'skip',
                  'delete-host',
                  'delete-guest',
                  'restore-host',
                  'restore-guest',
                ]),
              )
              .optional(),
          })
          .strict()
          .parse(await body(req));
        send(await this.sync.run(id, direction, token, decisions), 202);
        return true;
      }
    }
  }
  return false;
}
