import type { Machines } from './machines.ts';
import { type Workspaces, projectPrivateValues } from './workspaces.ts';
import { runServices, serviceOrder } from './project-services.ts';
import { ProjectRunScopes, projectIdentityTask } from './project-run-scope.ts';
import { Jobs } from './jobs.ts';
import { privateLog, redactValues } from './secrets.ts';
import { AppError } from './model.ts';
import { ProjectServiceScopes, projectServiceBinding } from './project-service-scope.ts';

const lifecycleRefusals = new Set([
  'GUEST_TASK_CLEANUP_FAILED', 'GUEST_TASK_SCOPE_UNAVAILABLE',
  'SERVICE_CLEANUP_FAILED', 'SERVICE_SCOPE_UNAVAILABLE',
  'SERVICE_SCOPE_UNMANAGED', 'SERVICE_SCOPE_CHANGED',
  'SERVICE_IDENTITY_REQUIRED',
]);
const needsManualCleanup = (error: unknown) => error instanceof AppError &&
  (lifecycleRefusals.has(error.code || '') || error.code?.startsWith('PROJECT_IDENTITY_') ||
    error.code?.startsWith('PROJECT_DIRECTORY_') || error.code?.startsWith('DIRECTORY_MIGRATION_'));

export type HealthView = {
  name: string;
  desired: boolean;
  status: 'waiting' | 'healthy' | 'unhealthy' | 'restarting' | 'stopped' | 'exhausted';
  failures: number;
  restarts: number;
  checkedAt?: string;
  nextCheck: number;
  error?: string;
};
export class ServiceHealth {
  jobs = new Jobs('health');
  private states = new Map<string, Map<string, HealthView>>();
  private checks = new Map<string, AbortController>();
  private generations = new Map<string, number>();
  private blockedChecks = new Map<string, Set<string>>();
  private pending?: Promise<void>;
  private closed = false;
  private timer: ReturnType<typeof setInterval>;
  private onChange = () => {
    for (const key of this.states.keys())
      if (!this.machines.live.has(key.split(':')[0])) {
        this.blockedChecks.delete(key);
        this.checks.get(key)?.abort();
        this.jobs.cancel(key);
        this.generations.set(key, (this.generations.get(key) || 0) + 1);
        for (const state of this.states.get(key)!.values()) {
          state.desired = false;
          state.status = 'stopped';
        }
      }
  };
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
  ) {
    this.timer = setInterval(() => {
      if (!this.pending)
        this.pending = this.tick()
          .catch(() => {})
          .finally(() => {
            this.pending = undefined;
          });
    }, 5000);
    this.timer.unref();
    machines.on('change', this.onChange);
    workspaces.onAction = (id, action, service) => this.expect(id, action, service);
  }
  async expect(id: string, action: 'start' | 'stop', service?: string) {
    const key = this.workspaces.projects?.key(id) || id;
    if (this.workspaces.jobs.view(key)?.status === 'running') throw new AppError('请等待项目操作完成', 409);
    this.checks.get(key)?.abort();
    this.jobs.cancel(key);
    this.generations.set(key, (this.generations.get(key) || 0) + 1);
    await this.jobs.wait(key);
    const project = await this.workspaces.config(id),
      previous = this.states.get(key) || new Map<string, HealthView>();
    const generation = this.generations.get(key),
      saved = new Map([...previous].map(([name, state]) => [name, { ...state }]));
    const names =
      action === 'start'
        ? serviceOrder(project.services || [], service).map((s) => s.name)
        : service
          ? [service]
          : (project.services || []).map((s) => s.name);
    for (const name of names)
      previous.set(name, { name, desired: false, status: 'stopped', failures: 0, restarts: 0, nextCheck: 0 });
    this.states.set(key, previous);
    return (success: boolean) => {
      if (this.generations.get(key) !== generation || this.closed) return;
      if (!success) {
        this.states.set(key, saved);
        return;
      }
      for (const name of names)
        previous.set(name, {
          name,
          desired: action === 'start',
          status: action === 'start' ? 'waiting' : 'stopped',
          failures: 0,
          restarts: 0,
          nextCheck: 0,
        });
      for (const name of names) this.blockedChecks.get(key)?.delete(name);
      if (!this.blockedChecks.get(key)?.size) this.blockedChecks.delete(key);
    };
  }
  async view(id: string) {
    const key = this.workspaces.projects?.key(id) || id;
    const config = await this.workspaces.config(id);
    return {
      services: (config.services || [])
        .filter((s) => s.health)
        .map<HealthView>(
          (s) =>
            this.states.get(key)?.get(s.name) || {
              name: s.name,
              desired: false,
              status: 'stopped',
              failures: 0,
              restarts: 0,
              nextCheck: 0,
            },
        ),
      job: this.jobs.view(key),
    };
  }
  observed(id: string) {
    return [...this.states].flatMap(([key, states]) => {
      const [vmId, projectId = 'default'] = key.split(':');
      return vmId === id ? [...states.values()].map((state) => ({ ...state, projectId })) : [];
    });
  }
  async tick(now = Date.now()) {
    for (const [key, states] of this.states) {
      const [id, projectId = 'default'] = key.split(':');
      const check = () => this.checkProject(id, key, states, now);
      if (this.workspaces.projects) await this.workspaces.projects.inScope(id, projectId, check);
      else await check();
    }
  }
  private async checkProject(id: string, key: string, states: Map<string, HealthView>, now: number) {
    if (
      this.closed ||
      !this.machines.live.has(id) ||
      this.machines.state(id) !== 'running' ||
      this.workspaces.jobs.view(key)?.status === 'running' ||
      this.jobs.view(key)?.status === 'running'
    )
      return;
    const abort = new AbortController(),
      generation = this.generations.get(key);
    this.checks.set(key, abort);
    let privateValues: string[] | undefined;
    try {
      const project = await this.workspaces.resolvedConfig(id);
      privateValues = projectPrivateValues(project);
      for (const service of project.services || []) {
        const policy = service.health,
          state = states.get(service.name);
        if (!policy || !state?.desired || state.nextCheck > now || abort.signal.aborted || this.blockedChecks.get(key)?.has(service.name)) continue;
        state.nextCheck = now + policy.interval * 1000;
        const ownership = await new ProjectServiceScopes(this.machines, id, project).status(service.name, abort.signal);
        if (ownership.status === 'prepared' || ownership.status === 'unconfirmed' ||
            (ownership.status === 'running' && ownership.record?.binding !== projectServiceBinding(project, service)))
          throw new AppError('服务启动或配置归属未确认，请先停止并重建', 409, 'SERVICE_SCOPE_CHANGED');
        if (ownership.status === 'running') {
          const identities = new ProjectRunScopes(this.machines);
          if (!ownership.record || !await identities.hasRun(id, ownership.record.projectId, ownership.record.runId))
            throw new AppError('服务尚未接入项目账号，请先确认停止全部后代再重新启动', 409, 'SERVICE_IDENTITY_REQUIRED');
          if (!await identities.readonlyActive(id, ownership.record.projectId, ownership.record.runId, abort.signal))
            throw new AppError('服务账号票据归属未确认，请先停止并重建', 409, 'SERVICE_SCOPE_CHANGED');
        }
        const result = ownership.status !== 'running' ? { code: 1 } : await projectIdentityTask(
          this.machines,
          id,
          project,
          { command: policy.command, environment: { ...project.environment, ...service.environment } },
          abort.signal,
          undefined,
          policy.timeout * 1000,
        ).catch((error) => {
          abort.signal.throwIfAborted();
          if (needsManualCleanup(error)) throw error;
          return { code: 1, stderr: (error as Error).message };
        });
        if (generation !== this.generations.get(key)) break;
        state.checkedAt = new Date().toISOString();
        if (result.code === 0) {
          state.status = 'healthy';
          state.failures = 0;
          delete state.error;
          continue;
        }
        state.failures++;
        state.status = 'unhealthy';
        state.error = '健康检查失败';
        if (!policy.restart || state.failures < policy.failures) continue;
        if (state.restarts >= policy.maxRestarts) {
          state.status = 'exhausted';
          state.error = '已达到自动重启上限，请检查日志后手动启动';
          continue;
        }
        state.restarts++;
        state.status = 'restarting';
        state.nextCheck = now + Math.min(3600, policy.backoff * 2 ** (state.restarts - 1)) * 1000;
        const affected = serviceOrder(project.services || []).filter(
          (s) =>
            states.get(s.name)?.desired &&
            serviceOrder(project.services || [], s.name).some(
              (dependency) => dependency.name === service.name,
            ),
        );
        this.jobs.start(
          key,
          async (rawLog, signal) => {
            const output = privateLog(rawLog, projectPrivateValues(project));
            try {
              if (generation !== this.generations.get(key)) throw new AppError('服务意图已改变');
              for (const target of [...affected].reverse()) {
                signal.throwIfAborted();
                await runServices(this.machines, id, project, 'stop', output.write, signal, target.name);
              }
              for (const target of affected) {
                signal.throwIfAborted();
                await runServices(this.machines, id, project, 'start', output.write, signal, target.name);
              }
              if (generation === this.generations.get(key)) state.status = 'waiting';
            } catch (error) {
              const detail = redactValues((error as Error).message, projectPrivateValues(project));
              if (generation === this.generations.get(key)) {
                if (needsManualCleanup(error)) {
                  const blocked = this.blockedChecks.get(key) || new Set<string>();
                  for (const target of affected) {
                    const paused = states.get(target.name);
                    if (!paused?.desired) continue;
                    blocked.add(target.name);
                    paused.status = 'unhealthy';
                    paused.error = '服务归属或清理未确认，自动检查与重启已暂停；请核查任务归属后手动停止服务。' + detail;
                  }
                  this.blockedChecks.set(key, blocked);
                } else {
                  state.status = 'unhealthy';
                  state.error = detail;
                }
              }
              throw new AppError(detail, error instanceof AppError ? error.status : 500,
                error instanceof AppError ? error.code : undefined);
            } finally {
              output.flush();
            }
          },
          {
            title: `服务自动重启 · ${service.name}（${state.restarts}/${policy.maxRestarts}）`,
            vmId: id,
            projectId: this.workspaces.projects?.current(id) || 'default',
          },
        );
        break;
      }
    } catch (error) {
      if (!abort.signal.aborted && generation === this.generations.get(key)) {
        const unconfirmed = needsManualCleanup(error);
        const detail = privateValues ? redactValues((error as Error).message, privateValues) : '';
        for (const state of states.values())
          if (state.desired) {
            state.status = 'unhealthy';
            state.checkedAt = new Date().toISOString();
            if (unconfirmed) {
              const blocked = this.blockedChecks.get(key) || new Set<string>();
              blocked.add(state.name);
              this.blockedChecks.set(key, blocked);
              state.error = '健康检查任务隔离或清理未确认，自动检查与重启已暂停；请核查任务归属后手动停止服务。' + detail;
            } else {
              state.error = '无法完成健康检查，请检查项目配置和私密配置引用' + (detail ? '：' + detail : '');
            }
          }
      }
    } finally {
      if (this.checks.get(key) === abort) this.checks.delete(key);
    }
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.machines.off('change', this.onChange);
    this.workspaces.onAction = undefined;
    for (const abort of this.checks.values()) abort.abort();
    await this.pending;
    await this.jobs.close();
  }
}
