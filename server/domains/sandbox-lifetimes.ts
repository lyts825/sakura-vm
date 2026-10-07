/**
 * 模块职责：追踪沙箱到期与终止，拒绝对已过期沙箱继续变更，并保留失败清理结果。
 */
import type { VMRecord } from '../../shared/contracts/vm.ts';
import { sandboxExpired } from '../../shared/sandbox.ts';
import { AppError } from '../../shared/errors.ts';

export type SandboxLifetimePorts = {
  records(): Iterable<VMRecord>;
  get(id: string): VMRecord;
  live(id: string): { bootAbort: AbortController; abort: AbortController; done: Promise<unknown> } | undefined;
  closing(): boolean;
  maintenance(): boolean;
  busy(id: string): boolean;
  remove(id: string, allowIncident: boolean): Promise<void>;
  log(id: string, data: string): void;
};

/** Host authority for sandbox deadlines, including rescue guests and disabled UI plugins. */
export class SandboxLifetimes {
  private timer?: ReturnType<typeof setInterval>;
  private sweep?: Promise<void>;
  private closed = false;
  constructor(private readonly ports: SandboxLifetimePorts) {}
  watch() {
    if (this.timer || this.closed || this.ports.closing()) return;
    this.timer = setInterval(() => void this.expire(), 1000);
    this.timer.unref();
  }
  // Host-side enforcement remains active even when the optional UI plugin is disabled.
  expire(now = Date.now()): Promise<void> {
    if (this.closed) return this.sweep || Promise.resolve();
    if (this.sweep) return this.sweep;
    this.sweep = (async () => {
      const expired = [...this.ports.records()].filter(
        (vm) => vm.sandbox && sandboxExpired(vm.sandbox, now),
      );
      await Promise.all(
        expired.map(async (vm) => {
          if (this.ports.closing()) return;
          try {
            await this.terminate(vm.id);
            if (vm.sandbox!.onExpire === 'delete' && !this.ports.maintenance() && !this.ports.busy(vm.id))
              await this.ports.remove(vm.id, !!vm.rescueOf);
          } catch (error) {
            this.ports.log(vm.id, '\r\n沙箱到期清理失败：' + String(error) + '\r\n');
          }
        }),
      );
    })().finally(() => {
      this.sweep = undefined;
    });
    return this.sweep;
  }
  async terminate(id: string) {
    if (!this.ports.get(id).sandbox) throw new AppError('该实例不是沙箱', 409);
    const live = this.ports.live(id);
    if (!live) return;
    // Cancellation must not wait on a guest command or an unrelated instance lock.
    live.bootAbort.abort();
    live.abort.abort();
    await live.done;
  }
  requireLifetime(vm: VMRecord) {
    if (vm.sandbox && sandboxExpired(vm.sandbox))
      throw new AppError('沙箱已到期，请销毁后创建新沙箱', 409, 'SANDBOX_EXPIRED');
  }
  requireMutable(vm: VMRecord) {
    if (vm.sandbox)
      throw new AppError('沙箱资源和网络策略创建后不可修改，请创建新沙箱', 409, 'SANDBOX_POLICY_LOCKED');
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.timer = undefined;
    await this.sweep;
  }
}
