import { services as projectsServices } from '../projects/services.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as desktopServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginOperation, PluginRoute } from '../../server/plugin-api.ts';
import { retryTarget, retryInProject } from '../../server/plugins/retry.ts';

import { AppError } from '../../shared/errors.ts';

import { Desktops } from '../../server/desktop.ts';
import { x11ClipboardRequest } from '../../server/x11-clipboard.ts';

export const operations: Record<string, PluginOperation> = {
  'x11-clipboard-get': { response: pluginRouteResponses["desktop.x11-clipboard-get"].schema, execute(url, _, signal) {
    return this.use(desktopServices.x11Clipboard).view(url.pathname.split('/')[3], signal);
  } },
  'x11-clipboard-action': { request: x11ClipboardRequest, response: pluginRouteResponses["desktop.x11-clipboard-action"].schema,
    execute(url, input, signal) { return this.use(desktopServices.x11Clipboard).action(url.pathname.split('/')[3], input, signal); } },
  'wayland-clipboard-get': { response: pluginRouteResponses["desktop.wayland-clipboard-get"].schema, execute(url, _, signal) {
    return this.use(desktopServices.waylandClipboard).view(url.pathname.split('/')[3], signal);
  } },
  'wayland-clipboard-action': { request: x11ClipboardRequest, response: pluginRouteResponses["desktop.wayland-clipboard-action"].schema,
    execute(url, input, signal) { return this.use(desktopServices.waylandClipboard).action(url.pathname.split('/')[3], input, signal); } },
};

export async function activate(host: PluginContext) {
  const m = host.vm;
  const desktops = host.provide(desktopServices.desktops,
    new Desktops(m, host.use(projectsServices.workspaces), { deferInitialization: true }));
  desktops.init();
  host.provide(desktopServices.jobs, host.capabilities.jobs.create('input-method', { historyName: 'input-method' }));
  host.registerJobs(host.use(desktopServices.jobs), (job) => retryInProject(host, job, async () => installIme.call(host, retryTarget(job))));
  host.provide(desktopServices.x11Clipboard, desktops.clipboard);
  host.registerJobs(host.use(desktopServices.x11Clipboard).jobs,
    (job) => host.use(desktopServices.x11Clipboard).install(retryTarget(job)));
  host.provide(desktopServices.waylandClipboard, desktops.waylandClipboard);
  host.registerJobs(host.use(desktopServices.waylandClipboard).jobs,
    (job) => host.use(desktopServices.waylandClipboard).install(retryTarget(job)));
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
  if (parts[3] === 'desktop' && parts.length === 4) {
    if (req.method === 'GET') return send(await this.use(desktopServices.desktops).view(id));
    if (req.method === 'POST') {
      const { action, preferences } = httpRouteRequests["desktop.legacy.post.vms.vmId.desktop"]
        .parse(await body(req, signal));
      if (action === 'stop') {
        if (preferences) throw new AppError('停止桌面不能提交外观设置');
        return send(await this.use(desktopServices.desktops).stop(id));
      }
      return send(this.use(desktopServices.desktops).start(id, action, preferences), 202);
    }
  }
  if (action === 'single-app' && parts.length === 4) {
    if (req.method === 'GET') return send({ sessions: await this.use(desktopServices.desktops).apps.list(id),
      clipboardPolicies: await this.use(desktopServices.desktops).apps.clipboardPolicies(id) });
    if (req.method === 'POST') {
      const input = httpRouteRequests["desktop.legacy.post.vms.vmId.single-app"].parse(await body(req, signal));
      if (input.action === 'start') {
        const { action: _, ...options } = input;
        return send(await this.use(desktopServices.desktops).apps.start(id, options, signal), 201);
      }
      if (input.action === 'stop') return send(await this.use(desktopServices.desktops).apps.stop(id, input.id));
      if (input.action === 'clipboard-save')
        return send(await this.use(desktopServices.desktops).apps.saveClipboardPolicy(id, input.program,
          input.clipboard));
      return send(await this.use(desktopServices.desktops).apps.removeClipboardPolicy(id, input.program));
    }
  }
  if (parts.length === 4) {
    if (action === 'ime') {
      if (req.method === 'GET') {
        send(this.use(desktopServices.jobs).view(id));
        return true;
      }
      if (req.method === 'POST') {
        if (this.vm.state(id) !== 'running') throw new AppError('请先启动发行版');
        send(installIme.call(this, id), 202);
        return true;
      }
    }
  }
  return false;
}
export function installIme(this: PluginContext, id: string) {
  if (this.vm.state(id) !== 'running') throw new AppError('请先启动发行版');
  const workspaces = this.use(projectsServices.workspaces);
  const live = this.vm.live.get(id), projectId = workspaces.projects.current(id);
  const original = () => {
    if (!live || this.vm.live.get(id) !== live || this.vm.state(id) !== 'running')
      throw new AppError('原客户机在输入法任务准备期间已改变', 409, 'DESKTOP_SCOPE_CHANGED');
  };
  original();
  return this.use(desktopServices.jobs).start(id, async (log, signal) => {
    const execute = async () => {
      signal.throwIfAborted(); original();
      const result = await this.use(desktopServices.desktops).installIme(id, signal, log);
      original();
      if (result.code !== 0) throw new AppError(result.stderr || '输入法安装失败', 409);
    };
    if (projectId) await workspaces.projects.inScope(id, projectId, execute);
    else await execute();
  }, { title: '安装中文输入法', vmId: id, projectId, action: 'install' });
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.vms.vmId.desktop": route,
  "legacy.post.vms.vmId.desktop": route,
  "legacy.get.vms.vmId.single-app": route,
  "legacy.post.vms.vmId.single-app": route,
  "legacy.get.vms.vmId.ime": route,
  "legacy.post.vms.vmId.ime": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("desktop");
