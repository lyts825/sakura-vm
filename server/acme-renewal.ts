import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import type { Machines } from './machines.ts';

export const acmeInput = z.object({
  mode: z.enum(['status', 'save', 'renew', 'dry-run']).default('status'),
  enabled: z.boolean().optional(),
  intervalHours: z.number().int().min(1).max(168).optional(),
}).strict();
const policy = z.object({ vmId: z.uuid(), enabled: z.boolean(),
  intervalHours: z.number().int().min(1).max(168),
  updatedAt: z.iso.datetime(),
  nextAttemptAt: z.number().int().nonnegative(),
  lastAttemptAt: z.number().int().nonnegative().optional() }).strict();
const attempt = z.object({ vmId: z.uuid(), at: z.number().int().positive(),
  mode: z.enum(['manual', 'scheduled', 'dry-run']),
  status: z.enum(['success', 'failed']), exitCode: z.number().int().optional() }).strict();
const storeSchema = z.object({ version: z.literal(1),
  policies: z.array(policy).max(64), attempts: z.array(attempt).max(200) }).strict();
type Store = z.infer<typeof storeSchema>;
type Attempt = z.infer<typeof attempt>;
const defaults = (): Store => ({ version: 1, policies: [], attempts: [] });
const checkCommand = "command -v certbot >/dev/null && test -d /etc/letsencrypt/renewal && find /etc/letsencrypt/renewal -maxdepth 1 -type f -name '*.conf' -print -quit | grep -q .";

/** Renews existing guest Certbot lineages; certificate issuance remains Certbot's responsibility. */
export class AcmeRenewal {
  private state: Store = defaults();
  private writes = Promise.resolve();
  private active = new Map<string, { promise: Promise<unknown>; controller: AbortController }>();
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  private closed = false;
  private allowed = () => false;
  private mutation = (_delta: number) => {};

  constructor(private machines: Machines,
    private file = join(DATA, 'acme-renewal.json'), private now = Date.now) {}

  async init() {
    this.state = storeSchema.parse(await readStore(this.file, defaults));
    if (new Set(this.state.policies.map((item) => item.vmId)).size !== this.state.policies.length)
      throw new AppError('证书续期目录包含重复实例', 503);
    this.timer = setInterval(() => void this.tick().catch(() => {}), 60_000);
    this.timer.unref();
    queueMicrotask(() => void this.tick().catch(() => {}));
  }

  setAllowed(check: () => boolean) {
    this.allowed = check;
    this.kick();
  }
  setMutationCounter(change: (delta: number) => void) { this.mutation = change; }

  private kick() {
    queueMicrotask(() => {
      if (this.ticking) void this.ticking.catch(() => {}).finally(() => this.tick().catch(() => {}));
      else void this.tick().catch(() => {});
    });
  }

  private serial<T>(work: () => Promise<T>) {
    const task = this.writes.catch(() => {}).then(work);
    this.writes = task.then(() => {}, () => {});
    return task;
  }

  private change<T>(edit: (state: Store) => T) {
    return this.serial(async () => {
      const next = structuredClone(this.state);
      const result = edit(next);
      await writeStore(this.file, next);
      this.state = next;
      return result;
    });
  }

  view(id: string) {
    this.machines.get(id);
    return { policy: this.state.policies.find((item) => item.vmId === id) || null,
      attempts: this.state.attempts.filter((item) => item.vmId === id).slice(-20).reverse(),
      running: this.active.has(id) };
  }

  async save(id: string, input: unknown) {
    this.machines.get(id);
    if (this.closed) throw new AppError('证书续期服务正在关闭', 503);
    const value = acmeInput.parse(input);
    if (value.mode !== 'save' || value.enabled === undefined)
      throw new AppError('需要提供续期启用状态', 400);
    if (this.active.has(id)) throw new AppError('此实例正在执行证书续期，请稍后修改策略', 409);
    const intervalHours = value.intervalHours ??
      this.state.policies.find((item) => item.vmId === id)?.intervalHours ?? 12;
    await this.change((state) => {
      const current = state.policies.find((item) => item.vmId === id);
      const next = { vmId: id, enabled: value.enabled!, intervalHours,
        updatedAt: new Date(this.now()).toISOString(),
        nextAttemptAt: value.enabled
          ? current?.enabled
            ? Math.min(current.nextAttemptAt, this.now() + intervalHours * 3_600_000)
            : this.now() : 0,
        ...(current?.lastAttemptAt !== undefined ? { lastAttemptAt: current.lastAttemptAt } : {}) };
      if (!current && state.policies.length >= 64)
        throw new AppError('最多保留 64 个实例的续期策略', 409);
      state.policies = [...state.policies.filter((item) => item.vmId !== id), next];
    });
    if (value.enabled) this.kick();
    return { ...this.view(id), ready: true, executed: true };
  }

