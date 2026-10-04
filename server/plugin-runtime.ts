import type { JobsV1 } from './service-contracts/v1.ts';
import { APP_VERSION } from '../shared/version.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { pluginArtifactDigest, systemArtifactDigest } from './plugin-artifact.ts';
import { PluginDirectory } from './plugin-directory.ts';
import { ServiceBroker } from './service-broker.ts';
import { withPluginAuthority, withPluginCleanup } from './plugin-authority.ts';
import type { JobView } from '../shared/contracts/jobs.ts';
import { type VMConfig } from '../shared/contracts/vm.ts';
import { AppError } from '../shared/errors.ts';

import type { Machines } from './machines.ts';
import { OperationTracker, requestScope } from './operation-scope.ts';
import { currentOperation } from './operation-gateway.ts';
import { withResourceContext } from './host-runtime/index.ts';
import { SERVICE_KEYS, type PluginServices } from './plugin-services.ts';
import { TerminalBackend, type TerminalService } from './terminal-backend.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { SystemServices } from './system-services.ts';

import { resolvePlugins } from '../shared/plugin-selection.ts';
import { emptySelection, PLUGINS } from '../shared/plugins.ts';
import { pluginContext, type PluginContext } from './plugin-api.ts';
import { PluginScope, withinDeadline } from './plugin-scope.ts';
import {
  loaders,
  matchOperationPath,
  routeContribution,
  socketOwner,
  validateRegistry,
  type PluginModule,
} from './plugins/registry.ts';

