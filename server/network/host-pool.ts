import { fork, type ChildProcess } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../paths.ts';

export type Destination = { host: string; port: number; family?: number };
export type PoolOptions = {
  maxWorkers: number;
  connectionsPerWorker: number;
  scaleAt: number;
  idleMs: number;
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
  idleAt = Date.now();
  backendPid?: number;
  get available() {
    return !this.unavailable;
  }
  constructor(
    readonly options: PoolOptions,
    private onExit: (worker: HostWorker) => void,
  ) {
    const source = join(ROOT, 'server/network/worker.mjs');
    const file = existsSync(source) ? source : join(ROOT, '.sakura-server/assets/network-worker.mjs');
    this.child = fork(file, [], {
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
    // Eagerly warmed workers may fail before any consumer starts awaiting readiness.
    void this.ready.catch(() => {});
    const startupTimer = setTimeout(() => {
      this.fail(failure('Network worker startup timed out'));
      void this.close();
    }, 10_000);
    this.child.on('message', (message: any) => {
      if (!message || typeof message !== 'object') return;
      if (message.event === 'ready') {
        if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
          this.fail(failure('Invalid network worker endpoint'));
          void this.close();
          return;
        }
        clearTimeout(startupTimer);
        resolveReady(message.port);
      } else if (message.event === 'backend') {
        this.backendPid = Number.isInteger(message.pid) && message.pid > 0 ? message.pid : undefined;
      } else if (message.requestId) {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(failure(message.error.message, message.error.code));
        else pending.resolve(message.value);
      }
    });
    this.stopped = new Promise((resolve) => {
      // 'close' also occurs after a spawn error, for which 'exit' need not occur.
      this.child.once('close', () => {
        clearTimeout(startupTimer);
        this.fail(failure('Network worker exited'));
        // Reap a backend even when its Node supervisor was terminated abruptly.
        if (this.backendPid) {
          try {
            process.kill(this.backendPid, 'SIGKILL');
          } catch {}
          this.backendPid = undefined;
        }
        try {
          this.onExit(this);
        } finally {
          resolve();
        }
      });
    });
    this.child.on('error', (error) => {
      clearTimeout(startupTimer);
      this.fail(error);
      void this.close();
    });
    this.child.once('disconnect', () => {
      this.fail(failure('Network worker disconnected'));
      void this.close();
    });
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
    // Bound work queued during startup as well as requests already sent over IPC.
    if (this.inFlight >= this.options.connectionsPerWorker + 16)
      throw failure('Network control queue is full', 'NETWORK_BUSY');
    this.inFlight++;
    try {
      await (signal ? abortable(this.ready, signal) : this.ready);
      signal?.throwIfAborted();
      if (this.unavailable || !this.child.connected) throw failure('Network worker is unavailable');
      const requestId = randomUUID();
      return await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          // A timed-out mutation may already have executed. Discard this worker's
          // state instead of allowing subsequent requests to rely on an unknown result.
          this.fail(failure('Network control request timed out', 'ETIMEDOUT'));
          void this.close();
        }, 10_000);
        const abort = () => {
          this.pending.delete(requestId);
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          reject(signal?.reason);
          if (this.child.connected) {
            try {
              this.child.send({ command: 'cancel-control', targetRequestId: requestId }, () => {});
            } catch {}
          }
        };
        const finish = (settle: (value: any) => void) => (value: any) => {
          signal?.removeEventListener('abort', abort);
          settle(value);
        };
        this.pending.set(requestId, { resolve: finish(resolve), reject: finish(reject), timer });
        signal?.addEventListener('abort', abort, { once: true });
        const sent = (error: Error | null) => {
          if (!error) return;
          this.fail(error);
          void this.close();
        };
        try {
          this.child.send({ ...data, requestId, command }, sent);
        } catch (error) {
          sent(error as Error);
        }
      });
    } finally {
      this.inFlight--;
    }
  }
  close(): Promise<void> {
    return (this.closeTask ||= (async () => {
      this.fail(failure('Network worker is closed'));
      // Keep cleanup alive even if the final lease was just released.
      this.child.ref();
      this.child.channel?.ref();
      const kill = setTimeout(() => {
        try {
          this.child.kill('SIGKILL');
        } catch {}
      }, 2500);
      try {
        if (this.child.connected) {
          try {
            this.child.send({ command: 'close' }, (error) => {
              if (error) this.child.kill('SIGKILL');
            });
          } catch {
            this.child.kill('SIGKILL');
          }
        } else this.child.kill('SIGKILL');
        await this.stopped;
      } finally {
        clearTimeout(kill);
      }
    })());
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
  constructor(readonly options: PoolOptions) {
    this.timer = setInterval(
      () => {
        for (const worker of this.workers)
          if (worker.available && !worker.leases.size && Date.now() - worker.idleAt >= options.idleMs)
            void worker.close();
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
      worker = new HostWorker(this.options, (dead) => {
        this.workers.delete(dead);
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
      });
      this.workers.add(worker);
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
      connections: worker.leases.size,
    }));
  }
  close(): Promise<void> {
    return (this.closeTask ||= (async () => {
      this.closed = true;
      clearInterval(this.timer);
      for (const { socket } of this.sockets.values()) socket.destroy();
      await Promise.all([...this.workers].map((worker) => worker.close()));
      this.workers.clear();
    })());
  }
}
