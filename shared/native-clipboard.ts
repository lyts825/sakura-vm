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
