/** 固定领域计算在受管工作线程执行，正文读取也计入计算准入。 */
import { computeRuntime } from './compute-runtime.ts';
import type { SuiteByteMaterialsV1, SuiteScope, SuiteRef } from '../shared/contracts/suite-common.ts';
import { suiteMaterial } from '../shared/contracts/suite-common.ts';
import { suiteFail } from './suite-store.ts';

export type SupplyComputation = 'inventory' | 'dataset' | 'advisories' | 'licenses';
export type LocaleComputation = 'catalog' | 'checks' | 'preview';
export type IncidentComputation = 'timeline' | 'redact';
export async function readSuiteText(
  source: Pick<SuiteByteMaterialsV1, 'get' | 'openRead' | 'readLease' | 'closeRead'>,
  scope: SuiteScope,
  ref: SuiteRef,
  maximum = 32 * 1024 ** 2,
) {
  const row = await source.get({ ...scope, id: ref.id, revision: ref.revision });
  const material = suiteMaterial.parse(row.content);
  if (material.bytes > maximum) suiteFail('SUITE_COMPUTE_INPUT_LIMIT', '材料超过此计算的输入上限', 413);
  const parts: Buffer[] = [];
  const lease = await source.openRead({ ...scope, id: ref.id, revision: ref.revision });
  try {
    if (!material.bytes) await source.readLease({ ...scope, id: lease.id, offset: 0, length: 1 });
    for (let offset = 0; offset < material.bytes;) {
      const chunk = await source.readLease({
        ...scope,
        id: lease.id,
        offset,
        length: Math.min(512 * 1024, material.bytes - offset),
      });
      const bytes = Buffer.from(chunk.data, 'base64');
      if (!bytes.length || chunk.offset !== offset + bytes.length) suiteFail('SUITE_MATERIAL_PROTOCOL');
      parts.push(bytes);
      offset = chunk.offset;
    }
  } finally {
    await source.closeRead({ ...scope, id: lease.id });
  }
  return {
    text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)),
    format: material.format,
  };
}
export function computeSupply<T>(
  domain: string,
  operation: SupplyComputation,
  prepare: () => Promise<unknown>,
  signal?: AbortSignal,
): Promise<T> {
  return computeSuite('supply-audit', domain, operation, prepare, signal);
}
export function computeLocale<T>(
  domain: string,
  operation: LocaleComputation,
  prepare: () => Promise<unknown>,
  signal?: AbortSignal,
): Promise<T> {
  return computeSuite('localization-studio', domain, operation, prepare, signal);
}
function computeSuite<T>(
  task: 'supply-audit' | 'localization-studio' | 'incident-desk',
  domain: string,
  operation: SupplyComputation | LocaleComputation | IncidentComputation,
  prepare: () => Promise<unknown>,
  signal?: AbortSignal,
): Promise<T> {
  return computeRuntime.run<T>(
    {
      owner: domain,
      label: task + '-' + operation,
      memoryBytes: (task === 'incident-desk' ? 384 : 256) * 1024 ** 2,
      timeoutMs: 60000,
      signal,
      partition: { key: task, limit: 2 },
    },
    async () => ({
      source: new URL('./compute-worker.mjs', import.meta.url),
      options: {
        workerData: { task, operation, input: await prepare() },
        resourceLimits: { maxOldGenerationSizeMb: task === 'incident-desk' ? 320 : 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
      },
    }),
  );
}
export function computeIncident<T>(domain: string, operation: IncidentComputation, prepare: () => Promise<unknown>, signal?: AbortSignal): Promise<T> {
  return computeSuite('incident-desk', domain, operation, prepare, signal);
}
