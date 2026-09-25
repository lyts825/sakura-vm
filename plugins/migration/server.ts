export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { z } from 'zod';
import { AppError } from '../../server/model.ts';

import { DataMigration } from '../../server/data-migration.ts';

export async function activate(host: PluginContext) {
  const m = host.machines;
  host.migration = new DataMigration(m, () =>
    host.jobStores().filter((store) => store !== host.migration?.jobs),
  );
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
  if (parts[1] === 'migration' && parts.length === 2) {
    if (req.method === 'GET') {
      send(await this.migration.view());
      return true;
    }
    if (req.method === 'POST') {
      const input = z
        .object({
          action: z.enum(['preview', 'start', 'cancel-activation']),
          target: z.string().max(4096).optional(),
          token: z.string().optional(),
        })
        .strict()
        .parse(await body(req));
      if (input.action === 'cancel-activation') send(await this.migration.cancelActivation());
      else if (input.action === 'preview') {
        const { files: _files, ...plan } = await this.migration.plan(input.target || '');
        send(plan);
      } else {
        if (this.mutations || this.importing) throw new AppError('请等待正在执行的请求完成', 409);
        send(await this.migration.start(input.target || '', input.token || ''), 202);
      }
      return true;
    }
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  return false;
}
