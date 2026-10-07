/**
 * 模块职责：统一启动宿主工具并关联原生资源归属，校验命令路径、环境和进程选项。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve, win32 } from 'node:path';
import { AppError } from '../shared/errors.ts';
import { runViaNativeHost } from '../.vendor/posixloom/dist/src/core/process/native.js';
import { ROOT } from './paths.ts';
import { resourceContext } from './host-runtime/index.ts';
import { pluginAuthority, pluginCleanup } from './plugin-authority.ts';
import { processSupervisor, hostProcessAdapters, type HostProcessAdapter } from './process-supervisor.ts';

type Options = {
  signal?: AbortSignal;
  input?: string | Buffer;
  timeout?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  lane?: 'interactive' | 'background' | 'control';
};
let nativeHost: string | undefined;
export function configureHostProcessNativeOwner(path: string | undefined) {
  nativeHost = path;
}
function ownerPath() {
  if (nativeHost) return nativeHost;
  // Standalone maintenance/tests use the same packaged/development owner, never taskkill fallback.
  const root = join(ROOT, '.vendor/posixloom');
  return [
    join(root, 'runtime/native/posixloom-host/posixloom.exe'),
    join(root, 'posixloom.exe'),
    join(root, 'native/posixloom-host/target/debug/posixloom.exe'),
    join(root, 'native/posixloom-host/target/release/posixloom.exe'),
  ].find(existsSync);
}
function windowsEnvironment(source: NodeJS.ProcessEnv) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (!key || /[=\0]/.test(key) || value.includes('\0'))
      throw new AppError('宿主工具环境无效', 409, 'HOST_PROCESS_FAILED');
    // Native Host deliberately rejects case-insensitive duplicates. Node's Windows
    // process.env exposes both Path and PATH when an adapter builds a restricted copy.
    env[key.toUpperCase()] = value;
  }
  return env;
}
async function windowsExecutable(file: string, env: Record<string, string>, cwd: string) {
  if (!file || file.includes('\0')) throw new AppError('宿主工具路径无效', 409, 'HOST_PROCESS_FAILED');
  const explicit = win32.isAbsolute(file) || /[/\\]/.test(file);
  const candidates = explicit
    ? [resolve(cwd, file)]
    : (env.PATH || '')
        .split(';')
        .filter(Boolean)
        .map((directory) => resolve(cwd, directory.replace(/^"|"$/g, ''), file));
  for (const candidate of candidates) {
    for (const path of win32.extname(candidate) ? [candidate] : [candidate + '.exe']) {
      try {
        if ((await stat(path)).isFile()) return path;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      }
    }
  }
  throw new AppError('宿主工具不存在：' + file, 409, 'HOST_PROCESS_FAILED');
}
export async function hostProcess(
  adapter: HostProcessAdapter,
  file: string,
  args: string[],
  options: Options = {},
) {
  const instance = pluginAuthority();
  if (instance && pluginCleanup() !== instance) {
    instance.check('process', true);
    options = { ...options, signal: options.signal ? AbortSignal.any([options.signal, instance.signal]) : instance.signal };
  }
  if (
    !Object.hasOwn(hostProcessAdapters, adapter) ||
    hostProcessAdapters[adapter] !== 'tool' ||
    adapter === 'windows-user-application'
  )
    throw new Error('Invalid finite host process adapter');
  const timeout = options.timeout ?? 30000,
    maxBuffer = options.maxBuffer ?? 1024 * 1024;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 120000 ||
    !Number.isSafeInteger(maxBuffer) ||
    maxBuffer < 1 ||
    maxBuffer > 16 * 1024 * 1024
  )
    throw new Error('Invalid host process bounds');
  const admission = {
    owner: resourceContext()?.owner || `core:${adapter}`,
    kind: 'tool' as const,
    label: adapter,
    lane: options.lane,
    signal: options.signal,
  };
  if (process.platform === 'win32') {
    const hostPath = ownerPath();
    if (!hostPath)
      throw new AppError('原生进程归属工具不可用，请运行 setup', 503, 'HOST_PROCESS_OWNER_UNAVAILABLE');
    const env = windowsEnvironment(options.env || process.env),
      cwd = resolve(options.cwd || ROOT);
    if (args.some((argument) => argument.includes('\0')) || !(await stat(cwd)).isDirectory())
      throw new AppError('宿主工具参数无效', 409, 'HOST_PROCESS_FAILED');
    const program = await windowsExecutable(file, env, cwd);
    return processSupervisor.run({ ...admission, mode: 'native-owner' }, async (control) => {
      const result = await runViaNativeHost({
        program,
        args: [...args],
        hostPath,
        cwd,
        env,
        timeoutMs: timeout,
        maxOutputBytes: maxBuffer,
        input: options.input,
        signal: options.signal,
      });
      if (
        result.outcome.kind === 'crashed' &&
        result.outcome.errorCode === 'NATIVE_HOST_CLEANUP_UNCONFIRMED'
      ) {
        const error = new AppError('原生进程树清理尚未确认', 503, 'HOST_PROCESS_CLEANUP_PENDING');
        control.cleanupPending(error);
        throw error;
      }
      if (result.outcome.kind !== 'exited') {
        options.signal?.throwIfAborted();
        throw new AppError('宿主工具未完成：' + result.outcome.kind, 409, 'HOST_PROCESS_FAILED');
      }
      if (result.truncated) throw new AppError('宿主工具输出超过预算', 413, 'HOST_PROCESS_OUTPUT_LIMIT');
      return {
        code: result.outcome.exitCode,
        stdout: result.stdout.toString('utf8'),
        stderr: result.stderr.toString('utf8'),
      };
    });
  }
  // These fixed inspection modes do not launch a VM, daemon or arbitrary workload.
  // POSIX child.close is not a process-tree receipt; arbitrary tools require an owner.
  const probeModes =
    adapter === 'trusted-boot-probe'
      ? [['--version'], ['-tpmdev', 'help'], ['-machine', 'q35,help']]
      : adapter === 'virtio-fs-probe'
        ? [['--version'], ['-device', 'help'], ['-object', 'help']]
        : [];
  if (
    !probeModes.some((mode) => mode.length === args.length && mode.every((arg, index) => arg === args[index]))
  )
    throw new AppError('此宿主工具需要原生进程树归属', 503, 'HOST_PROCESS_OWNER_UNAVAILABLE');
  const owned = await processSupervisor.observe(
    adapter,
    () =>
      spawn(file, [...args], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(options.env ? { env: options.env } : {}),
        ...(options.cwd ? { cwd: options.cwd } : {}),
      }),
    admission,
  );
  const child = owned.child;
  let output = Buffer.alloc(0),
    errors = Buffer.alloc(0),
    bytes = 0,
    failure: unknown;
  const stop = (error: unknown) => {
    failure ||= error;
    child.kill('SIGKILL');
  };
  const collect = (data: Buffer, stderr = false) => {
    bytes += data.length;
    if (bytes > maxBuffer) {
      stop(new AppError('宿主工具输出超过预算', 413, 'HOST_PROCESS_OUTPUT_LIMIT'));
      return;
    }
    if (stderr) errors = Buffer.concat([errors, data]);
    else output = Buffer.concat([output, data]);
  };
  child.stdout?.on('data', (data: Buffer) => collect(data));
  child.stderr?.on('data', (data: Buffer) => collect(data, true));
  child.stdin?.on('error', () => {});
  child.on('error', (error) => {
    failure ||= error;
  });
  const aborted = () => stop(options.signal?.reason || new DOMException('Aborted', 'AbortError'));
  options.signal?.addEventListener('abort', aborted, { once: true });
  const timer = setTimeout(
    () => stop(new AppError('宿主工具运行超时', 408, 'HOST_PROCESS_TIMEOUT')),
    timeout,
  );
  try {
    if (options.signal?.aborted) aborted();
    child.stdin?.end(options.input);
    const closed = await owned.waitForClose(timeout + 5000);
    if (failure) throw failure;
    return { code: closed.code ?? -1, stdout: output.toString('utf8'), stderr: errors.toString('utf8') };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', aborted);
  }
}

export async function hostExecFile(
  adapter: HostProcessAdapter,
  file: string,
  args: string[],
  options: Options = {},
) {
  const result = await hostProcess(adapter, file, args, options);
  if (result.code !== 0)
    throw Object.assign(new AppError('宿主工具执行失败', 409, 'HOST_PROCESS_FAILED'), {
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  return result;
}
