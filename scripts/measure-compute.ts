/** 运行可重复的计算预览夹具并测量耗时，供受控计算路径的性能对比使用。
 * Measure real guest compute in an explicitly owned preview fixture and report elapsed results tied to its runtime. */
import { gzipSync } from 'node:zlib';
import { previewFile } from '../server/file-preview.ts';
import { engineeringInvocation, engineeringSource } from '../server/engineering-runner.ts';
import { previewInWorker } from '../server/file-preview-runtime.ts';

// Valid, bounded worst-case preview: many empty TAR entries, not a decompression bomb.
/** 构造重复合法 tar 头的 64 MiB 内存样本并 gzip，供预览解压路径测量；校验和按 tar 规范计算，不读真实文件。
 * Build/gzip a 64-MiB in-memory sample of repeated valid tar headers for preview/decompression measurement, computing the tar checksum without reading real files. */
export function previewFixture() {
  const header = Buffer.alloc(512);
  header.write('empty.txt'); header.write('00000000000\0', 124); header[156] = 48;
  header.fill(32, 148, 156);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  const archive = Buffer.alloc(64 * 1024 ** 2);
  for (let offset = 0; offset < archive.length; offset += header.length) header.copy(archive, offset);
  return gzipSync(archive);
}

/** 执行给定计算并记录耗时，同时安排零延迟心跳测出事件循环阻塞；返回取整毫秒，计算错误直接传播。
 * Execute supplied work and measure elapsed time plus a zero-delay heartbeat to expose event-loop blocking; return rounded milliseconds and propagate work failures. */
async function measure(name: string, work: () => unknown | Promise<unknown>) {
  const before = performance.now();
  const heartbeat = new Promise<number>((resolve) => setTimeout(() => resolve(performance.now() - before), 0));
  await work();
  const elapsedMs = performance.now() - before;
  return { name, elapsedMs: Math.round(elapsedMs), heartbeatDelayMs: Math.round(await heartbeat) };
}
const archive = previewFixture(), source = await engineeringSource();
console.log(JSON.stringify({ inputBytes: archive.length, expandedBytes: 64 * 1024 ** 2,
  measurements: [
    await measure('sync 131072 TAR headers', () => previewFile('fixture.tgz', archive)),
    await measure('worker 131072 TAR headers', () => previewInWorker('diagnostic:compute', 'fixture.tgz', archive.length, async () => archive)),
    await measure('16 engineering invocations', () => {
      for (let index = 0; index < 16; index++) engineeringInvocation(source, { operation: 'status', parameters: {} });
    }),
  ],
}, null, 2));
