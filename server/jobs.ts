import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { writeStore } from './local-store.ts';
import { hostRuntime, withResourceContext } from './host-runtime/index.ts';
import { withNewResourceContext } from './host-runtime/context.ts';
import { withoutAuditParent } from './audit.ts';
import { captureOperationCheck, withoutOperationContext } from './operation-context.ts';
import { pluginAuthority, withPluginAuthority } from './plugin-authority.ts';

export type { JobMeta, JobView, JobUpdate } from '../shared/contracts/jobs.ts';
import type { JobMeta, JobView, JobUpdate } from '../shared/contracts/jobs.ts';
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
  'PROJECT_REPOSITORY_CLEANUP_FAILED',
  'RUNTIME_INSTALL_CLEANUP_FAILED',
  'BROWSER_IDE_CLEANUP_FAILED',
  'NOTEBOOK_CLEANUP_FAILED', 'NOTEBOOK_PREPARE_CLEANUP_FAILED',
  'DESKTOP_CLEANUP_FAILED', 'LINUX_CLIPBOARD_CLEANUP_FAILED',
  'HOST_PROCESS_CLEANUP_PENDING', 'STORAGE_CLEANUP_PENDING',
  'VM_CLEANUP_PENDING', 'EXECUTION_CLEANUP_PENDING',
  'PLUGIN_CLEANUP_PENDING',
  'SESSION_CLEANUP_PENDING',
  'COMPUTE_CLEANUP_PENDING',
]);
type JobResource = Awaited<ReturnType<typeof hostRuntime.acquire>>;
type JobContext = { id: string; lease: JobResource; signal: AbortSignal; open: boolean;
  children: Map<string, Promise<void>>; tail: Promise<void>; cleanupFailure?: Error };
