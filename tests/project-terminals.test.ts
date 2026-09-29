import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Machines as MachineType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-terminals-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { ProjectTerminals } = await import('../server/project-terminals.ts');
const { vmDir } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

async function fixture() {
  const id = randomUUID(), locks = new Machines({} as Engine);
  const commands: string[] = [];
  let status = 'running', persistent = false, verified = true;
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { template: 'none' }]]), live: new Map(),
    get: () => ({ template: 'none', distro: 'alpine' }), state: () => status,
    locked: locks.locked.bind(locks),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.includes('sakura_panes=') && !verified)
        return { stdout: '', stderr: '终端窗格未处于项目网络空间', code: 1 };
      return { stdout: persistent && command.includes('echo active') ? 'active' : command.includes('sakura_panes=') ?
        'SAKURA_TERMINAL_ID=00000000-0000-4000-8000-000000000003\n' : '', stderr: '', code: 0 };
    },
  }) as unknown as MachineType;
  await mkdir(vmDir(id), { recursive: true });
  const workspaces = new Workspaces(machines);
  const terminals = new ProjectTerminals(machines, workspaces);
  return { id, machines, commands, workspaces, terminals,
    status: (value: string) => { status = value; },
    persistent: (value: boolean) => { persistent = value; },
    verified: (value: boolean) => { verified = value; },
    close: async () => { await terminals.close(); await workspaces.close(); } };
}

test('terminal leases bind to the selected project and block directory or network edits until disconnected', async () => {
  const f = await fixture();
  try {
    await f.workspaces.save(f.id, { directory: '/workspace/private', networkIsolation: 'private' });
    const privateShell = await f.terminals.prepare(f.id, 'default');
    assert.match(privateShell.command, /exec ip netns exec sk-default sh -l/);
    assert.equal(privateShell.projectId, 'default');
    assert.equal(privateShell.networkIsolation, 'private');
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed', networkIsolation: 'private' }), /断开/);
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/private', networkIsolation: 'host' }), /断开/);
    privateShell.release();
    await f.workspaces.save(f.id, { directory: '/workspace/private', networkIsolation: 'host' });
    const shell = await f.terminals.prepare(f.id, null);
    assert.doesNotMatch(shell.command, /netns/);
    assert.match(shell.command, /cd '\/workspace\/private'/);
    shell.release();
  } finally { await f.close(); }
});

test('disconnected tmux sessions and paused guests still guard project binding changes', async () => {
  const f = await fixture();
  try {
    f.persistent(true);
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed' }), /所有终端/);
    assert.equal((await f.workspaces.config(f.id)).directory, '/workspace');
    f.persistent(false);
    f.status('paused');
    await assert.rejects(f.workspaces.save(f.id, { networkIsolation: 'private' }), /恢复实例/);
    f.status('running');
    await f.workspaces.save(f.id, { networkIsolation: 'private' });
    f.verified(false);
    await assert.rejects(f.terminals.prepare(f.id, 'default', 'main'), /网络空间/);
    await assert.rejects(f.terminals.validate(f.id, 'default', 'main'), /网络空间/);
    await assert.rejects(f.terminals.prepare(f.id, undefined, 'main', true), /重新共享/);
  } finally { await f.close(); }
});

test('terminal fallback reads the persisted active project even when the projects plugin is disabled', async () => {
  const f = await fixture();
  try {
    const index = await f.workspaces.projects.create(f.id, 'Private',
      async () => { await f.workspaces.save(f.id, { directory: '/workspace/other', networkIsolation: 'private' }); });
    const fallback = new ProjectTerminals(f.machines);
    try {
      const controller = new AbortController();
      const shell = await fallback.prepare(f.id, null, undefined, false, controller.signal);
      assert.equal(shell.projectId, index.active);
      assert.match(shell.command, new RegExp(`ip netns exec sk-${index.active}`));
      controller.abort();
      shell.release();
      await assert.rejects(fallback.prepare(f.id, null, undefined, false, controller.signal));
      await assert.rejects(fallback.prepare(f.id, '1111111111111111'), /项目不存在/);
    } finally { await fallback.close(); }
  } finally { await f.close(); }
});
