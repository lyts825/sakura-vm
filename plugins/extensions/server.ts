import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as extensionsServices } from './services.ts';
import { services as ideServices } from '../ide/services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { ExtendedFeatures } from '../../server/extended-features.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../shared/errors.ts';

export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(extensionsServices.extended, new ExtendedFeatures(m, host.workspaces, host.system, () => host.optional(ideServices.ide)));
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
  const send = (data: unknown, status = 200) => sendJson(res, data, status);
  if (parts[1] === 'extended-features' && parts.length === 2 && req.method === 'GET') {
    send(await this.extended.catalog());
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
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

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.extended-features": route,
  "legacy.get.vms.vmId.extended-features": route,
  "legacy.post.vms.vmId.extended-features": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("extensions");
