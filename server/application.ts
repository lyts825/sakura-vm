/**
 * 模块职责：组织宿主资源、领域服务及 HTTP 的启动与关闭；清理未确认时保留数据目录归属。
 * Module purpose: Coordinates host resources, domain services and HTTP startup/shutdown; retains data-directory ownership until cleanup is confirmed.
 */
import { AppError } from '../shared/errors.ts';
import { startApplicationHttp } from './application-http.ts';
import { createApplicationServices } from './application-services.ts';
import { computeRuntime } from './compute-runtime.ts';
import { DataDirectoryOwner } from './data-directory-owner.ts';
import { hostRuntime } from './host-runtime/index.ts';
import { flushMetadata } from './metadata-queue.ts';
import { networkRuntime } from './network/index.ts';
import { DATA, PORT } from './paths.ts';
import { PluginManager } from './plugin-manager.ts';
import { ClosePhase, ResourceScope } from './resource-scope.ts';
import { scheduler } from './scheduler.ts';

/** 先取得数据目录归属再开放请求；启动失败也沿用正常关闭流程核对所有资源。 */
/**
 * 入口 / Entry: startApplication.
 * 功能：取得数据目录独占归属并启动网络、领域服务和 HTTP，信号或启动失败走同一资源收尾。
 * Purpose: Acquires exclusive data-directory ownership and starts network, domains and HTTP, sharing cleanup for signals and startup failure.
 * 设计：先排空准入，再按依赖关闭资源并 flush 元数据；存在未确认资源或写入错误时继续保留目录所有权。
 * Design: Admission drains first, resources close in dependency order and metadata is flushed; pending resources or writes keep directory ownership.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `resources.defer`; `DataDirectoryOwner.acquire`; `networkRuntime.start`; `createApplicationServices`; `startApplicationHttp`; 更新 / updates `dataOwner`.
 * 拒绝 / Refusals: 异常 / errors `new AggregateError([error, cleanup], 'Application startup and cleanup failed')`; `error`.
 * 失败处理：catch 分支执行 `try { await closeResources(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Application startup and cleanup…`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `try { await closeResources(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Application startup and cleanup…`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function startApplication() {
  const resources = new ResourceScope({ owner: 'core:application' });
  const plugins = new PluginManager();
  resources.defer('plugin-management', () => plugins.system.close(), ClosePhase.services,
    ['features', 'machines', 'audit', 'network', 'compute', 'scheduler']);
  let dataOwner: DataDirectoryOwner | undefined;
  /**
   * 入口 / Entry: startApplication.closeResources.
   * 功能：在组织宿主资源、领域服务及 HTTP 的启动与关闭中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`application.ts`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `application.ts`; the calls and state transitions below complete the operation. Module context: Coordinates host resources, domain services and HTTP startup/shutdown; retains data-directory ownership until cleanup is confirmed.
   * 处理：通过 `resources.close`, `failures.push`, `flushMetadata`, `hostRuntime.snapshot().resources.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `resources.close`, `failures.push`, `flushMetadata`, `hostRuntime.snapshot().resources.filter`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!failures.length`; `pending.length`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `resources.close`; `failures.push`; `dataOwner.close`; `hostRuntime.close`.
   * 拒绝 / Refusals: 条件 / conditions `failures.length`; 异常 / errors `new AggregateError(failures, 'Host resources require cleanup')`.
   * 失败处理：catch 分支执行 `failures.push(error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `failures.push(error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  const closeResources = async () => {
    const failures: unknown[] = [];
    try {
      await resources.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await flushMetadata();
    } catch (error) {
      failures.push(error);
    }
    // 资源清理或元数据落盘未确认时，不交还目录归属，避免另一个宿主接管未收尾状态。
    if (!failures.length) {
      const pending = hostRuntime
        .snapshot()
        .resources.filter((resource) => resource.id !== dataOwner?.resourceId);
      if (pending.length)
        failures.push(
          new AppError(`仍有 ${pending.length} 项资源未确认释放`, 503, 'RESOURCE_CLEANUP_PENDING'),
        );
    }
    if (!failures.length) {
      try {
        await dataOwner?.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        hostRuntime.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Host resources require cleanup');
  };
  try {
    dataOwner = await DataDirectoryOwner.acquire(DATA);
    resources.defer('host-admission-drain', () => hostRuntime.beginDrain(), ClosePhase.admission);
    resources.defer('scheduler-drain', () => scheduler.beginDrain(), ClosePhase.admission);
    resources.own('scheduler', scheduler, ClosePhase.plugins + 1);
    resources.defer('compute-drain', () => computeRuntime.beginDrain(), ClosePhase.admission);
    resources.own('compute', computeRuntime, ClosePhase.plugins + 2);
    resources.defer('network-drain', () => networkRuntime.beginDrain(), ClosePhase.admission);
    resources.own('network', networkRuntime, ClosePhase.transport);
    await networkRuntime.start();
    const services = await createApplicationServices(resources, plugins);
    const { engine } = services;
    await startApplicationHttp(services, resources);
    console.log(`Sakura → http://127.0.0.1:${PORT}\n${engine.version} · PosixLoom Native Host`);
    let closing = false;
    /**
     * 入口 / Entry: startApplication.close.
     * 功能：在组织宿主资源、领域服务及 HTTP 的启动与关闭中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`application.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `application.ts`; this entry produces `void` for its caller. Module context: Coordinates host resources, domain services and HTTP startup/shutdown; retains data-directory ownership until cleanup is confirmed.
     * 处理：通过 `closeResources`, `process.exit` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `closeResources`, `process.exit`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `closing`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `closeResources`; 更新 / updates `closing`, `failed`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 `failed = true;`; `console.error('Shutdown cleanup failed:', error);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `failed = true;`; `console.error('Shutdown cleanup failed:', error);`; these statements determine whether a failure is absorbed or rejected again.
     */
    async function close() {
      if (closing) return;
      closing = true;
      console.log('Stopping managed virtual machines…');
      let failed = false;
      try {
        await closeResources();
      } catch (error) {
        failed = true;
        console.error('Shutdown cleanup failed:', error);
      }
      process.exit(failed ? 1 : 0);
    }
    process.on('SIGINT', () => void close());
    process.on('SIGTERM', () => void close());
  } catch (error) {
    try {
      await closeResources();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Application startup and cleanup failed');
    }
    throw error;
  }
}
