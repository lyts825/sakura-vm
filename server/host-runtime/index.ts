import { HostRuntime } from './governor.ts';

/** One governor per Sakura host process. Importing it starts no worker or timer. */
export const hostRuntime = new HostRuntime();
export { HostRuntime, HOST_BUDGETS } from './governor.ts';
export type { ResourceRequest, ResourceRegistration, ResourceLease, Budget } from './governor.ts';
export { captureResourceContext, resourceContext, withResourceContext } from './context.ts';
export type { HostRuntimeView, ResourceIdentity, ResourceLane, ResourceView } from '../../shared/contracts/host-runtime.ts';
