/** 固定工具的本体账本不随消费插件卸载，名称限定为审核过的三张表。
 * Core tool ledgers survive consumer unload and use three reviewed table names. */
import { join } from 'node:path';
import { MetadataStore } from './metadata-store.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { DATA } from './paths.ts';
const tables = new Map<string, MetadataStore<unknown>>();
export function preparedWorkerMetadata(name: string): PluginMetadata {
  if (!['plans', 'receipts', 'grants'].includes(name)) throw new Error('Unknown prepared worker ledger');
  let store = tables.get(name);
  if (!store) {
    store = new MetadataStore<unknown>(join(DATA, 'prepared-worker-sessions', name + '.json'), {
      fallback: () => [],
    });
    tables.set(name, store);
  }
  return {
    name,
    read: (signal) => store.read(signal),
    replace: (value, options) => store.replace(value, options),
  };
}
