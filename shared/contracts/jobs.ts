import type { SandboxExecution } from '../sandbox.ts';

export type JobMeta = {
  title?: string;
  vmId?: string;
  action?: string;
  projectId?: string;
  execution?: SandboxExecution;
  /** Stable resource owner; defaults to the Jobs scope. */
  owner?: string;
  lane?: 'interactive' | 'background' | 'control';
  admissionTimeoutMs?: number;
};
export type JobView = JobMeta & {
  id?: string;
  key?: string;
  scope?: string;
  status: 'running' | 'done' | 'error' | 'cancelled' | 'interrupted';
  /** Queued jobs remain status=running for existing consumers. */
  admission?: 'queued' | 'running' | 'cancelling' | 'cleanup-pending';
  queuedAt?: string;
  executionStartedAt?: string;
  resourceWait?: { resource: string; reason: string; since: string };
  resourceLeaseId?: string;
  cleanupLeaseId?: string;
  cleanupResolvedAt?: string;
  delegatedFrom?: string;
  log: string;
  error?: string;
  errorCode?: string;
  startedAt: string;
  finishedAt?: string;
  phase?: string;
  progress?: number;
  result?: { bytes: number; sha256: string };
  logPruned?: { at: string; bytes: number };
};
export type JobUpdate = (phase: string, progress?: number) => void;