  async check(id: string, signal?: AbortSignal) {
    this.machines.get(id);
    if (this.machines.state(id) !== 'running')
      return { ...this.view(id), ready: false, executed: false,
        reason: '请先启动实例以检查 Certbot 续期配置。' };
    try {
      const result = await this.machines.exec(id, checkCommand, 15_000, signal);
      return { ...this.view(id), ready: result.code === 0, executed: false,
        ...(result.code !== 0 ? { reason: '客户机需要 Certbot 和已有的 /etc/letsencrypt/renewal/*.conf。' } : {}) };
    } catch (error) {
      signal?.throwIfAborted();
      return { ...this.view(id), ready: false, executed: false,
        reason: String((error as Error).message || error) };
    }
  }

  private async record(item: Attempt) {
    await this.change((state) => {
      state.attempts = [...state.attempts, item].slice(-200);
    });
  }

  private async perform(id: string, mode: Attempt['mode'], signal: AbortSignal) {
    if (!this.allowed()) throw new AppError('控制面锁定或数据迁移中，暂不续期', 409);
    this.machines.requireUnlocked(id);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
    const at = this.now();
    if (mode !== 'dry-run') await this.change((state) => {
      const current = state.policies.find((item) => item.vmId === id);
      if (current?.enabled) {
        current.lastAttemptAt = at;
        current.nextAttemptAt = at + current.intervalHours * 3_600_000;
      }
    });
    let code: number | undefined;
    try {
      const checked = await this.check(id, signal);
      if (!checked.ready) throw new AppError(checked.reason || 'Certbot 尚未就绪', 409);
      const command = 'certbot renew --non-interactive --quiet' +
        (mode === 'dry-run' ? ' --dry-run' : '');
      const result = await this.machines.exec(id, command, 15 * 60_000, signal);
      code = result.code;
      await this.record({ vmId: id, at, mode, status: code === 0 ? 'success' : 'failed',
        exitCode: code });
      return { ...this.view(id), ready: code === 0, executed: true, exitCode: code,
        // A zero exit code also means no certificate was due. Certbot decides which lineages renew.
        message: code === 0 ? 'Certbot 续期检查成功；请查看证书有效期确认是否实际更换。' :
          'Certbot 续期失败；请检查客户机中的 Certbot 日志与验证方式。',
        output: `${result.stdout}${result.stderr ? '\n' + result.stderr : ''}`.slice(0, 8000) };
    } catch (error) {
      if (code === undefined) await this.record({ vmId: id, at, mode, status: 'failed' });
      throw error;
    }
  }

  private execute(id: string, mode: Attempt['mode'], signal?: AbortSignal) {
    this.machines.get(id);
    if (this.closed) throw new AppError('证书续期服务正在关闭', 503);
    if (this.active.has(id)) throw new AppError('此实例正在执行证书续期', 409);
    if (!this.allowed()) throw new AppError('控制面锁定或数据迁移中，暂不续期', 409);
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    this.mutation(1);
    const promise = this.perform(id, mode, combined).finally(() => {
      this.active.delete(id);
      this.mutation(-1);
    });
    this.active.set(id, { promise, controller });
    return promise;
  }

  async run(id: string, input: unknown, action: 'check' | 'run', signal?: AbortSignal) {
    const value = acmeInput.parse(input);
    if (action === 'check' || value.mode === 'status') return this.check(id, signal);
    if (value.mode === 'save') return this.save(id, value);
    return this.execute(id, value.mode === 'dry-run' ? 'dry-run' : 'manual', signal);
  }

  tick() {
    if (this.closed || this.ticking) return this.ticking || Promise.resolve();
    const task = (async () => {
      if (!this.allowed()) return;
      if (this.state.policies.some((item) => !this.machines.records.has(item.vmId)))
        await this.change((state) => {
          state.policies = state.policies.filter((item) => this.machines.records.has(item.vmId));
        });
      const due = this.state.policies.filter((item) => item.enabled &&
        item.nextAttemptAt <= this.now() && !this.active.has(item.vmId));
      await Promise.allSettled(due.map(async (item) => {
        if (!this.machines.records.has(item.vmId) ||
            this.machines.state(item.vmId) !== 'running') return;
        await this.execute(item.vmId, 'scheduled');
      }));
    })().finally(() => { if (this.ticking === task) this.ticking = undefined; });
    this.ticking = task;
    return task;
  }

  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const item of this.active.values()) item.controller.abort();
    await this.ticking?.catch(() => {});
    await Promise.allSettled([...this.active.values()].map((item) => item.promise));
    await this.writes;
  }
}
