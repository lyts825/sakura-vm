import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(resolve(tmpdir(), 'sakura-dap-smoke-'));
const distro = process.env.SAKURA_DAP_DISTRO === 'debian' ? 'debian' : 'alpine';
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Features } = await import('../server/features.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const features = await Features.create(machines, ['code-checks']);
try {
  const vm = await machines.create({ name: 'dap-smoke', distro, memoryMiB: 1024, cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 300000;
  while (machines.state(vm.id) !== 'running') {
    assert.ok(Date.now() < deadline && machines.state(vm.id) === 'starting', machines.logs.get(vm.id));
    await delay(300);
  }
  const created = await machines.exec(vm.id, 'mkdir -p /workspace/app', 10000);
  assert.equal(created.code, 0, created.stderr);
  await machines.writeGuestFile(vm.id, '/workspace/app/hello.py',
    'value = 1\nvalue += 1\nprint(value)\n', false);
  await features.workspaces.save(vm.id, { directory: '/workspace/app' });
  assert.equal((await features.debugger.status(vm.id)).installed, false);
  await features.debugger.install(vm.id);
  assert.equal((await features.debugger.status(vm.id)).installed, true);
  const started = await features.debugger.start(vm.id,
    { path: '/workspace/app/hello.py', breakpoints: [2] });
  assert.equal(started.active, true);
  let status: any;
  const stopped = Date.now() + 30000;
  do {
    status = await features.debugger.status(vm.id);
    if (status.state === 'stopped') break;
    assert.ok(Date.now() < stopped, JSON.stringify(status));
    await delay(200);
  } while (true);
  assert.equal(status.frames[0]?.path, '/workspace/app/hello.py');
  assert.equal(status.frames[0]?.line, 2);
  assert.ok(status.variables.some((item: any) => item.name === 'value' && item.value === '1'), JSON.stringify(status.variables));
  await features.debugger.command(vm.id, status.token, 'next');
  const stepped = Date.now() + 30000;
  do {
    status = await features.debugger.status(vm.id);
    if (status.state === 'stopped' && status.frames[0]?.line === 3) break;
    assert.ok(Date.now() < stepped, JSON.stringify(status));
    await delay(200);
  } while (true);
  assert.ok(status.variables.some((item: any) => item.name === 'value' && item.value === '2'), JSON.stringify(status.variables));
  await features.debugger.command(vm.id, status.token, 'continue');
  const completed = Date.now() + 30000;
  do {
    status = await features.debugger.status(vm.id);
    if (status.state === 'terminated') break;
    assert.ok(Date.now() < completed, JSON.stringify(status));
    await delay(200);
  } while (true);
  assert.match(status.output, /2/);
  await features.debugger.stop(vm.id, status.token);
  console.log(`Real ${distro} debugpy DAP breakpoints, stepping, frames, variables and output passed.`);
} finally {
  await features.close();
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-dap-smoke-'));
  await rm(directory, { recursive: true, force: true });
}