const context = new AsyncLocalStorage<JobContext>();
const delegatedQueueLimit = 64;
// Bound synchronous start() calls before their asynchronous governor admissions.
// These are registration ceilings; the host runtime remains the only execution budget.
const pendingJobLimit = 272, ownerPendingLimit = 80, pendingControlReserve = 16, ownerControlReserve = 2;
let pendingJobs = 0;
const pendingOwners = new Map<string, number>();
const dependencies = new Map<string, Map<string, number>>();
function dependsOn(source: string, target: string): () => void {
  const reaches = (id: string, seen = new Set<string>()): boolean => {
    if (id === source) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return [...(dependencies.get(id)?.keys() || [])].some((next) => reaches(next, seen));
  };
  if (reaches(target)) throw new AppError('任务之间存在循环等待', 409, 'JOB_DEPENDENCY_CYCLE');
  const links = dependencies.get(source) || new Map<string, number>(); dependencies.set(source, links);
  links.set(target, (links.get(target) || 0) + 1);
  return () => {
    const count = links.get(target) || 0;
    if (count > 1) links.set(target, count - 1); else links.delete(target);
    if (!links.size) dependencies.delete(source);
  };
}
function waitFor(promise: Promise<void>, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(() => { signal.removeEventListener('abort', abort); resolve(); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}
export class Jobs {
  /** Schedule independent background work without borrowing the registering job's slot or credentials. */
  static detached<T>(work: () => T): T {
    return withoutOperationContext(() => withoutAuditParent(() => context.exit(() => withNewResourceContext({}, work))));
  }
  static instrument?: (view: JobView, work: () => Promise<void>) => Promise<void>;
  private closed = false;
  private closeTask?: Promise<void>;
  private items = new Map<string, { view: JobView; abort: AbortController; done: Promise<void> }>();
  private history: JobView[] = [];
  private queue = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private file?: string;
  private persisted?: string;
  private results = new Map<string, string>();
  private cleanups = new Map<string, { view: JobView; lease?: JobResource }>();
  persistenceError?: string;
  private pluginLifetime = pluginAuthority();
  constructor(
    private scope?: string,
    directory = join(DATA, 'jobs'),
  ) {
    if (this.pluginLifetime) {
      const lifetime = this.pluginLifetime;
      lifetime.check('jobs', true);
      const cancel = () => { for (const item of this.items.values()) item.abort.abort(lifetime.signal.reason); };
      lifetime.signal.addEventListener('abort', cancel, { once: true });
      lifetime.scope.add(async () => {
        await this.close();
        if (this.cleanups.size) throw new AppError('插件任务仍有资源等待恢复', 503, 'PLUGIN_CLEANUP_PENDING');
        lifetime.signal.removeEventListener('abort', cancel);
      });
    }
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
              admission: view.admission === 'cleanup-pending' ? 'cleanup-pending' : undefined,
              resourceWait: undefined,
              ...(view.execution
                ? { execution: { ...view.execution, outcome: 'interrupted' as const } }
                : {}),
              finishedAt: new Date().toISOString(),
              error: '服务已重启，任务中断，请检查结果后重试',
            }
          : view,
      );
      this.persisted = JSON.stringify(values);
      for (const view of this.history) if (view.admission === 'cleanup-pending')
        this.registerCleanup(view, new Error(view.error || '任务资源清理尚未确认'));
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
        await writeStore(file, JSON.parse(data));
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
  private registerCleanup(view: JobView, error: Error) {
    if (!view.id || this.cleanups.has(view.id)) return;
    const pending: { view: JobView; lease?: JobResource } = { view };
    this.cleanups.set(view.id, pending);
    try {
      const lease = hostRuntime.register({ owner: view.owner || `jobs:${this.scope || 'anonymous'}`,
        kind: 'job-cleanup', label: (view.title || view.key || view.id).slice(0, 200), lane: 'control',
        identity: { operationId: view.id, jobId: view.id, vmId: view.vmId, projectId: view.projectId } });
      lease.cleanupPending(error); pending.lease = lease; view.cleanupLeaseId = lease.id;
    } catch (registrationError) {
      view.log = (view.log + `\n清理资源登记失败：${String(registrationError)}\n`).slice(-32768);
    }
  }
  /** Domain recovery calls this only after it has independently confirmed cleanup.
   * It resolves this Jobs instance's diagnostic marker, never an external resource lease. */
  async resolveCleanup(id: string) {
    const pending = this.cleanups.get(id);
    if (!pending) throw new AppError('当前任务服务没有这项待清理记录', 404, 'JOB_CLEANUP_NOT_FOUND');
    pending.lease?.release(); this.cleanups.delete(id);
    pending.view.admission = undefined; pending.view.cleanupResolvedAt = new Date().toISOString();
    await this.flush();
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
  start(key: string, work: Work, meta: JobMeta = {}): JobView {
    if (this.pluginLifetime && pluginAuthority() !== this.pluginLifetime)
      return withPluginAuthority(this.pluginLifetime, () => this.start(key, work, meta));
    this.pluginLifetime?.check('jobs', true);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.items.get(key)?.view.status === 'running') throw new AppError('另一项操作仍在进行', 409);
    const inherited = context.getStore(), parent = inherited?.open ? inherited : undefined;
    const owner = this.pluginLifetime?.owner || meta.owner || `jobs:${this.scope || 'anonymous'}`;
    meta = { ...meta, owner };
    const control = meta.lane === 'control';
    const check = captureOperationCheck();
    if (pendingJobs >= pendingJobLimit - (control ? 0 : pendingControlReserve) ||
        (pendingOwners.get(owner) || 0) >= ownerPendingLimit - (control ? 0 : ownerControlReserve))
      throw new AppError('任务等待队列已满，请稍后重试', 429, 'JOB_QUEUE_FULL');
    if (parent && parent.children.size >= delegatedQueueLimit)
      throw new AppError('嵌套任务等待队列已满', 503, 'JOB_QUEUE_FULL');
    const queuedAt = new Date().toISOString();
    const view: JobView = {
      ...meta,
      id: randomUUID(),
      key,
      scope: this.scope,
      status: 'running',
      admission: 'queued',
      queuedAt,
      delegatedFrom: parent?.id,
      resourceWait: { resource: 'jobs', reason: parent ? '等待同一父任务的其他子任务完成' : '等待全局任务执行预算', since: queuedAt },
      phase: '等待执行资源',
      log: '',
      startedAt: queuedAt,
    };
    const abort = new AbortController();
    pendingJobs++; pendingOwners.set(owner, (pendingOwners.get(owner) || 0) + 1);
    const cancelWithParent = () => abort.abort(parent?.signal.reason);
    parent?.signal.addEventListener('abort', cancelWithParent, { once: true });
    if (parent?.signal.aborted) cancelWithParent();
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
    let lease: JobResource | undefined;
    // Capture the sibling predecessor before publishing this child's completion.
    const predecessor = parent?.tail;
    const done = Promise.resolve()
      .then(async () => {
        await this.flush();
        abort.signal.throwIfAborted();
        if (parent) {
          await waitFor(predecessor!, abort.signal);
          abort.signal.throwIfAborted();
          lease = parent.lease;
        } else {
          lease = await hostRuntime.acquire({ owner,
            kind: 'job', label: (meta.title || key).slice(0, 200), lane: meta.lane || 'interactive', cost: { jobs: 1 },
            identity: { operationId: view.id, jobId: view.id, vmId: meta.vmId, projectId: meta.projectId },
            signal: abort.signal, ...(meta.admissionTimeoutMs === undefined ? {} : { timeoutMs: meta.admissionTimeoutMs }) });
        }
        if (!control) await check();
        abort.signal.throwIfAborted();
        view.admission = 'running'; view.executionStartedAt = new Date().toISOString();
        view.resourceLeaseId = lease.id; view.resourceWait = undefined; view.phase = '准备中';
        // History is observational; domain owners persist their own recoverable intents.
        this.persist();
        abort.signal.throwIfAborted();
        const childrenAbort = new AbortController();
        const own: JobContext = { id: view.id!, lease, signal: AbortSignal.any([abort.signal, childrenAbort.signal]),
          open: true, children: new Map(), tail: Promise.resolve() };
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
              const data = JSON.stringify(value, null, 2),
                bytes = Buffer.byteLength(data);
              if (bytes > 8 * 1024 * 1024) throw new AppError('任务结果超过 8 MiB，请缩小操作范围');
              if (this.file) {
                const path = join(this.file + '.results', view.id! + '.json');
                await writeStore(path, JSON.parse(data));
              } else this.results.set(view.id!, data);
              view.result = { bytes, sha256: createHash('sha256').update(data).digest('hex') };
              this.persist();
            },
          );
          abort.signal.throwIfAborted();
        };
        await withResourceContext({ owner,
          operationId: view.id, jobId: view.id, vmId: meta.vmId, projectId: meta.projectId }, () => context.run(own, async () => {
          let workError: unknown;
          try {
            if (Jobs.instrument) await Jobs.instrument(view, execute);
            else await execute();
          } catch (error) { workError = error; childrenAbort.abort(error); }
          finally {
            own.open = false;
            await Promise.all([...own.children.values()]);
          }
          if (own.cleanupFailure && !(workError instanceof AppError && cleanupFailureCodes.has(workError.code || '')))
            throw own.cleanupFailure;
          if (workError !== undefined) throw workError;
          abort.signal.throwIfAborted();
        }));
        view.status = 'done';
        view.phase = '已完成';
        view.progress = 100;
      })
      .catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        const cleanupFailed = error instanceof AppError && cleanupFailureCodes.has(error.code || '');
        const cancelled = abort.signal.aborted && !cleanupFailed;
        view.status = cancelled ? 'cancelled' : 'error';
        view.error = cancelled ? '操作已取消' : error.message;
        view.errorCode = !cancelled && error instanceof AppError ? error.code : undefined;
        view.phase = view.error;
        if (cleanupFailed) {
          view.admission = 'cleanup-pending';
          if (parent) parent.cleanupFailure ||= error;
          this.registerCleanup(view, error);
        }
        if (view.execution)
          view.execution.outcome = cleanupFailed ? 'failed' : cancelled
            ? 'cancelled'
            : view.execution.outcome && view.execution.outcome !== 'success'
              ? view.execution.outcome
              : 'failed';
      })
      .finally(async () => {
        pendingJobs--;
        const remaining = (pendingOwners.get(owner) || 1) - 1;
        if (remaining) pendingOwners.set(owner, remaining); else pendingOwners.delete(owner);
        parent?.signal.removeEventListener('abort', cancelWithParent);
        // The job callback (and all delegated cleanup) has settled. Unconfirmed
        // external resources retain their own host leases, not this execution slot.
        if (lease && !parent) await lease.release();
        if (view.admission !== 'cleanup-pending') view.admission = undefined;
        view.resourceWait = undefined;
        view.finishedAt = new Date().toISOString();
        await this.flush();
      });
    if (parent) {
      const detachParent = dependsOn(parent.id, view.id!);
      for (const [siblingId, sibling] of parent.children) {
        const detachSibling = dependsOn(view.id!, siblingId);
        void sibling.then(detachSibling, detachSibling);
      }
      parent.children.set(view.id!, done);
      // A cancelled queued child settles promptly, but must not let later siblings
      // overtake the still-running predecessor.
      parent.tail = Promise.all([predecessor, done]).then(() => {});
      void done.then(() => { detachParent(); parent.children.delete(view.id!); },
        () => { detachParent(); parent.children.delete(view.id!); });
    }
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
    const cancel = () => this.cancel(key, external?.reason);
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
  cancel(key: string, reason?: unknown) {
    const item = this.items.get(key) || [...this.items.values()].find((v) => v.view.id === key);
    if (item?.view.status === 'running') {
      item.view.phase = '正在取消并清理…';
      item.view.admission = 'cancelling';
      item.abort.abort(reason);
      this.persist();
    }
  }
  async wait(key: string) {
    const item = this.items.get(key), caller = context.getStore();
    const detach = caller?.open && item?.view.status === 'running' ? dependsOn(caller.id, item.view.id!) : undefined;
    try { await item?.done; } finally { detach?.(); }
  }
  close(): Promise<void> {
    const caller = context.getStore(), detach: (() => void)[] = [];
    try {
      if (caller?.open) for (const item of this.items.values())
        if (item.view.status === 'running') detach.push(dependsOn(caller.id, item.view.id!));
    } catch (error) { for (const remove of detach) remove(); return Promise.reject(error); }
    if (this.closeTask) { for (const remove of detach) remove(); return this.closeTask; }
    return this.closeTask ||= (async () => {
      try {
        this.closed = true;
        for (const [key, item] of this.items) if (item.view.status === 'running') this.cancel(key);
        await Promise.all([...this.items.values()].map((v) => v.done));
        await this.flush();
      } finally { for (const remove of detach) remove(); }
    })();
  }
}
