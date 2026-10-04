import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as syncServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../shared/errors.ts';

import { z } from 'zod';

import { FolderSync } from '../../server/sync.ts';
import { MAX_TEXT_REQUEST_BYTES } from '../../server/http.ts';

export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(syncServices.sync, new FolderSync(m, host.workspaces.projects));
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
  body: (req: IncomingMessage, signal?: AbortSignal, limit?: number) => Promise<any>,
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  const send = (data: unknown, status = 200) => sendJson(res, data, status);
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4 && action === 'sync-rollback' && req.method === 'POST') {
    const { checkpoint } = httpRouteRequests["sync.legacy.post.vms.vmId.sync-rollback"]
      .parse(await body(req));
    return send(await this.sync.rollback(id, checkpoint), 202);
  }
  if (parts.length === 4 && action === 'sync-merge' && req.method === 'POST') {
    const { path, token } = httpRouteRequests["sync.legacy.post.vms.vmId.sync-merge"].parse(await body(req));
    return send(await this.sync.mergePreview(id, path, token, signal));
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
        const { direction, token, decisions, merges } = httpRouteRequests["sync.legacy.post.vms.vmId.sync"]
          .parse(await body(req, signal, MAX_TEXT_REQUEST_BYTES));
        send(await this.sync.run(id, direction, token, decisions, merges), 202);
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.vms.vmId.sync": route,
  "legacy.put.vms.vmId.sync": route,
  "legacy.post.vms.vmId.sync": route,
  "legacy.post.vms.vmId.sync-preview": route,
  "legacy.post.vms.vmId.sync-merge": route,
  "legacy.post.vms.vmId.sync-queue": route,
  "legacy.delete.vms.vmId.sync-queue": route,
  "legacy.post.vms.vmId.sync-rollback": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("sync");
