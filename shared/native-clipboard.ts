/**
 * 模块职责：原生剪贴板应用、进程及桥接状态的公共类型，描述策略与安装/连接状态。
 */
import type { ClipboardRule } from './clipboard-policy.ts';

export type NativeClipboardApplication = {
  image: string;
  sha256: string;
  rule: ClipboardRule;
};
export type NativeClipboardSettings = { enabled: boolean; applications: NativeClipboardApplication[] };
export type NativeClipboardProcess = {
  pid: number;
  created: string;
  image: string;
  bits: 0 | 32 | 64;
};
export type NativeClipboardProcessState = NativeClipboardProcess & {
  inheritance?: {
    application: { image: string; sha256: string };
    parent: { pid: number; created: string };
  };
  state: 'enforced' | 'error' | 'disabled';
  error?: string;
  blockedCopy: number;
  blockedPaste: number;
};
export type NativeClipboardView = {
  version: number;
  supported: boolean;
  ready: boolean;
  settings: NativeClipboardSettings;
  available: NativeClipboardProcess[];
  processes: NativeClipboardProcessState[];
  lastScan?: string;
  error?: string;
};
