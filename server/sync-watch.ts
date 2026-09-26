import { watch, type FSWatcher } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { quote } from './files.ts';
import type { Machines } from './machines.ts';

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
  constructor(
    private machines: Machines,
    private notify: () => void,
  ) {}
  view(key: string) {
    return this.entries.get(key)?.state || null;
  }
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
  started(key: string, now: number) {
    const entry = this.entries.get(key);
    if (entry) {
      entry.dirty = false;
      entry.scannedAt = now;
    }
  }
  retain(keep: (key: string, id: string) => boolean) {
    for (const [key, entry] of this.entries) {
      if (keep(key, entry.id)) continue;
      entry.abort.abort();
      entry.watcher?.close();
      this.entries.delete(key);
    }
  }
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
