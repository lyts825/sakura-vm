import type { IncomingMessage, ServerResponse } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import type { Bundles } from './bundles.ts';
import type { Files } from './files.ts';
import type { Images } from './images.ts';
import type { Jobs, JobView } from './jobs.ts';
import type { Machines } from './machines.ts';
import { AppError, type VMConfig } from './model.ts';
import type { FolderSync } from './sync.ts';
import type { Workspaces } from './workspaces.ts';

import type { Backups } from './backups.ts';
import type { Downloads } from './downloads.ts';
import type { Ide } from './ide.ts';
import type { Maintenance } from './maintenance.ts';
import type { Recipes } from './recipes.ts';

import type { CommandPresets } from './command-presets.ts';
import type { Containers } from './containers.ts';
import type { DataMigration } from './data-migration.ts';
import type { GitWorkbench } from './git-workbench.ts';
import type { NetworkProfiles } from './network-profiles.ts';
import type { ProjectFiles } from './project-files.ts';
import type { Secrets } from './secrets.ts';
import type { ServiceHealth } from './service-health.ts';
import type { Toolchains } from './toolchains.ts';

import type { CodeIntelligence } from './code-intelligence.ts';
import type { ExtendedFeatures } from './extended-features.ts';
import type { FeatureSuite } from './feature-suite.ts';
import type { FileHistory } from './file-history.ts';
import type { FileLocks } from './file-locks.ts';
import type { NextFeatures } from './next-features.ts';
import type { Pipelines } from './pipelines.ts';
import type { RuntimeVersions } from './runtime-versions.ts';

import { resolvePlugins } from '../shared/plugin-selection.ts';
import { emptySelection, PLUGINS } from '../shared/plugins.ts';
import type { Desktops } from './desktop.ts';
import type { Metrics } from './metrics.ts';
import { pluginContext, SERVICE_KEYS, type PluginContext } from './plugin-api.ts';
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
export class Features {
  files!: Files;
  images!: Images;
  bundles!: Bundles;
  downloads!: Downloads;
  workspaces!: Workspaces;
  sync!: FolderSync;
  jobs!: Jobs;
  backups!: Backups;
  maintenance!: Maintenance;
  ide!: Ide;
  recipes!: Recipes;
  git!: GitWorkbench;
  projectFiles!: ProjectFiles;
  commands!: CommandPresets;
  toolchains!: Toolchains;
  network!: NetworkProfiles;
  secrets!: Secrets;
  health!: ServiceHealth;
  containers!: Containers;
  migration!: DataMigration;
  history!: FileHistory;
  fileLocks!: FileLocks;
  pipelines!: Pipelines;
  runtimes!: RuntimeVersions;
  intelligence!: CodeIntelligence;
  suite!: FeatureSuite;
  extended!: ExtendedFeatures;
  next!: NextFeatures;

  desktops!: Desktops;
  metrics!: Metrics;
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
  mutations = 0;
  importing = false;
  private closed = false;
  private closing?: Promise<void>;
  private active = new Map<AbortController, Promise<boolean>>();
  private constructor(public machines: Machines) {}
  serviceValue(key: string): unknown {
    return this.services.has(key) ? this.services.get(key) : Reflect.get(this, key);
  }
  provideService(key: string, value: unknown) {
    if (this.serviceValue(key) !== undefined) throw new Error(`插件服务已注册：${key}`);
    if (SERVICE_KEYS.some((known) => known === key)) Reflect.set(this, key, value);
    else this.services.set(key, value);
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
  }
  retryHandler(store: Jobs) {
    return this.pluginJobs.get(store)?.retry;
  }
  static async create(machines: Machines, selected: string[] = []) {
    validateRegistry();
    const host = new Features(machines);
    for (const id of resolvePlugins({ ...emptySelection(), plugins: selected })) {
      const startedAt = performance.now();
      const manifest = PLUGINS.find((item) => item.id === id)!;
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
        const scope = new PluginScope();
        host.scopes.set(id, scope);
        const context = pluginContext(host, manifest, PLUGINS, scope);
        host.contexts.set(id, context);
        started = true;
        await withinDeadline(module.activate(context), manifest.lifecycle.activateMs, `${id} 激活`, () =>
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
    const stores: Jobs[] = [];
    for (const module of this.modules.values())
      for (const key of module.manifest.services) {
        const service = this.serviceValue(key) as { jobs?: Jobs } | undefined;
        const store = key === 'jobs' ? this.jobs : service?.jobs;
        if (store && !stores.includes(store)) stores.push(store);
      }
    return stores;
  }
  private async dispose(module: PluginModule) {
    const errors: unknown[] = [];
    const id = module.manifest.id;
    const scope = this.scopes.get(id);
    const closeMs = module.manifest.lifecycle.closeMs;
    scope?.abort();
    try {
      if (module.deactivate)
        await withinDeadline(module.deactivate(this.contexts.get(id)!), closeMs, `${id} 停用`);
    } catch (error) {
      errors.push(error);
    }
    try {
      await scope?.dispose((disposer) => withinDeadline(disposer(), closeMs, `${id} 资源清理`));
    } catch (error) {
      errors.push(error);
    }
    for (const key of [...module.manifest.services].reverse()) {
      const service = this.serviceValue(key) as { close?: () => Promise<void>; jobs?: Jobs } | undefined;
      try {
        if (service?.close) await withinDeadline(service.close(), closeMs, `${id}.${key} 关闭`);
        else if (service?.jobs) await withinDeadline(service.jobs.close(), closeMs, `${id}.${key} 任务关闭`);
      } catch (error) {
        errors.push(error);
      } finally {
        this.services.delete(key);
        delete (this as any)[key];
      }
    }
    for (const [store, value] of this.pluginJobs) if (value.owner === id) this.pluginJobs.delete(store);
    this.contexts.delete(id);
    this.scopes.delete(id);
    if (errors.length) throw new AggregateError(errors, '插件清理失败');
  }
  async close() {
    if (!this.closing) {
      this.closed = true;
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
            await this.dispose(module);
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length) throw new AggregateError(errors, '插件关闭失败');
      })();
    }
    await this.closing;
  }
  async route(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    body: (req: IncomingMessage, signal?: AbortSignal) => Promise<any>,
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
    if (mutation) this.mutations++;
    const abort = new AbortController();
    const disconnected = () => {
      if (!res.writableFinished) abort.abort();
    };
    req.once('aborted', disconnected);
    res.once('close', disconnected);
    if (req.aborted || res.destroyed) abort.abort();
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
                async (request) => {
                  const value = await body(request, abort.signal);
                  if (mutation && this.migration?.blocked && !url.pathname.endsWith('/cancel'))
                    throw new AppError('数据目录迁移维护中', 409);
                  return value;
                },
                abort.signal,
              );
        const vm = /^\/api\/vms\/([^/]+)\//.exec(url.pathname)?.[1];
        return this.workspaces && vm && contribution.projectScoped && /^[0-9a-f-]{36}$/i.test(vm)
          ? this.workspaces.projects.with(vm, url.searchParams.get('project'), route)
          : route();
      })
      .finally(() => {
        this.active.delete(abort);
        if (mutation) this.mutations--;
        req.off('aborted', disconnected);
        res.off('close', disconnected);
      });
    this.active.set(abort, pending);
    return pending;
  }
}
