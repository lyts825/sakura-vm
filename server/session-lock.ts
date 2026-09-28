import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import type { SessionLockView } from '../shared/session-lock.ts';

const password = z.string().max(256);
export const sessionLockConfiguration = z
  .object({
    enabled: z.boolean(),
    idleMinutes: z.number().int().min(1).max(240),
    password: password.default(''),
    newPassword: z.string().min(12).max(256).optional(),
  })
  .strict();
export const sessionUnlockRequest = z.object({ password }).strict();
const stored = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    idleMinutes: z.number().int().min(1).max(240),
    credential: z
      .object({ salt: z.string().regex(/^[a-f0-9]{64}$/), hash: z.string().regex(/^[a-f0-9]{128}$/) })
      .strict()
      .optional(),
    failures: z.number().int().min(0).max(5),
    blockedUntil: z.number().finite().nonnegative(),
  })
  .strict()
  .refine((value) => !value.enabled || !!value.credential);
type State = z.infer<typeof stored>;
const derive = (text: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      text,
      Buffer.from(salt, 'hex'),
      64,
      { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 ** 2 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
export class SessionLock {
  private state: State = { version: 1, enabled: false, idleMinutes: 15, failures: 0, blockedUntil: 0 };
  private locked = false;
  private reason?: SessionLockView['reason'];
  private lastActivity = 0;
  private generation = 0;
  private busy = false;
  private closed = false;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<unknown>;
  constructor(
    private changed: (locked: boolean, transitioned: boolean) => void = () => {},
    private file = join(DATA, 'session-lock.json'),
    private now = Date.now,
  ) {}
  async init(schedule = true) {
    try {
      this.state = stored.parse(await readStore(this.file, () => this.state));
    } catch {
      throw new AppError('会话锁配置读取失败，控制服务未开放；请检查本地配置或恢复备份。', 503);
    }
    this.lastActivity = this.now();
    if (this.state.enabled) {
      this.locked = true;
      this.reason = 'startup';
    }
    if (schedule) {
      this.timer = setInterval(() => this.checkIdle(), 1000);
      this.timer.unref();
    }
  }
  private checkIdle() {
    const now = this.now();
    if (
      this.state.enabled &&
      !this.locked &&
      (now < this.lastActivity || now - this.lastActivity >= this.state.idleMinutes * 60000)
    )
      this.setLocked('idle');
  }
  private setLocked(reason: NonNullable<SessionLockView['reason']>) {
    if (this.locked) {
      if (reason === 'manual') this.generation++;
      return;
    }
    this.locked = true;
    this.reason = reason;
    this.generation++;
    this.changed(true, true);
  }
  view(): SessionLockView {
    this.checkIdle();
    return {
      configured: !!this.state.credential,
      enabled: this.state.enabled,
      locked: this.locked,
      idleMinutes: this.state.idleMinutes,
      ...(this.state.enabled && !this.locked
        ? { expiresAt: this.lastActivity + this.state.idleMinutes * 60000 }
        : {}),
      reason: this.reason,
      retryAfterSeconds: Math.max(0, Math.ceil((this.state.blockedUntil - this.now()) / 1000)),
    };
  }
  getGeneration() { return this.generation; }
  requireUnlocked() {
    if (this.closed) throw new AppError('会话服务正在关闭', 503);
    this.checkIdle();
    if (this.locked) throw new AppError('控制面已锁定，请解锁后重新操作', 423, 'SESSION_LOCKED');
  }
  activity() {
    this.requireUnlocked();
    this.lastActivity = this.now();
    return this.view();
  }
  lock() {
    if (this.closed) throw new AppError('会话服务正在关闭', 503);
    if (!this.state.enabled) throw new AppError('请先启用会话自动锁定', 409);
    this.setLocked('manual');
    return this.view();
  }
  private exclusive<T>(work: () => Promise<T>) {
    if (this.closed) return Promise.reject(new AppError('会话服务正在关闭', 503));
    if (this.busy) return Promise.reject(new AppError('正在验证会话，请稍后再试', 429));
    this.busy = true;
    const pending = work().finally(() => {
      this.busy = false;
      this.pending = undefined;
    });
    this.pending = pending;
    return pending;
  }
  private async verify(text: string) {
    if (!this.state.credential) throw new AppError('尚未设置解锁密码', 409);
    if (this.now() < this.state.blockedUntil)
      throw new AppError('尝试过多，请在一分钟冷却结束后重试', 429, 'SESSION_RATE_LIMITED');
    const key = await derive(text, this.state.credential.salt);
    const valid = timingSafeEqual(key, Buffer.from(this.state.credential.hash, 'hex'));
    key.fill(0);
    if (!valid) {
      const failures =
        (this.state.blockedUntil && this.now() >= this.state.blockedUntil ? 0 : this.state.failures) + 1;
      const next = {
        ...this.state,
        failures: Math.min(5, failures),
        blockedUntil: failures >= 5 ? this.now() + 60000 : 0,
      };
      this.state = next;
      await writeStore(this.file, next);
      throw new AppError('解锁密码不正确', 403, 'SESSION_PASSWORD_INVALID');
    }
  }
  configure(input: unknown) {
    const value = sessionLockConfiguration.parse(input);
    return this.exclusive(async () => {
      this.requireUnlocked();
      const generation = this.generation;
      if (this.state.credential) await this.verify(value.password);
      let credential = this.state.credential;
      if (value.newPassword !== undefined) {
        const salt = randomBytes(32).toString('hex'),
          key = await derive(value.newPassword, salt);
        credential = { salt, hash: key.toString('hex') };
        key.fill(0);
      }
      if (value.enabled && !credential) throw new AppError('首次启用需要至少 12 个字符的解锁密码');
      this.requireUnlocked();
      if (generation !== this.generation) throw new AppError('会话状态已变化，请重新操作', 409);
      const next: State = {
        version: 1,
        enabled: value.enabled,
        idleMinutes: value.idleMinutes,
        credential,
        failures: 0,
        blockedUntil: 0,
      };
      await writeStore(this.file, next);
      this.state = next;
      // An idle/manual lock admitted during the durable write remains locked until a fresh proof.
      if (!this.locked) this.lastActivity = this.now();
      this.changed(this.locked, false);
      return this.view();
    });
  }
  unlock(input: unknown) {
    const value = sessionUnlockRequest.parse(input);
    return this.exclusive(async () => {
      const generation = this.generation;
      await this.verify(value.password);
      const next = { ...this.state, failures: 0, blockedUntil: 0 };
      await writeStore(this.file, next);
      this.state = next;
      if (this.closed || generation !== this.generation)
        throw new AppError('会话状态已变化，请重新解锁', 409);
      const transitioned = this.locked;
      this.locked = false;
      this.reason = undefined;
      this.lastActivity = this.now();
      if (transitioned) this.generation++;
      this.changed(false, transitioned);
      return this.view();
    });
  }
  unlockWithPasskey(expectedGeneration: number) {
    return this.exclusive(async () => {
      if (!this.state.enabled || !this.locked || this.generation !== expectedGeneration)
        throw new AppError('会话状态已变化，请重新解锁', 409);
      const next = { ...this.state, failures: 0, blockedUntil: 0 };
      await writeStore(this.file, next);
      this.state = next;
      if (this.closed || !this.locked || this.generation !== expectedGeneration)
        throw new AppError('会话状态已变化，请重新解锁', 409);
      this.locked = false;
      this.reason = undefined;
      this.lastActivity = this.now();
      this.generation++;
      this.changed(false, true);
      return this.view();
    });
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.pending?.catch(() => {});
  }
}
