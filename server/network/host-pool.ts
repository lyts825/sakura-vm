import { fork, spawn, type ChildProcess } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from '../paths.ts';
import { hostRuntime, type ResourceLease } from '../host-runtime/index.ts';
import { AppError } from '../../shared/errors.ts';

export type Destination = { host: string; port: number; family?: number };
export type PoolOptions = {
  maxWorkers: number;
  connectionsPerWorker: number;
  scaleAt: number;
  idleMs: number;
  owner?: string;
  reserveBackend?: boolean;
};
type PoolDependencies = {
  governor?: Pick<typeof hostRuntime, 'tryAcquire'>;
  forkWorker?: (file: string, limit: number) => ChildProcess;
  spawnBackend?: (file: string, args: string[]) => ChildProcess;
  closeTimeoutMs?: number;
};
type Pending = { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout };
const failure = (message: string, code = 'NETWORK_UNAVAILABLE') =>
  Object.assign(new Error(message), { code });
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

const cleanupFailure = () =>
  new AppError('Network process cleanup is not confirmed', 503, 'HOST_PROCESS_CLEANUP_PENDING');
function waitForClose(closed: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    closed.then(() => true),
    new Promise<boolean>((done) => {
      timer = setTimeout(() => done(false), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}
type Backend = {
  child: ChildProcess;
  lease: ResourceLease;
  id: string;
  binary: string;
  stopped: Promise<void>;
  ended: boolean;
  closed: boolean;
  writing: number;
  closeTask?: Promise<void>;
};

class HostWorker {
  readonly child: ChildProcess;
  readonly ready: Promise<number>;
  readonly leases = new Set<string>();
  private pending = new Map<string, Pending>();
  private unavailable = false;
  private inFlight = 0;
  private rejectReady!: (error: Error) => void;
  private stopped: Promise<void>;
  private closeTask?: Promise<void>;
  private childClosed = false;
  private childEnded = false;
  private finalized = false;
  private backend?: Backend;
  cleanupError?: Error;
  idleAt = Date.now();
  get backendPid() {
    return this.backend?.closed ? undefined : this.backend?.child.pid;
  }
  get backendResourceId() {
    return this.backend?.lease.id || this.backendReservation?.id;
  }
  get available() {
    return !this.unavailable;
  }
  constructor(
    readonly options: PoolOptions,
    readonly resource: ResourceLease,
    private dependencies: PoolDependencies,
    private onExit: (worker: HostWorker) => void,
    private onFinalized: (worker: HostWorker) => void,
    private backendReservation?: ResourceLease,
  ) {
    const source = join(ROOT, 'server/network/worker.mjs');
    const file = existsSync(source) ? source : join(ROOT, '.sakura-server/assets/network-worker.mjs');
    this.child = dependencies.forkWorker
      ? dependencies.forkWorker(file, options.connectionsPerWorker)
      : fork(file, [], {
          execArgv: [],
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          env: { ...process.env, SAKURA_NETWORK_WORKER_LIMIT: String(options.connectionsPerWorker) },
        });
    let resolveReady!: (port: number) => void;
    this.ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.ready.catch(() => {});
    const startupTimer = setTimeout(() => {
      this.fail(failure('Network worker startup timed out'));
      this.retire();
    }, 10_000);
    this.child.on('message', (message: any) => {
      if (!message || typeof message !== 'object') return;
      if (message.event === 'ready') {
        if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
          this.fail(failure('Invalid network worker endpoint'));
          this.retire();
          return;
        }
        clearTimeout(startupTimer);
        resolveReady(message.port);
      } else if (message.event === 'backend-write') {
        const backend = this.backend;
        if (
          !backend ||
          backend.closed ||
          backend.id !== message.backendId ||
          this.unavailable ||
          typeof message.bytes !== 'string' ||
          Buffer.byteLength(message.bytes) > 1024 * 1024
        ) {
          this.fail(failure('Invalid network backend write'));
          this.retire();
          return;
        }
        const bytes = Buffer.byteLength(message.bytes);
        if (backend.writing + bytes > 2 * 1024 * 1024) {
          this.fail(failure('Network backend control buffer is full'));
          this.retire();
          return;
        }
        backend.writing += bytes;
        backend.child.stdin!.write(message.bytes, (error) => {
          backend.writing -= bytes;
          if (error) {
            this.fail(error);
            this.retire();
          }
        });
      } else if (message.event === 'backend-stop') {
        if (message.backendId === this.backend?.id) void this.stopBackend().catch(() => {});
      } else if (message.requestId) {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(failure(message.error.message, message.error.code));
        else pending.resolve(message.value);
      }
    });
    this.child.once('exit', () => {
      this.childEnded = true;
    });
    this.stopped = new Promise((done) =>
      this.child.once('close', () => {
        this.childEnded = this.childClosed = true;
        clearTimeout(startupTimer);
        this.fail(failure('Network worker exited'));
        resource.release();
        if (!this.backend) {
          this.backendReservation?.release();
          this.backendReservation = undefined;
        }
        try {
          this.onExit(this);
        } finally {
          done();
          this.finalize();
          this.retire();
        }
      }),
    );
    this.child.on('error', (error) => {
      clearTimeout(startupTimer);
      this.fail(error);
      this.retire();
    });
    this.child.once('disconnect', () => {
      this.fail(failure('Network worker disconnected'));
      this.retire();
    });
  }
  private retire() {
    void this.close().catch(() => {});
  }
  private finalize() {
    if (this.finalized || !this.childClosed || (this.backend && !this.backend.closed)) return;
    this.finalized = true;
    this.cleanupError = undefined;
    this.onFinalized(this);
  }
  private send(message: Record<string, unknown>, done?: () => void) {
    const failed = (error: Error) => {
      this.fail(error);
      this.retire();
    };
    if (!this.child.connected) {
      failed(failure('Network worker disconnected'));
      return;
    }
    try {
      this.child.send(message, (error) => {
        if (error) failed(error);
        else done?.();
      });
    } catch (error) {
      failed(error as Error);
    }
  }
  private ensureBackend(binary: unknown) {
    const expected = join(
      process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu'),
      `qemu-system-x86_64${process.platform === 'win32' ? '.exe' : ''}`,
    );
    const normalize = (file: string) =>
      process.platform === 'win32' ? resolve(file).toLowerCase() : resolve(file);
    if (typeof binary !== 'string' || normalize(binary) !== normalize(expected))
      throw failure('Invalid network backend program');
    if (this.backend) {
      if (this.backend.closed || this.backend.binary !== binary)
        throw failure('Network backend is unavailable');
      return this.backend.id;
    }
    const lease =
      this.backendReservation ||
      (this.dependencies.governor || hostRuntime).tryAcquire({
        owner: this.options.owner || 'core:network',
        kind: 'network.backend',
        label: 'CPU-less network backend',
        lane: 'background',
        cost: { process: 1, 'network.worker': 1 },
      });
    if (!lease) throw failure('Network backend process budget is full', 'NETWORK_BUSY');
    this.backendReservation = undefined;
    let child: ChildProcess;
    try {
      const args = ['-machine', 'none', '-nodefaults', '-display', 'none', '-m', '0', '-qmp', 'stdio'];
      child = this.dependencies.spawnBackend
        ? this.dependencies.spawnBackend(binary, args)
        : spawn(binary, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      lease.release();
      throw error;
    }
    const id = randomUUID();
    let stopped!: () => void;
    const backend: Backend = {
      child,
      lease,
      id,
      binary,
      stopped: new Promise((done) => {
        stopped = done;
      }),
      ended: false,
      closed: false,
      writing: 0,
    };
    this.backend = backend;
    child.once('exit', () => {
      backend.ended = true;
    });
    child.once('close', () => {
      backend.ended = backend.closed = true;
      lease.release();
      stopped();
      if (this.child.connected) this.send({ command: 'backend-closed', backendId: id });
      this.finalize();
    });
    const failed = (error: Error) => {
      this.fail(error);
      this.retire();
    };
    child.on('error', failed);
    child.stdin?.on('error', failed);
    child.stdout?.on('error', failed);
    child.stderr?.on('data', () => {});
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (bytes: string) => {
      if (this.unavailable) return;
      child.stdout!.pause();
      this.send({ command: 'backend-data', backendId: id, bytes }, () => child.stdout!.resume());
    });
    // QEMU is a direct child of this host. The worker receives only an authorized
    // control stream; it cannot spawn a backend or claim that its PID has exited.
    this.send({ command: 'backend-open', backendId: id });
    return id;
  }
  private stopBackend(): Promise<void> {
    const backend = this.backend;
    if (!backend || backend.closed) return Promise.resolve();
    if (backend.closeTask) return backend.closeTask;
    return (backend.closeTask = (async () => {
      backend.child.stdout?.resume();
      if (!backend.ended) backend.child.kill('SIGKILL');
      if (!(await waitForClose(backend.stopped, this.dependencies.closeTimeoutMs ?? 5000)))
        throw cleanupFailure();
    })().catch((error) => {
      backend.lease.cleanupPending(error);
      this.cleanupError = error;
      backend.closeTask = undefined;
      throw error;
    }));
  }
  private fail(error: Error) {
    this.unavailable = true;
    this.rejectReady(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  reserve(id: string) {
    this.leases.add(id);
    this.child.ref();
    this.child.channel?.ref();
  }
  release(id: string) {
    if (!this.leases.delete(id)) return;
    if (!this.leases.size) {
      this.idleAt = Date.now();
      this.child.unref();
      this.child.channel?.unref();
    }
  }
  async call(command: string, data: Record<string, unknown> = {}, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.unavailable) throw failure('Network worker is unavailable');
    if (this.inFlight >= this.options.connectionsPerWorker + 16)
      throw failure('Network control queue is full', 'NETWORK_BUSY');
    this.inFlight++;
    try {
      await (signal ? abortable(this.ready, signal) : this.ready);
      signal?.throwIfAborted();
      if (this.unavailable || !this.child.connected) throw failure('Network worker is unavailable');
      if (command === 'qmp')
        data = { ...data, backendId: this.ensureBackend(data.binary), binary: undefined };
      const requestId = randomUUID();
      return await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.fail(failure('Network control request timed out', 'ETIMEDOUT'));
          this.retire();
        }, 10_000);
        const abort = () => {
          this.pending.delete(requestId);
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          reject(signal?.reason);
          if (this.child.connected) this.send({ command: 'cancel-control', targetRequestId: requestId });
        };
        const finish = (settle: (value: any) => void) => (value: any) => {
          signal?.removeEventListener('abort', abort);
          settle(value);
        };
        this.pending.set(requestId, { resolve: finish(resolve), reject: finish(reject), timer });
        signal?.addEventListener('abort', abort, { once: true });
        this.send({ ...data, requestId, command });
      });
    } finally {
      this.inFlight--;
    }
  }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.fail(failure('Network worker is closed'));
    return (this.closeTask = Promise.resolve()
      .then(async () => {
        const timeoutMs = this.dependencies.closeTimeoutMs ?? 5000;
        let kill: NodeJS.Timeout | undefined;
        const terminate = () => {
          if (this.childEnded) return;
          try {
            this.child.kill('SIGKILL');
          } catch (error) {
            this.resource.cleanupPending(error);
          }
        };
        if (!this.childClosed) {
          this.child.ref();
          this.child.channel?.ref();
          kill = setTimeout(terminate, Math.min(1000, timeoutMs / 2));
          if (this.child.connected) this.send({ command: 'close' });
          else terminate();
        }
        try {
          const results = await Promise.allSettled([
            waitForClose(this.stopped, timeoutMs).then((closed) => {
              if (!closed) {
                const error = cleanupFailure();
                this.resource.cleanupPending(error);
                throw error;
              }
            }),
            this.stopBackend(),
          ]);
          const failed = results.find((result) => result.status === 'rejected');
          if (failed?.status === 'rejected') throw failed.reason;
          this.finalize();
        } finally {
          clearTimeout(kill);
        }
      })
      .catch((error) => {
        this.cleanupError = error;
        this.closeTask = undefined;
        throw error;
      }));
  }
}
/** A stream is pinned to one worker. Shrinking only reclaims completely idle workers. */
export class HostNetworkPool {
  private workers = new Set<HostWorker>();
  private sockets = new Map<string, { socket: Socket; worker: HostWorker }>();
  private pins = new Map<string, { worker: HostWorker; failed(error: Error): void }>();
  private closed = false;
  private closeTask?: Promise<void>;
  private timer: NodeJS.Timeout;
  constructor(
    readonly options: PoolOptions,
    private dependencies: PoolDependencies = {},
  ) {
    if (
      dependencies.closeTimeoutMs !== undefined &&
      (!Number.isSafeInteger(dependencies.closeTimeoutMs) ||
        dependencies.closeTimeoutMs < 1 ||
        dependencies.closeTimeoutMs > 2_147_483_647)
    )
      throw new RangeError('Invalid network close timeout');
    this.timer = setInterval(
      () => {
        for (const worker of this.workers)
          if (worker.available && !worker.leases.size && Date.now() - worker.idleAt >= options.idleMs)
            void worker.close().catch(() => {});
      },
      Math.max(50, Math.min(5000, options.idleMs)),
    );
    this.timer.unref();
  }
  private select(id: string) {
    if (this.closed) throw failure('Network pool is closed');
    let worker = [...this.workers]
      .filter((worker) => worker.available)
      .sort((a, b) => a.leases.size - b.leases.size)[0];
    if (
      (!worker || worker.leases.size >= this.options.scaleAt) &&
      this.workers.size < this.options.maxWorkers
    ) {
      const governor = this.dependencies.governor || hostRuntime;
      const resource = governor.tryAcquire({
        owner: this.options.owner || 'core:network',
        kind: 'network.worker',
        label: 'Network Node worker',
        lane: 'background',
        cost: { process: 1, 'network.worker': 1 },
      });
      if (resource)
        try {
          // A VM worker needs both processes. Reserve the pair before forking so the
          // last global slot cannot be stranded in an unusable supervisor.
          const backendReservation = this.options.reserveBackend
            ? governor.tryAcquire({
                owner: this.options.owner || 'core:network',
                kind: 'network.backend',
                label: 'CPU-less network backend',
                lane: 'background',
                cost: { process: 1, 'network.worker': 1 },
              })
            : undefined;
          if (this.options.reserveBackend && !backendReservation) {
            resource.release();
          } else {
            try {
              worker = new HostWorker(
                this.options,
                resource,
                this.dependencies,
                (dead) => {
                  for (const entry of this.sockets.values())
                    if (entry.worker === dead) entry.socket.destroy(failure('Network worker exited'));
                  for (const [key, entry] of this.pins)
                    if (entry.worker === dead) {
                      this.pins.delete(key);
                      dead.release(key);
                      // One owner's failure handler must not prevent other leases being revoked.
                      try {
                        entry.failed(failure('VM network worker exited'));
                      } catch {}
                    }
                },
                (dead) => this.workers.delete(dead),
                backendReservation,
              );
              this.workers.add(worker);
            } catch (error) {
              backendReservation?.release();
              throw error;
            }
          }
        } catch (error) {
          resource.release();
          throw error;
        }
    }
    if (!worker || worker.leases.size >= this.options.connectionsPerWorker)
      throw failure('Network connection limit reached', 'NETWORK_BUSY');
    worker.reserve(id);
    return worker;
  }
  async start() {
    const id = randomUUID(),
      worker = this.select(id);
    try {
      await worker.ready;
    } finally {
      worker.release(id);
    }
  }
  pin(onFailure: (error: Error) => void) {
    const id = randomUUID(),
      worker = this.select(id);
    this.pins.set(id, { worker, failed: onFailure });
    return {
      call: (command: string, data: Record<string, unknown>) =>
        this.pins.has(id)
          ? worker.call(command, data)
          : Promise.reject(failure('Network worker lease is released')),
      release: () => {
        this.pins.delete(id);
        worker.release(id);
      },
      terminate: () => worker.close(),
      resources: () => ({ worker: worker.resource.id, backend: worker.backendResourceId }),
    };
  }
  async dial(destination: Destination, signal?: AbortSignal, timeoutMs = 10_000): Promise<Socket> {
    signal?.throwIfAborted();
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
      throw new RangeError('Invalid network timeout');
    const id = randomUUID(),
      worker = this.select(id);
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(failure('Network connection timed out', 'ETIMEDOUT')),
      Math.ceil(timeoutMs),
    );
    const connectingSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    let socket: Socket | undefined;
    const cancel = () => {
      socket?.destroy();
      void worker.call('cancel', { id }).catch(() => {});
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const ticket = await abortable(worker.call('open', { id, destination, timeoutMs }), connectingSignal);
      connectingSignal.throwIfAborted();
      const port = await worker.ready;
      socket = createConnection({ host: '127.0.0.1', port, allowHalfOpen: true });
      this.sockets.set(id, { socket, worker });
      socket.setNoDelay();
      socket.once('close', () => {
        this.sockets.delete(id);
        worker.release(id);
        signal?.removeEventListener('abort', cancel);
      });
      await new Promise<void>((resolve, reject) => {
        let input = Buffer.alloc(0),
          settled = false;
        const done = (error?: unknown) => {
          if (settled) return;
          settled = true;
          connectingSignal.removeEventListener('abort', aborted);
          socket!.off('data', data);
          socket!.off('error', done);
          socket!.off('close', closed);
          socket!.off('connect', connected);
          error ? reject(error) : resolve();
        };
        const aborted = () => done(connectingSignal.reason);
        const closed = () =>
          done(connectingSignal.aborted ? connectingSignal.reason : failure('Network connection closed'));
        const connected = () => socket!.write(JSON.stringify({ id, token: ticket.token }) + '\n');
        const data = (chunk: Buffer) => {
          input = Buffer.concat([input, chunk]);
          const end = input.indexOf(10);
          if (end > 4096 || (end < 0 && input.length > 4096))
            return done(failure('Invalid network handshake'));
          if (end < 0) return;
          socket!.pause();
          try {
            const message = JSON.parse(input.subarray(0, end).toString());
            if (!message.ok)
              return done(failure(message.error?.message || 'Connection failed', message.error?.code));
            const remaining = input.subarray(end + 1);
            if (remaining.length) socket!.unshift(remaining);
            done();
          } catch {
            done(failure('Invalid network handshake'));
          }
        };
        socket!.on('error', done);
        socket!.once('close', closed);
        socket!.on('data', data);
        socket!.once('connect', connected);
        connectingSignal.addEventListener('abort', aborted, { once: true });
        if (connectingSignal.aborted) aborted();
      });
      connectingSignal.throwIfAborted();
      clearTimeout(timer);
      return socket;
    } catch (error) {
      clearTimeout(timer);
      cancel();
      worker.release(id);
      signal?.removeEventListener('abort', cancel);
      throw error;
    }
  }
  async lookup(hostname: string, options: Record<string, unknown>, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const id = randomUUID(),
      worker = this.select(id);
    try {
      return await worker.call('lookup', { hostname, options }, signal);
    } finally {
      worker.release(id);
    }
  }
  snapshot() {
    return [...this.workers].map((worker) => ({
      pid: worker.child.pid,
      backendPid: worker.backendPid,
      resourceId: worker.resource.id,
      backendResourceId: worker.backendResourceId,
      state: worker.cleanupError ? 'cleanup-pending' : worker.available ? 'active' : 'closing',
      cleanupError: worker.cleanupError?.message,
      connections: worker.leases.size,
    }));
  }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    return (this.closeTask = (async () => {
      this.closed = true;
      clearInterval(this.timer);
      for (const { socket } of this.sockets.values()) socket.destroy();
      const results = await Promise.allSettled([...this.workers].map((worker) => worker.close()));
      const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
      if (errors.length) throw cleanupFailure();
    })().catch((error) => {
      this.closeTask = undefined;
      throw error;
    }));
  }
  /** Retries only this pool's retained original ChildProcess handles, never a supplied PID. */
  async retryCleanup(resourceId: string) {
    const worker = [...this.workers].find(
      (worker) => worker.resource.id === resourceId || worker.backendResourceId === resourceId,
    );
    if (!worker) throw failure('Unknown network resource', 'NETWORK_RESOURCE_NOT_FOUND');
    await worker.close();
  }
}
