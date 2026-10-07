/**
 * 模块职责：共享测试夹具模块，围绕 `project-egress-apk-fixture` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Shared test fixture for `project-egress-apk-fixture`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: APK fixture serves only frozen binary files and actually closes all sockets; APK fixture rejects changed bytes, duplicate entries and nonofficial source URLs before serving.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { get, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startAlpineApkFixture } from '../scripts/project-egress-apk-fixture.ts';

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `root, path, manifest`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `root, path, manifest`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Buffer.from`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: port: number; path: string; method = 'GET'。
 * 结果：返回分支计算值（`await new Promise<{ code: number; bytes: Buffer }>((done, reject) => { const cli…`），以 Promise 交付。
 * Result: Return the branch-computed value (`await new Promise<{ code: number; bytes: Buffer }>((done, reject) => { const cli…`) through a Promise.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: APK fixture serves only frozen binary files and actually closes all sockets
 * 协作入口 / Collaborators: `fixture`, `startAlpineApkFixture`, `fetchFixture`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(binary.code, 200)`; `assert.deepEqual(binary.bytes, Buffer.from([0, 255, 10, 13, 42]))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: APK fixture rejects changed bytes, duplicate entries and nonofficial source URLs before serving
 * 状态影响 / State effects: `wrongSource.manifest.files[0].url`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `Buffer.alloc`.
 * 检查边界 / Checked boundaries: `assert.rejects(startAlpineApkFixture(changed.path), /digest mismatch/)`; `assert.rejects(startAlpineApkFixture(duplicate.path), /duplicate/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: APK fixture requires both indexes, refuses path traversal and records changed cache after serving
 * 状态影响 / State effects: `missing.manifest.files`, `traversal.manifest.files[0].name`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `missing.manifest.files.filter`, `writeFile`, `JSON.stringify`.
 * 检查边界 / Checked boundaries: `assert.rejects(startAlpineApkFixture(missing.path))`; `assert.rejects(startAlpineApkFixture(traversal.path))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
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
