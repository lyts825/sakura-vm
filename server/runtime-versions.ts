import { z } from 'zod';
import { AppError } from './model.ts';
import type { Machines } from './machines.ts';
import { projectVersion, type Workspaces, type Project } from './workspaces.ts';
import { Jobs } from './jobs.ts';
import { guestTask } from './guest-task.ts';
import { randomUUID } from 'node:crypto';
import { projectIdentityTask } from './project-run-scope.ts';
import { parseRuntimeProbe, runtimeProbeCommand, runtimeProbeTimeout, type RuntimeProbeSample } from './runtime-probe.ts';
import { runtimeInstallCommand, parseRuntimeInstall, parseRuntimeInstallRecovery, runtimeInstallSetup } from './runtime-install.ts';
import { exactVersion, runtimesSchema, matchesVersion, type RuntimeVersionsConfig } from './runtime-config.ts';
export { exactVersion, runtimesSchema, runtimeRoot, runtimeBin, runtimeEnvironment,
  declarationVersion, matchesVersion, type RuntimeVersionsConfig } from './runtime-config.ts';
export type RuntimeProbeState = 'unprobed' | 'cached' | 'stale' | 'running' | 'failed';
type CompletedSample = { sample: RuntimeProbeSample; configVersion: string;
  live: unknown; checkedAt: string; at: number; invalidated: boolean };
type Pending = { controller: AbortController; done: Promise<unknown> };
const cleanupFailure = (error: unknown) => error instanceof AppError &&
  ['GUEST_TASK_CLEANUP_FAILED', 'PROJECT_IDENTITY_CLEANUP_FAILED',
    'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED', 'RUNTIME_INSTALL_CLEANUP_FAILED'].includes(error.code || '');
