import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') throw new Error('Windows host required');
const directory = await mkdtemp(join(tmpdir(), 'sakura-process-interop-vm-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { ProcessInterop, guestInteropRequest } = await import('../server/process-interop.ts');
const { readJsonBody } = await import('../server/http.ts');
const { freePort } = await import('../server/qmp.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const port = await freePort();
const interop = new ProcessInterop(machines, port);
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.url, '/api/guest/interop');
    assert.equal(req.method, 'POST');
    assert.ok(['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || ''));
    assert.equal(req.headers.host, `localhost:${port}`);
    const input = guestInteropRequest.parse(await readJsonBody(req, 4096));
    const result = await interop.guest(input, req.headers['x-sakura-guest-token'] as string);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead((error as { status?: number }).status || 500,
      { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: (error as Error).message }));
  }
});
await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
try {
  const vm = await machines.create({ name: 'process-interop-smoke', memoryMiB: 512,
    cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 300000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(300);
  }
  await interop.action(vm.id, { mode: 'allow', programId: 'whoami',
    executable: 'C:\\Windows\\System32\\whoami.exe' }, 'run');
  await interop.action(vm.id, { mode: 'allow', programId: 'exit7',
    executable: 'C:\\Windows\\System32\\cmd.exe', fixedArgs: ['/c', 'exit 7'] }, 'run');
  const installed = await interop.action(vm.id, { mode: 'install' }, 'run');
  assert.equal(installed.ready, true);
  const permissions = await machines.exec(vm.id, 'stat -c %a /etc/sakura/interop.curl');
  assert.equal(permissions.stdout.trim(), '600');
  const called = await machines.exec(vm.id, 'sakura-win whoami', 60000);
  assert.equal(called.code, 0, called.stdout + called.stderr);
  assert.match(called.stdout, /\\/);
  const nonzero = await machines.exec(vm.id, 'sakura-win exit7', 60000);
  assert.equal(nonzero.code, 7, nonzero.stdout + nonzero.stderr);
  const denied = await machines.exec(vm.id, 'sakura-win unlisted', 60000);
  assert.notEqual(denied.code, 0);
  await interop.action(vm.id, { mode: 'disable' }, 'run');
  const revoked = await machines.exec(vm.id, 'sakura-win whoami', 60000);
  assert.notEqual(revoked.code, 0);
  console.log('Real Alpine guest invoked registered Windows EXEs with exit codes, denylist and revocation.');
} finally {
  await new Promise<void>((done) => server.close(() => done()));
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-process-interop-vm-'));
  await rm(directory, { recursive: true, force: true });
}
