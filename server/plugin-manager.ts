/**
 * 模块职责：协调插件目录、装配、卸载与清理重试，核对实例代次并发布当前管理状态。
 * Module purpose: Coordinates plugin discovery, assembly, unloading and cleanup retry against captured instance generations.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import {
  PLUGINS,
  PLUGIN_PACKS,
  emptySelection,
  type PluginSelection,
  type PluginStatus,
} from '../shared/plugins.ts';
import { migratePlugins, explainPlugins, resolvePlugins } from '../shared/plugin-selection.ts';
import { PluginDirectory } from './plugin-directory.ts';
import { PluginRuntime } from './plugin-runtime.ts';
import type { Machines } from './machines.ts';
import { SystemServices } from './system-services.ts';

const changeSchema = z
  .object({
    kind: z.enum(['plugin', 'pack']),
    id: z.string(),
    enabled: z.boolean(),
  })
  .strict();

/** The single management entry: persistent intent and live instance authority. */
export class PluginManager {
  readonly directory = new PluginDirectory();
  readonly system = new SystemServices(this.directory);
  private runtime?: PluginRuntime;
  private selection = emptySelection();
  private startupPlanned: string[] = [];
  private migrations: string[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * 入口 / Entry: PluginManager.constructor.
   * 功能：建立 PluginManager 的协调插件目录、装配、卸载与清理重试上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the PluginManager context for this module's responsibility: Coordinates plugin discovery, assembly, unloading and cleanup retry against captured instance generations. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: file: default=join(DATA, 'plugins.json')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private file = join(DATA, 'plugins.json')) {}
  /**
   * 入口 / Entry: PluginManager.init.
   * 功能：在协调插件目录、装配、卸载与清理重试中，初始化并核对当前领域状态；本入口产生 `[...this.startupPlanned]` 供上层消费（`PluginManager`）。
   * Purpose: Initializes and verifies current domain state in `PluginManager`; this entry produces `[...this.startupPlanned]` for its caller. Module context: Coordinates plugin discovery, assembly, unloading and cleanup retry against captured instance generations.
   * 处理：通过 `migratePlugins`, `readStore`, `resolvePlugins` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `migratePlugins`, `readStore`, `resolvePlugins`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `[...this.startupPlanned]`.
   * 副作用 / Effects: 更新 / updates `this.selection`, `this.migrations`, `this.startupPlanned`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    const migrated = migratePlugins(await readStore(this.file, emptySelection));
    this.selection = migrated.selection;
    this.migrations = migrated.migrations;
    this.startupPlanned = resolvePlugins(this.selection);
    return [...this.startupPlanned];
  }
  /**
   * 入口 / Entry: PluginManager.start.
   * 功能：在协调插件目录、装配、卸载与清理重试中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.runtime` 供上层消费（`PluginManager`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginManager`; this entry produces `this.runtime` for its caller. Module context: Coordinates plugin discovery, assembly, unloading and cleanup retry against captured instance generations.
   * 处理：通过 `PluginRuntime.create` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `PluginRuntime.create`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: machines: Machines; rolloutAllowed: (id: string) => boolean optional
   * 输出 / Returns: `this.runtime`.
   * 副作用 / Effects: `PluginRuntime.create`; 更新 / updates `this.runtime`.
   * 拒绝 / Refusals: 条件 / conditions `this.runtime`; 异常 / errors `new AppError('插件管理层已经启动', 409)`.
   */
  async start(machines: Machines, rolloutAllowed?: (id: string) => boolean) {
    if (this.runtime) throw new AppError('插件管理层已经启动', 409);
    this.runtime = await PluginRuntime.create(machines, this.startupPlanned, rolloutAllowed, this.directory, this.system);
    return this.runtime;
  }
  /**
   * 入口 / Entry: PluginManager.unload.
   * 功能：在协调插件目录、装配、卸载与清理重试中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`PluginManager`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginManager`; the calls and state transitions below complete the operation. Module context: Coordinates plugin discovery, assembly, unloading and cleanup retry against captured instance generations.
   * 处理：通过 `this.runtime.unload` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.runtime.unload`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async unload(id: string) { await this.runtime?.unload(id); }
  /**
   * 入口 / Entry: PluginManager.canRetryCleanup.
   * 功能：在协调插件目录、装配、卸载与清理重试中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `!!this.runtime` 供上层消费（`PluginManager`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginManager`; this entry produces `false` / `!!this.runtime` for its caller. Module context: Coordinates plugin discovery, assembly, unloading and cleanup retry against captured instance generations.
   * 处理：通过 `this.directory.all().find`, `this.directory.all`, `this.directory.get`, `this.system.ownsInstance` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.directory.all().find`, `this.directory.all`, `this.directory.get`, `this.system.ownsInstance`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!instance || instance.phase !== 'cleanup-pending' || this.system.caller.phase !== 'running'`; `instance.source === 'official' || instance === this.directory.get('system', 'terminal-backend')`; `instance.source === 'system'`.
   * 输入 / Inputs: identity: string; generation: string
   * 输出 / Returns: `false`; `!!this.runtime`; `this.system.ownsInstance(instance)`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  canRetryCleanup(identity: string, generation: string) {
    const instance = this.directory.all().find(item => item.identity === identity && item.generation === generation);
    if (!instance || instance.phase !== 'cleanup-pending' || this.system.caller.phase !== 'running') return false;
    if (instance.source === 'official' || instance === this.directory.get('system', 'terminal-backend')) return !!this.runtime;
    if (instance.source === 'system') return this.system.ownsInstance(instance);
    return this.system.has('communityPlugins');
  }
  /** Recovery only targets the exact failed activation, never the replacement plugin. */
  /**
   * 入口 / Entry: PluginManager.retryCleanup.
   * 功能：在协调插件目录、装配、卸载与清理重试中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`PluginManager`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginManager`; the calls and state transitions below complete the operation. Module context: Coordinates plugin discovery, assembly, unloading and cleanup retry against captured instance generations.
   * 处理：通过 `this.directory.all().find`, `this.directory.all`, `this.directory.get`, `this.runtime.recoverProvider` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.directory.all().find`, `this.directory.all`, `this.directory.get`, `this.runtime.recoverProvider`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `instance.source === 'official' || instance === this.directory.get('system', 'terminal-backend')`; `instance === this.system.caller`.
   * 输入 / Inputs: identity: string; generation: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.system.close`.
   * 拒绝 / Refusals: 条件 / conditions `!instance || instance.phase !== 'cleanup-pending'`; `instance.source === 'system'`; `dependent`; 异常 / errors `new AppError('原插件清理实例已变化', 409, 'RECOVERY_STALE')`; `new AppError('请先恢复依赖此服务的消费者：' + dependent.id, 409, 'SERVICE_DEPENDENTS_ACTIVE')`.
   */
  async retryCleanup(identity: string, generation: string) {
    const instance = this.directory.all().find(item => item.identity === identity && item.generation === generation);
    if (!instance || instance.phase !== 'cleanup-pending')
      throw new AppError('原插件清理实例已变化', 409, 'RECOVERY_STALE');
    if (instance.source === 'official' || instance === this.directory.get('system', 'terminal-backend'))
      await this.runtime?.recoverProvider(instance.identity, instance.generation, instance.artifactDigest);
    else if (instance.source === 'system') {
      const dependent = this.system.lifecycle.view().find(entry =>
        entry.attempted && [...entry.requires, ...entry.disposeRequires].includes(instance.pluginId) &&
        !['registered', 'disposed'].includes(entry.state));
      if (dependent) throw new AppError('请先恢复依赖此服务的消费者：' + dependent.id, 409, 'SERVICE_DEPENDENTS_ACTIVE');
      if (instance === this.system.caller) await this.system.close();
      else await this.system.retire(instance.pluginId);
    } else await this.community.recoverCleanup(instance.pluginId, generation);
    if (this.directory.get(instance.source, instance.pluginId) !== instance || instance.view().phase !== 'inactive')
      throw new AppError('原领域尚未确认清理', 503, 'RECOVERY_CLEANUP_PENDING');
  }
  /**
   * 入口 / Entry: PluginManager.community.
   * 功能：在协调插件目录、装配、卸载与清理重试中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.system.resolver(this.system.caller, ['communityPlugins']).optional('communityPlugins')!` 供上层消费（`PluginManager`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginManager`; this entry produces `this.system.resolver(this.system.caller, ['communityPlugins']).optional('communityPlugins')!` for its caller. Module context: Coordinates plugin discovery, assembly, unloading and cleanup retry against captured instance generations.
   * 处理：通过 `this.system.resolver().optional`, `this.system.resolver` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.system.resolver().optional`, `this.system.resolver`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.system.resolver(this.system.caller, ['communityPlugins']).optional('communityPlugins')!`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  get community() { return this.system.resolver(this.system.caller, ['communityPlugins']).optional('communityPlugins')!; }
  /**
   * 入口 / Entry: PluginManager.assertReady.
   * 功能：在协调插件目录、装配、卸载与清理重试中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`PluginManager`）。
   * Purpose: Checks admission, input or resource ownership in `PluginManager`; the calls and state transitions below complete the operation. Module context: Coordinates plugin discovery, assembly, unloading and cleanup retry against captured instance generations.
   * 处理：通过 `this.system.lifecycle.validateReady`, `PLUGINS.filter`, `this.system.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.system.lifecycle.validateReady`, `PLUGINS.filter`, `this.system.has`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.system.has(dependency)`; 异常 / errors `new AppError(`插件 ${plugin.id} 缺少必需宿主服务：${dependency}`, 503, 'PLUGIN_SERVICE_UNAVAILABLE')`.
   */
  assertReady() {
    this.system.lifecycle.validateReady();
    for (const plugin of PLUGINS.filter(item => this.runtime?.enabled.has(item.id)))
      for (const dependency of plugin.systemDependencies) if (!this.system.has(dependency))
        throw new AppError(`插件 ${plugin.id} 缺少必需宿主服务：${dependency}`, 503, 'PLUGIN_SERVICE_UNAVAILABLE');
  }
  /**
   * 入口 / Entry: PluginManager.close.
   * 功能：在协调插件目录、装配、卸载与清理重试中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`PluginManager`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `PluginManager`; the calls and state transitions below complete the operation. Module context: Coordinates plugin discovery, assembly, unloading and cleanup retry against captured instance generations.
   * 处理：通过 `this.runtime.close`, `this.system.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.runtime.close`, `this.system.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.runtime.close`; `this.system.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() { await this.runtime?.close(); await this.system.close(); }
  /**
   * 入口 / Entry: PluginManager.view.
   * 功能：在协调插件目录、装配、卸载与清理重试中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ selection: structuredClone(this.selection), active: this.runtime ? [...this.runtime.enabled] : [], planned, reasons: explai…` 供上层消费（`PluginManager`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `PluginManager`; this entry produces `{ selection: structuredClone(this.selection), active: this.runtime ? [...this.runtime.enabled] : [], planned, reasons: explai…` for its caller. Module context: Coordinates plugin discovery, assembly, unloading and cleanup retry against captured instance generations.
   * 处理：通过 `resolvePlugins`, `structuredClone`, `explainPlugins`, `planned.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `resolvePlugins`, `structuredClone`, `explainPlugins`, `planned.some`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: PluginStatus；结果来自 / values from `{ selection: structuredClone(this.selection), active: this.runtime ? [...this.runtime.enabled] : [], planned, reasons: explai…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(): PluginStatus {
    const planned = resolvePlugins(this.selection);
    return {
      selection: structuredClone(this.selection),
      active: this.runtime ? [...this.runtime.enabled] : [],
      planned,
      reasons: explainPlugins(this.selection),
      migrations: [...this.migrations],
      restartRequired:
        planned.length !== this.startupPlanned.length ||
        planned.some((id) => !this.startupPlanned.includes(id)),
      errors: { ...this.runtime?.errors },
      lifecycle: structuredClone(this.runtime?.lifecycle ?? {}),
      runtime: this.directory.view(),
      plugins: PLUGINS,
      packs: PLUGIN_PACKS,
    };
  }
  /**
   * 入口 / Entry: PluginManager.change.
   * 功能：在协调插件目录、装配、卸载与清理重试中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`PluginManager`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginManager`; this entry produces `operation` for its caller. Module context: Coordinates plugin discovery, assembly, unloading and cleanup retry against captured instance generations.
   * 处理：通过 `changeSchema.parse`, `PLUGIN_PACKS.find`, `this.queue.catch().then`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `changeSchema.parse`, `PLUGIN_PACKS.find`, `this.queue.catch().then`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `replacement`.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `operation`.
   * 副作用 / Effects: 更新 / updates `change.kind`, `change.id`, `this.queue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  change(input: unknown) {
    const change = changeSchema.parse(input);
    // Keep old CLI/API calls useful after an aggregate plugin becomes a pack.
    const replacement =
      change.kind === 'plugin' && PLUGIN_PACKS.find((pack) => pack.replacesPlugins.includes(change.id));
    if (replacement) {
      change.kind = 'pack';
      change.id = replacement.id;
    }
    /**
     * 入口 / Entry: PluginManager.change.callback@115.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.queue.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.queue.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view()`.
     * 副作用 / Effects: `writeStore`; `this.directory.setDesired`; 更新 / updates `next[key]`, `this.selection`, `this.migrations`.
     * 拒绝 / Refusals: 条件 / conditions `!catalog.some((item) => item.id === change.id)`; `!change.enabled && change.kind === 'plugin' && planned.includes(change.id)`; 异常 / errors `new AppError('插件或整合包不存在', 404)`; `new AppError(`此插件仍被依赖，请先停用：${users.join('、')}`, 409)`.
     */
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        const catalog = change.kind === 'plugin' ? PLUGINS : PLUGIN_PACKS;
        if (!catalog.some((item) => item.id === change.id)) throw new AppError('插件或整合包不存在', 404);
        const next: PluginSelection = structuredClone(this.selection);
        const key = change.kind === 'plugin' ? 'plugins' : 'packs';
        next[key] = change.enabled
          ? [...new Set([...next[key], change.id])].sort()
          : next[key].filter((id) => id !== change.id);
        const planned = resolvePlugins(next);
        if (!change.enabled && change.kind === 'plugin' && planned.includes(change.id)) {
          const users = [
            ...next.packs
              .filter((id) => resolvePlugins({ ...emptySelection(), packs: [id] }).includes(change.id))
              .map((id) => `整合包 ${id}`),
            ...next.plugins
              .filter((id) => resolvePlugins({ ...emptySelection(), plugins: [id] }).includes(change.id))
              .map((id) => `插件 ${id}`),
          ];
          throw new AppError(`此插件仍被依赖，请先停用：${users.join('、')}`, 409);
        }
        await writeStore(this.file, next);
        this.selection = next;
        this.directory.setDesired('official', planned);
        this.migrations = [];
        return this.view();
      });
    this.queue = operation;
    return operation;
  }
}
