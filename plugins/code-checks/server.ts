import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as codeChecksServices } from './services.ts';
import { services as projectsServices } from '../projects/services.ts';
import { services as filesServices } from '../files/services.ts';
import { services as migrationServices } from '../migration/services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { CodeIntelligence } from '../../server/code-intelligence.ts';
import { LanguageServices } from '../../server/language-services.ts';
import { DebugAdapter } from '../../server/debug-adapter.ts';
import { MAX_TEXT_REQUEST_BYTES } from '../../server/http.ts';
import { AppError } from '../../shared/errors.ts';
export async function activate(host: PluginContext) {
  const workspaces = host.use(projectsServices.workspaces);
  host.provide(codeChecksServices.intelligence, new CodeIntelligence(host.vm, workspaces));
  host.provide(codeChecksServices.languageServices, new LanguageServices(host.vm, workspaces, host.use(filesServices.fileLocks)));
  host.provide(codeChecksServices.debugger, new DebugAdapter(host.vm, workspaces));
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
    if (action === 'debugger') {
      const debuggerService = this.use(codeChecksServices.debugger);
      if (req.method === 'GET') return send(await debuggerService.status(id, signal));
      if (req.method === 'POST') {
        const value = httpRouteRequests["code-checks.legacy.post.vms.vmId.debugger"].parse(await body(req, signal));
        if (value.action === 'install') return send(await debuggerService.install(id, signal));
        if (value.action === 'start') return send(await debuggerService.start(id, value, signal));
        if (value.action === 'stop') return send(await debuggerService.stop(id, value.token));
        if (value.action === 'breakpoints') return send(await debuggerService.setBreakpoints(id, value.token, value.lines));
        if (value.action === 'inspect') return send(await debuggerService.inspect(id, value.token, value.frameId));
        if (value.action === 'expand') return send(await debuggerService.expand(id, value.token, value.reference));
        return send(await debuggerService.command(id, value.token, value.action, signal));
      }
    }
    if (action === 'language-service') {
      const languageServices = this.use(codeChecksServices.languageServices);
      if (req.method === 'GET')
        return send(await languageServices.status(id, url.searchParams.get('path') || '', signal));
      if (req.method === 'POST') {
        const value = httpRouteRequests["code-checks.legacy.post.vms.vmId.language-service"].parse(await body(req, signal, MAX_TEXT_REQUEST_BYTES));
        if (value.action === 'install') return send(await languageServices.install(id, signal));
        if (value.action === 'stop') return send(await languageServices.stop(id, value.token));
        if (value.action === 'apply') {
          if (this.optional(migrationServices.migration)?.blocked) throw new AppError('数据目录迁移维护中', 409);
          return send(await languageServices.apply(id, value.token, value.lockToken));
        }
        return send(await languageServices.execute(id, value, signal));
      }
    }
    if (action === 'code-diagnostics' && req.method === 'GET') {
      send(await this.use(codeChecksServices.intelligence).diagnose(id, url.searchParams.get('path') || '', signal));
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, PluginRoute> = {
  "legacy.get.vms.vmId.code-diagnostics": route,
  "legacy.get.vms.vmId.language-service": route,
  "legacy.post.vms.vmId.language-service": route,
  "legacy.get.vms.vmId.debugger": route,
  "legacy.post.vms.vmId.debugger": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("code-checks");
