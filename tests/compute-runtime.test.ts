/**
 * 回归范围（完整情景见下方用例与断言）：
 * - worker result is returned only after physical retirement and all dimensions are released
 * - queued cancellation never reads input, and close joins active workers before returning
 * - time limits, invalid entry points and preparation errors cannot leak compute capacity
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Worker } from 'node:worker_threads';
import { gzipSync } from 'node:zlib';
import { ComputeRuntime } from '../server/compute-runtime.ts';
import { HostRuntime, hostRuntime } from '../server/host-runtime/index.ts';
import { previewInWorker } from '../server/file-preview-runtime.ts';
import { previewFile } from '../server/file-preview.ts';

const options = { owner: 'test:compute', label: 'test', memoryBytes: 1 };
const result = (source = "require('node:worker_threads').parentPort.postMessage({ok:true,result:42});while(true){}") =>
  ({ source, options: { eval: true } });
const registry = () => new HostRuntime({ budgets: { 'compute.worker': { capacity: 1 }, 'compute.memory': { capacity: 2 } } });
async function eventually(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) { assert.ok(Date.now() < deadline); await delay(5); }
}

test('worker result is returned only after physical retirement and all dimensions are released', async () => {
  const host = registry(), runtime = new ComputeRuntime(host);
  try {
    assert.equal(await runtime.run(options, () => result()), 42);
    assert.equal(host.snapshot().resources.length, 0);
    assert.ok(host.snapshot().budgets.every((budget) => !budget.used));
  } finally { await runtime.close(); host.close(); }
});

test('queued cancellation never reads input, and close joins active workers before returning', async () => {
  const host = registry(), runtime = new ComputeRuntime(host), abort = new AbortController();
  let read = false;
  const first = runtime.run(options, () => result('while(true){}'));
  const stopped = assert.rejects(first, { code: 'RESOURCE_DRAINING' });
  await eventually(() => host.snapshot().budgets[0].used === 1);
  const second = runtime.run({ ...options, signal: abort.signal }, () => { read = true; return result(); });
  const cancelled = assert.rejects(second, { name: 'AbortError' });
  abort.abort(); await cancelled;
  assert.equal(read, false);
  await runtime.close(); await stopped;
  host.close();
});

test('time limits, invalid entry points and preparation errors cannot leak compute capacity', async () => {
  const host = registry(), runtime = new ComputeRuntime(host);
  try {
    await assert.rejects(runtime.run({ ...options, timeoutMs: 30 }, () => result('while(true){}')), { code: 'COMPUTE_TIMEOUT' });
    await assert.rejects(runtime.run(options, () => { throw new Error('input failed'); }), /input failed/);
    await assert.rejects(runtime.run(options, () => ({ source: 'relative-without-dot.js' })), { code: 'ERR_WORKER_PATH' });
    await assert.rejects(runtime.run(options, () => result('process.exit(0)')), { code: 'COMPUTE_EXIT' });
    assert.equal(host.snapshot().resources.length, 0);
  } finally { await runtime.close(); host.close(); }
});

test('failed termination retains budget and close retries the same worker before releasing it', async () => {
  const host = registry(); let attempts = 0;
  const worker = Object.assign(new EventEmitter(), { terminate: async () => {
    if (++attempts === 1) throw new Error('exit unconfirmed');
    worker.emit('exit', 1); return 1;
  } });
  const runtime = new ComputeRuntime(host, () => {
    setImmediate(() => worker.emit('message', { ok: true, result: 1 }));
    return worker as unknown as Worker;
  });
  await assert.rejects(runtime.run(options, () => result()), { code: 'COMPUTE_CLEANUP_PENDING' });
  assert.equal(host.snapshot().resources[0].state, 'cleanup-pending');
  assert.equal(host.snapshot().budgets[0].used, 1);
  await runtime.close(); assert.equal(attempts, 2); host.close();
});

test('fixed preview worker accepts bounded immutable bytes and preserves parser errors', async () => {
  const header = Buffer.alloc(512); header.write('empty'); header.write('00000000000\0', 124);
  header.fill(32, 148, 156);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  const bytes = gzipSync(Buffer.concat([header, Buffer.alloc(1024)]));
  const expected = previewFile('sample.tgz', bytes);
  const actual = await previewInWorker('test:preview', 'sample.tgz', bytes.length, async () => bytes);
  assert.deepEqual(actual, expected);
  assert.equal(hostRuntime.snapshot().resources.filter((resource) => resource.kind === 'compute-worker').length, 0);
  await assert.rejects(previewInWorker('test:preview', 'broken.zip', 24, async () => Buffer.alloc(24)), /ZIP 目录无效/);
});
