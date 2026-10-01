import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SandboxExecution } from '../shared/sandbox.ts';
import { AppError, DATA } from './model.ts';

export type JobMeta = {
  title?: string;
  vmId?: string;
  action?: string;
  projectId?: string;
  execution?: SandboxExecution;
};
export type JobView = JobMeta & {
  id?: string;
  key?: string;
  scope?: string;
  status: 'running' | 'done' | 'error' | 'cancelled' | 'interrupted';
  log: string;
  error?: string;
  errorCode?: string;
  startedAt: string;
  finishedAt?: string;
  phase?: string;
  progress?: number;
  result?: { bytes: number; sha256: string };
  logPruned?: { at: string; bytes: number };
};
export type JobUpdate = (phase: string, progress?: number) => void;
type Work = (
  log: (text: string) => void,
  signal: AbortSignal,
  update: JobUpdate,
  result: (value: unknown) => Promise<void>,
) => Promise<void>;
const cleanupFailureCodes = new Set([
  'GUEST_TASK_CLEANUP_FAILED', 'SERVICE_CLEANUP_FAILED',
  'PROJECT_MAIN_CLEANUP_FAILED', 'PROJECT_SSH_CLEANUP_FAILED',
  'PROJECT_IDENTITY_CLEANUP_FAILED',
  'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED',
  'RUNTIME_INSTALL_CLEANUP_FAILED',
]);
export class Jobs {
  static instrument?: (view: JobView, work: () => Promise<void>) => Promise<void>;
  private closed = false;
  private items = new Map<string, { view: JobView; abort: AbortController; done: Promise<void> }>();
  private history: JobView[] = [];
  private queue = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private file?: string;
  private persisted?: string;
  private results = new Map<string, string>();
  persistenceError?: string;
  constructor(
    private scope?: string,
    directory = join(DATA, 'jobs'),
  ) {
    if (!scope) return;
    this.file = join(directory, `${scope}.json`);
    try {
      const values = JSON.parse(readFileSync(this.file, 'utf8'));
      if (
        !Array.isArray(values) ||
        values.some(
          (v) =>
            !v ||
            typeof v.id !== 'string' ||
            typeof v.key !== 'string' ||
            typeof v.log !== 'string' ||
            !Number.isFinite(Date.parse(v.startedAt)) ||
            !['running', 'done', 'error', 'cancelled', 'interrupted'].includes(v.status),
        )
      )
        throw new Error('任务历史格式无效');
      this.history = values.slice(-200).map((view: JobView) =>
        view.status === 'running'
          ? {
              ...view,
              status: 'interrupted',
              ...(view.execution
                ? { execution: { ...view.execution, outcome: 'interrupted' as const } }
                : {}),
              finishedAt: new Date().toISOString(),
              error: '服务已重启，任务中断，请检查结果后重试',
            }
          : view,
      );
      this.persisted = JSON.stringify(values);
      this.persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.persistenceError = '任务历史读取失败';
    }
  }
  private persist() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 250);
    this.timer.unref();
  }
  async flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.file) return;
    const file = this.file,
      data = JSON.stringify(this.history);
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        if (data === this.persisted && !this.persistenceError) return;
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file + '.tmp', data, { mode: 0o600 });
        await rename(file + '.tmp', file);
        this.persisted = data;
        this.persistenceError = undefined;
      })
      .catch(() => {
        this.persistenceError = '任务历史保存失败，请检查磁盘空间和权限';
      });
    await this.queue;
  }
  list() {
    return [...this.history].reverse();
  }
  view(key: string) {
    return this.items.get(key)?.view || this.history.findLast((v) => v.key === key) || null;
  }
  get(id: string) {
    return this.history.find((v) => v.id === id);
  }
  async clearCompletedLogs(entries: { id: string; signature: string }[], at: string) {
    if (this.closed) throw new AppError('任务服务正在关闭', 503);
    const removed: { view: JobView; log: string; previous: JobView['logPruned'] }[] = [];
    let removedBytes = 0;
    for (const entry of entries) {
      const view = this.get(entry.id);
      if (
        !view ||
        view.status === 'running' ||
        !view.log ||
        createHash('sha256').update(view.log).digest('hex') !== entry.signature
      )
        continue;
      removed.push({ view, log: view.log, previous: view.logPruned });
      const bytes = Buffer.byteLength(view.log);
      removedBytes += bytes;
      view.log = '';
      view.logPruned = { at, bytes };
    }
    await this.flush();
    if (this.persistenceError) {
      for (const item of removed)
        if (item.view.log === '' && item.view.logPruned?.at === at) {
          item.view.log = item.log;
          item.view.logPruned = item.previous;
        }
      this.persist();
      throw new AppError('任务日志清理保存失败', 500);
    }
    return { removedLogs: removed.length, removedBytes };
  }
  async result(id: string) {
    const job = this.get(id);
    if (!job?.result || !/^[a-f0-9-]{36}$/.test(id)) throw new AppError('任务没有保存结果', 404);
    const data = this.file
      ? await readFile(join(this.file + '.results', id + '.json'), 'utf8')
      : this.results.get(id);
    if (
      data === undefined ||
      Buffer.byteLength(data) !== job.result.bytes ||
      createHash('sha256').update(data).digest('hex') !== job.result.sha256
    )
      throw new AppError('任务结果校验失败', 409);
    return JSON.parse(data);
  }
  start(key: string, work: Work, meta: JobMeta = {}) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.items.get(key)?.view.status === 'running') throw new AppError('另一项操作仍在进行', 409);
    const view: JobView = {
      ...meta,
      id: randomUUID(),
      key,
      scope: this.scope,
      status: 'running',
      phase: '准备中',
      log: '',
      startedAt: new Date().toISOString(),
    };
    const abort = new AbortController();
    this.history.push(view);
    while (this.history.length > 200) {
      const index = this.history.findIndex((v) => v.status !== 'running');
      if (index < 0) break;
      const [removed] = this.history.splice(index, 1);
      if (removed.key && this.items.get(removed.key)?.view === removed) this.items.delete(removed.key);
      this.results.delete(removed.id!);
      if (this.file && removed.result && /^[a-f0-9-]{36}$/.test(removed.id || ''))
        void rm(join(this.file + '.results', removed.id! + '.json'), { force: true }).catch(() => {});
    }
    this.persist();
    const done = Promise.resolve()
      .then(async () => {
        await this.flush();
        abort.signal.throwIfAborted();
        const execute = async () => {
          await work(
            (text) => {
              view.log = (view.log + text).slice(-32768);
              const line = text.trim().split('\n').at(-1);
              if (line) view.phase = line.slice(0, 120);
              this.persist();
            },
            abort.signal,
            (phase, progress) => {
              view.phase = phase;
              view.progress = progress === undefined ? undefined : Math.min(100, Math.max(0, progress));
              this.persist();
            },
            async (value) => {
              const data = JSON.stringify(value),
                bytes = Buffer.byteLength(data);
              if (bytes > 8 * 1024 * 1024) throw new AppError('任务结果超过 8 MiB，请缩小操作范围');
              if (this.file) {
                const folder = this.file + '.results',
                  path = join(folder, view.id! + '.json');
                await mkdir(folder, { recursive: true });
                await writeFile(path + '.tmp', data, { mode: 0o600 });
                await rename(path + '.tmp', path);
              } else this.results.set(view.id!, data);
              view.result = { bytes, sha256: createHash('sha256').update(data).digest('hex') };
              this.persist();
            },
          );
          abort.signal.throwIfAborted();
        };
        if (Jobs.instrument) await Jobs.instrument(view, execute);
        else await execute();
        view.status = 'done';
        view.phase = '已完成';
        view.progress = 100;
      })
      .catch((error: Error) => {
        const cleanupFailed = error instanceof AppError && cleanupFailureCodes.has(error.code || '');
        const cancelled = abort.signal.aborted && !cleanupFailed;
        view.status = cancelled ? 'cancelled' : 'error';
        view.error = cancelled ? '操作已取消' : error.message;
        view.errorCode = !cancelled && error instanceof AppError ? error.code : undefined;
        view.phase = view.error;
        if (view.execution)
          view.execution.outcome = cleanupFailed ? 'failed' : cancelled
            ? 'cancelled'
            : view.execution.outcome && view.execution.outcome !== 'success'
              ? view.execution.outcome
              : 'failed';
      })
      .finally(async () => {
        view.finishedAt = new Date().toISOString();
        await this.flush();
      });
    this.items.set(key, { view, abort, done });
    return view;
  }
  async track<T>(
    key: string,
    work: (log: (s: string) => void, signal: AbortSignal, update: JobUpdate) => Promise<T>,
    meta: JobMeta = {},
    external?: AbortSignal,
  ): Promise<T> {
    let result!: T;
    let failure: unknown;
    const view = this.start(
      key,
      async (log, signal, update) => {
        try { result = await work(log, signal, update); }
        catch (error) { failure = error; throw error; }
      },
      meta,
    );
    const cancel = () => this.cancel(key);
    external?.addEventListener('abort', cancel, { once: true });
    if (external?.aborted) cancel();
    try {
      await this.items.get(key)!.done;
      if (view.status !== 'done')
        throw new AppError(view.error || '任务失败', view.status === 'cancelled' ? 409 :
          cleanupFailureCodes.has(view.errorCode || '') ? 503 :
            failure instanceof AppError ? failure.status : 400, view.errorCode);
      return result;
    } finally {
      external?.removeEventListener('abort', cancel);
    }
  }
  cancel(key: string) {
    const item = this.items.get(key) || [...this.items.values()].find((v) => v.view.id === key);
    if (item?.view.status === 'running') {
      item.view.phase = '正在取消并清理…';
      item.abort.abort();
    }
  }
  async wait(key: string) {
    await this.items.get(key)?.done;
  }
  async close() {
    this.closed = true;
    for (const item of this.items.values()) if (item.view.status === 'running') item.abort.abort();
    await Promise.all([...this.items.values()].map((v) => v.done));
    await this.flush();
  }
}
