import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingressAlias } from '../shared/http-ingress.ts';
import { LocalAliases, renderLocalAliases } from '../server/local-aliases.ts';

test('managed hosts block preserves unrelated records and rejects takeover or malformed markers', () => {
  const first = ingressAlias(randomUUID());
  const second = ingressAlias(randomUUID());
  const original = Buffer.from('\ufeff# Windows hosts\r\n127.0.0.1 custom.test\r\n');
  const updated = renderLocalAliases(original, [first, second]).next;
  const text = updated.toString('utf8');
  assert.ok(text.startsWith('\ufeff# Windows hosts\r\n127.0.0.1 custom.test\r\n'));
  assert.match(text, new RegExp(`127\\.0\\.0\\.1 ${first}`));
  assert.deepEqual(renderLocalAliases(updated, [first, second]).next, updated);
  assert.deepEqual(renderLocalAliases(updated, []).next, original);
  assert.throws(() => renderLocalAliases(Buffer.from(`192.0.2.1 ${first}\n`), [first]),
    /已被其他 hosts 规则占用/);
  assert.throws(() => renderLocalAliases(Buffer.from('# BEGIN SAKURA LOCAL ALIASES\n'), [first]),
    /标记区块不完整/);
  assert.throws(() => renderLocalAliases(Buffer.from(
    '# BEGIN SAKURA LOCAL ALIASES\n127.0.0.1 custom.test\n# END SAKURA LOCAL ALIASES\n'),
    [first]), /未知内容/);
});

test('local aliases persist opt-in, reconcile renamed entries and remove only their own block', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-local-aliases-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hosts = join(root, 'hosts');
  const store = join(root, 'settings.json');
  const first = ingressAlias(randomUUID());
  const second = ingressAlias(randomUUID());
  let names = [first];
  const original = '# existing\n127.0.0.1 custom.test\n';
  await writeFile(hosts, original);
  const manager = new LocalAliases(() => names, hosts, store);
  await manager.init();
  assert.equal((await manager.view()).enabled, false);
  await manager.action({ action: 'set-enabled', enabled: true });
  assert.equal((await manager.view()).missing.length, 0);
  assert.match(await readFile(hosts, 'utf8'), new RegExp(first));
  names = [second];
  await manager.refresh();
  const changed = await readFile(hosts, 'utf8');
  assert.ok(changed.includes(second));
  assert.ok(!changed.includes(first));
  const restarted = new LocalAliases(() => names, hosts, store);
  await restarted.init();
  assert.equal((await restarted.view()).enabled, true);
  await restarted.action({ action: 'set-enabled', enabled: false });
  assert.equal(await readFile(hosts, 'utf8'), original);
});

test('failed hosts update retains the requested state and can be retried after repair', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-local-alias-retry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hosts = join(root, 'missing-hosts');
  const store = join(root, 'settings.json');
  const alias = ingressAlias(randomUUID());
  const manager = new LocalAliases(() => [alias], hosts, store);
  await manager.init();
  await assert.rejects(manager.action({ action: 'set-enabled', enabled: true }));
  assert.equal((await manager.view()).enabled, true);
  await writeFile(hosts, '127.0.0.1 localhost\n');
  await manager.action({ action: 'sync' });
  assert.equal((await manager.view()).error, undefined);
  assert.match(await readFile(hosts, 'utf8'), new RegExp(alias));
});

test('system resolver mismatch remains visible after hosts synchronization', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-local-alias-resolver-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hosts = join(root, 'hosts');
  const alias = ingressAlias(randomUUID());
  let address = '192.0.2.8';
  await writeFile(hosts, '127.0.0.1 localhost\n');
  const manager = new LocalAliases(() => [alias], hosts, join(root, 'settings.json'),
    async () => address);
  await manager.init();
  await assert.rejects(manager.action({ action: 'set-enabled', enabled: true }), /不是本机回环地址/);
  assert.equal((await manager.view()).missing.length, 0);
  assert.match((await manager.view()).error || '', /192\.0\.2\.8/);
  address = '127.0.0.1';
  await manager.action({ action: 'sync' });
  assert.equal((await manager.view()).error, undefined);
});
