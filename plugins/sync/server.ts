export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../server/model.ts';

import { z } from 'zod';

import { FolderSync } from '../../server/sync.ts';

export async function activate(host: PluginContext) {
  const m = host.machines;
  host.sync = new FolderSync(m, host.workspaces.projects);
  host.registerJobs(host.sync.jobs, (job) => {
    if (!job.action) throw new AppError('请回到原功能页面重新执行');
    return retryInProject(host, job, () =>
      job.action!.startsWith('rollback:')
        ? host.sync.rollback(retryTarget(job), z.uuid().parse(job.action!.slice(9)))
        : host.sync.run(retryTarget(job), z.enum(['both', 'push', 'pull']).parse(job.action)),
    );
  });
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
  if (parts.length === 4 && action === 'sync-rollback' && req.method === 'POST') {
    const { checkpoint } = z
      .object({ checkpoint: z.uuid() })
      .strict()
      .parse(await body(req));
    return send(await this.sync.rollback(id, checkpoint), 202);
  }
  if (parts.length === 4 && action === 'sync-queue' && ['POST', 'DELETE'].includes(req.method || '')) {
    return send(
      { queue: await this.sync.queue(id, req.method === 'DELETE') },
      req.method === 'POST' ? 202 : 200,
    );
  }
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
                  'merge',
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
