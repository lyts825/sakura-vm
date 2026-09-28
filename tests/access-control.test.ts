import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessControl } from '../server/access-control.ts';
import { Passkeys } from '../server/passkeys.ts';

test('opt-in account mode replaces the shared token with expiring scoped identities', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-access-'));
  let now = Date.UTC(2026, 0, 1);
  const access = new AccessControl(join(directory, 'accounts.json'), () => now);
  await access.init();
  try {
    assert.equal(access.enabled, false);
    await access.enable({ password: 'correct horse battery staple' });
    assert.equal(access.enabled, true);
    assert.throws(() => access.authorize('a'.repeat(64)), /访问凭证/);
    await assert.rejects(access.login({ username: 'owner', password: 'incorrect' }), /无效/);
    const owner = await access.login({ username: 'owner', password: 'correct horse battery staple' });
    assert.equal(owner.principal.role, 'owner');
    assert.equal(access.authorize(owner.token).username, 'owner');
    assert.ok(!await readFile(join(directory, 'accounts.json'), 'utf8').then(
      (text) => text.includes('correct horse battery staple')));
    const vmId = '00000000-0000-4000-8000-000000000001';
    const viewer = await access.createViewer({ username: 'reader', password: 'read only password 123',
      vmIds: [vmId], expiresAt: now + 86_400_000 });
    assert.equal(viewer.role, 'viewer');
    assert.ok(!JSON.stringify(access.users()).includes('read only password'));
    const login = await access.login({ username: 'reader', password: 'read only password 123' });
    assert.deepEqual(access.authorize(login.token).vmIds, [vmId]);
    now += 3_600_001;
    assert.throws(() => access.authorize(login.token), /过期/);
    const fresh = await access.login({ username: 'reader', password: 'read only password 123' });
    await access.removeViewer(viewer.id);
    assert.throws(() => access.authorize(fresh.token), /访问凭证/);
    assert.equal(access.authorize(owner.token).role, 'owner');
    await access.changeOwnerPassword({ password: 'correct horse battery staple',
      newPassword: 'second correct horse battery' });
    assert.throws(() => access.authorize(owner.token), /访问凭证/);
    await assert.rejects(access.login({ username: 'owner', password: 'correct horse battery staple' }), /无效/);
    assert.equal((await access.login({ username: 'owner', password: 'second correct horse battery' }))
      .principal.role, 'owner');
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('account login locks out repeated guessing and does not persist sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-access-'));
  let now = Date.UTC(2026, 0, 1);
  const file = join(directory, 'accounts.json');
  const access = new AccessControl(file, () => now);
  await access.init();
  try {
    await access.enable({ password: 'correct horse battery staple' });
    for (let attempt = 0; attempt < 5; attempt++)
      await assert.rejects(access.login({ username: 'owner', password: 'wrong password' }), /无效/);
    await assert.rejects(access.login({ username: 'owner', password: 'correct horse battery staple' }),
      /尝试过多/);
    now += 60_001;
    const login = await access.login({ username: 'owner', password: 'correct horse battery staple' });
    const restarted = new AccessControl(file, () => now);
    await restarted.init();
    assert.throws(() => restarted.authorize(login.token), /访问凭证/);
    await restarted.close();
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('passkey challenges are single-use and stored credentials survive restart and revoke their sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-passkeys-'));
  const file = join(directory, 'accounts.json');
  let now = Date.UTC(2026, 0, 1);
  const access = new AccessControl(file, () => now);
  await access.init();
  try {
    await access.enable({ password: 'correct horse battery staple' });
    const owner = await access.login({ username: 'owner', password: 'correct horse battery staple' });
    const passkeys = new Passkeys(access, 7337, () => now);
    const begin = await passkeys.beginAuthentication();
    assert.equal(begin.options.rpId, 'localhost');
    const invalid = { ceremonyId: begin.ceremonyId, response: { id: 'a'.repeat(32) } };
    await assert.rejects(passkeys.finishAuthentication(invalid), /验证失败/);
    await assert.rejects(passkeys.finishAuthentication(invalid), /已失效/);
    const expired = await passkeys.beginAuthentication();
    now += 5 * 60_000;
    await assert.rejects(passkeys.finishAuthentication({ ...invalid,
      ceremonyId: expired.ceremonyId }), /已失效/);

    const id = 'b'.repeat(32);
    await access.addPasskey(owner.principal.id, { id, publicKey: 'c'.repeat(32),
      counter: 0, transports: ['internal'], name: 'test key',
      createdAt: new Date(now).toISOString() });
    assert.equal(access.passkeysFor(owner.principal.id)[0].name, 'test key');
    assert.ok(!JSON.stringify(access.passkeysFor(owner.principal.id)).includes('publicKey'));
    const restarted = new AccessControl(file, () => now);
    await restarted.init();
    assert.equal(restarted.getPasskey(id)?.key.id, id);
    await restarted.close();
    const signedIn = await access.completePasskeyLogin(owner.principal.id, id, 0, 1);
    assert.equal(access.authorize(signedIn.token).role, 'owner');
    await assert.rejects(access.completePasskeyLogin(owner.principal.id, id, 0, 1), /计数器/);
    await access.removePasskey(owner.principal.id, id);
    assert.throws(() => access.authorize(signedIn.token), /凭证/);
    assert.equal(access.authorize(owner.token).role, 'owner');
    passkeys.close();
  } finally {
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});
