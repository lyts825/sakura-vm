/**
 * 模块职责：登记虚拟机访问器并生成受控运行视图，隔离内部运行对象与外部资源身份。
 * Module purpose: Registers VM access adapters and limited live views, separating internal state objects from external identities.
 */
import type { Live } from './vm-state.ts';

export type VmLive = Readonly<Pick<Live, 'status' | 'incoming' | 'accelerator' | 'startedAt' |
  'sshPort' | 'qmpPort' | 'agentPort' | 'serialPort' | 'memoryTargetMiB' | 'error'>> & {
  readonly abort: Readonly<Pick<AbortController, 'signal'>>;
};
const hosts = new WeakMap<object, object>();
const originals = new WeakMap<object, Live>();
const views = new WeakMap<Live, VmLive>();
/**
 * 入口 / Entry: registerVmAccess.
 * 功能：在登记虚拟机访问器并生成受控运行视图中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`vm-reference.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-reference.ts`; the calls and state transitions below complete the operation. Module context: Registers VM access adapters and limited live views, separating internal state objects from external identities.
 * 处理：通过 `hosts.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `hosts.set`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: port: object; host: object
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `hosts.set`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function registerVmAccess(port: object, host: object) { hosts.set(port, host); }
/**
 * 入口 / Entry: vmHostIdentity.
 * 功能：从当前输入或状态计算 `hosts.get(port) || port`，供调用方后续验证或使用。
 * Purpose: Computes `hosts.get(port) || port` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: port: object
 * 输出 / Returns: object；结果来自 / values from `hosts.get(port) || port`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function vmHostIdentity(port: object): object { return hosts.get(port) || port; }
/**
 * 入口 / Entry: vmLiveIdentity.
 * 功能：从当前输入或状态计算 `originals.get(live) || live as Live`，供调用方后续验证或使用。
 * Purpose: Computes `originals.get(live) || live as Live` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: live: Live | VmLive
 * 输出 / Returns: Live；结果来自 / values from `originals.get(live) || live as Live`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function vmLiveIdentity(live: Live | VmLive): Live { return originals.get(live) || live as Live; }
/**
 * 入口 / Entry: vmLiveView.
 * 功能：在登记虚拟机访问器并生成受控运行视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `existing` / `view` 供上层消费（`vm-reference.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-reference.ts`; this entry produces `existing` / `view` for its caller. Module context: Registers VM access adapters and limited live views, separating internal state objects from external identities.
 * 处理：通过 `views.get`, `originals.set`, `views.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `views.get`, `originals.set`, `views.set`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `existing`.
 * 输入 / Inputs: live: Live
 * 输出 / Returns: VmLive；结果来自 / values from `existing`; `view`.
 * 副作用 / Effects: `originals.set`; `views.set`; 更新 / updates `view.abort`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function vmLiveView(live: Live): VmLive {
  const existing = views.get(live); if (existing) return existing;
  const view: any = Object.create(null);
  for (const key of ['status', 'incoming', 'accelerator', 'startedAt', 'sshPort', 'qmpPort',
    'agentPort', 'serialPort', 'memoryTargetMiB', 'error'] as const)
    Object.defineProperty(view, key, { enumerable: true,
    /**
     * 入口 / Entry: vmLiveView.get.
     * 功能：从当前输入或状态计算 `live[key]`，供调用方后续验证或使用。
     * Purpose: Computes `live[key]` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `live[key]`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    get: () => live[key] });
  view.abort = Object.freeze({ signal: live.abort?.signal });
  Object.freeze(view); originals.set(view, live); views.set(live, view); return view;
}
/**
 * 入口 / Entry: isVmLiveView.
 * 功能：从当前输入或状态计算 `originals.has(value)`，供调用方后续验证或使用。
 * Purpose: Computes `originals.has(value)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: object
 * 输出 / Returns: `originals.has(value)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function isVmLiveView(value: object) { return originals.has(value); }
