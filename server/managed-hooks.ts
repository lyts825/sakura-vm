/**
 * 模块职责：登记并分派受管生命周期钩子，让不同领域参与同一事件边界。
 * Module purpose: Registers/distributes managed lifecycle hooks so separate domains participate in shared event boundaries.
 */
import { randomUUID } from 'node:crypto';
import { pluginAuthority, withPluginAuthority } from './plugin-authority.ts';
import { cleanupReceipt } from './cleanup-receipt.ts';

/** 每份注销回执只删除自己登记的回调，插件撤销不能误删后来注册的钩子。 */
export class ManagedHooks<A extends unknown[]> {
  private callbacks = new Map<string, {
  /**
   * 签名 / Signature: ManagedHooks.run.
   * 功能：为登记并分派受管生命周期钩子声明 run 的输入与结果契约，所属容器为 ManagedHooks。
   * Purpose: Declares the input/result contract for run in ManagedHooks. Module responsibility: Registers/distributes managed lifecycle hooks so separate domains participate in shared event boundaries.
   * 输入 / Inputs: args: A
   * 输出 / Returns: Promise<void> | void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  run: (...args: A) => Promise<void> | void;
  /**
   * 签名 / Signature: ManagedHooks.active.
   * 功能：为登记并分派受管生命周期钩子声明 active 的输入与结果契约，所属容器为 ManagedHooks。
   * Purpose: Declares the input/result contract for active in ManagedHooks. Module responsibility: Registers/distributes managed lifecycle hooks so separate domains participate in shared event boundaries.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  active: () => boolean }>();
  /**
   * 入口 / Entry: ManagedHooks.register.
   * 功能：在登记并分派受管生命周期钩子中，执行此领域的具体处理步骤并返回其结果；本入口产生 `unregister` 供上层消费（`ManagedHooks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ManagedHooks`; this entry produces `unregister` for its caller. Module context: Registers/distributes managed lifecycle hooks so separate domains participate in shared event boundaries.
   * 处理：通过 `pluginAuthority`, `randomUUID`, `instance.check`, `instance.contribute` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `pluginAuthority`, `randomUUID`, `instance.check`, `instance.contribute`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `instance`.
   * 输入 / Inputs: run: (...args: A) => Promise<void> | void
   * 输出 / Returns: () => void；结果来自 / values from `unregister`.
   * 副作用 / Effects: `this.callbacks.set`; `instance.signal.addEventListener`; `instance.scope.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  register(run: (...args: A) => Promise<void> | void): () => void {
    const instance = pluginAuthority(), id = randomUUID();
    instance?.check('events', true);
    const removeContribution = instance?.contribute('interceptor', id);
    this.callbacks.set(id, {
    /**
     * 入口 / Entry: ManagedHooks.register.run.
     * 功能：在登记并分派受管生命周期钩子中，执行此领域的具体处理步骤并返回其结果；本入口产生 `instance ? withPluginAuthority(instance, () => run(...args)) : run(...args)` 供上层消费（`ManagedHooks`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ManagedHooks`; this entry produces `instance ? withPluginAuthority(instance, () => run(...args)) : run(...args)` for its caller. Module context: Registers/distributes managed lifecycle hooks so separate domains participate in shared event boundaries.
     * 处理：通过 `withPluginAuthority`, `run` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `withPluginAuthority`, `run`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: args
     * 输出 / Returns: `instance ? withPluginAuthority(instance, () => run(...args)) : run(...args)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    run: (...args) => instance ? withPluginAuthority(instance, () => run(...args)) : run(...args),
      /**
       * 入口 / Entry: ManagedHooks.register.active.
       * 功能：从当前输入或状态计算 `!instance || instance.phase === 'running' && !instance.signal.aborted`，供调用方后续验证或使用。
       * Purpose: Computes `!instance || instance.phase === 'running' && !instance.signal.aborted` from current inputs/state for the caller to validate or consume.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `!instance || instance.phase === 'running' && !instance.signal.aborted`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      active: () => !instance || instance.phase === 'running' && !instance.signal.aborted });
    const unregister = cleanupReceipt(() => { this.callbacks.delete(id); removeContribution?.(); });
    if (instance) {
      instance.signal.addEventListener('abort', unregister, { once: true });
      instance.scope.add(() => { unregister(); instance.signal.removeEventListener('abort', unregister); });
    }
    return unregister;
  }
  /**
   * 入口 / Entry: ManagedHooks.dispatch.
   * 功能：在登记并分派受管生命周期钩子中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ManagedHooks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ManagedHooks`; the calls and state transitions below complete the operation. Module context: Registers/distributes managed lifecycle hooks so separate domains participate in shared event boundaries.
   * 处理：通过 `this.callbacks.values`, `callback.active`, `callback.run` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.callbacks.values`, `callback.active`, `callback.run`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `callback.active()`.
   * 输入 / Inputs: args: A
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async dispatch(...args: A) {
    for (const callback of [...this.callbacks.values()]) if (callback.active()) await callback.run(...args);
  }
  /**
   * 入口 / Entry: ManagedHooks.size.
   * 功能：向调用者提供 `this.callbacks.size` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.callbacks.size` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.callbacks.size`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get size() { return this.callbacks.size; }
}