/** Optional plugin host. No plugin services are constructed until explicitly selected. */
export interface PluginRuntime extends PluginServices {}
export class PluginRuntime {
  readonly broker: ServiceBroker;
  get enabled(): ReadonlySet<string> {
    return new Set(
      this.directory
        .view()
        .instances.filter((item) => item.source === 'official' && item.phase === 'running')
        .map((item) => item.pluginId),
    );
  }
  get errors(): Record<string, string> {
    return Object.fromEntries(
      this.directory
        .view()
        .instances.filter((item) => item.source === 'official' && item.error)
        .map((item) => [item.pluginId, item.error!]),
    );
  }
  get lifecycle(): Record<string, { phase: 'active' | 'failed' | 'skipped'; activationMs: number }> {
    return Object.fromEntries(
      this.directory
        .view()
        .instances.filter((item) => item.source === 'official' && item.phase !== 'inactive')
        .map((item) => [
          item.pluginId,
          {
            phase: item.phase === 'running' ? 'active' : item.phase === 'skipped' ? 'skipped' : 'failed',
            activationMs: item.activationMs,
          },
        ]),
    );
  }
  private modules = new Map<string, PluginModule>();
  private contexts = new Map<string, PluginContext>();
  private scopes = new Map<string, PluginScope>();
  private services = new Map<string, unknown>();
  private pluginJobs = new Map<
    JobsV1,
    { owner: string; retry: (job: JobView) => Promise<unknown> | unknown }
  >();
  readonly operations = new OperationTracker();
  get mutations() {
    return this.operations.active;
  }
  get vm() {
    return this.machines;
  }
  set mutations(value: number) {
    this.operations.active = value;
  }
  importing = false;
  private exclusives = new Set<string>();
  async exclusive<T>(name: string, work: () => Promise<T>): Promise<T> {
    if (this.exclusives.has(name)) throw new AppError('另一项操作仍在进行', 409);
    this.exclusives.add(name);
    this.importing = this.exclusives.has('import');
    try {
      return await work();
    } finally {
      this.exclusives.delete(name);
      this.importing = this.exclusives.has('import');
    }
  }
  private closed = false;
  private closing?: Promise<void>;
  private active = new Map<AbortController, Promise<boolean>>();
  private cleanupPending = new Set<string>();
  private ownsSystem = false;
  private terminalBackend: TerminalBackend;
  private terminalInstance: PluginInstance;
  terminalHandle(): TerminalService {
    return this.terminalBackend.handle();
  }
  async recoverProvider(identity: string, generation: string, artifactDigest: string) {
    const instance = this.directory.all().find(item => item.identity === identity && item.generation === generation && item.artifactDigest === artifactDigest);
    if (!instance || instance.phase !== 'cleanup-pending' ||
        !(instance === this.terminalInstance || instance.source === 'official'))
      throw new AppError('原插件恢复实例不可用', 409, 'RECOVERY_STALE');
    if (instance.source === 'official' && this.modules.has(instance.pluginId)) {
      await this.unload(instance.pluginId);
      return;
    }
    // Includes the original terminal scope and activation failures before module publication.
    instance.revoke(); this.directory.changed();
    try {
      await instance.scope.dispose(dispose => Promise.resolve(withPluginCleanup(instance, dispose)));
      this.broker.remove(instance);
      instance.phase = 'inactive';
    } catch (error) {
      instance.phase = 'cleanup-pending'; instance.error = String(error);
      throw error;
    } finally { this.directory.changed(); }
  }
  pluginResources() {
    return [...this.scopes].map(([id, scope]) => ({
      id,
      cleanupPending: this.cleanupPending.has(id),
      ...scope.diagnostics(),
    }));
  }
  private constructor(
    public machines: Machines,
    readonly directory = new PluginDirectory(),
    readonly system = new SystemServices(directory),
  ) {
    this.broker = system.broker;
    this.terminalInstance = directory.begin(
      'system',
      'terminal-backend',
      APP_VERSION,
      systemArtifactDigest('terminal-backend'),
    );
    this.terminalBackend = new TerminalBackend(
      machines,
      this.terminalInstance,
      {
        get secrets() {
          return host.secrets;
        },
        get network() {
          return host.network;
        },
      },
      this.broker,
      this.system.caller,
    );
    const host = this;
    directory.publish(this.terminalInstance);
    for (const key of SERVICE_KEYS)
      Object.defineProperty(this, key, {
        configurable: true,
        enumerable: true,
        get: () => this.system.official(key),
      });
  }
  serviceValue<T = unknown>(key: string): T | undefined {
    return this.services.get(key) as T | undefined;
  }
  provideService(key: string, value: unknown) {
    if (this.serviceValue(key) !== undefined) throw new Error(`插件服务已注册：${key}`);
    this.services.set(key, value);
  }
  registerPluginJobs(owner: string, store: JobsV1, retry: (job: JobView) => Promise<unknown> | unknown) {
    const manifest = PLUGINS.find((item) => item.id === owner);
    if (
      !manifest?.services.some((key) => {
        const service = this.serviceValue(key) as { jobs?: JobsV1 } | undefined;
        return service === store || service?.jobs === store;
      })
    )
      throw new Error(`插件 ${owner} 只能注册自有任务存储`);
    if (this.pluginJobs.has(store)) throw new Error(`任务存储已注册：${owner}`);
    this.pluginJobs.set(store, { owner, retry });
    this.directory.get('official', owner)?.contribute('job-retry', owner);
    const scope = this.scopes.get(owner);
    if (scope) {
      const cancel = () => {
        for (const job of store.list()) if (job.status === 'running') store.cancel(job.id!);
      };
      scope.signal.addEventListener('abort', cancel, { once: true });
      scope.add(async () => {
        await store.close();
        if (store.list().some((job) => job.admission === 'cleanup-pending'))
          throw new AppError('插件任务仍有资源等待领域恢复', 503, 'PLUGIN_CLEANUP_PENDING');
        scope.signal.removeEventListener('abort', cancel);
      });
    }
  }
  retryHandler(store: JobsV1) {
    const registration = this.pluginJobs.get(store);
    const instance = registration && this.directory.get('official', registration.owner);
    return (
      registration &&
      instance &&
      ((job: JobView) => {
        const check = () => {
          instance.check('jobs');
          if (this.directory.get('official', registration.owner) !== instance)
            throw new AppError('插件任务重试代次已改变', 403, 'PLUGIN_REVOKED');
        };
        check();
        const current = job.id ? store.get(job.id) : undefined;
        if ((current || job).admission === 'cleanup-pending' && !(current || job).cleanupResolvedAt)
          throw new AppError('资源清理尚未确认，请先执行领域恢复', 409, 'PLUGIN_CLEANUP_PENDING');
        return instance.scope.run(() => withPluginAuthority(instance, () => registration.retry(job), check));
      })
    );
  }
  static async create(
    machines: Machines,
    selected: string[] = [],
    rolloutAllowed: (pluginId: string) => boolean = () => true,
    directory = new PluginDirectory(),
    system?: SystemServices,
  ) {
    validateRegistry();
    const host = new PluginRuntime(machines, directory, system);
    host.ownsSystem = !system;
    directory.setDesired('official', selected);
    for (const id of resolvePlugins({ ...emptySelection(), plugins: selected })) {
      const startedAt = performance.now();
      const manifest = PLUGINS.find((item) => item.id === id)!;
      const instance = directory.begin(
        'official',
        id,
        manifest.version,
        await pluginArtifactDigest(manifest),
      );
      instance.declareManaged(manifest.contributes.managed);
      if (!rolloutAllowed(id)) {
        instance.error = '当前主机未命中功能灰度策略；请在系统设置中调整并重启 Sakura 服务';
        instance.phase = 'skipped';
        await instance.scope.dispose();
        directory.changed();
        continue;
      }
      if (manifest.requires.some((dependency) => !host.enabled.has(dependency.id))) {
        instance.error = '依赖插件启动失败';
        instance.phase = 'skipped';
        await instance.scope.dispose();
        directory.changed();
        continue;
      }
      let module: PluginModule | undefined;
      let started = false;
      try {
        module = await loaders[id]();
        if (
          !isDeepStrictEqual(module.manifest, manifest) ||
          typeof module.activate !== 'function' ||
          typeof module.route !== 'function'
        )
          throw new Error(`插件入口与声明不一致：${id}`);
        const declaredOperations = manifest.contributes.operations.map((item) => item.id).sort();
        const implementedOperations = Object.keys(module.operations || {}).sort();
        const declaredHttpHandlers = manifest.contributes.routes.filter(item => item.handler === 'route').map(item => item.id).sort();
        const implementedHttpHandlers = Object.keys(module.httpHandlers || {}).sort();
        if (
          !isDeepStrictEqual(declaredOperations, implementedOperations) ||
          !isDeepStrictEqual(declaredHttpHandlers, implementedHttpHandlers) ||
          implementedHttpHandlers.some(key => typeof module!.httpHandlers![key] !== 'function') ||
          implementedOperations.some(
            (key) =>
              typeof module!.operations![key].execute !== 'function' ||
              typeof module!.operations![key].response?.parse !== 'function',
          )
        )
          throw new Error(`插件操作实现与声明不一致：${id}`);
        const scope = instance.scope;
        host.scopes.set(id, scope);
        // Register before activation so partial construction is still owned after activation fails.
        const closedServices = new Set<unknown>();
        for (const key of manifest.services)
          scope.add(async () => {
            const service = host.serviceValue(key) as
              { close?: () => Promise<void> | void; jobs?: JobsV1 } | undefined;
            if (!service || closedServices.has(service)) return;
            if (service.close) await service.close();
            else if (service.jobs) await service.jobs.close();
            if (service.jobs?.list().some((job) => job.admission === 'cleanup-pending'))
              throw new AppError('插件任务仍有资源等待领域恢复', 503, 'PLUGIN_CLEANUP_PENDING');
            closedServices.add(service);
          });
        const context = pluginContext(host, manifest, PLUGINS, instance);
        host.contexts.set(id, context);
        if (module.deactivate) scope.add(() => module!.deactivate!(context));
        host.modules.set(id, module);
        started = true;
        await withinDeadline(
          scope.run(() => withPluginAuthority(instance, () => module!.activate(context))),
          manifest.lifecycle.activateMs,
          `${id} 激活`,
          () => scope.abort(),
        );
        for (const key of manifest.services)
          if (host.serviceValue(key) === undefined) throw new Error(`插件未注册声明的服务：${id}.${key}`);
        host.modules.set(id, module);
        for (const [kind, targets] of Object.entries(manifest.contributes)) {
          if (kind === 'managed' || kind === 'operations') continue;
          const name =
            (
              {
                sockets: 'socket',
                pages: 'page',
                tabs: 'tab',
                developmentSections: 'developmentSection',
                operations: 'operation',
                routes: 'operation',
              } as Record<string, string>
            )[kind] || kind;
          for (const target of targets)
            instance.contribute(
              name as import('../shared/contracts/plugin-runtime.ts').PluginContributionKind,
              typeof target === 'string' ? target : 'path' in target ? target.path : String(target),
            );
        }
        directory.publish(instance);
        instance.activationMs = Math.round(performance.now() - startedAt);
      } catch (error) {
        instance.error = (error as Error).message;
        instance.activationMs = Math.round(performance.now() - startedAt);
        if (module && started) {
          try {
            await host.dispose(module);
          } catch (cleanup) {
            instance.error += '；清理失败：' + (cleanup as Error).message;
          }
        }
        if (instance.phase !== 'cleanup-pending') {
          instance.phase = 'failed';
          await instance.scope.dispose().catch((cleanup) => {
            instance.phase = 'cleanup-pending';
            instance.error = String(cleanup);
          });
        }
        directory.changed();
      }
    }
    return host;
  }
  require(id: string) {
    if (!this.enabled.has(id))
      throw new AppError('请在插件中心启用插件「' + id + '」，并重启 Sakura 服务', 403);
    this.directory.get('official', id)?.check();
  }
  socketEnabled(channel: 'desktop' | 'terminal-session') {
    const owner = socketOwner(channel);
    return !!owner && this.enabled.has(owner);
  }
  validateConfig(input: unknown, previous?: VMConfig) {
    if (!input || typeof input !== 'object') return; // The VM schema reports invalid input.
    const value = input as Partial<VMConfig>;
    if (value.distro && value.distro !== 'alpine' && value.distro !== previous?.distro)
      this.require('images');
    if (value.template && value.template !== 'none' && value.template !== previous?.template)
      this.require('projects');
    if (value.forwards && JSON.stringify(value.forwards) !== JSON.stringify(previous?.forwards || []))
      this.require('network');
  }
  jobStores(): JobsV1[] {
    const stores: JobsV1[] = [...this.system.jobStores()];
    for (const module of this.modules.values())
      for (const key of module.manifest.services) {
        const service = this.serviceValue(key) as { jobs?: JobsV1 } | undefined;
        const store = key === 'jobs' ? this.serviceValue<JobsV1>(key) : service?.jobs;
        if (store && !stores.includes(store)) stores.push(store);
      }
    return stores;
  }
  private async dispose(module: PluginModule) {
    const id = module.manifest.id;
    const scope = this.scopes.get(id);
    const closeMs = module.manifest.lifecycle.closeMs;
    const instance = this.directory.get('official', id)!;
    instance.revoke();
    this.directory.changed();
    scope?.abort();
    try {
      await withinDeadline(
        scope?.dispose((disposer) =>
          withinDeadline(withPluginCleanup(instance, disposer), closeMs, `${id} 资源关闭`),
        ),
        closeMs,
        `${id} 资源清理`,
      );
    } catch (error) {
      this.cleanupPending.add(id);
      scope?.cleanupPending(error);
      instance.phase = 'cleanup-pending';
      instance.error = '插件清理未完成：' + (error as Error).message;
      this.directory.changed();
      throw error;
    }
    for (const key of module.manifest.services) this.services.delete(key);
    this.broker.remove(instance);
    for (const [store, value] of this.pluginJobs) if (value.owner === id) this.pluginJobs.delete(store);
    this.contexts.delete(id);
    this.scopes.delete(id);
    this.modules.delete(id);
    this.cleanupPending.delete(id);
    instance.phase = 'inactive';
    this.directory.changed();
  }
  /** Stop new dispatch immediately. Providers remain until their dependents have unloaded. */
  async unload(id: string) {
    const module = this.modules.get(id);
    if (!module) return;
    const dependents = [...this.modules.values()].filter(
      (item) =>
        item.manifest.id !== id &&
        (this.enabled.has(item.manifest.id) || this.cleanupPending.has(item.manifest.id)) &&
        item.manifest.requires.some((dependency) => dependency.id === id),
    );
    if (dependents.length)
      throw new AppError(
        '请先停用依赖此插件的插件：' + dependents.map((item) => item.manifest.id).join('、'),
        409,
        'PLUGIN_DEPENDENTS_ACTIVE',
      );
    await this.dispose(module);
  }
  async close() {
    if (!this.closing) {
      this.closed = true;
      for (const instance of this.directory.all())
        if (instance.source === 'official' && instance.phase === 'running') instance.revoke();
      this.directory.changed();
      for (const scope of this.scopes.values()) scope.abort();
      for (const abort of this.active.keys()) abort.abort();
      this.closing = (async () => {
        // Dispose dependents before their providers; always attempt all cleanup.
        const errors: unknown[] = [];
        try {
          await withinDeadline(Promise.allSettled([...this.active.values()]), 10000, '插件请求清理');
        } catch (error) {
          errors.push(error);
        }
        for (const module of [...this.modules.values()].reverse()) {
          try {
            await this.unload(module.manifest.id);
          } catch (error) {
            errors.push(error);
          }
        }
        this.terminalInstance.revoke();
        try {
          await this.terminalInstance.scope.dispose((dispose) =>
            Promise.resolve(withPluginCleanup(this.terminalInstance, dispose)),
          );
          this.terminalInstance.phase = 'inactive';
        } catch (error) {
          this.terminalInstance.phase = 'cleanup-pending';
          this.terminalInstance.error = String(error);
          errors.push(error);
        }
        this.directory.changed();
        if (this.ownsSystem) {
          try {
            await this.system.close();
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length) throw new AggregateError(errors, '插件关闭失败');
      })();
    }
    try {
      await this.closing;
    } catch (error) {
      this.closing = undefined;
      throw error;
    }
  }
  async route(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    body: (req: IncomingMessage, signal?: AbortSignal, limit?: number) => Promise<any>,
  ) {
    const contribution = routeContribution(url.pathname);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (!contribution) return false;
    const { owner } = contribution;
    if (owner !== 'tasks') this.require(owner);
    if (!contribution.methods.some((method) => method === req.method))
      throw new AppError('不支持此方法', 405);
    const policy = currentOperation();
    if (!policy) throw new AppError('插件入口缺少已准入的操作声明', 403, 'OPERATION_NOT_ADMITTED');
    const handler = owner === 'tasks' ? (await import('./plugins/tasks.ts')).route :
      this.modules.get(owner)!.httpHandlers?.[policy.id.slice(owner.length + 1)];
    const module = owner === 'tasks' ? undefined : this.modules.get(owner)!;
    const declaredOperation = module?.manifest.contributes.operations.find(
      (item) => owner + '.' + item.id === policy.id,
    );
    const operation = declaredOperation && module?.operations?.[declaredOperation.id];
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (!operation && !handler) throw new AppError('操作没有原插件登记处理器', 503, 'OPERATION_HANDLER_MISSING');
    const mutation = policy.mutating;
    const targetVm = matchOperationPath(policy.path, url.pathname)?.vmId;
    if (policy.vmLock === 'require-unlocked' && targetVm)
      this.machines.requireUnlocked?.(targetVm);
    const releaseMutation = mutation ? this.operations.enter() : () => {};
    const scope = requestScope(req, res),
      abort = scope.controller;
    const pluginScope = this.scopes.get(owner);
    const revoke = () => abort.abort(pluginScope?.signal.reason);
    pluginScope?.signal.addEventListener('abort', revoke, { once: true });
    if (pluginScope?.signal.aborted) revoke();
    const pending = Promise.resolve()
      .then(() => {
        abort.signal.throwIfAborted();
        if (policy.maintenance === 'block' && this.migration?.blocked)
          throw new AppError('数据目录迁移维护中', 409);
        const route = () =>
          operation && declaredOperation
            ? (async () => {
                // Operations without a request schema have no body (for example DELETE).
                const raw =
                  req.method === 'GET' || !operation.request ? undefined : await body(req, abort.signal);
                const input = operation.request ? operation.request.parse(raw) : raw;
                const output = await operation.execute.call(
                  this.contexts.get(owner)!,
                  url,
                  input,
                  abort.signal,
                );
                abort.signal.throwIfAborted();
                const parsed = operation.response.safeParse(output);
                if (!parsed.success)
                  throw new AppError(`插件 ${owner} 的响应不符合操作协议`, 502, 'INVALID_PLUGIN_RESPONSE');
                const result = parsed.data;
                res.writeHead(declaredOperation.status, {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Cache-Control': 'no-store',
                  'X-Content-Type-Options': 'nosniff',
                });
                res.end(JSON.stringify(result));
                return true;
              })()
            : (handler as import('./plugin-api.ts').PluginRoute).call(
                owner === 'tasks' ? (this as unknown as PluginContext) : this.contexts.get(owner)!,
                req,
                res,
                url,
                async (request, signal, limit) => {
                  const value = await body(request, signal || abort.signal, limit);
                  if (policy.maintenance === 'block' && this.migration?.blocked)
                    throw new AppError('数据目录迁移维护中', 409);
                  return value;
                },
                abort.signal,
              );
        const dispatch = () =>
          this.workspaces && targetVm && policy.projectScoped && /^[0-9a-f-]{36}$/i.test(targetVm)
            ? this.workspaces.projects.with(targetVm, url.searchParams.get('project'), route)
            : route();
        return pluginScope
          ? pluginScope.run(() => withPluginAuthority(this.directory.get('official', owner)!, dispatch))
          : dispatch();
      })
      .finally(() => {
        this.active.delete(abort);
        releaseMutation();
        pluginScope?.signal.removeEventListener('abort', revoke);
        scope.dispose();
      });
    this.active.set(abort, pending);
    return pending;
  }
}
