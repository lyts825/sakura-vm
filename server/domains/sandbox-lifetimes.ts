/**
 * 模块职责：追踪沙箱到期与终止，拒绝对已过期沙箱继续变更，并保留失败清理结果。
 * Module purpose: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
 */
import type { VMRecord } from '../../shared/contracts/vm.ts';
import { sandboxExpired } from '../../shared/sandbox.ts';
import { AppError } from '../../shared/errors.ts';

export type SandboxLifetimePorts = {
  /**
   * 签名 / Signature: SandboxLifetimePorts.records.
   * 功能：为追踪沙箱到期与终止声明 records 的输入与结果契约，所属容器为 SandboxLifetimePorts。
   * Purpose: Declares the input/result contract for records in SandboxLifetimePorts. Module responsibility: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Iterable<VMRecord>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  records(): Iterable<VMRecord>;
  /**
   * 签名 / Signature: SandboxLifetimePorts.get.
   * 功能：为追踪沙箱到期与终止声明 get 的输入与结果契约，所属容器为 SandboxLifetimePorts。
   * Purpose: Declares the input/result contract for get in SandboxLifetimePorts. Module responsibility: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
   * 输入 / Inputs: id: string
   * 输出 / Returns: VMRecord.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  get(id: string): VMRecord;
  /**
   * 签名 / Signature: SandboxLifetimePorts.live.
   * 功能：为追踪沙箱到期与终止声明 live 的输入与结果契约，所属容器为 SandboxLifetimePorts。
   * Purpose: Declares the input/result contract for live in SandboxLifetimePorts. Module responsibility: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
   * 输入 / Inputs: id: string
   * 输出 / Returns: { bootAbort: AbortController; abort: AbortController; done: Promise<unknown> } | undefined.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  live(id: string): { bootAbort: AbortController; abort: AbortController; done: Promise<unknown> } | undefined;
  /**
   * 签名 / Signature: SandboxLifetimePorts.closing.
   * 功能：为追踪沙箱到期与终止声明 closing 的输入与结果契约，所属容器为 SandboxLifetimePorts。
   * Purpose: Declares the input/result contract for closing in SandboxLifetimePorts. Module responsibility: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  closing(): boolean;
  /**
   * 签名 / Signature: SandboxLifetimePorts.maintenance.
   * 功能：为追踪沙箱到期与终止声明 maintenance 的输入与结果契约，所属容器为 SandboxLifetimePorts。
   * Purpose: Declares the input/result contract for maintenance in SandboxLifetimePorts. Module responsibility: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  maintenance(): boolean;
  /**
   * 签名 / Signature: SandboxLifetimePorts.busy.
   * 功能：为追踪沙箱到期与终止声明 busy 的输入与结果契约，所属容器为 SandboxLifetimePorts。
   * Purpose: Declares the input/result contract for busy in SandboxLifetimePorts. Module responsibility: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
   * 输入 / Inputs: id: string
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  busy(id: string): boolean;
  /**
   * 签名 / Signature: SandboxLifetimePorts.remove.
   * 功能：为追踪沙箱到期与终止声明 remove 的输入与结果契约，所属容器为 SandboxLifetimePorts。
   * Purpose: Declares the input/result contract for remove in SandboxLifetimePorts. Module responsibility: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
   * 输入 / Inputs: id: string; allowIncident: boolean
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  remove(id: string, allowIncident: boolean): Promise<void>;
  /**
   * 签名 / Signature: SandboxLifetimePorts.log.
   * 功能：为追踪沙箱到期与终止声明 log 的输入与结果契约，所属容器为 SandboxLifetimePorts。
   * Purpose: Declares the input/result contract for log in SandboxLifetimePorts. Module responsibility: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
   * 输入 / Inputs: id: string; data: string
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  log(id: string, data: string): void;
};

/** Host authority for sandbox deadlines, including rescue guests and disabled UI plugins. */
export class SandboxLifetimes {
  private timer?: ReturnType<typeof setInterval>;
  private sweep?: Promise<void>;
  private closed = false;
  /**
   * 入口 / Entry: SandboxLifetimes.constructor.
   * 功能：建立 SandboxLifetimes 的追踪沙箱到期与终止上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SandboxLifetimes context for this module's responsibility: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: ports: SandboxLifetimePorts
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private readonly ports: SandboxLifetimePorts) {}
  /**
   * 入口 / Entry: SandboxLifetimes.watch.
   * 功能：在追踪沙箱到期与终止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`SandboxLifetimes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SandboxLifetimes`; this entry produces `void` for its caller. Module context: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
   * 处理：通过 `this.ports.closing`, `setInterval`, `this.timer.unref` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ports.closing`, `setInterval`, `this.timer.unref`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.timer || this.closed || this.ports.closing()`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `setInterval`; 更新 / updates `this.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  watch() {
    if (this.timer || this.closed || this.ports.closing()) return;
    this.timer = setInterval(() => void this.expire(), 1000);
    this.timer.unref();
  }
  // Host-side enforcement remains active even when the optional UI plugin is disabled.
  /**
   * 入口 / Entry: SandboxLifetimes.expire.
   * 功能：在追踪沙箱到期与终止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.sweep || Promise.resolve()` / `this.sweep` 供上层消费（`SandboxLifetimes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SandboxLifetimes`; this entry produces `this.sweep || Promise.resolve()` / `this.sweep` for its caller. Module context: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
   * 处理：通过 `Promise.resolve`, `inline().finally`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.resolve`, `inline().finally`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`; `this.sweep`.
   * 输入 / Inputs: now: default=Date.now()
   * 输出 / Returns: Promise<void>；结果来自 / values from `this.sweep || Promise.resolve()`; `this.sweep`.
   * 副作用 / Effects: 更新 / updates `this.sweep`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  expire(now = Date.now()): Promise<void> {
    if (this.closed) return this.sweep || Promise.resolve();
    if (this.sweep) return this.sweep;
    /**
     * 入口 / Entry: SandboxLifetimes.expire.callback@34.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    this.sweep = (async () => {
      const expired = [...this.ports.records()].filter(
        (vm) => vm.sandbox && sandboxExpired(vm.sandbox, now),
      );
      await Promise.all(
        expired.map(async (vm) => {
          if (this.ports.closing()) return;
          try {
            await this.terminate(vm.id);
            if (vm.sandbox!.onExpire === 'delete' && !this.ports.maintenance() && !this.ports.busy(vm.id))
              await this.ports.remove(vm.id, !!vm.rescueOf);
          } catch (error) {
            this.ports.log(vm.id, '\r\n沙箱到期清理失败：' + String(error) + '\r\n');
          }
        }),
      );
    })().finally(() => {
      this.sweep = undefined;
    });
    return this.sweep;
  }
  /**
   * 入口 / Entry: SandboxLifetimes.terminate.
   * 功能：在追踪沙箱到期与终止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`SandboxLifetimes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SandboxLifetimes`; this entry produces `void` for its caller. Module context: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
   * 处理：通过 `this.ports.get`, `this.ports.live`, `live.bootAbort.abort`, `live.abort.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ports.get`, `this.ports.live`, `live.bootAbort.abort`, `live.abort.abort`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!live`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `live.bootAbort.abort`; `live.abort.abort`.
   * 拒绝 / Refusals: 条件 / conditions `!this.ports.get(id).sandbox`; 异常 / errors `new AppError('该实例不是沙箱', 409)`.
   */
  async terminate(id: string) {
    if (!this.ports.get(id).sandbox) throw new AppError('该实例不是沙箱', 409);
    const live = this.ports.live(id);
    if (!live) return;
    // Cancellation must not wait on a guest command or an unrelated instance lock.
    live.bootAbort.abort();
    live.abort.abort();
    await live.done;
  }
  /**
   * 入口 / Entry: SandboxLifetimes.requireLifetime.
   * 功能：在追踪沙箱到期与终止中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`SandboxLifetimes`）。
   * Purpose: Checks admission, input or resource ownership in `SandboxLifetimes`; the calls and state transitions below complete the operation. Module context: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
   * 处理：通过 `sandboxExpired` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `sandboxExpired`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vm: VMRecord
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `vm.sandbox && sandboxExpired(vm.sandbox)`; 异常 / errors `new AppError('沙箱已到期，请销毁后创建新沙箱', 409, 'SANDBOX_EXPIRED')`.
   */
  requireLifetime(vm: VMRecord) {
    if (vm.sandbox && sandboxExpired(vm.sandbox))
      throw new AppError('沙箱已到期，请销毁后创建新沙箱', 409, 'SANDBOX_EXPIRED');
  }
  /**
   * 入口 / Entry: SandboxLifetimes.requireMutable.
   * 功能：在追踪沙箱到期与终止中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`SandboxLifetimes`）。
   * Purpose: Checks admission, input or resource ownership in `SandboxLifetimes`; the calls and state transitions below complete the operation. Module context: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
   * 输入 / Inputs: vm: VMRecord
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `vm.sandbox`; 异常 / errors `new AppError('沙箱资源和网络策略创建后不可修改，请创建新沙箱', 409, 'SANDBOX_POLICY_LOCKED')`.
   */
  requireMutable(vm: VMRecord) {
    if (vm.sandbox)
      throw new AppError('沙箱资源和网络策略创建后不可修改，请创建新沙箱', 409, 'SANDBOX_POLICY_LOCKED');
  }

  /**
   * 入口 / Entry: SandboxLifetimes.close.
   * 功能：在追踪沙箱到期与终止中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`, `this.timer`（`SandboxLifetimes`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SandboxLifetimes`; the outcome is recorded in `this.closed`, `this.timer`. Module context: Tracks sandbox expiry and termination, rejecting changes after expiry and retaining failed cleanup evidence.
   * 处理：通过 `clearInterval` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `clearInterval`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `clearInterval`; 更新 / updates `this.closed`, `this.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.timer = undefined;
    await this.sweep;
  }
}
