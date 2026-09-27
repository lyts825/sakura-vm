import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { NotebookEnvironments } from '../server/notebook-environments.ts';
import { createSchema } from '../server/model.ts';

test('managed Jupyter and Marimo sessions install, authenticate, survive restart, and remove only owned forwards', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-notebook-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = randomUUID();
  const vm = { ...createSchema.parse({ name: 'notebook-source' }), id,
    createdAt: new Date().toISOString(), snapshots: [] };
  let live = false;
  let machineStatus = 'running';
  const installed = new Set<string>();
  const commands: string[] = [];
  const machines = {
    live: new Map(),
    get: () => vm,
    state: () => machineStatus,
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.startsWith('test -x')) return { code: installed.has(command.includes('marimo')
        ? 'marimo' : 'jupyter') ? 0 : 1, stdout: '', stderr: '' };
      if (command.startsWith('setsid ')) {
        installed.add(command.includes('pip install --disable-pip-version-check --no-input marimo')
          ? 'marimo' : 'jupyter');
        return { code: 0, stdout: '', stderr: '' };
      }
      if (command.startsWith('tmux has-session'))
        return { code: live ? 0 : 1, stdout: '', stderr: '' };
      if (command.startsWith('tmux new-session')) {
        live = true;
        return { code: 0, stdout: '', stderr: '' };
      }
      if (command.includes('tmux kill-session')) {
        live = false;
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
    setForwards: async (_id: string, next: typeof vm.forwards, expected: typeof vm.forwards) => {
      assert.deepEqual(expected, vm.forwards);
      vm.forwards = next;
    },
  } as unknown as Machines;
  const workspaces = {
    projects: { current: () => 'default' },
    config: async () => ({ directory: '/workspace', template: 'python' }),
  } as unknown as Workspaces;
  const file = join(root, 'notebooks.json');
  const service = new NotebookEnvironments(machines, workspaces, file,
    async (session) => live && session.token.length === 64);
  await service.init();
  const signal = new AbortController().signal;
  const jupyter = await service.run(id, { mode: 'start', provider: 'jupyter',
    guestPort: 8888, hostPort: 18888 }, signal, () => {});
  assert.equal(jupyter.session?.status, 'running');
  assert.deepEqual(vm.forwards, [{ name: 'notebook-jupyter', host: 18888, guest: 8888 }]);
  assert.ok(commands.some((command) => command.includes('pip install --disable-pip-version-check --no-input jupyterlab')));
  assert.ok(commands.some((command) => command.includes('JUPYTER_TOKEN=')));
  const jupyterLink = await service.link(id);
  assert.match(jupyterLink.url, /^http:\/\/127\.0\.0\.1:18888\/lab\?token=[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(await service.view(id)).includes('token'), false);
  assert.equal((await readFile(file, 'utf8')).includes(jupyterLink.url.split('token=')[1]), true);
  const restarted = new NotebookEnvironments(machines, workspaces, file,
    async () => live);
  await restarted.init();
  assert.equal((await restarted.view(id)).session?.status, 'running');
  await restarted.run(id, { mode: 'stop' }, signal, () => {});
  assert.deepEqual(vm.forwards, []);
  assert.equal((await restarted.view(id)).session, null);

  vm.forwards = [{ name: 'existing', host: 12718, guest: 2718 }];
  const marimo = await restarted.run(id, { mode: 'start', provider: 'marimo',
    guestPort: 2718, hostPort: 12718 }, signal, () => {});
  assert.equal(marimo.session?.status, 'running');
  assert.ok(commands.some((command) => command.includes('pip install --disable-pip-version-check --no-input marimo')));
  assert.ok(commands.some((command) => command.includes('--token-password')));
  assert.match((await restarted.link(id)).url,
    /^http:\/\/127\.0\.0\.1:12718\/\?access_token=[a-f0-9]{64}$/);
  machineStatus = 'paused';
  await assert.rejects(restarted.run(id, { mode: 'stop' }, signal, () => {}), /恢复实例/);
  assert.deepEqual(vm.forwards, [{ name: 'existing', host: 12718, guest: 2718 }]);
  machineStatus = 'running';
  await restarted.run(id, { mode: 'stop' }, signal, () => {});
  assert.deepEqual(vm.forwards, [{ name: 'existing', host: 12718, guest: 2718 }]);
});
