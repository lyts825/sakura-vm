export type SessionLockView = {
  configured: boolean;
  enabled: boolean;
  locked: boolean;
  idleMinutes: number;
  expiresAt?: number;
  reason?: 'idle' | 'manual' | 'startup';
  retryAfterSeconds: number;
};
