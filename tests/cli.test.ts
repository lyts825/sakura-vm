import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';

async function fixture(t: TestContext, fail: boolean) {
  let exports = 0;
  const http = createServer((req, res) => {
    if (req.url === '/api/bootstrap') res.end(JSON.stringify({ token: 'test' }));
    else if (req.url === '/api/vms') res.end(JSON.stringify([{ id: 'vm', name: 'example' }]));
    else if (req.url === '/api/vms/vm/export') {
      exports++;
      res.writeHead(200, { 'Content-Length': '32' });
      if (fail) {
        res.write('partial');
        setTimeout(() => res.destroy(), 25);
      } else res.end(Buffer.alloc(32, 1));
    } else res.writeHead(404).end();
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const directory = await mkdtemp(join(tmpdir(), 'sakura-cli-test-'));
  t.after(async () => {
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('sakura-cli-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  const destination = join(directory, 'output.sakura');
  const run = async () => {
    const child = spawn(process.execPath, [resolve('scripts/cli.mjs'), 'export', 'example', destination], {
      windowsHide: true,
      env: { ...process.env, SAKURA_PORT: String((http.address() as { port: number }).port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    const [code] = await once(child, 'exit');
    return { code, stderr };
  };
  return { run, destination, exports: () => exports };
}

test('failed CLI exports remove the partial output so the same filename can be retried', async (t) => {
  const { run, destination, exports } = await fixture(t, true);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await run();
    assert.equal(result.code, 1, result.stderr);
    await assert.rejects(stat(destination), { code: 'ENOENT' });
  }
  assert.equal(exports(), 2);
});

test('CLI export rejects an existing destination before starting disk preparation', async (t) => {
  const { run, destination, exports } = await fixture(t, false);
  await writeFile(destination, 'keep this backup');
  assert.equal((await run()).code, 1);
  assert.equal(await readFile(destination, 'utf8'), 'keep this backup');
  assert.equal(exports(), 0);
});

test('successful CLI exports keep the complete original binary bytes', async (t) => {
  const { run, destination, exports } = await fixture(t, false);
  const result = await run();
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await readFile(destination), Buffer.alloc(32, 1));
  assert.equal(exports(), 1);
});