export class RuntimeVersions {
  jobs = new Jobs('runtime-versions');
  private samples = new Map<string, CompletedSample>();
  private failures = new Map<string, string>();
  private pending = new Map<string, Pending>();
  private closed = false;
  private closing?: Promise<void>;
  private unsubscribe: () => void;
  constructor(private machines: Machines, private workspaces: Workspaces,
    private options: { runTask?: typeof projectIdentityTask; runInstallTask?: typeof guestTask;
      now?: () => number } = {}) {
    this.unsubscribe = workspaces.onConfigChange(() => {
      for (const value of this.samples.values()) value.invalidated = true;
      return Promise.resolve();
    });
  }
  private now() { return this.options.now?.() ?? Date.now(); }
  private key(id: string) { return this.workspaces.projects.key(id); }
  private assertOpen(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.closed) throw new AppError('运行时服务正在关闭', 503, 'RUNTIME_CLOSED');
  }
  private operation<T>(id: string, signal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>) {
    this.assertOpen(signal);
    const key = this.key(id);
    if (this.pending.has(key)) throw new AppError('该项目的版本操作仍在进行', 409, 'RUNTIME_BUSY');
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const done = Promise.resolve().then(() => action(controller.signal)).catch(error => {
      this.failures.set(key, error instanceof AppError && /^[A-Z_]{1,80}$/.test(error.code || '')
        ? error.code! : controller.signal.aborted ? 'RUNTIME_CANCELLED' : 'RUNTIME_PROBE_FAILED');
      while (this.failures.size > 256) this.failures.delete(this.failures.keys().next().value!);
      throw error;
    }).finally(() => {
      signal?.removeEventListener('abort', abort);
      if (this.pending.get(key)?.controller === controller) this.pending.delete(key);
    });
    this.pending.set(key, { controller, done });
    return done;
  }
  private current(id: string, scope: string, live: unknown, signal: AbortSignal) {
    this.assertOpen(signal);
    if (this.workspaces.projects.current(id) !== scope || !live ||
        this.machines.live.get(id) !== live || this.machines.state(id) !== 'running')
      throw new AppError('实例或项目归属已变化，请重新探测', 409, 'RUNTIME_BINDING_CHANGED');
  }
  private remember(key: string, sample: RuntimeProbeSample, configuration: string, live: unknown) {
    this.samples.delete(key);
    const at = this.now();
    this.samples.set(key, { sample, configVersion: configuration, live,
      checkedAt: new Date(at).toISOString(), at, invalidated: false });
    this.failures.delete(key);
    while (this.samples.size > 256) this.samples.delete(this.samples.keys().next().value!);
  }
  private async receipt(id: string, pins: RuntimeVersionsConfig, signal: AbortSignal) {
    const architecture = this.machines.get(id).architecture || 'x86_64';
    for (const [tool, version] of Object.entries(pins) as ['node' | 'python', string][]) {
      signal.throwIfAborted();
      const result = await this.machines.exec(id, runtimeInstallCommand({ operation: 'verify', tool, version, architecture }), 15_000, signal);
      parseRuntimeInstall(result, { tool, version, phase: 'ready', architecture });
    }
  }
  private async measure(id: string, project: Project, signal: AbortSignal) {
    await this.receipt(id, project.runtimes || {}, signal);
    const resolved = await this.workspaces.resolveProject(id, project);
    this.assertOpen(signal);
    const result = await (this.options.runTask || projectIdentityTask)(this.machines, id, project,
      { command: runtimeProbeCommand(project.runtimes), environment: resolved.environment }, signal,
      undefined, runtimeProbeTimeout);
    this.assertOpen(signal);
    return parseRuntimeProbe(result);
  }
  async probe(id: string, signal?: AbortSignal) {
    await this.operation(id, signal, active => this.machines.locked(id, async () => {
      const scope = this.workspaces.projects.current(id), live = this.machines.live.get(id);
      this.current(id, scope, live, active);
      const project = await this.workspaces.config(id), version = projectVersion(project);
      const sample = await this.measure(id, project, active);
      this.current(id, scope, live, active);
      if (projectVersion(await this.workspaces.config(id)) !== version)
        throw new AppError('项目配置已变化，请重新探测', 409, 'RUNTIME_CONFIGURATION_CHANGED');
      this.current(id, scope, live, active);
      this.remember(this.key(id), sample, version, live);
    }));
    return this.view(id, signal);
  }
  // Compatibility for explicit internal probes. A supplied stale or foreign
  // project cannot be used to launch a different identity than the current one.
  async inspect(id: string, project: Project, signal?: AbortSignal) {
    const current = await this.workspaces.config(id);
    if (projectVersion(project) !== projectVersion(current) || project._workspace !== current._workspace)
      throw new AppError('项目配置已变化，请重新探测', 409, 'RUNTIME_CONFIGURATION_CHANGED');
    return (await this.probe(id, signal)).actual;
  }
  async view(id: string, signal?: AbortSignal) {
    this.assertOpen(signal);
    const project = await this.workspaces.config(id), selected = project.runtimes || {}, key = this.key(id);
    this.assertOpen(signal);
    const value = this.samples.get(key), sample = value?.sample;
    const actual = sample ? { ...sample.actual } : { node: '', python: '' }, declared = { ...sample?.declared };
    const stale = value && (value.invalidated || this.now() - value.at > 300_000 ||
      value.live !== this.machines.live.get(id) || this.machines.state(id) !== 'running' ||
      value.configVersion !== projectVersion(project));
    const state: RuntimeProbeState = this.pending.has(key) ? 'running' : this.failures.has(key) ? 'failed'
      : !value ? 'unprobed' : stale ? 'stale' : 'cached';
    return { selected, declared, actual,
      mismatches: sample ? (['node', 'python'] as const).filter(tool =>
        (selected[tool] || declared[tool]) && !matchesVersion(actual[tool], selected[tool] || declared[tool]!)) : [],
      probe: { state, checkedAt: value?.checkedAt || null, configVersion: value?.configVersion || null,
        bootId: sample?.bootId || null, ...(this.failures.has(key) ? { errorCode: this.failures.get(key)! } : {}) },
      job: this.jobs.view(key) };
  }
  async select(id: string, input: unknown, signal?: AbortSignal) {
    const runtimes = runtimesSchema.parse(input);
    return this.operation(id, signal, async active => {
      const captured = await this.machines.locked(id, async () => {
        const scope = this.workspaces.projects.current(id), live = this.machines.live.get(id);
        this.current(id, scope, live, active);
        const original = await this.workspaces.config(id), version = projectVersion(original);
        const candidate: Project = { ...original, runtimes };
        Object.defineProperty(candidate, '_workspace', { value: original._workspace, enumerable: false });
        const sample = await this.measure(id, candidate, active);
        for (const [tool, requested] of Object.entries(runtimes) as ['node' | 'python', string][])
          if (sample.actual[tool] !== requested)
            throw new AppError(`请先安装并核对 ${tool} ${requested}`, 409, 'RUNTIME_VERSION_MISMATCH');
        this.current(id, scope, live, active);
        return { scope, live, original, candidate, version, sample };
      });
      const commit = () => this.current(id, captured.scope, captured.live, active);
      commit();
      const saved = await this.workspaces.save(id, captured.candidate, undefined, captured.version, commit);
      // A successful atomic configuration publication is not rolled back when
      // the caller disconnects afterwards. Do not publish a sample after abort.
      commit();
      this.remember(this.key(id), captured.sample, projectVersion(saved), captured.live);
      return saved;
    });
  }
  async install(id: string, input: unknown) {
    this.assertOpen();
    const { tool, version } = z
      .object({ tool: z.enum(['node', 'python']), version: exactVersion })
      .strict()
      .parse(input);
    const vm = this.machines.get(id);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    if (tool === 'node' && (!vm.distro || vm.distro === 'alpine'))
      throw new AppError('Node 官方预编译版本需要 Debian/Ubuntu；Alpine 可继续使用发行版 Node');
    const live = this.machines.live.get(id), scope = this.workspaces.projects.current(id);
    const architecture = vm.architecture || 'x86_64';
    const installId = randomUUID(), runId = randomUUID();
    return this.jobs.start(
      this.workspaces.projects.key(id),
      async (log, signal) => this.machines.locked(id, async () => {
        this.current(id, scope, live, signal);
        const kernel = await this.machines.exec(id,
          'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/cat /proc/sys/kernel/random/boot_id', 10_000, signal);
        const bootId = z.uuid().safeParse(kernel.stdout.trim());
        if (kernel.code !== 0 || !bootId.success) throw new AppError('无法固定安装开机身份', 409, 'RUNTIME_BINDING_CHANGED');
        const network = await this.workspaces.networkEnvironment(id);
        this.current(id, scope, live, signal);
        const script = 'set -eu\n' + runtimeInstallSetup(vm.distro, network) + ' >&2\n' +
          runtimeInstallCommand({ operation: 'prepare', tool, version, installId, runId, bootId: bootId.data, architecture, network });
        let confirmed = false;
        try {
          const result = await (this.options.runInstallTask || guestTask)(this.machines, id, script,
            signal, log, 1_200_000, undefined, undefined, { runId });
          this.current(id, scope, live, signal);
          let existing = false;
          try { existing = JSON.parse(result.stdout).result?.phase === 'ready'; } catch { /* Strict parse follows. */ }
          parseRuntimeInstall(result, { tool, version, architecture, phase: existing ? 'ready' : 'prepared',
            ...(existing ? {} : { installId }) });
          if (!existing) {
            const final = await this.machines.exec(id, runtimeInstallCommand({ operation: 'confirm',
              tool, version, installId, bootId: bootId.data, architecture }), 30_000, signal);
            parseRuntimeInstall(final, { tool, version, phase: 'ready', installId, architecture });
          }
          confirmed = true;
          for (const [key, value] of this.samples) if (key === id || key.startsWith(id + ':')) value.invalidated = true;
          log('运行时安装回执已确认；项目版本选择将通过项目账户验证。\n');
        } finally {
          if (!confirmed) {
            // A cancelled body cannot publish ready. This independent control
            // connection retires only its exact recorded stage after CG empty.
            if (!live || this.machines.live.get(id) !== live || this.machines.state(id) !== 'running')
              throw new AppError('安装清理归属未确认，请恢复实例后重试安装', 503, 'RUNTIME_INSTALL_CLEANUP_FAILED');
            let retired = false;
            for (let attempt = 0; attempt < 3 && !retired; attempt++) {
              try {
                const result = await this.machines.exec(id, runtimeInstallCommand({ operation: 'recover',
                  tool, version, installId, architecture }), 30_000);
                parseRuntimeInstallRecovery(result, { tool, version, architecture });
                retired = true;
              } catch { /* Retry the same receipt; never choose another stage. */ }
            }
            if (!retired) throw new AppError('运行时安装清理未确认，请重试安装核对原回执', 503, 'RUNTIME_INSTALL_CLEANUP_FAILED');
          }
        }
      }),
      {
        title: `安装 ${tool} ${version}`,
        vmId: id,
        projectId: this.workspaces.projects.current(id),
        action: `install:${tool}:${version}`,
      },
    );
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.unsubscribe();
    const pending = [...this.pending.values()];
    const installing = this.jobs.list().filter(job => job.status === 'running');
    for (const value of pending) value.controller.abort();
    this.closing = (async () => {
      const results = await Promise.allSettled([this.jobs.close(), ...pending.map(value => value.done)]);
      this.samples.clear(); this.failures.clear();
      for (const result of results) if (result.status === 'rejected' && cleanupFailure(result.reason)) throw result.reason;
      // Jobs records failures instead of rejecting close(). Preserve a cleanup
      // failure from an installation cancelled by this close as well.
      for (const job of installing) if (job.status === 'error' &&
          cleanupFailure(new AppError('', 503, job.errorCode)))
        throw new AppError('运行时安装清理未确认，请恢复实例后重试', 503, job.errorCode);
    })();
    return this.closing;
  }
}
