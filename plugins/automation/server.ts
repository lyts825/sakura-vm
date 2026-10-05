import { services as projectsServices } from '../projects/services.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as serviceHealthServices } from '../service-health/services.ts';
import { services as secretsServices } from '../secrets/services.ts';
import { services as containersServices } from '../containers/services.ts';
import { services as automationServices } from './services.ts';
import { services as ideServices } from '../ide/services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';

import { FeatureSuite } from '../../server/feature-suite.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../shared/errors.ts';
import { z } from 'zod';


export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(automationServices.suite, new FeatureSuite(m, host.use(projectsServices.workspaces), {
    editor: () => host.optional(ideServices.ide),
    jobs: () => [...host.jobViews()],
    services: (id) => host.optional(serviceHealthServices.health)?.observed(id) || [],
    secrets: async (id) => host.optional(secretsServices.secrets)?.rotation(id),
    privateDatabase: async (id, input, signal, log) => {
      const service = host.optional(containersServices.containers);
      if (!service) throw new AppError('私有数据库需要启用容器插件', 409);
      await service.privateDatabase(id, input, signal, log);
    },
  }, {}, host.system));
  host.registerJobs(host.use(automationServices.suite).jobs, (job) => {
    const id = retryTarget(job);
    if (job.action?.startsWith('package:')) {
      const [operationValue, ...nameParts] = job.action.slice(8).split(':');
      const operation = z.enum(['list', 'search', 'install', 'remove', 'update', 'upgrade', 'upgrade-all',
        'cache-list', 'cache-prefetch', 'cache-install', 'cache-clear']).parse(operationValue);
      return retryInProject(host, job, () =>
        Promise.resolve(
          host.use(automationServices.suite).package(id, {
            operation,
            name: nameParts.join(':') || undefined,
          }),
        ),
      );
    }
    if (job.action?.startsWith('dev:')) {
      const [operationValue, managerValue] = job.action.slice(4).split(':');
      const operation = z
        .enum([
          'test',
          'test-discover',
          'lint',
          'format',
          'dependencies',
          'lock',
          'lock-check',
          'install-locked',
          'prefetch-dependencies',
          'install-cached-dependencies',
          'worktree-list',
          'worktree-add',
          'worktree-remove',
          'database',
        ])
        .parse(operationValue);
      if (['worktree-add', 'worktree-remove', 'database'].includes(operation))
        throw new AppError('此开发任务包含参数，请回到能力中心重新执行');
      const manager = ['prefetch-dependencies', 'install-cached-dependencies'].includes(operation)
        ? z.enum(['npm', 'pip']).parse(managerValue) : undefined;
      return retryInProject(host, job, () => Promise.resolve(host.use(automationServices.suite).dev(id, { operation, manager })));
    }
    throw new AppError('请回到原功能页面重新执行');
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
  if (parts[1] === 'feature-suite' && parts.length === 2 && req.method === 'GET') {
    send(await this.use(automationServices.suite).catalog());
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4 && req.method === 'POST' && action === 'suspend')
    return send(await this.vm.suspend(id));
  if (parts.length === 4 && req.method === 'POST' && action === 'resume')
    return send(await this.vm.resume(id));
  if (parts.length === 4) {
    if (action === 'packages') {
      if (req.method === 'GET') {
        const mode = url.searchParams.get('mode') || 'installed';
        const query = url.searchParams.get('query') || '';
        const page = Number(url.searchParams.get('page') || 1);
        const limit = Number(url.searchParams.get('limit') || 50);
        return send(await this.use(automationServices.suite).packageWorkbench.query(id,
          { mode, query, page, limit }, signal));
      }
      if (req.method === 'POST')
        return send(await this.use(automationServices.suite).packageWorkbench.action(id, await body(req, signal), signal), 202);
    }
    if (action === 'advanced') {
      if (req.method === 'GET') {
        send(await this.use(automationServices.suite).view(id, Number(url.searchParams.get('limit') || 120)));
        return true;
      }
      if (req.method === 'PUT') {
        const input = await body(req, signal);
        if (input?.schedule || input?.alerts) this.require('automation-scheduler');
        send(await this.use(automationServices.suite).update(id, input));
        return true;
      }
      if (req.method === 'POST') {
        send(await this.use(automationServices.suite).action(id, await body(req, signal), signal), 202);
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.feature-suite": route,
  "legacy.get.vms.vmId.advanced": route,
  "legacy.put.vms.vmId.advanced": route,
  "legacy.post.vms.vmId.advanced": route,
  "legacy.get.vms.vmId.packages": route,
  "legacy.post.vms.vmId.packages": route,
  "legacy.post.vms.vmId.suspend": route,
  "legacy.post.vms.vmId.resume": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("automation");
