/**
 * 模块职责：管理项目桌面的启动、恢复与停止；旧会话或清理未确认的票据继续保留供核查。
 * Module purpose: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { type DesktopView } from '../shared/contracts/vm.ts';
import { Workspaces, projectPrivateValues } from './workspaces.ts';
import { projectVersion, type Project } from './project-config.ts';
import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { ProjectRunScopes } from './project-run-scope.ts';
import { ProjectIdentities, projectIdentityPayload, projectIdentitySources } from './project-identity.ts';
import { ProjectDesktopScope } from './project-service-scope.ts';
import { DesktopBindings, bindingProject, type ProjectDesktopBinding } from './desktop-binding.ts';
import {
  desktopProjectEnvironment,
  desktopProjectPrepare,
  desktopProjectVersionProbe,
  desktopUidCommand,
  desktopCommands,
  desktopProjectImePrepare,
  desktopProjectImeCommand,
} from './desktop-guest.ts';
import {
  defaultDesktopPreferences,
  desktopPreferencesSchema,
  type DesktopPreferences,
} from '../shared/desktop-preferences.ts';
import {
  desktopAuthoritySchema,
  desktopProjectControl,
  desktopProjectCommand,
  type DesktopControlProof,
  type DesktopAuthority,
} from './desktop-project-control.ts';
import { guestTaskControlPlan, cleanupGuestTaskPlan } from './guest-task.ts';
import { privateLog, redactValues } from './secrets.ts';

const same = isDeepStrictEqual;
/**
 * 入口 / Entry: changed.
 * 功能：从当前输入或状态计算 `new AppError('Desktop 原项目配置或客户机运行身份已改变', 409, 'DESKTOP_SCOPE_CHANGED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('Desktop 原项目配置或客户机运行身份已改变', 409, 'DESKTOP_SCOPE_CHANGED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('Desktop 原项目配置或客户机运行身份已改变', 409, 'DESKTOP_SCOPE_CHANGED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const changed = () => new AppError('Desktop 原项目配置或客户机运行身份已改变', 409, 'DESKTOP_SCOPE_CHANGED');
/**
 * 入口 / Entry: legacy.
 * 功能：从当前输入或状态计算 `new AppError('旧共享 Desktop 缺少完整 UID 会话票据，只能审阅；请由管理员明确处理原会话及旧记录', 409, 'DESKTOP_LEGACY_REVIEW_REQUIRED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('旧共享 Desktop 缺少完整 UID 会话票据，只能审阅；请由管理员明确处理原会话及旧记录', 409, 'DESKTOP_LEGACY_REVIEW_REQUIRED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('旧共享 Desktop 缺少完整 UID 会话票据，只能审阅；请由管理员明确处理原会话及旧记录', 409, 'DESKTOP_LEGACY_REVIEW_REQUIRED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const legacy = () => new AppError('旧共享 Desktop 缺少完整 UID 会话票据，只能审阅；请由管理员明确处理原会话及旧记录', 409, 'DESKTOP_LEGACY_REVIEW_REQUIRED');
/**
 * 入口 / Entry: cloneProject.
 * 功能：从当前输入或状态计算 `value`，供调用方后续验证或使用。
 * Purpose: Computes `value` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `value`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const cloneProject = (project: Project) => {
  const value = structuredClone(project);
  Object.defineProperty(value, '_workspace', { value: project._workspace, enumerable: false });
  return value;
};
export type DesktopStartPins = { projectId: string; live: NonNullable<ReturnType<Machines['live']['get']>> };
type Control = typeof desktopProjectControl;
type PendingStart = { runId: string | null; retained: boolean;
/**
 * 签名 / Signature: PendingStart.release.
 * 功能：为管理项目桌面的启动、恢复与停止声明 release 的输入与结果契约，所属容器为 PendingStart。
 * Purpose: Declares the input/result contract for release in PendingStart. Module responsibility: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
release: () => Promise<void>;
/**
 * 签名 / Signature: PendingStart.adminCleanup.
 * 功能：为管理项目桌面的启动、恢复与停止声明 adminCleanup 的输入与结果契约，所属容器为 PendingStart。
 * Purpose: Declares the input/result contract for adminCleanup in PendingStart. Module responsibility: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
adminCleanup?: () => Promise<void>;
  binding?: ProjectDesktopBinding };
const pendingStarts = new WeakMap<Machines, Map<string, PendingStart>>();

/** The no-Workspaces desktop remains the explicit instance-administration path. */
export class ProjectDesktops {
  readonly bindings: DesktopBindings;
  private scopes: ProjectRunScopes;
  private identities: ProjectIdentities;
  private pending: Map<string, PendingStart>;
  /**
   * 入口 / Entry: ProjectDesktops.constructor.
   * 功能：建立 ProjectDesktops 的管理项目桌面的启动、恢复与停止上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectDesktops context for this module's responsibility: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; options: { control?: Control; build?: () => Promise<string>; readyTimeoutMs?: number; beforeRe… default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `pendingStarts.set`; 更新 / updates `this.bindings`, `this.scopes`, `this.identities`, `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private machines: Machines, private workspaces: WorkspacesV1, private options: {
    control?: Control;
    /**
     * 签名 / Signature: ProjectDesktops.constructor.build.
     * 功能：为管理项目桌面的启动、恢复与停止声明 build 的输入与结果契约，所属容器为 ProjectDesktops.constructor。
     * Purpose: Declares the input/result contract for build in ProjectDesktops.constructor. Module responsibility: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: Promise<string>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    build?: () => Promise<string>; readyTimeoutMs?: number;
    /**
     * 签名 / Signature: ProjectDesktops.constructor.beforeRetire.
     * 功能：为管理项目桌面的启动、恢复与停止声明 beforeRetire 的输入与结果契约，所属容器为 ProjectDesktops.constructor。
     * Purpose: Declares the input/result contract for beforeRetire in ProjectDesktops.constructor. Module responsibility: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
     * 输入 / Inputs: id: string; proof: DesktopControlProof
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    beforeRetire?: (id: string, proof: DesktopControlProof) => Promise<void>;
  } = {}) {
    this.bindings = new DesktopBindings(machines);
    this.scopes = new ProjectRunScopes(machines);
    this.identities = new ProjectIdentities(machines);
    if (!pendingStarts.has(machines)) pendingStarts.set(machines, new Map());
    this.pending = pendingStarts.get(machines)!;
  }
  /**
   * 入口 / Entry: ProjectDesktops.releasePending.
   * 功能：在管理项目桌面的启动、恢复与停止中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`ProjectDesktops`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectDesktops`; this entry produces `void` for its caller. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
   * 处理：通过 `this.pending.get`, `pending.release`, `this.pending.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pending.get`, `pending.release`, `this.pending.delete`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!pending || pending.runId !== runId || pending.adminCleanup`; `this.pending.get(id) === pending`.
   * 输入 / Inputs: id: string; runId: string | null
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `pending.release`; `this.pending.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async releasePending(id: string, runId: string | null) {
    const pending = this.pending.get(id);
    if (!pending || pending.runId !== runId || pending.adminCleanup) return;
    await pending.release();
    if (this.pending.get(id) === pending) this.pending.delete(id);
  }
  /**
   * 入口 / Entry: ProjectDesktops.packages.
   * 功能：在管理项目桌面的启动、恢复与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`ProjectDesktops`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectDesktops`; this entry produces `result` for its caller. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
   * 处理：通过 `randomUUID`, `guestTaskControlPlan`, `this.machines.exec`, `result.stderr.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `randomUUID`, `guestTaskControlPlan`, `this.machines.exec`, `result.stderr.includes`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; script: string; pending: PendingStart; originalLive: object; signal: AbortSignal; log: (line: string) => void
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `this.machines.exec`; 更新 / updates `pending.adminCleanup`.
   * 拒绝 / Refusals: 条件 / conditions `result.code === 126 && result.stderr.includes('SAKURA_TASK_SCOPE_UNAVAILABLE:')`; 异常 / errors `new AppError(result.stderr.trim(), 409, 'GUEST_TASK_SCOPE_UNAVAILABLE')`.
   * 收尾：退出 try 区域时始终执行 `await cleanup();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await cleanup();`; these steps also apply to exceptional exits.
   */
  private async packages(id: string, script: string, pending: PendingStart, originalLive: object,
    signal: AbortSignal, log: (line: string) => void) {
    const runId = randomUUID(), commands = guestTaskControlPlan(runId, randomUUID(), script, 920000);
    // The exact guest-task token, boot and cgroup receipt remain available for
    // an independent retry. This body contains only fixed administration code.
    /**
     * 入口 / Entry: ProjectDesktops.packages.cleanup.
     * 功能：在管理项目桌面的启动、恢复与停止中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `pending.adminCleanup`（`ProjectDesktops`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectDesktops`; the outcome is recorded in `pending.adminCleanup`. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
     * 处理：通过 `cleanupGuestTaskPlan`, `this.machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `cleanupGuestTaskPlan`, `this.machines.live.get`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `pending.adminCleanup === cleanup`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `pending.adminCleanup`.
     * 拒绝 / Refusals: 条件 / conditions `this.machines.live.get(id) !== originalLive`; 异常 / errors `new AppError('Desktop 原管理任务客户机已改变，清理未确认', 503, 'GUEST_TASK_CLEANUP_FAILED')`.
     */
    const cleanup = async () => {
      await cleanupGuestTaskPlan(this.machines, id, originalLive, runId, commands, undefined, log);
      if (this.machines.live.get(id) !== originalLive)
        throw new AppError('Desktop 原管理任务客户机已改变，清理未确认', 503, 'GUEST_TASK_CLEANUP_FAILED');
      if (pending.adminCleanup === cleanup) pending.adminCleanup = undefined;
    };
    pending.adminCleanup = cleanup;
    try {
      const result = await this.machines.exec(id, commands.run, 920000, signal, log);
      if (result.code === 126 && result.stderr.includes('SAKURA_TASK_SCOPE_UNAVAILABLE:'))
        throw new AppError(result.stderr.trim(), 409, 'GUEST_TASK_SCOPE_UNAVAILABLE');
      return result;
    } finally { await cleanup(); }
  }
  /**
   * 入口 / Entry: ProjectDesktops.control.
   * 功能：在管理项目桌面的启动、恢复与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(this.options.control || desktopProjectControl)(this.machines, id, op, this.proof(binding), signal)` 供上层消费（`ProjectDesktops`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectDesktops`; this entry produces `(this.options.control || desktopProjectControl)(this.machines, id, op, this.proof(binding), signal)` for its caller. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
   * 处理：通过 `inline`, `this.proof` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline`, `this.proof`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; op: Parameters<Control>[2]; binding: ProjectDesktopBinding; signal: AbortSignal optional
   * 输出 / Returns: `(this.options.control || desktopProjectControl)(this.machines, id, op, this.proof(binding), signal)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private control(id: string, op: Parameters<Control>[2], binding: ProjectDesktopBinding, signal?: AbortSignal) {
    return (this.options.control || desktopProjectControl)(this.machines, id, op, this.proof(binding), signal);
  }
  /**
   * 入口 / Entry: ProjectDesktops.proof.
   * 功能：从当前输入或状态计算 `{ version: 1, ...binding.execution }`，供调用方后续验证或使用。
   * Purpose: Computes `{ version: 1, ...binding.execution }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: binding: ProjectDesktopBinding
   * 输出 / Returns: DesktopControlProof；结果来自 / values from `{ version: 1, ...binding.execution }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private proof(binding: ProjectDesktopBinding): DesktopControlProof {
    return { version: 1, ...binding.execution };
  }
  /**
   * 入口 / Entry: ProjectDesktops.process.
   * 功能：从当前输入或状态计算 `new ProjectDesktopScope(this.machines, id, bindingProject(binding))`，供调用方后续验证或使用。
   * Purpose: Computes `new ProjectDesktopScope(this.machines, id, bindingProject(binding))` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string; binding: ProjectDesktopBinding
   * 输出 / Returns: `new ProjectDesktopScope(this.machines, id, bindingProject(binding))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private process(id: string, binding: ProjectDesktopBinding) {
    return new ProjectDesktopScope(this.machines, id, bindingProject(binding));
  }
  /**
   * 入口 / Entry: ProjectDesktops.assertLive.
   * 功能：在管理项目桌面的启动、恢复与停止中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`ProjectDesktops`）。
   * Purpose: Checks admission, input or resource ownership in `ProjectDesktops`; the calls and state transitions below complete the operation. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
   * 处理：通过 `this.machines.live.get`, `this.machines.state`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.live.get`, `this.machines.state`, `changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; live: object
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.live.get(id) !== live || this.machines.state(id) !== 'running'`; 异常 / errors `changed()`.
   */
  private assertLive(id: string, live: object) {
    if (this.machines.live.get(id) !== live || this.machines.state(id) !== 'running') throw changed();
  }
  /**
   * 入口 / Entry: ProjectDesktops.save.
   * 功能：在管理项目桌面的启动、恢复与停止中，校验并提交领域状态变更；本入口产生 `next` 供上层消费（`ProjectDesktops`）。
   * Purpose: Validates and commits a domain state change in `ProjectDesktops`; this entry produces `next` for its caller. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
   * 处理：通过 `this.assertLive`, `this.bindings.save` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.assertLive`, `this.bindings.save`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; previous: ProjectDesktopBinding; next: ProjectDesktopBinding; live: object
   * 输出 / Returns: `next`.
   * 副作用 / Effects: `this.bindings.save`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(id: string, previous: ProjectDesktopBinding, next: ProjectDesktopBinding, live: object) {
    this.assertLive(id, live);
    await this.bindings.save(id, next, previous);
    this.assertLive(id, live);
    return next;
  }
  /**
   * 入口 / Entry: ProjectDesktops.installed.
   * 功能：从当前输入或状态计算 `result.code === 0`，供调用方后续验证或使用。
   * Purpose: Computes `result.code === 0` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `result.code === 0`.
   * 副作用 / Effects: `this.machines.exec`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async installed(id: string, signal?: AbortSignal) {
    const result = await this.machines.exec(id, desktopProjectVersionProbe, 10000, signal);
    return result.code === 0;
  }
  /**
   * 入口 / Entry: ProjectDesktops.beforeChange.
   * 功能：在管理项目桌面的启动、恢复与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ProjectDesktops`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectDesktops`; this entry produces `void` for its caller. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
   * 处理：通过 `projectVersion`, `this.bindings.read`, `legacy` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectVersion`, `this.bindings.read`, `legacy`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `projectVersion(previous) === projectVersion(next)`; `!binding || binding.projectId !== (previous._workspace || 'default')`.
   * 输入 / Inputs: id: string; previous: Project; next: Project
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `binding.version === 1`; `binding.enabled`; `binding.state !== 'stopped'`; 异常 / errors `legacy()`; `new AppError('请先确认停止此项目的 Desktop 完整会话及其后代，再修改项目配置', 409, 'DESKTOP_RUNS_MUST_STOP')`.
   */
  async beforeChange(id: string, previous: Project, next: Project) {
    if (projectVersion(previous) === projectVersion(next)) return;
    const binding = await this.bindings.read(id);
    if (!binding || binding.projectId !== (previous._workspace || 'default')) return;
    if (binding.version === 1) {
      if (binding.enabled) throw legacy();
      return;
    }
    if (binding.state !== 'stopped')
      throw new AppError('请先确认停止此项目的 Desktop 完整会话及其后代，再修改项目配置', 409, 'DESKTOP_RUNS_MUST_STOP');
  }
  /**
   * 入口 / Entry: ProjectDesktops.verified.
   * 功能：在管理项目桌面的启动、恢复与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `binding` 供上层消费（`ProjectDesktops`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectDesktops`; this entry produces `binding` for its caller. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
   * 处理：通过 `this.machines.live.get`, `changed`, `this.assertLive`, `this.process().status` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.live.get`, `changed`, `this.assertLive`, `this.process().status`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; binding: ProjectDesktopBinding; signal: AbortSignal optional
   * 输出 / Returns: `binding`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!live || binding.state !== 'running' || !binding.execution.run || !binding.execution.endpoint`; `status.status !== 'running' || !same(status.record, binding.execution.record)`; `!await this.scopes.readonlyActive(id, binding.projectId, binding.execution.record.runId, signal)`; 异常 / errors `changed()`.
   */
  async verified(id: string, binding: ProjectDesktopBinding, signal?: AbortSignal) {
    const live = this.machines.live.get(id);
    if (!live || binding.state !== 'running' || !binding.execution.run || !binding.execution.endpoint) throw changed();
    this.assertLive(id, live);
    const status = await this.process(id, binding).status(signal, binding.execution.sha256);
    if (status.status !== 'running' || !same(status.record, binding.execution.record)) throw changed();
    if (!await this.scopes.readonlyActive(id, binding.projectId, binding.execution.record.runId, signal)) throw changed();
    const run = await this.identities.runReadonly(id, binding.execution.identity, binding.execution.record.runId, signal);
    if (!same(run, binding.execution.run)) throw changed();
    await this.control(id, 'probe', binding, signal);
    this.assertLive(id, live);
    if (!same(await this.bindings.read(id), binding)) throw changed();
    return binding;
  }
  /**
   * 入口 / Entry: ProjectDesktops.view.
   * 功能：在管理项目桌面的启动、恢复与停止中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ status: 'unavailable', log: '', preferences: defaultDesktopPreferences }` / `{ status: 'error', log: '', error: legacy().message, preferences: defaultDesktopPreferences, projectId: binding.projectId, di…` 供上层消费（`ProjectDesktops`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectDesktops`; this entry produces `{ status: 'unavailable', log: '', preferences: defaultDesktopPreferences }` / `{ status: 'error', log: '', error: legacy().message, preferences: defaultDesktopPreferences, projectId: binding.projectId, di…` for its caller. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
   * 处理：通过 `this.machines.state`, `this.bindings.read`, `legacy`, `this.machines.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.state`, `this.bindings.read`, `legacy`, `this.machines.exec`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.machines.state(id) !== 'running'`; `binding?.version === 1`; `['ready', 'starting'].includes(observed.stdout.trim())`.
   * 输入 / Inputs: id: string; bound: default=false
   * 输出 / Returns: Promise<DesktopView>；结果来自 / values from `{ status: 'unavailable', log: '', preferences: defaultDesktopPreferences }`; `{ status: 'error', log: '', error: legacy().message, preferences: defaultDesktopPreferences, projectId: binding.projectId, di…`; `{ status: 'error', log: '', error: legacy().message, preferences: defaultDesktopPreferences }`.
   * 副作用 / Effects: `this.machines.exec`; `observed.stdout.trim`; `this.installed`.
   * 拒绝 / Refusals: 条件 / conditions `!binding`; `observed.code !== 0`; 异常 / errors `new AppError('无法审阅旧 Desktop 状态', 502)`.
   */
  async view(id: string, bound = false): Promise<DesktopView> {
    if (this.machines.state(id) !== 'running') return { status: 'unavailable', log: '', preferences: defaultDesktopPreferences };
    const binding = await this.bindings.read(id);
    if (binding?.version === 1) return { status: 'error', log: '', error: legacy().message, preferences: defaultDesktopPreferences,
      projectId: binding.projectId, directory: binding.directory, networkIsolation: binding.networkIsolation };
    if (!binding) {
      // Observe the previous instance service only to reject an unknown owner.
      const observed = await this.machines.exec(id, desktopCommands(this.machines.get(id).distro).probe, 10000);
      if (observed.code !== 0) throw new AppError('无法审阅旧 Desktop 状态', 502);
      if (['ready', 'starting'].includes(observed.stdout.trim()))
        return { status: 'error', log: '', error: legacy().message, preferences: defaultDesktopPreferences };
      return { status: await this.installed(id) ? 'stopped' : 'not-installed', log: '', preferences: defaultDesktopPreferences };
    }
    if (binding.state === 'running') await this.verified(id, binding);
    const status = binding.state === 'running' ? 'ready' : binding.state === 'stopped' ? 'stopped' : binding.state === 'review' ? 'error' : 'starting';
    return { status, log: '', preferences: binding.preferences, projectId: binding.projectId,
      directory: binding.directory, networkIsolation: binding.networkIsolation,
      ...(!bound && ['ready', 'starting'].includes(status) && binding.projectId !== this.workspaces.projects.current(id) ? { bindingMismatch: true } : {}),
      ...(binding.state === 'review' ? { cleanupPending: true,
        error: 'Desktop 原完整票据尚未完成清理，请重试停止；没有接管其他会话' } : {}) };
  }
  /**
   * 入口 / Entry: ProjectDesktops.stop.
   * 功能：在管理项目桌面的启动、恢复与停止中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`ProjectDesktops`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectDesktops`; this entry produces `void` for its caller. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
   * 处理：通过 `this.machines.live.get`, `this.machines.state`, `changed`, `this.pending.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.live.get`, `this.machines.state`, `changed`, `this.pending.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `pending?.adminCleanup`; `!binding && pending?.retained && pending.binding`; `pending?.retained`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.bindings.save`; `this.machines.exec`; `observed.stdout.trim`; `this.releasePending`; `this.save`; 更新 / updates `binding`, `current`.
   * 拒绝 / Refusals: 条件 / conditions `!live || this.machines.state(id) !== 'running'`; `!binding`; `observed.code !== 0 || ['ready', 'starting'].includes(observed.stdout.trim())`; 异常 / errors `changed()`; `legacy()`.
   * 失败处理：catch 分支执行 `if (error instanceof AppError && error.status === 503) throw error;`; `throw new AppError('Desktop 原完整域清理未确认；已保留原票据：' + (error as Error).message, 503, 'DESKTOP_CLEANUP_FAILED');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (error instanceof AppError && error.status === 503) throw error;`; `throw new AppError('Desktop 原完整域清理未确认；已保留原票据：' + (error as Error).message, 503, 'DESKTOP_CLEANUP_FAILED');`; these statements determine whether a failure is absorbed or rejected again.
   */
  async stop(id: string) {
    const live = this.machines.live.get(id);
    if (!live || this.machines.state(id) !== 'running') throw changed();
    const pending = this.pending.get(id);
    if (pending?.adminCleanup) await pending.adminCleanup();
    let binding = await this.bindings.read(id);
    if (!binding && pending?.retained && pending.binding) {
      await this.bindings.save(id, pending.binding, null);
      binding = pending.binding;
    }
    if (!binding) {
      const observed = await this.machines.exec(id, desktopCommands(this.machines.get(id).distro).probe, 10000);
      if (observed.code !== 0 || ['ready', 'starting'].includes(observed.stdout.trim())) throw legacy();
      if (pending?.retained) await this.releasePending(id, null);
      return;
    }
    if (binding.version === 1) throw legacy();
    let current = binding;
    if (current.enabled || current.state !== 'stopped')
      current = await this.save(id, current, { ...current, enabled: false, state: 'review' }, live);
    try {
      // Exact original scope cleanup remains available after config corruption,
      // lost native ACKs, a pane exit, reload, or a true kernel reboot.
      const process = this.process(id, current);
      await this.options.beforeRetire?.(id, this.proof(current));
      if (!await process.metadata() && current.execution.record.phase === 'intent')
        await process.persistIntent(current.execution.record);
      await process.stop(current.execution.record);
      this.assertLive(id, live);
      await this.control(id, 'unguard', current);
      const record = await this.process(id, current).metadata();
      if (!record || record.phase !== 'stopped' || record.runId !== current.execution.record.runId) throw changed();
      await this.save(id, current, { ...current, state: 'stopped', enabled: false,
        execution: { ...current.execution, record } }, live);
      await this.releasePending(id, current.execution.record.runId);
      // Package cleanup may fail after the prior GUI was retired but before
      // a new intent exists. Only an explicitly retained retry may release
      // that null-run reservation after rechecking the original full proof.
      if (pending?.retained && pending.runId === null) await this.releasePending(id, null);
    } catch (error) {
      if (error instanceof AppError && error.status === 503) throw error;
      throw new AppError('Desktop 原完整域清理未确认；已保留原票据：' + (error as Error).message, 503, 'DESKTOP_CLEANUP_FAILED');
    }
  }
  /**
   * 入口 / Entry: ProjectDesktops.restore.
   * 功能：在管理项目桌面的启动、恢复与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `null` / `this.workspaces.projects.with(id, binding.projectId, async () => { const captured = await this.workspaces.config(id); this.as…` 供上层消费（`ProjectDesktops`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectDesktops`; this entry produces `null` / `this.workspaces.projects.with(id, binding.projectId, async () => { const captured = await this.workspaces.config(id); this.as…` for its caller. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
   * 处理：通过 `this.bindings.read`, `legacy`, `this.machines.live.get`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.bindings.read`, `legacy`, `this.machines.live.get`, `changed`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!binding?.enabled`; `binding.state === 'running'`; `binding.state !== 'stopped'`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `null`; `this.workspaces.projects.with(id, binding.projectId, async () => { const captured = await this.workspaces.config(id); this.as…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `binding.version === 1`; `!live`; 异常 / errors `legacy()`; `changed()`.
   * 失败处理：catch 分支执行 `this.assertLive(id, live);`; `await this.machines.locked(id, () => this.stop(id));`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.assertLive(id, live);`; `await this.machines.locked(id, () => this.stop(id));`; these statements determine whether a failure is absorbed or rejected again.
   */
  async restore(id: string) {
    const binding = await this.bindings.read(id);
    if (!binding?.enabled) return null;
    if (binding.version === 1) throw legacy();
    const live = this.machines.live.get(id);
    if (!live) throw changed();
    if (binding.state === 'running') {
      try { await this.verified(id, binding); return null; }
      catch {
        this.assertLive(id, live);
        // Restart is authorized by the existing enabled preference only after
        // the exact old domain and native ticket have been retired.
        await this.machines.locked(id, () => this.stop(id));
      }
    } else if (binding.state !== 'stopped') await this.machines.locked(id, () => this.stop(id));
    /**
     * 入口 / Entry: ProjectDesktops.restore.callback@224.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.workspaces.projects.with）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.workspaces.projects.with).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `null`; `{ projectId: binding.projectId, preferences: binding.preferences }`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.workspaces.projects.with(id, binding.projectId, async () => {
      const captured = await this.workspaces.config(id);
      this.assertLive(id, live);
      if (projectVersion(captured) !== binding.configVersion || captured.directory !== binding.directory ||
          (captured.networkIsolation || 'host') !== binding.networkIsolation) return null;
      return { projectId: binding.projectId, preferences: binding.preferences };
    });
  }
  /**
   * 入口 / Entry: ProjectDesktops.start.
   * 功能：捕获项目配置、账户与客户机运行，安装所需包并启动完整 UID 桌面会话。
   * Purpose: Captures project/account/guest identity, installs prerequisites and starts the complete UID desktop session.
   * 设计：意图和运输摘要先落盘，原生 scope 与监听就绪核验后才启用绑定；回滚未确认保留完整票据和准备租约。
   * Design: Intent/transport digests precede native scope and listener verification; unconfirmed rollback retains full tickets and preparation leases.
   * 输入 / Inputs: id: string; action: 'install' | 'start' | 'configure' | 'ime'; input: Partial<DesktopPreferences> | undefined; pins: DesktopStartPins; signal: AbortSignal; log: (line: string) => void; captured: (binding: ProjectDesktopBinding, values: string[]) => void
   * 输出 / Returns: `this.workspaces.projects.inScope(id, pins.projectId, async () => { signal.throwIfAborted(); this.assertLive(id, pins.live); c…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async start(id: string, action: 'install' | 'start' | 'configure' | 'ime', input: Partial<DesktopPreferences> | undefined,
    pins: DesktopStartPins, signal: AbortSignal, log: (line: string) => void,
    captured: (binding: ProjectDesktopBinding, values: string[]) => void) {
    const capturedInput = input === undefined ? undefined : structuredClone(input);
    /**
     * 入口 / Entry: ProjectDesktops.start.callback@236.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.workspaces.projects.inScope）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.workspaces.projects.inScope).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `await this.machines.locked(id, async () => { await assertCurrent(); let prior = await this.bindings.read(id); if (prior?.vers…`.
     * 副作用 / Effects: `this.pending.set`; `this.releasePending`; `prepared.release`; `terminals.close`; 更新 / updates `prepared`, `pending`, `pending.retained`.
     * 拒绝 / Refusals: 条件 / conditions `(original._workspace || 'default') !== pins.projectId`; `this.pending.has(id)`; `!prepared.captured || prepared.captured.live !== pins.live || prepared.captured.configVersion !== version || prepared.project…`; 异常 / errors `changed()`; `new AppError('Desktop 原启动清理未确认，请重试停止；原准备租约仍保留', 503, 'DESKTOP_CLEANUP_FAILED')`.
     * 收尾：退出 try 区域时始终执行 `if (pending?.retained) { // Keep both the original reservation and its configuration guard. // close() would wait for this ta…`; `await terminals.close();`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `if (pending?.retained) { // Keep both the original reservation and its configuration guard. // close() would wait for this ta…`; `await terminals.close();`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `if (pending && error instanceof AppError && error.status === 503) pending.retained = true;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (pending && error instanceof AppError && error.status === 503) pending.retained = true;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.workspaces.projects.inScope(id, pins.projectId, async () => {
      signal.throwIfAborted(); this.assertLive(id, pins.live);
      const original = cloneProject(await this.workspaces.config(id)), version = projectVersion(original);
      if ((original._workspace || 'default') !== pins.projectId) throw changed();
      /**
       * 入口 / Entry: ProjectDesktops.start.assertCurrent.
       * 功能：在管理项目桌面的启动、恢复与停止中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`ProjectDesktops`）。
       * Purpose: Checks admission, input or resource ownership in `ProjectDesktops`; the calls and state transitions below complete the operation. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
       * 处理：通过 `signal.throwIfAborted`, `this.assertLive`, `this.workspaces.config`, `projectVersion` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.assertLive`, `this.workspaces.config`, `projectVersion`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `(current._workspace || 'default') !== pins.projectId || projectVersion(current) !== version`; 异常 / errors `changed()`.
       */
      const assertCurrent = async () => {
        signal.throwIfAborted(); this.assertLive(id, pins.live);
        const current = await this.workspaces.config(id);
        if ((current._workspace || 'default') !== pins.projectId || projectVersion(current) !== version) throw changed();
        this.assertLive(id, pins.live);
      };
      const terminals = projectTerminalsFor(this.machines, this.workspaces);
      let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
      let pending: PendingStart | undefined;
      try {
        if (this.pending.has(id)) throw new AppError('Desktop 原启动清理未确认，请重试停止；原准备租约仍保留', 503, 'DESKTOP_CLEANUP_FAILED');
        prepared = await terminals.prepare(id, pins.projectId, null, false, signal, undefined, { mode: 'task' });
        if (!prepared.captured || prepared.captured.live !== pins.live || prepared.captured.configVersion !== version ||
            prepared.projectId !== pins.projectId || (prepared.captured.project._workspace || 'default') !== pins.projectId) throw changed();
        if (this.pending.has(id)) throw new AppError('Desktop 原启动准备仍由准确票据占有', 409, 'DESKTOP_SCOPE_CHANGED');
        pending = { runId: null, retained: false,
        /**
         * 入口 / Entry: ProjectDesktops.start.release.
         * 功能：在管理项目桌面的启动、恢复与停止中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ProjectDesktops`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectDesktops`; the calls and state transitions below complete the operation. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
         * 处理：通过 `inline.release`, `terminals.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `inline.release`, `terminals.close`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `inline.release`; `terminals.close`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         * 收尾：退出 try 区域时始终执行 `await terminals.close();`；这些步骤也适用于异常退出。
         * Finalization: Leaving the try region always executes `await terminals.close();`; these steps also apply to exceptional exits.
         */
        release: async () => {
          try { await prepared!.release(); } finally { await terminals.close(); }
        } };
        this.pending.set(id, pending);
        const executionSignal = prepared.signal!;
        /**
         * 入口 / Entry: ProjectDesktops.start.callback@260.
         * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
         * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `{ code: 0, stdout: '', stderr: '' }`; `packages`.
         * 副作用 / Effects: `this.machines.exec`; `this.stop`; `this.installed`; `executionSignal.throwIfAborted`; `createHash().update().digest`; 更新 / updates `prior`, `pending!.runId`, `pending!.binding`, `binding`.
         * 拒绝 / Refusals: 条件 / conditions `prior?.version === 1`; `!prior`; `old.code !== 0 || ['ready', 'starting'].includes(old.stdout.trim())`; 异常 / errors `legacy()`; `new AppError('请先核对并停止实例中的原 Desktop 完整会话，再启动此项目', 409, 'DESKTOP_SCOPE_CHANGED')`.
         * 收尾：退出 try 区域时始终执行 `output.flush();`；这些步骤也适用于异常退出。
         * Finalization: Leaving the try region always executes `output.flush();`; these steps also apply to exceptional exits.
         * 失败处理：catch 分支执行 `try { await this.stop(id); } catch (cleanup) { if (cleanup instanceof AppError && cleanup.status === 503) throw cleanup; thro…`; `if (error instanceof AppError && error.status === 503) throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `try { await this.stop(id); } catch (cleanup) { if (cleanup instanceof AppError && cleanup.status === 503) throw cleanup; thro…`; `if (error instanceof AppError && error.status === 503) throw error;`; these statements determine whether a failure is absorbed or rejected again.
         */
        return await this.machines.locked(id, async () => {
          await assertCurrent();
          let prior = await this.bindings.read(id);
          if (prior?.version === 1) throw legacy();
          if (!prior) {
            const old = await this.machines.exec(id, desktopCommands(this.machines.get(id).distro).probe, 10000, executionSignal);
            if (old.code !== 0 || ['ready', 'starting'].includes(old.stdout.trim())) throw legacy();
          }
          if (prior && prior.state !== 'stopped') {
            if (['configure', 'ime'].includes(action) && prior.projectId === pins.projectId) { await this.stop(id); prior = await this.bindings.read(id); }
            else if (prior.state === 'running' && prior.projectId === pins.projectId && prior.configVersion === version && capturedInput === undefined) {
              await this.verified(id, prior, executionSignal); captured(prior, []); return { code: 0, stdout: '', stderr: '' };
            } else throw new AppError('请先核对并停止实例中的原 Desktop 完整会话，再启动此项目', 409, 'DESKTOP_SCOPE_CHANGED');
          }
          const preferences = capturedInput === undefined && prior?.version === 2 ? prior.preferences
            : desktopPreferencesSchema.parse(action === 'configure' && prior?.version === 2 ? { ...prior.preferences, ...capturedInput } : capturedInput || {});
          const distro = this.machines.get(id).distro || 'alpine';
          if (['configure', 'ime'].includes(action) && !await this.installed(id, executionSignal)) throw new AppError('请先安装 KDE Desktop', 409);
          if (action === 'install' || !await this.installed(id, executionSignal)) {
            const packages = await this.packages(id, desktopProjectPrepare(distro, preferences), pending!, pins.live, executionSignal, log);
            if (packages.code !== 0) return packages;
          }
          if (action === 'ime') {
            const packages = await this.packages(id, desktopProjectImePrepare(distro), pending!, pins.live, executionSignal, log);
            if (packages.code !== 0) return packages;
          }
          await assertCurrent(); executionSignal.throwIfAborted();
          const resolved = await this.workspaces.resolveProject(id, original);
          await assertCurrent();
          if ((resolved._workspace || 'default') !== pins.projectId || resolved.directory !== original.directory ||
              (resolved.networkIsolation || 'host') !== (original.networkIsolation || 'host')) throw changed();
          const identity = await this.scopes.identity(id, original, executionSignal), process = new ProjectDesktopScope(this.machines, id, original);
          const status = await process.status(executionSignal);
          if (!['absent', 'stopped'].includes(status.status)) throw new AppError('Desktop 原完整运行域尚未清理，拒绝接管', 409, 'DESKTOP_SCOPE_CHANGED');
          const bindingHash = createHash('sha256').update(JSON.stringify(['desktop-project-uid-v1', pins.projectId, version, preferences])).digest('hex');
          const intent = process.newIntent(bindingHash, status.bootId);
          const execution = { command: (action === 'ime' ? desktopProjectImeCommand + '\n' : '') +
            desktopUidCommand(intent.runId, preferences, distro, identity.uid), environment: desktopProjectEnvironment(resolved.environment) };
          const frame = projectIdentityPayload(execution), build = await (this.options.build || (async () => (await projectIdentitySources()).manifest.build))();
          const values = [...projectPrivateValues(resolved), ...Object.values(resolved.environment || {})], output = privateLog(log, values);
          let binding: ProjectDesktopBinding = { version: 2, projectId: pins.projectId, directory: identity.directory,
            networkIsolation: identity.networkIsolation, enabled: false, state: 'starting', configVersion: version, preferences,
            launcherSha256: frame.sha256, execution: { identity, record: intent, run: null, sha256: frame.sha256,
              runtime: '/run/sakura-desktop-uid/' + identity.uid + '/' + intent.runId, endpoint: null, build } };
          await assertCurrent();
          pending!.runId = intent.runId;
          pending!.binding = binding;
          await this.bindings.save(id, binding, prior);
          captured(binding, values);
          try {
            await process.persistIntent(intent);
            const payload = await this.scopes.inherited(id, original, execution, { kind: 'service', runId: intent.runId, bootId: intent.bootId }, executionSignal);
            if (!same(payload.identity, identity) || payload.sha256 !== frame.sha256) throw changed();
            await assertCurrent();
            // Fixed Root adapter rule precedes Xvnc. Project input never enters it.
            await this.control(id, 'guard', binding, executionSignal);
            const record = await process.start(intent, payload, executionSignal);
            binding = await this.save(id, binding, { ...binding, execution: { ...binding.execution, record } }, pins.live);
            const deadline = Date.now() + (this.options.readyTimeoutMs ?? 150000);
            let ready = false;
            while (Date.now() < deadline) {
              await assertCurrent(); executionSignal.throwIfAborted();
              const liveStatus = await process.status(executionSignal, binding.execution.sha256);
              if (liveStatus.status !== 'running' || !same(liveStatus.record, record)) throw changed();
              if (await this.scopes.active(id, pins.projectId, intent.runId, executionSignal)) {
                const run = await this.identities.runReadonly(id, identity, intent.runId, executionSignal);
                if (run.bootId !== record.bootId || run.cgroupName !== record.scopeName || run.cgroupInode !== record.inode || run.build !== build) throw changed();
                if (!binding.execution.run) binding = await this.save(id, binding, { ...binding, execution: { ...binding.execution, run } }, pins.live);
                try {
                  const probe = await this.control(id, 'probe', binding, executionSignal);
                  if (!('endpoint' in probe)) throw changed();
                  binding = await this.save(id, binding, { ...binding, state: 'running', enabled: true,
                    execution: { ...binding.execution, endpoint: probe.endpoint } }, pins.live);
                  ready = true; break;
                } catch (error) {
                  if (!(error instanceof AppError) || error.code !== 'DESKTOP_NOT_READY') throw error;
                }
              }
              await delay(500, undefined, { signal: executionSignal });
            }
            if (!ready) throw new AppError('Desktop UID 会话就绪检查超时', 409, 'DESKTOP_READY_TIMEOUT');
            await assertCurrent();
            await this.verified(id, binding, executionSignal);
            await assertCurrent(); captured(binding, values);
            output.write('KDE Desktop 已在原项目 UID 和完整会话域中就绪。\n');
            return { code: 0, stdout: '', stderr: '' };
          } catch (error) {
            try { await this.stop(id); }
            catch (cleanup) {
              if (cleanup instanceof AppError && cleanup.status === 503) throw cleanup;
              throw new AppError('Desktop 启动回滚未确认，原完整票据保留', 503, 'DESKTOP_CLEANUP_FAILED');
            }
            if (error instanceof AppError && error.status === 503) throw error;
            throw new AppError(redactValues((error as Error).message, values), error instanceof AppError ? error.status : 400,
              error instanceof AppError ? error.code : undefined);
          } finally { output.flush(); }
        });
      } catch (error) {
        if (pending && error instanceof AppError && error.status === 503) pending.retained = true;
        throw error;
      } finally {
        if (pending?.retained) {
          // Keep both the original reservation and its configuration guard.
          // close() would wait for this task lease, so it also waits for retry.
        } else if (pending) await this.releasePending(id, pending.runId);
        else { try { await prepared?.release(); } finally { await terminals.close(); } }
      }
    });
  }
  /**
   * 入口 / Entry: ProjectDesktops.command.
   * 功能：在管理项目桌面的启动、恢复与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `desktopProjectCommand('stream', this.proof(binding))` 供上层消费（`ProjectDesktops`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectDesktops`; this entry produces `desktopProjectCommand('stream', this.proof(binding))` for its caller. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
   * 处理：通过 `this.bindings.read`, `legacy`, `this.workspaces.projects.current`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.bindings.read`, `legacy`, `this.workspaces.projects.current`, `changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; requestedProject: string | null optional; readOnly: default=false
   * 输出 / Returns: `desktopProjectCommand('stream', this.proof(binding))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!binding || binding.version !== 2`; `selected !== binding.projectId`; 异常 / errors `legacy()`; `changed()`.
   */
  async command(id: string, requestedProject?: string | null, readOnly = false) {
    const binding = await this.bindings.read(id);
    if (!binding || binding.version !== 2) throw legacy();
    const selected = readOnly && !requestedProject ? binding.projectId : requestedProject || this.workspaces.projects.current(id);
    if (selected !== binding.projectId) throw changed();
    await this.workspaces.projects.with(id, selected, async () => {
      if (projectVersion(await this.workspaces.config(id)) !== binding.configVersion) throw changed();
      await this.verified(id, binding);
    });
    return desktopProjectCommand('stream', this.proof(binding));
  }
  /**
   * 入口 / Entry: ProjectDesktops.application.
   * 功能：在管理项目桌面的启动、恢复与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ project, desktop: desktopAuthoritySchema.parse(this.proof(binding)) as DesktopAuthority, validate, release }` 供上层消费（`ProjectDesktops`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectDesktops`; this entry produces `{ project, desktop: desktopAuthoritySchema.parse(this.proof(binding)) as DesktopAuthority, validate, release }` for its caller. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
   * 处理：通过 `this.workspaces.projects.current`, `this.machines.live.get`, `projectTerminalsFor`, `terminals.prepare` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.projects.current`, `this.machines.live.get`, `projectTerminalsFor`, `terminals.prepare`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ project, desktop: desktopAuthoritySchema.parse(this.proof(binding)) as DesktopAuthority, validate, release }`.
   * 副作用 / Effects: `release`; 更新 / updates `prepared`.
   * 拒绝 / Refusals: 条件 / conditions `!prepared.captured || prepared.captured.live !== live || prepared.projectId !== projectId`; `!binding || binding.version !== 2 || binding.projectId !== projectId || binding.configVersion !== projectVersion(original)`; 异常 / errors `changed()`; `error`.
   * 失败处理：catch 分支执行 `await release();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await release();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async application(id: string) {
    const projectId = this.workspaces.projects.current(id), live = this.machines.live.get(id);
    const terminals = projectTerminalsFor(this.machines, this.workspaces);
    let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
    /**
     * 入口 / Entry: ProjectDesktops.application.release.
     * 功能：在管理项目桌面的启动、恢复与停止中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ProjectDesktops`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectDesktops`; the calls and state transitions below complete the operation. Module context: Owns project desktop startup, recovery and stopping, retaining legacy or unconfirmed cleanup tickets for inspection.
     * 处理：通过 `prepared.release`, `terminals.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `prepared.release`, `terminals.close`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `prepared.release`; `terminals.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 收尾：退出 try 区域时始终执行 `await terminals.close();`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `await terminals.close();`; these steps also apply to exceptional exits.
     */
    const release = async () => { try { await prepared?.release(); } finally { await terminals.close(); } };
    try {
      prepared = await terminals.prepare(id, projectId, null, false, undefined, undefined, { mode: 'task' });
      if (!prepared.captured || prepared.captured.live !== live || prepared.projectId !== projectId) throw changed();
      const original = cloneProject(prepared.captured.project), binding = await this.bindings.read(id);
      if (!binding || binding.version !== 2 || binding.projectId !== projectId || binding.configVersion !== projectVersion(original)) throw changed();
      /**
       * 入口 / Entry: ProjectDesktops.application.validate.
       * 功能：把本层请求转交 `this.workspaces.projects.inScope`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.workspaces.projects.inScope` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `this.workspaces.projects.inScope(id, projectId, async () => { this.assertLive(id, live!); if (projectVersion(await this.works…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const validate = async () => this.workspaces.projects.inScope(id, projectId, async () => {
        this.assertLive(id, live!);
        if (projectVersion(await this.workspaces.config(id)) !== binding.configVersion) throw changed();
        await this.verified(id, binding, prepared!.signal);
      });
      await validate();
      const project = await this.workspaces.resolveProject(id, original);
      await validate();
      const { build: _build, ...desktop } = this.proof(binding);
      return { project, desktop: desktopAuthoritySchema.parse(this.proof(binding)) as DesktopAuthority, validate, release };
    } catch (error) { await release(); throw error; }
  }
}
