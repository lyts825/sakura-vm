import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../plugin-api.ts';

import { AppError } from '../model.ts';

export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: (req: IncomingMessage, signal?: AbortSignal, limit?: number) => Promise<any>,
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
    if (parts.length === 4 && parts[3] === 'result' && req.method === 'GET') {
      const store = stores.find((item) => item.get(parts[2]));
      if (!store) throw new AppError('任务不存在', 404);
      return send({ jobId: parts[2], result: await store.result(parts[2]) });
    }
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
        if (job.vmId) this.machines.requireUnlocked?.(job.vmId);
        if (job.status === 'running') throw new AppError('任务仍在执行', 409);
        const pluginRetry = this.retryHandler(store);
        if (pluginRetry) {
          send(await pluginRetry(job));
          return true;
        }
        throw new AppError('请回到原功能页面重新执行');
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
          errorCode: job.errorCode,
          at: job.finishedAt || job.startedAt,
        })),
    );
    send({ events: events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100) });
    return true;
  }
  return false;
}
