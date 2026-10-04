import { z } from 'zod';

/** Security and transport semantics are required input, never inferred from a URL or verb. */
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
}).strict();
export type OperationDeclaration = z.infer<typeof operationDeclarationSchema>;
export type OperationRole = OperationDeclaration['roles'][number];

const identity = z.object({ operationId: z.string(), owner: z.string(), actorId: z.string().optional(),
  pluginId: z.string().optional(), vmId: z.string().optional(), projectId: z.string().optional(),
  pluginInstanceId: z.string().optional(), pluginGeneration: z.string().optional(), recoveryId: z.string().optional(),
  callerPluginInstanceId: z.string().optional(), callerPluginGeneration: z.string().optional(),
  jobId: z.string().optional(), vmProcessId: z.string().optional(), executionGeneration: z.string().optional(),
  bootId: z.string().optional(), networkGeneration: z.string().optional(), traceId: z.string().optional(), spanId: z.string().optional() });
const resource = z.object({ id: z.string(), owner: z.string(), kind: z.string(), label: z.string(),
  lane: z.enum(['interactive', 'background', 'control']), state: z.enum(['queued', 'active', 'cleanup-pending', 'released', 'rejected']),
  identity, cost: z.record(z.string(), z.number()), createdAt: z.string(), admittedAt: z.string().optional(),
  finishedAt: z.string().optional(), previousOwner: z.string().optional(), error: z.string().optional(),
  timings: z.object({ queueMs: z.number(), executionMs: z.number(), cleanupMs: z.number() }).optional() });
export const hostRuntimeDiagnosticSchema = z.object({ state: z.enum(['accepting', 'draining', 'closed']),
  diagnostics: z.object({ measuredForMs: z.number(), state: z.enum(['closed', 'measuring']),
    eventLoop: z.object({ samples: z.number(), meanMs: z.number(), p99Ms: z.number(), maxMs: z.number(), utilization: z.number() }) }).optional(),
  budgets: z.array(z.object({ key: z.string(), capacity: z.number(), reserved: z.number(), used: z.number() })),
  resources: z.array(resource), recent: z.array(resource), queued: z.number(),
  totals: z.object({ admitted: z.number(), rejected: z.number(), cancelled: z.number(), released: z.number() }),
  timings: z.object({ queue: z.object({ count: z.number(), totalMs: z.number(), maxMs: z.number() }),
    execution: z.object({ count: z.number(), totalMs: z.number(), maxMs: z.number() }),
    cleanup: z.object({ count: z.number(), totalMs: z.number(), maxMs: z.number() }) }).optional(),
  schedules: z.array(z.record(z.string(), z.unknown())),
  metadata: z.object({ limits: z.object({ perFile: z.number(), pending: z.number(), files: z.number() }),
    pending: z.number(), files: z.array(z.object({ key: z.string(), pending: z.number(), unconfirmedWrite: z.boolean() })) }) });
const worker = z.object({ pid: z.number().optional(), backendPid: z.number().optional(), resourceId: z.string(),
  backendResourceId: z.string().optional(), state: z.enum(['active', 'closing', 'cleanup-pending']),
  cleanupError: z.string().optional(), connections: z.number() });
export const networkRuntimeDiagnosticSchema = z.object({ state: z.enum(['running', 'draining', 'closed']),
  limits: z.record(z.string(), z.unknown()), maxChildProcesses: z.number(), hostWorkers: z.array(worker),
  vmWorkers: z.array(worker), vms: z.array(z.record(z.string(), z.unknown())),
  managementListeners: z.array(z.record(z.string(), z.unknown())),
  leases: z.array(z.object({ id: z.string(), owner: z.string(), purpose: z.string(), kind: z.string(), lane: z.string(),
    startedAt: z.string(), vmId: z.string().optional(), projectId: z.string().optional(), generation: z.string().optional(), scopeId: z.string().optional() })) });
