import { hostRuntime, type ResourceLease } from './host-runtime/index.ts';

export const ClosePhase = {
  admission: 0, clients: 50, services: 200, plugins: 380,
  machines: 390, audit: 400, transport: 900, engine: 1000,
} as const;
type Registry = Pick<typeof hostRuntime, 'register'>;
type ScopeOptions = { owner?: string; registry?: Registry; signal?: AbortSignal };
type Resource = { name: string; order: number; sequence: number; requires: readonly string[];
  dispose: () => unknown; lease: ResourceLease };

/** Own resources as soon as they exist, including before asynchronous init. */
export class ResourceScope {
  private resources: Resource[] = [];
  private sequence = 0;
  private closing?: Promise<void>;
  private settled = false;
  private readonly controller = new AbortController();
  private readonly registry: Registry;
  private readonly owner: string;
  private readonly detach: () => void;
  readonly signal = this.controller.signal;
  constructor(options: ScopeOptions = {}) {
    this.owner = options.owner ?? 'core:scope';
    this.registry = options.registry ?? hostRuntime;
    const abort = () => this.controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    this.detach = () => options.signal?.removeEventListener('abort', abort);
    if (options.signal?.aborted) abort();
  }
  defer(name: string, dispose: () => unknown, order = 0, requires: readonly string[] = []) {
    if (this.closing || this.signal.aborted) throw new Error('Resource scope is closing');
    const lease = this.registry.register({ owner: this.owner, kind: 'lifecycle', label: name });
    const resource = { name, dispose, order, requires: [...requires], sequence: this.sequence++, lease };
    this.resources.push(resource);
    return () => {
      // Ownership can be handed to another scope only before disposal starts.
      if (!this.closing && this.resources.includes(resource)) {
        this.resources = this.resources.filter((item) => item !== resource);
        lease.release();
      }
    };
  }
  own<T extends { close(): unknown }>(name: string, value: T, order = 0): T {
    this.defer(name, () => value.close(), order);
    return value;
  }
  child(name: string, order = 0, owner = this.owner) {
    if (this.closing || this.signal.aborted) throw new Error('Resource scope is closing');
    const child = new ResourceScope({ owner, registry: this.registry, signal: this.signal });
    this.defer(name, () => child.retryCleanup(), order);
    return child;
  }
  /** Explicit retry preserves failed owners and never repeats successful disposers. */
  retryCleanup(): Promise<void> {
    if (!this.settled || !this.resources.length) return this.close();
    this.closing = undefined;
    this.settled = false;
    return this.close();
  }
  close(): Promise<void> {
    if (!this.closing) {
      const resources = this.resources.splice(0).sort((a, b) => a.order - b.order || b.sequence - a.sequence);
      // Assign the promise before disposal so concurrent close calls are idempotent.
      this.closing = Promise.resolve().then(async () => {
        this.controller.abort();
        const failures: Error[] = [];
        const remaining = new Set(resources), failed = new Set<Resource>();
        while (remaining.size) {
          const resource = [...remaining].find(candidate => !failed.has(candidate) &&
            ![...remaining].some(consumer => consumer.requires.includes(candidate.name)));
          if (!resource) break;
          try {
            resource.lease.beginCleanup?.();
            await resource.dispose();
            resource.lease.release();
            remaining.delete(resource);
          } catch (cause) {
            resource.lease.cleanupPending(cause);
            failed.add(resource);
            failures.push(new Error(`Resource cleanup failed: ${resource.name}`, { cause }));
          }
        }
        for (const resource of remaining) {
          if (!failed.has(resource)) {
            const cause = new Error(`Resource retained for dependent cleanup: ${resource.name}`);
            resource.lease.cleanupPending(cause);
          }
          this.resources.push(resource);
        }
        if (remaining.size && !failures.length)
          failures.push(new Error('Resource cleanup dependencies form a cycle: ' +
            [...remaining].map(resource => resource.name).join(', ')));
        this.detach();
        this.settled = true;
        if (failures.length) throw new AggregateError(failures, 'Application cleanup failed');
      });
    }
    return this.closing;
  }
}
