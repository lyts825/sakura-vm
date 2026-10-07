/**
 * 模块职责：登记项目准备租约，终端或命令资源未释放时阻止改变目录与网络配置。
 * Module purpose: Registers project preparation leases, blocking directory/network changes until original command/terminal resources release.
 */
import { AppError } from '../shared/errors.ts';
import { vmHostIdentity } from './vm-reference.ts';

export type PreparationLease = {
  vmId: string; projectId: string; task: boolean; terminalId?: string;
  finished: Promise<void>;
  /**
   * 签名 / Signature: PreparationLease.release.
   * 功能：为登记项目准备租约声明 release 的输入与结果契约，所属容器为 PreparationLease。
   * Purpose: Declares the input/result contract for release in PreparationLease. Module responsibility: Registers project preparation leases, blocking directory/network changes until original command/terminal resources release.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void | Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  release: () => void | Promise<void>;
};
const prepared = new WeakMap<object, Set<PreparationLease>>();
/**
 * 入口 / Entry: preparationLeases.
 * 功能：在登记项目准备租约中，执行此领域的具体处理步骤并返回其结果；本入口产生 `leases` 供上层消费（`project-preparation-registry.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-preparation-registry.ts`; this entry produces `leases` for its caller. Module context: Registers project preparation leases, blocking directory/network changes until original command/terminal resources release.
 * 处理：通过 `vmHostIdentity`, `prepared.get`, `prepared.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `vmHostIdentity`, `prepared.get`, `prepared.set`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!leases`.
 * 输入 / Inputs: host: object
 * 输出 / Returns: `leases`.
 * 副作用 / Effects: `prepared.set`; 更新 / updates `leases`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function preparationLeases(host: object) {
  const identity = vmHostIdentity(host);
  let leases = prepared.get(identity); if (!leases) prepared.set(identity, leases = new Set());
  return leases;
}
/**
 * 入口 / Entry: assertProjectPreparationIdle.
 * 功能：在登记项目准备租约中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`project-preparation-registry.ts`）。
 * Purpose: Checks admission, input or resource ownership in `project-preparation-registry.ts`; the calls and state transitions below complete the operation. Module context: Registers project preparation leases, blocking directory/network changes until original command/terminal resources release.
 * 处理：通过 `inline.some`, `preparationLeases` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.some`, `preparationLeases`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: host: object; vmId: string; projectId: string
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `[...preparationLeases(host)].some(lease => lease.vmId === vmId && lease.projectId === projectId)`; 异常 / errors `new AppError('请先结束此项目的终端或命令，并等待原连接和准备资源释放', 409, 'PROJECT_DIRECTORY_RUNS_MUST_STOP')`.
 */
export function assertProjectPreparationIdle(host: object, vmId: string, projectId: string) {
  if ([...preparationLeases(host)].some(lease => lease.vmId === vmId && lease.projectId === projectId))
    throw new AppError('请先结束此项目的终端或命令，并等待原连接和准备资源释放', 409, 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
}
