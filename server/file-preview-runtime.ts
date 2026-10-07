/**
 * 模块职责：将文件预览提交给计算工作线程，关联取消信号和预览任务资源归属。
 */
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
    // 只把当前拥有的独立字节副本交给线程，不传递 SFTP 或活动领域对象；结果发布仍留在此层。
    const data = Uint8Array.from(bytes);
    const source = join(ROOT, 'server', 'compute-worker.mjs');
    return { source: pathToFileURL(existsSync(source) ? source : join(ROOT, '.sakura-server/assets/compute-worker.mjs')),
      options: { workerData: { task: 'file-preview', path, size, data }, transferList: [data.buffer],
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 } } };
  });
}
