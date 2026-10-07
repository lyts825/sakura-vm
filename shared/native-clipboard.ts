/**
 * 模块职责（中文）：原生剪贴板应用、进程及桥接状态的公共类型，描述策略与安装/连接状态。
 * Module responsibility (English): Describing native clipboard applications, proxy processes and policy state.
 * 详细范围（中文）：公开入口包括 NativeClipboardApplication, NativeClipboardSettings, NativeClipboardProcess, NativeClipboardProcessState, NativeClipboardView；职责覆盖描述原生剪贴板应用、代理进程与策略状态，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include NativeClipboardApplication, NativeClipboardSettings, NativeClipboardProcess, NativeClipboardProcessState, NativeClipboardView. The scope covers Describing native clipboard applications, proxy processes and policy state. Types, validation branches and cleanup paths define its data/behavior boundaries
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
