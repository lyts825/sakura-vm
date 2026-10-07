/**
 * 模块职责：X11/Wayland 剪贴板应用与会话状态的公共视图，描述桥接安装、连接和应用策略。
 */
import type { ClipboardRule } from './clipboard-policy.ts';
import type { JobView } from './contracts/jobs.ts';

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
  desktopOwner?: { projectId: string; uid: number; runId: string };
  applicationOwner?: { uid: number; kind: 'project-desktop' | 'window-sandbox' };
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
