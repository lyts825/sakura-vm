import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { isAbsolute, join, win32 } from 'node:path';
import { promisify } from 'node:util';
import type { Duplex } from 'node:stream';
import type { Client } from 'ssh2';
import { z } from 'zod';
import { AppError } from './model.ts';
import { quote } from './files.ts';
import type { Machines } from './machines.ts';

const execFileAsync = promisify(execFile);
const guestDirectory = /^\/tmp\/sakura-gpg-[A-Za-z0-9]{8}$/;

export const gpgAgentForwardInput = z.object({
  command: z.string().min(1).max(8192),
  confirmed: z.literal(true),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
}).strict();

function normalizeSocket(value: string) {
  const path = value.trim();
  const msys = process.platform === 'win32' ? /^\/([a-z])\/(.+)$/i.exec(path) : null;
  const resolved = msys ? `${msys[1].toUpperCase()}:\\${msys[2].replaceAll('/', '\\')}` : path;
  if (!resolved || resolved.length > 4096 || /[\x00-\x1f]/.test(resolved) ||
      !(isAbsolute(resolved) || win32.isAbsolute(resolved) ||
        resolved.startsWith('\\\\.\\pipe\\')))
    throw new AppError('GPG Agent extra socket 路径无效', 409);
  return resolved;
}

export async function hostGpgExtraSocket() {
  if (process.env.SAKURA_GPG_EXTRA_SOCKET)
    return normalizeSocket(process.env.SAKURA_GPG_EXTRA_SOCKET);
  const candidates = ['gpgconf'];
  if (process.platform === 'win32') {
    const bundled = join(process.env.ProgramFiles || 'C:\\Program Files',
      'Git', 'usr', 'bin', 'gpgconf.exe');
    if (existsSync(bundled)) candidates.push(bundled);
  }
  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(candidate,
        ['--list-dirs', 'agent-extra-socket'],
        { timeout: 5000, maxBuffer: 4096, windowsHide: true });
      if (stdout.trim()) return normalizeSocket(stdout);
    } catch { /* Try a bundled installation or report unavailable. */ }
  }
  return '';
}

export async function gpgSocketReachable(path: string, signal?: AbortSignal) {
  if (!path) return false;
  signal?.throwIfAborted();
  return await new Promise<boolean>((resolve) => {
    let socket: Socket;
    try { socket = connect(path); }
    catch { resolve(false); return; }
    let greeting = '', settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      socket.destroy();
      resolve(ready);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(false), 3000);
    signal?.addEventListener('abort', abort, { once: true });
    socket.on('data', (data: Buffer) => {
      greeting += data.toString('utf8');
      if (greeting.length > 512) finish(false);
      else if (greeting.includes('\n')) finish(/^OK(?:\s|$)/.test(greeting.trim()));
    });
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
    if (signal?.aborted) abort();
  });
}

export async function guestGpgForwardingReady(machines: Machines, id: string,
  signal?: AbortSignal) {
  const config = await machines.exec(id, 'sshd -T', 10000, signal);
  if (config.code !== 0) return false;
  const settings = new Map(config.stdout.split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/, 2) as [string, string]));
  return settings.get('disableforwarding') === 'no' &&
    ['yes', 'remote'].includes(settings.get('allowtcpforwarding') || '') &&
    ['yes', 'remote'].includes(settings.get('allowstreamlocalforwarding') || '');
}

export async function checkGpgAgentForward(machines: Machines, id: string,
  signal?: AbortSignal) {
  const socket = await hostGpgExtraSocket();
  const hostReady = await gpgSocketReachable(socket, signal);
  signal?.throwIfAborted();
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, hostReady, reason: '请先启动实例。' };
  const guest = await machines.exec(id,
    'command -v gpg >/dev/null && command -v mktemp >/dev/null', 10000, signal);
  const forwardingReady = guest.code === 0 &&
    await guestGpgForwardingReady(machines, id, signal);
  return { ready: hostReady && guest.code === 0 && forwardingReady,
    executed: false, hostReady, forwardingReady,
    guestReady: guest.code === 0,
    reason: !hostReady ? '宿主机的 GPG Agent extra socket 不可用。' :
      guest.code !== 0 ? '客户机需要安装 GnuPG。' :
        !forwardingReady ? '客户机 SSH 服务需要 AllowTcpForwarding remote 和 AllowStreamLocalForwarding remote（或 yes）；修改后重启 sshd。' :
        '仅在明确确认的单次命令期间转发受限制的 extra socket；客户机仍需导入对应公钥。' };
}

