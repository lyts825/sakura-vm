/**
 * 模块职责：日志保留策略、占用汇总和清理预览的公共视图类型。
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
