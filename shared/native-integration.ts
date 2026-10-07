/**
 * 模块职责（中文）：主机原生集成映射、配置、状态和交接记录的公共类型。
 * Module responsibility (English): Describing native path mappings, handoffs and configuration state.
 * 详细范围（中文）：公开入口包括 NativeMapping, NativeSettings, NativeView, NativeHandoff；职责覆盖描述原生路径映射、交接和配置状态，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include NativeMapping, NativeSettings, NativeView, NativeHandoff. The scope covers Describing native path mappings, handoffs and configuration state. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export type NativeMapping = {
  vmId: string;
  projectId: string;
  name: string;
  host: string;
  guest: string;
};
export type NativeSettings = {
  contextMenu: boolean;
  editor: 'notepad' | 'vscode';
  associations: { extension: string; vmId: string; projectId: string }[];
};
export type NativeView = {
  supported: boolean;
  version: number;
  settings: NativeSettings;
  pending: boolean;
  mappings: NativeMapping[];
};
export type NativeHandoff = {
  vmId: string;
  projectId: string;
  path: string;
  directory: boolean;
};
