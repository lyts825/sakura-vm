import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as maintenanceServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { z } from 'zod';
import { AppError } from '../../shared/errors.ts';

import { Maintenance } from '../../server/maintenance.ts';
import { retryTarget } from '../../server/plugins/retry.ts';

export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(maintenanceServices.maintenance, new Maintenance(m));
  host.registerJobs(host.maintenance.jobs, (job) => {
    const id = retryTarget(job);
    if (job.action === 'diagnose') return host.maintenance.diagnose(id);
    if (job.action === 'finish-resize') return host.maintenance.finishResize(id);
    if (job.action === 'trim' || job.action === 'compact') return host.maintenance.diskRun(id, job.action);
    throw new AppError('请回到原功能页面重新执行');
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
  if (parts[1] === 'storage' && parts.length === 2 && req.method === 'GET') {
    send(await this.maintenance.storage());
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4 && action === 'disk-maintenance') {
    if (req.method === 'GET') return send(await this.maintenance.diskView(id));
    if (req.method === 'PUT') return send(await this.maintenance.diskPolicy(id, await body(req)));
    if (req.method === 'POST') {
      const input = z
        .object({ mode: z.enum(['trim', 'compact']) })
        .strict()
        .parse(await body(req));
      return send(this.maintenance.diskRun(id, input.mode), 202);
    }
  }
  if (parts.length === 4) {
    if (action === 'diagnostics') {
      if (req.method === 'GET') {
        send({ report: this.maintenance.report(id), job: this.maintenance.jobs.view(id) });
        return true;
      }
      if (req.method === 'POST') {
        send(this.maintenance.diagnose(id), 202);
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'resize' && req.method === 'POST') {
      const value = z
        .object({ diskGiB: z.number().int().min(2).max(128).optional(), finish: z.boolean().optional() })
        .strict()
        .parse(await body(req));
      if (value.finish) send(this.maintenance.finishResize(id), 202);
      else if (value.diskGiB) send(this.maintenance.resize(id, value.diskGiB), 202);
      else throw new AppError('请输入目标磁盘容量');
      return true;
    }
  }
  if (parts.length === 4) {
    if (action === 'compact' && req.method === 'POST') {
      send(this.maintenance.compact(id), 202);
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.storage": route,
  "legacy.get.vms.vmId.diagnostics": route,
  "legacy.post.vms.vmId.diagnostics": route,
  "legacy.post.vms.vmId.resize": route,
  "legacy.post.vms.vmId.compact": route,
  "legacy.get.vms.vmId.disk-maintenance": route,
  "legacy.put.vms.vmId.disk-maintenance": route,
  "legacy.post.vms.vmId.disk-maintenance": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("maintenance");
