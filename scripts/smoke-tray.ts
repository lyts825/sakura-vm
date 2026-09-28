import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') {
  console.log('Windows tray smoke test skipped on this platform.');
  process.exit(0);
}
const directory = await mkdtemp(join(tmpdir(), 'sakura-tray-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.match(basename(directory), /^sakura-tray-/);
const config = join(directory, 'tray.json');
const listener = createServer();
await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
const port = (listener.address() as { port: number }).port;
await new Promise<void>((done) => listener.close(() => done()));
const script = resolve('scripts/sakura-tray.ps1');
const run = async (...args: string[]) => {
  const { stdout } = await promisify(execFile)('powershell.exe',
    ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-ConfigPath', config, ...args], {
      cwd: resolve('.'), windowsHide: true, timeout: 30_000,
      env: { ...process.env, SAKURA_DATA_DIR: join(directory, 'data'),
        SAKURA_IMAGE_PATH: resolve('.data/images/alpine-3.23.qcow2') },
    });
  return stdout.trim() ? JSON.parse(stdout.trim()) as Record<string, any> : {};
};
let ownedPid: number | undefined;
try {
  assert.equal((await run('-Probe', '-Port', String(port))).state, 'offline');
  const launched = await run('-StartOnce', '-Port', String(port));
  assert.equal(launched.state, 'running');
  assert.equal(launched.started, true);
  assert.ok(Number.isInteger(launched.pid) && launched.pid > 0);
  ownedPid = launched.pid;
  const duplicate = await run('-StartOnce', '-Port', String(port));
  assert.equal(duplicate.started, false);
  assert.equal(duplicate.pid, null);
  assert.equal((await run('-SelfTest', '-Port', String(port))).formsReady, true);
  await run('-ExitAfterSeconds', '1', '-Port', String(port));
  const policy = await run('-SetServerAutostart', 'on', '-Port', String(port));
  assert.equal(policy.startServer, true);
  const saved = await run('-Probe');
  assert.equal(saved.port, port);
  assert.equal(saved.startServer, true);
  assert.equal(saved.state, 'running');
  console.log('Windows tray launches one hidden Sakura process, reads live status and restores policy.');
} finally {
  if (ownedPid) {
    try { process.kill(ownedPid, 'SIGTERM'); } catch {}
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await fetch(`http://127.0.0.1:${port}/api/access/status`,
          { signal: AbortSignal.timeout(500) });
        await delay(200);
      } catch { break; }
    }
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
