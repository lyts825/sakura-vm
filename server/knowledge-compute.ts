/** 只允许两个审核过的计算适配器。 Only fixed parse/index tasks enter ComputeRuntime. */
import { computeRuntime } from './compute-runtime.ts';
import type { Extraction } from '../shared/contracts/knowledge-studio.ts';
export function computeKnowledge<T>(
  task: 'parse' | 'index',
  prepare: (signal: AbortSignal) => Promise<Record<string, unknown>>,
  signal?: AbortSignal,
) {
  return computeRuntime.run<T>(
    {
      owner: 'knowledge-studio',
      label: `knowledge-${task}`,
      memoryBytes: 256 * 1024 ** 2,
      timeoutMs: 30000,
      partition: { key: 'knowledge-heavy', limit: 4 },
      signal,
    },
    async (active) => ({
      source: new URL('./knowledge-worker.mjs', import.meta.url),
      options: {
        workerData: { task, ...(await prepare(active)) },
        resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
      },
    }),
  );
}
export type ParsedMaterial = Pick<Extraction, 'parser' | 'textDigest' | 'blocks' | 'warnings'>;
