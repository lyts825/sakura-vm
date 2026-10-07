/**
 * 模块职责：统一启动宿主工具并关联原生资源归属，校验命令路径、环境和进程选项。
 * Module purpose: Launches host tools with native resource ownership, validating executable paths, environment and process options.
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
/**
 * 入口 / Entry: configureHostProcessNativeOwner.
 * 功能：在统一启动宿主工具并关联原生资源归属中，校验并提交领域状态变更；完成下述调用及状态处理（`host-process.ts`）。
 * Purpose: Validates and commits a domain state change in `host-process.ts`; the calls and state transitions below complete the operation. Module context: Launches host tools with native resource ownership, validating executable paths, environment and process options.
 * 输入 / Inputs: path: string | undefined
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 更新 / updates `nativeHost`.
 */
export function configureHostProcessNativeOwner(path: string | undefined) {
  nativeHost = path;
}
/**
 * 入口 / Entry: ownerPath.
 * 功能：在统一启动宿主工具并关联原生资源归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `nativeHost` / `[ join(root, 'runtime/native/posixloom-host/posixloom.exe'), join(root, 'posixloom.exe'), join(root, 'native/posixloom-host/t…` 供上层消费（`host-process.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-process.ts`; this entry produces `nativeHost` / `[ join(root, 'runtime/native/posixloom-host/posixloom.exe'), join(root, 'posixloom.exe'), join(root, 'native/posixloom-host/t…` for its caller. Module context: Launches host tools with native resource ownership, validating executable paths, environment and process options.
 * 处理：通过 `join`, `inline.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `join`, `inline.find`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `nativeHost`.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `nativeHost`; `[ join(root, 'runtime/native/posixloom-host/posixloom.exe'), join(root, 'posixloom.exe'), join(root, 'native/posixloom-host/t…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
/**
 * 入口 / Entry: windowsEnvironment.
 * 功能：在统一启动宿主工具并关联原生资源归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `env` 供上层消费（`host-process.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-process.ts`; this entry produces `env` for its caller. Module context: Launches host tools with native resource ownership, validating executable paths, environment and process options.
 * 处理：通过 `inline.test`, `value.includes`, `key.toUpperCase` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`, `value.includes`, `key.toUpperCase`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `value === undefined`.
 * 输入 / Inputs: source: NodeJS.ProcessEnv
 * 输出 / Returns: `env`.
 * 副作用 / Effects: 更新 / updates `env[key.toUpperCase()]`.
 * 拒绝 / Refusals: 条件 / conditions `!key || /[=\0]/.test(key) || value.includes('\0')`; 异常 / errors `new AppError('宿主工具环境无效', 409, 'HOST_PROCESS_FAILED')`.
 */
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
/**
 * 入口 / Entry: windowsExecutable.
 * 功能：在统一启动宿主工具并关联原生资源归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `path` 供上层消费（`host-process.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-process.ts`; this entry produces `path` for its caller. Module context: Launches host tools with native resource ownership, validating executable paths, environment and process options.
 * 处理：通过 `file.includes`, `win32.isAbsolute`, `inline.test`, `resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `file.includes`, `win32.isAbsolute`, `inline.test`, `resolve`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `(await stat(path)).isFile()`.
 * 输入 / Inputs: file: string; env: Record<string, string>; cwd: string
 * 输出 / Returns: `path`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!file || file.includes('\0')`; `!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')`; 异常 / errors `new AppError('宿主工具路径无效', 409, 'HOST_PROCESS_FAILED')`; `error`.
 * 失败处理：catch 分支执行 `if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')) throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')) throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
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
/**
 * 入口 / Entry: hostProcess.
 * 功能：校验宿主命令和环境，按监督器预算运行直接进程或原生宿主参与者。
 * Purpose: Validates host commands/environment and runs direct/native-owner processes under supervisor admission.
 * 设计：原生模式预算包含宿主与目标，取消必须等待适配器退出确认；stdout/stderr 和错误输出受调用边界管理。
 * Design: Native mode budgets host and target; cancellation awaits adapter exit confirmation while outputs/errors remain controlled.
 * 输入 / Inputs: adapter: HostProcessAdapter; file: string; args: string[]; options: Options default={}
 * 输出 / Returns: `processSupervisor.run({ ...admission, mode: 'native-owner' }, async (control) => { const result = await runViaNativeHost({ pr…`; `{ code: closed.code ?? -1, stdout: output.toString('utf8'), stderr: errors.toString('utf8') }`.
 * 副作用 / Effects: `AbortSignal.any`; `processSupervisor.observe`; `options.signal.addEventListener`; `setTimeout`; `aborted`; 更新 / updates `options`.
 * 拒绝 / Refusals: 条件 / conditions `!Object.hasOwn(hostProcessAdapters, adapter) || hostProcessAdapters[adapter] !== 'tool' || adapter === 'windows-user-applicat…`; `!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000 || !Number.isSafeInteger(maxBuffer) || maxBuffer < 1 || max…`; `process.platform === 'win32'`; 异常 / errors `new Error('Invalid finite host process adapter')`; `new Error('Invalid host process bounds')`.
 * 收尾：退出 try 区域时始终执行 `clearTimeout(timer);`; `options.signal?.removeEventListener('abort', aborted);`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `clearTimeout(timer);`; `options.signal?.removeEventListener('abort', aborted);`; these steps also apply to exceptional exits.
 */
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
    /**
     * 入口 / Entry: hostProcess.callback@115.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（processSupervisor.run）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (processSupervisor.run).
     * 输入 / Inputs: control
     * 输出 / Returns: `{ code: result.outcome.exitCode, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8'), }`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `result.outcome.kind === 'crashed' && result.outcome.errorCode === 'NATIVE_HOST_CLEANUP_UNCONFIRMED'`; `result.outcome.kind !== 'exited'`; `result.truncated`; 异常 / errors `error`; `new AppError('宿主工具未完成：' + result.outcome.kind, 409, 'HOST_PROCESS_FAILED')`.
     */
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
  /**
   * 入口 / Entry: hostProcess.stop.
   * 功能：在统一启动宿主工具并关联原生资源归属中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`host-process.ts`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `host-process.ts`; the calls and state transitions below complete the operation. Module context: Launches host tools with native resource ownership, validating executable paths, environment and process options.
   * 处理：通过 `child.kill` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `child.kill`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: error: unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `child.kill`; 更新 / updates `failure`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const stop = (error: unknown) => {
    failure ||= error;
    child.kill('SIGKILL');
  };
  /**
   * 入口 / Entry: hostProcess.collect.
   * 功能：在统一启动宿主工具并关联原生资源归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`host-process.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-process.ts`; this entry produces `void` for its caller. Module context: Launches host tools with native resource ownership, validating executable paths, environment and process options.
   * 处理：通过 `stop` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stop`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `bytes > maxBuffer`; `stderr`.
   * 输入 / Inputs: data: Buffer; stderr: default=false
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `stop`; 更新 / updates `bytes`, `errors`, `output`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
  /**
   * 入口 / Entry: hostProcess.aborted.
   * 功能：把本层请求转交 `stop`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `stop` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `stop(options.signal?.reason || new DOMException('Aborted', 'AbortError'))`.
   * 副作用 / Effects: `stop`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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

/**
 * 入口 / Entry: hostExecFile.
 * 功能：在统一启动宿主工具并关联原生资源归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`host-process.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-process.ts`; this entry produces `result` for its caller. Module context: Launches host tools with native resource ownership, validating executable paths, environment and process options.
 * 处理：通过 `hostProcess` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `hostProcess`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: adapter: HostProcessAdapter; file: string; args: string[]; options: Options default={}
 * 输出 / Returns: `result`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `Object.assign(new AppError('宿主工具执行失败', 409, 'HOST_PROCESS_FAILED'), { exitCode: result.code, stdout: result.stdout, stderr: r…`.
 */
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
