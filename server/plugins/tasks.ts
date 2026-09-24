import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from '../features.ts';

import { z } from 'zod';
import { AppError } from '../model.ts';

export const services = [] as const;
export async function activate(host: Features) {}
export async function route(
  this: Features,
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
  if (parts[1] === 'jobs') {
    const stores = this.jobStores();
    if (parts.length === 2 && req.method === 'GET') {
      send({
        jobs: stores
          .flatMap((s) => s.list())
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .slice(0, 300),
        warnings: stores.flatMap((s) => (s.persistenceError ? [s.persistenceError] : [])),
      });
      return true;
    }
    if (parts.length === 4 && req.method === 'POST') {
      const store = stores.find((s) => s.get(parts[2])),
        job = store?.get(parts[2]);
      if (!store || !job) throw new AppError('任务不存在', 404);
      if (parts[3] === 'cancel') {
        store.cancel(parts[2]);
        send({ ok: true });
        return true;
      }
      if (parts[3] === 'retry') {
        if (job.status === 'running') throw new AppError('任务仍在执行', 409);
        const id = job.vmId || job.key!;
        const withProject = <T>(action: () => Promise<T>) =>
          this.workspaces?.projects
            ? this.workspaces?.projects.inScope(id, job.projectId || 'default', action)
            : action();
        if (store === this.images?.jobs) send(this.images.prepare(job.key!));
        else if (store === this.workspaces?.jobs && job.action) {
          const [action, service] = job.action.split(':');
          send(
            await withProject(() =>
              this.workspaces.run(id, z.enum(['setup', 'start', 'stop', 'terminal']).parse(action), service),
            ),
          );
        } else if (store === this.sync?.jobs && job.action)
          send(
            await withProject(() => this.sync.run(id, z.enum(['both', 'push', 'pull']).parse(job.action))),
          );
        else if (store === this.downloads?.jobs) {
          this.require('snapshots');
          send(await this.downloads.issue(id, { type: 'export' }));
        } else if (store === this.backups?.jobs && job.action === 'run') send(await this.backups.run(id));
        else if (store === this.maintenance?.jobs && job.action === 'diagnose')
          send(this.maintenance.diagnose(id));
        else if (store === this.maintenance?.jobs && job.action === 'finish-resize')
          send(this.maintenance.finishResize(id));
        else if (store === this.pipelines?.jobs && job.action?.startsWith('run:'))
          send(await withProject(() => this.pipelines.run(id, job.action!.slice(4))));
        else if (store === this.runtimes?.jobs && job.action?.startsWith('install:')) {
          const [, tool, version] = job.action.split(':');
          send(await withProject(() => this.runtimes.install(id, { tool, version })));
        } else if (store === this.suite?.jobs && job.action?.startsWith('package:')) {
          const [operationValue, ...nameParts] = job.action.slice(8).split(':');
          const operation = z.enum(['list', 'search', 'install', 'remove', 'update']).parse(operationValue);
          send(
            await withProject(() =>
              Promise.resolve(this.suite.package(id, { operation, name: nameParts.join(':') || undefined })),
            ),
          );
        } else if (store === this.suite?.jobs && job.action?.startsWith('dev:')) {
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
              'worktree-list',
              'worktree-add',
              'worktree-remove',
              'database',
            ])
            .parse(job.action.slice(4));
          if (operation === 'worktree-add' || operation === 'worktree-remove' || operation === 'database')
            throw new AppError('此开发任务包含参数，请回到能力中心重新执行');
          send(await withProject(() => Promise.resolve(this.suite.dev(id, { operation }))));
        } else if (store === this.extended?.jobs && job.action?.startsWith('extended:')) {
          const featureId = job.action.slice('extended:'.length);
          send(
            await withProject(() => Promise.resolve(this.extended.action(id, { action: 'run', featureId }))),
          );
        } else if (store === this.extended?.jobs && job.action?.startsWith('operation:')) {
          throw new AppError('此工程操作包含参数，请回到能力中心重新执行');
        } else if (store === this.next?.jobs && job.action?.startsWith('next:')) {
          const featureId = job.action.slice('next:'.length);
          send(await withProject(() => Promise.resolve(this.next.action(id, { action: 'run', featureId }))));
        } else if (store === this.jobs) send((await import('./desktop.ts')).installIme.call(this, id));
        else throw new AppError('请回到原功能页面重新执行');
        return true;
      }
    }
  }
  if (parts[1] === 'events' && parts.length === 2 && req.method === 'GET') {
    const events = this.jobStores().flatMap((store) =>
      store
        .list()
        .filter((job) => ['error', 'cancelled', 'interrupted'].includes(job.status))
        .map((job) => ({
          type: 'job',
          id: job.id,
          vmId: job.vmId,
          projectId: job.projectId,
          title: job.title,
          status: job.status,
          message: job.error || job.phase,
          at: job.finishedAt || job.startedAt,
        })),
    );
    send({ events: events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100) });
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.machines.get(id);
  return false;
}
