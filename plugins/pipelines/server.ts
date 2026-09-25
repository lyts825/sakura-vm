export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { z } from 'zod';
import { Pipelines } from '../../server/pipelines.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../server/model.ts';
export async function activate(host: PluginContext) {
  host.pipelines = new Pipelines(host.machines, host.workspaces, host.files);
  host.registerJobs(host.pipelines.jobs, (job) => {
    if (!job.action?.startsWith('run:')) throw new AppError('请回到原功能页面重新执行');
    return retryInProject(host, job, () => host.pipelines.run(retryTarget(job), job.action!.slice(4)));
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
    if (action === 'pipelines') {
      if (req.method === 'GET') {
        send(await this.pipelines.view(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.pipelines.save(id, await body(req)));
        return true;
      }
      if (req.method === 'DELETE') {
        const input = z
          .object({ id: z.uuid() })
          .strict()
          .parse(await body(req));
        send(await this.pipelines.remove(id, input.id));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({ action: z.literal('run'), pipelineId: z.uuid() })
          .strict()
          .parse(await body(req));
        send(await this.pipelines.run(id, input.pipelineId), 202);
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'pipeline-artifact' && req.method === 'POST') {
      const input = z
        .object({ runId: z.uuid(), index: z.number().int().min(0).max(19) })
        .strict()
        .parse(await body(req));
      const target = await this.pipelines.artifact(id, input.runId, input.index);
      send(await this.downloads.issueLocal(id, { path: target.file, name: target.name }));
      return true;
    }
  }
  return false;
}
