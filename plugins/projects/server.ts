import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as projectsServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../shared/errors.ts';

import { z } from 'zod';

import { Workspaces } from '../../server/workspaces.ts';
import {
  ProjectDirectoryMigrations,
  directoryMigrationApplySchema,
  directoryMigrationPreviewSchema,
} from '../../server/project-directory-migration.ts';

const directoryMigrations = new WeakMap<PluginContext, ProjectDirectoryMigrations>();

export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(projectsServices.workspaces, new Workspaces(m, {
    get secrets() {
      return host.secrets;
    },
    get network() {
      return host.network;
    },
  }));
  directoryMigrations.set(host, new ProjectDirectoryMigrations(m, host.workspaces));
  host.onDispose(() => {
    directoryMigrations.delete(host);
  });
  host.registerJobs(host.workspaces.jobs, (job) => {
    if (!job.action) throw new AppError('请回到原功能页面重新执行');
    const [action, service] = job.action.split(':');
    return retryInProject(host, job, () =>
      host.workspaces.run(
        retryTarget(job),
        z.enum(['setup', 'start', 'stop', 'terminal']).parse(action),
        service,
      ),
    );
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
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4 && action === 'project-directory-migration') {
    const service = directoryMigrations.get(this);
    if (!service) throw new AppError('目录迁移服务未初始化', 503);
    if (req.method === 'GET') return send(await service.view(id));
    if (req.method === 'POST') {
      const input = z
        .union([directoryMigrationPreviewSchema, directoryMigrationApplySchema])
        .parse(await body(req));
      return send(
        input.action === 'preview'
          ? await service.preview(id, signal)
          : await service.apply(id, input, signal),
      );
    }
  }
  if (parts.length === 4) {
    if (action === 'projects') {
      if (req.method === 'GET') {
        send(await this.workspaces.projects.list(id));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .discriminatedUnion('action', [
            z.object({ action: z.literal('create'), name: z.string(), config: z.unknown() }).strict(),
            z.object({ action: z.literal('select'), projectId: z.string() }).strict(),
            z.object({ action: z.literal('rename'), projectId: z.string(), name: z.string() }).strict(),
          ])
          .parse(await body(req));
        send(
          input.action === 'create'
            ? await this.workspaces.projects.create(id, input.name, async () => {
                await this.workspaces.save(id, input.config);
              })
            : await this.workspaces.projects.update(
                id,
                input.projectId,
                input.action === 'rename' ? input.name : undefined,
              ),
        );
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'project') {
      if (req.method === 'GET') {
        send(await this.workspaces.view(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.workspaces.save(id, await body(req)));
        return true;
      }
      if (req.method === 'POST') {
        const input = z
          .object({
            action: z.enum(['setup', 'start', 'stop', 'terminal']),
            service: z
              .string()
              .regex(/^[a-z][a-z0-9-]{0,31}$/)
              .optional(),
          })
          .strict()
          .parse(await body(req));
        send(await this.workspaces.run(id, input.action, input.service), 202);
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'project-runtime' && req.method === 'GET') {
      send(await this.workspaces.runtime(id, signal));
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.vms.vmId.projects": route,
  "legacy.post.vms.vmId.projects": route,
  "legacy.get.vms.vmId.project": route,
  "legacy.put.vms.vmId.project": route,
  "legacy.post.vms.vmId.project": route,
  "legacy.get.vms.vmId.project-runtime": route,
  "legacy.get.vms.vmId.project-directory-migration": route,
  "legacy.post.vms.vmId.project-directory-migration": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("projects");