function forwardUnix(client: Client, remote: string, host: string, signal?: AbortSignal) {
  let closed = false;
  const streams = new Set<Duplex>();
  let connections = 0;
  const onConnection = (info: { socketPath: string }, accept: () => Duplex, reject: () => void) => {
    if (closed || info.socketPath !== remote || connections >= 8) return reject();
    let source: Socket;
    try { source = connect(host); }
    catch { reject(); return; }
    connections++;
    let accepted = false, rejected = false;
    streams.add(source);
    const rejectOnce = () => {
      if (accepted || rejected) return;
      rejected = true;
      reject();
    };
    const timer = setTimeout(() => { source.destroy(); rejectOnce(); }, 3000);
    source.once('connect', () => {
      clearTimeout(timer);
      if (closed || rejected) { source.destroy(); rejectOnce(); return; }
      let channel: Duplex;
      try { channel = accept(); }
      catch { source.destroy(); rejectOnce(); return; }
      accepted = true;
      streams.add(channel);
      channel.once('close', () => { streams.delete(channel); source.destroy(); });
      source.once('close', () => { streams.delete(source); channel.destroy(); });
      channel.pipe(source).pipe(channel);
    });
    source.once('error', () => { clearTimeout(timer); rejectOnce(); });
    source.once('close', () => { clearTimeout(timer); streams.delete(source); connections--; });
  };
  client.on('unix connection', onConnection);
  const ready = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.off('close', onClose);
      signal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve();
    };
    const onClose = () => finish(new AppError('GPG 转发连接已关闭', 409));
    const onAbort = () => finish(new AppError('GPG 转发已取消', 409));
    const timer = setTimeout(() => finish(new AppError('GPG 转发建立超时', 408)), 10000);
    client.once('close', onClose);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    try { client.openssh_forwardInStreamLocal(remote, (error) => finish(error || undefined)); }
    catch (error) { finish(error as Error); }
  });
  const close = async () => {
    closed = true;
    client.off('unix connection', onConnection);
    for (const stream of streams) stream.destroy();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000);
      try {
        client.openssh_unforwardInStreamLocal(remote, () => {
          clearTimeout(timer); resolve();
        });
      } catch { clearTimeout(timer); resolve(); }
    });
  };
  return { ready, close };
}

export async function runGpgAgentForward(machines: Machines, id: string,
  input: unknown, signal?: AbortSignal) {
  const options = gpgAgentForwardInput.parse(input);
  machines.requireUnlocked(id);
  if (machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
  const host = await hostGpgExtraSocket();
  if (!await gpgSocketReachable(host, signal))
    throw new AppError('宿主机的 GPG Agent extra socket 不可用', 409);
  signal?.throwIfAborted();
  const installed = await machines.exec(id, 'command -v gpg >/dev/null && command -v mktemp >/dev/null',
    10000, signal);
  if (installed.code !== 0) throw new AppError('客户机需要安装 GnuPG', 409);
  if (!await guestGpgForwardingReady(machines, id, signal))
    throw new AppError('客户机 SSH 服务未允许远端 Unix 套接字转发；请启用 AllowTcpForwarding remote 和 AllowStreamLocalForwarding remote', 409);
  signal?.throwIfAborted();
  const directoryResult = await machines.exec(id,
    'umask 077; mktemp -d /tmp/sakura-gpg-XXXXXXXX', 10000, signal);
  const directory = directoryResult.stdout.trim();
  if (directoryResult.code !== 0 || !guestDirectory.test(directory))
    throw new AppError('无法建立临时 GPG 目录', 502);
  const remote = directory + '/S.gpg-agent';
  let client: Client | undefined;
  let bridge: ReturnType<typeof forwardUnix> | undefined;
  let result: { stdout: string; stderr: string; code: number } | undefined;
  let cleanupError = '';
  try {
    client = await machines.connect(id, 10000, signal);
    bridge = forwardUnix(client, remote, host, signal);
    await bridge.ready;
    signal?.throwIfAborted();
    result = await machines.exec(id,
      `umask 077; export GNUPGHOME=${quote(directory)}; ${options.command}`,
      options.timeoutSeconds * 1000, signal);
  } finally {
    await bridge?.close().catch(() => {});
    client?.end();
    // Cleanup is independent of user cancellation. The host bridge is already closed.
    const cleanup = await machines.exec(id,
      `rm -rf -- ${quote(directory)}`, 10000).catch((error) => {
      cleanupError = String((error as Error).message || error);
      return null;
    });
    if (cleanup && cleanup.code !== 0) cleanupError = cleanup.stderr.trim() || '临时目录未清理';
  }
  if (!result) throw new AppError('GPG 命令未执行', 502);
  return { code: result.code, ready: result.code === 0, executed: true,
    stdout: result.stdout, stderr: result.stderr,
    ...(cleanupError ? { cleanupWarning: cleanupError } : {}),
    message: '单次命令的 GPG Agent 转发已关闭。' };
}
