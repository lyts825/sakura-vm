import type { IncomingMessage, ServerResponse } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import type { JobView } from '../shared/contracts/jobs.ts';
import { type VMConfig } from '../shared/contracts/vm.ts';
import { AppError } from '../shared/errors.ts';
import type { Jobs } from './jobs.ts';
import type { Machines } from './machines.ts';
import { OperationTracker, requestScope } from './operation-scope.ts';
import { withResourceContext } from './host-runtime/index.ts';
import { SERVICE_KEYS, type PluginServices } from './plugin-services.ts';




import { resolvePlugins } from '../shared/plugin-selection.ts';
import { emptySelection, PLUGINS } from '../shared/plugins.ts';
import { pluginContext, type PluginContext } from './plugin-api.ts';
import { PluginScope, withinDeadline } from './plugin-scope.ts';
import {
  loaders,
  routeContribution,
  socketOwner,
  validateRegistry,
  type PluginModule,
} from './plugins/registry.ts';

function matchesOperation(pattern: string, pathname: string) {
  const declared = pattern.split('/').filter(Boolean),
    actual = pathname.split('/').filter(Boolean);
  return (
    declared.length === actual.length &&
    declared.every((part, index) =>
      part === ':vmId' ? !!actual[index] && actual[index] !== 'batch' : part === actual[index],
    )
  );
}

/** Optional plugin host. No plugin services are constructed until explicitly selected. */
export interface Features extends PluginServices {}
export class Features {
  extraJobStores: Jobs[] = [];

