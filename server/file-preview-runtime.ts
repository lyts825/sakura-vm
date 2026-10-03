import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { computeRuntime } from './compute-runtime.ts';
import { ROOT } from './paths.ts';
import type { Preview } from './file-preview.ts';

export function previewInWorker(owner: string, path: string, size: number,
  read: (signal: AbortSignal) => Promise<Buffer>, signal?: AbortSignal) {
  return computeRuntime.run<Preview>({ owner, label: '文件预览', memoryBytes: 192 * 1024 ** 2,
    partition: { key: 'file-preview', limit: 2 }, signal }, async (active) => {
    const bytes = await read(active);
    // Only owned immutable bytes cross the worker boundary, never SFTP, a
    // pathname capability, or a live domain object. Publication stays here.
    const data = Uint8Array.from(bytes);
    const source = join(ROOT, 'server', 'compute-worker.mjs');
    return { source: pathToFileURL(existsSync(source) ? source : join(ROOT, '.sakura-server/assets/compute-worker.mjs')),
      options: { workerData: { task: 'file-preview', path, size, data }, transferList: [data.buffer],
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 } } };
  });
}
