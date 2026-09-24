import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError, type VMConfig } from './model.ts';
import type { Machines } from './machines.ts';
import type { Files } from './files.ts';
import type { Images } from './images.ts';
import type { Bundles } from './bundles.ts';
import type { Workspaces } from './workspaces.ts';
import type { FolderSync } from './sync.ts';
import type { Jobs } from './jobs.ts';

import type { Downloads } from './downloads.ts';
import type { Backups } from './backups.ts';
import type { Maintenance } from './maintenance.ts';
import type { Ide } from './ide.ts';
import type { Recipes } from './recipes.ts';

import type { GitWorkbench } from './git-workbench.ts';
import type { ProjectFiles } from './project-files.ts';
import type { CommandPresets } from './command-presets.ts';
import type { Toolchains } from './toolchains.ts';
import type { NetworkProfiles } from './network-profiles.ts';
import type { Secrets } from './secrets.ts';
import type { ServiceHealth } from './service-health.ts';
import type { Containers } from './containers.ts';
import type { DataMigration } from './data-migration.ts';

import type { FileHistory } from './file-history.ts';
import type { Pipelines } from './pipelines.ts';
import type { RuntimeVersions } from './runtime-versions.ts';
import type { CodeIntelligence } from './code-intelligence.ts';
import type { FeatureSuite } from './feature-suite.ts';
import type { ExtendedFeatures } from './extended-features.ts';
import type { NextFeatures } from './next-features.ts';

import type { Desktops } from './desktop.ts';
import { PLUGINS, emptySelection, resolvePlugins } from '../shared/plugins.ts';
import { loaders, routeOwner, type PluginModule } from './plugins/registry.ts';

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
  pipelines!: Pipelines;
  runtimes!: RuntimeVersions;
  intelligence!: CodeIntelligence;
  suite!: FeatureSuite;
  extended!: ExtendedFeatures;
  next!: NextFeatures;

  desktops!: Desktops;
  readonly enabled = new Set<string>();
  readonly errors: Record<string, string> = {};
  private modules = new Map<string, PluginModule>();
  mutations = 0;
  importing = false;
  private closed = false;
  private closing?: Promise<void>;
  private active = new Map<AbortController, Promise<boolean>>();
  private constructor(public machines: Machines) {}
  static async create(machines: Machines, selected: string[] = []) {
    const host = new Features(machines);
    for (const id of resolvePlugins({ ...emptySelection(), plugins: selected })) {
      const manifest = PLUGINS.find((item) => item.id === id)!;
      if (manifest.requires.some((dependency) => !host.enabled.has(dependency))) {
        host.errors[id] = '依赖插件启动失败';
        continue;
      }
      let module: PluginModule | undefined;
      try {
        module = await loaders[id]();
        await module.activate(host);
        host.modules.set(id, module);
        host.enabled.add(id);
      } catch (error) {
        host.errors[id] = (error as Error).message;
        if (module) {
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
      for (const key of module.services) {
        const service = this[key] as unknown as { jobs?: Jobs };
        const store = key === 'jobs' ? this.jobs : service?.jobs;
        if (store && !stores.includes(store)) stores.push(store);
      }
    return stores;
  }
  private async dispose(module: PluginModule) {
    const errors: unknown[] = [];
    try {
      module.deactivate?.(this);
    } catch (error) {
      errors.push(error);
    }
    for (const key of [...module.services].reverse()) {
      const service = this[key] as unknown as { close?: () => Promise<void>; jobs?: Jobs } | undefined;
      try {
        if (service?.close) await service.close();
        else await service?.jobs?.close();
      } catch (error) {
        errors.push(error);
      } finally {
        delete (this as any)[key];
      }
    }
    if (errors.length) throw new AggregateError(errors, '插件清理失败');
  }
  async close() {
    if (!this.closing) {
      this.closed = true;
      for (const abort of this.active.keys()) abort.abort();
      this.closing = (async () => {
        await Promise.allSettled([...this.active.values()]);
        // Dispose dependents before their providers; always attempt all cleanup.
        const errors: unknown[] = [];
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
    const owner = routeOwner(url.pathname);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (!owner) return false;
    if (owner !== 'tasks') this.require(owner);
    const handler =
      owner === 'tasks' ? (await import('./plugins/tasks.ts')).route : this.modules.get(owner)!.route;
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const mutation = req.method !== 'GET' && req.method !== 'HEAD' && url.pathname !== '/api/migration';
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
        const route = () =>
          handler.call(
            this,
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
        const scoped = new Set([
          'git',
          'project-files',
          'commands',
          'tools',
          'network',
          'secrets',
          'health',
          'containers',
          'project',
          'project-runtime',
          'sync',
          'sync-preview',
          'history',
          'pipelines',
          'pipeline-artifact',
          'runtimes',
          'code-diagnostics',
          'advanced',
          'extended-features',
          'next-features',
          'projects',
        ]);
        return this.workspaces &&
          vm &&
          scoped.has(url.pathname.split('/').filter(Boolean)[3]) &&
          /^[0-9a-f-]{36}$/i.test(vm)
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
