import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointer, portAvailable, waitForHealth } from './self-update.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'sakura-update-smoke-'));
assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
const port = await portAvailable();
const before = await pointer(root);
const child = spawn(process.execPath, [join(root, 'scripts', 'launch.mjs')], {
  cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, SAKURA_DATA_DIR: join(temporary, 'data'), SAKURA_PORT: String(port) },
});
let output = '';
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (chunk) => { output += chunk.toString(); });
child.on('error', (error) => { child.launchError = error; });
try {
  await waitForHealth(child, port);
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<html/);
  assert.equal((await pointer(root)).active, before.active,
    `候选版本意外回滚：${output}`);
  console.log(`启动版本 ${before.active} 通过编译版健康检查与首页读取。`);
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await Promise.race([new Promise((done) => child.once('exit', done)),
      new Promise((done) => setTimeout(done, 5000))]);
  }
  await rm(temporary, { recursive: true, force: true });
}
