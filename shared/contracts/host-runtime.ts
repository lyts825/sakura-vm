/**
 * 模块职责（中文）：主机资源通道、身份与生命周期视图，供运行时诊断和控制面状态共享。
 * Module responsibility (English): resource identities, lanes and lifecycle views.
 * 详细范围（中文）：公开入口包括 ResourceLane, ResourceIdentity, ResourceView, HostRuntimeView；职责覆盖资源身份、通道和生命周期视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ResourceLane, ResourceIdentity, ResourceView, HostRuntimeView. The scope covers resource identities, lanes and lifecycle views. Types, validation branches and cleanup paths define its data/behavior boundaries
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
