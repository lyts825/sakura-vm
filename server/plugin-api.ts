import type { IncomingMessage, ServerResponse } from 'node:http';
import type { z } from 'zod';
import type { JobView } from '../shared/contracts/jobs.ts';
import type { PluginManifest } from '../shared/plugin-protocol.ts';
import type { PluginRuntime } from './plugin-runtime.ts';
import type { Jobs } from './jobs.ts';
import type { Machines } from './machines.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { pluginDataFile } from './plugin-data.ts';
import { pluginCapabilities, type PluginCapabilities } from './plugin-capabilities.ts';
import { SERVICE_KEYS, type PluginServices } from './plugin-services.ts';
import { serviceRef, type ServiceRef } from './service-ref.ts';

export { SERVICE_KEYS } from './plugin-services.ts';
export type ServiceKey = (typeof SERVICE_KEYS)[number];
export type PluginContext = Readonly<PluginServices> & {
  readonly capabilities: PluginCapabilities;
  readonly execution: PluginCapabilities['execution'];
  readonly storage: PluginCapabilities['storage'];
  readonly networking: PluginCapabilities['networking'];
  readonly signal: AbortSignal;
  readonly instance: Readonly<Pick<PluginInstance, 'identity' | 'generation' | 'version' | 'artifactDigest'>>;
  readonly machines: Machines;
  readonly compat: { readonly machines: Machines; dataFile(name: string): string };
  readonly activity: {
    readonly mutations: number;
    readonly importing: boolean;
    exclusive<T>(name: string, work: () => Promise<T>): Promise<T>;
  };
  provide<T>(service: ServiceRef<T>, value: T): T;
  provide<T>(key: string, value: T): T;
  use<T>(service: ServiceRef<T>): T;
  use<T>(pluginId: string, key: string): T;
  optional<T>(service: ServiceRef<T>): T | undefined;
  optional<T>(pluginId: string, key: string): T | undefined;
  require(id: string): void;
  onDispose(disposer: () => void | Promise<void>): void;
  registerJobs(store: Jobs, retry: (job: JobView) => Promise<unknown> | unknown): void;
  jobStores(): Jobs[];
  retryHandler(store: Jobs): ((job: JobView) => Promise<unknown>) | undefined;
  dataFile(name: string): string;
};
export type PluginRoute = (
  this: PluginContext, req: IncomingMessage, res: ServerResponse, url: URL,
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

/** A standalone context owns no global mutable slots. Service reads go through the broker. */
export function pluginContext(host: PluginRuntime, manifest: PluginManifest,
  catalog: readonly PluginManifest[], instance: PluginInstance): PluginContext {
  const scope = instance.scope;
  const capabilities = pluginCapabilities(manifest.id, host.machines, scope, instance);
  const dependencies = new Set([...manifest.requires, ...manifest.optional].map(item => item.id));
  const readable = new Map(catalog.filter(item => item.id === manifest.id || dependencies.has(item.id))
    .flatMap(item => item.services.map(key => [key, item.id] as const)));
  const lookup = <T>(reference: string | ServiceRef<T>, key?: string, optional = false) =>
    host.broker.lookup(instance, manifest, typeof reference === 'string' ? serviceRef<T>(reference, key!) : reference, optional);
  const context = {
    capabilities, execution: capabilities.execution, storage: capabilities.storage, networking: capabilities.networking,
    signal: instance.signal,
    instance: Object.freeze({ identity: instance.identity, generation: instance.generation,
      version: instance.version, artifactDigest: instance.artifactDigest }),
    machines: host.machines,
    compat: Object.freeze({ machines: host.machines, dataFile: (name: string) => pluginDataFile(manifest.id, name) }),
    activity: Object.freeze({
      get mutations() { return host.operations.active; },
      get importing() { return host.importing; },
      exclusive<T>(name: string, work: () => Promise<T>) { instance.check(undefined, true); return host.exclusive(name, work); },
    }),
    provide<T>(reference: string | ServiceRef<T>, value: T) {
      host.broker.register(instance, reference, value);
      host.provideService(typeof reference === 'string' ? reference : reference.key, host.broker.unwrap(value));
      return value;
    },
    use<T>(reference: string | ServiceRef<T>, key?: string): T { return lookup(reference, key) as T; },
    optional<T>(reference: string | ServiceRef<T>, key?: string) { return lookup(reference, key, true); },
    require(id: string) {
      instance.check(undefined, true);
      if (id !== manifest.id && !dependencies.has(id)) throw new Error('插件未声明依赖：' + id);
      host.require(id);
    },
    onDispose: (disposer: () => void | Promise<void>) => { instance.check(undefined, true); scope.add(disposer); },
    registerJobs: (store: Jobs, retry: (job: JobView) => Promise<unknown> | unknown) => {
      instance.check(undefined, true); host.registerPluginJobs(manifest.id, host.broker.unwrap(store), retry);
    },
    jobStores: () => host.jobStores(),
    retryHandler: (store: Jobs) => host.retryHandler(store),
    dataFile: (name: string) => { instance.check('metadata', true); return pluginDataFile(manifest.id, name); },
  };
  for (const key of SERVICE_KEYS) Object.defineProperty(context, key, {
    enumerable: true,
    get() {
      const owner = readable.get(key);
      if (!owner) throw new Error('插件未声明服务读取：' + key);
      return lookup(serviceRef(owner, key), undefined, true);
    },
  });
  return Object.freeze(context) as PluginContext;
}
