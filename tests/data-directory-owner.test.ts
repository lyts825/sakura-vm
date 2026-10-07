/**
 * 回归范围（完整情景见下方用例与断言）：
 * - directory aliases share one host reservation and graceful close permits a new owner
 * - a second process cannot acquire the directory and an abrupt owner exit releases it
 * - a future migration destination stays exclusively reserved across atomic directory publication
 */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, realpath, rename, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { DataDirectoryOwner } from '../server/data-directory-owner.ts';
import { hostRuntime } from '../server/host-runtime/index.ts';

test('directory aliases share one host reservation and graceful close permits a new owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-directory-owner-'));
  const directory = join(root, 'data');
  await mkdir(directory);
  const owner = await DataDirectoryOwner.acquire(directory);
  try {
    assert.equal(owner.directory, await realpath(directory));
    await assert.rejects(DataDirectoryOwner.acquire(join(directory, '..', 'data')), { code: 'DATA_DIRECTORY_IN_USE' });
    if (process.platform === 'win32')
      await assert.rejects(DataDirectoryOwner.acquire(directory.toUpperCase()), { code: 'DATA_DIRECTORY_IN_USE' });
    const alias = join(root, 'alias');
    await symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(DataDirectoryOwner.acquire(alias), { code: 'DATA_DIRECTORY_IN_USE' });
    assert.equal(hostRuntime.snapshot().resources.filter(item => item.kind === 'metadata.owner').length, 1);
    await owner.close(); await owner.close();
    const replacement = await DataDirectoryOwner.acquire(alias);
    await replacement.close();
    assert.equal(hostRuntime.snapshot().resources.filter(item => item.kind === 'metadata.owner').length, 0);
  } finally { await owner.close(); await rm(root, { recursive: true, force: true }); }
});

test('a second process cannot acquire the directory and an abrupt owner exit releases it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-directory-process-'));
  const children: ReturnType<typeof fork>[] = [];
  const stopped = new Map<ReturnType<typeof fork>, Promise<unknown>>();
  const start = () => {
    const child = fork(resolve('tests/fixtures/data-directory-owner-child.ts'), [root], {
      execArgv: ['--import', 'tsx'], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    children.push(child); stopped.set(child, once(child, 'close'));
    return { child, ready: once(child, 'message', { signal: AbortSignal.timeout(10000) }) };
  };
  try {
    const first = start();
    assert.deepEqual((await first.ready)[0], { ready: true });
    const second = start();
    assert.deepEqual((await second.ready)[0], { error: 'DATA_DIRECTORY_IN_USE' });
    await stopped.get(second.child);
    // This bypasses JS finally/close, proving that the guard belongs to the OS.
    first.child.kill('SIGKILL'); await stopped.get(first.child);
    const next = await DataDirectoryOwner.acquire(root);
    await next.close();
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.all([...stopped.values()]);
    await rm(root, { recursive: true, force: true });
  }
});

test('a future migration destination stays exclusively reserved across atomic directory publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-directory-target-'));
  const target = join(root, 'target'), stage = join(root, 'stage');
  const owner = await DataDirectoryOwner.acquire(target, { create: false });
  try {
    await assert.rejects(stat(target), { code: 'ENOENT' });
    await assert.rejects(DataDirectoryOwner.acquire(target, { create: false }), { code: 'DATA_DIRECTORY_IN_USE' });
    await mkdir(stage); await rename(stage, target);
    await assert.rejects(DataDirectoryOwner.acquire(target), { code: 'DATA_DIRECTORY_IN_USE' });
    await owner.close();
    const next = await DataDirectoryOwner.acquire(target); await next.close();
  } finally { await owner.close(); await rm(root, { recursive: true, force: true }); }
});
