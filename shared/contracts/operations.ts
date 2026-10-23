/**
 * 模块职责（中文）：操作声明、准入策略与运行时诊断契约，集中约束身份、锁定、维护、审批和传输模式。
 * Module responsibility (English): explicit operation admission policies and runtime diagnostics.
 * 详细范围（中文）：公开入口包括 operationPolicySchema, OperationPolicy, operationDeclarationSchema, OperationDeclaration, OperationRole, scheduleDiagnosticSchema, hostRuntimeDiagnosticSchema, networkLimitsSchema, networkRuntimeDiagnosticSchema；职责覆盖显式操作准入策略和运行时诊断，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include operationPolicySchema, OperationPolicy, operationDeclarationSchema, OperationDeclaration, OperationRole, scheduleDiagnosticSchema, hostRuntimeDiagnosticSchema, networkLimitsSchema, networkRuntimeDiagnosticSchema. The scope covers explicit operation admission policies and runtime diagnostics. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { z } from 'zod';
import { socketContractSchema } from './websocket.ts';

/** Security and transport semantics are required input, never inferred from a URL or verb. */
// 声明需显式区分会话锁与实例锁、宿主身份与项目绑定；读取/写入准入不能仅从 HTTP 方法推断。
export const operationPolicySchema = z.object({
  access: z.enum(['controller', 'public', 'download-ticket', 'extension', 'guest', 'socket']),
  roles: z.array(z.enum(['owner', 'member', 'viewer'])),
  projectPermission: z.enum(['read', 'write', 'execute', 'approve']).optional(),
  projectScoped: z.boolean(), identity: z.enum(['host', 'fixed-vm', 'lifecycle']),
  maintenance: z.enum(['allow', 'block']), transport: z.enum(['json', 'binary', 'form', 'websocket']),
  mutating: z.boolean(),
  session: z.enum(['required', 'allow-locked']),
  vmLock: z.enum(['require-unlocked', 'allow-locked']),
  projectBinding: z.enum(['none', 'query', 'input-scope', 'legacy-terminal-grant']),
  approval: z.enum(['none', 'project-change']),
  extensionAuth: z.enum(['none', 'account', 'paired', 'preflight']),
  socketChannel: z.enum(['events', 'terminal', 'terminal-view', 'logs', 'desktop', 'desktop-view']).optional(),
  executionOwner: z.string().optional(),
  sessionOwner: z.string().optional(),
}).strict();
export type OperationPolicy = z.infer<typeof operationPolicySchema>;
export const operationDeclarationSchema = operationPolicySchema.extend({
  id: z.string(), owner: z.string(), method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'UPGRADE']),
  path: z.string(), contract: z.enum(['declared', 'partial']), enabled: z.boolean(),
  request: z.object({ kind: z.enum(['none', 'json', 'form', 'binary']), required: z.boolean(), media: z.string().optional(),
    // When this query key is present, the same route accepts no body (for example upload commit).
    bodylessQuery: z.string().min(1).optional() }).strict().optional(),
  socketContract: socketContractSchema.optional(),
}).strict();
export type OperationDeclaration = z.infer<typeof operationDeclarationSchema>;
export type OperationRole = OperationDeclaration['roles'][number];

const identity = z.object({ operationId: z.string(), owner: z.string(), actorId: z.string().optional(),
  pluginId: z.string().optional(), vmId: z.string().optional(), projectId: z.string().optional(),
  pluginInstanceId: z.string().optional(), pluginGeneration: z.string().optional(), recoveryId: z.string().optional(),
  callerPluginInstanceId: z.string().optional(), callerPluginGeneration: z.string().optional(),
  serviceConsumerPluginInstanceId: z.string().optional(),
  jobId: z.string().optional(), vmProcessId: z.string().optional(), executionGeneration: z.string().optional(),
  bootId: z.string().optional(), networkGeneration: z.string().optional(), traceId: z.string().optional(), spanId: z.string().optional() }).strict();
const resource = z.object({ id: z.string(), owner: z.string(), kind: z.string(), label: z.string(),
  lane: z.enum(['interactive', 'background', 'control']), state: z.enum(['queued', 'active', 'cleanup-pending', 'released', 'rejected']),
  identity, cost: z.record(z.string(), z.number()), createdAt: z.string(), admittedAt: z.string().optional(),
  finishedAt: z.string().optional(), previousOwner: z.string().optional(), error: z.string().optional(),
  timings: z.object({ queueMs: z.number(), executionMs: z.number(), cleanupMs: z.number(), lifetimeMs: z.number().optional() }).strict().optional() }).strict();
