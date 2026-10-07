/**
 * 模块职责（中文）：控制面锁定状态的公共视图，描述启用、到期、锁定原因与解锁重试等待。
 * Module responsibility (English): Describing controller locks, expiry and unlock retry delays.
 * 详细范围（中文）：公开入口包括 SessionLockView；职责覆盖描述控制面锁定、到期和解锁等待，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include SessionLockView. The scope covers Describing controller locks, expiry and unlock retry delays. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export type SessionLockView = {
  configured: boolean;
  enabled: boolean;
  locked: boolean;
  idleMinutes: number;
  expiresAt?: number;
  reason?: 'idle' | 'manual' | 'startup';
  retryAfterSeconds: number;
};
