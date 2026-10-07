/**
 * 模块职责：管理桌面服务及 RFB 通道，协调项目桌面、单应用和剪贴板资源的关闭。
 * Module purpose: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { createWebSocketStream, WebSocket } from 'ws';
import { Transform } from 'node:stream';
import type { ClientChannel } from 'ssh2';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { type DesktopView } from '../shared/contracts/vm.ts';
import {
  defaultDesktopPreferences,
  desktopPreferencesSchema,
  parseDesktopPreferencesFile,
  type DesktopPreferences,
} from '../shared/desktop-preferences.ts';
import { desktopCommands, imeInstall } from './desktop-guest.ts';
import { guestTask } from './guest-task.ts';
import { ReadOnlyRfb } from './readonly-rfb.ts';
import { closeSocket, SOCKET_CLIENT_BYTES, SOCKET_SERVER_BYTES } from '../shared/contracts/websocket.ts';
import { SingleAppWindows } from './single-app-windows.ts';
import { projectPrivateValues } from './workspaces.ts';
import { DesktopBindings, desktopServiceStop, type DesktopBinding } from './desktop-binding.ts';
import { redactValues } from './secrets.ts';
import { uidCleanupScript } from './single-app-sandbox.ts';
import { X11Clipboard } from './x11-clipboard.ts';
import { WaylandClipboard } from './wayland-clipboard.ts';
import { ProjectDesktops, type DesktopStartPins } from './desktop-project.ts';

type Operation = {
  startedAt: string;
  live?: DesktopStartPins['live'];
  abort: AbortController;
  view: DesktopView;
  privateValues?: string[];
  done?: Promise<void>;
};

export class Desktops {
  readonly apps: SingleAppWindows;
  readonly clipboard: X11Clipboard;
  readonly waylandClipboard: WaylandClipboard;
  private operations = new Map<string, Operation>();
  private pending = new Set<Promise<void>>();
  private closed = false;
  private bindings: DesktopBindings;
  private projectDesktop?: ProjectDesktops;
  /**
   * 签名 / Signature: Desktops.unguard.
   * 功能：为管理桌面服务及 RFB 通道声明 unguard 的输入与结果契约，所属容器为 Desktops。
   * Purpose: Declares the input/result contract for unguard in Desktops. Module responsibility: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private unguard?: () => void;
  private watchers = new Map<string, { startedAt: string; listeners: Set<
  /**
   * 中文功能：为 Desktops.watchers.listeners 登记事件、状态变化或阶段结束通知，接收本声明规定的事件数据。
   * English: Registers event/state-change/phase-completion notification for Desktops.watchers.listeners using its declared event data.
   * 所属 / Owner: Desktops.watchers.listeners.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void`.
   */
  () => void> }>();
  private recovery = new Map<string, string>();
  private installed = new Set<string>();
  private initialized = false;
  /**
   * 入口 / Entry: Desktops.constructor.
   * 功能：建立 Desktops 的管理桌面服务及 RFB 通道上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Desktops context for this module's responsibility: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1 optional; options: ConstructorParameters<typeof ProjectDesktops>[2] & { deferInitialization?: boolean } optional
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.apps`, `this.bindings`, `this.projectDesktop`, `this.clipboard`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private machines: Machines, private workspaces?: WorkspacesV1,
    options?: ConstructorParameters<typeof ProjectDesktops>[2] & { deferInitialization?: boolean }) {
    this.apps = new SingleAppWindows(machines, workspaces, { deferInitialization: true });
    this.bindings = new DesktopBindings(machines);
    this.projectDesktop = workspaces ? new ProjectDesktops(machines, workspaces, { ...options,
      /**
       * 入口 / Entry: Desktops.constructor.beforeRetire.
       * 功能：在管理桌面服务及 RFB 通道中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Desktops`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `Desktops`; the calls and state transitions below complete the operation. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
       * 处理：通过 `this.clipboard.retireDesktop`, `this.waylandClipboard.retireDesktop`, `options.beforeRetire` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.clipboard.retireDesktop`, `this.waylandClipboard.retireDesktop`, `options.beforeRetire`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: id; proof
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      beforeRetire: async (id, proof) => {
        await this.clipboard.retireDesktop(id, proof);
        await this.waylandClipboard.retireDesktop(id, proof);
        await options?.beforeRetire?.(id, proof);
      } }) : undefined;
    /**
     * 入口 / Entry: Desktops.constructor.applicationProject.
     * 功能：在管理桌面服务及 RFB 通道中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.projectDesktop.application(id)` 供上层消费（`Desktops`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `Desktops`; this entry produces `this.projectDesktop.application(id)` for its caller. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
     * 处理：通过 `this.projectDesktop.application` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.projectDesktop.application`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: id: string
     * 输出 / Returns: `this.projectDesktop.application(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!this.projectDesktop`; 异常 / errors `new AppError('请先启用项目工作区', 409)`.
     */
    const applicationProject = async (id: string) => {
      if (!this.projectDesktop) throw new AppError('请先启用项目工作区', 409);
      return this.projectDesktop.application(id);
    };
    this.clipboard = new X11Clipboard(machines, applicationProject);
    this.waylandClipboard = new WaylandClipboard(machines, applicationProject);
    if (!options?.deferInitialization) this.init();
  }
  /**
   * 入口 / Entry: Desktops.init.
   * 功能：在管理桌面服务及 RFB 通道中，初始化并核对当前领域状态；本入口产生 `void` 供上层消费（`Desktops`）。
   * Purpose: Initializes and verifies current domain state in `Desktops`; this entry produces `void` for its caller. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
   * 处理：通过 `this.workspaces.beforeConfigChange`, `this.machines.on`, `this.apps.init`, `this.machines.off` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.beforeConfigChange`, `this.machines.on`, `this.apps.init`, `this.machines.off`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.initialized`; `this.workspaces`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `this.unguard`, `this.initialized`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; 异常 / errors `new AppError('桌面服务已关闭', 503)`; `error`.
   * 失败处理：catch 分支执行 `this.machines.off('change', this.onChange);`; `this.machines.off('incident-lockdown', this.invalidate);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.machines.off('change', this.onChange);`; `this.machines.off('incident-lockdown', this.invalidate);`; these statements determine whether a failure is absorbed or rejected again.
   */
  init() {
    if (this.closed) throw new AppError('桌面服务已关闭', 503);
    if (this.initialized) return;
    try {
      this.unguard = this.workspaces?.beforeConfigChange((id, previous, next) => this.projectDesktop!.beforeChange(id, previous, next));
      this.machines.on('change', this.onChange);
      this.machines.on('incident-lockdown', this.invalidate);
      this.apps.init();
      this.initialized = true;
    } catch (error) {
      this.machines.off('change', this.onChange);
      this.machines.off('incident-lockdown', this.invalidate);
      this.unguard?.();
      this.unguard = undefined;
      throw error;
    }
    if (this.workspaces) queueMicrotask(() => { if (!this.closed) this.onChange(); });
  }
  /**
   * 入口 / Entry: Desktops.invalidate.
   * 功能：在管理桌面服务及 RFB 通道中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Desktops`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Desktops`; the calls and state transitions below complete the operation. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
   * 处理：通过 `this.watchers.get`, `this.watchers.delete`, `listener` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.watchers.get`, `this.watchers.delete`, `listener`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.watchers.delete`; `listener`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private invalidate = (id: string) => {
    const watchers = this.watchers.get(id);
    this.watchers.delete(id);
    for (const listener of watchers?.listeners || []) listener();
  };
  /**
   * 入口 / Entry: Desktops.onChange.
   * 功能：在管理桌面服务及 RFB 通道中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Desktops`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Desktops`; the calls and state transitions below complete the operation. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
   * 处理：通过 `this.machines.live.get`, `operation.abort.abort`, `this.operations.delete`, `this.invalidate` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.live.get`, `operation.abort.abort`, `this.operations.delete`, `this.invalidate`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `live?.status !== 'running' || live.startedAt !== operation.startedAt`; `live?.status !== 'running' || live.startedAt !== watchers.startedAt`; `live.status !== 'running' || this.recovery.get(id) === live.startedAt`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `operation.abort.abort`; `this.operations.delete`; `this.recovery.set`; `this.pending.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private onChange = () => {
    for (const [id, operation] of this.operations) {
      const live = this.machines.live.get(id);
      if (live?.status !== 'running' || live.startedAt !== operation.startedAt) {
        operation.abort.abort();
        this.operations.delete(id);
      }
    }
    for (const [id, watchers] of this.watchers) {
      const live = this.machines.live.get(id);
      if (live?.status !== 'running' || live.startedAt !== watchers.startedAt) this.invalidate(id);
    }
    for (const [id, live] of this.machines.live) {
      if (live.status !== 'running' || this.recovery.get(id) === live.startedAt) continue;
      this.recovery.set(id, live.startedAt);
      const recovered = this.restore(id).catch((error: Error) => {
        if (!this.closed && this.machines.live.get(id) === live && !this.operations.has(id))
          this.operations.set(id, { startedAt: live.startedAt, abort: new AbortController(),
            view: { status: 'error', log: '', error: `桌面自动恢复失败：${error.message}`,
              ...(error instanceof AppError && error.status === 503 ? { cleanupPending: true } : {}),
              preferences: defaultDesktopPreferences } });
      });
      this.pending.add(recovered);
      void recovered.finally(() => this.pending.delete(recovered));
    }
  };

  /**
   * 入口 / Entry: Desktops.restore.
   * 功能：在管理桌面服务及 RFB 通道中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`Desktops`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Desktops`; this entry produces `void` for its caller. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
   * 处理：通过 `this.operations.has`, `this.installed.has`, `this.start`, `inline.restore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.operations.has`, `this.installed.has`, `this.start`, `inline.restore`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || this.operations.has(id)`; `!this.workspaces`; `this.installed.has(id)`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.installed.has`; `this.start`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async restore(id: string) {
    if (this.closed || this.operations.has(id)) return;
    if (!this.workspaces) {
      if (this.installed.has(id)) this.start(id, 'start');
      return;
    }
    const restored = await this.projectDesktop!.restore(id);
    if (!restored || this.closed || this.operations.has(id)) return;
    await this.workspaces.projects.with(id, restored.projectId, async () => {
      if (!this.closed && this.machines.state(id) === 'running') this.start(id, 'start', restored.preferences);
    });
  }
  /**
   * 入口 / Entry: Desktops.close.
   * 功能：在管理桌面服务及 RFB 通道中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`Desktops`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Desktops`; the outcome is recorded in `this.closed`. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
   * 处理：通过 `this.machines.off`, `this.watchers.keys`, `this.invalidate`, `this.operations.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.off`, `this.watchers.keys`, `this.invalidate`, `this.operations.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `operation.abort.abort`; `this.apps.close`; `this.clipboard.close`; `this.waylandClipboard.close`; `this.operations.clear`; 更新 / updates `this.closed`.
   * 拒绝 / Refusals: 条件 / conditions `failures.length`; 异常 / errors `new AggregateError(failures.map(result => result.reason), '桌面与应用原运行清理未确认；保留原记录并重试关闭')`.
   */
  async close() {
    this.closed = true;
    this.machines.off('change', this.onChange);
    this.machines.off('incident-lockdown', this.invalidate);
    for (const id of this.watchers.keys()) this.invalidate(id);
    for (const operation of this.operations.values()) operation.abort.abort();
    const results = await Promise.allSettled([this.apps.close(), this.clipboard.close(), this.waylandClipboard.close(), ...this.pending]);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason),
      '桌面与应用原运行清理未确认；保留原记录并重试关闭');
    this.operations.clear();
    this.recovery.clear();
    this.unguard?.();
  }

  /**
   * 入口 / Entry: Desktops.stopService.
   * 功能：在管理桌面服务及 RFB 通道中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.projectDesktop.stop(id)` 供上层消费（`Desktops`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Desktops`; this entry produces `this.projectDesktop.stop(id)` for its caller. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
   * 处理：通过 `this.invalidate`, `this.projectDesktop.stop`, `this.bindings.read().catch`, `this.bindings.read` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.invalidate`, `this.projectDesktop.stop`, `this.bindings.read().catch`, `this.bindings.read`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.projectDesktop`; `binding?.enabled`; `corrupted`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.projectDesktop.stop(id)`.
   * 副作用 / Effects: `this.projectDesktop.stop`; `this.machines.exec`; `this.bindings.clear`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError('无法停止 KDE 桌面及自动启动服务', 409)`.
   */
  private async stopService(id: string) {
    this.invalidate(id);
    if (this.projectDesktop) return this.projectDesktop.stop(id);
    let corrupted = false;
    const binding = this.workspaces ? await this.bindings.read(id).catch(() => { corrupted = true; return null; }) : null;
    if (binding?.enabled) await this.bindings.enable(id, binding, false);
    const result = await this.machines.exec(id, `set -eu\n${desktopServiceStop(this.machines.get(id).distro)}\n` +
      `if id sakura-desktop >/dev/null 2>&1; then\n` +
      `export SAKURA_DESKTOP_UID="$(id -u sakura-desktop)"\n` +
      `${uidCleanupScript(1000, 'SAKURA_DESKTOP_UID')}\nfi`, 30000);
    if (result.code !== 0) throw new AppError('无法停止 KDE 桌面及自动启动服务', 409);
    if (corrupted) await this.bindings.clear(id);
  }

  /**
   * 入口 / Entry: Desktops.stop.
   * 功能：在管理桌面服务及 RFB 通道中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.machines.locked(id, async () => { if (this.machines.state(id) !== 'running') throw new AppError('请先恢复或启动实例，再停止桌面', 409);…` 供上层消费（`Desktops`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Desktops`; this entry produces `this.machines.locked(id, async () => { if (this.machines.state(id) !== 'running') throw new AppError('请先恢复或启动实例，再停止桌面', 409);…` for its caller. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
   * 处理：通过 `this.operations.get`, `operation.abort.abort`, `this.machines.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.operations.get`, `operation.abort.abort`, `this.machines.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.machines.locked(id, async () => { if (this.machines.state(id) !== 'running') throw new AppError('请先恢复或启动实例，再停止桌面', 409);…`.
   * 副作用 / Effects: `operation.abort.abort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async stop(id: string) {
    const operation = this.operations.get(id);
    operation?.abort.abort();
    await operation?.done;
    /**
     * 入口 / Entry: Desktops.stop.callback@166.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ stopped: true }`.
     * 副作用 / Effects: `this.stopService`; `this.operations.delete`.
     * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('请先恢复或启动实例，再停止桌面', 409)`.
     */
    return this.machines.locked(id, async () => {
      if (this.machines.state(id) !== 'running') throw new AppError('请先恢复或启动实例，再停止桌面', 409);
      await this.stopService(id);
      this.operations.delete(id);
      return { stopped: true };
    });
  }

  /**
   * 入口 / Entry: Desktops.view.
   * 功能：在管理桌面服务及 RFB 通道中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ status: 'unavailable', log: '', preferences: defaultDesktopPreferences }` / `{ ...operation.view, ...(this.workspaces && !bound ? { bindingMismatch: operation.view.projectId !== this.workspaces.projects…` 供上层消费（`Desktops`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Desktops`; this entry produces `{ status: 'unavailable', log: '', preferences: defaultDesktopPreferences }` / `{ ...operation.view, ...(this.workspaces && !bound ? { bindingMismatch: operation.view.projectId !== this.workspaces.projects…` for its caller. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
   * 处理：通过 `this.machines.get`, `this.machines.state`, `this.operations.get`, `this.workspaces.projects.current` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.state`, `this.operations.get`, `this.workspaces.projects.current`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.machines.state(id) !== 'running'`; `operation`; `this.projectDesktop`.
   * 输入 / Inputs: id: string; bound: default=false
   * 输出 / Returns: Promise<DesktopView>；结果来自 / values from `{ status: 'unavailable', log: '', preferences: defaultDesktopPreferences }`; `{ ...operation.view, ...(this.workspaces && !bound ? { bindingMismatch: operation.view.projectId !== this.workspaces.projects…`; `this.projectDesktop.view(id, bound)`.
   * 副作用 / Effects: `this.machines.exec`; 更新 / updates `preferences`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0 || !['not-installed', 'starting', 'ready', 'stopped'].includes(status)`; 异常 / errors `new AppError('无法检查桌面状态，请重试', 502)`.
   * 失败处理：catch 分支执行 ，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute ; these statements determine whether a failure is absorbed or rejected again.
   */
  async view(id: string, bound = false): Promise<DesktopView> {
    const vm = this.machines.get(id);
    if (this.machines.state(id) !== 'running')
      return { status: 'unavailable', log: '', preferences: defaultDesktopPreferences };
    const operation = this.operations.get(id);
    if (operation) return { ...operation.view, ...(this.workspaces && !bound ? {
      bindingMismatch: operation.view.projectId !== this.workspaces.projects.current(id) } : {}) };
    if (this.projectDesktop) return this.projectDesktop.view(id, bound);
    const binding: DesktopBinding | null = null;
    const commands = desktopCommands(vm.distro, defaultDesktopPreferences);
    const result = await this.machines.exec(id, commands.probe, 10000);
    const status = result.stdout.trim();
    if (result.code !== 0 || !['not-installed', 'starting', 'ready', 'stopped'].includes(status))
      throw new AppError('无法检查桌面状态，请重试', 502);
    let preferences = defaultDesktopPreferences;
    try {
      const config = await this.machines.exec(id, commands.preferencesProbe, 10000);
      if (config.code === 0) preferences = parseDesktopPreferencesFile(config.stdout);
    } catch {
      // A status check remains useful when an older desktop has no preferences file.
    }
    return { status: status as DesktopView['status'], log: '', preferences };
  }

  /**
   * 入口 / Entry: Desktops.start.
   * 功能：在管理桌面服务及 RFB 通道中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...previous.view }` / `{ ...operation.view }` 供上层消费（`Desktops`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Desktops`; this entry produces `{ ...previous.view }` / `{ ...operation.view }` for its caller. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
   * 处理：通过 `this.machines.get`, `this.machines.live.get`, `this.operations.get`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.live.get`, `this.operations.get`, `inline.includes`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; action: 'install' | 'start' | 'configure'; input: Partial<DesktopPreferences> optional
   * 输出 / Returns: DesktopView；结果来自 / values from `{ ...previous.view }`; `{ ...operation.view }`.
   * 副作用 / Effects: `this.operations.set`; `execute`; `this.pending.add`; 更新 / updates `operation.done`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed || this.machines.closing || live?.status !== 'running'`; `previous && ['installing', 'starting'].includes(previous.view.status)`; `this.workspaces && previous.view.projectId !== this.workspaces.projects.current(id)`; 异常 / errors `new AppError('请等待发行版启动完成，再启用桌面', 409)`; `new AppError('另一项目的桌面操作正在进行', 409)`.
   */
  start(
    id: string,
    action: 'install' | 'start' | 'configure',
    input?: Partial<DesktopPreferences>,
  ): DesktopView {
    const vm = this.machines.get(id);
    const live = this.machines.live.get(id);
    if (this.closed || this.machines.closing || live?.status !== 'running')
      throw new AppError('请等待发行版启动完成，再启用桌面', 409);
    const previous = this.operations.get(id);
    if (previous && ['installing', 'starting'].includes(previous.view.status)) {
      if (this.workspaces && previous.view.projectId !== this.workspaces.projects.current(id))
        throw new AppError('另一项目的桌面操作正在进行', 409);
      return { ...previous.view };
    }
    if (vm.memoryMiB < 1024)
      throw new AppError('图形桌面至少需要 1024 MiB 内存；请停机后在「配置」中调整，建议 2048 MiB', 409);
    const capturedInput = input === undefined ? undefined : structuredClone(input);
    const preferences = desktopPreferencesSchema.parse(capturedInput || {});
    const commands = desktopCommands(vm.distro, preferences);
    const status = action === 'install' ? 'installing' : 'starting';
    const operation: Operation = {
      startedAt: live.startedAt,
      live,
      abort: new AbortController(),
      view: {
        status,
        preferences,
        ...(this.workspaces ? { projectId: this.workspaces.projects.current(id) } : {}),
        log:
          action === 'install'
            ? '正在准备 KDE Plasma 桌面安装…\n'
            : action === 'configure'
              ? '正在应用 KDE Plasma 外观配置…\n'
              : '正在启动 KDE Plasma 桌面…\n',
      },
    };
    this.operations.set(id, operation);
    /**
     * 入口 / Entry: Desktops.start.execute.
     * 功能：从当前输入或状态计算 `this.machines.exec( id, action === 'install' ? commands.install : action === 'configure' ? commands.configure : input === und…`，供调用方后续验证或使用。
     * Purpose: Computes `this.machines.exec( id, action === 'install' ? commands.install : action === 'configure' ? commands.configure : input === und…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.machines.exec( id, action === 'install' ? commands.install : action === 'configure' ? commands.configure : input === und…`.
     * 副作用 / Effects: `this.machines.exec`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const execute = () => this.machines.exec(
        id,
        action === 'install'
          ? commands.install
          : action === 'configure'
            ? commands.configure
            : input === undefined
              ? commands.start
              : commands.startWithPreferences,
        action === 'install' ? 920000 : action === 'configure' ? 180000 : 150000,
        operation.abort.signal,
        (data) => {
          operation.view.log = (operation.view.log + data).slice(-16384);
        },
      );
    const pending = (this.workspaces ? this.scopedStart(id, action, capturedInput, operation) : execute())
      .then((result) => {
        if (result.code !== 0)
          throw new Error(result.stderr.trim() || `桌面操作失败（退出码 ${result.code}）`);
        if (this.operations.get(id) === operation) this.operations.delete(id);
        this.installed.add(id);
      })
      .catch((error: Error) => {
        if (!operation.abort.signal.aborted || error instanceof AppError && error.status === 503) {
          operation.view.status = 'error';
          operation.view.error = redactValues(error.message, operation.privateValues || []);
          operation.view.cleanupPending = error instanceof AppError && error.status === 503;
        }
      });
    this.pending.add(pending);
    operation.done = pending;
    void pending.finally(() => this.pending.delete(pending));
    return { ...operation.view };
  }

  /**
   * 入口 / Entry: Desktops.scopedStart.
   * 功能：把本层请求转交 `inline.start`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `inline.start` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; action: 'install' | 'start' | 'configure'; input: Partial<DesktopPreferences> | undefined; operation: Operation
   * 输出 / Returns: `this.projectDesktop!.start(id, action, input, { projectId: operation.view.projectId!, live: operation.live! }, operation.abor…`.
   * 副作用 / Effects: `inline.start`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private scopedStart(id: string, action: 'install' | 'start' | 'configure', input: Partial<DesktopPreferences> | undefined,
    operation: Operation) {
    return this.projectDesktop!.start(id, action, input, { projectId: operation.view.projectId!, live: operation.live! },
      operation.abort.signal, (data) => { operation.view.log = (operation.view.log + data).slice(-16384); },
      (binding, values) => {
        operation.privateValues = values;
        Object.assign(operation.view, { projectId: binding.projectId, directory: binding.directory,
          networkIsolation: binding.networkIsolation, preferences: binding.preferences });
      });
  }

  /**
   * 入口 / Entry: Desktops.installIme.
   * 功能：在管理桌面服务及 RFB 通道中，执行此领域的具体处理步骤并返回其结果；本入口产生 `running` 供上层消费（`Desktops`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Desktops`; this entry produces `running` for its caller. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
   * 处理：通过 `this.machines.live.get`, `this.workspaces.projects.current`, `this.machines.get`, `signal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.live.get`, `this.workspaces.projects.current`, `this.machines.get`, `signal.throwIfAborted`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal; log: (line: string) => void
   * 输出 / Returns: `running`.
   * 副作用 / Effects: `this.operations.set`; `signal.addEventListener`; `this.projectDesktop.start`; `this.pending.add`; 更新 / updates `operation.done`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed || this.machines.closing || live?.status !== 'running'`; `previous && ['installing', 'starting'].includes(previous.view.status)`; 异常 / errors `new AppError('请先恢复或启动实例，再安装输入法', 409)`; `new AppError('桌面操作正在进行，请等待原操作完成', 409)`.
   */
  async installIme(id: string, signal: AbortSignal, log: (line: string) => void) {
    const live = this.machines.live.get(id), projectId = this.workspaces?.projects.current(id);
    const vm = this.machines.get(id);
    signal.throwIfAborted();
    if (this.closed || this.machines.closing || live?.status !== 'running')
      throw new AppError('请先恢复或启动实例，再安装输入法', 409);
    const previous = this.operations.get(id);
    if (previous && ['installing', 'starting'].includes(previous.view.status))
      throw new AppError('桌面操作正在进行，请等待原操作完成', 409);
    const operation: Operation = { startedAt: live.startedAt, live, abort: new AbortController(),
      view: { status: 'installing', log: '', preferences: defaultDesktopPreferences, ...(projectId ? { projectId } : {}) } };
    this.operations.set(id, operation);
    /**
     * 入口 / Entry: Desktops.installIme.abort.
     * 功能：把本层请求转交 `operation.abort.abort`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `operation.abort.abort` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `operation.abort.abort(signal.reason)`.
     * 副作用 / Effects: `operation.abort.abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const abort = () => operation.abort.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    /**
     * 入口 / Entry: Desktops.installIme.output.
     * 功能：在管理桌面服务及 RFB 通道中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `operation.view.log`（`Desktops`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `Desktops`; the outcome is recorded in `operation.view.log`. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
     * 处理：通过 `redactValues`, `inline.slice`, `log` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `redactValues`, `inline.slice`, `log`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: line: string
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `operation.view.log`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const output = (line: string) => {
      const value = redactValues(line, operation.privateValues || []);
      operation.view.log = (operation.view.log + value).slice(-16384); log(value);
    };
    /**
     * 入口 / Entry: Desktops.installIme.callback@308.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline.then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline.then).
     * 输入 / Inputs: result
     * 输出 / Returns: `result`.
     * 副作用 / Effects: `this.operations.delete`; `this.installed.add`.
     * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError(result.stderr.trim() || '输入法安装失败（退出码 ' + result.code + '）', 409)`.
     */
    const running = (this.projectDesktop
      ? this.projectDesktop.start(id, 'ime', undefined, { projectId: projectId!, live }, operation.abort.signal, output,
        (binding, values) => {
          operation.privateValues = values;
          Object.assign(operation.view, { projectId: binding.projectId, directory: binding.directory,
            networkIsolation: binding.networkIsolation, preferences: binding.preferences });
        })
      : guestTask(this.machines, id, imeInstall(vm.distro), operation.abort.signal, output))
      .then(result => {
        if (result.code !== 0) throw new AppError(result.stderr.trim() || '输入法安装失败（退出码 ' + result.code + '）', 409);
        if (this.operations.get(id) === operation) this.operations.delete(id);
        this.installed.add(id);
        return result;
      }).catch((error: Error) => {
        if (!operation.abort.signal.aborted || error instanceof AppError && error.status === 503) {
          operation.view.status = 'error'; operation.view.error = redactValues(error.message, operation.privateValues || []);
          operation.view.cleanupPending = error instanceof AppError && error.status === 503;
        }
        throw error;
      }).finally(() => signal.removeEventListener('abort', abort));
    const completion = running.then(() => {}, () => {});
    operation.done = completion; this.pending.add(completion);
    void completion.finally(() => this.pending.delete(completion));
    return running;
  }

  /**
   * 入口 / Entry: Desktops.desktopCommand.
   * 功能：在管理桌面服务及 RFB 通道中，执行此领域的具体处理步骤并返回其结果；本入口产生 `'exec nc 127.0.0.1 5901'` / `this.projectDesktop.command(id, requestedProject, readOnly)` 供上层消费（`Desktops`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Desktops`; this entry produces `'exec nc 127.0.0.1 5901'` / `this.projectDesktop.command(id, requestedProject, readOnly)` for its caller. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
   * 处理：通过 `this.projectDesktop.command` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.projectDesktop.command`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.projectDesktop`.
   * 输入 / Inputs: id: string; requestedProject: string | null optional; readOnly: default=false
   * 输出 / Returns: `'exec nc 127.0.0.1 5901'`; `this.projectDesktop.command(id, requestedProject, readOnly)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async desktopCommand(id: string, requestedProject?: string | null, readOnly = false) {
    if (!this.projectDesktop) return 'exec nc 127.0.0.1 5901';
    return this.projectDesktop.command(id, requestedProject, readOnly);
  }

  /**
   * 入口 / Entry: Desktops.attach.
   * 功能：通过受控 SSH 通道连接桌面 RFB 与 WebSocket，按只读模式过滤客户机输入。
   * Purpose: Bridges desktop RFB and WebSocket over controlled SSH, filtering input for read-only access.
   * 设计：断开及会话失效回收两端资源；拒绝消息在进入 SSH 前销毁，旧 SSH 不支持转发时使用固定 netcat 传输。
   * Design: Disconnect/session invalidation close both ends; rejected bytes are destroyed before SSH, with fixed netcat fallback for unsupported forwarding.
   * 输入 / Inputs: id: string; socket: WebSocket; readOnly: default=false; port: default=5901; appSession: string optional; projectId: string | null optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.apps.connectionCommand`; `this.machines.connect`; `close`; `channel.destroy`; `createWebSocketStream`; 更新 / updates `browser`.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isInteger(port) || port < 5901 || port > 5917 || (!appSession && port !== 5901)`; `this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('无效的桌面端口', 400)`; `new AppError('发行版尚未就绪', 409)`.
   * 失败处理：catch 分支执行 `close();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `close();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async attach(id: string, socket: WebSocket, readOnly = false, port = 5901,
    appSession?: string, projectId?: string | null) {
    if (!Number.isInteger(port) || port < 5901 || port > 5917 || (!appSession && port !== 5901))
      throw new AppError('无效的桌面端口', 400);
    const abort = new AbortController();
    if (socket.readyState !== WebSocket.OPEN) return;
    let browser: ReturnType<typeof createWebSocketStream> | undefined;
    /**
     * 入口 / Entry: Desktops.attach.binaryFrame.
     * 功能：在管理桌面服务及 RFB 通道中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Desktops`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `Desktops`; the calls and state transitions below complete the operation. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
     * 处理：通过 `raw.reduce`, `browser.destroy`, `closeSocket` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `raw.reduce`, `browser.destroy`, `closeSocket`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `!binary || bytes > SOCKET_CLIENT_BYTES`.
     * 输入 / Inputs: raw: import('ws').RawData; binary: boolean
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `browser.destroy`; `closeSocket`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const binaryFrame = (raw: import('ws').RawData, binary: boolean) => {
      const bytes = Array.isArray(raw) ? raw.reduce((sum, part) => sum + part.byteLength, 0) : raw.byteLength;
      if (!binary || bytes > SOCKET_CLIENT_BYTES) {
        // Destroy before ws's stream listener sees this message; rejected bytes never reach SSH.
        browser?.destroy();
        closeSocket(socket, binary ? 'messageTooLarge' : 'binaryRfbRequired');
      }
    };
    socket.prependListener('message', binaryFrame);
    socket.once('close', () => socket.off('message', binaryFrame));
    /**
     * 入口 / Entry: Desktops.attach.callback@349.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `() => { watchers.listeners.delete(listener); if (!watchers.listeners.size && this.watchers.get(id) === watchers) this.watcher…`.
     * 副作用 / Effects: `watchers.listeners.add`; `this.watchers.set`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const stopWatching = appSession
      ? this.apps.onSessionInvalidated(id, appSession, () => socket.terminate()) : (() => {
        const watchers = this.watchers.get(id) || { startedAt: this.machines.live.get(id)?.startedAt || '', listeners: new Set<
        /**
         * 中文功能：为 Desktops.attach.stopWatching.watchers.listeners 登记事件、状态变化或阶段结束通知，接收本声明规定的事件数据。
         * English: Registers event/state-change/phase-completion notification for Desktops.attach.stopWatching.watchers.listeners using its declared event data.
         * 所属 / Owner: Desktops.attach.stopWatching.watchers.listeners.
         * 输入 / Inputs: 无显式参数 / no explicit parameters.
         * 结果 / Result: `void`.
         */
        () => void>() };
        /**
         * 入口 / Entry: Desktops.attach.listener.
         * 功能：把本层请求转交 `socket.terminate`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `socket.terminate` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `socket.terminate()`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const listener = () => socket.terminate();
        watchers.listeners.add(listener); this.watchers.set(id, watchers);
        return () => { watchers.listeners.delete(listener); if (!watchers.listeners.size && this.watchers.get(id) === watchers) this.watchers.delete(id); };
      })();
    socket.once('close', () => { abort.abort(); stopWatching?.(); });
    if (this.machines.state(id) !== 'running') throw new AppError('发行版尚未就绪', 409);
    const command = appSession
      ? await this.apps.connectionCommand(id, appSession, port) : await this.desktopCommand(id, projectId, readOnly);
    const ssh = await this.machines.connect(id, 10000, abort.signal);
    /**
     * 入口 / Entry: Desktops.attach.close.
     * 功能：在管理桌面服务及 RFB 通道中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`Desktops`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `Desktops`; the calls and state transitions below complete the operation. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
     * 处理：通过 `ssh.destroy`, `socket.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `ssh.destroy`, `socket.close`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `ssh.destroy`; `socket.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const close = () => {
      ssh.destroy();
      socket.close();
    };
    socket.once('close', close);
    ssh.once('close', () => socket.close());
    ssh.on('error', close);
    if (socket.readyState !== WebSocket.OPEN) {
      close();
      return;
    }
    try {
      const channel = await new Promise<ClientChannel>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('桌面连接超时')), 10000);
        // Alpine Tiny Cloud disables TCP forwarding. An exec channel to its
        // built-in netcat carries the same binary stream without changing sshd.
        ssh.exec(command, (error, stream) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(stream);
        });
      });
      if (socket.readyState !== WebSocket.OPEN) {
        channel.destroy();
        close();
        return;
      }
      // Duplex streams enforce backpressure for both graphics and input. The target
      // is fixed to the guest loopback; this endpoint is not an arbitrary TCP proxy.
      browser = createWebSocketStream(socket);
      const frames = new Transform({
      /**
       * 入口 / Entry: Desktops.attach.transform.
       * 功能：在管理桌面服务及 RFB 通道中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Desktops`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `Desktops`; the calls and state transitions below complete the operation. Module context: Owns desktop services and RFB channels, coordinating project desktops, single applications and clipboard shutdown.
       * 处理：通过 `this.push`, `chunk.subarray`, `done` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.push`, `chunk.subarray`, `done`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: chunk: Buffer; _encoding; done
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.push`; 更新 / updates `offset`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      transform(chunk: Buffer, _encoding, done) {
        for (let offset = 0; offset < chunk.length; offset += SOCKET_SERVER_BYTES)
          this.push(chunk.subarray(offset, offset + SOCKET_SERVER_BYTES));
        done();
      } });
      browser.on('error', close);
      frames.on('error', close);
      channel.on('error', close);
      browser.once('close', () => {
        frames.destroy();
        channel.destroy();
        close();
      });
      channel.once('close', () => { frames.destroy(); browser?.destroy(); });
      channel.pipe(frames).pipe(browser);
      if (readOnly) {
        const filter = new ReadOnlyRfb();
        filter.on('error', close);
        browser.pipe(filter).pipe(channel);
      } else browser.pipe(channel);
    } catch (error) {
      close();
      throw error;
    }
  }
}
