/**
 * 模块职责：处理插件任务查询、操作与产物路由，核对任务存在性和运行状态。
 * Module purpose: Handles plugin job lookup, actions and artifacts after checking existence and execution state.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VmAccess } from '../vm-access.ts';

import { AppError } from '../../shared/errors.ts';
import { sendJson } from '../http-response.ts';

/**
 * 入口 / Entry: route.
 * 功能：在处理插件任务查询、操作与产物路由中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send({ jobId: parts[2], result: await store.result(parts[2]) })` / `true` 供上层消费（`plugins/tasks.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugins/tasks.ts`; this entry produces `send({ jobId: parts[2], result: await store.result(parts[2]) })` / `true` for its caller. Module context: Handles plugin job lookup, actions and artifacts after checking existence and execution state.
 * 处理：通过 `url.pathname.split().filter`, `url.pathname.split`, `this.jobStores`, `stores.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `url.pathname.split().filter`, `url.pathname.split`, `this.jobStores`, `stores.find`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `parts.length === 2 && req.method === 'GET'`; `parts[3] === 'cancel'`; `job.vmId`.
 * 输入 / Inputs: this: Pick<import('../plugin-runtime.ts').PluginRuntime, 'jobStores' | 'retryHandler'> & { …; req: IncomingMessage; res: ServerResponse; url: URL; body: (req: IncomingMessage, signal?: AbortSignal, limit?: number) => Promise<any>; signal: AbortSignal
 * 输出 / Returns: Promise<boolean>；结果来自 / values from `send({ jobId: parts[2], result: await store.result(parts[2]) })`; `true`; `false`.
 * 副作用 / Effects: `send`.
 * 拒绝 / Refusals: 条件 / conditions `parts[1] === 'jobs'`; `parts.length === 4 && parts[3] === 'result' && req.method === 'GET'`; `!store`; 异常 / errors `new AppError('任务不存在', 404)`; `new AppError('任务仍在执行', 409)`.
 */
export async function route(
  this: Pick<import('../plugin-runtime.ts').PluginRuntime, 'jobStores' | 'retryHandler'> & { vm: Pick<VmAccess, 'requireUnlocked'> },
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: (req: IncomingMessage, signal?: AbortSignal, limit?: number) => Promise<any>,
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  /**
   * 入口 / Entry: route.send.
   * 功能：把本层请求转交 `sendJson`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `sendJson` and propagates the provider result or rejection.
   * 输入 / Inputs: data: unknown; status: default=200
   * 输出 / Returns: `sendJson(res, data, status)`.
   * 副作用 / Effects: `sendJson`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const send = (data: unknown, status = 200) => sendJson(res, data, status);
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
        if (job.vmId) this.vm.requireUnlocked?.(job.vmId);
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
