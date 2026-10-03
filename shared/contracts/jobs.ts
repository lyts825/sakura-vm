import type { SandboxExecution } from '../sandbox.ts';

export type JobMeta = {
  title?: string;
  vmId?: string;
  action?: string;
  projectId?: string;
  execution?: SandboxExecution;
};
export type JobView = JobMeta & {
  id?: string;
  key?: string;
  scope?: string;
  status: 'running' | 'done' | 'error' | 'cancelled' | 'interrupted';
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
