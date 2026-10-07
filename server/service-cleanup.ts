/**
 * 模块职责：提供原服务清理能力视图，只允许零参数清理回执调用以防清理权限扩张。
 */
import { AppError } from '../shared/errors.ts';
import { isCleanupReceipt } from './cleanup-receipt.ts';
import { withPluginCleanup } from './plugin-authority.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { PUBLIC_SERVICE_CONTRACTS } from './public-service-members.ts';
import type { ServiceContract } from './service-ref.ts';

/** Cleanup keeps read-only data and original receipts, without restoring business handles. */
export function cleanupService<T>(value: T, contract: ServiceContract<T>, provider: PluginInstance,
  check: () => void): T {
  const denied = () => new AppError('清理期间只允许原资源的零参数清理回执', 403, 'PLUGIN_CLEANUP_RECEIPT');
  const descriptor = (shape?: string | ServiceContract<any>) =>
    typeof shape === 'string' ? PUBLIC_SERVICE_CONTRACTS[shape] : shape;
  const wrap = (current: any, shape?: ServiceContract<any>): any => {
    check();
    if (current === null || (typeof current !== 'object' && typeof current !== 'function')) return current;
    if (typeof current === 'function') {
      if (!isCleanupReceipt(current)) return () => { check(); throw denied(); };
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
      has: (_target, key) => { check(); return typeof key === 'string' && keys.has(key) && Reflect.has(current, key); },
      get: (_target, key) => {
        check();
        if (key === 'then' && !keys.has('then')) return undefined;
        if (typeof key !== 'string' || !keys.has(key))
          throw new AppError('服务内部实现不可访问', 403, 'PLUGIN_SERVICE_PRIVATE');
        return wrap(Reflect.get(current, key, current), descriptor(shape.properties?.[key]));
      },
      set: () => { throw new AppError('公共服务接口不可写', 403, 'PLUGIN_SERVICE_READONLY'); },
      defineProperty: () => false,
      deleteProperty: () => false,
    });
  };
  return wrap(value, contract) as T;
}
