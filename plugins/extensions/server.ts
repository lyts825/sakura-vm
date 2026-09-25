export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { ExtendedFeatures } from '../../server/extended-features.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../server/model.ts';

export async function activate(host: PluginContext) {
  const m = host.machines;
  host.extended = new ExtendedFeatures(m, host.workspaces);
  host.registerJobs(host.extended.jobs, (job) => {
    if (job.action?.startsWith('operation:'))
      throw new AppError('此工程操作包含参数，请回到能力中心重新执行');
    if (!job.action?.startsWith('extended:')) throw new AppError('请回到原功能页面重新执行');
    const featureId = job.action.slice('extended:'.length);
    return retryInProject(host, job, () => Promise.resolve(host.extended.action(
      retryTarget(job), { action: 'run', featureId })));
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
  if (parts[1] === 'extended-features' && parts.length === 2 && req.method === 'GET') {
    send(await this.extended.catalog());
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  if (parts.length === 4) {
    if (action === 'extended-features') {
      if (req.method === 'GET') {
        send(await this.extended.view(id));
        return true;
      }
      if (req.method === 'POST') {
        send(await this.extended.action(id, await body(req), signal), 202);
        return true;
      }
    }
  }
  return false;
}
