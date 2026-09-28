#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointer, setPointer, versionPath, waitForHealth } from './self-update.mjs';
import { verifyReleaseManifest } from './release-manifest.mjs';

const installation = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.SAKURA_PORT || 7337);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效');

async function requireFreePort() {
  const probe = createServer();
  await new Promise((done, fail) => probe.listen(port, '127.0.0.1', done).once('error', fail));
  await new Promise((done) => probe.close(done));
}

async function launch(version) {
  const path = versionPath(installation, version);
  if (version !== '.') await verifyReleaseManifest(path);
  const entry = join(path, '.sakura-server', 'index.js');
  await access(entry);
  const child = spawn(process.execPath, [entry], {
    cwd: path, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, SAKURA_DATA_DIR: process.env.SAKURA_DATA_DIR || join(installation, '.data'),
      SAKURA_PORT: String(port) },
  });
  child.on('error', (error) => { child.launchError = error; });
  try { await waitForHealth(child, port); }
  catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    throw error;
  }
  return child;
}

async function main() {
  await requireFreePort();
  const current = await pointer(installation);
  let child;
  try { child = await launch(current.active); }
  catch (error) {
    if (!current.previous) throw error;
    console.error(`新版本启动失败，自动回滚：${error.message}`);
    await setPointer(installation, current.previous, null);
    child = await launch(current.previous);
  }
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); });
  process.exitCode = await new Promise((done) => child.once('exit', (code) => done(code ?? 1)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => { console.error(error); process.exitCode = 1; });
