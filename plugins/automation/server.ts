export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

import { FeatureSuite } from '../../server/feature-suite.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../server/model.ts';
import { z } from 'zod';
import type { ServiceHealth } from '../../server/service-health.ts';
import type { Secrets } from '../../server/secrets.ts';
import type { Containers } from '../../server/containers.ts';

export async function activate(host: PluginContext) {
  const m = host.machines;
  host.suite = new FeatureSuite(m, host.workspaces, {
    jobs: () => host.jobStores().flatMap((store) => store.list()),
    services: (id) => host.optional<ServiceHealth>('service-health', 'health')?.observed(id) || [],
    secrets: async (id) => host.optional<Secrets>('secrets', 'secrets')?.rotation(id),
    privateDatabase: async (id, input, signal, log) => {
      const service = host.optional<Containers>('containers', 'containers');
      if (!service) throw new AppError('私有数据库需要启用容器插件', 409);
      await service.privateDatabase(id, input, signal, log);
    },
  });
  host.registerJobs(host.suite.jobs, (job) => {
    const id = retryTarget(job);
    if (job.action?.startsWith('package:')) {
      const [operationValue, ...nameParts] = job.action.slice(8).split(':');
      const operation = z.enum(['list', 'search', 'install', 'remove', 'update', 'upgrade', 'upgrade-all',
        'cache-list', 'cache-prefetch', 'cache-install', 'cache-clear']).parse(operationValue);
      return retryInProject(host, job, () =>
        Promise.resolve(
          host.suite.package(id, {
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
      return retryInProject(host, job, () => Promise.resolve(host.suite.dev(id, { operation, manager })));
    }
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
  const send = (data: unknown, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data));
    return true;
  };
  if (parts[1] === 'feature-suite' && parts.length === 2 && req.method === 'GET') {
    send(await this.suite.catalog());
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  if (parts.length === 4 && req.method === 'POST' && action === 'suspend')
    return send(await this.machines.suspend(id));
  if (parts.length === 4 && req.method === 'POST' && action === 'resume')
    return send(await this.machines.resume(id));
  if (parts.length === 4) {
    if (action === 'packages') {
      if (req.method === 'GET') {
        const mode = url.searchParams.get('mode') || 'installed';
        const query = url.searchParams.get('query') || '';
        const page = Number(url.searchParams.get('page') || 1);
        const limit = Number(url.searchParams.get('limit') || 50);
        return send(await this.suite.packageWorkbench.query(id,
          { mode, query, page, limit }, signal));
      }
      if (req.method === 'POST')
        return send(await this.suite.packageWorkbench.action(id, await body(req), signal), 202);
    }
    if (action === 'advanced') {
      if (req.method === 'GET') {
        send(await this.suite.view(id, Number(url.searchParams.get('limit') || 120)));
        return true;
      }
      if (req.method === 'PUT') {
        const input = await body(req);
        if (input?.schedule || input?.alerts) this.require('automation-scheduler');
        send(await this.suite.update(id, input));
        return true;
      }
      if (req.method === 'POST') {
        send(await this.suite.action(id, await body(req), signal), 202);
        return true;
      }
    }
  }
  return false;
}
