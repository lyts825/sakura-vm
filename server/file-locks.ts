import { randomUUID } from 'node:crypto';
import { AppError } from './model.ts';
import { mutablePath } from './files.ts';

type Lease = { path: string; token: string; expiresAt: number };
const overlaps = (left: string, right: string) =>
  left === right || left.startsWith(right + '/') || right.startsWith(left + '/');

/** Short-lived locks for mutations made through Sakura's file API. */
export class FileLocks {
  private leases = new Map<string, Lease[]>();
  private queues = new Map<string, Promise<void>>();
  constructor(private now = () => Date.now(), private durationMs = 120000) {}

  private current(id: string) {
    const active = (this.leases.get(id) || []).filter((lease) => lease.expiresAt > this.now());
    if (active.length) this.leases.set(id, active);
    else this.leases.delete(id);
    return active;
  }

  private async serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    const preceding = this.queues.get(id) || Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>((done) => { release = done; });
    const tail = preceding.then(() => pending);
    this.queues.set(id, tail);
    await preceding;
    try {
      return await action();
    } finally {
      release();
      if (this.queues.get(id) === tail) this.queues.delete(id);
    }
  }

  view(id: string, input: string) {
    const path = mutablePath(input);
    const lock = this.current(id).find((item) => overlaps(item.path, path));
    return { path, locked: !!lock, expiresAt: lock ? new Date(lock.expiresAt).toISOString() : null };
  }

  acquire(id: string, input: string) {
    const path = mutablePath(input);
    return this.serial(id, async () => {
      const active = this.current(id);
      if (active.some((item) => overlaps(item.path, path)))
        throw new AppError('文件或所在目录已被锁定', 409);
      if (active.length >= 128) throw new AppError('此实例的文件锁已达到 128 个上限', 409);
      const lease = { path, token: randomUUID(), expiresAt: this.now() + this.durationMs };
      this.leases.set(id, [...active, lease]);
      return { path, token: lease.token, expiresAt: new Date(lease.expiresAt).toISOString() };
    });
  }

  renew(id: string, input: string, token: string) {
    const path = mutablePath(input);
    return this.serial(id, async () => {
      const lease = this.current(id).find((item) => item.path === path && item.token === token);
      if (!lease) throw new AppError('文件锁已过期，请重新获取', 409);
      lease.expiresAt = this.now() + this.durationMs;
      return { path, expiresAt: new Date(lease.expiresAt).toISOString() };
    });
  }

  release(id: string, input: string, token: string) {
    const path = mutablePath(input);
    return this.serial(id, async () => {
      const leases = this.current(id);
      if (!leases.some((item) => item.path === path && item.token === token))
        throw new AppError('文件锁已过期或不属于此编辑器', 409);
      this.leases.set(id, leases.filter((item) => item.path !== path || item.token !== token));
      return { released: path };
    });
  }

  withMutation<T>(id: string, inputs: string[], token: string | undefined, action: () => Promise<T>) {
    const paths = inputs.map(mutablePath);
    return this.serial(id, async () => {
      const leases = this.current(id);
      if (token && !leases.some((item) => item.token === token && paths.some((path) => overlaps(item.path, path))))
        throw new AppError('文件锁已过期，请重新获取', 409);
      if (leases.some((item) => paths.some((path) => overlaps(item.path, path)) && item.token !== token))
        throw new AppError('文件或所在目录已被其他编辑器锁定', 409);
      return action();
    });
  }

  clear() {
    this.leases.clear();
  }
}
