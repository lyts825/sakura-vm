/**
 * 模块职责：为传输流提供受限接口视图，隐藏内部实现并校验流操作的原身份。
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
type Listener = { original: Function; wrapped: (...args: unknown[]) => unknown };

/** Node stream consumers keep their normal pipeline contract without receiving native transport internals. */
export function vmStreamPort<T extends object>(
  target: T,
  dispatch: <R>(work: () => R) => R,
  cache = new WeakMap<object, object>(),
): T {
  const existing = cache.get(target);
  if (existing) return existing as T;
  const listeners = new Map<unknown, Listener[]>();
  let port: T;
  const call = (key: PropertyKey, args: unknown[]) => {
    const member = Reflect.get(target as object, key, target);
    const result = Reflect.apply(member, key === 'pipe' || key === 'unpipe' ? port : target, args);
    return result === target ? port : result;
  };
  const forget = (event: unknown, entry: Listener) => {
    const entries = listeners.get(event);
    if (!entries) return;
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    if (!entries.length) listeners.delete(event);
  };
  const callback = (work: Function, args: unknown[]) =>
    dispatch(() =>
      Reflect.apply(
        work,
        port,
        args.map((value) => (value === target ? port : value)),
      ),
    );
  port = new Proxy(Object.create(null), {
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
      return (...args: unknown[]) => {
        if (registrations.has(key) && typeof args[1] === 'function') {
          const event = args[0],
            original = args[1];
          const once = key === 'once' || key === 'prependOnceListener';
          const entry: Listener = {
            original,
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
    getPrototypeOf: () => Object.getPrototypeOf(target),
    set: (_shadow, key, value) => {
      if (typeof key === 'symbol') return Reflect.set(target, key, value, target);
      throw new AppError('传输流接口不可写', 403, 'PLUGIN_SERVICE_READONLY');
    },
    defineProperty: () => false,
    deleteProperty: () => false,
  }) as T;
  cache.set(target, port);
  return port;
}
