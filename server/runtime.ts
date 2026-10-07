/**
 * 模块职责：创建 QEMU/PosixLoom 引擎与运行后端，启动前检查所需宿主二进制及构建资源。
 * Module purpose: Creates QEMU/PosixLoom engines/backends after checking required host binaries and built assets.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { writeStore } from './local-store.ts';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { freePort, qmp } from './qmp.ts';
import {
  RuntimeManager,
  PosixLoomService,
  NATIVE_COMMANDS,
  NATIVE_COMMAND_ADAPTERS,
} from '../.vendor/posixloom/dist/src/index.js';
import { ROOT, DATA } from './paths.ts';
import { AppError } from '../shared/errors.ts';
import { qemuCpuModel } from '../shared/hardware.ts';
import { processSupervisor, type ProcessAdmission } from './process-supervisor.ts';
import { configureHostProcessNativeOwner } from './host-process.ts';

type RunOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  /**
   * 签名 / Signature: RunOptions.output.
   * 功能：为创建 QEMU/PosixLoom 引擎与运行后端声明 output 的输入与结果契约，所属容器为 RunOptions。
   * Purpose: Declares the input/result contract for output in RunOptions. Module responsibility: Creates QEMU/PosixLoom engines/backends after checking required host binaries and built assets.
   * 输入 / Inputs: data: Buffer
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  output?: (data: Buffer) => void;
  owner?: string;
  processKind?: 'vm' | 'tool';
  lane?: ProcessAdmission['lane'];
};

/**
 * 入口 / Entry: createRuntime.
 * 功能：检测 QEMU 与原生宿主资源，创建 PosixLoom 引擎并暴露受控宿主工具接口。
 * Purpose: Checks QEMU/native-host assets, creates a PosixLoom engine and exposes controlled host-tool operations.
 * 设计：二进制来自固定受支持位置，创建失败关闭已创建运行时；工具调用经监督与网络层归属，不允许任意替换程序。
 * Design: Binaries come from supported fixed paths, failed construction closes runtime resources and tools remain supervised/network-owned.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `{ runtime, service, run, runStatus, version, whpxAvailable, qemuIoAvailable, aarch64Available: existsSync(binaries['sakura-qe…`.
 * 副作用 / Effects: `mkdir`; `writeStore`; `RuntimeManager.create`; `runtime.close`; `abort.abort`; 更新 / updates `process.env.POSIXLOOM_DATA_ROOT`, `whpxAvailable`.
 * 拒绝 / Refusals: 条件 / conditions `!existsSync(binary)`; `process.platform === 'win32' && !runtime.findNativeHost()`; 异常 / errors `new AppError(`缺少 QEMU：${binary}。请运行 npm run setup。`, 503)`; `new AppError('请先构建 PosixLoom Native Host：npm run setup', 503)`.
 * 收尾：退出 try 区域时始终执行 `abort.abort();`; `await probe;`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `abort.abort();`; `await probe;`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `if (!exited) await delay(100);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (!exited) await delay(100);`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function createRuntime() {
  const qemuDir = process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const binaries = {
    'sakura-qemu': join(qemuDir, `qemu-system-x86_64${suffix}`),
    'sakura-qemu-aarch64': join(qemuDir, `qemu-system-aarch64${suffix}`),
    'sakura-img': join(qemuDir, `qemu-img${suffix}`),
    'sakura-io': join(qemuDir, `qemu-io${suffix}`),
  };
  for (const binary of [binaries['sakura-qemu'], binaries['sakura-img']])
    if (!existsSync(binary)) throw new AppError(`缺少 QEMU：${binary}。请运行 npm run setup。`, 503);
  const qemuIoAvailable = existsSync(binaries['sakura-io']);
  const data = join(DATA, 'posixloom');
  await mkdir(join(data, 'config'), { recursive: true });
  await writeStore(join(data, 'config/config.json'), {
    process: { maxConcurrent: 16, maxConcurrentPerClient: 16, defaultTimeoutMs: 30000 },
    updates: { enabled: false, autoApply: false },
  });
  process.env.POSIXLOOM_DATA_ROOT = data;
  const runtime = await RuntimeManager.create(join(ROOT, '.vendor/posixloom'), {
    plugins: [
      {
        manifest: {
          id: 'sakura.qemu',
          version: '1.0.0',
          description: 'Managed QEMU processes',
          provides: [NATIVE_COMMANDS.id, NATIVE_COMMAND_ADAPTERS.id],
        },
        /**
         * 入口 / Entry: createRuntime.activate.
         * 功能：在创建 QEMU/PosixLoom 引擎与运行后端中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`runtime.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `runtime.ts`; the calls and state transitions below complete the operation. Module context: Creates QEMU/PosixLoom engines/backends after checking required host binaries and built assets.
         * 处理：通过 `context.provide`, `existsSync` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `context.provide`, `existsSync`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `existsSync(executable)`.
         * 输入 / Inputs: context
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        activate(context) {
          context.provide(NATIVE_COMMAND_ADAPTERS, {
            id: 'sakura-exact-argv',
            /**
             * 入口 / Entry: createRuntime.activate.adapt.
             * 功能：从当前输入或状态计算 `({ argv: [...argv], decisions: [] })`，供调用方后续验证或使用。
             * Purpose: Computes `({ argv: [...argv], decisions: [] })` from current inputs/state for the caller to validate or consume.
             * 输入 / Inputs: argv
             * 输出 / Returns: `({ argv: [...argv], decisions: [] })`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             */
            adapt: (argv) => ({ argv: [...argv], decisions: [] }),
          });
          for (const [name, executable] of Object.entries(binaries))
            if (existsSync(executable))
              context.provide(NATIVE_COMMANDS, {
                name,
                executable,
                adapterId: 'sakura-exact-argv',
                shellEquivalent: true,
              });
        },
      },
    ],
  });
  if (process.platform === 'win32' && !runtime.findNativeHost()) {
    await runtime.close();
    throw new AppError('请先构建 PosixLoom Native Host：npm run setup', 503);
  }
  const service = new PosixLoomService(runtime);
  configureHostProcessNativeOwner(runtime.findNativeHost());
  /**
   * 入口 / Entry: createRuntime.execute.
   * 功能：在创建 QEMU/PosixLoom 引擎与运行后端中，执行此领域的具体处理步骤并返回其结果；本入口产生 `processSupervisor.run( { owner: options.owner || 'core:qemu', kind, label: tool, lane: options.lane, signal: options.signal, …` 供上层消费（`runtime.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `runtime.ts`; this entry produces `processSupervisor.run( { owner: options.owner || 'core:qemu', kind, label: tool, lane: options.lane, signal: options.signal, …` for its caller. Module context: Creates QEMU/PosixLoom engines/backends after checking required host binaries and built assets.
   * 处理：通过 `existsSync`, `tool.startsWith`, `args.includes`, `processSupervisor.run` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `existsSync`, `tool.startsWith`, `args.includes`, `processSupervisor.run`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: tool: keyof typeof binaries; args: string[]; options: RunOptions
   * 输出 / Returns: `processSupervisor.run( { owner: options.owner || 'core:qemu', kind, label: tool, lane: options.lane, signal: options.signal, …`.
   * 副作用 / Effects: `tool.startsWith`.
   * 拒绝 / Refusals: 条件 / conditions `!Object.hasOwn(binaries, tool) || !existsSync(binaries[tool])`; 异常 / errors `new AppError('未登记或不可用的 QEMU 工具', 503)`.
   */
  const execute = async (tool: keyof typeof binaries, args: string[], options: RunOptions) => {
    if (!Object.hasOwn(binaries, tool) || !existsSync(binaries[tool]))
      throw new AppError('未登记或不可用的 QEMU 工具', 503);
    const kind =
      options.processKind || (tool.startsWith('sakura-qemu') && !args.includes('--version') ? 'vm' : 'tool');
    /**
     * 入口 / Entry: createRuntime.callback@96.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（processSupervisor.run）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (processSupervisor.run).
     * 输入 / Inputs: control
     * 输出 / Returns: `result`.
     * 副作用 / Effects: `service.createSession`; `service.execute`; `service.sessions.close`; 更新 / updates `completed`.
     * 拒绝 / Refusals: 条件 / conditions `result.command.kind === 'crashed' && result.command.errorCode === 'NATIVE_HOST_CLEANUP_UNCONFIRMED'`; 异常 / errors `error`.
     * 收尾：退出 try 区域时始终执行 `service.sessions.close(sessionId);`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `service.sessions.close(sessionId);`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `if (mayHaveStarted && !completed) control.cleanupPending(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (mayHaveStarted && !completed) control.cleanupPending(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return processSupervisor.run(
      {
        owner: options.owner || 'core:qemu',
        kind,
        label: tool,
        lane: options.lane,
        signal: options.signal,
        mode: runtime.findNativeHost() ? 'native-owner' : 'direct',
      },
      async (control) => {
        const sessionId = service.createSession();
        let mayHaveStarted = false,
          completed = false;
        try {
          const result = await service.execute(
            {
              sessionId,
              kind: 'argv',
              argv: [tool, ...args],
              statePolicy: 'isolated',
              timeoutMs: options.timeoutMs ?? 30000,
              signal: options.signal,
            },
            {
              /**
               * 入口 / Entry: createRuntime.onStarted.
               * 功能：在创建 QEMU/PosixLoom 引擎与运行后端中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`runtime.ts`）。
               * Purpose: Executes the domain-specific processing steps and returns their outcome in `runtime.ts`; the calls and state transitions below complete the operation. Module context: Creates QEMU/PosixLoom engines/backends after checking required host binaries and built assets.
               * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
               * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
               * 副作用 / Effects: 更新 / updates `mayHaveStarted`.
               */
              onStarted: () => {
                mayHaveStarted = true;
              },
              /**
               * 入口 / Entry: createRuntime.onOutput.
               * 功能：把本层请求转交 `options.output`，沿用该实现的结果与失败路径。
               * Purpose: Delegates this request to `options.output` and propagates the provider result or rejection.
               * 输入 / Inputs: event
               * 输出 / Returns: `options.output?.(event.data)`.
               * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              onOutput: (event) => options.output?.(event.data),
            },
          );
          completed = true;
          if (
            result.command.kind === 'crashed' &&
            result.command.errorCode === 'NATIVE_HOST_CLEANUP_UNCONFIRMED'
          ) {
            const error = new AppError(
              '原生宿主未确认进程树退出，保留资源名额',
              503,
              'HOST_PROCESS_CLEANUP_PENDING',
            );
            control.cleanupPending(error);
            throw error;
          }
          return result;
        } catch (error) {
          // An exception after dispatch is not a native terminal acknowledgement.
          if (mayHaveStarted && !completed) control.cleanupPending(error);
          throw error;
        } finally {
          service.sessions.close(sessionId);
        }
      },
    );
  };
  /**
   * 入口 / Entry: createRuntime.runStatus.
   * 功能：在创建 QEMU/PosixLoom 引擎与运行后端中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ code: result.command.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString(), }` 供上层消费（`runtime.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `runtime.ts`; this entry produces `{ code: result.command.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString(), }` for its caller. Module context: Creates QEMU/PosixLoom engines/backends after checking required host binaries and built assets.
   * 处理：通过 `execute`, `result.stderr.toString().trim`, `result.stderr.toString`, `result.stdout.toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `execute`, `result.stderr.toString().trim`, `result.stderr.toString`, `result.stdout.toString`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: tool: keyof typeof binaries; args: string[]; options: RunOptions default={}
   * 输出 / Returns: `{ code: result.command.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString(), }`.
   * 副作用 / Effects: `execute`.
   * 拒绝 / Refusals: 条件 / conditions `result.command.kind !== 'exited'`; 异常 / errors `new Error(result.stderr.toString().trim() || `QEMU: ${JSON.stringify(result.command)}`)`.
   */
  const runStatus = async (tool: keyof typeof binaries, args: string[], options: RunOptions = {}) => {
    const result = await execute(tool, args, options);
    if (result.command.kind !== 'exited')
      throw new Error(result.stderr.toString().trim() || `QEMU: ${JSON.stringify(result.command)}`);
    return {
      code: result.command.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  };
  /**
   * 入口 / Entry: createRuntime.run.
   * 功能：在创建 QEMU/PosixLoom 引擎与运行后端中，执行此领域的具体处理步骤并返回其结果；本入口产生 `''` / `result.stdout.toString()` 供上层消费（`runtime.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `runtime.ts`; this entry produces `''` / `result.stdout.toString()` for its caller. Module context: Creates QEMU/PosixLoom engines/backends after checking required host binaries and built assets.
   * 处理：通过 `execute`, `result.stderr.toString().trim`, `result.stderr.toString`, `result.stdout.toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `execute`, `result.stderr.toString().trim`, `result.stderr.toString`, `result.stdout.toString`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `options.signal?.aborted`.
   * 输入 / Inputs: tool: keyof typeof binaries; args: string[]; options: RunOptions default={}
   * 输出 / Returns: `''`; `result.stdout.toString()`.
   * 副作用 / Effects: `execute`.
   * 拒绝 / Refusals: 条件 / conditions `result.command.kind !== 'exited' || result.command.exitCode !== 0`; 异常 / errors `new Error(result.stderr.toString().trim() || `QEMU: ${JSON.stringify(result.command)}`)`.
   */
  const run = async (tool: keyof typeof binaries, args: string[], options: RunOptions = {}) => {
    const result = await execute(tool, args, options);
    if (result.command.kind !== 'exited' || result.command.exitCode !== 0) {
      if (options.signal?.aborted) return '';
      throw new Error(result.stderr.toString().trim() || `QEMU: ${JSON.stringify(result.command)}`);
    }
    return result.stdout.toString();
  };
  const version = (await run('sakura-qemu', ['--version'])).split(/\r?\n/)[0];
  // Probe a paused, diskless VM. A compiled-in accelerator is not sufficient:
  // the Windows feature and host hypervisor must also be usable by this user.
  let whpxAvailable = false;
  if (process.platform === 'win32') {
    const port = await freePort();
    const abort = new AbortController();
    let exited = false;
    const probe = run(
      'sakura-qemu',
      [
        '-accel',
        'whpx',
        '-cpu',
        qemuCpuModel(),
        '-machine',
        'q35',
        '-nodefaults',
        '-display',
        'none',
        '-S',
        '-qmp',
        `tcp:127.0.0.1:${port},server=on,wait=off`,
      ],
      { signal: abort.signal, timeoutMs: 5000, processKind: 'tool', lane: 'control' },
    )
      .catch(() => {})
      .finally(() => {
        exited = true;
      });
    try {
      const deadline = performance.now() + 3000;
      while (!exited && performance.now() < deadline) {
        try {
          await qmp(port, 'query-status');
          whpxAvailable = true;
          break;
        } catch {
          if (!exited) await delay(100);
        }
      }
    } finally {
      abort.abort();
      await probe;
    }
  }
  return {
    runtime,
    service,
    run,
    runStatus,
    version,
    whpxAvailable,
    qemuIoAvailable,
    aarch64Available: existsSync(binaries['sakura-qemu-aarch64']),
  };
}
export type Engine = Awaited<ReturnType<typeof createRuntime>>;
