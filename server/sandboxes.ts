import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { AppError, createSchema, type VMView } from './model.ts';
import { Machines, BOOT_TIMEOUT_MS } from './machines.ts';
import { Jobs, type JobView } from './jobs.ts';
import { quote } from './files.ts';
import { sandboxExpired, sandboxPolicySchema, type SandboxPolicy } from '../shared/sandbox.ts';

export const sandboxCreateSchema = z
  .object({
    name: createSchema.shape.name,
    distro: createSchema.shape.distro,
    accelerator: createSchema.shape.accelerator,
    memoryMiB: z.number().int().min(256).max(4096).default(512),
    cpus: z.number().int().min(1).max(4).default(1),
    diskGiB: z.number().int().min(2).max(32).default(4),
    lifetimeMinutes: z.number().int().min(5).max(1440).default(60),
    network: sandboxPolicySchema.shape.network.default('isolated'),
    onExpire: sandboxPolicySchema.shape.onExpire.default('delete'),
  })
  .strict();

export const sandboxRunSchema = z
  .object({
    command: z
      .string()
      .trim()
      .min(1)
      .max(8192)
      .refine((s) => !s.includes('\0'), '命令不能包含空字符'),
    cwd: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^\/[^\x00-\x1f]*$/, '需要 Linux 绝对路径')
      .default('/workspace'),
    timeoutSeconds: z.number().int().min(1).max(3600).default(60),
  })
  .strict();

export type SandboxView = VMView & { sandbox: SandboxPolicy; expired: boolean };
export type SandboxOverview = { sandboxes: SandboxView[]; runs: JobView[]; persistenceError?: string };

export class Sandboxes {
  readonly jobs: Jobs;
  private busy = new Set<string>();
  private closed = false;

  constructor(
    private machines: Machines,
    jobs = new Jobs('sandbox'),
  ) {
    this.jobs = jobs;
  }
  private get(id: string) {
    const vm = this.machines.get(id);
    if (!vm.sandbox) throw new AppError('该实例不是沙箱', 409, 'NOT_A_SANDBOX');
    return vm as typeof vm & { sandbox: SandboxPolicy };
  }
  private available(id: string) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const vm = this.get(id);
    if (sandboxExpired(vm.sandbox)) throw new AppError('沙箱已到期', 409, 'SANDBOX_EXPIRED');
    return vm;
  }
  async view(id: string): Promise<SandboxView> {
    const vm = this.get(id);
    return { ...(await this.machines.view(id)), sandbox: vm.sandbox, expired: sandboxExpired(vm.sandbox) };
  }
  async list(): Promise<SandboxOverview> {
    return {
      sandboxes: (await this.machines.list())
        .filter((vm) => vm.sandbox)
        .map((vm) => ({ ...vm, sandbox: vm.sandbox!, expired: sandboxExpired(vm.sandbox!) })),
      runs: this.jobs.list(),
      persistenceError: this.jobs.persistenceError,
    };
  }
  async create(input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const { network, lifetimeMinutes, onExpire, ...config } = sandboxCreateSchema.parse(input);
    const vm = await this.machines.create(
      { ...config, template: 'none', forwards: [] },
      {
        network,
        onExpire,
        expiresAt: new Date(Date.now() + lifetimeMinutes * 60_000).toISOString(),
      },
    );
    return this.view(vm.id);
  }
  async control(id: string, action: 'start' | 'stop' | 'destroy') {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    this.get(id);
    if (this.busy.has(id)) throw new AppError('另一项沙箱操作正在进行', 409);
    this.busy.add(id);
    try {
      if (action === 'start') {
        this.available(id);
        if (this.jobs.view(id)?.status === 'running') throw new AppError('沙箱任务正在执行', 409);
        await this.machines.start(id);
      } else {
        this.jobs.cancel(id);
        await this.jobs.wait(id);
        if (this.machines.records.has(id)) {
          await this.machines.terminateSandbox(id);
          if (action === 'destroy' && this.machines.records.has(id)) await this.machines.delete(id);
        }
      }
      return { ok: true as const };
    } finally {
      this.busy.delete(id);
    }
  }
  run(id: string, input: unknown) {
    const vm = this.available(id);
    const config = sandboxRunSchema.parse(input);
    if (this.busy.has(id)) throw new AppError('另一项沙箱操作正在进行', 409);
    if (['paused', 'stopping'].includes(this.machines.state(id)))
      throw new AppError('请先停止沙箱后再执行命令', 409);
    return this.jobs.start(
      id,
      async (log, signal, update) => {
        let runtime: ReturnType<Machines['live']['get']>;
        try {
          signal.throwIfAborted();
          this.available(id);
          log('工作目录：' + config.cwd + '\n命令：' + config.command + '\n');
          update('启动沙箱');
          await this.machines.start(id);
          runtime = this.machines.live.get(id);
          const bootDeadline = Date.now() + BOOT_TIMEOUT_MS;
          while (this.machines.state(id) !== 'running') {
            signal.throwIfAborted();
            this.available(id);
            const state = this.machines.state(id);
            if (state !== 'starting' || Date.now() >= bootDeadline)
              throw new AppError(this.machines.get(id).lastError || '沙箱启动失败，请查看实例启动日志', 409);
            await delay(100, undefined, { signal });
          }
          this.available(id);
          signal.throwIfAborted();
          update('执行命令');
          const remaining = Date.parse(vm.sandbox.expiresAt) - Date.now();
          const timeoutMs = Math.max(1, Math.min(config.timeoutSeconds * 1000, remaining));
          const timeout = new AbortController();
          const timer = setTimeout(() => timeout.abort(), timeoutMs);
          const combined = AbortSignal.any([signal, timeout.signal]);
          try {
            // All script text is passed to the guest shell. Never evaluate it on the host.
            const result = await this.machines.exec(
              id,
              'cd ' + quote(config.cwd) + ' && exec sh -c ' + quote(config.command),
              timeoutMs,
              combined,
              log,
            );
            log('\n退出码：' + result.code + '\n');
            // Flush completed file writes before powering off, within the same host deadline.
            const synced = await this.machines.exec(id, 'sync', Math.min(3000, timeoutMs), combined);
            if (synced.code !== 0) throw new AppError('沙箱磁盘同步失败');
            if (result.code !== 0) throw new AppError('命令执行失败，退出码 ' + result.code);
            update('关闭沙箱');
          } catch (error) {
            if (timeout.signal.aborted && !signal.aborted)
              throw new AppError('沙箱命令执行超时，已终止虚拟机', 408);
            throw error;
          } finally {
            clearTimeout(timer);
          }
        } catch (error) {
          if (!signal.aborted && sandboxExpired(vm.sandbox))
            throw new AppError('沙箱已到期，虚拟机已终止', 409, 'SANDBOX_EXPIRED');
          throw error;
        } finally {
          // Stopping the entire VM also terminates detached or re-parented guest processes.
          if (runtime && this.machines.live.get(id) === runtime) await this.machines.terminateSandbox(id);
        }
      },
      { vmId: id, title: vm.name + ' · 沙箱命令', action: 'sandbox-run' },
    );
  }
  async close() {
    this.closed = true;
    await this.jobs.close();
  }
}
