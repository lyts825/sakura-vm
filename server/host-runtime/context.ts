import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { ResourceIdentity } from '../../shared/contracts/host-runtime.ts';

const contexts = new AsyncLocalStorage<Readonly<ResourceIdentity>>();

export function resourceContext(): Readonly<ResourceIdentity> | undefined {
  return contexts.getStore();
}

/** Capture identity at the boundary, before queueing or crossing an IPC boundary. */
export function captureResourceContext(identity: Partial<ResourceIdentity> = {}): Readonly<ResourceIdentity> {
  const inherited = contexts.getStore();
  const result: ResourceIdentity = {
    ...inherited,
    owner: identity.owner ?? inherited?.owner ?? 'core:application',
    operationId: identity.operationId ?? inherited?.operationId ?? randomUUID(),
  };
  // Explicitly serialize identities only; accidental request payloads must never
  // flow into diagnostics or later IPC envelopes through an object spread.
  const keys: (keyof ResourceIdentity)[] = ['operationId', 'owner', 'actorId', 'pluginId', 'vmId',
    'projectId', 'jobId', 'vmProcessId', 'executionGeneration', 'bootId', 'networkGeneration', 'traceId', 'spanId'];
  for (const key of keys) {
    const value = identity[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.length || value.length > 200 || /[\x00-\x1f\x7f]/.test(value))
      throw new Error(`Invalid resource identity: ${key}`);
    result[key] = value;
  }
  return Object.freeze(result);
}

export function withResourceContext<T>(identity: Partial<ResourceIdentity>, work: () => T): T {
  return contexts.run(captureResourceContext(identity), work);
}
