/**
 * 模块职责：控制面锁定状态的公共视图，描述启用、到期、锁定原因与解锁重试等待。
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
