import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import type { Machines } from './machines.ts';
import { AppError, type DesktopView } from './model.ts';
import { Workspaces, projectPrivateValues, projectVersion, type Project } from './workspaces.ts';
import { ProjectTerminals } from './project-terminals.ts';
import { ProjectRunScopes } from './project-run-scope.ts';
import { ProjectIdentities, projectIdentityPayload, projectIdentitySources } from './project-identity.ts';
import { ProjectDesktopScope } from './project-service-scope.ts';
import { DesktopBindings, bindingProject, type ProjectDesktopBinding, type DesktopBinding } from './desktop-binding.ts';
import { desktopProjectEnvironment, desktopProjectPrepare, desktopProjectVersionProbe, desktopUidCommand, desktopCommands,
  desktopProjectImePrepare, desktopProjectImeCommand } from './desktop-guest.ts';
import { defaultDesktopPreferences, desktopPreferencesSchema, type DesktopPreferences } from './desktop-preferences.ts';
import { desktopAuthoritySchema, desktopProjectControl, desktopProjectCommand, type DesktopControlProof, type DesktopAuthority } from './desktop-project-control.ts';
import { guestTaskControlPlan, cleanupGuestTaskPlan } from './guest-task.ts';
import { privateLog, redactValues } from './secrets.ts';

const same = isDeepStrictEqual;
const changed = () => new AppError('Desktop 原项目配置或客户机运行身份已改变', 409, 'DESKTOP_SCOPE_CHANGED');
const legacy = () => new AppError('旧共享 Desktop 缺少完整 UID 会话票据，只能审阅；请由管理员明确处理原会话及旧记录', 409, 'DESKTOP_LEGACY_REVIEW_REQUIRED');
const cloneProject = (project: Project) => {
  const value = structuredClone(project);
  Object.defineProperty(value, '_workspace', { value: project._workspace, enumerable: false });
  return value;
};
export type DesktopStartPins = { projectId: string; live: NonNullable<ReturnType<Machines['live']['get']>> };
type Control = typeof desktopProjectControl;
type PendingStart = { runId: string | null; retained: boolean; release: () => Promise<void>; adminCleanup?: () => Promise<void>;
  binding?: ProjectDesktopBinding };
const pendingStarts = new WeakMap<Machines, Map<string, PendingStart>>();

