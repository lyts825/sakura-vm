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
const { Workspaces, projectVersion } = await import('../server/workspaces.ts');
const { ProjectTerminals, assertProjectTerminalsStopped } = await import('../server/project-terminals.ts');
const { vmDir } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

async function fixture() {
  const id = randomUUID(), locks = new Machines({} as Engine);
  const commands: string[] = [];
  let status = 'running', persistent = false, verified = true;
  let migration: 'applying' | 'failed' | 'directory-applied' | 'invalid' | null = null;
  const identityId = randomUUID();
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { template: 'none' }]]), live: new Map([[id, {}]]),
    get: () => ({ template: 'none', distro: 'alpine' }), state: () => status,
    locked: locks.locked.bind(locks),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.includes('project-directory-migrations'))
        return { code: 0, stderr: '', stdout: JSON.stringify(migration === 'invalid' ? {} : migration ? {
          version: 1, projectId: 'default', planId: randomUUID(), sha256: 'a'.repeat(64), phase: migration,
          identity: { version: 1, phase: 'active', registryId: randomUUID(), projectId: 'default', identityId,
            revision: 1, uid: 20000, gid: 20000, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
            home: '/var/lib/sakura-project-homes/' + identityId, homeDevice: '1', homeInode: '2',
            directory: '/workspace', directoryDevice: '1', directoryInode: '3', networkIsolation: 'host' },
        } : null) };
      if (command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS'))
        return { stdout: 'absent\n', stderr: '', code: 0 };
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
    migration: (value: typeof migration) => { migration = value; },
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
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed', networkIsolation: 'private' }), /终端或命令/);
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/private', networkIsolation: 'host' }), /终端或命令/);
    privateShell.release();
    await f.workspaces.save(f.id, { directory: '/workspace/private', networkIsolation: 'host' });
    const shell = await f.terminals.prepare(f.id, null);
    assert.doesNotMatch(shell.command, /netns/);
    assert.match(shell.command, /cd '\/workspace\/private'/);
    shell.release();
  } finally { await f.close(); }
});

for (const phase of ['applying', 'failed', 'directory-applied', 'invalid'] as const) {
  test(`${phase} directory migration prevents new terminals and shared reconnects before guest preparation`, async () => {
    const f = await fixture();
    try {
      f.migration(phase);
      for (const readOnly of [false, true]) {
        const before = f.commands.length;
        await assert.rejects(f.terminals.prepare(f.id, 'default', 'main', readOnly),
          { code: phase === 'invalid' ? 'PROJECT_DIRECTORY_LATCH_CHANGED' : 'PROJECT_DIRECTORY_MIGRATION_PENDING' });
        assert.equal(f.commands.length, before + 1, 'Only the read-only admission check may run.');
        assert.doesNotMatch(f.commands.at(-1)!, /apk add|apt-get|mkdir -p|tmux new-session/);
        assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
      }
    } finally { await f.close(); }
  });
}

test('prepared direct terminal leases block migration across terminal instances until the exact connection releases', async () => {
  const f = await fixture(), other = new ProjectTerminals(f.machines, f.workspaces);
  try {
    const first = await f.terminals.prepare(f.id, 'default');
    const second = await other.prepare(f.id, 'default');
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'),
      { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, '1111111111111111'));
    await other.close();
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'),
      { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    second.release(); first.release();
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
  } finally { await other.close(); await f.close(); }
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

test('task preparation captures one configuration and keeps its lease after caller cancellation', async () => {
  const f = await fixture(), controller = new AbortController();
  let prepared: Awaited<ReturnType<InstanceType<typeof ProjectTerminals>['prepare']>> | undefined;
  try {
    await f.workspaces.save(f.id, { directory: '/workspace/task', environment: { BUILD_VALUE: 'original' } });
    const project = await f.workspaces.config(f.id);
    prepared = await f.terminals.prepare(f.id, 'default', null, false, controller.signal, undefined, { mode: 'task' });
    assert.equal(prepared.captured?.configVersion, projectVersion(project));
    assert.deepEqual(prepared.captured?.project, project);
    assert.equal(prepared.captured?.live, f.machines.live.get(f.id));
    await f.workspaces.save(f.id, { ...project, environment: { BUILD_VALUE: 'next' } });
    assert.equal(prepared.captured?.project.environment?.BUILD_VALUE, 'original');
    controller.abort();
    assert.equal(prepared.signal?.aborted, true);
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'),
      { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed' }), /终端或命令/);
    prepared.release(); prepared.release();
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
    await f.workspaces.save(f.id, { directory: '/workspace/changed' });
  } finally { prepared?.release(); await f.close(); }
});

test('closing waits for explicit task cleanup and keeps configuration guards until that release', async () => {
  const f = await fixture();
  let prepared: Awaited<ReturnType<InstanceType<typeof ProjectTerminals>['prepare']>> | undefined;
  let closing: Promise<void> | undefined;
  try {
    const connection = await f.terminals.prepare(f.id, 'default');
    assert.equal(connection.captured, undefined);
    prepared = await f.terminals.prepare(f.id, 'default', null, false, undefined, undefined, { mode: 'task' });
    let closed = false;
    closing = f.terminals.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(prepared.signal?.aborted, true);
    assert.equal(closed, false);
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed' }), /终端或命令/);
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'),
      { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    prepared.release();
    await closing;
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
    await f.workspaces.save(f.id, { directory: '/workspace/changed' });
    connection.release();
  } finally { prepared?.release(); await closing; await f.close(); }
});

test('task preparation rejects attaching a tmux or read-only connection before guest actions', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.terminals.prepare(f.id, 'default', 'main', false, undefined, undefined, { mode: 'task' }),
      { status: 400 });
    await assert.rejects(f.terminals.prepare(f.id, 'default', null, true, undefined, undefined, { mode: 'task' }),
      { status: 400 });
    assert.deepEqual(f.commands, []);
  } finally { await f.close(); }
});

test('a replaced live instance cannot inherit a preparation lease or its captured configuration', async () => {
  const f = await fixture(), execute = f.machines.exec;
  f.machines.exec = async (...args) => {
    const result = await execute(...args);
    if (args[1].includes('mkdir -p')) f.machines.live.set(f.id, {} as never);
    return result;
  };
  try {
    await assert.rejects(f.terminals.prepare(f.id, 'default', null, false, undefined, undefined, { mode: 'task' }),
      /客户机运行身份在准备期间改变/);
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
  } finally { await f.close(); }
});
