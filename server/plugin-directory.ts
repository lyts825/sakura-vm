/**
 * 模块职责：维护插件实例与期望状态目录，原实例清理未确认时拒绝覆盖其运行归属。
 * Module purpose: Tracks desired/current plugin instances, refusing replacement until original cleanup is confirmed.
 */
import { AppError } from '../shared/errors.ts';
import type { PluginSource } from '../shared/contracts/plugin-runtime.ts';
import { PluginInstance } from './plugin-instance.ts';

/** Shared by trusted modules, system services and the signed WASM adapter. */
export class PluginDirectory {
  private instances = new Map<string, PluginInstance>();
  private desired = new Set<string>();
  private revision = 0;
  private listeners = new Set<
  /**
   * 中文功能：当前插件目录身份或启用状态变化的订阅通知。
   * English: Subscription notification for current plugin-directory identity/enabled-state changes.
   * 所属 / Owner: PluginDirectory.listeners.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void`.
   */
  () => void>();
  /**
   * 入口 / Entry: PluginDirectory.subscribe.
   * 功能：从当前输入或状态计算 `() => this.listeners.delete(listener)`，供调用方后续验证或使用。
   * Purpose: Computes `() => this.listeners.delete(listener)` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: listener: () => void
   * 输出 / Returns: `() => this.listeners.delete(listener)`.
   * 副作用 / Effects: `this.listeners.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /**
   * 入口 / Entry: PluginDirectory.setDesired.
   * 功能：在维护插件实例与期望状态目录中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `instance.desired`（`PluginDirectory`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginDirectory`; the outcome is recorded in `instance.desired`. Module context: Tracks desired/current plugin instances, refusing replacement until original cleanup is confirmed.
   * 处理：通过 `key.startsWith`, `this.desired.delete`, `this.desired.add`, `this.instances.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `key.startsWith`, `this.desired.delete`, `this.desired.add`, `this.instances.values`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `key.startsWith(source + ':')`; `instance.source === source`.
   * 输入 / Inputs: source: PluginSource; ids: Iterable<string>
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `key.startsWith`; `this.desired.delete`; `this.desired.add`; 更新 / updates `instance.desired`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  setDesired(source: PluginSource, ids: Iterable<string>) {
    for (const key of [...this.desired]) if (key.startsWith(source + ':')) this.desired.delete(key);
    for (const id of ids) this.desired.add(`${source}:${id}`);
    for (const instance of this.instances.values())
      if (instance.source === source) instance.desired = this.desired.has(instance.identity);
    this.changed();
  }
  /**
   * 入口 / Entry: PluginDirectory.begin.
   * 功能：在维护插件实例与期望状态目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `instance` 供上层消费（`PluginDirectory`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginDirectory`; this entry produces `instance` for its caller. Module context: Tracks desired/current plugin instances, refusing replacement until original cleanup is confirmed.
   * 处理：通过 `this.instances.get`, `inline.includes`, `this.desired.has`, `this.instances.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.instances.get`, `inline.includes`, `this.desired.has`, `this.instances.set`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: source: PluginSource; id: string; version: string; digest: string; permissions: readonly string[] optional; generation: string optional
   * 输出 / Returns: `instance`.
   * 副作用 / Effects: `this.instances.set`; 更新 / updates `instance.desired`.
   * 拒绝 / Refusals: 条件 / conditions `previous && !['inactive', 'failed', 'skipped'].includes(previous.phase)`; 异常 / errors `new AppError('原插件实例尚未确认清理', 409, 'PLUGIN_CLEANUP_PENDING')`.
   */
  begin(
    source: PluginSource,
    id: string,
    version: string,
    digest: string,
    permissions?: readonly string[],
    generation?: string,
  ) {
    const key = `${source}:${id}`,
      previous = this.instances.get(key);
    if (previous && !['inactive', 'failed', 'skipped'].includes(previous.phase))
      throw new AppError('原插件实例尚未确认清理', 409, 'PLUGIN_CLEANUP_PENDING');
    const instance = new PluginInstance(source, id, version, digest, permissions, generation, () =>
      this.changed(),
    );
    instance.desired = source === 'system' || this.desired.has(key);
    this.instances.set(key, instance);
    this.changed();
    return instance;
  }
  /**
   * 入口 / Entry: PluginDirectory.get.
   * 功能：把本层请求转交 `this.instances.get`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.instances.get` and propagates the provider result or rejection.
   * 输入 / Inputs: source: PluginSource; id: string
   * 输出 / Returns: `this.instances.get(`${source}:${id}`)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  get(source: PluginSource, id: string) {
    return this.instances.get(`${source}:${id}`);
  }
  /**
   * 入口 / Entry: PluginDirectory.all.
   * 功能：从当前输入或状态计算 `[...this.instances.values()]`，供调用方后续验证或使用。
   * Purpose: Computes `[...this.instances.values()]` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `[...this.instances.values()]`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  all() {
    return [...this.instances.values()];
  }
  /**
   * 入口 / Entry: PluginDirectory.publish.
   * 功能：在维护插件实例与期望状态目录中，校验并提交领域状态变更；处理结果记录到 `instance.phase`（`PluginDirectory`）。
   * Purpose: Validates and commits a domain state change in `PluginDirectory`; the outcome is recorded in `instance.phase`. Module context: Tracks desired/current plugin instances, refusing replacement until original cleanup is confirmed.
   * 处理：通过 `instance.check`, `this.changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `instance.check`, `this.changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: instance: PluginInstance
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `instance.phase`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  publish(instance: PluginInstance) {
    instance.check(undefined, true);
    instance.phase = 'running';
    this.changed();
  }
  /**
   * 入口 / Entry: PluginDirectory.changed.
   * 功能：在维护插件实例与期望状态目录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`PluginDirectory`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginDirectory`; the calls and state transitions below complete the operation. Module context: Tracks desired/current plugin instances, refusing replacement until original cleanup is confirmed.
   * 处理：通过 `listener` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `listener`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `listener`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  changed() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  /**
   * 入口 / Entry: PluginDirectory.view.
   * 功能：在维护插件实例与期望状态目录中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ version: this.revision, instances: this.all().map((instance) => instance.view()) }` 供上层消费（`PluginDirectory`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `PluginDirectory`; this entry produces `{ version: this.revision, instances: this.all().map((instance) => instance.view()) }` for its caller. Module context: Tracks desired/current plugin instances, refusing replacement until original cleanup is confirmed.
   * 处理：通过 `this.all().map`, `this.all` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.all().map`, `this.all`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ version: this.revision, instances: this.all().map((instance) => instance.view()) }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view() {
    return { version: this.revision, instances: this.all().map((instance) => instance.view()) };
  }
}
