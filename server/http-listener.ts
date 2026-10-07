/**
 * 模块职责：启动 HTTP 监听并管理监听阶段的错误与取消，避免未就绪服务遗留监听句柄。
 * Module purpose: Opens HTTP listeners with startup error/cancellation handling so failed readiness does not leak listening handles.
 */
import type { Server } from 'node:http';

/** Make binding failures part of application startup and its cleanup path. */
/**
 * 入口 / Entry: listenHttpServer.
 * 功能：从当前输入或状态计算 `new Promise((resolve, reject) => { const cleanup = () => { server.off('error', failed); server.off('listening', ready); }; co…`，供调用方后续验证或使用。
 * Purpose: Computes `new Promise((resolve, reject) => { const cleanup = () => { server.off('error', failed); server.off('listening', ready); }; co…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: server: Server; port: number; host: string
 * 输出 / Returns: Promise<void>；结果来自 / values from `new Promise((resolve, reject) => { const cleanup = () => { server.off('error', failed); server.off('listening', ready); }; co…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function listenHttpServer(server: Server, port: number, host: string): Promise<void> {
  /**
   * 入口 / Entry: listenHttpServer.callback@8.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: resolve; reject
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `server.listen`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `cleanup();`; `reject(error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `cleanup();`; `reject(error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  return new Promise((resolve, reject) => {
    /**
     * 入口 / Entry: listenHttpServer.cleanup.
     * 功能：在启动 HTTP 监听并管理监听阶段的错误与取消中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`http-listener.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `http-listener.ts`; the calls and state transitions below complete the operation. Module context: Opens HTTP listeners with startup error/cancellation handling so failed readiness does not leak listening handles.
     * 处理：通过 `server.off` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `server.off`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const cleanup = () => {
      server.off('error', failed);
      server.off('listening', ready);
    };
    /**
     * 入口 / Entry: listenHttpServer.failed.
     * 功能：在启动 HTTP 监听并管理监听阶段的错误与取消中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`http-listener.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-listener.ts`; the calls and state transitions below complete the operation. Module context: Opens HTTP listeners with startup error/cancellation handling so failed readiness does not leak listening handles.
     * 处理：通过 `cleanup`, `reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `cleanup`, `reject`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: error: Error
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const failed = (error: Error) => {
      cleanup();
      reject(error);
    };
    /**
     * 入口 / Entry: listenHttpServer.ready.
     * 功能：在启动 HTTP 监听并管理监听阶段的错误与取消中，读取或核对领域状态并构造调用方可消费的结果；完成下述调用及状态处理（`http-listener.ts`）。
     * Purpose: Reads/verifies domain state and constructs a caller-facing result in `http-listener.ts`; the calls and state transitions below complete the operation. Module context: Opens HTTP listeners with startup error/cancellation handling so failed readiness does not leak listening handles.
     * 处理：通过 `cleanup`, `resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `cleanup`, `resolve`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const ready = () => {
      cleanup();
      resolve();
    };
    server.once('error', failed);
    server.once('listening', ready);
    try {
      server.listen(port, host);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
