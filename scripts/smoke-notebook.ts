import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-notebook-smoke-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { NotebookEnvironments } = await import('../server/notebook-environments.ts');
const { freePort } = await import('../server/qmp.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);
const notebooks = new NotebookEnvironments(machines, workspaces);
await notebooks.init();
try {
  const vm = await machines.create({ name: 'notebook-smoke', memoryMiB: 2048,
    cpus: 2, diskGiB: 8, accelerator: 'auto' });
  await machines.start(vm.id);
  const deadline = Date.now() + 270_000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id));
    await delay(200);
  }
  for (const [provider, guestPort] of [['marimo', 2718], ['jupyter', 8888]] as const) {
    const hostPort = await freePort();
    const input = { mode: 'start', provider, guestPort, hostPort } as const;
    const result = await notebooks.run(vm.id, input, new AbortController().signal,
      (line) => process.stdout.write(line));
    assert.equal(result.session?.status, 'running');
    const link = await notebooks.link(vm.id);
    assert.equal(link.provider, provider);
    assert.match(link.url, new RegExp(`^http://127\\.0\\.0\\.1:${hostPort}/`));
    const response = await fetch(link.url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    await response.body?.cancel();
    assert.ok(response.status >= 200 && response.status < 400,
      `${provider} returned HTTP ${response.status}`);
    if (provider === 'marimo') {
      assert.ok(!response.headers.get('location')?.includes('/auth/login'),
        'tokenized Marimo link unexpectedly redirected to login');
      const anonymous = await fetch(`http://127.0.0.1:${hostPort}/`,
        { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      await anonymous.body?.cancel();
      assert.match(anonymous.headers.get('location') || '', /\/auth\/login/);
    } else {
      const anonymous = await fetch(`http://127.0.0.1:${hostPort}/api/status`,
        { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      await anonymous.body?.cancel();
      assert.ok(anonymous.status === 401 || anonymous.status === 403,
        `unauthenticated Jupyter status returned HTTP ${anonymous.status}`);
    }
    console.log(`Real QEMU ${provider} installed, authenticated and reached through port ${hostPort}.`);
    await notebooks.run(vm.id, { mode: 'stop' }, new AbortController().signal, () => {});
    assert.equal(machines.get(vm.id).forwards.length, 0);
  }
} finally {
  await workspaces.close();
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