export const scheduleDiagnosticSchema = z.object({ id: z.string(), owner: z.string(), label: z.string(), intervalMs: z.number(),
  overlap: z.enum(['skip', 'coalesce']), catchUp: z.enum(['skip', 'once']),
  state: z.enum(['scheduled', 'queued', 'running', 'cancelling', 'backoff', 'cleanup-pending', 'closed']),
  nextAt: z.string().optional(), lastStartedAt: z.string().optional(), lastFinishedAt: z.string().optional(),
  lastDurationMs: z.number().optional(), lastError: z.string().optional(), timedOutAt: z.string().optional(),
  jobId: z.string().optional(), cleanupLeaseId: z.string().optional(), runs: z.number(), failures: z.number(), skipped: z.number(), coalesced: z.number(),
}).strict();
export const hostRuntimeDiagnosticSchema = z.object({ state: z.enum(['accepting', 'draining', 'closed']),
  diagnostics: z.object({ measuredForMs: z.number(), state: z.enum(['closed', 'measuring']),
    phaseTimings: z.object({ windowMs: z.number(), maxSamplesPerSeries: z.number(),
      series: z.array(z.object({ source: z.enum(['http', 'job', 'compute', 'resource']),
        phase: z.enum(['queue', 'execution', 'cleanup', 'response', 'audit', 'resource-lifetime']),
        samples: z.number(), totalMs: z.number(), maxMs: z.number(), p95Ms: z.number(), p99Ms: z.number() }).strict()),
    }).strict().optional(),
    eventLoop: z.object({ samples: z.number(), meanMs: z.number(), p99Ms: z.number(), maxMs: z.number(), utilization: z.number() }).strict() }).strict().optional(),
  budgets: z.array(z.object({ key: z.string(), capacity: z.number(), reserved: z.number(), used: z.number() }).strict()),
  resources: z.array(resource), recent: z.array(resource), queued: z.number(),
  totals: z.object({ admitted: z.number(), rejected: z.number(), cancelled: z.number(), released: z.number() }).strict(),
  timings: z.object({ queue: z.object({ count: z.number(), totalMs: z.number(), maxMs: z.number() }).strict(),
    execution: z.object({ count: z.number(), totalMs: z.number(), maxMs: z.number() }).strict(),
    cleanup: z.object({ count: z.number(), totalMs: z.number(), maxMs: z.number() }).strict() }).strict().optional(),
  schedules: z.array(scheduleDiagnosticSchema),
  metadata: z.object({ limits: z.object({ perFile: z.number(), pending: z.number(), files: z.number() }).strict(),
    pending: z.number(), files: z.array(z.object({ key: z.string(), pending: z.number(), unconfirmedWrite: z.boolean() }).strict()) }).strict() }).strict();
const worker = z.object({ pid: z.number().optional(), backendPid: z.number().optional(), resourceId: z.string(),
  backendResourceId: z.string().optional(), state: z.enum(['active', 'closing', 'cleanup-pending']),
  cleanupError: z.string().optional(), connections: z.number() }).strict();
const networkIdentitySchema = z.object({ owner: z.string(), purpose: z.string(), vmId: z.string().optional(), generation: z.string().optional(),
  projectId: z.string().optional(), scopeId: z.string().optional() }).strict();
export const networkLimitsSchema = z.object({ maxWorkers: z.number(), maxVmWorkers: z.number(), connectionsPerWorker: z.number(), scaleAt: z.number(),
  idleMs: z.number(), maxOwnerConnections: z.number(), maxListeners: z.number(), maxInboundConnections: z.number() }).strict();
export const networkRuntimeDiagnosticSchema = z.object({ state: z.enum(['running', 'draining', 'closed']),
  limits: networkLimitsSchema, maxChildProcesses: z.number(), hostWorkers: z.array(worker),
  vmWorkers: z.array(worker), vms: z.array(z.object({ vmId: z.string(), generation: z.string(),
    policy: z.object({ isolated: z.boolean(), ipv6: z.boolean(), forwards: z.array(z.object({ host: z.number(), guest: z.number() }).strict()) }).strict(),
    connected: z.boolean(), resources: z.object({ worker: z.string(), backend: z.string().optional() }).strict().optional() }).strict()),
  managementListeners: z.array(networkIdentitySchema.extend({ port: z.number() }).strict()),
  leases: z.array(networkIdentitySchema.extend({ id: z.string(), kind: z.enum(['dial', 'listen', 'lookup', 'vm', 'accept', 'native']),
    lane: z.enum(['data', 'management']), startedAt: z.string() }).strict()) }).strict();
