/**
 * 模块职责：“项目流水线”插件服务端入口。激活时装配 Pipelines，并处理声明的服务端操作。
 */
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as pipelinesServices } from './services.ts';
import { services as projectsServices } from '../projects/services.ts';
import { services as filesServices } from '../files/services.ts';
import { services as transfersServices } from '../transfers/services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { Pipelines } from '../../server/pipelines.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../shared/errors.ts';
export async function activate(host: PluginContext) {
  const pipelines = host.provide(pipelinesServices.pipelines,
    new Pipelines(host.vm, host.use(projectsServices.workspaces), host.use(filesServices.files)));
  host.registerJobs(pipelines.jobs, (job) => {
    if (!job.action?.startsWith('run:')) throw new AppError('请回到原功能页面重新执行');
    // 历史任务重试先恢复其项目身份，再运行记录中的流水线，避免当前活动项目变化后执行到另一工作区。
    return retryInProject(host, job, () => host.use(pipelinesServices.pipelines).run(retryTarget(job), job.action!.slice(4)));
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
    if (action === 'pipelines') {
      const pipelines = this.use(pipelinesServices.pipelines);
      if (req.method === 'GET') {
        send(await pipelines.view(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await pipelines.save(id, await body(req, signal)));
        return true;
      }
      if (req.method === 'DELETE') {
        const input = httpRouteRequests["pipelines.legacy.delete.vms.vmId.pipelines"]
          .parse(await body(req, signal));
        send(await pipelines.remove(id, input.id));
        return true;
      }
      if (req.method === 'POST') {
        const input = httpRouteRequests["pipelines.legacy.post.vms.vmId.pipelines"]
          .parse(await body(req, signal));
        send(await pipelines.run(id, input.pipelineId), 202);
        return true;
      }
    }
    if (action === 'pipeline-artifact' && req.method === 'POST') {
      const input = httpRouteRequests["pipelines.legacy.post.vms.vmId.pipeline-artifact"]
        .parse(await body(req, signal));
      const target = await this.use(pipelinesServices.pipelines).artifact(id, input.runId, input.index);
      send(await this.use(transfersServices.downloads).issueLocal(id, { path: target.file, name: target.name }));
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, PluginRoute> = {
  "legacy.get.vms.vmId.pipelines": route,
  "legacy.put.vms.vmId.pipelines": route,
  "legacy.delete.vms.vmId.pipelines": route,
  "legacy.post.vms.vmId.pipelines": route,
  "legacy.post.vms.vmId.pipeline-artifact": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("pipelines");
