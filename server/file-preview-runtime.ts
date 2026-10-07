/**
 * 模块职责：将文件预览提交给计算工作线程，关联取消信号和预览任务资源归属。
 * Module purpose: Submits file previews to compute workers with cancellation and resource identity ownership.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { computeRuntime } from './compute-runtime.ts';
import { ROOT } from './paths.ts';
import type { Preview } from './file-preview.ts';

/**
 * 入口 / Entry: previewInWorker.
 * 功能：把本层请求转交 `computeRuntime.run`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `computeRuntime.run` and propagates the provider result or rejection.
 * 输入 / Inputs: owner: string; path: string; size: number; read: (signal: AbortSignal) => Promise<Buffer>; signal: AbortSignal optional
 * 输出 / Returns: `computeRuntime.run<Preview>({ owner, label: '文件预览', memoryBytes: 192 * 1024 ** 2, partition: { key: 'file-preview', limit: 2 …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function previewInWorker(owner: string, path: string, size: number,
  read: (signal: AbortSignal) => Promise<Buffer>, signal?: AbortSignal) {
  /**
   * 入口 / Entry: previewInWorker.callback@14.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（computeRuntime.run）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (computeRuntime.run).
   * 输入 / Inputs: active
   * 输出 / Returns: `{ source: pathToFileURL(existsSync(source) ? source : join(ROOT, '.sakura-server/assets/compute-worker.mjs')), options: { wor…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
