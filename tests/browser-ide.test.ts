import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { BrowserIde } from '../server/browser-ide.ts';
import { createSchema } from '../server/model.ts';
import { freePort } from '../server/qmp.ts';
import { setTimeout as delay } from 'node:timers/promises';

test('browser IDE installs a verified archive and manages project passwords, forwards and recovery', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-browser-ide-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = randomUUID();
  const vm = { ...createSchema.parse({ name: 'ide-source', distro: 'debian' }), id,
    createdAt: new Date().toISOString(), snapshots: [] };
  let installed = false, live = false, status = 'running';
  let networkIsolation: 'host' | 'private' = 'host';
  const commands: string[] = [];
  const machines = Object.assign(new EventEmitter(), {
    live: new Map(),
    get: () => vm,
    state: () => status,
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.startsWith('test -x')) return { code: installed ? 0 : 1, stdout: '', stderr: '' };
      if (command.includes('# SAKURA_GUEST_TASK_RUN')) {
        installed = true;
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
    config: async () => ({ directory: '/workspace', template: 'node', networkIsolation }),
  } as unknown as Workspaces;
  const file = join(root, 'browser-ide.json');
  const service = new BrowserIde(machines, workspaces, file, async () => live);
  await service.init();
  t.after(() => service.close());
  const signal = new AbortController().signal;
  const started = await service.run(id, { mode: 'start', hostPort: 18080,
    ttlMinutes: 60 }, signal, () => {});
  assert.equal(started.session?.status, 'running');
  assert.ok(commands.some((command) => command.includes('a38d26f4cb81f768')));
  assert.ok(commands.some((command) => command.includes('--auth password')));
  assert.deepEqual(vm.forwards, [{ name: 'browser-ide', host: 18080, guest: 8080 }]);
  const link = await service.link(id);
  assert.equal(link.url, 'http://127.0.0.1:18080/');
  assert.match(link.password, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(started).includes(link.password), false);
  assert.equal(JSON.stringify(await service.view(id)).includes(link.password), false);
  assert.ok((await readFile(file, 'utf8')).includes(link.password));
  const restarted = new BrowserIde(machines, workspaces, file, async () => live);
  await restarted.init();
  t.after(() => restarted.close());
  assert.equal((await restarted.view(id)).session?.status, 'running');
  status = 'paused';
  await assert.rejects(restarted.run(id, { mode: 'stop' }, signal, () => {}), /恢复实例/);
  status = 'running';
  await restarted.run(id, { mode: 'stop' }, signal, () => {});
  assert.deepEqual(vm.forwards, []);
  assert.equal((await restarted.view(id)).session, null);
  vm.forwards = [{ name: 'existing', host: 18081, guest: 8080 }];
  await restarted.run(id, { mode: 'start', hostPort: 18081 }, signal, () => {});
  await restarted.run(id, { mode: 'stop' }, signal, () => {});
  assert.deepEqual(vm.forwards, [{ name: 'existing', host: 18081, guest: 8080 }]);
  networkIsolation = 'private';
  assert.equal((await restarted.view(id)).ready, true);
  await restarted.run(id, { mode: 'install' }, signal, () => {});
});

test('private browser IDE launches its process tree in the namespace and restores and expires its SSH entrance', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-private-ide-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = randomUUID();
  const vm = { ...createSchema.parse({ name: 'private-ide', distro: 'debian' }), id,
    createdAt: new Date().toISOString(), snapshots: [] };
  const commands: string[] = [];
  const reservations = new Map<string, number[]>();
  let live = false, installed = false;
  let networkIsolation: 'host' | 'private' = 'private';
  const machines = Object.assign(new EventEmitter(), {
    live: new Map(), get: () => vm, state: () => 'running', requireUnlocked() {},
    reserveHostPorts(owner: string, ports: number[]) {
      if (ports.length) reservations.set(owner, ports); else reservations.delete(owner);
    },
    async setForwards() { assert.fail('private IDE must not create QEMU forwards'); },
    async exec(_id: string, command: string) {
      commands.push(command);
      if (command.startsWith('test -x')) return { code: installed ? 0 : 1, stdout: '', stderr: '' };
      if (command.includes('# SAKURA_GUEST_TASK_RUN') && command.includes('sha256sum -c -')) installed = true;
      if (command.startsWith('tmux has-session')) return { code: live ? 0 : 1, stdout: '', stderr: '' };
      if (command.startsWith('tmux new-session')) live = true;
      if (command.includes('tmux kill-session')) live = false;
      return { code: 0, stdout: '', stderr: '' };
    },
  }) as unknown as Machines;
  const workspaces = { projects: { current: () => 'default' },
    config: async () => ({ directory: '/workspace/private ide', template: 'none', networkIsolation }),
  } as unknown as Workspaces;
  const file = join(root, 'ide.json');
  let service = new BrowserIde(machines, workspaces, file, async () => live);
  t.after(() => service.close());
  await service.init();
  const hostPort = await freePort();
  const input = { mode: 'start', hostPort, ttlMinutes: 60 };
  const signal = new AbortController().signal;
  const result = await service.run(id, input, signal, () => {});
  assert.equal(result.session?.status, 'running');
  assert.deepEqual(vm.forwards, []);
  assert.deepEqual([...reservations.values()], [[hostPort]]);
  const launch = commands.find((command) => command.startsWith('tmux new-session'))!;
  assert.match(launch, /ip netns exec sk-default/);
  assert.match(launch, /--bind-addr 127\.0\.0\.1:8080/);
  assert.equal(launch.includes('0.0.0.0'), false);
  const installation = commands.find((command) => command.includes('sha256sum -c -'))!;
  assert.ok(installation.indexOf('sha256sum -c -') < installation.indexOf('tar -xzf'));
  assert.equal(installation.includes('/workspace/private ide'), false,
    'the download and archive extraction must not load the project');
  const link = await service.link(id);
  assert.equal(JSON.stringify(await service.view(id)).includes(link.password), false);
  await service.close();
  assert.equal(live, true);
  assert.equal(reservations.size, 0);
  service = new BrowserIde(machines, workspaces, file, async () => live);
  await service.init();
  assert.deepEqual(await service.link(id), link);
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
  assert.equal(reservations.size, 0, 'a delayed status check must not resurrect a stopped IDE bridge');
  assert.equal((await service.view(id)).session, null);
  await service.run(id, input, signal, () => {});
  await service.close();
  const store = JSON.parse(await readFile(file, 'utf8'));
  store.sessions[0].expiresAt = new Date(Date.now() - 1000).toISOString();
  await writeFile(file, JSON.stringify(store));
  service = new BrowserIde(machines, workspaces, file, async () => live);
  await service.init();
  await assert.rejects(service.link(id), /过期/);
  for (let i = 0; i < 100 && (await service.view(id)).session; i++) await delay(10);
  assert.equal((await service.view(id)).session, null);
  assert.equal(live, false);
  assert.equal(reservations.size, 0);
});
