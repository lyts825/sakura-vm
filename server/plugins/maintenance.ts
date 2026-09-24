import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';

import { z } from 'zod';
import { AppError } from '../model.ts';

import { Maintenance } from '../maintenance.ts';

export const services = ['maintenance'] as const;
export async function activate(host: Features) {
  const m = host.machines;
  host.maintenance = new Maintenance(m);
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
  if (parts[1] === 'storage' && parts.length === 2 && req.method === 'GET') {
    send(await this.maintenance.storage());
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  if (parts.length === 4) {
    if (action === 'diagnostics') {
      if (req.method === 'GET') {
        send({ report: this.maintenance.report(id), job: this.maintenance.jobs.view(id) });
        return true;
      }
      if (req.method === 'POST') {
        send(this.maintenance.diagnose(id), 202);
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'resize' && req.method === 'POST') {
      const value = z
        .object({ diskGiB: z.number().int().min(2).max(128).optional(), finish: z.boolean().optional() })
        .strict()
        .parse(await body(req));
      if (value.finish) send(this.maintenance.finishResize(id), 202);
      else if (value.diskGiB) send(this.maintenance.resize(id, value.diskGiB), 202);
      else throw new AppError('请输入目标磁盘容量');
      return true;
    }
  }
  if (parts.length === 4) {
    if (action === 'compact' && req.method === 'POST') {
      send(this.maintenance.compact(id), 202);
      return true;
    }
  }
  return false;
}
