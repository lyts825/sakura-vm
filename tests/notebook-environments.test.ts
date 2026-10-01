import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { NotebookEnvironments } from '../server/notebook-environments.ts';
import { createSchema } from '../server/model.ts';
import { freePort } from '../server/qmp.ts';
import { setTimeout as delay } from 'node:timers/promises';

test('managed Jupyter and Marimo sessions install, authenticate, survive restart, and remove only owned forwards', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-notebook-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = randomUUID();
  const vm = { ...createSchema.parse({ name: 'notebook-source' }), id,
    createdAt: new Date().toISOString(), snapshots: [] };
  let live = false;
  let machineStatus = 'running';
  let networkIsolation: 'host' | 'private' = 'host';
  const installed = new Set<string>();
  const commands: string[] = [];
  const machines = Object.assign(new EventEmitter(), {
    live: new Map(),
    get: () => vm,
    state: () => machineStatus,
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.startsWith('test -x')) return { code: installed.has(command.includes('marimo')
        ? 'marimo' : 'jupyter') ? 0 : 1, stdout: '', stderr: '' };
      if (command.includes('# SAKURA_GUEST_TASK_RUN')) {
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
  }) as unknown as Machines;
  const workspaces = {
    projects: { current: () => 'default' },
    config: async () => ({ directory: '/workspace', template: 'python', networkIsolation }),
  } as unknown as Workspaces;
  const file = join(root, 'notebooks.json');
  const service = new NotebookEnvironments(machines, workspaces, file,
    async (session) => live && session.token.length === 64);
  t.after(() => service.close());
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
  t.after(() => restarted.close());
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
  networkIsolation = 'private';
  assert.equal((await restarted.view(id)).ready, true);
});

test('private notebooks install offline inside their namespace and restore only a loopback SSH entrance', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-private-notebook-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = randomUUID();
  const vm = { ...createSchema.parse({ name: 'private-notebook' }), id,
    createdAt: new Date().toISOString(), snapshots: [] };
  const projectId = '1234567890abcdef';
  const commands: string[] = [];
  const reservations = new Map<string, number[]>();
  const installed = new Set<string>();
  let live = false;
  let networkIsolation: 'host' | 'private' = 'private';
  const machines = Object.assign(new EventEmitter(), {
    live: new Map(), get: () => vm, state: () => 'running', requireUnlocked() {},
    reserveHostPorts(owner: string, ports: number[]) {
      if (ports.length) reservations.set(owner, ports); else reservations.delete(owner);
    },
    async setForwards() { assert.fail('private notebooks must not create QEMU forwards'); },
    async exec(_id: string, command: string) {
      commands.push(command);
      if (command.startsWith('test -x')) return { code: installed.has(command.includes('marimo')
        ? 'marimo' : 'jupyter') ? 0 : 1, stdout: '', stderr: '' };
      if (command.includes('# SAKURA_GUEST_TASK_RUN') && command.includes('--find-links='))
        installed.add(command.includes('jupyterlab') ? 'jupyter' : 'marimo');
      if (command.startsWith('tmux has-session')) return { code: live ? 0 : 1, stdout: '', stderr: '' };
      if (command.startsWith('tmux new-session')) live = true;
      if (command.includes('tmux kill-session')) live = false;
      return { code: 0, stdout: '', stderr: '' };
    },
  }) as unknown as Machines;
  const workspaces = {
    projects: { current: () => projectId },
    config: async () => ({ _workspace: projectId, directory: '/private notebook',
      template: 'python', networkIsolation }),
  } as unknown as Workspaces;
  const file = join(root, 'notebooks.json');
  let service = new NotebookEnvironments(machines, workspaces, file, async () => live);
  t.after(() => service.close());
  await service.init();
  const signal = new AbortController().signal;
  for (const provider of ['jupyter', 'marimo'] as const) {
    const hostPort = await freePort();
    const input = { mode: 'start', provider, guestPort: 8888, hostPort };
    const result = await service.run(id, input, signal, () => {});
    assert.equal(result.session?.status, 'running');
    assert.deepEqual([...reservations.values()], [[hostPort]]);
    assert.equal(vm.forwards.length, 0);
    const launch = commands.findLast((command) => command.startsWith('tmux new-session'))!;
    assert.match(launch, /ip netns exec sk-1234567890abcdef/);
    assert.match(launch, /127\.0\.0\.1/);
    assert.equal(launch.includes('0.0.0.0'), false);
    const install = commands.findLast((command) => command.includes('--find-links='))!;
    assert.match(install, /python3 -I -m pip --isolated download/);
    assert.match(install, /--only-binary=:all:/);
    assert.ok(install.indexOf('download') < install.indexOf('ip netns exec sk-'));
    assert.ok(install.indexOf('ip netns exec sk-') < install.indexOf('python3 -I -m venv'));
    assert.match(install, /--no-index/);
    assert.match(install, /\/var\/cache\/sakura\/notebook-wheels-[a-f0-9]{32}/);
    assert.equal(JSON.stringify(await service.view(id)).includes('token'), false);
    const original = await service.link(id);
    await service.close();
    assert.equal(reservations.size, 0);
    assert.equal(live, true, 'server shutdown must preserve the guest Notebook session');
    service = new NotebookEnvironments(machines, workspaces, file, async () => live);
    await service.init();
    assert.equal((await service.view(id)).session?.status, 'running');
    assert.equal((await service.link(id)).url, original.url);
    networkIsolation = 'host';
    await assert.rejects(service.link(id), /网络或目录已变更/);
    await assert.rejects(service.run(id, input, signal, () => {}), /先停止/);
    networkIsolation = 'private';
    const originalExec = machines.exec.bind(machines);
    let release!: () => void;
    let captured = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    machines.exec = async (...args: Parameters<Machines['exec']>) => {
      if (args[1].startsWith('tmux has-session')) {
        captured = true;
        await gate;
        return { code: 0, stdout: '', stderr: '' };
      }
      return originalExec(...args);
    };
    const staleView = service.view(id);
    for (let i = 0; i < 100 && !captured; i++) await delay(10);
    assert.equal(captured, true);
    await service.run(id, { mode: 'stop' }, signal, () => {});
    release();
    await staleView;
    machines.exec = originalExec;
    assert.equal(reservations.size, 0);
    assert.equal(live, false);
    assert.equal((await service.view(id)).session, null,
      'a stale status result must not reopen a stopped session');
  }
});
