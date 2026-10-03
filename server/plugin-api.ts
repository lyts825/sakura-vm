import type { IncomingMessage, ServerResponse } from 'node:http';
import type { z } from 'zod';
import type { JobView } from '../shared/contracts/jobs.ts';
import type { PluginManifest } from '../shared/plugin-protocol.ts';
import type { Features } from './features.ts';
import type { Jobs } from './jobs.ts';
import { pluginDataFile } from './plugin-data.ts';
import type { PluginScope } from './plugin-scope.ts';

import { SERVICE_KEYS } from './plugin-services.ts';
import type { ServiceRef } from './service-ref.ts';
export { SERVICE_KEYS } from './plugin-services.ts';
export type ServiceKey = (typeof SERVICE_KEYS)[number];
type LegacyPluginContext = Pick<
  Features,
  ServiceKey | 'machines' | 'require' | 'jobStores' | 'retryHandler' | 'mutations' | 'importing'
>;
export type PluginContext = LegacyPluginContext & {
  readonly signal: AbortSignal;
  provide<T>(service: ServiceRef<T>, value: T): T;
  provide<T>(key: string, value: T): T;
  use<T>(service: ServiceRef<T>): T;
  use<T>(pluginId: string, key: string): T;
  optional<T>(service: ServiceRef<T>): T | undefined;
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
  body: (request: IncomingMessage, signal?: AbortSignal, limit?: number) => Promise<any>,
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
        return <T>(reference: string | ServiceRef<T>, value: T) => {
          const name = typeof reference === 'string' ? reference : reference.key;
          if (typeof reference !== 'string' && reference.pluginId !== manifest.id)
            throw new Error(`插件 ${manifest.id} 不能注册其他提供者的服务：${reference.pluginId}`);
          scope.signal.throwIfAborted();
          if (!owned.has(name)) throw new Error(`插件 ${manifest.id} 不能注册非自有服务：${name}`);
          target.provideService(name, value);
          return value;
        };
      if (key === 'use' || key === 'optional')
        return <T>(reference: string | ServiceRef<T>, legacyName?: string): T | undefined => {
          const id = typeof reference === 'string' ? reference : reference.pluginId;
          const name = typeof reference === 'string' ? legacyName! : reference.key;
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
