/**
 * 模块职责：定义插件声明和受限上下文，检查依赖与服务读取权限后才提供能力。
 */
import type { JobsV1 } from './service-contracts/v1.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { z } from 'zod';
import type { JobView } from '../shared/contracts/jobs.ts';
import type { PluginManifest } from '../shared/plugin-protocol.ts';
import type { PluginRuntime } from './plugin-runtime.ts';

import type { PluginInstance } from './plugin-instance.ts';
import { pluginCapabilities, type PluginCapabilities } from './plugin-capabilities.ts';
import { SERVICE_KEYS, type PluginServices } from './plugin-services.ts';
import { serviceRef, type ServiceRef } from './service-ref.ts';
import type { HostServiceResolver } from './host-service-contracts.ts';
import { withPluginAuthority } from './plugin-authority.ts';

export { SERVICE_KEYS } from './plugin-services.ts';
export type ServiceKey = (typeof SERVICE_KEYS)[number];
export type PluginContext = Readonly<PluginServices> & {
  readonly capabilities: PluginCapabilities;
  readonly execution: PluginCapabilities['execution'];
  readonly storage: PluginCapabilities['storage'];
  readonly networking: PluginCapabilities['networking'];
  readonly signal: AbortSignal;
  readonly instance: Readonly<Pick<PluginInstance, 'identity' | 'generation' | 'version' | 'artifactDigest'>>;
  readonly vm: PluginCapabilities['vm'];
  readonly system: HostServiceResolver;
  readonly activity: {
    readonly mutations: number;
    readonly importing: boolean;
    exclusive<T>(name: string, work: () => Promise<T>): Promise<T>;
  };
  provide<T, Value extends T>(service: ServiceRef<T>, value: Value): Value;
  use<T>(service: ServiceRef<T>): T;
  optional<T>(service: ServiceRef<T>): T | undefined;
  require(id: string): void;
  onDispose(disposer: () => void | Promise<void>): void;
  registerJobs(store: JobsV1, retry: (job: JobView) => Promise<unknown> | unknown): void;
  jobViews(): readonly JobView[];
  jobSources(): ReadonlyArray<Pick<JobsV1, 'list' | 'flush'>>;
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
  /** Explicit implemented operation IDs. New declarations cannot inherit a generic route handler. */
  httpHandlers?: Record<string, PluginRoute>;
  operations?: Record<string, PluginOperation>;
};

/** A standalone context owns no global mutable slots. Service reads go through the broker. */
export function pluginContext(
  host: PluginRuntime,
  manifest: PluginManifest,
  catalog: readonly PluginManifest[],
  instance: PluginInstance,
): PluginContext {
  const scope = instance.scope;
  const capabilities = pluginCapabilities(manifest.id, host.machines, scope, instance);
  const dependencies = new Set([...manifest.requires, ...manifest.optional].map((item) => item.id));
  const readable = new Map(
    catalog
      .filter((item) => item.id === manifest.id || dependencies.has(item.id))
      .flatMap((item) => item.services.map((key) => [key, item.id] as const)),
  );
  const lookup = <T>(reference: ServiceRef<T>, optional = false) =>
    host.broker.lookup(instance, manifest, reference, optional);
  const context = {
    capabilities,
    execution: capabilities.execution,
    storage: capabilities.storage,
    networking: capabilities.networking,
    signal: instance.signal,
    instance: Object.freeze({
      identity: instance.identity,
      generation: instance.generation,
      version: instance.version,
      artifactDigest: instance.artifactDigest,
    }),
    vm: capabilities.vm,
    system: host.system.resolver(instance, manifest.systemDependencies),
    activity: Object.freeze({
      get mutations() {
        return host.operations.active;
      },
      get importing() {
        return host.importing;
      },
      exclusive<T>(name: string, work: () => Promise<T>) {
        instance.check(undefined, true);
        return host.exclusive(name, work);
      },
    }),
    provide<T, Value extends T>(reference: ServiceRef<T>, value: Value): Value {
      host.broker.register(instance, reference, value);
      host.provideService(reference.key, host.broker.unwrap(value));
      return value;
    },
    use<T>(reference: ServiceRef<T>): T {
      return lookup(reference) as T;
    },
    optional<T>(reference: ServiceRef<T>) {
      return lookup(reference, true);
    },
    require(id: string) {
      instance.check(undefined, true);
      if (id !== manifest.id && !dependencies.has(id)) throw new Error('插件未声明依赖：' + id);
      host.require(id);
    },
    onDispose: (disposer: () => void | Promise<void>) => {
      instance.check(undefined, true);
      scope.add(disposer);
    },
    registerJobs: (store: JobsV1, retry: (job: JobView) => Promise<unknown> | unknown) => {
      instance.check(undefined, true);
      host.registerPluginJobs(manifest.id, host.broker.unwrap(store) as JobsV1, retry);
    },
    jobViews: () => {
      instance.check('jobs', true);
      return structuredClone(host.jobStores().flatMap((store) => store.list()));
    },
    jobSources: () => {
      instance.check('jobs', true);
      const own = host.serviceValue('migration') as { jobs?: JobsV1 } | undefined;
      return Object.freeze(
        host
          .jobStores()
          .filter((store) => store !== own?.jobs)
          .map((store) =>
            Object.freeze({
              list: () => {
                instance.check('jobs');
                return structuredClone(store.list());
              },
              flush: () =>
                scope.run(() =>
                  withPluginAuthority(
                    instance,
                    () => store.flush(),
                    () => instance.check('metadata'),
                  ),
                ),
            }),
          ),
      );
    },
  };
  for (const key of SERVICE_KEYS)
    Object.defineProperty(context, key, {
      enumerable: true,
      get() {
        const owner = readable.get(key);
        if (!owner) throw new Error('插件未声明服务读取：' + key);
        return lookup(serviceRef(owner, key), true);
      },
    });
  // Service descriptors above complete the statically known interface without copying provider objects.
  return Object.freeze(context) as unknown as PluginContext;
}
