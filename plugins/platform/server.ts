import { services as projectsServices } from '../projects/services.ts';
import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as backupsServices } from '../backups/services.ts';
import { services as snapshotsServices } from '../snapshots/services.ts';
import { services as secretsServices } from '../secrets/services.ts';
import { services as platformServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';

import { NextFeatures } from '../../server/next-features.ts';
import { ObjectBackup } from '../../server/object-backup.ts';
import { WireGuardOverlay } from '../../server/wireguard-overlay.ts';

import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../shared/errors.ts';

import type { PluginOperation } from '../../server/plugin-api.ts';

export const operations: Record<string, PluginOperation> = {
  'browser-ide-link': {
    response: pluginRouteResponses["platform.browser-ide-link"].schema,
    execute(url) {
      return this.use(platformServices.next).browserIdeLink(url.pathname.split('/')[3]);
    },
  },
  'notebook-link': {
    response: pluginRouteResponses["platform.notebook-link"].schema,
    execute(url) {
      return this.use(platformServices.next).notebookLink(url.pathname.split('/')[3]);
    },
  },
};

export async function activate(host: PluginContext) {
  const m = host.vm;
  const service = host.provide(platformServices.next, new NextFeatures(m, host.use(projectsServices.workspaces), host.system, {
    objectBackup: new ObjectBackup(m, () => ({
      backups: host.optional(backupsServices.backups),
      bundles: host.optional(snapshotsServices.bundles),
      secrets: host.optional(secretsServices.secrets),
    })),
    wireGuardOverlay: new WireGuardOverlay(m, () => host.optional(secretsServices.secrets)),
    snapshotMerge: () => host.optional(snapshotsServices.snapshotMerge),
  }));
  await service.init();
  host.registerJobs(host.use(platformServices.next).jobs, (job) => {
    if (!job.action?.startsWith('next:')) throw new AppError('请回到原功能页面重新执行');
    const featureId = job.action.slice('next:'.length);
    return retryInProject(host, job, () => Promise.resolve(host.use(platformServices.next).action(
      retryTarget(job), { action: 'run', featureId })));
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
  if (parts[1] === 'next-features' && parts.length === 2 && req.method === 'GET') {
    send(await this.use(platformServices.next).catalog());
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'next-features') {
      if (req.method === 'GET') {
        send(await this.use(platformServices.next).view(id));
        return true;
      }
      if (req.method === 'POST') {
        send(await this.use(platformServices.next).action(id, await body(req, signal), signal), 202);
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.next-features": route,
  "legacy.get.vms.vmId.next-features": route,
  "legacy.post.vms.vmId.next-features": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("platform");
