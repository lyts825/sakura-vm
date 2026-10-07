/**
 * 模块职责：管理实例 SSH 连接、命令、输入和文件传输，操作受实例状态及原运行身份限制。
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, type BaseAgent, type ClientCallback, type ExecOptions, type SFTPWrapper } from 'ssh2';
import { AppError } from '../shared/errors.ts';
import type { Machines } from './machines.ts';
import { networkRuntime } from './network/index.ts';
import { vmDir } from './paths.ts';
import type { Project } from './project-config.ts';
import { projectNetworkCommand } from './project-network-isolation.ts';
import type { Live } from './vm-state.ts';

/** Stateless transport; the facade retains VM identities, locks and client ownership. */
export class MachineTransport {
  constructor(private host: Pick<Machines, 'live' | 'requireUnlocked' | 'connect'> & { closing?: boolean }) {}
  async connect(id: string, timeout = 10000, signal?: AbortSignal, agentPath?: string | BaseAgent) {
    this.host.requireUnlocked(id);
    const live = this.host.live.get(id);
    if (!live || live.status === 'stopping' || live.status === 'paused')
      throw new AppError(live?.status === 'paused' ? '发行版已暂停，请先恢复' : '请先启动该发行版', 409);
    const deadline = performance.now() + timeout;
    const key = await readFile(join(vmDir(id), 'id_rsa'));
    for (let attempt = 0; ; attempt++) {
      this.host.requireUnlocked(id);
      signal?.throwIfAborted();
      if (this.host.live.get(id) !== live || this.host.live.get(id)?.status === 'stopping')
        throw new AppError('发行版已停止', 409);
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new Error('SSH connection timed out');
      try {
        // Leave room for a fresh handshake when a restored guest drops the first
        // connection. No command has been submitted until connect() returns.
        return await this.connectOnce(live, key, Math.min(remaining, 5000), signal, agentPath);
      } catch (error) {
        // An interrupted clone rekey may have updated the guest before the host
        // key file. Recover using the pending key without replaying commands.
        if (
          (error as Error).message.includes('authentication') &&
          existsSync(join(vmDir(id), 'identity.json'))
        ) {
          const pending = JSON.parse(await readFile(join(vmDir(id), 'identity.json'), 'utf8'));
          signal?.throwIfAborted();
          if (this.host.live.get(id) !== live || this.host.live.get(id)?.status === 'stopping')
            throw new AppError('发行版已停止', 409);
          return this.connectOnce(
            live,
            Buffer.from(pending.privateText),
            Math.max(1, deadline - performance.now()),
            signal,
            agentPath,
          );
        }
        // QEMU/sshd can refuse or reset an admission during boot or RAM restore.
        // Retry only connection establishment, never commands or authentication
        // rejection, and keep every attempt inside the caller's deadline.
        const wait = 100 * 2 ** attempt;
        const transient = ['ECONNREFUSED', 'ECONNRESET'].includes((error as NodeJS.ErrnoException).code || '') ||
          ['Connection lost before handshake', 'SSH connection timed out', 'Timed out while waiting for handshake']
            .includes((error as Error).message);
        if (
          !transient ||
          attempt >= 3 ||
          deadline - performance.now() <= wait
        )
          throw error;
        await delay(wait, undefined, { signal });
      }
    }
  }
  async connectOnce(
    live: Live,
    key: Buffer,
    timeout: number,
    signal?: AbortSignal,
    agentPath?: string | BaseAgent,
  ) {
    signal?.throwIfAborted();
    const started = performance.now();
    const transportSignal = AbortSignal.any([...(signal ? [signal] : []),
      ...(live.network ? [live.network.signal] : []), ...(live.abort ? [live.abort.signal] : [])]);
    const socket = await networkRuntime.dial({ owner: 'core:vm-transport', purpose: this.host.closing ? 'vm-shutdown' : 'vm-session',
      ...(live.network ? { vmId: live.network.vmId, generation: live.network.generation } : {}) },
      { host: '127.0.0.1', port: live.sshPort }, transportSignal, timeout, !!this.host.closing);
    timeout = Math.max(1, timeout - (performance.now() - started));
    return new Promise<Client>((resolve, reject) => {
      const client = new Client();
      client.once('close', () => socket.destroy());
      const abort = () => client.destroy();
      const timer = setTimeout(() => {
        reject(new Error('SSH connection timed out'));
        client.destroy();
      }, timeout);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      };
      live.clients.add(client);
      signal?.addEventListener('abort', abort, { once: true });
      client.once('ready', () => {
        cleanup();
        resolve(client);
      });
      client.on('error', (error) => {
        cleanup();
        reject(error);
        client.end();
      });
      client.once('close', () => {
        cleanup();
        live.clients.delete(client);
        reject(new Error('SSH connection closed'));
      });
      try {
        client.connect({
          sock: socket,
          username: 'root',
          privateKey: key,
          readyTimeout: timeout,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
          ...(agentPath
            ? {
                agent: agentPath,
                agentForward: true,
                // Forwarded task credentials never authenticate the VM's root login.
                ...(typeof agentPath === 'string' ? {} : { authHandler: ['publickey'] }),
              }
            : {}),
        });
        socket.resume();
      } catch (error) {
        cleanup();
        live.clients.delete(client);
        client.destroy();
        socket.destroy();
        reject(error);
      }
    });
  }
  async exec(
    id: string,
    command: string,
    timeout = 30000,
    signal?: AbortSignal,
    output?: (data: string) => void,
    agentPath?: string | BaseAgent,
  ) {
    return this.execChannel(id, command, timeout, signal, output, agentPath);
  }
  /** Bounded command input stays on the SSH channel, outside the guest argv. */
  async execInput(
    id: string,
    command: string,
    input: Buffer,
    timeout = 30000,
    signal?: AbortSignal,
    output?: (data: string) => void,
    agentPath?: string | BaseAgent,
  ) {
    if (!Buffer.isBuffer(input) || input.length > 128 * 1024)
      throw new AppError('命令输入超过 128 KiB 或类型无效', 413, 'GUEST_INPUT_INVALID');
    // Capture before connecting so callers cannot change an in-flight payload.
    return this.execChannel(id, command, timeout, signal, output, agentPath, Buffer.from(input));
  }
  private async execChannel(
    id: string,
    command: string,
    timeout: number,
    signal?: AbortSignal,
    output?: (data: string) => void,
    agentPath?: string | BaseAgent,
    input?: Buffer,
  ) {
    const client = await this.host.connect(id, Math.min(timeout, 10000), signal, agentPath);
    try {
      return await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
        let stdout = '',
          stderr = '',
          size = 0;
        let settled = false;
        const outDecoder = new StringDecoder('utf8'),
          errDecoder = new StringDecoder('utf8');
        const finish = (error?: Error, code = -1) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          client.off('close', closed);
          error
            ? reject(error)
            : resolve({ stdout: stdout + outDecoder.end(), stderr: stderr + errDecoder.end(), code });
        };
        const abort = () => {
          finish(new AppError('Linux 命令已取消', 409));
          client.destroy();
        };
        const closed = () => finish(new Error('SSH connection closed'));
        const timer = setTimeout(() => {
          finish(new AppError('Linux 命令执行超时', 408));
          client.destroy();
        }, timeout);
        signal?.addEventListener('abort', abort, { once: true });
        client.once('close', closed);
        if (signal?.aborted) {
          abort();
          return;
        }
        const completed: ClientCallback = (error, stream) => {
          if (error) {
            finish(error);
            return;
          }
          if (settled) {
            stream.close();
            return;
          }
          const collect = (data: Buffer, err = false) => {
            if (settled) return;
            size += data.length;
            if (size > 1024 * 1024) {
              finish(new AppError('输出超过 1 MiB，请使用终端'));
              stream.close();
              return;
            }
            const text = (err ? errDecoder : outDecoder).write(data);
            if (err) stderr += text;
            else stdout += text;
            output?.(text);
          };
          stream.on('data', (data: Buffer) => collect(data));
          stream.stderr.on('data', (data: Buffer) => collect(data, true));
          stream.on('error', (e: Error) => finish(e));
          stream.on('close', (code: number) => {
            finish(undefined, code ?? -1);
          });
          if (input !== undefined) {
            try {
              stream.end(input);
            } catch (error) {
              finish(error instanceof Error ? error : new Error('SSH command input failed'));
              stream.close();
            }
          }
        };
        if (agentPath) client.exec(command, { agentForward: true } as ExecOptions, completed);
        else client.exec(command, completed);
      });
    } finally {
      client.end();
    }
  }
  async openGuestTcpStream(
    id: string,
    port: number,
    signal?: AbortSignal,
    project?: Project,
  ): Promise<Duplex> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AppError('客户机端口无效');
    const script = [
      'import socket,sys,threading',
      `sock=socket.create_connection(("127.0.0.1",${port}),5)`,
      'sock.settimeout(None)',
      'def upstream():',
      '  try:',
      '    while True:',
      '      data=sys.stdin.buffer.read1(16384)',
      '      if not data: break',
      '      sock.sendall(data)',
      '  finally:',
      '    try: sock.shutdown(socket.SHUT_WR)',
      '    except OSError: pass',
      'threading.Thread(target=upstream,daemon=True).start()',
      'try:',
      '  while True:',
      '    data=sock.recv(16384)',
      '    if not data: break',
      '    sys.stdout.buffer.write(data)',
      '    sys.stdout.buffer.flush()',
      'finally: sock.close()',
    ].join('\n');
    const payload = Buffer.from(script).toString('base64');
    const relay = `python3 -I -S -u -c "import base64;exec(base64.b64decode('${payload}'))"`;
    const command = project ? projectNetworkCommand(project, `exec ${relay}`) : relay;
    const client = await this.host.connect(id, 10000, signal);
    try {
      const channel = await new Promise<Duplex>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error, stream?: Duplex) => {
          if (settled) {
            stream?.destroy();
            return;
          }
          settled = true;
          signal?.removeEventListener('abort', abortPending);
          client.off('close', closedPending);
          error ? reject(error) : resolve(stream!);
        };
        const abortPending = () => finish(new AppError('临时隧道连接已取消', 409));
        const closedPending = () => finish(new Error('SSH connection closed'));
        signal?.addEventListener('abort', abortPending, { once: true });
        client.once('close', closedPending);
        if (signal?.aborted) return abortPending();
        client.exec(command, (error, stream) => finish(error || undefined, stream));
      });
      channel.on('error', () => channel.destroy());
      (channel as typeof channel & { stderr?: { resume(): void } }).stderr?.resume();
      const abort = () => {
        channel.destroy();
        client.destroy();
      };
      signal?.addEventListener('abort', abort, { once: true });
      channel.once('close', () => {
        signal?.removeEventListener('abort', abort);
        client.end();
      });
      if (signal?.aborted) abort();
      return channel;
    } catch (error) {
      client.destroy();
      throw error;
    }
  }
  async sftp<T>(
    id: string,
    work: (sftp: SFTPWrapper, transportSignal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ) {
    const client = await this.host.connect(id, 10000, signal);
    const transport = new AbortController();
    let finish!: (error: unknown, result?: T) => void;
    const failed = (error: Error) => {
      transport.abort(error);
      finish(error);
      client.destroy();
    };
    const closed = () => failed(new Error('SFTP connection closed'));
    const abort = () => failed(signal?.reason || new AppError('文件操作已取消', 409));
    try {
      return await new Promise<T>((resolve, reject) => {
        let settled = false;
        finish = (error, result) => {
          if (settled) return;
          settled = true;
          error ? reject(error) : resolve(result as T);
        };
        signal?.addEventListener('abort', abort, { once: true });
        client.once('close', closed);
        client.on('error', failed);
        if (signal?.aborted) {
          abort();
          return;
        }
        client.sftp((error, ftp) => {
          if (error) {
            failed(error);
            return;
          }
          // ssh2 may leave requests queued forever if a finally block submits
          // cleanup after disconnection. Transport failure must settle this
          // operation independently of those request callbacks.
          ftp.on('error', failed);
          ftp.once('close', closed);
          ftp.once('end', closed);
          if (settled) {
            ftp.end();
            return;
          }
          Promise.resolve()
            .then(() => work(ftp, transport.signal))
            .then((result) => finish(undefined, result), failed);
        });
      });
    } finally {
      signal?.removeEventListener('abort', abort);
      client.off('close', closed);
      client.off('error', failed);
      client.end();
    }
  }
}
