/**
 * 模块职责：封装 SSH 连接与通道的受限方法，关联申请生命周期及实际传输资源。
 * Module purpose: Wraps restricted SSH connection/channel methods with admission lifecycles and physical transport ownership.
 */
import { AppError } from '../shared/errors.ts';
import { vmStreamPort } from './vm-stream-port.ts';

const events = new Set([
  'on',
  'once',
  'addListener',
  'prependListener',
  'prependOnceListener',
  'off',
  'removeListener',
  'removeAllListeners',
  'listenerCount',
  'eventNames',
]);
const clientMethods = new Set([
  'exec',
  'shell',
  'subsys',
  'sftp',
  'forwardIn',
  'forwardOut',
  'openssh_forwardInStreamLocal',
  'openssh_forwardOutStreamLocal',
]);
const clientCleanup = new Set(['end', 'destroy', 'unforwardIn', 'openssh_unforwardInStreamLocal']);
const fileMethods = new Set([
  'fastGet',
  'fastPut',
  'readFile',
  'writeFile',
  'appendFile',
  'createReadStream',
  'createWriteStream',
  'open',
  'read',
  'write',
  'fstat',
  'fsetstat',
  'futimes',
  'fchown',
  'fchmod',
  'opendir',
  'readdir',
  'unlink',
  'rename',
  'mkdir',
  'rmdir',
  'stat',
  'exists',
  'lstat',
  'setstat',
  'utimes',
  'chown',
  'chmod',
  'readlink',
  'symlink',
  'realpath',
  'ext_openssh_rename',
  'ext_openssh_statvfs',
  'ext_openssh_fstatvfs',
  'ext_openssh_hardlink',
  'ext_openssh_fsync',
]);
const fileCleanup = new Set(['end', 'destroy', 'close']);
const registrations = new Set(['on', 'once', 'addListener', 'prependListener', 'prependOnceListener']);
/**
 * 签名 / Signature: CallbackDispatch.CallbackDispatch.
 * 功能：为封装 SSH 连接与通道的受限方法声明 CallbackDispatch 的输入与结果契约，所属容器为 CallbackDispatch。
 * Purpose: Declares the input/result contract for CallbackDispatch in CallbackDispatch. Module responsibility: Wraps restricted SSH connection/channel methods with admission lifecycles and physical transport ownership.
 * 输入 / Inputs: work: () => R
 * 输出 / Returns: R.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
type CallbackDispatch = <R>(work: () => R) => R;
const managedValues = new WeakSet<object>();

/** A cached transport admits each new command, rather than exposing its socket or protocol object. */
/**
 * 入口 / Entry: vmTransportPort.
 * 功能：给 SSH 连接和通道建立限制访问视图，包装方法回调与返回流。
 * Purpose: Builds limited SSH connection/channel views, wrapping callbacks and returned streams.
 * 设计：创建、申请结束和物理连接状态共同约束调用；事件包装与清理回执仍绑定原资源，禁止公开内部实现。
 * Design: Creation/admission completion/physical state constrain calls; events/cleanup remain original-resource-bound without exposing internals.
 * 输入 / Inputs: target: T; kind: 'client' | 'sftp'; admit: <R>(work: () => R) => R; dispatchCallback: CallbackDispatch default=(work) => work()
 * 输出 / Returns: T；结果来自 / values from `port`.
 * 副作用 / Effects: `managedValues.add`; 更新 / updates `port`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function vmTransportPort<T extends object>(
  target: T,
  kind: 'client' | 'sftp',
  admit: <R>(work: () => R) => R,
  dispatchCallback: CallbackDispatch = (work) => work(),
): T {
  let port: T;
  const created = new Set<string>();
  type Listener = { original: Function;
  /**
   * 签名 / Signature: vmTransportPort.Listener.wrapped.
   * 功能：为封装 SSH 连接与通道的受限方法声明 wrapped 的输入与结果契约，所属容器为 vmTransportPort.Listener。
   * Purpose: Declares the input/result contract for wrapped in vmTransportPort.Listener. Module responsibility: Wraps restricted SSH connection/channel methods with admission lifecycles and physical transport ownership.
   * 输入 / Inputs: args: unknown[]
   * 输出 / Returns: unknown.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  wrapped: (...args: unknown[]) => unknown };
  const listeners = new Map<unknown, Listener[]>();
  const connections = new WeakMap<Function, { settled: boolean }>();
  const methods = kind === 'client' ? clientMethods : fileMethods;
  const cleanup = kind === 'client' ? clientCleanup : fileCleanup;
  /**
   * 入口 / Entry: vmTransportPort.stream.
   * 功能：在封装 SSH 连接与通道的受限方法中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`vm-transport-port.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-transport-port.ts`; this entry produces `result` for its caller. Module context: Wraps restricted SSH connection/channel methods with admission lifecycles and physical transport ownership.
   * 处理：通过 `vmStreamPort`, `managedValues.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `vmStreamPort`, `managedValues.add`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: value: object
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `managedValues.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const stream = (value: object) => {
    const result = vmStreamPort(value, dispatchCallback);
    managedValues.add(result);
    return result;
  };
  /**
   * 入口 / Entry: vmTransportPort.callMember.
   * 功能：在封装 SSH 连接与通道的受限方法中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result === target ? port : result` 供上层消费（`vm-transport-port.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-transport-port.ts`; this entry produces `result === target ? port : result` for its caller. Module context: Wraps restricted SSH connection/channel methods with admission lifecycles and physical transport ownership.
   * 处理：通过 `Reflect.get`, `Reflect.apply` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Reflect.get`, `Reflect.apply`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: key: string; args: unknown[]
   * 输出 / Returns: `result === target ? port : result`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `typeof member !== 'function'`; 异常 / errors `new AppError('传输方法不可用', 403, 'PLUGIN_SERVICE_PRIVATE')`.
   */
  const callMember = (key: string, args: unknown[]) => {
    const member = Reflect.get(target as object, key, target);
    if (typeof member !== 'function') throw new AppError('传输方法不可用', 403, 'PLUGIN_SERVICE_PRIVATE');
    const result = Reflect.apply(member, target, args);
    return result === target ? port : result;
  };
  /**
   * 入口 / Entry: vmTransportPort.forget.
   * 功能：在封装 SSH 连接与通道的受限方法中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`vm-transport-port.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-transport-port.ts`; this entry produces `void` for its caller. Module context: Wraps restricted SSH connection/channel methods with admission lifecycles and physical transport ownership.
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
   * 入口 / Entry: vmTransportPort.publicValue.
   * 功能：在封装 SSH 连接与通道的受限方法中，执行此领域的具体处理步骤并返回其结果；本入口产生 `port` / `value` 供上层消费（`vm-transport-port.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-transport-port.ts`; this entry produces `port` / `value` for its caller. Module context: Wraps restricted SSH connection/channel methods with admission lifecycles and physical transport ownership.
   * 处理：通过 `managedValues.has`, `Reflect.get`, `stream` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `managedValues.has`, `Reflect.get`, `stream`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value === target`; `value && typeof value === 'object' && managedValues.has(value)`; `typeof value === 'function'`.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: unknown；结果来自 / values from `port`; `value`; `(...args: unknown[]) => admit(() => publicValue(Reflect.apply(value, undefined, args)))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const publicValue = (value: unknown): unknown => {
    if (value === target) return port;
    if (value && typeof value === 'object' && managedValues.has(value)) return value;
    if (typeof value === 'function')
      return (...args: unknown[]) => admit(() => publicValue(Reflect.apply(value, undefined, args)));
    if (value && typeof value === 'object' && typeof Reflect.get(value, 'pipe') === 'function')
      return stream(value);
    return value;
  };
  /**
   * 入口 / Entry: vmTransportPort.callback.
   * 功能：在封装 SSH 连接与通道的受限方法中，执行此领域的具体处理步骤并返回其结果；本入口产生 `dispatchCallback(() => Reflect.apply( work, port, args.map((value, index) => { if (receipt && typeof value === 'function' && …` 供上层消费（`vm-transport-port.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-transport-port.ts`; this entry produces `dispatchCallback(() => Reflect.apply( work, port, args.map((value, index) => { if (receipt && typeof value === 'function' && …` for its caller. Module context: Wraps restricted SSH connection/channel methods with admission lifecycles and physical transport ownership.
   * 处理：通过 `connections.get`, `connections.set`, `dispatchCallback` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `connections.get`, `connections.set`, `dispatchCallback`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `accept && receipt`.
   * 输入 / Inputs: work: Function; args: unknown[]; connection: default=false
   * 输出 / Returns: `dispatchCallback(() => Reflect.apply( work, port, args.map((value, index) => { if (receipt && typeof value === 'function' && …`.
   * 副作用 / Effects: `connections.get`; `connections.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const callback = (work: Function, args: unknown[], connection = false) => {
    const accept = connection && typeof args[1] === 'function' ? args[1] : undefined;
    const receipt = accept ? connections.get(accept) || { settled: false } : undefined;
    if (accept && receipt) connections.set(accept, receipt);
    /**
     * 入口 / Entry: vmTransportPort.callback@122.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（args.map）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (args.map).
     * 输入 / Inputs: value; index
     * 输出 / Returns: `(...input: unknown[]) => index === 2 ? dispatchCallback(() => finish(...input)) : admit(() => finish(...input))`; `publicValue(value)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return dispatchCallback(() =>
      Reflect.apply(
        work,
        port,
        args.map(
        /**
         * 中文功能：对连接请求回调建立一次性 receipt；接受回调走新工作准入，拒绝回调只退役原 pending 请求，其他值经过公共视图包装。
         * English: Builds a one-shot receipt for connection callbacks: acceptance uses new-work admission, rejection retires only the original pending request, and other values receive public-view wrapping.
         * 所属 / Owner: vmTransportPort.callback.
         * 输入 / Inputs: value; index.
         */
        (value, index) => {
          if (receipt && typeof value === 'function' && (index === 1 || index === 2)) {
            /**
             * 入口 / Entry: vmTransportPort.finish.
             * 功能：在封装 SSH 连接与通道的受限方法中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` / `result` 供上层消费（`vm-transport-port.ts`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-transport-port.ts`; this entry produces `void` / `result` for its caller. Module context: Wraps restricted SSH connection/channel methods with admission lifecycles and physical transport ownership.
             * 处理：通过 `publicValue`, `Reflect.apply` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `publicValue`, `Reflect.apply`; the branches below determine continuation, return or refusal.
             * 分支 / Branches: `index === 2`.
             * 输入 / Inputs: input: unknown[]
             * 输出 / Returns: `void`; `result`.
             * 副作用 / Effects: 更新 / updates `receipt.settled`.
             * 拒绝 / Refusals: 条件 / conditions `receipt.settled`; 异常 / errors `new AppError('连接申请已经结束', 409, 'PLUGIN_TRANSPORT_SETTLED')`.
             */
            const finish = (...input: unknown[]) => {
              if (receipt.settled) {
                if (index === 2) return;
                throw new AppError('连接申请已经结束', 409, 'PLUGIN_TRANSPORT_SETTLED');
              }
              const result = publicValue(Reflect.apply(value, undefined, input));
              receipt.settled = true;
              return result;
            };
            // Reject only the original pending connection; accepting still starts new work.
            return (...input: unknown[]) =>
              index === 2 ? dispatchCallback(() => finish(...input)) : admit(() => finish(...input));
          }
          return publicValue(value);
        }),
      ),
    );
  };
  port = new Proxy(Object.create(null), {
    /**
     * 入口 / Entry: vmTransportPort.get.
     * 功能：解析 SSH 代理公开方法、清理与事件入口并检查调用资格。
     * Purpose: Resolves public SSH methods/cleanup/events and checks call eligibility.
     * 设计：白名单阻止内部访问；回调传出的流再次包装，已结束申请不再允许扩展连接资源。
     * Design: Whitelists block internals, callback streams are rewrapped and settled admission cannot create additional resources.
     * 输入 / Inputs: _shadow; key
     * 输出 / Returns: `undefined`; `(...args: unknown[]) => { const call = () => { if (registrations.has(key) && typeof args[1] === 'function') { const event = a…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `typeof key !== 'string' || !(methods.has(key) || cleanup.has(key) || events.has(key))`; 异常 / errors `new AppError('传输内部实现不可访问', 403, 'PLUGIN_SERVICE_PRIVATE')`.
     */
    get: (_shadow, key) => {
      if (key === 'then') return undefined;
      if (typeof key !== 'string' || !(methods.has(key) || cleanup.has(key) || events.has(key)))
        throw new AppError('传输内部实现不可访问', 403, 'PLUGIN_SERVICE_PRIVATE');
      /**
       * 入口 / Entry: vmTransportPort.callback@147.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
       * 输入 / Inputs: args: unknown[]
       * 输出 / Returns: `call()`; `methods.has(key) || registrations.has(key) ? admit(call) : call()`.
       * 副作用 / Effects: `created.has`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      return (...args: unknown[]) => {
        /**
         * 入口 / Entry: vmTransportPort.call.
         * 功能：包装 SSH 方法参数与事件回调，把所有交付通道接入受管流视图。
         * Purpose: Wraps SSH method arguments/listeners and places delivered channels behind managed stream views.
         * 设计：原 callback 与代理 callback 成对记录；移除只影响本代理注册，方法调用保留原 this 和错误语义。
         * Design: Original/proxy callbacks are paired, removal affects only this proxy and calls retain original receivers/failure semantics.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `callMember( key === 'once' ? 'on' : key === 'prependOnceListener' ? 'prependListener' : key, [event, entry.wrapped], )`; `callMember(key, args)`; `port`；另有分支返回 / additional branch-specific returns.
         * 副作用 / Effects: `listeners.get`; `entries.unshift`; `entries.push`; `listeners.set`; `listeners.get().findLast`.
         * 拒绝 / Refusals: 条件 / conditions `registrations.has(key) && typeof args[1] === 'function'`; 异常 / errors `error`.
         * 失败处理：catch 分支执行 `forget(event, entry);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `forget(event, entry);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
         */
        const call = () => {
          if (registrations.has(key) && typeof args[1] === 'function') {
            const event = args[0],
              original = args[1];
            const once = key === 'once' || key === 'prependOnceListener';
            const entry: Listener = {
              original,
              /**
               * 入口 / Entry: vmTransportPort.wrapped.
               * 功能：在封装 SSH 连接与通道的受限方法中，执行此领域的具体处理步骤并返回其结果；本入口产生 `callback( original, input.map((value) => (value === target ? port : value)), kind === 'client' && (event === 'tcp connection'…` 供上层消费（`vm-transport-port.ts`）。
               * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-transport-port.ts`; this entry produces `callback( original, input.map((value) => (value === target ? port : value)), kind === 'client' && (event === 'tcp connection'…` for its caller. Module context: Wraps restricted SSH connection/channel methods with admission lifecycles and physical transport ownership.
               * 处理：通过 `forget`, `callMember`, `callback`, `input.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
               * Processing: Coordinates its dependencies through `forget`, `callMember`, `callback`, `input.map`; the branches below determine continuation, return or refusal.
               * 分支 / Branches: `once`.
               * 输入 / Inputs: input
               * 输出 / Returns: `callback( original, input.map((value) => (value === target ? port : value)), kind === 'client' && (event === 'tcp connection'…`.
               * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              wrapped: (...input) => {
                if (once) {
                  forget(event, entry);
                  callMember('removeListener', [event, entry.wrapped]);
                }
                return callback(
                  original,
                  input.map((value) => (value === target ? port : value)),
                  kind === 'client' && (event === 'tcp connection' || event === 'unix connection'),
                );
              },
            };
            const entries = listeners.get(event) || [];
            if (key === 'prependListener' || key === 'prependOnceListener') entries.unshift(entry);
            else entries.push(entry);
            listeners.set(event, entries);
            try {
              return callMember(
                key === 'once' ? 'on' : key === 'prependOnceListener' ? 'prependListener' : key,
                [event, entry.wrapped],
              );
            } catch (error) {
              forget(event, entry);
              throw error;
            }
          }
          if (key === 'off' || key === 'removeListener') {
            if (typeof args[1] !== 'function') return callMember(key, args);
            const entry = listeners.get(args[0])?.findLast((item) => item.original === args[1]);
            if (entry) {
              forget(args[0], entry);
              callMember('removeListener', [args[0], entry.wrapped]);
            }
            return port;
          }
          if (key === 'removeAllListeners') {
            const events = args.length ? [args[0]] : [...listeners.keys()];
            for (const event of events)
              for (const entry of [...(listeners.get(event) || [])].reverse()) {
                forget(event, entry);
                callMember('removeListener', [event, entry.wrapped]);
              }
            return port;
          }
          if (key === 'listenerCount' && typeof args[1] === 'function')
            return listeners.get(args[0])?.filter((item) => item.original === args[1]).length || 0;
          /**
           * 入口 / Entry: vmTransportPort.callback@203.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（args.map）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (args.map).
           * 输入 / Inputs: input: unknown[]
           * 输出 / Returns: `callback( arg, input.map((value) => (value === target ? port : value)), )`.
           * 副作用 / Effects: `created.delete`; 更新 / updates `input[1]`.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          const forwarded = args.map((arg, index) =>
            typeof arg === 'function'
              ?
              /**
               * 中文功能：将 SFTP 与客户机流回复包装为受限能力，成功 unlink/rename 清除创建追踪，并把返回的原 target 替换为公开 port。
               * English: Wraps SFTP/client-stream replies as restricted capabilities, clears creation tracking after successful unlink/rename and substitutes the public port for returned raw targets.
               * 所属 / Owner: vmTransportPort.get.call.forwarded.
               * 输入 / Inputs: ...input: unknown[].
               */
              (...input: unknown[]) => {
                  if (key === 'sftp' && index === 0 && input[1])
                    input[1] = vmTransportPort(input[1] as object, 'sftp', admit, dispatchCallback);
                  else if (
                    kind === 'client' &&
                    input[0] == null &&
                    input[1] &&
                    typeof input[1] === 'object' &&
                    ['exec', 'shell', 'subsys', 'forwardOut', 'openssh_forwardOutStreamLocal'].includes(key)
                  )
                    input[1] = stream(input[1] as object);
                  if (
                    kind === 'sftp' &&
                    (key === 'unlink' || key === 'rename' || key === 'ext_openssh_rename') &&
                    typeof args[0] === 'string' &&
                    input[0] == null
                  )
                    created.delete(args[0]);
                  return callback(
                    arg,
                    input.map((value) => (value === target ? port : value)),
                  );
                }
              : arg,
          );
          const result: any = callMember(key, forwarded);
          if (
            kind === 'sftp' &&
            key === 'createWriteStream' &&
            typeof args[0] === 'string' &&
            (args[1] as { flags?: string } | undefined)?.flags === 'wx'
          ) {
            const path = args[0];
            result.once('open', () => created.add(path));
          }
          return kind === 'sftp' && (key === 'createReadStream' || key === 'createWriteStream')
            ? stream(result as object)
            : result;
        };
        // The original exclusive-create receipt only permits removing that temporary path.
        if (kind === 'sftp' && key === 'unlink' && typeof args[0] === 'string' && created.has(args[0]))
          return call();
        return methods.has(key) || registrations.has(key) ? admit(call) : call();
      };
    },
    /**
     * 入口 / Entry: vmTransportPort.set.
     * 功能：在封装 SSH 连接与通道的受限方法中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`vm-transport-port.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `vm-transport-port.ts`; the calls and state transitions below complete the operation. Module context: Wraps restricted SSH connection/channel methods with admission lifecycles and physical transport ownership.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 异常 / errors `new AppError('传输接口不可写', 403, 'PLUGIN_SERVICE_READONLY')`.
     */
    set: () => {
      throw new AppError('传输接口不可写', 403, 'PLUGIN_SERVICE_READONLY');
    },
    /**
     * 入口 / Entry: vmTransportPort.defineProperty.
     * 功能：从当前输入或状态计算 `false`，供调用方后续验证或使用。
     * Purpose: Computes `false` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `false`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    defineProperty: () => false,
    /**
     * 入口 / Entry: vmTransportPort.deleteProperty.
     * 功能：从当前输入或状态计算 `false`，供调用方后续验证或使用。
     * Purpose: Computes `false` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `false`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    deleteProperty: () => false,
  }) as T;
  managedValues.add(port);
  return port;
}
