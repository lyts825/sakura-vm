/**
 * 模块职责：提供原服务清理能力视图，只允许零参数清理回执调用以防清理权限扩张。
 * Module purpose: Exposes original cleanup capability views, allowing only zero-argument receipts to prevent authority expansion.
 */
import { AppError } from '../shared/errors.ts';
import { isCleanupReceipt } from './cleanup-receipt.ts';
import { withPluginCleanup } from './plugin-authority.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { PUBLIC_SERVICE_CONTRACTS } from './public-service-members.ts';
import type { ServiceContract } from './service-ref.ts';

/** Cleanup keeps read-only data and original receipts, without restoring business handles. */
/**
 * 入口 / Entry: cleanupService.
 * 功能：把本层请求转交 `wrap`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `wrap` and propagates the provider result or rejection.
 * 输入 / Inputs: value: T; contract: ServiceContract<T>; provider: PluginInstance; check: () => void
 * 输出 / Returns: T；结果来自 / values from `wrap(value, contract) as T`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function cleanupService<T>(value: T, contract: ServiceContract<T>, provider: PluginInstance,
  check: () => void): T {
  /**
   * 入口 / Entry: cleanupService.denied.
   * 功能：从当前输入或状态计算 `new AppError('清理期间只允许原资源的零参数清理回执', 403, 'PLUGIN_CLEANUP_RECEIPT')`，供调用方后续验证或使用。
   * Purpose: Computes `new AppError('清理期间只允许原资源的零参数清理回执', 403, 'PLUGIN_CLEANUP_RECEIPT')` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `new AppError('清理期间只允许原资源的零参数清理回执', 403, 'PLUGIN_CLEANUP_RECEIPT')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  const denied = () => new AppError('清理期间只允许原资源的零参数清理回执', 403, 'PLUGIN_CLEANUP_RECEIPT');
  /**
   * 入口 / Entry: cleanupService.descriptor.
   * 功能：从当前输入或状态计算 `typeof shape === 'string' ? PUBLIC_SERVICE_CONTRACTS[shape] : shape`，供调用方后续验证或使用。
   * Purpose: Computes `typeof shape === 'string' ? PUBLIC_SERVICE_CONTRACTS[shape] : shape` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: shape: string | ServiceContract<any> optional
   * 输出 / Returns: `typeof shape === 'string' ? PUBLIC_SERVICE_CONTRACTS[shape] : shape`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  const descriptor = (shape?: string | ServiceContract<any>) =>
    typeof shape === 'string' ? PUBLIC_SERVICE_CONTRACTS[shape] : shape;
  /**
   * 入口 / Entry: cleanupService.wrap.
   * 功能：在提供原服务清理能力视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `current` / `() => { check(); throw denied(); }` 供上层消费（`service-cleanup.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `service-cleanup.ts`; this entry produces `current` / `() => { check(); throw denied(); }` for its caller. Module context: Exposes original cleanup capability views, allowing only zero-argument receipts to prevent authority expansion.
   * 处理：通过 `check`, `isCleanupReceipt`, `current.then`, `current.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `check`, `isCleanupReceipt`, `current.then`, `current.map`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `current === null || (typeof current !== 'object' && typeof current !== 'function')`; `typeof current === 'function'`; `!isCleanupReceipt(current)`.
   * 输入 / Inputs: current: any; shape: ServiceContract<any> optional
   * 输出 / Returns: any；结果来自 / values from `current`; `() => { check(); throw denied(); }`; `(...args: unknown[]) => { check(); if (args.length) throw denied(); const result = withPluginCleanup(provider, () => Reflect.…`.
   * 副作用 / Effects: 更新 / updates `copy[key]`.
   * 拒绝 / Refusals: 条件 / conditions `!shape`; `!('value' in field) || typeof field.value === 'function'`; 异常 / errors `denied()`.
   */
  const wrap = (current: any, shape?: ServiceContract<any>): any => {
    check();
    if (current === null || (typeof current !== 'object' && typeof current !== 'function')) return current;
    if (typeof current === 'function') {
      if (!isCleanupReceipt(current)) return () => { check(); throw denied(); };
      /**
       * 入口 / Entry: cleanupService.callback@22.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
       * 输入 / Inputs: args: unknown[]
       * 输出 / Returns: `result instanceof Promise ? result.then(item => wrap(item)) : wrap(result)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `args.length`; 异常 / errors `denied()`.
       */
      return (...args: unknown[]) => {
        check();
        if (args.length) throw denied();
        const result = withPluginCleanup(provider, () => Reflect.apply(current, undefined, []));
        return result instanceof Promise ? result.then(item => wrap(item)) : wrap(result);
      };
    }
    if (current instanceof Promise) return current.then(item => wrap(item, shape));
    if (!shape) {
      // Data snapshots carry no executable methods, accessors, or mutable provider references.
      if (Array.isArray(current)) return Object.freeze(current.map(item => wrap(item)));
      const copy: Record<string, unknown> = Object.create(null);
      for (const [key, field] of Object.entries(Object.getOwnPropertyDescriptors(current))) {
        if (!field.enumerable) continue;
        if (!('value' in field) || typeof field.value === 'function') throw denied();
        copy[key] = wrap(field.value);
      }
      return Object.freeze(copy);
    }
    const keys = new Set(shape.members);
    return new Proxy(Object.create(null), {
      /**
       * 入口 / Entry: cleanupService.has.
       * 功能：在提供原服务清理能力视图中，执行此领域的具体处理步骤并返回其结果；本入口产生 `typeof key === 'string' && keys.has(key) && Reflect.has(current, key)` 供上层消费（`service-cleanup.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `service-cleanup.ts`; this entry produces `typeof key === 'string' && keys.has(key) && Reflect.has(current, key)` for its caller. Module context: Exposes original cleanup capability views, allowing only zero-argument receipts to prevent authority expansion.
       * 处理：通过 `check`, `keys.has`, `Reflect.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `check`, `keys.has`, `Reflect.has`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: _target; key
       * 输出 / Returns: `typeof key === 'string' && keys.has(key) && Reflect.has(current, key)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      has: (_target, key) => { check(); return typeof key === 'string' && keys.has(key) && Reflect.has(current, key); },
      /**
       * 入口 / Entry: cleanupService.get.
       * 功能：在提供原服务清理能力视图中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `undefined` / `wrap(Reflect.get(current, key, current), descriptor(shape.properties?.[key]))` 供上层消费（`service-cleanup.ts`）。
       * Purpose: Reads/verifies domain state and constructs a caller-facing result in `service-cleanup.ts`; this entry produces `undefined` / `wrap(Reflect.get(current, key, current), descriptor(shape.properties?.[key]))` for its caller. Module context: Exposes original cleanup capability views, allowing only zero-argument receipts to prevent authority expansion.
       * 处理：通过 `check`, `keys.has`, `wrap`, `Reflect.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `check`, `keys.has`, `wrap`, `Reflect.get`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `key === 'then' && !keys.has('then')`.
       * 输入 / Inputs: _target; key
       * 输出 / Returns: `undefined`; `wrap(Reflect.get(current, key, current), descriptor(shape.properties?.[key]))`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `typeof key !== 'string' || !keys.has(key)`; 异常 / errors `new AppError('服务内部实现不可访问', 403, 'PLUGIN_SERVICE_PRIVATE')`.
       */
      get: (_target, key) => {
        check();
        if (key === 'then' && !keys.has('then')) return undefined;
        if (typeof key !== 'string' || !keys.has(key))
          throw new AppError('服务内部实现不可访问', 403, 'PLUGIN_SERVICE_PRIVATE');
        return wrap(Reflect.get(current, key, current), descriptor(shape.properties?.[key]));
      },
      /**
       * 入口 / Entry: cleanupService.set.
       * 功能：在提供原服务清理能力视图中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`service-cleanup.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `service-cleanup.ts`; the calls and state transitions below complete the operation. Module context: Exposes original cleanup capability views, allowing only zero-argument receipts to prevent authority expansion.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 异常 / errors `new AppError('公共服务接口不可写', 403, 'PLUGIN_SERVICE_READONLY')`.
       */
      set: () => { throw new AppError('公共服务接口不可写', 403, 'PLUGIN_SERVICE_READONLY'); },
      /**
       * 入口 / Entry: cleanupService.defineProperty.
       * 功能：从当前输入或状态计算 `false`，供调用方后续验证或使用。
       * Purpose: Computes `false` from current inputs/state for the caller to validate or consume.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `false`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      defineProperty: () => false,
      /**
       * 入口 / Entry: cleanupService.deleteProperty.
       * 功能：从当前输入或状态计算 `false`，供调用方后续验证或使用。
       * Purpose: Computes `false` from current inputs/state for the caller to validate or consume.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `false`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      deleteProperty: () => false,
    });
  };
  return wrap(value, contract) as T;
}
