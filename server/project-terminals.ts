import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { Workspaces, projectVersion, type Project } from './workspaces.ts';
import { quote } from './files.ts';
import { AppError } from './model.ts';
import { ensureProjectNetworkScript, projectNetworkCheckScript,
  projectNetworkNamespace, projectPrivateShellCommand } from './project-network-isolation.ts';
import { terminalSessionName, terminalSessionPrefix } from '../shared/terminal-scope.ts';
import { ProjectIdentities } from './project-identity.ts';
import { ProjectRunScopes } from './project-run-scope.ts';

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

type Lease = { vmId: string; projectId: string; task: boolean; terminalId?: string;
  finished: Promise<void>; release: () => void | Promise<void> };
const preparedTerminals = new WeakMap<Machines, Set<Lease>>();

/** A prepared connection can execute after prepare returns; keep it reserved until release. */
export function assertProjectTerminalsStopped(machines: Machines, vmId: string, projectId: string) {
  if ([...(preparedTerminals.get(machines) || [])].some(lease =>
    lease.vmId === vmId && lease.projectId === projectId))
    throw new AppError('请先关闭项目终端连接并等待终端准备完成', 409, 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
}

export class ProjectTerminals {
  readonly workspaces: Workspaces;
  private ownsWorkspaces: boolean;
  private leases = new Set<Lease>();
  private pending = new Map<string, Promise<unknown>>();
  private controller = new AbortController();
  private unguard: () => void;
  private scopes: Pick<ProjectRunScopes, 'assertAdmission' | 'terminalRuns' | 'prepareTerminal' | 'terminalRun' |
    'hasRun' | 'stopTerminal' | 'stopTerminals' | 'retireRebootedTerminals'>;
  private identities: Pick<ProjectIdentities, 'terminal' | 'terminalCommand'>;

  constructor(private machines: Machines, workspaces?: Workspaces,
    context?: ConstructorParameters<typeof Workspaces>[1], options: {
      scopes?: ProjectTerminals['scopes']; identities?: ProjectTerminals['identities'] } = {}) {
    this.ownsWorkspaces = !workspaces;
    this.workspaces = workspaces || new Workspaces(machines, context);
    this.scopes = options.scopes || new ProjectRunScopes(machines);
    this.identities = options.identities || new ProjectIdentities(machines);
    this.unguard = this.workspaces.beforeConfigChange(async (id, previous, next) => {
      if (previous.directory === next.directory &&
          (previous.networkIsolation || 'host') === (next.networkIsolation || 'host')) return;
      if ([...this.leases].some((lease) => lease.vmId === id &&
          lease.projectId === (previous._workspace || 'default')))
        throw new AppError('请先结束此项目的终端或命令，再修改目录或网络模式', 409);
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
    readOnly = false, signal?: AbortSignal, expectedTerminalId?: string,
    options: { mode?: 'task'; verifyOnly?: boolean } = {}) {
    const task = options.mode === 'task';
    if (options.verifyOnly && !task) throw new AppError('只读绑定核对仅适用于任务准备', 400);
    if (task && (readOnly || session)) throw new AppError('任务准备不能同时附加终端会话', 400);
    const abort = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    if (readOnly && (!session || !projectId))
      throw new AppError('此共享授权未绑定项目，请让管理员重新共享终端', 409);
    return this.serial(id, abort, () => this.workspaces.projects.with(id, projectId, async () => {
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
      const live = this.machines.live.get(id);
      if (!live) throw new AppError('客户机运行身份未确认', 409);
      const project = await this.workspaces.config(id);
      const version = projectVersion(project);
      const scope = project._workspace || 'default';
      let command = terminalShell(project);
      let terminalId: string | undefined;
      await this.scopes.assertAdmission(id, scope);
      const { assertNoPendingProjectDirectoryMigration } = await import('./project-directory-migration.ts');
      await assertNoPendingProjectDirectoryMigration(this.machines, id, scope, abort);
      if (!readOnly) {
        const distro = this.machines.get(id).distro || 'alpine';
        const install = distro === 'alpine' ? 'apk add --no-cache --timeout 30 tmux' :
          'export DEBIAN_FRONTEND=noninteractive; apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update && apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y tmux';
        const namespace = projectNetworkNamespace(project);
        const prepared = await this.machines.exec(id, `set -eu\n` +
          `${!task ? `if ! command -v tmux >/dev/null; then ${install}; fi\n` : ''}` +
          (namespace ? `if ip netns exec ${namespace} true >/dev/null 2>&1; then\n${projectNetworkCheckScript(namespace)}\n` +
            (options.verifyOnly ? `else\n  echo 'SAKURA_TASK_NETWORK_MISSING: 原项目网络空间不存在，只读核对未修复' >&2; exit 74\n` : '') +
            `fi\n` : '') +
          (options.verifyOnly ? '' : `${ensureProjectNetworkScript(project, distro)}`) + (task ?
            `if [ ! -d ${quote(project.directory)} ] || [ -L ${quote(project.directory)} ]; then\n` +
            `  echo 'SAKURA_TASK_DIRECTORY_MISSING: 项目目录不存在或是链接，请先显式准备并迁移原目录' >&2; exit 74\nfi` :
            `mkdir -p ${quote(project.directory)}`),
        180_000, abort);
        if (prepared.code !== 0) throw new AppError(prepared.stderr || '无法准备项目终端', 409,
          task && prepared.stderr.includes('SAKURA_TASK_DIRECTORY_MISSING:') ? 'PROJECT_IDENTITY_DIRECTORY_MISSING' : undefined);
      }
      let createdRun: string | undefined;
      try {
        if (!task) {
          if (!readOnly) {
            await this.scopes.retireRebootedTerminals(id, scope);
            for (const orphan of await this.scopes.terminalRuns(id, scope)) {
              if (!orphan.terminal.persistent && ![...(preparedTerminals.get(this.machines) || [])]
                .some(lease => lease.vmId === id && lease.terminalId === orphan.runId))
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
      let finish!: () => void;
      const finished = new Promise<void>(resolve => { finish = resolve; });
      const done = () => {
        this.leases.delete(lease); preparedTerminals.get(this.machines)?.delete(lease);
        abort.removeEventListener('abort', onAbort); finish();
      };
      let cleanup: Promise<void> | undefined;
      const lease: Lease = { vmId: id, projectId: scope, task, terminalId, finished,
        release: () => {
          if (task || session) { done(); return; }
          if (!this.leases.has(lease)) return cleanup;
          if (!cleanup) cleanup = this.scopes.stopTerminal(id, scope, terminalId!).then(done).catch(error => {
            cleanup = undefined; throw error;
          });
          return cleanup;
        } };
      const onAbort = () => { void Promise.resolve(lease.release()).catch(error => {
        this.machines.emit('terminal-cleanup-error', { vmId: id, projectId: scope, terminalId, error });
      }); };
      this.leases.add(lease);
      if (!preparedTerminals.has(this.machines)) preparedTerminals.set(this.machines, new Set());
      preparedTerminals.get(this.machines)!.add(lease);
      if (!task) abort.addEventListener('abort', onAbort, { once: true });
      return { command, projectId: scope, networkIsolation: project.networkIsolation || 'host',
        terminalId, release: lease.release,
        ...(task ? { signal: abort, captured: { project, configVersion: version, live } } : {}) };
    }));
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
    const abort = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    return this.serial(id, abort, async () => {
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例，再核对并停止终端', 409);
      await this.scopes.stopTerminals(id, projectId, session ? terminalSessionName(projectId, session) : undefined);
    });
  }

  async close() {
    this.controller.abort();
    await Promise.allSettled([...this.pending.values()]);
    const cleanup = await Promise.allSettled([...this.leases].filter(lease => !lease.task).map(lease => lease.release()));
    const failures = cleanup.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), '项目终端清理未确认，运行记录继续保留');
    await Promise.all([...this.leases].map(lease => lease.finished));
    this.unguard();
    if (this.ownsWorkspaces) await this.workspaces.close();
  }
}
