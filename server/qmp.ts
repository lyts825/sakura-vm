import { createConnection, createServer } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res())));
  return port;
}
async function qmpOnce(port: number, command: string,
  args: Record<string, unknown> | undefined, timeoutMs: number) {
  return new Promise<unknown>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setEncoding('utf8');
    let input = '';
    let sent = false;
    let settled = false;
    const timer = setTimeout(() => finish(new Error('QMP response timed out')), timeoutMs);
    function finish(error?: Error, data?: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve(data);
    }
    socket.on('error', (e) => finish(e));
    socket.on('close', () => finish(new Error('QMP closed')));
    socket.on('data', (data) => {
      if (settled) return;
      input += data;
      let index: number;
      while ((index = input.indexOf('\n')) >= 0) {
        const line = input.slice(0, index);
        input = input.slice(index + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return finish(new Error('Invalid QMP response'));
        }
        if (msg === null || typeof msg !== 'object' || Array.isArray(msg))
          return finish(new Error('Invalid QMP response'));
        if (msg.QMP) socket.write(JSON.stringify({ execute: 'qmp_capabilities', id: 'hello' }) + '\n');
        if (msg.id === 'hello' && !sent) {
          if (msg.error) return finish(new Error(msg.error.desc || 'QMP negotiation failed'));
          sent = true;
          socket.write(JSON.stringify({ execute: command, arguments: args, id: 'command' }) + '\n');
        }
        if (msg.id === 'command')
          return finish(msg.error ? new Error(msg.error.desc) : undefined, msg.return);
      }
    });
  });
}

export async function qmp(port: number, command: string,
  args?: Record<string, unknown>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (let attempts = 0; ; attempts++) {
    try { return await qmpOnce(port, command, args, Math.max(1, deadline - Date.now())); }
    catch (error) {
      // QEMU's socket chardev may briefly stop accepting while the previous
      // short-lived QMP client disconnects. ECONNREFUSED occurs before any
      // command bytes are sent, so retrying cannot execute a mutation twice.
      if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED' ||
          attempts >= 19 || Date.now() + 50 >= deadline) throw error;
      await delay(50);
    }
  }
}

/** Snapshot QMP commands enqueue jobs; their immediate reply is not completion. */
export async function qmpSnapshotJob(port: number, command: 'snapshot-save' | 'snapshot-load',
  tag: string, timeoutMs = 5 * 60_000) {
  const blocks = await qmp(port, 'query-block', undefined, 10_000);
  if (!Array.isArray(blocks)) throw new Error('QMP did not return block devices');
  if (blocks.some((block) => block && typeof block === 'object' &&
      block.device !== 'sakura-disk' && block.inserted && !block.inserted.ro))
    throw new Error('Additional writable block devices are not supported by VM-state snapshots');
  const disk = blocks.find((block) => block && typeof block === 'object' &&
    block.device === 'sakura-disk');
  const node = disk?.inserted?.['node-name'];
  if (typeof node !== 'string' || disk.inserted.drv !== 'qcow2' || disk.inserted.ro)
    throw new Error('Sakura writable QCOW2 disk node is unavailable');
  const id = `sakura-${command}-${randomUUID()}`;
  await qmp(port, command, { 'job-id': id, tag, vmstate: node,
    devices: [node] }, 30_000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await qmp(port, 'query-jobs', undefined, 10_000);
    if (!Array.isArray(result)) throw new Error('QMP did not return snapshot jobs');
    const job = result.find((item) => item && typeof item === 'object' && item.id === id);
    if (job?.status === 'concluded') {
      await qmp(port, 'job-dismiss', { id }, 10_000);
      if (job.error) throw new Error(String(job.error));
      return;
    }
    await delay(250);
  }
  await qmp(port, 'job-cancel', { id }, 10_000).catch(() => {});
  throw new Error('QMP snapshot job timed out');
}

/** Keep one guest-agent connection open across freeze, snapshot and thaw. */
export class GuestAgent {
  private input = '';
  private sequence = 0;
  private readonly session = randomUUID();
  private pending?: { id: string; resolve: (value: unknown) => void; reject: (error: Error) => void };
  private constructor(private readonly socket: ReturnType<typeof createConnection>) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.input += chunk;
      if (this.input.length > 1024 * 1024) return this.fail(new Error('Guest agent response is too large'));
      let index: number;
      while ((index = this.input.indexOf('\n')) >= 0) {
        const line = this.input.slice(0, index).replace(/^\uFFFD/, '');
        this.input = this.input.slice(index + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id !== this.pending?.id) continue;
          const pending = this.pending!;
          this.pending = undefined;
          if (message.error) pending.reject(new Error(message.error.desc || 'Guest agent command failed'));
          else pending.resolve(message.return);
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('Guest agent connection closed')));
  }
  static async connect(port: number, timeoutMs = 5000) {
    const socket = createConnection({ host: '127.0.0.1', port });
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          socket.off('connect', connected);
          socket.off('error', failed);
        };
        const connected = () => { cleanup(); resolve(); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const timer = setTimeout(() => failed(new Error('Guest agent connection timed out')), timeoutMs);
        socket.once('connect', connected);
        socket.once('error', failed);
      });
      return new GuestAgent(socket);
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }
  async execute(command: string, args?: Record<string, unknown>, timeoutMs = 30000) {
    if (this.pending) throw new Error('Guest agent command already in progress');
    if (this.socket.destroyed) throw new Error('Guest agent connection closed');
    const id = `${this.session}:${++this.sequence}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`Guest agent ${command} timed out`));
        this.socket.destroy();
      }, timeoutMs);
      this.pending = {
        id,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      };
      this.socket.write(JSON.stringify({ execute: command, arguments: args, id }) + '\n');
    });
  }
  close() { this.socket.destroy(); }
  private fail(error: Error) {
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(error);
    this.socket.destroy();
  }
}
