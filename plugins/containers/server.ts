/**
 * 模块职责：“容器工作台”插件服务端入口。激活时装配 Containers，并处理声明的服务端操作。
 */
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as containersServices } from './services.ts';
import { services as projectsServices } from '../projects/services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';

import { Containers } from '../../server/containers.ts';

export async function activate(host: PluginContext) {
  host.provide(containersServices.containers, new Containers(host.vm, host.use(projectsServices.workspaces)));
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
    if (action === 'containers') {
      const containers = this.use(containersServices.containers);
      if (req.method === 'GET') {
        send(
          url.searchParams.has('logs')
            ? await containers.logs(id, url.searchParams.get('logs')!, signal)
            : url.searchParams.has('template')
              ? await containers.templateMetadata(id, url.searchParams.get('template')!,
                  undefined, signal)
            : await containers.view(id, signal),
        );
        return true;
      }
      if (req.method === 'POST') {
        send(await containers.run(id, await body(req, signal)), 202);
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, PluginRoute> = {
  "legacy.get.vms.vmId.containers": route,
  "legacy.post.vms.vmId.containers": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("containers");
