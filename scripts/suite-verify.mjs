/** 离线核验只加载固定编译入口，在可终止线程内处理有界交接字节。 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { lstat } from 'node:fs/promises';
import { readSuiteFile } from './suite-files.mjs';
const tools = Object.freeze({
  supply: ['supply-offline.js', 'verifySupplyBundle'],
  locale: ['locale-offline.js', 'verifyLocaleBundle'],
  incident: ['incident-offline.js', 'verifyIncidentBundle'],
});
if (!isMainThread) {
  try {
    if (
      !Object.hasOwn(tools, workerData.kind) ||
      !(workerData.bytes instanceof Uint8Array) ||
      workerData.bytes.length > 16 * 1024 ** 2
    )
      throw new Error('离线核验输入无效');
    const [file, operation] = tools[workerData.kind],
      module = await import(new URL('../.sakura-server/' + file, import.meta.url).href);
    parentPort.postMessage({ value: module[operation](workerData.bytes) });
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
}
export async function verifySuiteFile(kind, file) {
  if (!Object.hasOwn(tools, kind)) throw new Error('未知的离线核验工具');
  const bytes = await readSuiteFile(file, 16 * 1024 ** 2),
    toolsUrl = new URL('../.sakura-server/' + tools[kind][0], import.meta.url);
  try {
    await lstat(toolsUrl);
  } catch {
    throw Object.assign(new Error('缺少编译的离线核验工具；请先运行 npm run build，或使用完整运行包'), {
      exitCode: 3,
    });
  }
  const copy = new Uint8Array(bytes),
    worker = new Worker(new URL(import.meta.url), {
      workerData: { kind, bytes: copy },
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
