/**
 * 模块职责：回归验证模块，围绕 `self-update` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `self-update`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: release hash validation, isolated canary, activation, rollback and failed-start recovery; witness launcher follows activation and rollback, preserves CLI arguments and refuses tampering.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Launcher fixtures share the real managed transport. Standalone release assets are
// checked separately by dist:check and the production smoke.
// @ts-ignore JavaScript release modules intentionally have no generated declaration file.
import { releaseFiles, writeReleaseManifest, verifyReleaseManifest } from '../scripts/release-manifest.mjs';
// @ts-ignore JavaScript release modules intentionally have no generated declaration file.
import { activateUpdate, pointer, portAvailable, rollbackUpdate, stageUpdate } from '../scripts/self-update.mjs';
// @ts-ignore The fixture shares the production managed transport.
import { networkRuntime } from '../scripts/network-client.mjs';
after(() => networkRuntime.close());

const repository = fileURLToPath(new URL('..', import.meta.url));
const fakeServer = `import { createServer } from 'node:http';
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ enabled: false, session: { locked: false } }));
});
server.listen(Number(process.env.SAKURA_PORT), '127.0.0.1');
process.on('SIGTERM', () => server.close());
`;

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `temporary, installation, source`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `temporary, installation, source`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), 'sakura-update-test-'));
  assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
  const installation = join(temporary, 'installation'), source = join(temporary, 'source');
  for (const root of [installation, source]) {
    for (const directory of ['.sakura-server', '.sakura-witness', 'dist', 'browser-extension', 'scripts'])
      await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, '.sakura-server', 'index.js'), fakeServer);
    await writeFile(join(root, '.sakura-witness', 'ha-witness.js'), 'console.log("witness");\n');
    await writeFile(join(root, 'dist', 'index.html'), '<html></html>');
    await writeFile(join(root, 'browser-extension', 'manifest.json'), '{}');
    await writeFile(join(root, 'scripts', 'versions.mjs'), 'export const PIN = "test";\n');
    await writeFile(join(root, 'scripts', 'network-client.mjs'),
      `export { networkFor, networkRuntime } from ${JSON.stringify(new URL('../scripts/network-client.mjs', import.meta.url).href)};\n`);
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'sakura-vm', version: '0.1.1', type: 'module' }));
    await writeFile(join(root, 'package-lock.json'), '{}');
    await writeFile(join(root, 'README.md'), 'candidate');
  }
  await mkdir(join(installation, '.vendor'));
  await mkdir(join(installation, '.tools'));
  for (const name of ['launch.mjs', 'launch-witness.mjs', 'self-update.mjs', 'release-manifest.mjs'])
    await cp(join(repository, 'scripts', name), join(installation, 'scripts', name));
  await writeReleaseManifest(source);
  return { temporary, installation, source };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: release hash validation, isolated canary, activation, rollback and failed-start recovery
 * 协作入口 / Collaborators: `fixture`, `verifyReleaseManifest`, `assert.equal`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal(manifest.version, '0.1.1')`; `assert.equal(manifest.schemaVersion, 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('release hash validation, isolated canary, activation, rollback and failed-start recovery', async () => {
  const { temporary, installation, source } = await fixture();
  try {
    const manifest = await verifyReleaseManifest(source);
    assert.equal(manifest.version, '0.1.1');
    assert.equal(manifest.schemaVersion, 2);
    assert.ok(manifest.files.some((file: { path: string }) => file.path === '.sakura-witness/ha-witness.js'));
    const staged = await stageUpdate(source, installation, { skipInstall: true });
    assert.match(staged.path, /^versions\/[a-f0-9]{32}$/);
    assert.equal(await readFile(join(installation, staged.path, '.sakura-witness', 'ha-witness.js'), 'utf8'),
      await readFile(join(source, '.sakura-witness', 'ha-witness.js'), 'utf8'));
    assert.deepEqual((await pointer(installation)).active, '.');
    await activateUpdate(staged.path, installation);
    assert.equal((await pointer(installation)).active, staged.path);
    await rollbackUpdate(installation);
    assert.equal((await pointer(installation)).active, '.');
    assert.equal((await pointer(installation)).previous, null);
    await activateUpdate(staged.path, installation);

    // The launcher must restore the previous version if a staged release changes after verification.
    await writeFile(join(installation, ...staged.path.split('/'), 'dist', 'index.html'), 'tampered');
    const port = await portAvailable();
    const launcher = spawn(process.execPath, [join(installation, 'scripts', 'launch.mjs')], {
      cwd: installation, env: { ...process.env, SAKURA_PORT: String(port) },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    launcher.stderr.on('data', (data: Buffer) => { output += data.toString(); });
    try {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/access/status`,
            { signal: AbortSignal.timeout(500) });
          if (response.ok) break;
        } catch {}
        await new Promise((done) => setTimeout(done, 100));
      }
      assert.equal((await pointer(installation)).active, '.');
      assert.equal((await pointer(installation)).previous, null);
      assert.match(output, /自动回滚/);
    } finally {
      launcher.kill();
      await Promise.race([new Promise((done) => launcher.once('exit', done)),
        new Promise((done) => setTimeout(done, 5000))]);
    }
  } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: witness launcher follows activation and rollback, preserves CLI arguments and refuses tampering
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `writeReleaseManifestReplacement`.
 * 检查边界 / Checked boundaries: `assert.match((await launch()).output, /original-witness/)`; `assert.equal(active.code, 0, active.output)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('witness launcher follows activation and rollback, preserves CLI arguments and refuses tampering', async () => {
  const { temporary, installation, source } = await fixture();
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`new Promise<{ code: number | null; output: string }>((done, fail) => { const chi…`）。
   * Result: Return the branch-computed value (`new Promise<{ code: number | null; output: string }>((done, fail) => { const chi…`).
   * 验证场景 / Scenario: witness launcher follows activation and rollback, preserves CLI arguments and refuses tampering
   */
  const launch = () => new Promise<{ code: number | null; output: string }>((done, fail) => {
    const child = spawn(process.execPath, [join(installation, 'scripts', 'launch-witness.mjs'),
      '--preflight', 'relative config.json'], { cwd: temporary, windowsHide: true });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream!.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.once('error', fail); child.once('exit', (code) => done({ code, output }));
  });
  try {
    await writeFile(join(installation, '.sakura-witness', 'ha-witness.js'), 'console.log("original-witness");');
    await writeFile(join(source, '.sakura-witness', 'ha-witness.js'),
      'console.log(JSON.stringify({version:"candidate-witness",args:process.argv.slice(2),cwd:process.cwd()}));');
    await writeReleaseManifestReplacement(source);
    const staged = await stageUpdate(source, installation, { skipInstall: true, skipCanary: true });
    assert.match((await launch()).output, /original-witness/);
    await activateUpdate(staged.path, installation);
    const active = await launch(); assert.equal(active.code, 0, active.output);
    assert.deepEqual(JSON.parse(active.output), { version: 'candidate-witness',
      args: ['--preflight', 'relative config.json'], cwd: temporary });
    await rollbackUpdate(installation); assert.match((await launch()).output, /original-witness/);
    await activateUpdate(staged.path, installation);
    await writeFile(join(installation, staged.path, '.sakura-witness', 'ha-witness.js'), 'console.log("tampered-witness");');
    const denied = await launch(); assert.notEqual(denied.code, 0); assert.match(denied.output, /SHA-256/);
    assert.doesNotMatch(denied.output, /tampered-witness|original-witness/);
    assert.equal((await pointer(installation)).active, staged.path);
  } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: witness changes, missing entry and additional files fail release verification and staging
 * 协作入口 / Collaborators: `fixture`, `join`, `writeFile`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(stageUpdate(source, installation, { skipInstall: true, skipCanary: true }), /SHA-256/)`; `assert.rejects(verifyReleaseManifest(source), /见证程序入口/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('witness changes, missing entry and additional files fail release verification and staging', async () => {
  const { temporary, installation, source } = await fixture();
  const witness = join(source, '.sakura-witness', 'ha-witness.js');
  try {
    await writeFile(witness, 'tampered');
    await assert.rejects(stageUpdate(source, installation, { skipInstall: true, skipCanary: true }), /SHA-256/);
    await writeReleaseManifestReplacement(source);
    await rm(witness);
    await assert.rejects(verifyReleaseManifest(source), /见证程序入口/);
    await writeFile(witness, 'restored');
    await writeReleaseManifestReplacement(source);
    await writeFile(join(source, '.sakura-witness', 'unexpected.js'), 'extra');
    await assert.rejects(verifyReleaseManifest(source), /SHA-256/);
    assert.equal((await pointer(installation)).active, '.');
  } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy releases without a witness remain verifiable, stageable and activatable
 * 协作入口 / Collaborators: `fixture`, `rm`, `join`, `releaseFiles`.
 * 检查边界 / Checked boundaries: `assert.equal((await verifyReleaseManifest(source)).schemaVersion, 1)`; `assert.equal((await verifyReleaseManifest(join(installation, staged.path))).schemaVersion, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('legacy releases without a witness remain verifiable, stageable and activatable', async () => {
  const { temporary, installation, source } = await fixture();
  try {
    await rm(join(source, '.sakura-witness'), { recursive: true });
    const files = await releaseFiles(source, 1);
    const fingerprint = createHash('sha256').update(JSON.stringify(files)).digest('hex');
    await writeFile(join(source, 'sakura-release.json'), JSON.stringify({ schemaVersion: 1,
      name: 'sakura-vm', version: '0.1.1', fingerprint, files }));
    assert.equal((await verifyReleaseManifest(source)).schemaVersion, 1);
    const staged = await stageUpdate(source, installation, { skipInstall: true, skipCanary: true });
    assert.equal((await verifyReleaseManifest(join(installation, staged.path))).schemaVersion, 1);
    await activateUpdate(staged.path, installation);
    assert.equal((await pointer(installation)).active, staged.path);
    await rollbackUpdate(installation);
    assert.equal((await pointer(installation)).active, '.');
  } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: tampered package and changed runtime pin fail before activation
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(stageUpdate(source, installation, { skipInstall: true, skipCanary: true }), /SHA-256/)`; `assert.equal((await pointer(installation)).active, '.')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('tampered package and changed runtime pin fail before activation', async () => {
  const { temporary, installation, source } = await fixture();
  try {
    await writeFile(join(source, 'README.md'), 'modified');
    await assert.rejects(stageUpdate(source, installation, { skipInstall: true, skipCanary: true }),
      /SHA-256/);
    assert.equal((await pointer(installation)).active, '.');
    await writeReleaseManifestReplacement(source);
    await writeFile(join(source, 'scripts', 'versions.mjs'), 'export const PIN = "new";\n');
    await writeReleaseManifestReplacement(source);
    await assert.rejects(stageUpdate(source, installation, { skipInstall: true, skipCanary: true }),
      /完整安装流程/);
    assert.equal((await pointer(installation)).active, '.');
  } finally { await rm(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); }
});

/**
 * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
 * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
 * 输入 / Inputs: source: string。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `import`, `unlink`, `join`, `writeReleaseManifest`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function writeReleaseManifestReplacement(source: string) {
  const { unlink } = await import('node:fs/promises');
  await unlink(join(source, 'sakura-release.json'));
  await writeReleaseManifest(source);
}
