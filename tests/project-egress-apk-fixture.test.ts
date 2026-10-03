import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { get, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startAlpineApkFixture } from '../scripts/project-egress-apk-fixture.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sakura-apk-fixture-'));
  const files: Array<{ repo: string; name: string; size: number; sha256: string; url: string }> = [];
  for (const [repo, name, bytes] of [
    ['main', 'APKINDEX.tar.gz', Buffer.from('test main index')],
    ['community', 'APKINDEX.tar.gz', Buffer.from('test community index')],
    ['main', 'test-package-1.0-r0.apk', Buffer.from([0, 255, 10, 13, 42])],
  ] as const) {
    const folder = join(root, repo, 'x86_64');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, name), bytes, { flag: 'wx' });
    files.push({ repo, name, size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      url: 'https://dl-cdn.alpinelinux.org/alpine/v3.23/' + repo + '/x86_64/' + name });
  }
  const manifest = { version: 1, kind: 'official-alpine-apk-fixture', distro: 'v3.23', arch: 'x86_64', files };
  const path = join(root, 'manifest.json');
  await writeFile(path, JSON.stringify(manifest), { flag: 'wx' });
  return { root, path, manifest };
}
async function fetchFixture(port: number, path: string, method = 'GET') {
  return await new Promise<{ code: number; bytes: Buffer }>((done, reject) => {
    const client = request({ hostname: '127.0.0.1', port, path, method }, response => {
      const chunks: Buffer[] = [];
      response.on('data', bytes => chunks.push(bytes));
      response.once('error', reject);
      response.once('end', () => done({ code: response.statusCode!, bytes: Buffer.concat(chunks) }));
    });
    client.once('error', reject);
    client.end();
  });
}

test('APK fixture serves only frozen binary files and actually closes all sockets', async () => {
  const local = await fixture();
  const server = await startAlpineApkFixture(local.path);
  try {
    const binary = await fetchFixture(server.hostPort, '/main/x86_64/test-package-1.0-r0.apk');
    assert.equal(binary.code, 200);
    assert.deepEqual(binary.bytes, Buffer.from([0, 255, 10, 13, 42]));
    assert.equal((await fetchFixture(server.hostPort, '/main/x86_64/APKINDEX.tar.gz', 'HEAD')).bytes.length, 0);
    for (const path of ['/manifest.json', '/../manifest.json', '/main/x86_64/APKINDEX.tar.gz?query=1',
      '/main/x86_64/%2e%2e/manifest.json', 'https://example.invalid/package.apk'])
      assert.equal((await fetchFixture(server.hostPort, path)).code, 404);
    assert.equal((await fetchFixture(server.hostPort, '/main/x86_64/APKINDEX.tar.gz', 'POST')).code, 405);
  } finally { await server.close(); }
  assert.equal(server.proof.actualServerClosed, true);
  assert.equal(server.proof.activeSockets, 0);
  assert.equal(server.proof.cacheUnchanged, true);
  assert.deepEqual(server.proof.changed, []);
  assert.ok(server.proof.requests.every(entry => entry.finishedAt && entry.closedAt));
  await server.close();
  await assert.rejects(new Promise((done, reject) => {
    const client = get('http://127.0.0.1:' + server.hostPort + '/', done);
    client.once('error', reject);
  }));
});

test('APK fixture rejects changed bytes, duplicate entries and nonofficial source URLs before serving', async () => {
  const changed = await fixture();
  await writeFile(join(changed.root, 'main/x86_64/test-package-1.0-r0.apk'), Buffer.alloc(5, 1));
  await assert.rejects(startAlpineApkFixture(changed.path), /digest mismatch/);
  const duplicate = await fixture();
  duplicate.manifest.files.push(duplicate.manifest.files[0]);
  await writeFile(duplicate.path, JSON.stringify(duplicate.manifest));
  await assert.rejects(startAlpineApkFixture(duplicate.path), /duplicate/);
  const wrongSource = await fixture();
  wrongSource.manifest.files[0].url = wrongSource.manifest.files[0].url.replace('dl-cdn.alpinelinux.org', 'example.invalid');
  await writeFile(wrongSource.path, JSON.stringify(wrongSource.manifest));
  await assert.rejects(startAlpineApkFixture(wrongSource.path));
});

test('APK fixture requires both indexes, refuses path traversal and records changed cache after serving', async () => {
  const missing = await fixture();
  missing.manifest.files = missing.manifest.files.filter(entry => entry.repo !== 'community');
  await writeFile(missing.path, JSON.stringify(missing.manifest));
  await assert.rejects(startAlpineApkFixture(missing.path));
  const traversal = await fixture();
  traversal.manifest.files[0].name = '../APKINDEX.tar.gz';
  await writeFile(traversal.path, JSON.stringify(traversal.manifest));
  await assert.rejects(startAlpineApkFixture(traversal.path));
  const changed = await fixture();
  const server = await startAlpineApkFixture(changed.path);
  const path = join(changed.root, 'main/x86_64/test-package-1.0-r0.apk');
  const original = await readFile(path);
  await writeFile(path, Buffer.alloc(original.length, 2));
  try {
    assert.deepEqual((await fetchFixture(server.hostPort, '/main/x86_64/test-package-1.0-r0.apk')).bytes, original);
  } finally { await server.close(); }
  assert.equal(server.proof.actualServerClosed, true);
  assert.equal(server.proof.activeSockets, 0);
  assert.equal(server.proof.cacheUnchanged, false);
  assert.deepEqual(server.proof.changed, [path]);
});
