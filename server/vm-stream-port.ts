/**
 * 模块职责：为传输流提供受限接口视图，隐藏内部实现并校验流操作的原身份。
 * Module purpose: Provides limited transport-stream views, hiding implementation details and checking original identity on operations.
 */
import { AppError } from '../shared/errors.ts';

const methods = new Set([
  'emit',
  'pipe',
  'unpipe',
  'read',
  'write',
  'end',
  'destroy',
  'pause',
  'resume',
  'isPaused',
  'cork',
  'uncork',
  'setEncoding',
  'setDefaultEncoding',
  'close',
  'signal',
  'setWindow',
  'iterator',
]);
const registrations = new Set(['on', 'once', 'addListener', 'prependListener', 'prependOnceListener']);
const properties = new Set([
  'readable',
  'writable',
  'destroyed',
  'closed',
  'errored',
  'readableAborted',
  'readableDidRead',
  'readableEnded',
  'readableErrored',
  'readableFlowing',
  'readableHighWaterMark',
  'readableLength',
  'readableObjectMode',
  'writableAborted',
  'writableCorked',
  'writableEnded',
  'writableErrored',
  'writableFinished',
  'writableHighWaterMark',
  'writableLength',
  'writableNeedDrain',
  'writableObjectMode',
  'bytesRead',
  'bytesWritten',
  'pending',
  'stderr',
  'stdout',
  'exitCode',
  'signalCode',
  '_readableState',
  '_writableState',
]);
type Listener = { original: Function;
/**
 * 签名 / Signature: Listener.wrapped.
 * 功能：为为传输流提供受限接口视图声明 wrapped 的输入与结果契约，所属容器为 Listener。
 * Purpose: Declares the input/result contract for wrapped in Listener. Module responsibility: Provides limited transport-stream views, hiding implementation details and checking original identity on operations.
 * 输入 / Inputs: args: unknown[]
 * 输出 / Returns: unknown.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
wrapped: (...args: unknown[]) => unknown };

/** Node stream consumers keep their normal pipeline contract without receiving native transport internals. */
/**
 * 入口 / Entry: vmStreamPort.
 * 功能：包装传输流的公开方法和事件监听器，隐藏内部实现并保留原监听归属。
 * Purpose: Wraps public stream methods/listeners while hiding internals and retaining original listener ownership.
 * 设计：方法白名单和返回流包装防止逃逸，off 只移除本代理登记的监听；只读属性与请求内核字段按明确边界暴露。
 * Design: Whitelists/returned-stream wrapping prevent escape, off removes only proxy-owned listeners and properties follow explicit visibility boundaries.
 * 输入 / Inputs: target: T; dispatch: <R>(work: () => R) => R; cache: default=new WeakMap<object, object>()
 * 输出 / Returns: T；结果来自 / values from `existing as T`; `port`.
 * 副作用 / Effects: `cache.set`; 更新 / updates `port`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function vmStreamPort<T extends object>(
  target: T,
  dispatch: <R>(work: () => R) => R,
  cache = new WeakMap<object, object>(),
): T {
  const existing = cache.get(target);
  if (existing) return existing as T;
  const listeners = new Map<unknown, Listener[]>();
  let port: T;
  /**
   * 入口 / Entry: vmStreamPort.call.
   * 功能：在为传输流提供受限接口视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result === target ? port : result` 供上层消费（`vm-stream-port.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-stream-port.ts`; this entry produces `result === target ? port : result` for its caller. Module context: Provides limited transport-stream views, hiding implementation details and checking original identity on operations.
   * 处理：通过 `Reflect.get`, `Reflect.apply` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Reflect.get`, `Reflect.apply`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: key: PropertyKey; args: unknown[]
   * 输出 / Returns: `result === target ? port : result`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const call = (key: PropertyKey, args: unknown[]) => {
    const member = Reflect.get(target as object, key, target);
    const result = Reflect.apply(member, key === 'pipe' || key === 'unpipe' ? port : target, args);
    return result === target ? port : result;
  };
  /**
   * 入口 / Entry: vmStreamPort.forget.
   * 功能：在为传输流提供受限接口视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`vm-stream-port.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-stream-port.ts`; this entry produces `void` for its caller. Module context: Provides limited transport-stream views, hiding implementation details and checking original identity on operations.
   * 处理：通过 `listeners.get`, `entries.indexOf`, `entries.splice`, `listeners.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `listeners.get`, `entries.indexOf`, `entries.splice`, `listeners.delete`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!entries`; `index >= 0`; `!entries.length`.
   * 输入 / Inputs: event: unknown; entry: Listener
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `listeners.get`; `entries.splice`; `listeners.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const forget = (event: unknown, entry: Listener) => {
    const entries = listeners.get(event);
    if (!entries) return;
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    if (!entries.length) listeners.delete(event);
  };
  /**
   * 入口 / Entry: vmStreamPort.callback.
   * 功能：把本层请求转交 `dispatch`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `dispatch` and propagates the provider result or rejection.
   * 输入 / Inputs: work: Function; args: unknown[]
   * 输出 / Returns: `dispatch(() => Reflect.apply( work, port, args.map((value) => (value === target ? port : value)), ), )`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const callback = (work: Function, args: unknown[]) =>
    dispatch(() =>
      Reflect.apply(
        work,
        port,
        args.map((value) => (value === target ? port : value)),
      ),
    );
  port = new Proxy(Object.create(null), {
    /**
     * 入口 / Entry: vmStreamPort.get.
     * 功能：为流代理解析公开属性、方法和受管事件能力。
     * Purpose: Resolves public properties/methods/managed events on a stream proxy.
     * 设计：只允许白名单接口；事件函数包装保留原 callback 对照，移除监听不会影响其他消费者。
     * Design: Only whitelisted interfaces resolve; wrapped callbacks retain original mappings so removal cannot affect other consumers.
     * 输入 / Inputs: _shadow; key
     * 输出 / Returns: `undefined`; `typeof value === 'function' ? (...args: unknown[]) => call(key, args) : value`; `(key === 'stderr' || key === 'stdout') && value && typeof value === 'object' ? vmStreamPort(value, dispatch, cache) : value`；另有分支返回 / additional branch-specific returns.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!( methods.has(key) || registrations.has(key) || ['off', 'removeListener', 'removeAllListeners', 'listenerCount', 'eventNames…`; 异常 / errors `new AppError('传输流内部实现不可访问', 403, 'PLUGIN_SERVICE_PRIVATE')`.
     */
    get: (_shadow, key) => {
      if (key === 'then') return undefined;
      if (
        typeof key === 'string' &&
        [
          'setHeader',
          'abort',
          'req',
          'aborted',
          '_consuming',
          '_dumped',
          '_sent100',
          '_removedConnection',
          '_removedContLen',
        ].includes(key)
      )
        return undefined; // Node's HTTP stream probes.
      if (typeof key === 'symbol') {
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? (...args: unknown[]) => call(key, args) : value;
      }
      if (properties.has(key)) {
        const value = Reflect.get(target, key, target);
        return (key === 'stderr' || key === 'stdout') && value && typeof value === 'object'
          ? vmStreamPort(value, dispatch, cache)
          : value;
      }
      if (!(
        methods.has(key) ||
        registrations.has(key) ||
        ['off', 'removeListener', 'removeAllListeners', 'listenerCount', 'eventNames'].includes(key)
      ))
        throw new AppError('传输流内部实现不可访问', 403, 'PLUGIN_SERVICE_PRIVATE');
      /**
       * 入口 / Entry: vmStreamPort.callback@126.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
       * 输入 / Inputs: args: unknown[]
       * 输出 / Returns: `call(key === 'once' ? 'on' : key === 'prependOnceListener' ? 'prependListener' : key, [ event, entry.wrapped, ])`; `port`; `listeners.get(args[0])?.filter((item) => item.original === args[1]).length || 0`；另有分支返回 / additional branch-specific returns.
       * 副作用 / Effects: `listeners.get`; `key.startsWith`; `entries.unshift`; `entries.push`; `listeners.set`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      return (...args: unknown[]) => {
        if (registrations.has(key) && typeof args[1] === 'function') {
          const event = args[0],
            original = args[1];
          const once = key === 'once' || key === 'prependOnceListener';
          const entry: Listener = {
            original,
            /**
             * 入口 / Entry: vmStreamPort.wrapped.
             * 功能：在为传输流提供受限接口视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `callback(original, input)` 供上层消费（`vm-stream-port.ts`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-stream-port.ts`; this entry produces `callback(original, input)` for its caller. Module context: Provides limited transport-stream views, hiding implementation details and checking original identity on operations.
             * 处理：通过 `forget`, `call`, `callback` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `forget`, `call`, `callback`; the branches below determine continuation, return or refusal.
             * 分支 / Branches: `once`.
             * 输入 / Inputs: input
             * 输出 / Returns: `callback(original, input)`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            wrapped: (...input) => {
              if (once) {
                forget(event, entry);
                call('removeListener', [event, entry.wrapped]);
              }
              return callback(original, input);
            },
          };
          const entries = listeners.get(event) || [];
          if (key.startsWith('prepend')) entries.unshift(entry);
          else entries.push(entry);
          listeners.set(event, entries);
          return call(key === 'once' ? 'on' : key === 'prependOnceListener' ? 'prependListener' : key, [
            event,
            entry.wrapped,
          ]);
        }
        if (key === 'off' || key === 'removeListener') {
          const entry = listeners.get(args[0])?.findLast((item) => item.original === args[1]);
          if (entry) {
            forget(args[0], entry);
            call('removeListener', [args[0], entry.wrapped]);
          }
          return port;
        }
        if (key === 'removeAllListeners') {
          for (const event of args.length ? [args[0]] : [...listeners.keys()])
            for (const entry of [...(listeners.get(event) || [])]) {
              forget(event, entry);
              call('removeListener', [event, entry.wrapped]);
            }
          return port;
        }
        if (key === 'listenerCount' && args.length > 1)
          return listeners.get(args[0])?.filter((item) => item.original === args[1]).length || 0;
        return call(
          key,
          args.map((arg) =>
            typeof arg === 'function' ? (...input: unknown[]) => callback(arg, input) : arg,
          ),
        );
      };
    },
    /**
     * 入口 / Entry: vmStreamPort.getPrototypeOf.
     * 功能：从当前输入或状态计算 `Object.getPrototypeOf(target)`，供调用方后续验证或使用。
     * Purpose: Computes `Object.getPrototypeOf(target)` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `Object.getPrototypeOf(target)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    getPrototypeOf: () => Object.getPrototypeOf(target),
    /**
     * 入口 / Entry: vmStreamPort.set.
     * 功能：在为传输流提供受限接口视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Reflect.set(target, key, value, target)` 供上层消费（`vm-stream-port.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-stream-port.ts`; this entry produces `Reflect.set(target, key, value, target)` for its caller. Module context: Provides limited transport-stream views, hiding implementation details and checking original identity on operations.
     * 处理：通过 `Reflect.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `Reflect.set`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `typeof key === 'symbol'`.
     * 输入 / Inputs: _shadow; key; value
     * 输出 / Returns: `Reflect.set(target, key, value, target)`.
     * 副作用 / Effects: `Reflect.set`.
     * 拒绝 / Refusals: 异常 / errors `new AppError('传输流接口不可写', 403, 'PLUGIN_SERVICE_READONLY')`.
     */
    set: (_shadow, key, value) => {
      if (typeof key === 'symbol') return Reflect.set(target, key, value, target);
      throw new AppError('传输流接口不可写', 403, 'PLUGIN_SERVICE_READONLY');
    },
    /**
     * 入口 / Entry: vmStreamPort.defineProperty.
     * 功能：从当前输入或状态计算 `false`，供调用方后续验证或使用。
     * Purpose: Computes `false` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `false`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    defineProperty: () => false,
    /**
     * 入口 / Entry: vmStreamPort.deleteProperty.
     * 功能：从当前输入或状态计算 `false`，供调用方后续验证或使用。
     * Purpose: Computes `false` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `false`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    deleteProperty: () => false,
  }) as T;
  cache.set(target, port);
  return port;
}
