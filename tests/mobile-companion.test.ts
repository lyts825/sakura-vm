import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MobileCompanion } from '../server/mobile-companion.ts';
import type { AccessControl } from '../server/access-control.ts';

const ownerId = '00000000-0000-4000-8000-000000000001';
const vmA = '00000000-0000-4000-8000-000000000002';
const vmB = '00000000-0000-4000-8000-000000000003';
const defaultPolicy = { enabled: true, vmIds: [vmA], kinds: ['cpu'] };

test('mobile companion pairs through a bounded code and filters durable read-only feeds', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-mobile-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'mobile.json');
  let now = Date.UTC(2026, 0, 1), ownerPresent = true, allowed = true;
  const access = { enabled: true, users: () => ownerPresent
    ? [{ id: ownerId, role: 'owner' }] : [] } as unknown as AccessControl;
  let service = new MobileCompanion(access, async () => ({
    vms: [{ id: vmA, name: 'Allowed', status: 'running' },
      { id: vmB, name: 'Private', status: 'stopped' }],
    alerts: [
      { id: 'a', vmId: vmA, kind: 'cpu', message: 'sensitive detail',
        createdAt: new Date(now).toISOString(), acknowledged: false },
      { id: 'b', vmId: vmB, kind: 'cpu', message: 'private machine',
        createdAt: new Date(now).toISOString(), acknowledged: false },
      { id: 'c', vmId: vmA, kind: 'secret', message: 'private secret name',
        createdAt: new Date(now).toISOString(), acknowledged: false },
    ],
  }), () => { if (!allowed) throw new Error('locked'); }, file, () => now);
  await service.init();
  const server = createServer((request, response) => void service.handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await service.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const origin = `https://127.0.0.1:${address.port}`;
  const post = (path: string, input: unknown, extra: Record<string, string> = {}) =>
    fetch(base + path, { method: 'POST', headers: { origin, 'content-type': 'application/json',
      ...extra }, body: JSON.stringify(input) });

  const page = await fetch(base + '/mobile/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.equal((await fetch(base + '/mobile/feed')).status, 401);
  await assert.rejects(service.action(ownerId, { operation: 'pair', policy: {
    ...defaultPolicy, vmIds: [vmA, vmA] } }));
  const pairing = await service.action(ownerId, { operation: 'pair', policy: defaultPolicy });
  assert.ok('code' in pairing && typeof pairing.code === 'string');
  assert.equal((await fetch(base + '/mobile/connect', { method: 'POST',
    headers: { origin: 'https://attacker.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Phone', code: pairing.code }) })).status, 403);
  for (let index = 0; index < 5; index++)
    assert.equal((await post('/mobile/connect', { name: 'Phone', code: 'x'.repeat(12) })).status, 403);
  assert.equal((await post('/mobile/connect', { name: 'Phone', code: pairing.code })).status, 429);
  now += 60_001;
  const connected = await post('/mobile/connect', { name: 'Phone', code: pairing.code });
  assert.equal(connected.status, 201);
  const cookie = connected.headers.get('set-cookie')?.split(';')[0] || '';
  assert.match(cookie, /^__Host-sakura-mobile=[a-f0-9]{64}$/);
  assert.ok(!await readFile(file, 'utf8').then((content) => content.includes(cookie.split('=')[1])));
  assert.equal((await post('/mobile/connect', { name: 'Replay', code: pairing.code })).status, 403);
  const feedResponse = await fetch(base + '/mobile/feed', { headers: { cookie } });
  assert.equal(feedResponse.status, 200);
  const feed = await feedResponse.json();
  assert.deepEqual(feed.vms, [{ id: vmA, name: 'Allowed', status: 'running' }]);
  assert.deepEqual(feed.alerts.map((item: { id: string }) => item.id), ['a']);
  assert.ok(!JSON.stringify(feed).includes('sensitive detail'));
  assert.ok(!JSON.stringify(feed).includes('Private'));
  assert.ok(!JSON.stringify(feed).includes('private secret'));
  const id = service.view(ownerId).devices[0].id;
  await service.action(ownerId, { operation: 'policy', id,
    policy: { enabled: false, vmIds: [vmA], kinds: ['cpu'] } });
  const paused = await fetch(base + '/mobile/feed', { headers: { cookie } }).then((res) => res.json());
  assert.deepEqual(paused.vms, []);
  assert.deepEqual(paused.alerts, []);
  await service.close();
  service = new MobileCompanion(access, async () => ({ vms: [], alerts: [] }),
    () => { if (!allowed) throw new Error('locked'); }, file, () => now);
  await service.init();
  assert.equal(service.view(ownerId).devices[0].policy.enabled, false);
  allowed = false;
  assert.equal((await fetch(base + '/mobile/feed', { headers: { cookie } })).status, 400);
  allowed = true;
  ownerPresent = false;
  assert.equal((await fetch(base + '/mobile/feed', { headers: { cookie } })).status, 403);
  ownerPresent = true;
  await service.action(ownerId, { operation: 'revoke', id });
  assert.equal((await fetch(base + '/mobile/feed', { headers: { cookie } })).status, 401);
});

test('mobile disconnect revokes its server credential', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-mobile-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const access = { enabled: true, users: () => [{ id: ownerId, role: 'owner' }] } as
    unknown as AccessControl;
  const service = new MobileCompanion(access, async () => ({
    vms: [{ id: vmA, name: 'Allowed', status: 'running' }], alerts: [] }),
    undefined, join(directory, 'mobile.json'));
  await service.init();
  const server = createServer((request, response) => void service.handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await service.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const origin = `https://127.0.0.1:${address.port}`;
  const pairing = await service.action(ownerId, { operation: 'pair', policy: defaultPolicy });
  assert.ok('code' in pairing && typeof pairing.code === 'string');
  const connected = await fetch(base + '/mobile/connect', { method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Phone', code: pairing.code }) });
  const cookie = connected.headers.get('set-cookie')?.split(';')[0] || '';
  assert.equal(service.view(ownerId).devices.length, 1);
  const removed = await fetch(base + '/mobile/disconnect', { method: 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(removed.status, 200);
  assert.match(removed.headers.get('set-cookie') || '', /Max-Age=0/);
  assert.equal(service.view(ownerId).devices.length, 0);
  assert.equal((await fetch(base + '/mobile/feed', { headers: { cookie } })).status, 401);
});
