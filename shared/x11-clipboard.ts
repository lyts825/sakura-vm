import type { ClipboardRule } from './clipboard-policy.ts';
import type { JobView } from '../server/jobs.ts';

export type X11ClipboardApplication = { image: string; sha256: string; rule: ClipboardRule };
export type X11ClipboardSession = {
  id: string;
  state: 'running' | 'stopped' | 'error';
  image?: string;
  sha256?: string;
  projectId?: string;
  directory?: string;
  startedAt?: string;
  compatible?: boolean;
  active?: boolean;
  generation?: number;
  rule?: ClipboardRule;
  blockedCopy?: number;
  blockedPaste?: number;
  error?: string;
  processes?: { pid: number; created: string; image: string; loaded: boolean }[];
};
export type X11ClipboardView = {
  version: number;
  applications: X11ClipboardApplication[];
  ready: boolean;
  build?: string;
  sessions: X11ClipboardSession[];
  error?: string;
  installation: JobView | null;
};
