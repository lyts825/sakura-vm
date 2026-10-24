/** 纯 Node 离线核验，在可终止的有界工作线程中重算明确支持的证据。 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { lstat } from 'node:fs/promises';
import { readSuiteFile } from './suite-files.mjs';
const toolsUrl = new URL('../.sakura-server/supply-offline.js', import.meta.url);
if (!isMainThread) {
  try {
    const { verifySupplyBundle } = await import(toolsUrl.href);
    parentPort.postMessage({ value: verifySupplyBundle(workerData) });
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
}
export async function verifySupplyFile(file) {
  const bytes = await readSuiteFile(file, 16 * 1024 ** 2);
  try {
    await lstat(toolsUrl);
  } catch {
    throw Object.assign(new Error('缺少编译的离线核验工具；请先运行 npm run build，或使用完整运行包'), {
      exitCode: 3,
    });
  }
  const copy = new Uint8Array(bytes),
    worker = new Worker(new URL(import.meta.url), {
      workerData: copy,
      transferList: [copy.buffer],
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('离线核验超过 60 秒')), 60000);
      const finish = (work) => {
        clearTimeout(timer);
        work();
      };
      worker.once('message', (value) =>
        finish(() => (value.error ? reject(new Error(value.error)) : resolve(value.value))),
      );
      worker.once('error', (error) => finish(() => reject(error)));
      worker.once('exit', (code) => {
        if (code !== 0) finish(() => reject(new Error('核验线程退出：' + code)));
      });
    });
  } finally {
    await worker.terminate();
  }
}
