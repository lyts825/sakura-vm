/**
 * 模块职责：准备并核验项目终端绑定，停止时关联原账户和运行票据而非仅凭会话名称。
 * Module purpose: Prepares/verifies terminal bindings; stopping checks original account/run proofs rather than session names alone.
 */
import type { ProjectPreparationV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { terminalSessionName, terminalSessionPrefix } from '../shared/terminal-scope.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { type Project } from './project-config.ts';
import { ProjectIdentities } from './project-identity.ts';
import { projectNetworkCheckScript, projectNetworkNamespace } from './project-network-isolation.ts';
import { ProjectPreparation, type PreparedProject } from './project-preparation.ts';
import { ProjectRunScopes } from './project-run-scope.ts';
import { terminalShell } from './project-shell.ts';
import { quote } from './shell.ts';
import { Workspaces } from './workspaces.ts';

/**
 * 入口 / Entry: terminalBinding.
 * 功能：在准备并核验项目终端绑定中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(JSON.stringify([project._workspace || 'default', project.directory, project.networkIsolation || '…` 供上层消费（`project-terminals.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-terminals.ts`; this entry produces `createHash('sha256').update(JSON.stringify([project._workspace || 'default', project.directory, project.networkIsolation || '…` for its caller. Module context: Prepares/verifies terminal bindings; stopping checks original account/run proofs rather than session names alone.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `createHash('sha256').update(JSON.stringify([project._workspace || 'default', project.directory, project.networkIsolation || '…`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function terminalBinding(project: Project) {
  return createHash('sha256').update(JSON.stringify([project._workspace || 'default',
    project.directory, project.networkIsolation || 'host'])).digest('hex');
}

export { assertProjectPreparationIdle as assertProjectTerminalsStopped } from './project-preparation.ts';
export { terminalShell } from './project-shell.ts';

/**
 * 入口 / Entry: terminalTargetScript.
 * 功能：从当前输入或状态计算 ``sakura_target=$(tmux list-sessions -F '#{session_name} #{session_id}' | ` + `awk '$1 == "${name}" { print $2 }')\n` + `case …`，供调用方后续验证或使用。
 * Purpose: Computes ``sakura_target=$(tmux list-sessions -F '#{session_name} #{session_id}' | ` + `awk '$1 == "${name}" { print $2 }')\n` + `case …` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: name: string
 * 输出 / Returns: ``sakura_target=$(tmux list-sessions -F '#{session_name} #{session_id}' | ` + `awk '$1 == "${name}" { print $2 }')\n` + `case …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function terminalTargetScript(name: string) {
  // Some tmux commands interpret '=name' literally. Resolve the complete name
  // to its immutable $N identity, which every session command understands.
  return `sakura_target=$(tmux list-sessions -F '#{session_name} #{session_id}' | ` +
    `awk '$1 == "${name}" { print $2 }')\n` +
    `case "$sakura_target" in '$'[0-9]*) ;; *) echo '项目 tmux 会话不存在' >&2; exit 1;; esac\n` +
    `case "\${sakura_target#?}" in ''|*[!0-9]*) exit 1;; esac`;
}

/** Check the actual namespace of every pane, including new windows and splits. */
/**
 * 入口 / Entry: verifyTerminalScript.
 * 功能：在准备并核验项目终端绑定中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``set -eu\n` + (namespace ? `${projectNetworkCheckScript(namespace)}\n` : '') + `${terminalTargetScript(name)}\n` + `test "$(t…` 供上层消费（`project-terminals.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-terminals.ts`; this entry produces ``set -eu\n` + (namespace ? `${projectNetworkCheckScript(namespace)}\n` : '') + `${terminalTargetScript(name)}\n` + `test "$(t…` for its caller. Module context: Prepares/verifies terminal bindings; stopping checks original account/run proofs rather than session names alone.
 * 处理：通过 `terminalSessionName`, `projectNetworkNamespace`, `projectNetworkCheckScript`, `terminalTargetScript` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `terminalSessionName`, `projectNetworkNamespace`, `projectNetworkCheckScript`, `terminalTargetScript`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project; session: string; terminalId: string optional
 * 输出 / Returns: ``set -eu\n` + (namespace ? `${projectNetworkCheckScript(namespace)}\n` : '') + `${terminalTargetScript(name)}\n` + `test "$(t…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function verifyTerminalScript(project: Project, session: string, terminalId?: string) {
  const name = terminalSessionName(project._workspace || 'default', session);
  const namespace = projectNetworkNamespace(project);
  return `set -eu\n` + (namespace ? `${projectNetworkCheckScript(namespace)}\n` : '') +
    `${terminalTargetScript(name)}\n` +
    `test "$(tmux show-environment -t "$sakura_target" SAKURA_TERMINAL_BINDING)" = ` +
      `${quote('SAKURA_TERMINAL_BINDING=' + terminalBinding(project))} || ` +
      `{ echo '终端的项目目录或网络模式已变化，请先停止此项目终端' >&2; exit 1; }\n` +
    (terminalId ? `test "$(tmux show-environment -t "$sakura_target" SAKURA_TERMINAL_ID)" = ` +
      `${quote('SAKURA_TERMINAL_ID=' + z.uuid().parse(terminalId))} || ` +
      `{ echo '原共享终端已结束，请重新授权当前会话' >&2; exit 1; }\n` : '') +
    `sakura_panes=$(tmux list-panes -s -t "$sakura_target" -F '#{pane_pid}')\n` +
    `test -n "$sakura_panes"\n` +
    `sakura_namespace=$(stat -Lc '%i' ${namespace ? '/var/run/netns/' + namespace : '/proc/self/ns/net'})\n` +
    `for sakura_pid in $sakura_panes; do\n` +
    `  case "$sakura_pid" in ''|*[!0-9]*) exit 1;; esac\n` +
    `  test "$(stat -Lc '%i' /proc/$sakura_pid/ns/net)" = "$sakura_namespace" || ` +
      `{ echo '终端窗格未处于项目网络空间，拒绝连接' >&2; exit 1; }\n` +
    `done`;
}

/**
 * 入口 / Entry: stopTerminalsScript.
 * 功能：在准备并核验项目终端绑定中，结束、撤销或清理本次拥有的领域资源；本入口产生 ``set -eu\nif command -v tmux >/dev/null; then\n` + (session ? ` if tmux has-session -t =${terminalSessionName(projectId, sess…` 供上层消费（`project-terminals.ts`）。
 * Purpose: Ends, revokes or cleans resources owned by this domain action in `project-terminals.ts`; this entry produces ``set -eu\nif command -v tmux >/dev/null; then\n` + (session ? ` if tmux has-session -t =${terminalSessionName(projectId, sess…` for its caller. Module context: Prepares/verifies terminal bindings; stopping checks original account/run proofs rather than session names alone.
 * 处理：通过 `terminalSessionPrefix`, `terminalSessionName` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `terminalSessionPrefix`, `terminalSessionName`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: projectId: string; session: string optional
 * 输出 / Returns: ``set -eu\nif command -v tmux >/dev/null; then\n` + (session ? ` if tmux has-session -t =${terminalSessionName(projectId, sess…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function stopTerminalsScript(projectId: string, session?: string) {
  const prefix = terminalSessionPrefix(projectId);
  return `set -eu\nif command -v tmux >/dev/null; then\n` + (session ?
    `  if tmux has-session -t =${terminalSessionName(projectId, session)} 2>/dev/null; then\n` +
      `    tmux kill-session -t =${terminalSessionName(projectId, session)}\n  fi\n` :
    `  if tmux list-sessions -F '#{session_name}' >/dev/null 2>&1; then\n` +
    `    sakura_sessions=$(tmux list-sessions -F '#{session_name}')\n` +
    `    for sakura_session in $sakura_sessions; do\n` +
    `      case "$sakura_session" in ${prefix}*) tmux kill-session -t "=$sakura_session";; esac\n` +
    `    done\n  fi\n`) + `fi`;
}

export class ProjectTerminals {
  readonly workspaces: WorkspacesV1;
  readonly preparation: ProjectPreparationV1;
  private scopes: Pick<ProjectRunScopes, 'assertAdmission' | 'terminalRuns' | 'prepareTerminal' | 'terminalRun' |
    'hasRun' | 'stopTerminal' | 'stopTerminals' | 'retireRebootedTerminals'>;
  private identities: Pick<ProjectIdentities, 'terminal' | 'terminalCommand'>;
  /**
   * 入口 / Entry: ProjectTerminals.constructor.
   * 功能：建立 ProjectTerminals 的准备并核验项目终端绑定上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectTerminals context for this module's responsibility: Prepares/verifies terminal bindings; stopping checks original account/run proofs rather than session names alone. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1 optional; context: ConstructorParameters<typeof Workspaces>[1] optional; options: { scopes?: ProjectTerminals['scopes']; identities?: ProjectTerminals['identities'] } default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.scopes`, `this.identities`, `this.preparation`, `this.workspaces`.
   */
  constructor(private machines: Machines, workspaces?: WorkspacesV1,
    context?: ConstructorParameters<typeof Workspaces>[1], options: {
      scopes?: ProjectTerminals['scopes']; identities?: ProjectTerminals['identities'] } = {}) {
    this.scopes = options.scopes || new ProjectRunScopes(machines);
    this.identities = options.identities || new ProjectIdentities(machines);
    this.preparation = new ProjectPreparation(machines, workspaces, context, this.scopes);
    this.workspaces = this.preparation.workspaces;
  }
  /**
   * 入口 / Entry: ProjectTerminals.prepareTask.
   * 功能：把本层请求转交 `this.preparation.prepareTask`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.preparation.prepareTask` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; projectId: string | null | undefined; signal: AbortSignal optional; options: { verifyOnly?: boolean } default={}
   * 输出 / Returns: `this.preparation.prepareTask(id, projectId, signal, options)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  prepareTask(id: string, projectId: string | null | undefined, signal?: AbortSignal, options: { verifyOnly?: boolean } = {}) {
    return this.preparation.prepareTask(id, projectId, signal, options);
  }
  /**
   * 入口 / Entry: ProjectTerminals.prepare.
   * 功能：在准备并核验项目终端绑定中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.prepareTask(id, projectId, signal, options)` / `this.preparation.prepare(id, projectId, signal, { task, readOnly }, async context => { const { project, scope, live, abort } …` 供上层消费（`ProjectTerminals`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectTerminals`; this entry produces `this.prepareTask(id, projectId, signal, options)` / `this.preparation.prepare(id, projectId, signal, { task, readOnly }, async context => { const { project, scope, live, abort } …` for its caller. Module context: Prepares/verifies terminal bindings; stopping checks original account/run proofs rather than session names alone.
   * 处理：通过 `this.prepareTask`, `this.preparation.prepare` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.prepareTask`, `this.preparation.prepare`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `task`.
   * 输入 / Inputs: id: string; projectId: string | null | undefined; session: string | null optional; readOnly: default=false; signal: AbortSignal optional; expectedTerminalId: string optional; options: { mode?: 'task'; verifyOnly?: boolean } default={}
   * 输出 / Returns: Promise<PreparedProject>；结果来自 / values from `this.prepareTask(id, projectId, signal, options)`; `this.preparation.prepare(id, projectId, signal, { task, readOnly }, async context => { const { project, scope, live, abort } …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `options.verifyOnly && !task`; `task && (readOnly || session)`; `readOnly && (!session || !projectId)`; 异常 / errors `new AppError('只读绑定核对仅适用于任务准备', 400)`; `new AppError('任务准备不能同时附加终端会话', 400)`.
   */
  async prepare(id: string, projectId: string | null | undefined, session?: string | null,
    readOnly = false, signal?: AbortSignal, expectedTerminalId?: string,
    options: { mode?: 'task'; verifyOnly?: boolean } = {}): Promise<PreparedProject> {
    const task = options.mode === 'task';
    if (options.verifyOnly && !task) throw new AppError('只读绑定核对仅适用于任务准备', 400);
    if (task && (readOnly || session)) throw new AppError('任务准备不能同时附加终端会话', 400);
    if (readOnly && (!session || !projectId)) throw new AppError('此共享授权未绑定项目，请让管理员重新共享终端', 409);
    if (task) return this.prepareTask(id, projectId, signal, options);
    /**
     * 入口 / Entry: ProjectTerminals.prepare.callback@95.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.preparation.prepare）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.preparation.prepare).
     * 输入 / Inputs: context
     * 输出 / Returns: `{ command, projectId: scope, networkIsolation: project.networkIsolation || 'host', terminalId, release: this.preparation.reta…`.
     * 副作用 / Effects: `this.scopes.stopTerminal`; `connectionId.replaceAll().slice`; `connectionId.replaceAll`; `abort.throwIfAborted`; 更新 / updates `prepared`, `createdRun`, `terminalId`, `command`.
     * 拒绝 / Refusals: 条件 / conditions `!task`; `existing.length > 1`; `readOnly && !prior`; 异常 / errors `new AppError('终端运行归属重复，请先完成原会话清理', 409)`; `new AppError('原共享终端已结束，请重新授权当前会话', 409, 'PROJECT_TERMINAL_SHARE_STALE')`.
     * 失败处理：catch 分支执行 `if (createdRun && await this.scopes.hasRun(id, scope, createdRun)) await this.scopes.stopTerminal(id, scope, createdRun);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (createdRun && await this.scopes.hasRun(id, scope, createdRun)) await this.scopes.stopTerminal(id, scope, createdRun);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.preparation.prepare(id, projectId, signal, { task, readOnly }, async context => {
      const { project, scope, live, abort } = context;
      let command = terminalShell(project);
      let terminalId: string | undefined;
      let createdRun: string | undefined;
      try {
        if (!task) {
          if (!readOnly) {
            await this.scopes.retireRebootedTerminals(id, scope);
            for (const orphan of await this.scopes.terminalRuns(id, scope)) {
              if (!orphan.terminal.persistent && !this.preparation.hasTerminal(id, orphan.runId))
                await this.scopes.stopTerminal(id, scope, orphan.runId);
            }
          }
          const connectionId = randomUUID();
          const name = terminalSessionName(scope, session || 'direct-' + connectionId.replaceAll('-', '').slice(0, 24));
          const existing = (await this.scopes.terminalRuns(id, scope)).filter(entry => entry.terminal.name === name);
          if (existing.length > 1) throw new AppError('终端运行归属重复，请先完成原会话清理', 409);
          const prior = existing[0];
          if (readOnly && !prior)
            throw new AppError('原共享终端已结束，请重新授权当前会话', 409, 'PROJECT_TERMINAL_SHARE_STALE');
          if (expectedTerminalId && prior?.runId !== z.uuid().parse(expectedTerminalId))
            throw new AppError('原共享终端已结束，请重新授权当前会话', 409, 'PROJECT_TERMINAL_SHARE_STALE');
          let prepared;
          if (prior) prepared = await this.scopes.terminalRun(id, scope, prior.runId, abort);
          else {
            createdRun = connectionId;
            prepared = await this.scopes.prepareTerminal(id, project, connectionId,
              { name, persistent: Boolean(session) }, abort);
          }
          await this.identities.terminal(id, prepared.identity, prepared.run, name,
            { create: Boolean(createdRun), signal: abort });
          terminalId = prepared.run.runId;
          command = await this.identities.terminalCommand(prepared.identity, prepared.run, name, readOnly);
        }
        abort.throwIfAborted();
        if (this.machines.live.get(id) !== live) throw new AppError('客户机运行身份在准备期间改变', 409);
      } catch (error) {
        if (createdRun && await this.scopes.hasRun(id, scope, createdRun))
          await this.scopes.stopTerminal(id, scope, createdRun);
        throw error;
      }
      return { command, projectId: scope, networkIsolation: project.networkIsolation || 'host', terminalId,
        release: this.preparation.retain(context, false, terminalId,
          session ? undefined : () => this.scopes.stopTerminal(id, scope, terminalId!)) };
    });
  }

  /**
   * 入口 / Entry: ProjectTerminals.validate.
   * 功能：在准备并核验项目终端绑定中，核对调用资格、输入或资源归属；本入口产生 `{ projectId: prepared.projectId, terminalId: prepared.terminalId! }` 供上层消费（`ProjectTerminals`）。
   * Purpose: Checks admission, input or resource ownership in `ProjectTerminals`; this entry produces `{ projectId: prepared.projectId, terminalId: prepared.terminalId! }` for its caller. Module context: Prepares/verifies terminal bindings; stopping checks original account/run proofs rather than session names alone.
   * 处理：通过 `this.workspaces.projects.with`, `this.prepare`, `prepared.release` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.projects.with`, `this.prepare`, `prepared.release`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; projectId: string | undefined; session: string
   * 输出 / Returns: `{ projectId: prepared.projectId, terminalId: prepared.terminalId! }`.
   * 副作用 / Effects: `prepared.release`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async validate(id: string, projectId: string | undefined, session: string) {
    // A share may omit the project; resolve its saved active project once and
    // persist that exact scope in the grant, never reinterpret it on viewing.
    const scope = await this.workspaces.projects.with(id, projectId,
      async () => this.workspaces.projects.current(id));
    const prepared = await this.prepare(id, scope, session, true);
    await prepared.release();
    return { projectId: prepared.projectId, terminalId: prepared.terminalId! };
  }
  /**
   * 入口 / Entry: ProjectTerminals.stop.
   * 功能：在准备并核验项目终端绑定中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.preparation.serial(id, abort, async () => { if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例，再核对…` 供上层消费（`ProjectTerminals`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectTerminals`; this entry produces `this.preparation.serial(id, abort, async () => { if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例，再核对…` for its caller. Module context: Prepares/verifies terminal bindings; stopping checks original account/run proofs rather than session names alone.
   * 处理：通过 `AbortSignal.any`, `this.preparation.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `AbortSignal.any`, `this.preparation.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; projectId: string; session: string optional; signal: AbortSignal optional
   * 输出 / Returns: `this.preparation.serial(id, abort, async () => { if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例，再核对…`.
   * 副作用 / Effects: `AbortSignal.any`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async stop(id: string, projectId: string, session?: string, signal?: AbortSignal) {
    const abort = AbortSignal.any([this.preparation.signal, ...(signal ? [signal] : [])]);
    return this.preparation.serial(id, abort, async () => {
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例，再核对并停止终端', 409);
      await this.scopes.stopTerminals(id, projectId, session ? terminalSessionName(projectId, session) : undefined);
    });
  }

  /**
   * 入口 / Entry: ProjectTerminals.close.
   * 功能：把本层请求转交 `this.preparation.close`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.preparation.close` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.preparation.close()`.
   * 副作用 / Effects: `this.preparation.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() { return this.preparation.close(); }
}
