import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
async function probe(selected, expected) {
  const data = await mkdtemp(join(tmpdir(), 'sakura-production-'));
  if (!resolve(data).startsWith(resolve(tmpdir()) + sep)) throw new Error('临时数据目录越界');
  if (selected.length)
    await writeFile(
      join(data, 'plugins.json'),
      JSON.stringify({ schemaVersion: 3, plugins: selected, packs: [] }),
    );
  const listener = createServer();
  await new Promise((done, fail) => listener.listen(0, '127.0.0.1', done).once('error', fail));
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  const server = spawn(process.execPath, ['.sakura-server/index.js'], {
    cwd: root,
    env: { ...process.env, SAKURA_DATA_DIR: data, SAKURA_PORT: String(port) },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const exited = new Promise((done) => {
    server.once('exit', done);
    server.once('error', done);
  });
  server.stdout.on('data', (chunk) => (output += chunk));
  server.stderr.on('data', (chunk) => (output += chunk));
  server.on('error', (error) => (output += error.message));
  const origin = `http://127.0.0.1:${port}`;
  try {
    let bootstrap;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null || server.signalCode !== null)
        throw new Error(`编译版服务提前退出：${output}`);
      try {
        const response = await fetch(`${origin}/api/bootstrap`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          bootstrap = await response.json();
          break;
        }
      } catch {}
      await delay(200);
    }
    assert.ok(bootstrap?.token, `编译版服务未启动：${output}`);
    const headers = { 'x-sakura-token': bootstrap.token };
    const [system, plugins, html] = await Promise.all([
      fetch(`${origin}/api/system`, { headers }).then((response) => response.json()),
      fetch(`${origin}/api/plugins`, { headers }).then((response) => response.json()),
      fetch(origin).then((response) => response.text()),
    ]);
    assert.deepEqual([...system.plugins].sort(), [...expected].sort());
    assert.deepEqual([...plugins.active].sort(), [...expected].sort());
    assert.deepEqual(plugins.errors, {});
    assert.equal(plugins.plugins.length, 32);
    const auditBefore = await fetch(origin + '/api/audit', { headers }).then((response) => response.json());
    assert.equal(auditBefore.valid, true);
    const rejected = await fetch(origin + '/api/audit-smoke', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'AUDIT_BODY_MUST_NOT_APPEAR' }),
    });
    assert.equal(rejected.status, 404);
    const auditAfter = await fetch(origin + '/api/audit', { headers }).then((response) => response.json());
    assert.equal(auditAfter.valid, true);
    assert.ok(auditAfter.sequence >= auditBefore.sequence + 2);
    const requestEvents = auditAfter.records.filter((entry) => entry.event.name === 'POST /api/audit-smoke');
    assert.equal(requestEvents.length, 2);
    assert.equal(requestEvents[1].event.status, 404);
    assert.equal(requestEvents[0].event.traceId, requestEvents[1].event.traceId);
    assert.ok(!JSON.stringify(auditAfter).includes('AUDIT_BODY_MUST_NOT_APPEAR'));
    const sandboxResponse = await fetch(origin + '/api/sandboxes', { headers });
    assert.equal(sandboxResponse.status, expected.includes('sandbox') ? 200 : 403);
    if (expected.includes('sandbox')) {
      assert.deepEqual(await sandboxResponse.json(), { sandboxes: [], runs: [] });
      const invalid = await fetch(origin + '/api/sandboxes', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ name: '../invalid', forwards: [{ host: 8080, guest: 80 }] }),
      });
      assert.equal(invalid.status, 400);
    }
    assert.match(html, /<div id="root"><\/div>/);
    console.log(`Compiled server passed: ${expected.length} active plugins, static UI.`);
  } finally {
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
    await Promise.race([exited, delay(10_000)]);
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
    await rm(data, { recursive: true, force: true });
  }
}

await probe([], []);
await probe(['metrics'], ['metrics']);
await probe(['commands'], ['projects', 'commands']);
await probe(['commands', 'metrics'], ['projects', 'commands', 'metrics']);
await probe(['sandbox'], ['sandbox']);
