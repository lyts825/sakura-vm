/**
 * 模块职责：封装 SSH 连接与通道的受限方法，关联申请生命周期及实际传输资源。
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
type CallbackDispatch = <R>(work: () => R) => R;
const managedValues = new WeakSet<object>();

/** A cached transport admits each new command, rather than exposing its socket or protocol object. */
export function vmTransportPort<T extends object>(
  target: T,
  kind: 'client' | 'sftp',
  admit: <R>(work: () => R) => R,
  dispatchCallback: CallbackDispatch = (work) => work(),
): T {
  let port: T;
  const created = new Set<string>();
  type Listener = { original: Function; wrapped: (...args: unknown[]) => unknown };
  const listeners = new Map<unknown, Listener[]>();
  const connections = new WeakMap<Function, { settled: boolean }>();
  const methods = kind === 'client' ? clientMethods : fileMethods;
  const cleanup = kind === 'client' ? clientCleanup : fileCleanup;
  const stream = (value: object) => {
    const result = vmStreamPort(value, dispatchCallback);
    managedValues.add(result);
    return result;
  };
  const callMember = (key: string, args: unknown[]) => {
    const member = Reflect.get(target as object, key, target);
    if (typeof member !== 'function') throw new AppError('传输方法不可用', 403, 'PLUGIN_SERVICE_PRIVATE');
    const result = Reflect.apply(member, target, args);
    return result === target ? port : result;
  };
  const forget = (event: unknown, entry: Listener) => {
    const entries = listeners.get(event);
    if (!entries) return;
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    if (!entries.length) listeners.delete(event);
  };
  const publicValue = (value: unknown): unknown => {
    if (value === target) return port;
    if (value && typeof value === 'object' && managedValues.has(value)) return value;
    if (typeof value === 'function')
      return (...args: unknown[]) => admit(() => publicValue(Reflect.apply(value, undefined, args)));
    if (value && typeof value === 'object' && typeof Reflect.get(value, 'pipe') === 'function')
      return stream(value);
    return value;
  };
  const callback = (work: Function, args: unknown[], connection = false) => {
    const accept = connection && typeof args[1] === 'function' ? args[1] : undefined;
    const receipt = accept ? connections.get(accept) || { settled: false } : undefined;
    if (accept && receipt) connections.set(accept, receipt);
    return dispatchCallback(() =>
      Reflect.apply(
        work,
        port,
        args.map((value, index) => {
          if (receipt && typeof value === 'function' && (index === 1 || index === 2)) {
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
    get: (_shadow, key) => {
      if (key === 'then') return undefined;
      if (typeof key !== 'string' || !(methods.has(key) || cleanup.has(key) || events.has(key)))
        throw new AppError('传输内部实现不可访问', 403, 'PLUGIN_SERVICE_PRIVATE');
      return (...args: unknown[]) => {
        const call = () => {
          if (registrations.has(key) && typeof args[1] === 'function') {
            const event = args[0],
              original = args[1];
            const once = key === 'once' || key === 'prependOnceListener';
            const entry: Listener = {
              original,
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
          const forwarded = args.map((arg, index) =>
            typeof arg === 'function'
              ? (...input: unknown[]) => {
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
    set: () => {
      throw new AppError('传输接口不可写', 403, 'PLUGIN_SERVICE_READONLY');
    },
    defineProperty: () => false,
    deleteProperty: () => false,
  }) as T;
  managedValues.add(port);
  return port;
}
