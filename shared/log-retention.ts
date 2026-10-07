/**
 * 模块职责（中文）：日志保留策略、占用汇总和清理预览的公共视图类型。
 * Module responsibility (English): Defining log policies, storage usage and cleanup-preview views.
 * 详细范围（中文）：公开入口包括 LogRetentionPolicy, LogRetentionSummary, LogRetentionPreview, LogRetentionView；职责覆盖定义日志策略、占用及清理预览视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include LogRetentionPolicy, LogRetentionSummary, LogRetentionPreview, LogRetentionView. The scope covers Defining log policies, storage usage and cleanup-preview views. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export type LogRetentionPolicy = { enabled: boolean; days: number; maxMiB: number };
export type LogRetentionSummary = {
  stores: number;
  completedLogs: number;
  completedBytes: number;
  protectedLogs: number;
  protectedBytes: number;
  removeLogs: number;
  removeBytes: number;
  expiredLogs: number;
  capacityLogs: number;
  remainingBytes: number;
};
export type LogRetentionPreview = LogRetentionSummary & { token: string };
export type LogRetentionView = {
  policy: LogRetentionPolicy;
  summary: LogRetentionSummary;
  lastRun?: { at: string; removedLogs: number; removedBytes: number };
  warning?: string;
};
