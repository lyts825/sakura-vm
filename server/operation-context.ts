/**
 * 模块职责：传递当前操作检查和审计失败观察者，允许清理路径脱离已失效的用户操作上下文。
 * Module purpose: Propagates operation checks and audit-failure observers; cleanup may exit revoked user-operation context.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 签名 / Signature: OperationCheck.OperationCheck.
 * 功能：为传递当前操作检查和审计失败观察者声明 OperationCheck 的输入与结果契约，所属容器为 OperationCheck。
 * Purpose: Declares the input/result contract for OperationCheck in OperationCheck. Module responsibility: Propagates operation checks and audit-failure observers; cleanup may exit revoked user-operation context.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
type OperationCheck = () => Promise<void>;
const checks = new AsyncLocalStorage<OperationCheck>();
const auditObservers = new AsyncLocalStorage<
/**
 * 中文功能：观察当前操作审计状态变化的无参数通知。
 * English: No-argument notification observing audit-state changes of the current operation.
 * 所属 / Owner: auditObservers.
 * 输入 / Inputs: 无显式参数 / no explicit parameters.
 * 结果 / Result: `void`.
 */
() => void>();

/** Observe audit failures for this invocation even if the business throws a primitive. */
/**
 * 入口 / Entry: withAuditFailureObserver.
 * 功能：在当前异步调用链绑定审计失败观察者，使原始类型的业务异常也可关联审计失败。
 * Purpose: Binds an audit-failure observer to the asynchronous chain so primitive business exceptions can still be associated with audit failure.
 * 输入 / Inputs: observer: () => void; work: () => T
 * 输出 / Returns: T；结果来自 / values from `auditObservers.run(observer, work)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function withAuditFailureObserver<T>(observer: () => void, work: () => T): T {
  return auditObservers.run(observer, work);
}
/**
 * 入口 / Entry: reportAuditFailure.
 * 功能：通知当前调用链登记的审计失败观察者，没有观察者时无操作。
 * Purpose: Notifies the audit-failure observer registered on the current chain, doing nothing when absent.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function reportAuditFailure() {
  auditObservers.getStore()?.();
}

/** Capture at admission, before a queue or a different owner's callback can change context. */
/**
 * 入口 / Entry: captureOperationCheck.
 * 功能：捕获准入时的操作检查，返回在原调用链之外仍执行原检查的闭包。
 * Purpose: Captures the admission-time operation check and returns a closure that still runs that original check outside the original call chain.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: OperationCheck；结果来自 / values from `check ? () => checks.exit(check) : async () => {}`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function captureOperationCheck(): OperationCheck {
  const check = checks.getStore();
  return check ? () => checks.exit(check) : async () => {};
}

/**
 * 入口 / Entry: withOperationCheck.
 * 功能：把本次操作检查与父检查按顺序组合，并在该检查上下文运行处理器。
 * Purpose: Composes the current operation check after its parent check and runs the handler in that check context.
 * 输入 / Inputs: check: OperationCheck; work: () => T
 * 输出 / Returns: T；结果来自 / values from `checks.run(parent ? async () => { await parent(); await check(); } : check, work)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function withOperationCheck<T>(check: OperationCheck, work: () => T): T {
  const parent = checks.getStore();
  return checks.run(parent ? async () => { await parent(); await check(); } : check, work);
}

/** Independently owned schedulers and recovery domains establish their own authority. */
/**
 * 入口 / Entry: withoutOperationContext.
 * 功能：退出当前用户操作检查上下文，让独立调度或原资源清理建立自身权限。
 * Purpose: Exits the current user-operation check context so independent schedulers or original-resource cleanup can establish their own authority.
 * 输入 / Inputs: work: () => T
 * 输出 / Returns: T；结果来自 / values from `checks.exit(work)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function withoutOperationContext<T>(work: () => T): T {
  return checks.exit(work);
}
