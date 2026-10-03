import { randomUUID } from 'node:crypto';
import { createConnection, createServer, type Socket, type Server, type NetConnectOpts } from 'node:net';
import { HostNetworkPool, type Destination } from './host-pool.ts';
import { VmNetworkBackend, type VmNetworkOptions, type VmNetworkLease } from './vm-backend.ts';

export type NetworkIdentity = Readonly<{
  owner: string;
  purpose: string;
  vmId?: string;
  generation?: string;
  projectId?: string;
}>;
export type NetworkOperation = 'dial' | 'listen' | 'lookup' | 'vm' | 'accept' | 'native';
type Lease = NetworkIdentity & {
  id: string;
  kind: NetworkOperation;
  lane: 'data' | 'management';
  startedAt: string;
  close(): void;
};
export type NetworkOptions = {
  maxWorkers: number;
  maxVmWorkers: number;
  connectionsPerWorker: number;
  scaleAt: number;
  idleMs: number;
  maxOwnerConnections: number;
  maxListeners: number;
  maxInboundConnections: number;
  authorize?: (identity: NetworkIdentity, operation: NetworkOperation, destination?: Destination) => void;
};
function setting(name: string, fallback: number, max: number) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
export const networkDefaults = (): NetworkOptions => ({
  maxWorkers: setting('SAKURA_NETWORK_WORKERS', 4, 16),
  maxVmWorkers: setting('SAKURA_NETWORK_VM_WORKERS', 2, 8),
  connectionsPerWorker: setting('SAKURA_NETWORK_CONNECTIONS', 128, 1024),
  scaleAt: setting('SAKURA_NETWORK_SCALE_AT', 32, 1024),
  idleMs: setting('SAKURA_NETWORK_IDLE_MS', 30_000, 600_000),
  maxOwnerConnections: 256,
  maxListeners: 128,
  maxInboundConnections: 1024,
});
const unavailable = (message: string, code = 'NETWORK_UNAVAILABLE') =>
  Object.assign(new Error(message), { code });

