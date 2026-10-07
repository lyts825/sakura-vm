/**
 * 模块职责（中文）：主界面使用的系统和项目索引视图类型，集中描述控制面快照。
 * Module responsibility (English): controller system snapshots and project indexes.
 * 详细范围（中文）：公开入口包括 System, ProjectIndex；职责覆盖控制面系统快照与项目索引，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include System, ProjectIndex. The scope covers controller system snapshots and project indexes. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { SessionLockView } from '../session-lock.ts';

export type System = {
  session?: SessionLockView;
  plugins: string[];
  pluginRuntime?: { version: number; instances: import('./plugin-runtime.ts').PluginInstanceView[] };
  version: string;
  engine: string;
  posixloom: string;
  nativeHost: boolean;
  hostname: string;
  platform: string;
  hostCpus: number;
  hostMemoryMiB: number;
  freeMemoryMiB: number;
  controllerMemoryMiB: number;
  imageReady: boolean;
  imageBytes: number;
};
export type ProjectIndex = { active: string; projects: { id: string; name: string }[] };
