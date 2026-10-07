/**
 * 模块职责：准备并核验项目终端绑定，停止时关联原账户和运行票据而非仅凭会话名称。
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

export function terminalBinding(project: Project) {
  return createHash('sha256').update(JSON.stringify([project._workspace || 'default',
    project.directory, project.networkIsolation || 'host'])).digest('hex');
}

export { assertProjectPreparationIdle as assertProjectTerminalsStopped } from './project-preparation.ts';
export { terminalShell } from './project-shell.ts';

function terminalTargetScript(name: string) {
  // Some tmux commands interpret '=name' literally. Resolve the complete name
  // to its immutable $N identity, which every session command understands.
  return `sakura_target=$(tmux list-sessions -F '#{session_name} #{session_id}' | ` +
    `awk '$1 == "${name}" { print $2 }')\n` +
    `case "$sakura_target" in '$'[0-9]*) ;; *) echo '项目 tmux 会话不存在' >&2; exit 1;; esac\n` +
    `case "\${sakura_target#?}" in ''|*[!0-9]*) exit 1;; esac`;
}

/** Check the actual namespace of every pane, including new windows and splits. */
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
  constructor(private machines: Machines, workspaces?: WorkspacesV1,
    context?: ConstructorParameters<typeof Workspaces>[1], options: {
      scopes?: ProjectTerminals['scopes']; identities?: ProjectTerminals['identities'] } = {}) {
    this.scopes = options.scopes || new ProjectRunScopes(machines);
    this.identities = options.identities || new ProjectIdentities(machines);
    this.preparation = new ProjectPreparation(machines, workspaces, context, this.scopes);
    this.workspaces = this.preparation.workspaces;
  }
  prepareTask(id: string, projectId: string | null | undefined, signal?: AbortSignal, options: { verifyOnly?: boolean } = {}) {
    return this.preparation.prepareTask(id, projectId, signal, options);
  }
  async prepare(id: string, projectId: string | null | undefined, session?: string | null,
    readOnly = false, signal?: AbortSignal, expectedTerminalId?: string,
    options: { mode?: 'task'; verifyOnly?: boolean } = {}): Promise<PreparedProject> {
    const task = options.mode === 'task';
    if (options.verifyOnly && !task) throw new AppError('只读绑定核对仅适用于任务准备', 400);
    if (task && (readOnly || session)) throw new AppError('任务准备不能同时附加终端会话', 400);
    if (readOnly && (!session || !projectId)) throw new AppError('此共享授权未绑定项目，请让管理员重新共享终端', 409);
    if (task) return this.prepareTask(id, projectId, signal, options);
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

  async validate(id: string, projectId: string | undefined, session: string) {
    // A share may omit the project; resolve its saved active project once and
    // persist that exact scope in the grant, never reinterpret it on viewing.
    const scope = await this.workspaces.projects.with(id, projectId,
      async () => this.workspaces.projects.current(id));
    const prepared = await this.prepare(id, scope, session, true);
    await prepared.release();
    return { projectId: prepared.projectId, terminalId: prepared.terminalId! };
  }
  async stop(id: string, projectId: string, session?: string, signal?: AbortSignal) {
    const abort = AbortSignal.any([this.preparation.signal, ...(signal ? [signal] : [])]);
    return this.preparation.serial(id, abort, async () => {
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例，再核对并停止终端', 409);
      await this.scopes.stopTerminals(id, projectId, session ? terminalSessionName(projectId, session) : undefined);
    });
  }

  close() { return this.preparation.close(); }
}