/** Required infrastructure. It intentionally knows nothing about Machines or optional plugins. */
export class NetworkRuntime {
  readonly host: HostNetworkPool;
  readonly vm: VmNetworkBackend;
  private leases = new Map<string, Lease>();
  private disposers = new Set<() => void | Promise<void>>();
  private servers = new WeakMap<Server, (done?: () => void) => void>();
  private vmControl = new Map<number, { identity: NetworkIdentity; signal: AbortSignal }>();
  private pendingVmControl = new Set<number>();
  private draining = false;
  private closed = false;
  private closeTask?: Promise<void>;
  constructor(readonly options: NetworkOptions = networkDefaults()) {
    for (const name of [
      'maxWorkers',
      'maxVmWorkers',
      'connectionsPerWorker',
      'scaleAt',
      'idleMs',
      'maxOwnerConnections',
      'maxListeners',
      'maxInboundConnections',
    ] as const)
      if (!Number.isSafeInteger(options[name]) || options[name] < 1)
        throw new Error(`Invalid network limit: ${name}`);
    if (options.scaleAt > options.connectionsPerWorker)
      throw new Error('Network scale threshold exceeds connection capacity');
    this.host = new HostNetworkPool({ ...options, owner: 'core:network-host' });
    this.vm = new VmNetworkBackend(
      new HostNetworkPool({
        maxWorkers: options.maxVmWorkers,
        connectionsPerWorker: 4,
        scaleAt: 1,
        idleMs: options.idleMs,
        owner: 'core:network-vm',
        reserveBackend: true,
      }),
    );
  }
  async start() {
    this.check({ owner: 'core', purpose: 'startup' }, 'dial');
    await this.host.start();
  }
  check(
    identity: NetworkIdentity,
    operation: NetworkOperation,
    destination?: Destination,
    management = false,
  ) {
    if (this.closed || (this.draining && !management)) throw unavailable('Network is shutting down');
    if (!identity.owner || !identity.purpose) throw unavailable('Network owner and purpose are required');
    if (
      destination &&
      (!destination.host ||
        destination.host.length > 253 ||
        !Number.isInteger(destination.port) ||
        destination.port < 1 ||
        destination.port > 65535)
    )
      throw unavailable('Invalid network destination');
    this.options.authorize?.(identity, operation, destination);
  }
  private admit(identity: NetworkIdentity, kind: NetworkOperation, close: () => void, management = false) {
    this.check(identity, kind, undefined, management);
    const lane = management ? 'management' : 'data';
    const owned = [...this.leases.values()].filter(
      (lease) => lease.owner === identity.owner && lease.kind === kind && lease.lane === lane,
    );
    const limit =
      kind === 'listen' ? this.options.maxListeners : management ? 128 : this.options.maxOwnerConnections;
    if (
      owned.length >= limit ||
      (kind === 'listen' &&
        [...this.leases.values()].filter((lease) => lease.kind === kind).length >=
          this.options.maxListeners) ||
      (kind === 'accept' &&
        [...this.leases.values()].filter((lease) => lease.kind === kind).length >=
          this.options.maxInboundConnections)
    )
      throw unavailable('Network owner resource limit reached', 'NETWORK_BUSY');
    const id = randomUUID();
    this.leases.set(id, { ...identity, id, kind, lane, startedAt: new Date().toISOString(), close });
    return () => this.leases.delete(id);
  }
  async dial(
    identity: NetworkIdentity,
    destination: Destination,
    signal?: AbortSignal,
    timeoutMs?: number,
    management = false,
  ) {
    this.check(identity, 'dial', destination, management);
    signal?.throwIfAborted();
    if (
      timeoutMs !== undefined &&
      (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    )
      throw unavailable('Invalid network connection timeout');
    // connectLocal owns the management lease itself. Do not count this lane twice.
    if (management) return this.managementSocket(identity, destination, signal, timeoutMs);
    const abort = new AbortController();
    const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    const release = this.admit(identity, 'dial', () => abort.abort(), management);
    try {
      const socket = await this.host.dial(destination, combined, timeoutMs);
      socket.once('close', release);
      return socket;
    } catch (error) {
      release();
      throw error;
    }
  }
  private async managementSocket(
    identity: NetworkIdentity,
    destination: Destination,
    signal?: AbortSignal,
    timeoutMs = 10_000,
  ) {
    signal?.throwIfAborted();
    const socket = this.connectLocal(identity, destination);
    const abort = () => socket.destroy();
    signal?.addEventListener('abort', abort, { once: true });
    socket.once('close', () => signal?.removeEventListener('abort', abort));
    try {
      await new Promise<void>((resolve, reject) => {
        const done = (error?: Error) => {
          clearTimeout(timer);
          socket.off('error', done);
          socket.off('close', closed);
          socket.off('connect', connected);
          error ? reject(error) : resolve();
        };
        const closed = () =>
          done(signal?.aborted ? signal.reason : unavailable('Management connection closed'));
        const connected = () => done();
        const timer = setTimeout(
          () => done(unavailable('Management connection timed out', 'ETIMEDOUT')),
          timeoutMs,
        );
        socket.once('connect', connected);
        socket.once('error', done);
        socket.once('close', closed);
      });
      signal?.throwIfAborted();
      return socket;
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }
  /** Only local management/IPC uses the in-process lane, which stays open while VMs stop. */
  connectLocal(identity: NetworkIdentity, options: NetConnectOpts) {
    if (
      !options ||
      typeof options !== 'object' ||
      ('host' in options && options.host && !['127.0.0.1', '::1', 'localhost'].includes(options.host)) ||
      ('lookup' in options && options.lookup)
    )
      throw unavailable('Management connections must be local');
    // Resolve localhost ourselves. A caller-provided resolver or a hosts-file entry
    // must never turn the trusted shutdown lane into an external connection.
    if ('port' in options) {
      if ('path' in options && options.path)
        throw unavailable('Management TCP connections cannot specify an IPC path');
      options = { ...options, host: options.host === '::1' ? '::1' : '127.0.0.1' };
    } else if (
      typeof options.path !== 'string' ||
      !options.path ||
      (process.platform === 'win32' && !/^\\\\[.?]\\pipe\\/i.test(options.path))
    ) {
      throw unavailable('Management IPC connections must use a local pipe');
    }
    if ('port' in options && this.pendingVmControl.has(Number(options.port)))
      throw unavailable('VM management attachment is not ready');
    const vm = 'port' in options ? this.vmControl.get(Number(options.port)) : undefined;
    if (
      vm &&
      ((identity.vmId && identity.vmId !== vm.identity.vmId) ||
        (identity.generation && identity.generation !== vm.identity.generation))
    )
      throw unavailable('VM management generation no longer matches');
    if (vm) identity = { ...identity, ...vm.identity, owner: identity.owner };
    if ('port' in options)
      this.check(identity, 'dial', { host: options.host!, port: Number(options.port) }, true);
    let socket: Socket;
    const release = this.admit(identity, 'dial', () => socket?.destroy(), true);
    try {
      vm?.signal.throwIfAborted();
      socket = createConnection(options);
      const revoke = () => socket.destroy();
      vm?.signal.addEventListener('abort', revoke, { once: true });
      socket.once('close', () => {
        release();
        vm?.signal.removeEventListener('abort', revoke);
      });
      return socket;
    } catch (error) {
      release();
      throw error;
    }
  }
  manageServer<T extends Server>(identity: NetworkIdentity, server: T, signal?: AbortSignal): T {
    if (this.servers.has(server)) throw unavailable('Server is already managed');
    signal?.throwIfAborted();
    const sockets = new Set<Socket>();
    const close = (done?: () => void) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => done?.());
    };
    const onAbort = () => close();
    let release: (() => void) | undefined = this.admit(identity, 'listen', close);
    const releaseListener = () => {
      release?.();
      release = undefined;
      signal?.removeEventListener('abort', onAbort);
    };
    this.servers.set(server, close);
    const listen = server.listen.bind(server);
    (server as Server).listen = ((...args: any[]) => {
      signal?.throwIfAborted();
      this.check(identity, 'listen');
      release ||= this.admit(identity, 'listen', close);
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        return listen(...(args as Parameters<Server['listen']>));
      } catch (error) {
        if (!server.listening) releaseListener();
        throw error;
      }
    }) as Server['listen'];
    server.maxConnections = Math.min(server.maxConnections ?? 256, 256);
    server.prependListener('connection', (socket: Socket) => {
      if (this.closed || signal?.aborted) return socket.destroy();
      let accepted: () => void;
      try {
        accepted = this.admit(identity, 'accept', () => socket.destroy());
      } catch {
        socket.destroy();
        return;
      }
      sockets.add(socket);
      socket.once('close', () => {
        accepted();
        sockets.delete(socket);
      });
    });
    server.on('close', releaseListener);
    // A failed bind never produces 'close' unless explicitly closed by the owner.
    server.on('error', () => {
      if (!server.listening) releaseListener();
    });
    // Keep the abort subscription across close/listen cycles.
    signal?.addEventListener('abort', onAbort, { once: true });
    return server;
  }
  closeServer(server: Server) {
    const close = this.servers.get(server);
    return new Promise<void>((resolve) => {
      if (close) close(resolve);
      else server.close(() => resolve());
    });
  }
  /** Native local adapters retain OS peer attestation; the core owns their admission and cancellation. */
  nativeLease(identity: NetworkIdentity, cancel: () => void) {
    return this.admit(identity, 'native', cancel, true);
  }
  async lookup(
    identity: NetworkIdentity,
    hostname: string,
    options: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    this.check(identity, 'lookup');
    signal?.throwIfAborted();
    if (typeof hostname !== 'string' || !hostname || hostname.length > 253)
      throw unavailable('Invalid DNS hostname');
    const abort = new AbortController();
    const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    const release = this.admit(identity, 'lookup', () => abort.abort());
    try {
      return await this.host.lookup(hostname, options, combined);
    } finally {
      release();
    }
  }
  async attachVm(options: VmNetworkOptions) {
    this.check(
      {
        owner: 'vm:' + options.vmId,
        purpose: 'user-network',
        vmId: options.vmId,
        generation: options.generation,
      },
      'vm',
    );
    const ports = Object.entries(options.managementPorts || {});
    const numbers = ports.map(([, port]) => port);
    if (
      numbers.some((port) => !Number.isInteger(port) || port < 1 || port > 65535) ||
      new Set(numbers).size !== numbers.length
    )
      throw unavailable('Invalid VM management ports');
    if (numbers.some((port) => this.vmControl.has(port) || this.pendingVmControl.has(port)))
      throw unavailable('VM management port is already owned');
    for (const port of numbers) this.pendingVmControl.add(port);
    const track = (lease: VmNetworkLease): VmNetworkLease => {
      for (const [purpose, port] of ports)
        this.vmControl.set(port, {
          signal: lease.signal,
          identity: {
            owner: 'vm:' + options.vmId,
            purpose,
            vmId: options.vmId,
            generation: lease.generation,
          },
        });
      // Retain revoked entries until teardown or replacement. Removing one during
      // renew would briefly admit an untagged connection to the old VM generation.
      return {
        vmId: lease.vmId,
        generation: lease.generation,
        get netdev() {
          return lease.netdev;
        },
        signal: lease.signal,
        get resources() {
          return lease.resources;
        },
        get connected() {
          return lease.connected;
        },
        setConnected: lease.setConnected,
        get policy() {
          return lease.policy;
        },
        forward: lease.forward,
        close: async () => {
          await lease.close();
          for (const [, port] of ports)
            if (this.vmControl.get(port)?.signal === lease.signal) this.vmControl.delete(port);
        },
        renew: async (generation) => track(await lease.renew(generation)),
      };
    };
    try {
      return track(await this.vm.attach(options));
    } finally {
      for (const port of numbers) this.pendingVmControl.delete(port);
    }
  }
  own(dispose: () => void | Promise<void>) {
    if (this.closed) throw unavailable('Network is shut down');
    this.disposers.add(dispose);
    return () => this.disposers.delete(dispose);
  }
  beginDrain() {
    this.draining = true;
  }
  snapshot() {
    return {
      state: this.closed ? 'closed' : this.draining ? 'draining' : 'running',
      limits: { ...this.options, authorize: undefined },
      // Node workers and CPU-less backends share the host's global process/network budgets.
      maxChildProcesses: this.options.maxWorkers + 2 * this.options.maxVmWorkers,
      hostWorkers: this.host.snapshot(),
      vmWorkers: this.vm.pool.snapshot(),
      vms: this.vm.snapshot(),
      managementListeners: [...this.vmControl].map(([port, { identity }]) => ({ port, ...identity })),
      leases: [...this.leases.values()].map(({ close: _close, ...lease }) => lease),
    };
  }
  close() {
    return (this.closeTask ||= (async () => {
      this.draining = true;
      this.closed = true;
      const errors: unknown[] = [];
      for (const lease of this.leases.values()) {
        try {
          lease.close();
        } catch (error) {
          errors.push(error);
        }
      }
      this.leases.clear();
      const disposed = await Promise.allSettled([...this.disposers].map(async (dispose) => dispose()));
      this.disposers.clear();
      const closed = await Promise.allSettled([this.vm.close(), this.host.close()]);
      this.vmControl.clear();
      for (const result of [...disposed, ...closed])
        if (result.status === 'rejected') errors.push(result.reason);
      if (errors.length) throw new AggregateError(errors, 'Network cleanup failed');
    })().catch((error) => {
      this.closeTask = undefined;
      throw error;
    }));
  }
}

export const networkRuntime = new NetworkRuntime();

// A reservation probe is also registered with the core, without consuming a data worker.
export async function reserveAvailablePort(identity: NetworkIdentity) {
  const server = networkRuntime.manageServer(identity, createServer());
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
