import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { CommunityPlugins, signedPluginPayload, validatePluginWasm } from '../server/community-plugins.ts';

const leb = (number: number) => {
  const bytes: number[] = [];
  do {
    const byte = number & 127;
    number >>>= 7;
    bytes.push(number ? byte | 128 : byte);
  } while (number);
  return bytes;
};
const section = (id: number, bytes: number[]) => [id, ...leb(bytes.length), ...bytes];
const name = (value: string) => {
  const bytes = [...Buffer.from(value)];
  return [...leb(bytes.length), ...bytes];
};
function wasm(maxPages = 1) {
  const result = Buffer.from(JSON.stringify({ ok: true }));
  const output = Buffer.alloc(result.length + 4);
  output.writeUInt32LE(result.length, 0);
  result.copy(output, 4);
  const alloc = [0, 0x41, 32, 0x0b];
  const run = [0, 0x41, 0, 0x0b];
  return Buffer.from([
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    ...section(1, [2, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 2, 0x7f, 0x7f, 1, 0x7f]),
    ...section(3, [2, 0, 1]),
    ...section(5, [1, 1, 1, ...leb(maxPages)]),
    ...section(7, [3, ...name('memory'), 2, 0, ...name('alloc'), 0, 0, ...name('run'), 0, 1]),
    ...section(10, [2, ...leb(alloc.length), ...alloc, ...leb(run.length), ...run]),
    ...section(11, [1, 0, 0x41, 0, 0x0b, ...leb(output.length), ...output]),
  ]);
}

