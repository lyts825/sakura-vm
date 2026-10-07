/**
 * 模块职责：统计请求及后台操作的活动数量，并在请求中断时发出作用域取消信号。
 * Module purpose: Counts active request/background operations and emits cancellation when a request disconnects prematurely.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/** 请求和后台工作共用的活动计数；退出闭包幂等，避免重复释放把计数减为负数。 */
export class OperationTracker {
  active = 0;
  /**
   * 入口 / Entry: OperationTracker.change.
   * 功能：在统计请求及后台操作的活动数量中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.active`（`OperationTracker`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationTracker`; the outcome is recorded in `this.active`. Module context: Counts active request/background operations and emits cancellation when a request disconnects prematurely.
   * 输入 / Inputs: delta: number
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.active`.
   */
  change(delta: number) {
    this.active += delta;
  }
  /**
   * 入口 / Entry: OperationTracker.enter.
   * 功能：从当前输入或状态计算 `() => { if (!released) { released = true; this.active--; } }`，供调用方后续验证或使用。
   * Purpose: Computes `() => { if (!released) { released = true; this.active--; } }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `() => { if (!released) { released = true; this.active--; } }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  enter() {
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }
  /**
   * 入口 / Entry: OperationTracker.run.
   * 功能：在统计请求及后台操作的活动数量中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await work()` 供上层消费（`OperationTracker`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationTracker`; this entry produces `await work()` for its caller. Module context: Counts active request/background operations and emits cancellation when a request disconnects prematurely.
   * 处理：通过 `this.enter`, `work`, `release` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.enter`, `work`, `release`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => T | Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `await work()`.
   * 副作用 / Effects: `release`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `release();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `release();`; these steps also apply to exceptional exits.
   */
  async run<T>(work: () => T | Promise<T>): Promise<T> {
    const release = this.enter();
    try {
      return await work();
    } finally {
      release();
    }
  }
}

/** 响应正常写完不触发取消；调用方结束时必须 dispose，移除当前请求的断开监听。 */
/**
 * 入口 / Entry: requestScope.
 * 功能：在统计请求及后台操作的活动数量中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ controller, signal: controller.signal, dispose() { req.off('aborted', disconnected); res.off('close', disconnected); }, }` 供上层消费（`operation-scope.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-scope.ts`; this entry produces `{ controller, signal: controller.signal, dispose() { req.off('aborted', disconnected); res.off('close', disconnected); }, }` for its caller. Module context: Counts active request/background operations and emits cancellation when a request disconnects prematurely.
 * 处理：通过 `req.once`, `res.once`, `controller.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `req.once`, `res.once`, `controller.abort`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `req.aborted || res.destroyed`.
 * 输入 / Inputs: req: IncomingMessage; res: ServerResponse
 * 输出 / Returns: `{ controller, signal: controller.signal, dispose() { req.off('aborted', disconnected); res.off('close', disconnected); }, }`.
 * 副作用 / Effects: `controller.abort`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function requestScope(req: IncomingMessage, res: ServerResponse) {
  const controller = new AbortController();
  /**
   * 入口 / Entry: requestScope.disconnected.
   * 功能：在统计请求及后台操作的活动数量中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`operation-scope.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-scope.ts`; the calls and state transitions below complete the operation. Module context: Counts active request/background operations and emits cancellation when a request disconnects prematurely.
   * 处理：通过 `controller.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `controller.abort`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!res.writableFinished`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `controller.abort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const disconnected = () => {
    if (!res.writableFinished) controller.abort();
  };
  req.once('aborted', disconnected);
  res.once('close', disconnected);
  if (req.aborted || res.destroyed) controller.abort();
  return {
    controller,
    signal: controller.signal,
    /**
     * 入口 / Entry: requestScope.dispose.
     * 功能：在统计请求及后台操作的活动数量中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`operation-scope.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `operation-scope.ts`; the calls and state transitions below complete the operation. Module context: Counts active request/background operations and emits cancellation when a request disconnects prematurely.
     * 处理：通过 `req.off`, `res.off` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `req.off`, `res.off`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose() {
      req.off('aborted', disconnected);
      res.off('close', disconnected);
    },
  };
}
