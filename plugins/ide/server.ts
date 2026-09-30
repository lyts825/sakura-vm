export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { z } from 'zod';
import { Ide } from '../../server/ide.ts';
export async function activate(host: PluginContext) {
  host.ide = new Ide(host.machines, host.workspaces);
  await host.ide.update();
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
    if (action === 'ide') {
      if (req.method === 'GET') {
        send(await this.ide.view(id));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({ action: z.enum(['install', 'stop']).default('install') })
          .strict()
          .parse((await body(req)) || {});
        send(input.action === 'stop' ? await this.ide.stop(id) : await this.ide.install(id, signal));
        return true;
      }
    }
  }
  return false;
}
