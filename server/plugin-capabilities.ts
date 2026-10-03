import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import { ExecutionScope, type ExecutionOptions } from './execution-scope.ts';
import { withResourceContext } from './host-runtime/index.ts';
import { Jobs, type JobMeta } from './jobs.ts';
import type { Machines } from './machines.ts';
import { networkFor } from './network/index.ts';
import { pluginDataFile } from './plugin-data.ts';
import type { PluginScope } from './plugin-scope.ts';
import { storageRuntime, type StorageLease, type StorageRequest } from './storage-runtime.ts';

type PluginExecution = Pick<ExecutionOptions, 'vmId' | 'projectId' | 'configVersion'> & { signal?: AbortSignal };
type PluginStorage = Omit<StorageRequest, 'owner' | 'taskId'>;
type JobOptions = { persistent?: boolean; /** Existing first-party history name, during migration only. */ compatHistoryName?: string };

class PluginJobs extends Jobs {
  private keys = new Set<string>();
  constructor(name: string | undefined, private pluginId: string, private lifetime: PluginScope) {
    super(name);
    const cancel = () => { for (const key of this.keys) this.cancel(key, lifetime.signal.reason); };
    lifetime.signal.addEventListener('abort', cancel, { once: true });
    lifetime.add(async () => {
      await this.close();
      lifetime.signal.removeEventListener('abort', cancel);
    });
  }
  override start(key: string, work: Parameters<Jobs['start']>[1], meta: JobMeta = {}) {
    this.lifetime.signal.throwIfAborted();
    const view = withResourceContext({ owner: `plugin:${this.pluginId}`, pluginId: this.pluginId }, () =>
      super.start(key, work, { ...meta, owner: `plugin:${this.pluginId}` }));
    this.keys.add(key);
    // Observe completion outside Jobs' nesting context; this observer is not a dependent job.
    void Jobs.detached(() => this.wait(key)).then(() => this.keys.delete(key), () => this.keys.delete(key));
    return view;
  }
  override async close() {
    await super.close();
    if (this.list().some((job) => job.admission === 'cleanup-pending'))
      throw new AppError('插件任务仍有资源等待领域恢复', 503, 'PLUGIN_CLEANUP_PENDING');
  }
}

/** Cooperative ownership for trusted first-party plugins, not an OS security sandbox.
 * Work callbacks must await resource closure and pass the supplied signal to domain APIs. */
export function pluginCapabilities(pluginId: string, machines: Machines, scope: PluginScope) {
  const owner = `plugin:${pluginId}`;
  const identity = { owner, pluginId };
  const networking = withResourceContext(identity, () => networkFor(owner, 'plugin-network', scope.signal));
  scope.add(() => networking.close());
  const signalFor = (signal?: AbortSignal) => signal ? AbortSignal.any([scope.signal, signal]) : scope.signal;
  let stores = 0;
  return Object.freeze({
    networking,
    execution: Object.freeze({
      run<T>(options: PluginExecution, work: (execution: ExecutionScope) => Promise<T>): Promise<T> {
        return scope.run(() => withResourceContext(identity, () => ExecutionScope.run({ ...options,
          machines, owner, signal: signalFor(options.signal), delegate: true }, work)));
      },
    }),
    storage: Object.freeze({
      run<T>(request: PluginStorage, work: (lease: StorageLease, signal: AbortSignal) => Promise<T>): Promise<T> {
        const signal = signalFor(request.signal);
        return scope.run(() => withResourceContext(identity, () => storageRuntime.run({ ...request,
          owner, taskId: randomUUID(), signal }, (lease) => work(lease, signal))));
      },
    }),
    jobs: Object.freeze({
      create(name: string, options: JobOptions = {}): Jobs {
        scope.signal.throwIfAborted();
        pluginDataFile(pluginId, name); // Same bounded identifier rules as plugin metadata.
        if (options.compatHistoryName) pluginDataFile(pluginId, options.compatHistoryName);
        if (stores >= 16) throw new AppError('插件任务存储数量已达上限', 429, 'PLUGIN_QUEUE_FULL');
        const store = new PluginJobs(options.persistent === false ? undefined :
          options.compatHistoryName || `plugin-${pluginId}-${name}`, pluginId, scope);
        stores++;
        return store;
      },
    }),
    diagnostics: () => scope.diagnostics(),
    /** Only the owning domain may supply this callback, after retrying and confirming cleanup. */
    recoverCleanup: (id: string, recover: () => Promise<void>) => scope.recoverCleanup(id, recover),
  });
}

export type PluginCapabilities = ReturnType<typeof pluginCapabilities>;
