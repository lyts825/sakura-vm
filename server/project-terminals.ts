import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { Workspaces, type Project } from './workspaces.ts';
import { quote } from './files.ts';
import { AppError } from './model.ts';
import { ensureProjectNetworkScript, projectNetworkCheckScript,
  projectNetworkNamespace, projectPrivateShellCommand } from './project-network-isolation.ts';
import { terminalSessionName, terminalSessionPrefix } from '../shared/terminal-scope.ts';

export function terminalBinding(project: Project) {
  return createHash('sha256').update(JSON.stringify([project._workspace || 'default',
    project.directory, project.networkIsolation || 'host'])).digest('hex');
}

export function terminalShell(project: Project) {
  return project.networkIsolation === 'private' ? projectPrivateShellCommand(project) :
    `set -eu\ncd ${quote(project.directory)}\nexec /bin/sh -l`;
}

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

type Lease = { vmId: string; projectId: string; release: () => void };
export class ProjectTerminals {
  readonly workspaces: Workspaces;
  private ownsWorkspaces: boolean;
  private leases = new Set<Lease>();
  private pending = new Map<string, Promise<unknown>>();
  private controller = new AbortController();
  private unguard: () => void;

  constructor(private machines: Machines, workspaces?: Workspaces) {
    this.ownsWorkspaces = !workspaces;
    this.workspaces = workspaces || new Workspaces(machines);
    this.unguard = this.workspaces.beforeConfigChange(async (id, previous, next) => {
      if (previous.directory === next.directory &&
          (previous.networkIsolation || 'host') === (next.networkIsolation || 'host')) return;
      if ([...this.leases].some((lease) => lease.vmId === id &&
          lease.projectId === (previous._workspace || 'default')))
        throw new AppError('请先断开此项目的终端连接，再修改目录或网络模式', 409);
    });
  }

  private serial<T>(id: string, signal: AbortSignal, action: () => Promise<T>) {
    const operation = (this.pending.get(id) || Promise.resolve()).catch(() => {}).then(() => {
      signal.throwIfAborted();
      return this.machines.locked(id, action);
    });
    this.pending.set(id, operation);
    void operation.finally(() => {
      if (this.pending.get(id) === operation) this.pending.delete(id);
    }).catch(() => {});
    return operation;
  }

  async prepare(id: string, projectId: string | null | undefined, session?: string | null,
    readOnly = false, signal?: AbortSignal, expectedTerminalId?: string) {
    const abort = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    if (readOnly && (!session || !projectId))
      throw new AppError('此共享授权未绑定项目，请让管理员重新共享终端', 409);
    return this.serial(id, abort, () => this.workspaces.projects.with(id, projectId, async () => {
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
      const project = await this.workspaces.config(id);
      const scope = project._workspace || 'default';
      let command = terminalShell(project);
      let terminalId: string | undefined;
      if (!readOnly) {
        const distro = this.machines.get(id).distro || 'alpine';
        const install = distro === 'alpine' ? 'apk add --no-cache --timeout 30 tmux' :
          'export DEBIAN_FRONTEND=noninteractive; apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update && apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y tmux';
        const namespace = projectNetworkNamespace(project);
        const prepared = await this.machines.exec(id, `set -eu\n` +
          `${session ? `if ! command -v tmux >/dev/null; then ${install}; fi\n` : ''}` +
          (namespace ? `if ip netns exec ${namespace} true >/dev/null 2>&1; then\n${projectNetworkCheckScript(namespace)}\nfi\n` : '') +
          `${ensureProjectNetworkScript(project, distro)}mkdir -p ${quote(project.directory)}`,
        180_000, abort);
        if (prepared.code !== 0) throw new AppError(prepared.stderr || '无法准备项目终端', 409);
      }
      if (session) {
        const name = terminalSessionName(scope, session);
        if (!readOnly) {
          const created = await this.machines.exec(id,
            `set -eu\nif ! tmux has-session -t =${name} 2>/dev/null; then\n` +
            `  tmux new-session -d -s ${name} -c ${quote(project.directory)} ${quote(command)}\n` +
            `  ${terminalTargetScript(name)}\n` +
            `  tmux set-environment -t "$sakura_target" SAKURA_TERMINAL_BINDING ${terminalBinding(project)}\n` +
            `  tmux set-environment -t "$sakura_target" SAKURA_TERMINAL_ID ${randomUUID()}\n` +
            `  tmux set-option -t "$sakura_target" default-command ${quote(command)}\n` +
            `  tmux set-option -t "$sakura_target" default-shell /bin/sh\nfi`, 10000, abort);
          if (created.code !== 0) throw new AppError(created.stderr || '无法创建 tmux 终端', 409);
        }
        // A newly spawned pane may still be entering its namespace. Retry only
        // checks; never replace or move an existing process to another network.
        const verified = await this.machines.exec(id,
          `sakura_attempt=0\nuntil (\n${verifyTerminalScript(project, session, expectedTerminalId)}\n); do\n` +
          `  sakura_attempt=$((sakura_attempt + 1)); [ "$sakura_attempt" -lt 20 ] || exit 1\n` +
          `  sleep 0.1\ndone\n${terminalTargetScript(name)}\n` +
          `tmux show-environment -t "$sakura_target" SAKURA_TERMINAL_ID`, 10000, abort);
        if (verified.code !== 0) throw new AppError(verified.stderr || '终端项目绑定检查失败', 409);
        terminalId = z.uuid().parse(verified.stdout.trim().replace(/^SAKURA_TERMINAL_ID=/, ''));
        // Check again in the actual SSH channel, closing the gap before attach.
        command = `${verifyTerminalScript(project, session, terminalId)}\nexec tmux attach-session ` +
          `${readOnly ? '-r ' : ''}-t "$sakura_target"`;
      }
      abort.throwIfAborted();
      const lease: Lease = { vmId: id, projectId: scope,
        release: () => { this.leases.delete(lease); abort.removeEventListener('abort', lease.release); } };
      this.leases.add(lease);
      abort.addEventListener('abort', lease.release, { once: true });
      return { command, projectId: scope, networkIsolation: project.networkIsolation || 'host',
        terminalId, release: lease.release };
    }));
  }

  async validate(id: string, projectId: string | undefined, session: string) {
    // A share may omit the project; resolve its saved active project once and
    // persist that exact scope in the grant, never reinterpret it on viewing.
    const scope = await this.workspaces.projects.with(id, projectId,
      async () => this.workspaces.projects.current(id));
    const prepared = await this.prepare(id, scope, session, true);
    prepared.release();
    return { projectId: prepared.projectId, terminalId: prepared.terminalId! };
  }

  async close() {
    this.controller.abort();
    this.unguard();
    await Promise.allSettled([...this.pending.values()]);
    for (const lease of this.leases) lease.release();
    if (this.ownsWorkspaces) await this.workspaces.close();
  }
}
