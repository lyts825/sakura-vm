import type { JobsV1 } from './service-contracts/v1.ts';
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import { ExecutionScope, type ExecutionOptions } from './execution-scope.ts';
import { withResourceContext, resourceContext } from './host-runtime/index.ts';
import { Jobs, type JobMeta } from './jobs.ts';
import type { Machines } from './machines.ts';
import { networkFor } from './network/index.ts';
import { pluginDataFile } from './plugin-data.ts';
import type { PluginScope } from './plugin-scope.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { withPluginAuthority } from './plugin-authority.ts';
import { storageRuntime, type StorageLease, type StorageRequest } from './storage-runtime.ts';
import { vmAccess } from './vm-access.ts';
import { pluginMetadata } from './plugin-metadata.ts';
import { projectTerminalsFor } from './terminal-backend.ts';

type PluginExecution = Pick<ExecutionOptions, 'vmId' | 'projectId' | 'configVersion'> & {
  signal?: AbortSignal;
};
type PluginStorage = Omit<StorageRequest, 'owner' | 'taskId' | 'transfer'>;
export type PluginExecutionScope = Pick<
  ExecutionScope,
  'identity' | 'signal' | 'owner' | 'assert' | 'deferCleanup' | 'recovery' | 'hasPendingCleanup'
>;
export type PluginStorageLease = Omit<StorageLease, 'transfer'>;
type JobOptions = {
  persistent?: boolean;
  /** Preserves the domain's durable task history across upgrades. */ historyName?: string;
};

class PluginJobs extends Jobs {
  private keys = new Set<string>();
  constructor(
    name: string | undefined,
    private pluginId: string,
    private lifetime: PluginScope,
  ) {
    super(name);
    const cancel = () => {
      for (const key of this.keys) this.cancel(key, lifetime.signal.reason);
    };
    lifetime.signal.addEventListener('abort', cancel, { once: true });
    lifetime.add(async () => {
      await this.close();
      lifetime.signal.removeEventListener('abort', cancel);
    });
  }
  override start(key: string, work: Parameters<JobsV1['start']>[1], meta: JobMeta = {}) {
    this.lifetime.signal.throwIfAborted();
    const view = withResourceContext({ owner: `plugin:${this.pluginId}`, pluginId: this.pluginId }, () =>
      super.start(key, work, { ...meta, owner: `plugin:${this.pluginId}` }),
    );
    this.keys.add(key);
    // Observe completion outside Jobs' nesting context; this observer is not a dependent job.
    void Jobs.detached(() => this.wait(key)).then(
      () => this.keys.delete(key),
      () => this.keys.delete(key),
    );
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
export function pluginCapabilities(
  pluginId: string,
  machines: Machines,
  scope: PluginScope,
  instance?: PluginInstance,
) {
  const owner = `plugin:${pluginId}`;
  const identity = instance?.resourceIdentity || { owner, pluginId };
  const check = (permission?: string) => {
    scope.signal.throwIfAborted();
    instance?.check(permission, true);
  };
  const run = <T>(permission: string, work: () => T): T => {
    check(permission);
    return instance
      ? withPluginAuthority(instance, work, () => check(permission))
      : withResourceContext(identity, work);
  };
  const networking = run('network', () => networkFor(owner, 'plugin-network', scope.signal));
  scope.add(() => networking.close());
  const signalFor = (signal?: AbortSignal) =>
    signal ? AbortSignal.any([scope.signal, signal]) : scope.signal;
  let stores = 0;
  return Object.freeze({
    sessions: Object.freeze({ terminals: () => run('execution', () => projectTerminalsFor(machines)) }),
    networking,
    vm: vmAccess(machines, scope, instance, (vmId, signal, work) =>
      run('execution', () =>
        ExecutionScope.run(
          {
            machines,
            vmId,
            projectId: resourceContext()?.projectId || 'default',
            owner: ExecutionScope.current()?.owner || owner,
            signal,
            delegate: true,
          },
          work,
        ),
      ),
    ),
    metadata: pluginMetadata(pluginId, owner, scope, run),
    execution: Object.freeze({
      run<T>(options: PluginExecution, work: (execution: PluginExecutionScope) => Promise<T>): Promise<T> {
        return scope.run(() =>
          run('execution', () =>
            ExecutionScope.run(
              {
                ...options,
                machines,
                owner: ExecutionScope.current()?.owner || owner,
                signal: signalFor(options.signal),
                delegate: true,
              },
              (execution) =>
                work(
                  Object.freeze({
                    identity: execution.identity,
                    signal: execution.signal,
                    owner: execution.owner,
                    assert: () => execution.assert(),
                    deferCleanup: (cleanup: () => Promise<void>) => execution.deferCleanup(cleanup),
                    recovery: () => execution.recovery(),
                    hasPendingCleanup: () => execution.hasPendingCleanup(),
                  }),
                ),
            ),
          ),
        );
      },
    }),
    storage: Object.freeze({
      run<T>(
        request: PluginStorage,
        work: (lease: PluginStorageLease, signal: AbortSignal) => Promise<T>,
      ): Promise<T> {
        const signal = signalFor(request.signal);
        return scope.run(() =>
          run('storage', () =>
            storageRuntime.run(
              { ...request, transfer: undefined, owner, taskId: randomUUID(), signal },
              (lease) => {
                const { transfer: _transfer, ...publicLease } = lease;
                return work(Object.freeze(publicLease), signal);
              },
            ),
          ),
        );
      },
    }),
    jobs: Object.freeze({
      create(name: string, options: JobOptions = {}): JobsV1 {
        check('jobs');
        pluginDataFile(pluginId, name); // Same bounded identifier rules as plugin metadata.
        if (options.historyName) pluginDataFile(pluginId, options.historyName);
        if (stores >= 16) throw new AppError('插件任务存储数量已达上限', 429, 'PLUGIN_QUEUE_FULL');
        const store = run(
          'jobs',
          () =>
            new PluginJobs(
              options.persistent === false ? undefined : options.historyName || `plugin-${pluginId}-${name}`,
              pluginId,
              scope,
            ),
        );
        stores++;
        return store;
      },
    }),
    diagnostics: () => scope.diagnostics(),
  });
}

export type PluginCapabilities = ReturnType<typeof pluginCapabilities>;
