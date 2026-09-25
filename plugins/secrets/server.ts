export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { z } from 'zod';

import { Secrets } from '../../server/secrets.ts';

export async function activate(host: PluginContext) {
  const m = host.machines;
  host.secrets = new Secrets(m);
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
    if (action === 'secrets') {
      if (req.method === 'GET') {
        send({ items: await this.secrets.list(id) });
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.secrets.save(id, await body(req)));
        return true;
      }
      if (req.method === 'DELETE') {
        const input = z
          .object({ name: z.string() })
          .strict()
          .parse(await body(req));
        send(await this.secrets.remove(id, input.name));
        return true;
      }
    }
  }
  return false;
}
