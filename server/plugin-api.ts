import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Features } from './features.ts';
import type { PluginManifest } from '../shared/plugin-protocol.ts';
import type { Jobs, JobView } from './jobs.ts';
import type { PluginScope } from './plugin-scope.ts';
import type { z } from 'zod';
import { pluginDataFile } from './plugin-data.ts';

// Only service slots belong here. Host lifecycle methods can never be owned by a plugin.
export const SERVICE_KEYS = [
  'files',
  'fileLocks',
  'images',
  'bundles',
  'downloads',
  'workspaces',
  'sync',
  'jobs',
  'backups',
  'maintenance',
  'ide',
  'recipes',
  'git',
  'projectFiles',
  'commands',
  'toolchains',
  'network',
  'secrets',
  'health',
  'containers',
  'migration',
  'history',
  'pipelines',
  'runtimes',
  'intelligence',
  'suite',
  'extended',
  'next',
  'desktops',
  'metrics',
] as const satisfies readonly (keyof Features)[];
export type ServiceKey = (typeof SERVICE_KEYS)[number];
type LegacyPluginContext = Pick<
  Features,
  ServiceKey | 'machines' | 'require' | 'jobStores' | 'retryHandler' | 'mutations' | 'importing'
>;
export type PluginContext = LegacyPluginContext & {
  readonly signal: AbortSignal;
  provide<T>(key: string, value: T): T;
  use<T>(pluginId: string, key: string): T;
  optional<T>(pluginId: string, key: string): T | undefined;
  onDispose(disposer: () => void | Promise<void>): void;
  registerJobs(store: Jobs, retry: (job: JobView) => Promise<unknown> | unknown): void;
  dataFile(name: string): string;
};
export type PluginRoute = (
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: (request: IncomingMessage) => Promise<any>,
  signal: AbortSignal,
) => Promise<boolean>;
export type PluginOperation = {
  request?: z.ZodType;
  response: z.ZodType;
  execute(this: PluginContext, url: URL, input: unknown, signal: AbortSignal): Promise<unknown> | unknown;
};
export type PluginModule = {
  manifest: PluginManifest;
  activate(context: PluginContext): Promise<void>;
  deactivate?(context: PluginContext): void | Promise<void>;
  route: PluginRoute;
  operations?: Record<string, PluginOperation>;
};

/** Enforce declared service ownership and direct dependencies, not a security sandbox. */
export function pluginContext(
  host: Features,
  manifest: PluginManifest,
  catalog: PluginManifest[],
  scope: PluginScope,
): PluginContext {
  const owned = new Set(manifest.services);
  const dependencies = new Set([...manifest.requires, ...manifest.optional].map((item) => item.id));
  const readable = new Set(
    catalog
      .filter((item) => item.id === manifest.id || dependencies.has(item.id))
      .flatMap((item) => item.services),
  );
  return new Proxy(host, {
    get(target, key) {
      if (key === 'signal') return scope.signal;
      if (key === 'provide')
        return <T>(name: string, value: T) => {
          scope.signal.throwIfAborted();
          if (!owned.has(name)) throw new Error(`插件 ${manifest.id} 不能注册非自有服务：${name}`);
          target.provideService(name, value);
          return value;
        };
      if (key === 'use' || key === 'optional')
        return <T>(id: string, name: string): T | undefined => {
          if (id !== manifest.id && !dependencies.has(id))
            throw new Error(`插件 ${manifest.id} 未声明依赖 ${id}`);
          if (!catalog.some((item) => item.id === id && item.services.includes(name)))
            throw new Error(`插件 ${id} 未声明服务：${name}`);
          if (key === 'use' && id !== manifest.id) target.require(id);
          return target.serviceValue(name) as T | undefined;
        };
      if (key === 'onDispose') return (disposer: () => void | Promise<void>) => scope.add(disposer);
      if (key === 'registerJobs')
        return (store: Jobs, retry: (job: JobView) => Promise<unknown> | unknown) => {
          scope.signal.throwIfAborted();
          target.registerPluginJobs(manifest.id, store, retry);
        };
      if (key === 'dataFile') return (name: string) => pluginDataFile(manifest.id, name);
      if (key === 'machines' || key === 'mutations' || key === 'importing') return target[key];
      if (key === 'jobStores') return target.jobStores.bind(target);
      if (key === 'require')
        return (id: string) => {
          if (id !== manifest.id && !dependencies.has(id))
            throw new Error(`插件 ${manifest.id} 未声明依赖 ${id}`);
          target.require(id);
        };
      if (typeof key === 'string' && readable.has(key)) return target.serviceValue(key);
      throw new Error(`插件 ${manifest.id} 未声明服务读取：${String(key)}`);
    },
    set(target, key, value) {
      if (key === 'mutations' || key === 'importing') return Reflect.set(target, key, value);
      scope.signal.throwIfAborted();
      if (typeof key !== 'string' || !owned.has(key))
        throw new Error(`插件 ${manifest.id} 不能写入非自有服务：${String(key)}`);
      if (target.serviceValue(key) !== undefined) throw new Error(`插件服务已注册：${String(key)}`);
      return Reflect.set(target, key, value);
    },
    deleteProperty() {
      throw new Error('插件服务由宿主统一释放');
    },
    defineProperty() {
      throw new Error('插件服务必须通过声明的槽位注册');
    },
  }) as unknown as PluginContext;
}
