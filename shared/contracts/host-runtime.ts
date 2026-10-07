/**
 * 模块职责：主机资源通道、身份与生命周期视图，供运行时诊断和控制面状态共享。
 */
/** Public diagnostics contain resource identities, never argv, payloads or credentials. */
export type ResourceLane = 'interactive' | 'background' | 'control';
export type ResourceIdentity = {
  operationId: string;
  owner: string;
  actorId?: string;
  pluginId?: string;
  pluginInstanceId?: string;
  pluginGeneration?: string;
  callerPluginInstanceId?: string;
  callerPluginGeneration?: string;
  vmId?: string;
  projectId?: string;
  jobId?: string;
  vmProcessId?: string;
  executionGeneration?: string;
  bootId?: string;
  networkGeneration?: string;
  traceId?: string;
  spanId?: string;
  recoveryId?: string;
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
  timings?: { queueMs: number; /** @deprecated Held-resource time before cleanup; use phaseTimings for task execution. */ executionMs: number; cleanupMs: number; lifetimeMs?: number };
};
export type HostRuntimeView = {
  state: 'accepting' | 'draining' | 'closed';
  budgets: { key: string; capacity: number; reserved: number; used: number }[];
  resources: ResourceView[];
  recent: ResourceView[];
  queued: number;
  totals: { admitted: number; rejected: number; cancelled: number; released: number };
  timings?: Record<'queue' | 'execution' | 'cleanup', { count: number; totalMs: number; maxMs: number }>;
};
