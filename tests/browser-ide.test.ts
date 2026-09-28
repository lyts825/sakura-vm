import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { BrowserIde } from '../server/browser-ide.ts';
import { createSchema } from '../server/model.ts';

test('browser IDE installs a verified archive and manages project passwords, forwards and recovery', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-browser-ide-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = randomUUID();
  const vm = { ...createSchema.parse({ name: 'ide-source', distro: 'debian' }), id,
    createdAt: new Date().toISOString(), snapshots: [] };
  let installed = false, live = false, status = 'running';
  let networkIsolation: 'host' | 'private' = 'host';
  const commands: string[] = [];
  const machines = {
    live: new Map(),
    get: () => vm,
    state: () => status,
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.startsWith('test -x')) return { code: installed ? 0 : 1, stdout: '', stderr: '' };
      if (command.startsWith('setsid ')) {
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
  } as unknown as Machines;
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
  assert.equal((await restarted.view(id)).ready, false);
  await assert.rejects(restarted.run(id, { mode: 'start' }, signal, () => {}), /私有项目网络/);
});
