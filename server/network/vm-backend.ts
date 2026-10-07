/**
 * 模块职责：连接虚拟机网络后端并分配端口，将客户机网络资源纳入统一租约关闭流程。
 */
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { HostNetworkPool } from './host-pool.ts';
import { ROOT } from '../paths.ts';

export type VmNetworkOptions = {
  vmId: string;
  generation: string;
  isolated: boolean;
  ipv6?: boolean;
  sshPort: number;
  forwards: { host: number; guest: number }[];
  managementPorts?: { qmp: number; serial: number; agent: number };
  onFailure(error: Error): void;
};
export type VmNetworkLease = {
  readonly vmId: string;
  readonly generation: string;
  readonly netdev: string;
  readonly policy: Readonly<{
    isolated: boolean;
    ipv6: boolean;
    forwards: readonly { host: number; guest: number }[];
  }>;
  readonly signal: AbortSignal;
  readonly connected: boolean;
  readonly resources?: Readonly<{ worker: string; backend?: string }>;
  setConnected(connected: boolean): Promise<void>;
  forward(verb: 'add' | 'remove', port: { host: number; guest: number }): Promise<void>;
  renew(generation: string): Promise<VmNetworkLease>;
  close(): Promise<void>;
};
// QEMU binds after this probe and validates the actual bind itself. A competing bind
// is a startup failure, never permission to choose an unmanaged network backend.
export async function availablePort() {
  const server = createServer();
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** QEMU is used as a CPU-less libslirp host, with a separate hub for each VM. */
export class VmNetworkBackend {
  private leases = new Map<string, VmNetworkLease>();
  private nextHub = 0;
  private closed = false;
  constructor(readonly pool: HostNetworkPool) {}
  async attach(options: VmNetworkOptions): Promise<VmNetworkLease> {
    if (this.closed) throw new Error('VM network backend is closed');
    if (this.leases.has(options.vmId)) throw new Error('VM already has a network attachment');
    let abort = new AbortController();
    let workerFailed = false;
    const pin = this.pool.pin((error) => {
      workerFailed = true;
      abort.abort(error);
      options.onFailure(error);
    });
    const id = 'n' + randomUUID().replaceAll('-', '');
    const hubid = ++this.nextHub;
    const binary = join(
      process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu'),
      `qemu-system-x86_64${process.platform === 'win32' ? '.exe' : ''}`,
    );
    const command = (execute: string, args: Record<string, unknown>) =>
      pin.call('qmp', { binary, execute, args });
    const added = new Set<string>();
    let forwards = [{ host: options.sshPort, guest: 22 }, ...options.forwards].map((p) => ({ ...p }));
    let netdev = '';
    const userConfig = () => ({
      type: 'user',
      id: id + 'u',
      ipv4: true,
      ipv6: !options.isolated && options.ipv6 !== false,
      net: '10.0.2.0/24',
      host: '10.0.2.2',
      dns: '10.0.2.3',
      restrict: options.isolated,
      hostfwd: forwards.map((p) => ({ str: `tcp:127.0.0.1:${p.host}-:${p.guest}` })),
    });
    const add = async (config: Record<string, unknown> & { id: string }) => {
      await command('netdev_add', config);
      added.add(config.id);
    };
    const remove = async (name: string) => {
      await command('netdev_del', { id: name });
      added.delete(name);
    };
    let tail: Promise<unknown> = Promise.resolve();
    const serial = <T>(work: () => Promise<T>): Promise<T> => {
      const result = tail.then(work);
      tail = result.catch(() => {});
      return result;
    };
    const makeLease = (generation: string): VmNetworkLease => {
      const epoch = abort;
      let closeTask: Promise<void> | undefined;
      const lease: VmNetworkLease = {
        vmId: options.vmId,
        generation,
        get resources() {
          return pin.resources();
        },
        get netdev() {
          return netdev;
        },
        signal: epoch.signal,
        get connected() {
          return added.has(id + 'hs');
        },
        setConnected: (connected) =>
          serial(async () => {
            epoch.signal.throwIfAborted();
            if (connected === added.has(id + 'hs')) return;
            try {
              if (connected) await add({ type: 'hubport', id: id + 'hs', hubid, netdev: id + 's' });
              else await remove(id + 'hs');
            } catch (cause) {
              const error = new Error('VM network link transition failed', { cause });
              abort.abort(error);
              options.onFailure(error);
              throw error;
            }
          }),
        get policy() {
          return Object.freeze({
            isolated: options.isolated,
            ipv6: !options.isolated && options.ipv6 !== false,
            forwards: Object.freeze(forwards.map((p) => Object.freeze({ ...p }))),
          });
        },
        forward: (verb, port) =>
          serial(async () => {
            epoch.signal.throwIfAborted();
            if (
              ![port.host, port.guest].every(
                (value) => Number.isInteger(value) && value > 0 && value <= 65535,
              )
            )
              throw new Error('Invalid forwarding port');
            const result = await command('human-monitor-command', {
              'command-line':
                verb === 'add'
                  ? `hostfwd_add ${id}u tcp:127.0.0.1:${port.host}-:${port.guest}`
                  : `hostfwd_remove ${id}u tcp:127.0.0.1:${port.host}`,
            });
            if (typeof result === 'string' && /could not|error|invalid|not found/i.test(result))
              throw new Error(result.trim());
            forwards =
              verb === 'add' ? [...forwards, { ...port }] : forwards.filter((p) => p.host !== port.host);
          }),
        renew: (generation) =>
          serial(async () => {
            epoch.signal.throwIfAborted();
            if (!generation || generation === lease.generation)
              throw new Error('A new VM generation is required');
            epoch.abort(new Error('VM network generation replaced'));
            abort = new AbortController();
            try {
              // Keep the stream and its current hub attachment state, but discard old flows.
              await remove(id + 'hu');
              await remove(id + 'u');
              await add(userConfig());
              await add({ type: 'hubport', id: id + 'hu', hubid, netdev: id + 'u' });
              abort.signal.throwIfAborted();
              const next = makeLease(generation);
              this.leases.set(options.vmId, next);
              return next;
            } catch (cause) {
              const error = new Error('VM network generation renewal failed', { cause });
              abort.abort(error);
              options.onFailure(error);
              throw error;
            }
          }),
        close: () => {
          // Releasing a stale capability cannot tear down the newer generation.
          if (this.leases.get(options.vmId) !== lease) return Promise.resolve();
          return (closeTask ||= serial(async () => {
            // A renewal may have completed while this close waited in the queue.
            if (this.leases.get(options.vmId) !== lease) return;
            epoch.abort(new Error('VM network lease released'));
            this.leases.delete(options.vmId);
            const errors: unknown[] = [];
            if (!workerFailed)
              for (const name of [...added].reverse())
                await remove(name).catch((error) => errors.push(error));
            pin.release();
            if (errors.length) {
              await pin.terminate();
              throw new AggregateError(errors, 'VM network cleanup failed');
            }
          }));
        },
      };
      return lease;
    };
    const lease = makeLease(options.generation);
    this.leases.set(options.vmId, lease);
    try {
      return await serial(async () => {
        const port = await availablePort();
        for (const config of [
          userConfig(),
          {
            type: 'stream',
            id: id + 's',
            server: true,
            addr: { type: 'inet', host: '127.0.0.1', port: String(port) },
          },
          { type: 'hubport', id: id + 'hu', hubid, netdev: id + 'u' },
          { type: 'hubport', id: id + 'hs', hubid, netdev: id + 's' },
        ]) {
          await add(config);
        }
        netdev = `stream,id=sakura-net,server=off,addr.type=inet,addr.host=127.0.0.1,addr.port=${port}`;
        abort.signal.throwIfAborted();
        return lease;
      });
    } catch (error) {
      await lease.close().catch(() => {});
      throw error;
    }
  }
  snapshot() {
    return [...this.leases.values()].map(({ vmId, generation, policy, connected, resources }) => ({
      vmId,
      generation,
      policy,
      connected,
      resources,
    }));
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.leases.values()].map((lease) => lease.close()));
    await this.pool.close();
  }
}
