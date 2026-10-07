/**
 * 模块职责：维护客户机目录事件监听，inotify 不可用时保留轮询路径并管理监听资源。
 * Module purpose: Owns guest directory event listeners, retaining polling when inotify is unavailable and managing listener cleanup.
 */
import { watch, type FSWatcher } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { quote } from './shell.ts';
import type { VmAccess as Machines } from './vm-access.ts';

export type SyncWatchView = {
  host: 'watching' | 'polling';
  guest: 'watching' | 'polling' | 'offline';
  reason?: string;
  lastEvent?: string;
};
type Entry = {
  id: string;
  host: string;
  guest: string;
  abort: AbortController;
  watcher?: FSWatcher;
  task: Promise<void>;
  dirty: boolean;
  scannedAt: number;
  state: SyncWatchView;
};
export class SyncWatchers {
  private entries = new Map<string, Entry>();
  private tasks = new Set<Promise<void>>();
  /**
   * 入口 / Entry: SyncWatchers.constructor.
   * 功能：建立 SyncWatchers 的维护客户机目录事件监听上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SyncWatchers context for this module's responsibility: Owns guest directory event listeners, retaining polling when inotify is unavailable and managing listener cleanup. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; notify: () => void
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private notify: () => void,
  ) {}
  /**
   * 入口 / Entry: SyncWatchers.view.
   * 功能：从当前输入或状态计算 `this.entries.get(key)?.state || null`，供调用方后续验证或使用。
   * Purpose: Computes `this.entries.get(key)?.state || null` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: key: string
   * 输出 / Returns: `this.entries.get(key)?.state || null`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(key: string) {
    return this.entries.get(key)?.state || null;
  }
  /**
   * 入口 / Entry: SyncWatchers.ensure.
   * 功能：为当前宿主与客户机目录建立监听，配置改变时退休原监听并保留轮询备选。
   * Purpose: Ensures host/guest directory watches, retiring changed watches and retaining polling fallback.
   * 设计：通知合并而不直接进行同步；监听失败只改变观测方式，原连接与取消仍由本监听条目清理。
   * Design: Notifications coalesce without directly syncing; failure changes observation mode while each entry owns connection/cancellation cleanup.
   * 输入 / Inputs: key: string; id: string; config: { host: string; guest: string; auto: boolean; watch?: boolean }
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `entry.abort.abort`; `entry.watcher.close`; `this.entries.delete`; `this.entries.set`; `this.tasks.add`; 更新 / updates `entry`, `active.watcher`, `active.state.host`, `active.state.reason`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `active.state.reason = (error as Error).message;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `active.state.reason = (error as Error).message;`; these statements determine whether a failure is absorbed or rejected again.
   */
  ensure(key: string, id: string, config: { host: string; guest: string; auto: boolean; watch?: boolean }) {
    let entry = this.entries.get(key);
    if (
      entry &&
      (entry.host !== config.host || entry.guest !== config.guest || !config.auto || !config.watch)
    ) {
      entry.abort.abort();
      entry.watcher?.close();
      this.entries.delete(key);
      entry = undefined;
    }
    if (entry || !config.auto || !config.watch) return;
    const controller = new AbortController();
    entry = {
      id,
      host: config.host,
      guest: config.guest,
      abort: controller,
      task: Promise.resolve(),
      dirty: true,
      scannedAt: 0,
      state: { host: 'polling', guest: 'polling' },
    };
    const active = entry;
    /**
     * 入口 / Entry: SyncWatchers.ensure.changed.
     * 功能：在维护客户机目录事件监听中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`SyncWatchers`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyncWatchers`; this entry produces `void` for its caller. Module context: Owns guest directory event listeners, retaining polling when inotify is unavailable and managing listener cleanup.
     * 处理：通过 `this.notify` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.notify`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `controller.signal.aborted`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: 更新 / updates `active.dirty`, `active.state.lastEvent`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const changed = () => {
      if (controller.signal.aborted) return;
      active.dirty = true;
      active.state.lastEvent = new Date().toISOString();
      this.notify();
    };
    try {
      active.watcher = watch(
        config.host,
        { recursive: true, persistent: false, signal: controller.signal },
        (_event, filename) => {
          // Ignore our atomic staging writes. Published files still emit a destination event.
          if (!filename?.split(/[\\/]/).some((part) => part.startsWith('.sakura-'))) changed();
        },
      );
      active.watcher.on('error', (error) => {
        active.state.host = 'polling';
        active.state.reason = error.message;
        changed();
      });
      active.state.host = 'watching';
    } catch (error) {
      active.state.reason = (error as Error).message;
    }
    this.entries.set(key, active);
    /**
     * 入口 / Entry: SyncWatchers.ensure.callback@85.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.machines.exec`; 更新 / updates `active.state.guest`, `active.state.reason`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 `if (controller.signal.aborted) break;`; `active.state.guest = 'polling';`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (controller.signal.aborted) break;`; `active.state.guest = 'polling';`; these statements determine whether a failure is absorbed or rejected again.
     */
    active.task = (async () => {
      while (!controller.signal.aborted) {
        try {
          if (this.machines.state(id) !== 'running') {
            active.state.guest = 'offline';
            await delay(1000, undefined, { signal: controller.signal, ref: false });
            continue;
          }
          // inotifywait exits after one event or its bounded timeout; cancellation closes SSH.
          const result = await this.machines.exec(
            id,
            'command -v inotifywait >/dev/null || exit 127; test -d ' +
              quote(config.guest) +
              ' || exit 3; inotifywait -q -r -t 25 -e close_write,attrib,create,delete,move -- ' +
              quote(config.guest),
            35000,
            controller.signal,
          );
          if (result.code === 0 || result.code === 2) {
            active.state.guest = 'watching';
            if (active.state.host === 'watching') delete active.state.reason;
            if (result.code === 0) changed();
            await delay(250, undefined, { signal: controller.signal, ref: false });
          } else {
            active.state.guest = 'polling';
            active.state.reason =
              result.code === 127 ? 'Linux 未安装 inotify-tools，保留轮询' : 'Linux 事件监听不可用，保留轮询';
            await delay(60000, undefined, { signal: controller.signal, ref: false });
          }
        } catch (error) {
          if (controller.signal.aborted) break;
          active.state.guest = 'polling';
          active.state.reason = (error as Error).message;
          await delay(5000, undefined, { signal: controller.signal, ref: false }).catch(() => {});
        }
      }
    })().catch(() => {});
    this.tasks.add(active.task);
    void active.task.finally(() => this.tasks.delete(active.task));
  }
  /**
   * 入口 / Entry: SyncWatchers.due.
   * 功能：从当前输入或状态计算 `( !entry || entry.dirty || entry.state.host !== 'watching' || entry.state.guest !== 'watching' || now - entry.scannedAt >= 60…`，供调用方后续验证或使用。
   * Purpose: Computes `( !entry || entry.dirty || entry.state.host !== 'watching' || entry.state.guest !== 'watching' || now - entry.scannedAt >= 60…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: key: string; now: number
   * 输出 / Returns: `( !entry || entry.dirty || entry.state.host !== 'watching' || entry.state.guest !== 'watching' || now - entry.scannedAt >= 60…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  due(key: string, now: number) {
    const entry = this.entries.get(key);
    return (
      !entry ||
      entry.dirty ||
      entry.state.host !== 'watching' ||
      entry.state.guest !== 'watching' ||
      now - entry.scannedAt >= 60000
    );
  }
  /**
   * 入口 / Entry: SyncWatchers.started.
   * 功能：在维护客户机目录事件监听中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `entry.dirty`, `entry.scannedAt`（`SyncWatchers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyncWatchers`; the outcome is recorded in `entry.dirty`, `entry.scannedAt`. Module context: Owns guest directory event listeners, retaining polling when inotify is unavailable and managing listener cleanup.
   * 处理：通过 `this.entries.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.entries.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `entry`.
   * 输入 / Inputs: key: string; now: number
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `entry.dirty`, `entry.scannedAt`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  started(key: string, now: number) {
    const entry = this.entries.get(key);
    if (entry) {
      entry.dirty = false;
      entry.scannedAt = now;
    }
  }
  /**
   * 入口 / Entry: SyncWatchers.retain.
   * 功能：在维护客户机目录事件监听中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`SyncWatchers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyncWatchers`; the calls and state transitions below complete the operation. Module context: Owns guest directory event listeners, retaining polling when inotify is unavailable and managing listener cleanup.
   * 处理：通过 `keep`, `entry.abort.abort`, `entry.watcher.close`, `this.entries.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `keep`, `entry.abort.abort`, `entry.watcher.close`, `this.entries.delete`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `keep(key, entry.id)`.
   * 输入 / Inputs: keep: (key: string, id: string) => boolean
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `entry.abort.abort`; `entry.watcher.close`; `this.entries.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  retain(keep: (key: string, id: string) => boolean) {
    for (const [key, entry] of this.entries) {
      if (keep(key, entry.id)) continue;
      entry.abort.abort();
      entry.watcher?.close();
      this.entries.delete(key);
    }
  }
  /**
   * 入口 / Entry: SyncWatchers.close.
   * 功能：在维护客户机目录事件监听中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`SyncWatchers`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SyncWatchers`; the calls and state transitions below complete the operation. Module context: Owns guest directory event listeners, retaining polling when inotify is unavailable and managing listener cleanup.
   * 处理：通过 `this.entries.values`, `this.entries.clear`, `entry.abort.abort`, `entry.watcher.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.entries.values`, `this.entries.clear`, `entry.abort.abort`, `entry.watcher.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.entries.clear`; `entry.abort.abort`; `entry.watcher.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      entry.abort.abort();
      entry.watcher?.close();
    }
    await Promise.allSettled([...this.tasks]);
  }
}
