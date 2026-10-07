/**
 * 模块职责：“项目搜索”插件服务端入口。激活时装配 ProjectFiles，并处理声明的服务端操作。
 */
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as projectSearchServices } from './services.ts';
import { services as projectsServices } from '../projects/services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';

import { ProjectFiles } from '../../server/project-files.ts';
export async function activate(host: PluginContext) {
  host.provide(projectSearchServices.projectFiles, new ProjectFiles(host.vm, host.use(projectsServices.workspaces)));
}
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _body: Parameters<PluginRoute>[3],
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  const send = (data: unknown, status = 200) => sendJson(res, data, status);

  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'project-files' && req.method === 'GET') {
      send(
        await this.execution.run({ vmId: id, projectId: this.use(projectsServices.workspaces).projects.current(id), signal },
          (execution) => this.use(projectSearchServices.projectFiles).scan(
            id,
            url.searchParams.get('q') || '',
            url.searchParams.get('content') === '1',
            execution.signal,
          )),
      );
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, PluginRoute> = {
  "legacy.get.vms.vmId.project-files": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("project-search");
