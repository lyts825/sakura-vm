import type { Machines } from './machines.ts';
import { type Workspaces, projectPrivateValues } from './workspaces.ts';
import { envPrefix, runServices, serviceOrder, serviceSession } from './project-services.ts';
import { guestTask } from './guest-task.ts';
import { quote } from './files.ts';
import { Jobs } from './jobs.ts';
import { privateLog, redactValues } from './secrets.ts';
import { AppError } from './model.ts';

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
  private pending?: Promise<void>;
  private closed = false;
  private timer: ReturnType<typeof setInterval>;
  private onChange = () => {
    for (const key of this.states.keys())
      if (!this.machines.live.has(key.split(':')[0])) {
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
    };
  }
  async view(id: string) {
    const key = this.workspaces.projects?.key(id) || id;
    const config = await this.workspaces.config(id);
    return {
      services: (config.services || [])
        .filter((s) => s.health)
        .map(
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
    try {
      const project = await this.workspaces.resolvedConfig(id);
      for (const service of project.services || []) {
        const policy = service.health,
          state = states.get(service.name);
        if (!policy || !state?.desired || state.nextCheck > now || abort.signal.aborted) continue;
        state.nextCheck = now + policy.interval * 1000;
        const script = `set -e\ncd ${quote(project.directory)}\n${envPrefix({ ...project.environment, ...service.environment })}\ntmux has-session -t =${serviceSession(service.name, project)}\n${policy.command}`;
        const result = await guestTask(
          this.machines,
          id,
          script,
          abort.signal,
          undefined,
          policy.timeout * 1000,
        ).catch((error) => {
          abort.signal.throwIfAborted();
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
              if (generation === this.generations.get(key)) {
                state.status = 'unhealthy';
                state.error = redactValues((error as Error).message, projectPrivateValues(project));
              }
              throw new AppError(redactValues((error as Error).message, projectPrivateValues(project)));
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
      if (!abort.signal.aborted)
        for (const state of states.values())
          if (state.desired) {
            state.status = 'unhealthy';
            state.error = '无法完成健康检查，请检查项目配置和私密配置引用';
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
