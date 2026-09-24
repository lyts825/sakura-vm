import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';

import { z } from 'zod';
import { AppError } from '../model.ts';

import { Backups } from '../backups.ts';

export const services = ['backups'] as const;
export async function activate(host: Features) {
  const m = host.machines;
  host.backups = new Backups(m, host.bundles, host.secrets);
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
    if (action === 'backup-download' && req.method === 'POST') {
      const input = z
        .object({ backupId: z.uuid() })
        .strict()
        .parse(await body(req));
      send(await this.downloads.issueLocal(id, await this.backups.downloadable(id, input.backupId)));
      return true;
    }
  }
  if (parts.length === 4) {
    if (action === 'backups') {
      if (req.method === 'GET') {
        send(await this.backups.view(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.backups.policy(id, await body(req)));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({
            action: z.enum(['run', 'verify', 'restore', 'delete']),
            backupId: z.string().uuid().optional(),
            name: z.string().optional(),
            password: z.string().max(1024).optional(),
          })
          .strict()
          .parse(await body(req));
        if (input.action === 'run') send(await this.backups.run(id, input.password), 202);
        else {
          if (!input.backupId) throw new AppError('请选择备份');
          send(await this.backups.operate(id, input.backupId, input.action, input.name, input.password));
        }
        return true;
      }
    }
  }
  return false;
}
