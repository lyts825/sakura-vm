import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// These scripts also run directly in a minimal release package without a TypeScript build.
// @ts-ignore JavaScript release modules intentionally have no generated declaration file.
import { writeReleaseManifest, verifyReleaseManifest } from '../scripts/release-manifest.mjs';
// @ts-ignore JavaScript release modules intentionally have no generated declaration file.
import { activateUpdate, pointer, portAvailable, rollbackUpdate, stageUpdate } from '../scripts/self-update.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const fakeServer = `import { createServer } from 'node:http';
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ enabled: false, session: { locked: false } }));
});
server.listen(Number(process.env.SAKURA_PORT), '127.0.0.1');
process.on('SIGTERM', () => server.close());
`;

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), 'sakura-update-test-'));
  assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
  const installation = join(temporary, 'installation'), source = join(temporary, 'source');
  for (const root of [installation, source]) {
    for (const directory of ['.sakura-server', 'dist', 'browser-extension', 'scripts'])
      await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, '.sakura-server', 'index.js'), fakeServer);
    await writeFile(join(root, 'dist', 'index.html'), '<html></html>');
    await writeFile(join(root, 'browser-extension', 'manifest.json'), '{}');
    await writeFile(join(root, 'scripts', 'versions.mjs'), 'export const PIN = "test";\n');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'sakura-vm', version: '0.1.1', type: 'module' }));
    await writeFile(join(root, 'package-lock.json'), '{}');
    await writeFile(join(root, 'README.md'), 'candidate');
  }
  await mkdir(join(installation, '.vendor'));
  await mkdir(join(installation, '.tools'));
  for (const name of ['launch.mjs', 'self-update.mjs', 'release-manifest.mjs'])
    await cp(join(repository, 'scripts', name), join(installation, 'scripts', name));
  await writeReleaseManifest(source);
  return { temporary, installation, source };
}

test('release hash validation, isolated canary, activation, rollback and failed-start recovery', async () => {
  const { temporary, installation, source } = await fixture();
  try {
    const manifest = await verifyReleaseManifest(source);
    assert.equal(manifest.version, '0.1.1');
    const staged = await stageUpdate(source, installation, { skipInstall: true });
    assert.match(staged.path, /^versions\/[a-f0-9]{32}$/);
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

async function writeReleaseManifestReplacement(source: string) {
  const { unlink } = await import('node:fs/promises');
  await unlink(join(source, 'sakura-release.json'));
  await writeReleaseManifest(source);
}
