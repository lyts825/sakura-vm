import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { NativeClipboardProcess } from '../shared/native-clipboard.ts';

const processIdentity = z
  .object({
    pid: z.number().int().positive().max(0xffffffff),
    created: z.string().regex(/^[1-9][0-9]{0,19}$/),
    image: z.string().min(7).max(1024),
    bits: z.union([z.literal(32), z.literal(64)]),
  })
  .strict();
const handle = z.string().regex(/^[1-9][0-9]{0,19}$/);
export const nativeClipboardDescendantRequest = z
  .object({
    stage: z.literal('request'),
    id: z.uuid(),
    parent: processIdentity,
    process: processIdentity,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    suspended: z.boolean(),
    handles: z.object({ process: handle, thread: handle, job: handle, file: handle }).strict(),
  })
  .strict();
export type NativeClipboardDescendantRequest = z.infer<typeof nativeClipboardDescendantRequest>;
export type NativeClipboardDescendantBroker = Pick<NativeClipboardProcess, 'pid' | 'created'>;
export type NativeClipboardDescendantChannel = {
  alive: boolean;
  process?: NativeClipboardDescendantBroker;
  closure?: { code: number | null; signal: string | null; at: string };
  close(): Promise<void>;
};
export type NativeClipboardDescendantFactory = (
  file: string,
  owner: string,
  receive: (
    request: NativeClipboardDescendantRequest,
    broker: NativeClipboardDescendantBroker,
  ) => Promise<void>,
  failed: (error: Error) => void,
) => Promise<NativeClipboardDescendantChannel>;

// The native broker owns the OS-authenticated named pipe and exact Job handles.
// This bridge dispatches concurrent requests so import/TLS-created descendants
// can complete while their ancestor's loader and controlled launch are waiting.
export const nativeClipboardDescendants: NativeClipboardDescendantFactory = async (
  file,
  owner,
  receive,
  failed,
) => {
  const child = spawn(file, ['descendants', owner], {
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let alive = true,
    closing = false,
    output = '',
    broker: NativeClipboardDescendantBroker | undefined;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const active = new Map<string, Promise<void>>();
  let closure: NativeClipboardDescendantChannel['closure'];
  const closed = new Promise<void>((resolve) =>
    child.once('close', (code, signal) => {
      closure = { code, signal, at: new Date().toISOString() };
      resolve();
    }),
  );
  const stop = (error: Error) => {
    rejectReady(error);
    if (!closing) failed(error);
    closing = true;
    child.stdin.end();
    child.kill();
  };
  child.once('error', stop);
  child.once('exit', (code) => {
    alive = false;
    rejectReady(new Error(`子进程策略通道已结束 (${code})`));
    if (!closing) failed(new Error(`子进程策略通道已结束 (${code})；已加载规则保留`));
  });
  child.stdin.on('error', (error) => {
    if (!closing) stop(error);
  });
  let stderr = 0;
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.length;
    if (stderr > 32768) stop(new Error('子进程策略工具返回过多错误数据'));
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output += chunk;
    if (Buffer.byteLength(output) > 65536) {
      stop(new Error('子进程策略工具返回过多数据'));
      return;
    }
    let end: number;
    while ((end = output.indexOf('\n')) >= 0) {
      const line = output.slice(0, end).replace(/\r$/, '');
      output = output.slice(end + 1);
      try {
        const value = JSON.parse(line);
        if (!broker) {
          const message = z
            .object({
              stage: z.literal('ready'),
              pid: z.number().int().positive().max(0xffffffff),
              created: handle,
            })
            .strict()
            .parse(value);
          if (message.pid !== child.pid) throw new Error('子进程策略通道身份不一致');
          broker = { pid: message.pid, created: message.created };
          resolveReady();
          continue;
        }
        if (value.stage === 'rejected') {
          const rejected = z
            .object({
              stage: z.literal('rejected'),
              parentPid: z.number().int().nonnegative().max(0xffffffff),
              error: z.string().min(1).max(256),
            })
            .strict()
            .parse(value);
          failed(new Error('子进程策略请求被拒绝 (' + rejected.parentPid + '): ' + rejected.error));
          continue;
        }
        const request = nativeClipboardDescendantRequest.parse(value);
        if (active.size >= 64 || active.has(request.id)) throw new Error('子进程策略通道请求重复或超出上限');
        const task = receive(request, broker)
          .then(
            () => {
              if (alive && !closing) child.stdin.write(`ok ${request.id}\n`);
            },
            (error) => {
              if (alive && !closing) child.stdin.write(`fail ${request.id}\n`);
              failed(error instanceof Error ? error : new Error(String(error)));
            },
          )
          .finally(() => active.delete(request.id));
        active.set(request.id, task);
      } catch (error) {
        stop(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
  });
  const timeout = setTimeout(() => stop(new Error('子进程策略通道启动超时')), 15000);
  try {
    await ready;
  } finally {
    clearTimeout(timeout);
  }
  return {
    process: broker,
    get closure() {
      return closure;
    },
    get alive() {
      return alive && !closing;
    },
    async close() {
      closing = true;
      child.stdin.end();
      const timeout = setTimeout(() => child.kill(), 5000);
      try {
        await closed;
        await Promise.allSettled([...active.values()]);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
};
