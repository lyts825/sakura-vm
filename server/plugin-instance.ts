/**
 * 模块职责：记录单个插件实例的权限及受管贡献，撤销后拒绝继续使用原能力。
 * Module purpose: Owns one plugin instance's permissions/contributions and rejects capability use after revocation.
 */
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import type {
  PluginInstanceView,
  PluginSource,
  PluginContributionKind,
} from '../shared/contracts/plugin-runtime.ts';
import { withResourceContext } from './host-runtime/context.ts';
import { PluginScope } from './plugin-scope.ts';

/** An activation is immutable. Revocation never transfers authority to its successor. */
export class PluginInstance {
  readonly generation: string;
  readonly identity: string;
  readonly scope: PluginScope;
  phase: PluginInstanceView['phase'] = 'activating';
  desired = true;
  activationMs = 0;
  error?: string;
  private permissions: Set<string>;
  private contributions = new Map<string, { kind: PluginContributionKind; id: string; target: string }>();
  private managedKinds?: ReadonlySet<string>;
  /**
   * 入口 / Entry: PluginInstance.declareManaged.
   * 功能：在记录单个插件实例的权限及受管贡献中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.managedKinds`（`PluginInstance`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginInstance`; the outcome is recorded in `this.managedKinds`. Module context: Owns one plugin instance's permissions/contributions and rejects capability use after revocation.
   * 输入 / Inputs: kinds: readonly string[]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.managedKinds`.
   */
  declareManaged(kinds: readonly string[]) {
    this.managedKinds = new Set(kinds);
  }
  /**
   * 入口 / Entry: PluginInstance.contribute.
   * 功能：在记录单个插件实例的权限及受管贡献中，执行此领域的具体处理步骤并返回其结果；本入口产生 `remove` 供上层消费（`PluginInstance`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginInstance`; this entry produces `remove` for its caller. Module context: Owns one plugin instance's permissions/contributions and rejects capability use after revocation.
   * 处理：通过 `this.check`, `inline.includes`, `this.managedKinds.has`, `randomUUID` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.check`, `inline.includes`, `this.managedKinds.has`, `randomUUID`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.phase === 'running'`.
   * 输入 / Inputs: kind: PluginContributionKind; target: string
   * 输出 / Returns: `remove`.
   * 副作用 / Effects: `this.contributions.set`; `this.scope.add`.
   * 拒绝 / Refusals: 条件 / conditions `['job-retry', 'jobs', 'schedule', 'event', 'interceptor'].includes(kind) && this.managedKinds && !this.managedKinds.has(kind)`; 异常 / errors `new AppError('插件未声明受管贡献：' + kind, 403, 'PLUGIN_CONTRIBUTION_DENIED')`.
   */
  contribute(kind: PluginContributionKind, target: string) {
    this.check(undefined, true);
    if (
      ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'].includes(kind) &&
      this.managedKinds &&
      !this.managedKinds.has(kind)
    )
      throw new AppError('插件未声明受管贡献：' + kind, 403, 'PLUGIN_CONTRIBUTION_DENIED');
    const id = randomUUID();
    this.contributions.set(id, { kind, id, target });
    if (this.phase === 'running') this.changed();
    /**
     * 入口 / Entry: PluginInstance.contribute.remove.
     * 功能：在记录单个插件实例的权限及受管贡献中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`PluginInstance`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `PluginInstance`; the calls and state transitions below complete the operation. Module context: Owns one plugin instance's permissions/contributions and rejects capability use after revocation.
     * 处理：通过 `this.contributions.delete`, `this.changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.contributions.delete`, `this.changed`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `this.contributions.delete(id) && this.phase === 'running'`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.contributions.delete`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const remove = () => {
      if (this.contributions.delete(id) && this.phase === 'running') this.changed();
    };
    this.scope.add(remove);
    return remove;
  }
  /**
   * 入口 / Entry: PluginInstance.constructor.
   * 功能：建立 PluginInstance 的记录单个插件实例的权限及受管贡献上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the PluginInstance context for this module's responsibility: Owns one plugin instance's permissions/contributions and rejects capability use after revocation. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: source: PluginSource; pluginId: string; version: string; artifactDigest: string; permissions: readonly string[] default=[ 'vm', 'execution', 'network', 'process', 'storage', '…; generation: string default=randomUUID(); changed: () => void default=() => {}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.generation`, `this.identity`, `this.permissions`, `this.scope`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    readonly source: PluginSource,
    readonly pluginId: string,
    readonly version: string,
    readonly artifactDigest: string,
    permissions: readonly string[] = [
      'vm',
      'execution',
      'network',
      'process',
      'storage',
      'metadata',
      'compute',
      'jobs',
      'schedule',
      'events',
      'services',
    ],
    generation: string = randomUUID(),
    private readonly changed: () => void = () => {},
  ) {
    this.generation = generation;
    this.identity = `${source}:${pluginId}`;
    this.permissions = new Set(permissions);
    this.scope = withResourceContext(this.resourceIdentity, () => new PluginScope(this.owner));
  }
  /**
   * 入口 / Entry: PluginInstance.owner.
   * 功能：向调用者提供 `this.source === 'official' ? `plugin:${this.pluginId}` : `${this.source}:${this.pluginId}`` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.source === 'official' ? `plugin:${this.pluginId}` : `${this.source}:${this.pluginId}`` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.source === 'official' ? `plugin:${this.pluginId}` : `${this.source}:${this.pluginId}``.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get owner() {
    return this.source === 'official' ? `plugin:${this.pluginId}` : `${this.source}:${this.pluginId}`;
  }
  /**
   * 入口 / Entry: PluginInstance.signal.
   * 功能：向调用者提供 `this.scope.signal` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.scope.signal` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.scope.signal`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get signal() {
    return this.scope.signal;
  }
  /**
   * 入口 / Entry: PluginInstance.resourceIdentity.
   * 功能：向调用者提供 `{ owner: this.owner, pluginId: this.pluginId, pluginInstanceId: this.identity, pluginGeneration: this.generation, }` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `{ owner: this.owner, pluginId: this.pluginId, pluginInstanceId: this.identity, pluginGeneration: this.generation, }` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ owner: this.owner, pluginId: this.pluginId, pluginInstanceId: this.identity, pluginGeneration: this.generation, }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get resourceIdentity() {
    return {
      owner: this.owner,
      pluginId: this.pluginId,
      pluginInstanceId: this.identity,
      pluginGeneration: this.generation,
    };
  }
  /**
   * 入口 / Entry: PluginInstance.check.
   * 功能：在记录单个插件实例的权限及受管贡献中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`PluginInstance`）。
   * Purpose: Checks admission, input or resource ownership in `PluginInstance`; the calls and state transitions below complete the operation. Module context: Owns one plugin instance's permissions/contributions and rejects capability use after revocation.
   * 处理：通过 `this.permissions.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.permissions.has`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: permission: string optional; activating: default=false
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.signal.aborted || !(this.phase === 'running' || (activating && this.phase === 'activating'))`; `permission && !this.permissions.has(permission)`; 异常 / errors `new AppError(`插件实例已撤销：${this.identity}`, 403, 'PLUGIN_REVOKED')`; `new AppError(`插件缺少权限：${permission}`, 403, 'PLUGIN_PERMISSION_DENIED')`.
   */
  check(permission?: string, activating = false) {
    if (this.signal.aborted || !(this.phase === 'running' || (activating && this.phase === 'activating')))
      throw new AppError(`插件实例已撤销：${this.identity}`, 403, 'PLUGIN_REVOKED');
    if (permission && !this.permissions.has(permission))
      throw new AppError(`插件缺少权限：${permission}`, 403, 'PLUGIN_PERMISSION_DENIED');
  }
  /**
   * 入口 / Entry: PluginInstance.revoke.
   * 功能：在记录单个插件实例的权限及受管贡献中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.phase`（`PluginInstance`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginInstance`; the outcome is recorded in `this.phase`. Module context: Owns one plugin instance's permissions/contributions and rejects capability use after revocation.
   * 处理：通过 `this.scope.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.scope.abort`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: reason: unknown default=new DOMException('插件实例已撤销', 'AbortError')
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.scope.abort`; 更新 / updates `this.phase`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  revoke(reason: unknown = new DOMException('插件实例已撤销', 'AbortError')) {
    this.phase = 'draining';
    this.scope.abort(reason);
  }
  /**
   * 入口 / Entry: PluginInstance.setPermissions.
   * 功能：在记录单个插件实例的权限及受管贡献中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.permissions`（`PluginInstance`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginInstance`; the outcome is recorded in `this.permissions`. Module context: Owns one plugin instance's permissions/contributions and rejects capability use after revocation.
   * 处理：通过 `this.changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: permissions: readonly string[]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.permissions`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  setPermissions(permissions: readonly string[]) {
    this.permissions = new Set(permissions);
    this.changed();
  }
  /**
   * 入口 / Entry: PluginInstance.view.
   * 功能：在记录单个插件实例的权限及受管贡献中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ identity: this.identity, source: this.source, pluginId: this.pluginId, version: this.version, artifactDigest: this.artifact…` 供上层消费（`PluginInstance`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `PluginInstance`; this entry produces `{ identity: this.identity, source: this.source, pluginId: this.pluginId, version: this.version, artifactDigest: this.artifact…` for its caller. Module context: Owns one plugin instance's permissions/contributions and rejects capability use after revocation.
   * 处理：通过 `inline.sort`, `this.scope.diagnostics`, `this.contributions.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.sort`, `this.scope.diagnostics`, `this.contributions.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: PluginInstanceView；结果来自 / values from `{ identity: this.identity, source: this.source, pluginId: this.pluginId, version: this.version, artifactDigest: this.artifact…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(): PluginInstanceView {
    return {
      identity: this.identity,
      source: this.source,
      pluginId: this.pluginId,
      version: this.version,
      artifactDigest: this.artifactDigest,
      generation: this.generation,
      permissions: [...this.permissions].sort(),
      desired: this.desired,
      phase: this.phase,
      activationMs: this.activationMs,
      error: this.error,
      resourceId: this.scope.diagnostics().resourceId,
      contributions: [...this.contributions.values()],
    };
  }
}
