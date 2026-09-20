import assert from 'node:assert/strict';
import { mkdtemp, mkdir, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const testRoot = await mkdtemp(join(tmpdir(), 'sakura-smoke-'));
process.env.SAKURA_DATA_DIR = testRoot;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
await mkdir('artifacts', { recursive: true });
const engine = await createRuntime();
console.log('ENGINE', engine.version, 'via PosixLoom', engine.runtime.info().nativeHost);
const machines = new Machines(engine);
await machines.init();
let id = '';
async function boot() {
  await machines.start(id);
  const until = Date.now() + 270000;
  while (Date.now() < until) {
    const status = machines.state(id);
    if (status === 'running') return;
    if (status === 'error' || status === 'stopped')
      throw new Error(JSON.stringify(await machines.view(id)) + '\n' + machines.logs.get(id));
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Boot timed out\n' + machines.logs.get(id));
}
try {
  const vm = await machines.create({
    name: `verify-${Date.now().toString(36)}`,
    memoryMiB: 512,
    cpus: 2,
    diskGiB: 8,
  });
  id = vm.id;
  machines.on(`log:${id}`, (text) => {
    void appendFile('artifacts/vm-smoke.log', text);
  });
  console.log('Boot 1: provisioning guest');
  await boot();
  const uname = await machines.exec(id, 'uname -a; cat /etc/alpine-release');
  console.log('\nREAL GUEST', uname.stdout);
  assert.equal(uname.code, 0);
  assert.match(uname.stdout, /Linux/);
  await machines.writeGuestFile(id, '/workspace/persistence.txt', 'before snapshot\n');
  assert.equal(await machines.readGuestFile(id, '/workspace/persistence.txt'), 'before snapshot\n');
  console.log('SFTP OK', await machines.files(id, '/workspace'));
  await assert.rejects(machines.snapshot(id, 'unsafe'), /停止/);
  await machines.stop(id);
  const snapshot = await machines.snapshot(id, 'Verified clean state');
  console.log('Boot 2: checking persisted files');
  await boot();
  assert.equal(await machines.readGuestFile(id, '/workspace/persistence.txt'), 'before snapshot\n');
  await machines.writeGuestFile(id, '/workspace/persistence.txt', 'after snapshot\n');
  await machines.stop(id);
  await machines.restore(id, snapshot.id);
  console.log('Boot 3: checking restored snapshot');
  await boot();
  assert.equal(await machines.readGuestFile(id, '/workspace/persistence.txt'), 'before snapshot\n');
  console.log('\nPASS: real Linux, SSH, SFTP, reboot persistence, offline snapshot restore.');
} finally {
  if (id) {
    await machines.stop(id, true).catch(() => {});
    await machines.delete(id).catch(() => {});
  }
  await machines.close();
  await rm(testRoot, { recursive: true, force: true });
}
