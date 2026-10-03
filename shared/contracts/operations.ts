import { z } from 'zod';

export const operationDeclarationSchema = z.object({
  id: z.string(), owner: z.string(), method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'UPGRADE']),
  path: z.string(), access: z.enum(['controller', 'public', 'download-ticket', 'extension', 'guest', 'socket']),
  roles: z.array(z.enum(['owner', 'member', 'viewer'])),
  projectPermission: z.enum(['read', 'write', 'execute', 'approve']).optional(),
  projectScoped: z.boolean(), identity: z.enum(['host', 'fixed-vm', 'lifecycle']),
  maintenance: z.enum(['allow', 'block']), transport: z.enum(['json', 'binary', 'form', 'websocket']),
  contract: z.enum(['declared', 'partial']), enabled: z.boolean(),
}).strict();
export type OperationDeclaration = z.infer<typeof operationDeclarationSchema>;
export type OperationRole = OperationDeclaration['roles'][number];

const identity = z.object({ operationId: z.string(), owner: z.string(), actorId: z.string().optional(),
  pluginId: z.string().optional(), vmId: z.string().optional(), projectId: z.string().optional(),
  jobId: z.string().optional(), vmProcessId: z.string().optional(), executionGeneration: z.string().optional(),
  bootId: z.string().optional(), networkGeneration: z.string().optional(), traceId: z.string().optional(), spanId: z.string().optional() });
const resource = z.object({ id: z.string(), owner: z.string(), kind: z.string(), label: z.string(),
  lane: z.enum(['interactive', 'background', 'control']), state: z.enum(['queued', 'active', 'cleanup-pending', 'released', 'rejected']),
  identity, cost: z.record(z.string(), z.number()), createdAt: z.string(), admittedAt: z.string().optional(),
  finishedAt: z.string().optional(), previousOwner: z.string().optional(), error: z.string().optional() });
export const hostRuntimeDiagnosticSchema = z.object({ state: z.enum(['accepting', 'draining', 'closed']),
  budgets: z.array(z.object({ key: z.string(), capacity: z.number(), reserved: z.number(), used: z.number() })),
  resources: z.array(resource), recent: z.array(resource), queued: z.number(),
  totals: z.object({ admitted: z.number(), rejected: z.number(), cancelled: z.number(), released: z.number() }),
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
