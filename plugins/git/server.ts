/**
 * 模块职责：“Git 工作台”插件服务端入口。激活时装配 GitWorkbench，并处理声明的服务端操作。
 */
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as gitServices } from './services.ts';
import { services as projectsServices } from '../projects/services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';

import { GitWorkbench } from '../../server/git-workbench.ts';
import { MAX_TEXT_REQUEST_BYTES } from '../../server/http.ts';

export async function activate(host: PluginContext) {
  host.provide(gitServices.git, new GitWorkbench(host.vm, host.use(projectsServices.workspaces)));
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
    if (action === 'git') {
      const git = this.use(gitServices.git);
      if (req.method === 'GET') {
        send(
          url.searchParams.has('choices')
            ? await git.conflictChoices(id, url.searchParams.get('choices')!, signal)
            : url.searchParams.has('merge')
            ? await git.mergeInputs(id, url.searchParams.get('merge')!, signal)
            : url.searchParams.has('path')
              ? await git.diff(
                  id,
                  url.searchParams.get('path')!,
                  url.searchParams.get('staged') === '1',
                  signal,
                )
              : await git.view(id, signal),
        );
        return true;
      }
      if (req.method === 'POST') {
        send(await git.run(id, await body(req, signal, MAX_TEXT_REQUEST_BYTES)), 202);
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, PluginRoute> = {
  "legacy.get.vms.vmId.git": route,
  "legacy.post.vms.vmId.git": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("git");
