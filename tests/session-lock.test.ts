import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { SessionLock } from '../server/session-lock.ts';

const password = 'test-only long passphrase!';
const status = (expected: number) => (error: any) => error.status === expected;
async function setup(t: test.TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'sakura-session-lock-'));
  assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + sep));
  const file = join(folder, 'session.json');
  let now = Date.now();
  const transitions: boolean[] = [],
    managers: SessionLock[] = [];
  const create = async () => {
    const manager = new SessionLock(
      (locked, transitioned) => {
        if (transitioned) transitions.push(locked);
      },
      file,
      () => now,
    );
    managers.push(manager);
    await manager.init(false);
    return manager;
  };
  t.after(async () => {
    for (const manager of managers) await manager.close();
    await rm(folder, { recursive: true, force: true });
  });
  return {
    file,
    create,
    transitions,
    advance: (delta: number) => {
      now += delta;
    },
  };
}
const enable = (manager: SessionLock) =>
  manager.configure({ enabled: true, idleMinutes: 1, newPassword: password });

test('idle expiry is checked on access; read polling never extends it, activity does, and restart locks', async (t) => {
  const fixture = await setup(t),
    manager = await fixture.create();
  assert.equal(manager.view().enabled, false);
  await enable(manager);
  const initial = manager.view().expiresAt!;
  fixture.advance(45000);
  manager.view();
  manager.requireUnlocked();
  assert.equal(manager.view().expiresAt, initial);
  assert.equal(manager.activity().expiresAt, initial + 45000);
  fixture.advance(60000);
  assert.throws(() => manager.requireUnlocked(), status(423));
  assert.equal(manager.view().reason, 'idle');
  assert.throws(() => manager.activity(), status(423));
  await manager.unlock({ password });
  assert.equal(manager.view().locked, false);
  assert.deepEqual(fixture.transitions, [true, false]);
  await manager.close();
  const restored = await fixture.create();
  assert.equal(restored.view().locked, true);
  assert.equal(restored.view().reason, 'startup');
  assert.ok(!JSON.stringify(restored.view()).includes('hash'));
  assert.ok(!(await readFile(fixture.file, 'utf8')).includes(password));
});

test('five failed passwords start a durable cooldown; password changes and disabling require the current proof', async (t) => {
  const fixture = await setup(t),
    manager = await fixture.create();
  await enable(manager);
  manager.lock();
  for (let i = 0; i < 5; i++) await assert.rejects(manager.unlock({ password: 'wrong' }), status(403));
  assert.equal(manager.view().retryAfterSeconds, 60);
  await assert.rejects(manager.unlock({ password }), status(429));
  await manager.close();
  const restored = await fixture.create();
  await assert.rejects(restored.unlock({ password }), status(429));
  fixture.advance(60001);
  await restored.unlock({ password });
  assert.equal(restored.view().retryAfterSeconds, 0);
  await assert.rejects(restored.configure({ enabled: false, idleMinutes: 1 }), status(403));
  const replacement = 'replacement passphrase';
  await restored.configure({ enabled: true, idleMinutes: 1, password, newPassword: replacement });
  restored.lock();
  await assert.rejects(restored.unlock({ password }), status(403));
  await restored.unlock({ password: replacement });
  await restored.configure({ enabled: false, idleMinutes: 1, password: replacement });
  assert.equal(restored.view().enabled, false);
  await restored.close();
  const disabled = await fixture.create();
  assert.equal(disabled.view().locked, false);
  assert.equal(disabled.view().configured, true);
  await assert.rejects(
    disabled.configure({ enabled: true, idleMinutes: 1, newPassword: password }),
    status(403),
  );
});

test('pending verification cannot unlock a newer lock; parallel password work is bounded and shutdown drains it', async (t) => {
  const fixture = await setup(t),
    manager = await fixture.create();
  await enable(manager);
  manager.lock();
  const unlocking = manager.unlock({ password });
  await assert.rejects(manager.unlock({ password }), status(429));
  manager.lock();
  await assert.rejects(unlocking, status(409));
  assert.equal(manager.view().locked, true);
  await manager.unlock({ password });
  const changing = manager.configure({ enabled: false, idleMinutes: 1, password });
  manager.lock();
  await assert.rejects(changing, status(423));
  const closingProof = manager.unlock({ password });
  const rejected = assert.rejects(closingProof, status(409));
  await manager.close();
  await rejected;
  assert.throws(() => manager.requireUnlocked(), status(503));
});

test('missing credentials, malformed storage, clock rollback and expiry during configuration fail closed', async (t) => {
  const fixture = await setup(t),
    manager = await fixture.create();
  await assert.rejects(manager.configure({ enabled: true, idleMinutes: 1 }), /12/);
  assert.throws(() => manager.configure({ enabled: true, idleMinutes: 0, newPassword: password }));
  await enable(manager);
  fixture.advance(-1);
  assert.throws(() => manager.requireUnlocked(), status(423));
  await manager.unlock({ password });
  const configuring = manager.configure({ enabled: false, idleMinutes: 1, password });
  fixture.advance(60000);
  await assert.rejects(configuring, status(423));
  assert.equal(manager.view().enabled, true);
  await manager.close();
  await writeFile(fixture.file, '{invalid');
  await assert.rejects(fixture.create(), status(503));
});
