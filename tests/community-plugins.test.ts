import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
