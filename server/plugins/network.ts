import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';

import { z } from 'zod';
import { AppError } from '../model.ts';

import { NetworkProfiles } from '../network-profiles.ts';

export const services = ['network'] as const;
export async function activate(host: Features) {
  const m = host.machines;
  host.network = new NetworkProfiles(m);
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
    if (action === 'network') {
      if (req.method === 'GET') {
        send({ ...(await this.network.state(id)), job: this.network.jobs.view(id) });
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({
            action: z.enum(['preview', 'apply', 'restore', 'test']),
            config: z.unknown().optional(),
            token: z.string().optional(),
          })
          .strict()
          .parse(await body(req));
        send(
          input.action === 'preview'
            ? await this.network.preview(id, input.config, signal)
            : input.action === 'apply'
              ? await this.network.apply(id, input.config, input.token || '')
              : input.action === 'restore'
                ? await this.network.restore(id)
                : this.network.test(id, input.config),
        );
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'services') {
      if (req.method === 'PATCH') {
        const { forwards } = z
          .object({ forwards: z.unknown() })
          .strict()
          .parse(await body(req));
        send(await this.machines.setForwards(id, forwards));
        return true;
      }
      if (req.method === 'GET') {
        let listening = new Set<number>();
        if (this.machines.state(id) === 'running') {
          const result = await this.machines.exec(id, 'cat /proc/net/tcp /proc/net/tcp6', 10000);
          if (result.code !== 0) throw new AppError('无法读取客户机监听端口');
          listening = new Set(
            result.stdout
              .split('\n')
              .map((line) => line.trim().split(/\s+/))
              .filter((columns) => columns[3] === '0A')
              .map((columns) => parseInt(columns[1].split(':').at(-1)!, 16)),
          );
        }
        send({
          forwards: this.machines.get(id).forwards.map((p) => ({ ...p, listening: listening.has(p.guest) })),
          listening: [...listening],
        });
        return true;
      }
    }
  }
  return false;
}
