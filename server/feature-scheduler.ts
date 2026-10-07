/**
 * 模块职责：把自动化功能的周期执行接入统一调度器，在关闭时注销自身调度任务。
 * Module purpose: Registers automated feature ticks with the shared scheduler and unregisters its own schedule on close.
 */
import type { FeatureSuiteV1 } from './service-contracts/v1.ts';
import { scheduler, type Scheduler, type ScheduleHandle } from './scheduler.ts';

/** The plugin owns its registration; the host scheduler owns periodic wakeups. */
export class FeatureScheduler {
  private registration: ScheduleHandle;
  /**
   * 签名 / Signature: FeatureScheduler.disable.
   * 功能：为把自动化功能的周期执行接入统一调度器声明 disable 的输入与结果契约，所属容器为 FeatureScheduler。
   * Purpose: Declares the input/result contract for disable in FeatureScheduler. Module responsibility: Registers automated feature ticks with the shared scheduler and unregisters its own schedule on close.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private disable: () => void;
  private closeTask?: Promise<void>;
  /**
   * 入口 / Entry: FeatureScheduler.constructor.
   * 功能：建立 FeatureScheduler 的把自动化功能的周期执行接入统一调度器上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the FeatureScheduler context for this module's responsibility: Registers automated feature ticks with the shared scheduler and unregisters its own schedule on close. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: suite: FeatureSuiteV1; schedules: Scheduler default=scheduler
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `schedules.register`; 更新 / updates `this.disable`, `this.registration`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `this.disable();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.disable();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  constructor(private suite: FeatureSuiteV1, schedules: Scheduler = scheduler) {
    this.disable = suite.enableBackground();
    try { this.registration = schedules.register({ owner: 'plugin:automation-scheduler', label: 'Feature suite background checks',
      intervalMs: 30_000, immediate: true, overlap: 'skip', catchUp: 'once', timeoutMs: 120_000,
      backoff: { initialMs: 30_000, maxMs: 5 * 60_000 },
      /**
       * 入口 / Entry: FeatureScheduler.constructor.run.
       * 功能：在把自动化功能的周期执行接入统一调度器中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.disable`（`FeatureScheduler`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureScheduler`; the outcome is recorded in `this.disable`. Module context: Registers automated feature ticks with the shared scheduler and unregisters its own schedule on close.
       * 处理：通过 `signal.throwIfAborted`, `this.suite.enableBackground`, `signal.addEventListener`, `this.suite.tick` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.suite.enableBackground`, `signal.addEventListener`, `this.suite.tick`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: { signal }
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `signal.addEventListener`; 更新 / updates `this.disable`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       * 收尾：退出 try 区域时始终执行 `signal.removeEventListener('abort', disable);`；这些步骤也适用于异常退出。
       * Finalization: Leaving the try region always executes `signal.removeEventListener('abort', disable);`; these steps also apply to exceptional exits.
       */
      run: async ({ signal }) => {
        signal.throwIfAborted();
        this.disable = this.suite.enableBackground();
        const disable = this.disable;
        signal.addEventListener('abort', disable, { once: true });
        try { await this.suite.tick(); }
        finally { signal.removeEventListener('abort', disable); }
      } }); }
    catch (error) { this.disable(); throw error; }
  }
  /**
   * 入口 / Entry: FeatureScheduler.close.
   * 功能：在把自动化功能的周期执行接入统一调度器中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closeTask ||= (async () => { this.disable(); await this.registration.close(); })().catch((error) => { this.closeTask = u…` 供上层消费（`FeatureScheduler`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `FeatureScheduler`; this entry produces `this.closeTask ||= (async () => { this.disable(); await this.registration.close(); })().catch((error) => { this.closeTask = u…` for its caller. Module context: Registers automated feature ticks with the shared scheduler and unregisters its own schedule on close.
   * 处理：通过 `inline().catch`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline().catch`, `inline`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `this.closeTask ||= (async () => { this.disable(); await this.registration.close(); })().catch((error) => { this.closeTask = u…`.
   * 副作用 / Effects: 更新 / updates `this.closeTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close(): Promise<void> {
    return this.closeTask ||= (async () => {
      this.disable();
      await this.registration.close();
    })().catch((error) => { this.closeTask = undefined; throw error; });
  }
}
