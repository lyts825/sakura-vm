import { AppError } from '../shared/errors.ts';
import type { Machines } from './machines.ts';
import { projectVersion, type Project } from './project-config.ts';
import {
  ensureProjectNetworkScript,
  projectNetworkCheckScript,
  projectNetworkNamespace,
} from './project-network-isolation.ts';
import { ProjectRunScopes } from './project-run-scope.ts';
import { terminalShell } from './project-shell.ts';
import { quote } from './shell.ts';
import { Workspaces } from './workspaces.ts';

type Lease = {
  vmId: string;
  projectId: string;
  task: boolean;
  terminalId?: string;
  finished: Promise<void>;
  release: () => void | Promise<void>;
};
const preparedProjects = new WeakMap<Machines, Set<Lease>>();
export function assertProjectPreparationIdle(machines: Machines, vmId: string, projectId: string) {
  if (
    [...(preparedProjects.get(machines) || [])].some(
      (lease) => lease.vmId === vmId && lease.projectId === projectId,
    )
  )
    throw new AppError('请先关闭项目终端连接并等待终端准备完成', 409, 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
}
export type PreparationContext = {
  id: string;
  scope: string;
  project: Project;
  version: string;
  live: NonNullable<ReturnType<Machines['live']['get']>>;
  abort: AbortSignal;
};
export type PreparedProject = {
  command: string;
  projectId: string;
  networkIsolation: string;
  terminalId?: string;
  release: () => void | Promise<void>;
  signal?: AbortSignal;
  captured?: { project: Project; configVersion: string; live: PreparationContext['live'] };
};

/** Shared configuration capture and admission lease for tasks and terminals. */
export class ProjectPreparation {
  readonly workspaces: Workspaces;
  private ownsWorkspaces: boolean;
  private leases = new Set<Lease>();
  private pending = new Map<string, Promise<unknown>>();
  private controller = new AbortController();
  private unguard: () => void;
  private scopes: Pick<ProjectRunScopes, 'assertAdmission'>;
  get signal() {
    return this.controller.signal;
  }
  constructor(
    private machines: Machines,
    workspaces?: Workspaces,
    context?: ConstructorParameters<typeof Workspaces>[1],
    scopes?: Pick<ProjectRunScopes, 'assertAdmission'>,
  ) {
    this.ownsWorkspaces = !workspaces;
    this.workspaces = workspaces || new Workspaces(machines, context);
    this.scopes = scopes || new ProjectRunScopes(machines);
    this.unguard = this.workspaces.beforeConfigChange(async (id, previous, next) => {
      if (
        previous.directory === next.directory &&
        (previous.networkIsolation || 'host') === (next.networkIsolation || 'host')
      )
        return;
      if (
        [...this.leases].some(
          (lease) => lease.vmId === id && lease.projectId === (previous._workspace || 'default'),
        )
      )
        throw new AppError('请先结束此项目的终端或命令，再修改目录或网络模式', 409);
    });
  }
  serial<T>(id: string, signal: AbortSignal, action: () => Promise<T>) {
    const operation = (this.pending.get(id) || Promise.resolve())
      .catch(() => {})
      .then(() => {
        signal.throwIfAborted();
        return this.machines.locked(id, action);
      });
    this.pending.set(id, operation);
    void operation
      .finally(() => {
        if (this.pending.get(id) === operation) this.pending.delete(id);
      })
      .catch(() => {});
    return operation;
  }
  hasTerminal(vmId: string, terminalId: string) {
    return [...(preparedProjects.get(this.machines) || [])].some(
      (lease) => lease.vmId === vmId && lease.terminalId === terminalId,
    );
  }
  async prepare<T>(
    id: string,
    projectId: string | null | undefined,
    signal: AbortSignal | undefined,
    options: { task: boolean; readOnly?: boolean; verifyOnly?: boolean },
    action: (context: PreparationContext) => Promise<T>,
  ) {
    const { task, readOnly = false } = options;
    const abort = AbortSignal.any([this.signal, ...(signal ? [signal] : [])]);
    return this.serial(id, abort, () =>
      this.workspaces.projects.with(id, projectId, async () => {
        if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
        const live = this.machines.live.get(id);
        if (!live) throw new AppError('客户机运行身份未确认', 409);
        const project = await this.workspaces.config(id);
        const version = projectVersion(project);
        const scope = project._workspace || 'default';
        await this.scopes.assertAdmission(id, scope);
        const { assertNoPendingProjectDirectoryMigration } = await import('./project-admission.ts');
        await assertNoPendingProjectDirectoryMigration(this.machines, id, scope, abort);
        if (!readOnly) {
          const distro = this.machines.get(id).distro || 'alpine';
          const install =
            distro === 'alpine'
              ? 'apk add --no-cache --timeout 30 tmux'
              : 'export DEBIAN_FRONTEND=noninteractive; apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update && apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y tmux';
          const namespace = projectNetworkNamespace(project);
          const prepared = await this.machines.exec(
            id,
            `set -eu\n` +
              `${!task ? `if ! command -v tmux >/dev/null; then ${install}; fi\n` : ''}` +
              (namespace
                ? `if ip netns exec ${namespace} true >/dev/null 2>&1; then\n${projectNetworkCheckScript(namespace)}\n` +
                  (options.verifyOnly
                    ? `else\n  echo 'SAKURA_TASK_NETWORK_MISSING: 原项目网络空间不存在，只读核对未修复' >&2; exit 74\n`
                    : '') +
                  `fi\n`
                : '') +
              (options.verifyOnly ? '' : `${ensureProjectNetworkScript(project, distro)}`) +
              (task
                ? `if [ ! -d ${quote(project.directory)} ] || [ -L ${quote(project.directory)} ]; then\n` +
                  `  echo 'SAKURA_TASK_DIRECTORY_MISSING: 项目目录不存在或是链接，请先显式准备并迁移原目录' >&2; exit 74\nfi`
                : `mkdir -p ${quote(project.directory)}`),
            180_000,
            abort,
          );
          if (prepared.code !== 0)
            throw new AppError(
              prepared.stderr || '无法准备项目终端',
              409,
              task && prepared.stderr.includes('SAKURA_TASK_DIRECTORY_MISSING:')
                ? 'PROJECT_IDENTITY_DIRECTORY_MISSING'
                : undefined,
            );
        }
        return action({ id, scope, project, version, live, abort });
      }),
    );
  }
  retain(context: PreparationContext, task: boolean, terminalId?: string, stop?: () => Promise<void>) {
    const { id, scope, abort } = context;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const done = () => {
      this.leases.delete(lease);
      preparedProjects.get(this.machines)?.delete(lease);
      abort.removeEventListener('abort', onAbort);
      finish();
    };
    let cleanup: Promise<void> | undefined;
    const lease: Lease = {
      vmId: id,
      projectId: scope,
      task,
      terminalId,
      finished,
      release: () => {
        if (!stop) {
          done();
          return;
        }
        if (!this.leases.has(lease)) return cleanup;
        if (!cleanup)
          cleanup = stop()
            .then(done)
            .catch((error) => {
              cleanup = undefined;
              throw error;
            });
        return cleanup;
      },
    };
    const onAbort = () => {
      void Promise.resolve(lease.release()).catch((error) => {
        this.machines.emit('terminal-cleanup-error', { vmId: id, projectId: scope, terminalId, error });
      });
    };
    this.leases.add(lease);
    if (!preparedProjects.has(this.machines)) preparedProjects.set(this.machines, new Set());
    preparedProjects.get(this.machines)!.add(lease);
    if (!task) abort.addEventListener('abort', onAbort, { once: true });
    return lease.release;
  }
  prepareTask(
    id: string,
    projectId: string | null | undefined,
    signal?: AbortSignal,
    options: { verifyOnly?: boolean } = {},
  ): Promise<PreparedProject> {
    return this.prepare(id, projectId, signal, { ...options, task: true }, async (context) => {
      context.abort.throwIfAborted();
      if (this.machines.live.get(id) !== context.live)
        throw new AppError('客户机运行身份在准备期间改变', 409);
      return {
        command: terminalShell(context.project),
        projectId: context.scope,
        networkIsolation: context.project.networkIsolation || 'host',
        release: this.retain(context, true),
        signal: context.abort,
        captured: { project: context.project, configVersion: context.version, live: context.live },
      };
    });
  }
  async close() {
    this.controller.abort();
    await Promise.allSettled([...this.pending.values()]);
    const cleanup = await Promise.allSettled(
      [...this.leases].filter((lease) => !lease.task).map((lease) => lease.release()),
    );
    const failures = cleanup.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        '项目终端清理未确认，运行记录继续保留',
      );
    await Promise.all([...this.leases].map((lease) => lease.finished));
    this.unguard();
    if (this.ownsWorkspaces) await this.workspaces.close();
  }
}