/** The no-Workspaces desktop remains the explicit instance-administration path. */
export class ProjectDesktops {
  readonly bindings: DesktopBindings;
  private scopes: ProjectRunScopes;
  private identities: ProjectIdentities;
  private pending: Map<string, PendingStart>;
  constructor(private machines: Machines, private workspaces: Workspaces, private options: {
    control?: Control; build?: () => Promise<string>; readyTimeoutMs?: number;
    beforeRetire?: (id: string, proof: DesktopControlProof) => Promise<void>;
  } = {}) {
    this.bindings = new DesktopBindings(machines);
    this.scopes = new ProjectRunScopes(machines);
    this.identities = new ProjectIdentities(machines);
    if (!pendingStarts.has(machines)) pendingStarts.set(machines, new Map());
    this.pending = pendingStarts.get(machines)!;
  }
  private async releasePending(id: string, runId: string | null) {
    const pending = this.pending.get(id);
    if (!pending || pending.runId !== runId || pending.adminCleanup) return;
    await pending.release();
    if (this.pending.get(id) === pending) this.pending.delete(id);
  }
  private async packages(id: string, script: string, pending: PendingStart, originalLive: object,
    signal: AbortSignal, log: (line: string) => void) {
    const runId = randomUUID(), commands = guestTaskControlPlan(runId, randomUUID(), script, 920000);
    // The exact guest-task token, boot and cgroup receipt remain available for
    // an independent retry. This body contains only fixed administration code.
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
  private control(id: string, op: Parameters<Control>[2], binding: ProjectDesktopBinding, signal?: AbortSignal) {
    return (this.options.control || desktopProjectControl)(this.machines, id, op, this.proof(binding), signal);
  }
  private proof(binding: ProjectDesktopBinding): DesktopControlProof {
    return { version: 1, ...binding.execution };
  }
  private process(id: string, binding: ProjectDesktopBinding) {
    return new ProjectDesktopScope(this.machines, id, bindingProject(binding));
  }
  private assertLive(id: string, live: object) {
    if (this.machines.live.get(id) !== live || this.machines.state(id) !== 'running') throw changed();
  }
  private async save(id: string, previous: ProjectDesktopBinding, next: ProjectDesktopBinding, live: object) {
    this.assertLive(id, live);
    await this.bindings.save(id, next, previous);
    this.assertLive(id, live);
    return next;
  }
  private async installed(id: string, signal?: AbortSignal) {
    const result = await this.machines.exec(id, desktopProjectVersionProbe, 10000, signal);
    return result.code === 0;
  }
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
    return this.workspaces.projects.with(id, binding.projectId, async () => {
      const captured = await this.workspaces.config(id);
      this.assertLive(id, live);
      if (projectVersion(captured) !== binding.configVersion || captured.directory !== binding.directory ||
          (captured.networkIsolation || 'host') !== binding.networkIsolation) return null;
      return { projectId: binding.projectId, preferences: binding.preferences };
    });
  }
  async start(id: string, action: 'install' | 'start' | 'configure' | 'ime', input: Partial<DesktopPreferences> | undefined,
    pins: DesktopStartPins, signal: AbortSignal, log: (line: string) => void,
    captured: (binding: ProjectDesktopBinding, values: string[]) => void) {
    const capturedInput = input === undefined ? undefined : structuredClone(input);
    return this.workspaces.projects.inScope(id, pins.projectId, async () => {
      signal.throwIfAborted(); this.assertLive(id, pins.live);
      const original = cloneProject(await this.workspaces.config(id)), version = projectVersion(original);
      if ((original._workspace || 'default') !== pins.projectId) throw changed();
      const assertCurrent = async () => {
        signal.throwIfAborted(); this.assertLive(id, pins.live);
        const current = await this.workspaces.config(id);
        if ((current._workspace || 'default') !== pins.projectId || projectVersion(current) !== version) throw changed();
        this.assertLive(id, pins.live);
      };
      const terminals = new ProjectTerminals(this.machines, this.workspaces);
      let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
      let pending: PendingStart | undefined;
      try {
        if (this.pending.has(id)) throw new AppError('Desktop 原启动清理未确认，请重试停止；原准备租约仍保留', 503, 'DESKTOP_CLEANUP_FAILED');
        prepared = await terminals.prepare(id, pins.projectId, null, false, signal, undefined, { mode: 'task' });
        if (!prepared.captured || prepared.captured.live !== pins.live || prepared.captured.configVersion !== version ||
            prepared.projectId !== pins.projectId || (prepared.captured.project._workspace || 'default') !== pins.projectId) throw changed();
        if (this.pending.has(id)) throw new AppError('Desktop 原启动准备仍由准确票据占有', 409, 'DESKTOP_SCOPE_CHANGED');
        pending = { runId: null, retained: false, release: async () => {
          try { await prepared!.release(); } finally { await terminals.close(); }
        } };
        this.pending.set(id, pending);
        const executionSignal = prepared.signal!;
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
  async application(id: string) {
    const projectId = this.workspaces.projects.current(id), live = this.machines.live.get(id);
    const terminals = new ProjectTerminals(this.machines, this.workspaces);
    let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
    const release = async () => { try { await prepared?.release(); } finally { await terminals.close(); } };
    try {
      prepared = await terminals.prepare(id, projectId, null, false, undefined, undefined, { mode: 'task' });
      if (!prepared.captured || prepared.captured.live !== live || prepared.projectId !== projectId) throw changed();
      const original = cloneProject(prepared.captured.project), binding = await this.bindings.read(id);
      if (!binding || binding.version !== 2 || binding.projectId !== projectId || binding.configVersion !== projectVersion(original)) throw changed();
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
