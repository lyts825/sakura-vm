/** Public diagnostics contain resource identities, never argv, payloads or credentials. */
export type ResourceLane = 'interactive' | 'background' | 'control';
export type ResourceIdentity = {
  operationId: string;
  owner: string;
  actorId?: string;
  pluginId?: string;
  vmId?: string;
  projectId?: string;
  jobId?: string;
  vmProcessId?: string;
  executionGeneration?: string;
  bootId?: string;
  networkGeneration?: string;
  traceId?: string;
  spanId?: string;
};
export type ResourceView = {
  id: string;
  owner: string;
  kind: string;
  label: string;
  lane: ResourceLane;
  state: 'queued' | 'active' | 'cleanup-pending' | 'released' | 'rejected';
  identity: ResourceIdentity;
  cost: Record<string, number>;
  createdAt: string;
  admittedAt?: string;
  finishedAt?: string;
  previousOwner?: string;
  error?: string;
};
export type HostRuntimeView = {
  state: 'accepting' | 'draining' | 'closed';
  budgets: { key: string; capacity: number; reserved: number; used: number }[];
  resources: ResourceView[];
  recent: ResourceView[];
  queued: number;
  totals: { admitted: number; rejected: number; cancelled: number; released: number };
};
