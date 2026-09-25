export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../server/model.ts';

import { z } from 'zod';

import { Workspaces } from '../../server/workspaces.ts';

export async function activate(host: PluginContext) {
  const m = host.machines;
  host.workspaces = new Workspaces(m, {
    get secrets() {
      return host.secrets;
    },
    get network() {
      return host.network;
    },
  });
  host.registerJobs(host.workspaces.jobs, (job) => {
    if (!job.action) throw new AppError('请回到原功能页面重新执行');
    const [action, service] = job.action.split(':');
    return retryInProject(host, job, () => host.workspaces.run(
      retryTarget(job), z.enum(['setup', 'start', 'stop', 'terminal']).parse(action), service));
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
  if (parts.length === 4) {
    if (action === 'projects') {
      if (req.method === 'GET') {
        send(await this.workspaces.projects.list(id));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .discriminatedUnion('action', [
            z.object({ action: z.literal('create'), name: z.string(), config: z.unknown() }).strict(),
            z.object({ action: z.literal('select'), projectId: z.string() }).strict(),
            z.object({ action: z.literal('rename'), projectId: z.string(), name: z.string() }).strict(),
          ])
          .parse(await body(req));
        send(
          input.action === 'create'
            ? await this.workspaces.projects.create(id, input.name, async () => {
                await this.workspaces.save(id, input.config);
              })
            : await this.workspaces.projects.update(
                id,
                input.projectId,
                input.action === 'rename' ? input.name : undefined,
              ),
        );
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'project') {
      if (req.method === 'GET') {
        send(await this.workspaces.view(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.workspaces.save(id, await body(req)));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({
            action: z.enum(['setup', 'start', 'stop', 'terminal']),
            service: z
              .string()
              .regex(/^[a-z][a-z0-9-]{0,31}$/)
              .optional(),
          })
          .strict()
          .parse(await body(req));
        send(await this.workspaces.run(id, input.action, input.service), 202);
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'project-runtime' && req.method === 'GET') {
      send(await this.workspaces.runtime(id, signal));
      return true;
    }
  }
  return false;
}
