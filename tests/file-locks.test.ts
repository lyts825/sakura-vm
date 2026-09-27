import assert from 'node:assert/strict';
import test from 'node:test';
import { FileLocks } from '../server/file-locks.ts';

test('file leases exclude overlapping edits, renew and expire without stale-token writes', async () => {
  let clock = 1000;
  const locks = new FileLocks(() => clock, 120000);
  const first = await locks.acquire('vm-one', '/workspace/project/main.ts');
  assert.equal(locks.view('vm-one', '/workspace/project/main.ts').locked, true);
  await assert.rejects(locks.acquire('vm-one', '/workspace/project'), /已被锁定/);
  await assert.rejects(locks.acquire('vm-one', '/workspace/project/main.ts'), /已被锁定/);
  await assert.rejects(locks.withMutation('vm-one', ['/workspace/project/main.ts'], undefined,
    async () => 'changed'), /已被其他编辑器锁定/);
  assert.equal(await locks.withMutation('vm-one', ['/workspace/project/main.ts'], first.token,
    async () => 'saved'), 'saved');
  assert.equal(await locks.withMutation('vm-one', ['/workspace/project/other.ts'], undefined,
    async () => 'saved'), 'saved');
  clock += 90000;
  const renewed = await locks.renew('vm-one', first.path, first.token);
  assert.equal(new Date(renewed.expiresAt).getTime(), clock + 120000);
  clock += 120001;
  assert.equal(locks.view('vm-one', first.path).locked, false);
  await assert.rejects(locks.withMutation('vm-one', [first.path], first.token,
    async () => 'changed'), /已过期/);
  const second = await locks.acquire('vm-one', first.path);
  assert.notEqual(second.token, first.token);
  await locks.release('vm-one', first.path, second.token);
  assert.equal(locks.view('vm-one', first.path).locked, false);
});

test('file lease acquisition waits for an in-flight mutation and then blocks a second writer', async () => {
  const locks = new FileLocks();
  let finish!: () => void;
  const inFlight = locks.withMutation('vm-one', ['/workspace/a.txt'], undefined,
    () => new Promise<void>((resolve) => { finish = resolve; }));
  await Promise.resolve();
  const acquired = locks.acquire('vm-one', '/workspace/a.txt');
  let settled = false;
  void acquired.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  finish();
  await inFlight;
  const lease = await acquired;
  await assert.rejects(locks.withMutation('vm-one', ['/workspace/a.txt'], undefined,
    async () => 'changed'), /已被其他编辑器锁定/);
  await locks.release('vm-one', lease.path, lease.token);
});
