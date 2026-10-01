import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Jobs } from '../server/jobs.ts';
import { AppError } from '../server/model.ts';
import { sandboxExecutionSchema } from '../shared/sandbox.ts';

const parent = await realpath(tmpdir());
const root = await mkdtemp(join(parent, 'sakura-jobs-cleanup-'));
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), parent);
  assert.match(basename(owned), /^sakura-jobs-cleanup-/);
  await rm(owned, { recursive: true, force: true });
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

for (const code of [
  'GUEST_TASK_CLEANUP_FAILED', 'SERVICE_CLEANUP_FAILED',
  'PROJECT_MAIN_CLEANUP_FAILED', 'PROJECT_SSH_CLEANUP_FAILED',
  'PROJECT_IDENTITY_CLEANUP_FAILED',
  'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED',
]) {
  test(`cancelled ${code} cleanup remains a durable failure after restart`, async () => {
    const scope = code.toLowerCase(), jobs = new Jobs(scope, root), entered = gate();
    const execution = sandboxExecutionSchema.parse({ command: 'owned-test', cwd: '/workspace',
      timeoutSeconds: 30, requestedArtifacts: [], artifacts: [], timings: {}, outcome: 'cancelled' });
    const view = jobs.start('owned', async (log, signal) => {
      const aborted = new Promise<void>(done => signal.addEventListener('abort', () => done(), { once: true }));
      entered.resolve();
      await aborted;
      log('原运行归属保留，清理重试均未确认\n');
      throw new AppError('清理未确认，原运行记录保留', 503, code);
    }, { execution });
    await entered.promise;
    jobs.cancel(view.id!);
    await jobs.wait('owned');
    assert.equal(view.status, 'error');
    assert.equal(view.errorCode, code);
    assert.equal(view.error, '清理未确认，原运行记录保留');
    assert.equal(view.phase, view.error);
    assert.equal(view.execution?.outcome, 'failed');
    await jobs.close();
    const restored = new Jobs(scope, root);
    assert.equal(restored.get(view.id!)?.status, 'error');
    assert.equal(restored.get(view.id!)?.errorCode, code);
    assert.equal(restored.get(view.id!)?.execution?.outcome, 'failed');
    await restored.close();
  });
}

test('shutdown waits for cleanup and preserves its failure instead of a cancelled result', async () => {
  const jobs = new Jobs('shutdown-cleanup', root), entered = gate();
  const view = jobs.start('owned', async (_log, signal) => {
    const aborted = new Promise<void>(done => signal.addEventListener('abort', () => done(), { once: true }));
    entered.resolve();
    await aborted;
    throw new AppError('关闭后的任务域清理仍未确认', 503, 'GUEST_TASK_CLEANUP_FAILED');
  });
  await entered.promise;
  await jobs.close();
  const stored = JSON.parse(await readFile(join(root, 'shutdown-cleanup.json'), 'utf8'));
  assert.equal(stored[0].status, 'error');
  assert.equal(stored[0].errorCode, 'GUEST_TASK_CLEANUP_FAILED');
  assert.equal(view.error, '关闭后的任务域清理仍未确认');
});

for (const code of ['PROJECT_MAIN_CLEANUP_FAILED', 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED']) {
  test(`tracked cancellation returns the original ${code} status, code and message`, async () => {
    const jobs = new Jobs('tracked-' + code.toLowerCase(), root), entered = gate(), abort = new AbortController();
    const pending = jobs.track('owned', async (_log, signal) => {
      const aborted = new Promise<void>(done => signal.addEventListener('abort', () => done(), { once: true }));
      entered.resolve();
      await aborted;
      throw new AppError('项目清理未确认', 503, code);
    }, {}, abort.signal);
    const rejected = assert.rejects(pending, { status: 503, code,
      message: '项目清理未确认' });
    await entered.promise;
    abort.abort();
    await rejected;
    assert.equal(jobs.view('owned')?.status, 'error');
    await jobs.close();
  });
}

test('ordinary cancellation still records a cancelled result after successful cleanup', async () => {
  const jobs = new Jobs('ordinary-cancel', root), entered = gate();
  let cleaned = false;
  const pending = jobs.track('owned', async (_log, signal) => {
    const aborted = new Promise<void>(done => signal.addEventListener('abort', () => done(), { once: true }));
    entered.resolve();
    await aborted;
    cleaned = true;
  });
  const rejected = assert.rejects(pending, { status: 409, message: '操作已取消' });
  await entered.promise;
  jobs.cancel('owned');
  await rejected;
  assert.equal(cleaned, true);
  assert.equal(jobs.view('owned')?.status, 'cancelled');
  assert.equal(jobs.view('owned')?.errorCode, undefined);
  await jobs.close();
});

test('tracked application failures retain their actual status and code without cancellation', async () => {
  const jobs = new Jobs('tracked-application-error', root);
  await assert.rejects(jobs.track('owned', async () => {
    throw new AppError('项目运行身份已变化', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
  }), { status: 409, code: 'PROJECT_MAIN_SCOPE_CHANGED', message: '项目运行身份已变化' });
  await jobs.close();
});

test('cleanup failure raised by the execution wrapper also returns the cleanup status', async () => {
  const jobs = new Jobs('wrapper-cleanup', root), previous = Jobs.instrument;
  Jobs.instrument = async (_view, work) => {
    await work();
    throw new AppError('执行包装器清理未确认', 503, 'GUEST_TASK_CLEANUP_FAILED');
  };
  try {
    await assert.rejects(jobs.track('owned', async () => 'completed command'), {
      status: 503, code: 'GUEST_TASK_CLEANUP_FAILED', message: '执行包装器清理未确认',
    });
    assert.equal(jobs.view('owned')?.status, 'error');
  } finally { Jobs.instrument = previous; await jobs.close(); }
});
