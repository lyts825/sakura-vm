import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserExtensions } from '../server/browser-extensions.ts';
import type { AccessControl } from '../server/access-control.ts';

const ownerId = '00000000-0000-4000-8000-000000000001';
const firstOrigin = 'chrome-extension://' + 'a'.repeat(32);
const otherOrigin = 'chrome-extension://' + 'b'.repeat(32);

test('browser extension pairing grants only scoped read access and survives restart until revoked', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-extension-'));
  const file = join(directory, 'extensions.json');
  let now = Date.UTC(2026, 0, 1), ownerPresent = true;
  const access = { enabled: true, users: () => ownerPresent
    ? [{ id: ownerId, role: 'owner' }] : [] } as unknown as AccessControl;
  const service = new BrowserExtensions(access, file, () => now);
  await service.init();
  try {
    const pairing = service.createPairing(ownerId);
    assert.match(pairing.code, /^[A-Za-z0-9_-]{12}$/);
    await assert.rejects(service.connect('https://example.com', { code: pairing.code }));
    await assert.rejects(service.connect(firstOrigin, { code: 'A'.repeat(12) }), /配对码/);
    const connected = await service.connect(firstOrigin, { code: pairing.code });
    assert.deepEqual(connected.permissions, ['inventory:read']);
    assert.equal(service.authorize(firstOrigin, connected.token).id, connected.id);
    assert.throws(() => service.authorize(otherOrigin, connected.token), /凭证/);
    assert.throws(() => service.authorize(firstOrigin, 'f'.repeat(64)), /凭证/);
    await assert.rejects(service.connect(otherOrigin, { code: pairing.code }), /配对码/);
    assert.equal(service.list(ownerId).length, 1);
    assert.ok(!JSON.stringify(service.list(ownerId)).includes(connected.token));
    assert.ok(!await readFile(file, 'utf8').then((text) => text.includes(connected.token)));
    await service.close();
    const restarted = new BrowserExtensions(access, file, () => now);
    await restarted.init();
    assert.equal(restarted.authorize(firstOrigin, connected.token).id, connected.id);
    await restarted.revoke(ownerId, connected.id);
    assert.throws(() => restarted.authorize(firstOrigin, connected.token), /凭证/);
    const second = restarted.createPairing(ownerId);
    const renewed = await restarted.connect(firstOrigin, { code: second.code });
    ownerPresent = false;
    assert.throws(() => restarted.authorize(firstOrigin, renewed.token), /管理员账户已失效/);
    ownerPresent = true;
    now += 30 * 86_400_000;
    assert.throws(() => restarted.authorize(firstOrigin, renewed.token), /已过期/);
    await restarted.close();
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('extension pairing limits guesses and global revocation removes durable tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-extension-'));
  const file = join(directory, 'extensions.json');
  let now = Date.UTC(2026, 0, 1);
  const access = { enabled: true, users: () => [{ id: ownerId, role: 'owner' }] } as unknown as AccessControl;
  const service = new BrowserExtensions(access, file, () => now);
  await service.init();
  try {
    const pairing = service.createPairing(ownerId);
    for (let count = 0; count < 5; count++)
      await assert.rejects(service.connect(firstOrigin, { code: 'x'.repeat(12) }), /配对码/);
    await assert.rejects(service.connect(firstOrigin, { code: pairing.code }), /尝试过多/);
    now += 60_001;
    const granted = await service.connect(firstOrigin, { code: pairing.code });
    await service.revokeAll();
    assert.throws(() => service.authorize(firstOrigin, granted.token), /凭证/);
    assert.deepEqual(service.list(ownerId), []);
    const expired = service.createPairing(ownerId);
    now += 5 * 60_000;
    await assert.rejects(service.connect(otherOrigin, { code: expired.code }), /已过期/);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
