import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as runtimesServices } from './services.ts';
import { services as projectsServices } from '../projects/services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { RuntimeVersions } from '../../server/runtime-versions.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../shared/errors.ts';
export async function activate(host: PluginContext) {
  const runtimes = host.provide(runtimesServices.runtimes, new RuntimeVersions(host.vm, host.use(projectsServices.workspaces)));
  host.registerJobs(runtimes.jobs, (job) => {
    if (!job.action?.startsWith('install:')) throw new AppError('请回到原功能页面重新执行');
    const [, tool, version] = job.action.split(':');
    return retryInProject(host, job, () => host.use(runtimesServices.runtimes).install(retryTarget(job), { tool, version }));
  });
}
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: Parameters<PluginRoute>[3],
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  const send = (data: unknown, status = 200) => sendJson(res, data, status);

  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'runtimes') {
      const runtimes = this.use(runtimesServices.runtimes);
      if (req.method === 'GET') {
        send(await runtimes.view(id, signal));
        return true;
      }
      if (req.method === 'POST') {
        const input = httpRouteRequests["runtimes.legacy.post.vms.vmId.runtimes"]
          .parse(await body(req, signal));
        if (input.action === 'probe') return send(await runtimes.probe(id, signal));
        if (input.action === 'select')
          return send(await runtimes.select(id, {
            ...(input.node === undefined ? {} : { node: input.node }),
            ...(input.python === undefined ? {} : { python: input.python }),
          }, signal));
        return send(await runtimes.install(id, { tool: input.tool, version: input.version }), 202);
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, PluginRoute> = {
  "legacy.get.vms.vmId.runtimes": route,
  "legacy.post.vms.vmId.runtimes": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("runtimes");
