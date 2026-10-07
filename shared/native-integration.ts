/**
 * 模块职责：主机原生集成映射、配置、状态和交接记录的公共类型。
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
