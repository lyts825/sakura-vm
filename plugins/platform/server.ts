import { services as backupsServices } from '../backups/services.ts';
import { services as snapshotsServices } from '../snapshots/services.ts';
import { services as secretsServices } from '../secrets/services.ts';
import { services as platformServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { NextFeatures } from '../../server/next-features.ts';
import { ObjectBackup } from '../../server/object-backup.ts';
import { WireGuardOverlay } from '../../server/wireguard-overlay.ts';
import type { Backups } from '../../server/backups.ts';
import type { Bundles } from '../../server/bundles.ts';
import type { Secrets } from '../../server/secrets.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../shared/errors.ts';
import { z } from 'zod';
import type { PluginOperation } from '../../server/plugin-api.ts';

export const operations: Record<string, PluginOperation> = {
  'browser-ide-link': {
    response: z.object({ url: z.url(), password: z.string().length(64),
      expiresAt: z.iso.datetime() }).strict(),
    execute(url) {
      return this.next.browserIdeLink(url.pathname.split('/')[3]);
    },
  },
  'notebook-link': {
    response: z.object({ provider: z.enum(['jupyter', 'marimo']), url: z.url() }).strict(),
    execute(url) {
      return this.next.notebookLink(url.pathname.split('/')[3]);
    },
  },
};

export async function activate(host: PluginContext) {
  const m = host.vm;
  const service = host.provide(platformServices.next, new NextFeatures(m, host.workspaces, host.system, {
    objectBackup: new ObjectBackup(m, () => ({
    backups: host.optional(backupsServices.backups),
    bundles: host.optional(snapshotsServices.bundles),
    secrets: host.optional(secretsServices.secrets),
    })),
    wireGuardOverlay: new WireGuardOverlay(m, () => host.optional(secretsServices.secrets)),
    snapshotMerge: () => host.optional(snapshotsServices.snapshotMerge),
  }));
  await service.init();
  host.registerJobs(host.next.jobs, (job) => {
    if (!job.action?.startsWith('next:')) throw new AppError('请回到原功能页面重新执行');
    const featureId = job.action.slice('next:'.length);
    return retryInProject(host, job, () => Promise.resolve(host.next.action(
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
  const send = (data: unknown, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data));
    return true;
  };
  if (parts[1] === 'next-features' && parts.length === 2 && req.method === 'GET') {
    send(await this.next.catalog());
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'next-features') {
      if (req.method === 'GET') {
        send(await this.next.view(id));
        return true;
      }
      if (req.method === 'POST') {
        send(await this.next.action(id, await body(req), signal), 202);
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