test('signed marketplace installs, runs, rejects tampering and unloads an isolated plugin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-community-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  const file = join(root, 'state.json'),
    directory = join(root, 'wasm');
  const bytes = wasm();
  const pair = generateKeyPairSync('ed25519');
  const pem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const fingerprint = createHash('sha256')
    .update(pair.publicKey.export({ format: 'der', type: 'spki' }))
    .digest('hex');
  const base = {
    schemaVersion: 1 as const,
    id: 'example-plugin',
    name: '示例插件',
    description: '返回固定 JSON，用于验证隔离执行链路。',
    version: '1.0.0',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    publisher: fingerprint,
  };
  const entry = {
    ...base,
    signature: sign(null, signedPluginPayload(base), pair.privateKey).toString('base64'),
    wasmUrl: './example.wasm',
  };
  let listing = { schemaVersion: 1, plugins: [entry] };
  const sourceUrl = 'https://plugins.example/catalog.json';
  const service = new CommunityPlugins(file, directory, async (url) =>
    url === sourceUrl ? Buffer.from(JSON.stringify(listing)) : bytes,
  );
  try {
    await service.init();
    await service.action({ operation: 'trust', name: '示例发布者', publicKey: pem });
    await service.action({ operation: 'add-source', name: '示例目录', url: sourceUrl });
    const source = service.view().sources[0];
    await service.action({ operation: 'refresh', id: source.id });
    await service.action({ operation: 'install', sourceId: source.id, pluginId: base.id });
    assert.deepEqual(
      await service.action({ operation: 'run', pluginId: base.id, input: { hello: 'world' } }),
      { pluginId: base.id, version: '1.0.0', result: { ok: true } },
    );
    const restored = new CommunityPlugins(file, directory);
    await restored.init();
    assert.deepEqual(await restored.action({ operation: 'run', pluginId: base.id, input: null }), {
      pluginId: base.id,
      version: '1.0.0',
      result: { ok: true },
    });
    await restored.close();
    await assert.rejects(service.action({ operation: 'untrust', fingerprint }), /先卸载/);

    listing = { schemaVersion: 1, plugins: [{ ...entry, name: '被篡改的名称' }] };
    await service.action({ operation: 'refresh', id: source.id });
    await assert.rejects(
      service.action({ operation: 'install', sourceId: source.id, pluginId: base.id }),
      /签名验证失败/,
    );
    assert.equal(service.view().installed[0].name, base.name);

    await writeFile(
      join(directory, `${base.id}-${base.version}-${base.sha256}.wasm`),
      Buffer.from('tampered'),
    );
    await assert.rejects(service.action({ operation: 'run', pluginId: base.id, input: {} }), /SHA-256/);
    const damaged = new CommunityPlugins(file, directory);
    await damaged.init();
    assert.match(damaged.view().problems[base.id], /文件损坏/);
    await damaged.close();
    await service.action({ operation: 'uninstall', pluginId: base.id });
    await assert.rejects(service.action({ operation: 'run', pluginId: base.id, input: {} }), /未安装/);
    await service.action({ operation: 'untrust', fingerprint });
    assert.equal(service.view().publishers.length, 0);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('isolated plugin validation requires bounded memory and no host imports', async () => {
  await validatePluginWasm(wasm());
  await assert.rejects(validatePluginWasm(wasm(257)), /16 MiB/);
  await assert.rejects(validatePluginWasm(Buffer.from('not wasm')), /WebAssembly v1/);
});

test('event subscriptions trigger signed WASM once for new metadata-only events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-community-events-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  const file = join(root, 'state.json'), directory = join(root, 'wasm');
  const bytes = wasm();
  const pair = generateKeyPairSync('ed25519');
  const pem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const fingerprint = createHash('sha256')
    .update(pair.publicKey.export({ format: 'der', type: 'spki' })).digest('hex');
  let now = Date.parse('2026-01-01T00:00:00.000Z');
  const base = { schemaVersion: 1 as const, id: 'event-plugin', name: 'Event',
    description: 'Event computation', version: '1.0.0',
    sha256: createHash('sha256').update(bytes).digest('hex'), publisher: fingerprint };
  const entry = { ...base, signature: sign(null, signedPluginPayload(base), pair.privateKey)
    .toString('base64'), wasmUrl: './event.wasm' };
  const catalog = Buffer.from(JSON.stringify({ schemaVersion: 1, plugins: [entry] }));
  const service = new CommunityPlugins(file, directory,
    async (url) => url.endsWith('catalog.json') ? catalog : bytes, () => now);
  const events: Array<{ id: string; type: 'job.finished'; occurredAt: string;
    status: 'done'; tags: string[] }> = [];
  try {
    await service.init();
    await service.action({ operation: 'trust', name: 'Publisher', publicKey: pem });
    await service.action({ operation: 'add-source', name: 'Source',
      url: 'https://plugins.example/catalog.json' });
    const sourceId = service.view().sources[0].id;
    await service.action({ operation: 'refresh', id: sourceId });
    await service.action({ operation: 'install', sourceId, pluginId: base.id });
    service.setEventSource(async () => events, false);
    await service.action({ operation: 'subscribe', pluginId: base.id,
      types: ['job.finished'], enabled: true });
    events.push({ id: 'a'.repeat(64), type: 'job.finished',
      occurredAt: '2025-12-31T23:59:59.000Z', status: 'done', tags: [] });
    await service.tick();
    assert.equal(service.view().deliveries.length, 0);
    now += 1000;
    events.push({ id: 'b'.repeat(64), type: 'job.finished',
      occurredAt: new Date(now).toISOString(), status: 'done', tags: [] });
    await service.tick();
    assert.equal(service.view().deliveries.length, 1);
    assert.equal(service.view().deliveries[0].status, 'done');
    assert.equal(service.view().deliveries[0].resultPreview, '{"ok":true}');
    await service.tick();
    assert.equal(service.view().deliveries.length, 1);
    await service.action({ operation: 'subscribe', pluginId: base.id,
      types: ['job.finished'], enabled: false });
    now += 1000;
    events.push({ id: 'd'.repeat(64), type: 'job.finished',
      occurredAt: new Date(now).toISOString(), status: 'done', tags: [] });
    await service.tick();
    assert.equal(service.view().deliveries.length, 1);
    await service.action({ operation: 'subscribe', pluginId: base.id,
      types: ['job.finished'], enabled: true });
    await service.tick();
    assert.equal(service.view().deliveries.length, 1);
    await service.close();
    const persisted = JSON.parse(await readFile(file, 'utf8'));
    const resumedEvent = { id: 'c'.repeat(64), type: 'job.finished',
      occurredAt: new Date(now).toISOString(), status: 'done', tags: [] };
    const resumedId = createHash('sha256').update(`${base.id}:${resumedEvent.id}`).digest('hex');
    persisted.deliveries.push({ id: resumedId, pluginId: base.id,
      event: resumedEvent, status: 'pending' });
    persisted.observed[resumedId] = now;
    await writeFile(file, JSON.stringify(persisted));
    const restored = new CommunityPlugins(file, directory, undefined, () => now);
    await restored.init();
    restored.setEventSource(async () => events, false);
    now += 50 * 3600000;
    await restored.tick();
    assert.equal(restored.view().deliveries.length, 2);
    assert.equal(restored.view().deliveries[0].status, 'done');
    await restored.action({ operation: 'uninstall', pluginId: base.id });
    assert.equal(restored.view().subscriptions.length, 0);
    await restored.close();
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
