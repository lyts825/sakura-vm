/**
 * 模块职责：管理原生剪贴板后代策略通道，在通道退出后保留已加载规则并报告失效状态。
 * Module purpose: Owns descendant clipboard-policy channels, retaining loaded rules and exposing channel failure after exit.
 */
import { processSupervisor, spawnObserved as spawn } from './process-supervisor.ts';
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
  /**
   * 签名 / Signature: NativeClipboardDescendantChannel.close.
   * 功能：为管理原生剪贴板后代策略通道声明 close 的输入与结果契约，所属容器为 NativeClipboardDescendantChannel。
   * Purpose: Declares the input/result contract for close in NativeClipboardDescendantChannel. Module responsibility: Owns descendant clipboard-policy channels, retaining loaded rules and exposing channel failure after exit.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  close(): Promise<void>;
};
/**
 * 签名 / Signature: NativeClipboardDescendantFactory.NativeClipboardDescendantFactory.
 * 功能：为管理原生剪贴板后代策略通道声明 NativeClipboardDescendantFactory 的输入与结果契约，所属容器为 NativeClipboardDescendantFactory。
 * Purpose: Declares the input/result contract for NativeClipboardDescendantFactory in NativeClipboardDescendantFactory. Module responsibility: Owns descendant clipboard-policy channels, retaining loaded rules and exposing channel failure after exit.
 * 输入 / Inputs: file: string; owner: string; receive: ( request: NativeClipboardDescendantRequest, broker: NativeClipboardDescendantBroker,…; failed: (error: Error) => void
 * 输出 / Returns: Promise<NativeClipboardDescendantChannel>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
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
/**
 * 入口 / Entry: nativeClipboardDescendants.
 * 功能：启动受管后代策略代理并建立有界控制通道，验证代理就绪与进程身份。
 * Purpose: Starts a managed descendant-policy broker and bounded control channel, verifying readiness/process identity.
 * 设计：控制消息需匹配原代理 PID，断开终止原参与者并保留已装载规则状态；关闭等候实际进程退出。
 * Design: Messages match the broker PID; disconnect ends original participants while retaining loaded rule state, and close awaits physical exit.
 * 输入 / Inputs: file; owner; receive; failed
 * 输出 / Returns: `{ process: broker, get closure() { return closure; }, get alive() { return alive && !closing; }, async close() { closing = tr…`.
 * 副作用 / Effects: `processSupervisor.observe`; `child.stdout.setEncoding`; `setTimeout`; `child.kill`; `clearTimeout`.
 * 拒绝 / Refusals: 异常 / errors `error`.
 * 收尾：退出 try 区域时始终执行 `clearTimeout(timeout);`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `clearTimeout(timeout);`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `child.stdin.end();`; `child.kill();`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `child.stdin.end();`; `child.kill();`; these statements determine whether a failure is absorbed or rejected again.
 */
export const nativeClipboardDescendants: NativeClipboardDescendantFactory = async (
  file,
  owner,
  receive,
  failed,
) => {
  const owned = await processSupervisor.observe('clipboard-descendants', () => spawn(file, ['descendants', owner], {
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  }), { owner: `clipboard:${owner}` });
  const child = owned.child as import('node:child_process').ChildProcessWithoutNullStreams;
  let alive = true,
    closing = false,
    output = '',
    broker: NativeClipboardDescendantBroker | undefined;
  let resolveReady!:
  /**
   * 中文功能：异步原生后代启动准备的 Promise 完成或失败通道。
   * English: Promise completion/failure channel for native-descendant startup readiness.
   * 所属 / Owner: nativeClipboardDescendants.resolveReady.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void`.
   */
  () => void, rejectReady!:
  /**
   * 中文功能：异步原生后代启动准备的 Promise 完成或失败通道。
   * English: Promise completion/failure channel for native-descendant startup readiness.
   * 所属 / Owner: nativeClipboardDescendants.rejectReady.
   * 输入 / Inputs: error: Error.
   * 结果 / Result: `void`.
   */
  (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const active = new Map<string, Promise<void>>();
  let closure: NativeClipboardDescendantChannel['closure'];
  child.once('close', (code, signal) => { closure = { code, signal, at: new Date().toISOString() }; });
  /**
   * 入口 / Entry: stop.
   * 功能：在管理原生剪贴板后代策略通道中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`native-clipboard-descendants.ts`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `native-clipboard-descendants.ts`; the calls and state transitions below complete the operation. Module context: Owns descendant clipboard-policy channels, retaining loaded rules and exposing channel failure after exit.
   * 处理：通过 `rejectReady`, `failed`, `child.stdin.end`, `child.kill` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `rejectReady`, `failed`, `child.stdin.end`, `child.kill`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!closing`.
   * 输入 / Inputs: error: Error
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `child.kill`; 更新 / updates `closing`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
  /**
   * 入口 / Entry: callback@95.
   * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（child.stdout.on / data）。
   * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (child.stdout.on / data).
   * 输入 / Inputs: chunk: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `stop`; `output.slice().replace`; `active.set`; 更新 / updates `output`, `end`, `broker`.
   * 拒绝 / Refusals: 条件 / conditions `!broker`; `message.pid !== child.pid`; `active.size >= 64 || active.has(request.id)`; 异常 / errors `new Error('子进程策略通道身份不一致')`; `new Error('子进程策略通道请求重复或超出上限')`.
   * 失败处理：catch 分支执行 `stop(error instanceof Error ? error : new Error(String(error)));`; `return;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `stop(error instanceof Error ? error : new Error(String(error)));`; `return;`; these statements determine whether a failure is absorbed or rejected again.
   */
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
  } catch (error) {
    child.stdin.end(); child.kill();
    await owned.waitForClose();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  return {
    process: broker,
    /**
     * 入口 / Entry: closure.
     * 功能：向调用者提供 `closure` 的当前视图，不复制独立的业务状态。
     * Purpose: Exposes the current `closure` view rather than creating separate domain state.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `closure`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    get closure() {
      return closure;
    },
    /**
     * 入口 / Entry: alive.
     * 功能：向调用者提供 `alive && !closing` 的当前视图，不复制独立的业务状态。
     * Purpose: Exposes the current `alive && !closing` view rather than creating separate domain state.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `alive && !closing`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    get alive() {
      return alive && !closing;
    },
    /**
     * 入口 / Entry: close.
     * 功能：在管理原生剪贴板后代策略通道中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`native-clipboard-descendants.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `native-clipboard-descendants.ts`; the calls and state transitions below complete the operation. Module context: Owns descendant clipboard-policy channels, retaining loaded rules and exposing channel failure after exit.
     * 处理：通过 `child.stdin.end`, `setTimeout`, `owned.waitForClose`, `Promise.allSettled` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `child.stdin.end`, `setTimeout`, `owned.waitForClose`, `Promise.allSettled`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `setTimeout`; `clearTimeout`; 更新 / updates `closing`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 收尾：退出 try 区域时始终执行 `clearTimeout(timeout);`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `clearTimeout(timeout);`; these steps also apply to exceptional exits.
     */
    async close() {
      closing = true;
      child.stdin.end();
      const timeout = setTimeout(() => child.kill(), 5000);
      try {
        await owned.waitForClose(10000);
        await Promise.allSettled([...active.values()]);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
};