  readonly enabled = new Set<string>();
  readonly errors: Record<string, string> = {};
  readonly lifecycle: Record<string, { phase: 'active' | 'failed' | 'skipped'; activationMs: number }> = {};
  private modules = new Map<string, PluginModule>();
  private contexts = new Map<string, PluginContext>();
  private scopes = new Map<string, PluginScope>();
  private services = new Map<string, unknown>();
  private pluginJobs = new Map<
    Jobs,
    { owner: string; retry: (job: JobView) => Promise<unknown> | unknown }
  >();
  readonly operations = new OperationTracker();
  get mutations() { return this.operations.active; }
  set mutations(value: number) { this.operations.active = value; }
  importing = false;
  private closed = false;
  private closing?: Promise<void>;
  private active = new Map<AbortController, Promise<boolean>>();
  private cleanupPending = new Set<string>();
  pluginResources() {
    return [...this.scopes].map(([id, scope]) => ({ id, cleanupPending: this.cleanupPending.has(id), ...scope.diagnostics() }));
  }
  private constructor(public machines: Machines) {
    for (const key of SERVICE_KEYS) Object.defineProperty(this, key, {
      configurable: true, enumerable: true,
      get: () => this.services.get(key),
      set: (value: unknown) => this.provideService(key, value),
    });
  }
  serviceValue(key: string): unknown {
    return this.services.get(key);
  }
  provideService(key: string, value: unknown) {
    if (this.serviceValue(key) !== undefined) throw new Error(`插件服务已注册：${key}`);
    this.services.set(key, value);
  }
  registerPluginJobs(owner: string, store: Jobs, retry: (job: JobView) => Promise<unknown> | unknown) {
    const manifest = PLUGINS.find((item) => item.id === owner);
    if (
      !manifest?.services.some((key) => {
        const service = this.serviceValue(key) as { jobs?: Jobs } | undefined;
        return service === store || service?.jobs === store;
      })
    )
      throw new Error(`插件 ${owner} 只能注册自有任务存储`);
    if (this.pluginJobs.has(store)) throw new Error(`任务存储已注册：${owner}`);
    this.pluginJobs.set(store, { owner, retry });
    const scope = this.scopes.get(owner);
    if (scope) {
      const cancel = () => { for (const job of store.list()) if (job.status === 'running') store.cancel(job.id!); };
      scope.signal.addEventListener('abort', cancel, { once: true });
      scope.add(async () => {
        await store.close();
        if (store.list().some((job) => job.admission === 'cleanup-pending'))
          throw new AppError('插件任务仍有资源等待领域恢复', 503, 'PLUGIN_CLEANUP_PENDING');
        scope.signal.removeEventListener('abort', cancel);
      });
    }
  }
  retryHandler(store: Jobs) {
    const registration = this.pluginJobs.get(store);
    return registration && ((job: JobView) => {
      this.require(registration.owner);
      const current = job.id ? store.get(job.id) : undefined;
      if ((current || job).admission === 'cleanup-pending' && !(current || job).cleanupResolvedAt)
        throw new AppError('资源清理尚未确认，请先执行领域恢复', 409, 'PLUGIN_CLEANUP_PENDING');
      return this.scopes.get(registration.owner)!.run(() => registration.retry(job));
    });
  }
  static async create(machines: Machines, selected: string[] = [],
    rolloutAllowed: (pluginId: string) => boolean = () => true) {
    validateRegistry();
    const host = new Features(machines);
    for (const id of resolvePlugins({ ...emptySelection(), plugins: selected })) {
      const startedAt = performance.now();
      const manifest = PLUGINS.find((item) => item.id === id)!;
      if (!rolloutAllowed(id)) {
        host.errors[id] = '当前主机未命中功能灰度策略；请在系统设置中调整并重启 Sakura 服务';
        host.lifecycle[id] = { phase: 'skipped', activationMs: 0 };
        continue;
      }
      if (manifest.requires.some((dependency) => !host.enabled.has(dependency.id))) {
        host.errors[id] = '依赖插件启动失败';
        host.lifecycle[id] = { phase: 'skipped', activationMs: 0 };
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
        if (
          !isDeepStrictEqual(declaredOperations, implementedOperations) ||
          implementedOperations.some(
            (key) =>
              typeof module!.operations![key].execute !== 'function' ||
              typeof module!.operations![key].response?.parse !== 'function',
          )
        )
          throw new Error(`插件操作实现与声明不一致：${id}`);
        const scope = new PluginScope(`plugin:${id}`);
        host.scopes.set(id, scope);
        // Register before activation so partial construction is still owned after activation fails.
        const closedServices = new Set<unknown>();
        for (const key of manifest.services) scope.add(async () => {
          const service = host.serviceValue(key) as { close?: () => Promise<void> | void; jobs?: Jobs } | undefined;
          if (!service || closedServices.has(service)) return;
          if (service.close) await service.close();
          else if (service.jobs) await service.jobs.close();
          if (service.jobs?.list().some((job) => job.admission === 'cleanup-pending'))
            throw new AppError('插件任务仍有资源等待领域恢复', 503, 'PLUGIN_CLEANUP_PENDING');
          closedServices.add(service);
        });
        const context = pluginContext(host, manifest, PLUGINS, scope);
        host.contexts.set(id, context);
        if (module.deactivate) scope.add(() => module!.deactivate!(context));
        host.modules.set(id, module);
        started = true;
        await withinDeadline(scope.run(() => withResourceContext({ owner: `plugin:${id}`, pluginId: id },
          () => module!.activate(context))), manifest.lifecycle.activateMs, `${id} 激活`, () =>
          scope.abort(),
        );
        for (const key of manifest.services)
          if (host.serviceValue(key) === undefined) throw new Error(`插件未注册声明的服务：${id}.${key}`);
        host.modules.set(id, module);
        host.enabled.add(id);
        host.lifecycle[id] = { phase: 'active', activationMs: Math.round(performance.now() - startedAt) };
      } catch (error) {
        host.errors[id] = (error as Error).message;
        host.lifecycle[id] = { phase: 'failed', activationMs: Math.round(performance.now() - startedAt) };
        if (module && started) {
          try {
            await host.dispose(module);
          } catch (cleanup) {
            host.errors[id] += '；清理失败：' + (cleanup as Error).message;
          }
        }
      }
    }
    return host;
  }
  require(id: string) {
    if (!this.enabled.has(id))
      throw new AppError('请在插件中心启用插件「' + id + '」，并重启 Sakura 服务', 403);
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
  jobStores(): Jobs[] {
    const stores: Jobs[] = [...this.extraJobStores];
    for (const module of this.modules.values())
      for (const key of module.manifest.services) {
        const service = this.serviceValue(key) as { jobs?: Jobs } | undefined;
        const store = key === 'jobs' ? this.jobs : service?.jobs;
        if (store && !stores.includes(store)) stores.push(store);
      }
    return stores;
  }
  private async dispose(module: PluginModule) {
    const id = module.manifest.id;
    const scope = this.scopes.get(id);
    const closeMs = module.manifest.lifecycle.closeMs;
    this.enabled.delete(id);
    scope?.abort();
    try {
      await withinDeadline(scope?.dispose((disposer) =>
        withinDeadline(disposer(), closeMs, `${id} 资源关闭`)), closeMs, `${id} 资源清理`);
    } catch (error) {
      this.cleanupPending.add(id);
      scope?.cleanupPending(error);
      this.errors[id] = '插件清理未完成：' + (error as Error).message;
      throw error;
    }
    for (const key of module.manifest.services) this.services.delete(key);
    for (const [store, value] of this.pluginJobs) if (value.owner === id) this.pluginJobs.delete(store);
    this.contexts.delete(id);
    this.scopes.delete(id);
    this.modules.delete(id);
    this.cleanupPending.delete(id);
  }
  /** Stop new dispatch immediately. Providers remain until their dependents have unloaded. */
  async unload(id: string) {
    const module = this.modules.get(id);
    if (!module) return;
    const dependents = [...this.modules.values()].filter((item) => item.manifest.id !== id &&
      (this.enabled.has(item.manifest.id) || this.cleanupPending.has(item.manifest.id)) &&
      [...item.manifest.requires, ...item.manifest.optional].some((dependency) => dependency.id === id));
    if (dependents.length) throw new AppError('请先停用依赖此插件的插件：' +
      dependents.map((item) => item.manifest.id).join('、'), 409, 'PLUGIN_DEPENDENTS_ACTIVE');
    await this.dispose(module);
  }
  async close() {
    if (!this.closing) {
      this.closed = true;
      this.enabled.clear();
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
        if (errors.length) throw new AggregateError(errors, '插件关闭失败');
      })();
    }
    try { await this.closing; }
    catch (error) { this.closing = undefined; throw error; }
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
    const handler =
      owner === 'tasks' ? (await import('./plugins/tasks.ts')).route : this.modules.get(owner)!.route;
    const module = owner === 'tasks' ? undefined : this.modules.get(owner)!;
    const declaredOperation = module?.manifest.contributes.operations.find(
      (item) => item.method === req.method && matchesOperation(item.path, url.pathname),
    );
    const operation = declaredOperation && module?.operations?.[declaredOperation.id];
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const mutation = req.method !== 'GET' && req.method !== 'HEAD' && url.pathname !== '/api/migration';
    const targetVm = /^\/api\/vms\/([^/]+)/.exec(url.pathname)?.[1];
    if (mutation && targetVm && !url.pathname.endsWith('/next-features'))
      this.machines.requireUnlocked?.(targetVm);
    const releaseMutation = mutation ? this.operations.enter() : () => {};
    const scope = requestScope(req, res), abort = scope.controller;
    const pluginScope = this.scopes.get(owner);
    const revoke = () => abort.abort(pluginScope?.signal.reason);
    pluginScope?.signal.addEventListener('abort', revoke, { once: true });
    if (pluginScope?.signal.aborted) revoke();
    const pending = Promise.resolve()
      .then(() => {
        abort.signal.throwIfAborted();
        if (mutation && this.migration?.blocked && !url.pathname.endsWith('/cancel'))
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
            : handler.call(
                owner === 'tasks' ? (this as unknown as PluginContext) : this.contexts.get(owner)!,
                req,
                res,
                url,
                async (request, signal, limit) => {
                  const value = await body(request, signal || abort.signal, limit);
                  if (mutation && this.migration?.blocked && !url.pathname.endsWith('/cancel'))
                    throw new AppError('数据目录迁移维护中', 409);
                  return value;
                },
                abort.signal,
              );
        const vm = /^\/api\/vms\/([^/]+)\//.exec(url.pathname)?.[1];
        const dispatch = () => this.workspaces && vm && contribution.projectScoped && /^[0-9a-f-]{36}$/i.test(vm)
          ? this.workspaces.projects.with(vm, url.searchParams.get('project'), route)
          : route();
        return pluginScope ? pluginScope.run(() => withResourceContext({ owner: `plugin:${owner}`, pluginId: owner }, dispatch)) : dispatch();
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
