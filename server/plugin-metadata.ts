/**
 * 模块职责：保存插件元数据回执，校验回执结构后供插件管理及恢复流程使用。
 */
import type { MetadataSnapshot, MetadataWriteOptions } from './metadata-store.ts';
import { MetadataStore } from './metadata-store.ts';
import { pluginDataFile } from './plugin-data.ts';
import type { PluginScope } from './plugin-scope.ts';
import { storageRuntime } from './storage-runtime.ts';
import { randomUUID } from 'node:crypto';

export type PluginMetadata<T = unknown> = Readonly<{
  name: string;
  read(signal?: AbortSignal): Promise<MetadataSnapshot<T>>;
  replace(value: T, options?: MetadataWriteOptions): Promise<MetadataSnapshot<T>>;
}>;
const references = new WeakMap<object, string>();
/** Only host-side domain constructors resolve an opaque metadata reference. */
export function metadataPath(value: string | PluginMetadata): string {
  if (typeof value === 'string') return value;
  const path = references.get(value);
  if (!path) throw new Error('插件元数据回执无效');
  return path;
}
export function pluginMetadata(pluginId: string, owner: string, scope: PluginScope,
  run: <T>(permission: string, work: () => T) => T) {
  return Object.freeze({
    reference<T = unknown>(name: string, fallback: () => T = () => null as T): PluginMetadata<T> {
      const file = pluginDataFile(pluginId, name), store = new MetadataStore(file, { fallback });
      const signal = (input?: AbortSignal) => input ? AbortSignal.any([scope.signal, input]) : scope.signal;
      const handle = Object.freeze({ name,
        read: (input?: AbortSignal) => scope.run(() => run('metadata', () => store.read(signal(input)))),
        replace: (value: T, options: MetadataWriteOptions = {}) => scope.run(() => run('metadata', () => store.replace(value,
          { ...options, signal: signal(options.signal), beforeCommit: async () => { await options.beforeCommit?.(); run('metadata', () => {}); } }))),
      });
      references.set(handle, file); scope.add(() => store.flush()); return handle;
    },
    run<T>(name: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const file = pluginDataFile(pluginId, name);
      return scope.run(() => run('metadata', () => storageRuntime.run({ owner, taskId: randomUUID(),
        label: '插件元数据', paths: [file], mode: 'write', buffers: 256 * 1024, files: 1, signal: scope.signal }, () => work(scope.signal))));
    },
  });
}
