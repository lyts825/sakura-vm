import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { Server } from 'node:net';
import { AppError } from '../shared/errors.ts';
import { hostRuntime, type ResourceLease } from './host-runtime/index.ts';
import { NetworkRuntime, NetworkScope } from './network/index.ts';

/** Kernel-owned local endpoint, released even after an ungraceful host exit.
 * A separate lifetime of the same network layer keeps directory ownership until
 * domain cleanup has finished; draining ordinary transports cannot drop this lock.
 */
export class DataDirectoryOwner {
  readonly directory: string;
  private readonly network = new NetworkRuntime();
  private readonly scope = new NetworkScope({ owner: 'core:data-directory', purpose: 'host-ownership' }, this.network);
  private server?: Server;
  private lease?: ResourceLease;
  private closeTask?: Promise<void>;
  private constructor(directory: string) { this.directory = directory; }
  get resourceId() { return this.lease?.id; }

  static async acquire(directory: string, options: { create?: boolean } = {}): Promise<DataDirectoryOwner> {
    const absolute = resolve(directory);
    if (options.create !== false) await mkdir(absolute, { recursive: true });
    // A migration reserves its future destination without creating it before
    // atomic publication. Resolve the existing ancestor so aliases still agree.
    let ancestor = absolute;
    const suffix: string[] = [];
    let canonical: string;
    for (;;) {
      try { canonical = resolve(await realpath(ancestor), ...suffix); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;
        suffix.unshift(basename(ancestor)); ancestor = dirname(ancestor);
      }
    }
    const owner = new DataDirectoryOwner(canonical);
    const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    const hash = createHash('sha256').update(key).digest('hex');
    const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\sakura-data-${hash}`
      : process.platform === 'linux' ? `\0sakura-data-${hash}` : undefined;
    try {
      const server = owner.server = owner.scope.createServer(socket => socket.destroy());
      await new Promise<void>((done, reject) => {
        const error = (cause: Error) => reject(cause);
        server.once('error', error);
        const ready = () => { server.off('error', error); done(); };
        if (endpoint) server.listen({ path: endpoint, readableAll: false, writableAll: false }, ready);
        // Other hosts use a stable loopback reservation. A hash/port collision
        // fails closed; another endpoint is never selected to bypass ownership.
        else server.listen({ host: '127.0.0.1', port: 20000 + Number.parseInt(hash.slice(0, 8), 16) % 30000, exclusive: true }, ready);
      });
      owner.lease = hostRuntime.register({ owner: 'core:data-directory', kind: 'metadata.owner',
        label: '数据目录宿主归属', lane: 'control' });
      return owner;
    } catch (cause) {
      await owner.close();
      if ((cause as NodeJS.ErrnoException).code === 'EADDRINUSE')
        throw new AppError('该数据目录已由另一宿主管理，或其本地归属通道被占用', 409, 'DATA_DIRECTORY_IN_USE');
      throw cause;
    }
  }

  close(): Promise<void> {
    return this.closeTask ||= (async () => {
      if (this.server) await this.network.closeServer(this.server);
      await this.scope.close();
      await this.network.close();
      this.lease?.release();
    })().catch(error => { this.lease?.cleanupPending(error); this.closeTask = undefined; throw error; });
  }
}
