export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { z } from 'zod';
import { RuntimeVersions } from '../../server/runtime-versions.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../server/model.ts';
export async function activate(host: PluginContext) {
  host.runtimes = new RuntimeVersions(host.machines, host.workspaces);
  host.registerJobs(host.runtimes.jobs, (job) => {
    if (!job.action?.startsWith('install:')) throw new AppError('请回到原功能页面重新执行');
    const [, tool, version] = job.action.split(':');
    return retryInProject(host, job, () => host.runtimes.install(retryTarget(job), { tool, version }));
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
    if (action === 'runtimes') {
      if (req.method === 'GET') {
        send(await this.runtimes.view(id, signal));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .discriminatedUnion('action', [
            z.object({ action: z.literal('probe') }).strict(),
            z
              .object({
                action: z.literal('select'),
                node: z.string().optional(),
                python: z.string().optional(),
              })
              .strict(),
            z
              .object({ action: z.literal('install'), tool: z.enum(['node', 'python']), version: z.string() })
              .strict(),
          ])
          .parse(await body(req));
        if (input.action === 'probe') return send(await this.runtimes.probe(id, signal));
        if (input.action === 'select')
          return send(await this.runtimes.select(id, {
            ...(input.node === undefined ? {} : { node: input.node }),
            ...(input.python === undefined ? {} : { python: input.python }),
          }, signal));
        return send(await this.runtimes.install(id, { tool: input.tool, version: input.version }), 202);
      }
    }
  }
  return false;
}
