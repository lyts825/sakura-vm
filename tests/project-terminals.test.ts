import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, realpath, access } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { quote } from '../server/files.ts';
import { tmpdir } from 'node:os';
import type { Machines as MachineType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-terminals-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Workspaces, projectVersion } = await import('../server/workspaces.ts');
const { ProjectTerminals, assertProjectTerminalsStopped } = await import('../server/project-terminals.ts');
const { ProjectRunScopes } = await import('../server/project-run-scope.ts');
const { projectIdentitySchema, projectIdentityRunSchema } = await import('../server/project-identity.ts');
const { AppError } = await import('../server/model.ts');
const { vmDir } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

async function fixture() {
  const id = randomUUID(), locks = new Machines({} as Engine);
  const commands: string[] = [];
  let status = 'running', persistent = false, verified = true;
  let migration: 'applying' | 'failed' | 'directory-applied' | 'invalid' | null = null;
  const identityId = randomUUID();
  const bootId = randomUUID(), registryId = randomUUID();
  const identities = new Map<string, ReturnType<typeof projectIdentitySchema.parse>>();
  const runs = new Map<string, ReturnType<typeof projectIdentityRunSchema.parse>>();
  const controlCalls: string[] = [];
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { template: 'none' }]]), live: new Map([[id, {}]]),
    get: () => ({ template: 'none', distro: 'alpine' }), state: () => status,
    writeGuestFile: async () => {},
    locked: locks.locked.bind(locks),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      const encoded = command.match(/\/controller\.py' '([A-Za-z0-9+/=]+)'$/)?.[1];
      if (encoded) {
        const request = JSON.parse(Buffer.from(encoded, 'base64').toString());
        assert.ok(['install', 'begin-network-release'].includes(request.action));
        return { code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result: request.action === 'install' ? {
          version: 1, build: command.match(/sakura-project-identity\/([a-f0-9]{64})/)![1], registryId, bootId,
        } : null }) };
      }
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
      if (command.endsWith('/proc/sys/kernel/random/boot_id')) return { stdout: bootId, stderr: '', code: 0 };
      if (command.includes('absent'))
        return { stdout: JSON.stringify({ bootId, absent: true }), stderr: '', code: 0 };
      if (command.includes('sakura_panes=') && !verified)
        return { stdout: '', stderr: '终端窗格未处于项目网络空间', code: 1 };
      return { stdout: persistent && command.includes('echo active') ? 'active' : command.includes('sakura_panes=') ?
        'SAKURA_TERMINAL_ID=00000000-0000-4000-8000-000000000003\n' : '', stderr: '', code: 0 };
    },
  }) as unknown as MachineType;
  await mkdir(vmDir(id), { recursive: true });
  const workspaces = new Workspaces(machines);
  const core = {
    ensure: async (_vm: string, binding: { projectId: string; directory: string; networkIsolation: 'host' | 'private' }) => {
      let identity = identities.get(binding.projectId);
      if (!identity) identity = projectIdentitySchema.parse({ version: 1, phase: 'active', registryId,
        identityId, revision: 1, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
        uid: 20000, gid: 20000, home: '/var/lib/sakura-project-homes/' + identityId,
        homeDevice: '1', homeInode: '2', directoryDevice: '1', directoryInode: '3', ...binding });
      identities.set(binding.projectId, identity); return identity;
    },
    inspect: async (_vm: string, projectId: string) => identities.get(projectId) || null,
    rebind: async (_vm: string, identity: ReturnType<typeof projectIdentitySchema.parse>, binding: { directory: string; networkIsolation: 'host' | 'private' }) => {
      const changed = { ...identity, ...binding, revision: identity.revision + 1 };
      identities.set(identity.projectId, changed); return changed;
    },
    inheritedInput: async () => { throw new Error('unexpected task payload'); },
    prepare: async (_vm: string, identity: ReturnType<typeof projectIdentitySchema.parse>, options: { runId?: string }) => {
      controlCalls.push('prepare');
      const runId = options.runId!;
      const run = projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'independent',
        registryId, identityId, projectId: identity.projectId, revision: identity.revision, runId, bootId,
        build: 'a'.repeat(64), networkDevice: '1', networkInode: '4', cgroupDevice: '1', cgroupInode: '5',
        cgroupName: 'sakura-identity-' + runId, namespace: identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : '' });
      runs.set(runId, run); return run;
    },
    run: async (_vm: string, _identity: unknown, runId: string) => runs.get(runId)!,
    runReadonly: async (_vm: string, _identity: unknown, runId: string) => runs.get(runId)!,
    stop: async (_vm: string, _identity: unknown, run: ReturnType<typeof projectIdentityRunSchema.parse>) => {
      controlCalls.push('stop'); const closed = { ...run, phase: 'closed' as const }; runs.set(run.runId, closed); return closed;
    },
    retireTerminal: async () => { controlCalls.push('retire'); },
  };
  const options = { scopes: new ProjectRunScopes(machines, { identities: core }), identities: {
    terminal: async (_vm: string, _identity: unknown, run: ReturnType<typeof projectIdentityRunSchema.parse>, name: string,
      options: { create?: boolean } = {}) => {
      controlCalls.push(options.create ? 'create' : 'probe');
      if (!verified) throw new AppError('终端窗格未处于项目网络空间', 409);
      return { version: 1 as const, terminalId: run.runId, run, name, serverPid: 123, serverTicks: '4', sessionId: '$0' };
    },
    terminalCommand: async (_identity: unknown, run: ReturnType<typeof projectIdentityRunSchema.parse>, name: string, readOnly: boolean) =>
      `/fixed/project-terminal --run ${run.runId} --name ${name} --readonly ${readOnly}`,
  } };
  const terminals = new ProjectTerminals(machines, workspaces, undefined, options);
  return { id, machines, commands, workspaces, terminals, options, identities, runs, controlCalls,
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
    assert.match(privateShell.command, /project-terminal --run/);
    assert.equal([...f.runs.values()][0].namespace, 'sk-default');
    assert.equal(f.identities.get('default')?.uid, 20000);
    assert.equal(privateShell.projectId, 'default');
    assert.equal(privateShell.networkIsolation, 'private');
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed', networkIsolation: 'private' }), /终端或命令/);
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/private', networkIsolation: 'host' }), /终端或命令/);
    await privateShell.release();
    await f.workspaces.save(f.id, { directory: '/workspace/private', networkIsolation: 'host' });
    const shell = await f.terminals.prepare(f.id, null);
    assert.doesNotMatch(shell.command, /netns/);
    assert.match(shell.command, /project-terminal --run/);
    assert.equal([...f.runs.values()].at(-1)?.namespace, '');
    await shell.release();
  } finally { await f.close(); }
});

test('task preparation refuses a missing original directory without creating it or issuing a lease', async () => {
  const f = await fixture(), execute = f.machines.exec.bind(f.machines);
  f.machines.exec = async (...args) => {
    const result = await execute(...args);
    return args[1].includes('SAKURA_TASK_DIRECTORY_MISSING:') ? { code: 74, stdout: '',
      stderr: 'SAKURA_TASK_DIRECTORY_MISSING: 项目目录不存在或是链接，请先显式准备并迁移原目录' } : result;
  };
  try {
    await assert.rejects(f.terminals.prepare(f.id, 'default', null, false, undefined, undefined, { mode: 'task' }),
      { code: 'PROJECT_IDENTITY_DIRECTORY_MISSING' });
    const task = f.commands.at(-1)!;
    assert.ok(task.includes("[ ! -d '/workspace' ]") && task.includes("[ -L '/workspace' ]"));
    assert.doesNotMatch(task, /mkdir -p '\/workspace'/);
    // Execute the exact fixed directory-check fragment against an owned host
    // path. Keep network/package preparation outside this POSIX-shell check.
    const parent = await mkdtemp(join(root, 'directory-check-')), missing = join(parent, 'missing');
    const git = spawnSync('git', ['--exec-path'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(git.status, 0, git.stderr || git.error?.message);
    const shell = process.platform === 'win32' ? resolve(git.stdout.trim(), '../../../usr/bin/sh.exe') : '/bin/sh';
    const unix = process.platform === 'win32' ? missing.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_all, drive) => '/' + drive.toLowerCase()) : missing;
    const check = task.slice(task.lastIndexOf('if [ ! -d ')).replaceAll("'/workspace'", quote(unix));
    const refused = spawnSync(shell, ['-c', check], { encoding: 'utf8', timeout: 5000 });
    assert.equal(refused.status, 74, refused.stderr || refused.error?.message);
    assert.match(refused.stderr, /SAKURA_TASK_DIRECTORY_MISSING:/); await assert.rejects(access(missing), { code: 'ENOENT' });
    await mkdir(missing);
    const existing = spawnSync(shell, ['-c', check], { encoding: 'utf8', timeout: 5000 });
    assert.equal(existing.status, 0, existing.stderr || existing.error?.message); await access(missing);
    const canonical = await realpath(parent);
    assert.equal(dirname(canonical), await realpath(root)); assert.ok(basename(canonical).startsWith('directory-check-'));
    await rm(canonical, { recursive: true, force: true });
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
    const normal = await f.terminals.prepare(f.id, 'default'); await normal.release();
    assert.ok(f.commands.some(command => /mkdir -p '\/workspace'/.test(command)));
    assert.match(normal.command, /project-terminal --run/);
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
  const f = await fixture(), other = new ProjectTerminals(f.machines, f.workspaces, undefined, f.options);
  try {
    const first = await f.terminals.prepare(f.id, 'default');
    const second = await other.prepare(f.id, 'default');
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'),
      { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, '1111111111111111'));
    await other.close();
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'),
      { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    await second.release(); await first.release();
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
    const running = await f.terminals.prepare(f.id, 'default', 'main'); await running.release();
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
    const fallback = new ProjectTerminals(f.machines, undefined, undefined, f.options);
    try {
      const controller = new AbortController();
      const shell = await fallback.prepare(f.id, null, undefined, false, controller.signal);
      assert.equal(shell.projectId, index.active);
      assert.match(shell.command, /project-terminal --run/);
      assert.equal([...f.runs.values()].at(-1)?.namespace, `sk-${index.active}`);
      controller.abort();
      await shell.release();
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

test('verification-only task binding holds a lease without network repair, packages or native issuance', async () => {
  const f = await fixture();
  let prepared: Awaited<ReturnType<InstanceType<typeof ProjectTerminals>['prepare']>> | undefined;
  try {
    await f.workspaces.save(f.id, { directory: '/workspace/readonly', networkIsolation: 'private' });
    f.commands.length = 0; f.controlCalls.length = 0;
    prepared = await f.terminals.prepare(f.id, 'default', null, false, undefined, undefined,
      { mode: 'task', verifyOnly: true });
    const check = f.commands.find(command => command.includes('SAKURA_TASK_DIRECTORY_MISSING:'))!;
    assert.ok(check.includes('SAKURA_TASK_NETWORK_MISSING:'));
    assert.doesNotMatch(check, /apk add|apt-get|mkdir|netns add|useradd|adduser|tmux/);
    assert.deepEqual(f.controlCalls, []);
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'),
      { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed', networkIsolation: 'private' }), /终端或命令/);
    await prepared.release();
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
  } finally { await prepared?.release(); await f.close(); }
});

test('verification-only task binding refuses a missing namespace without issuing a lease', async () => {
  const f = await fixture(), execute = f.machines.exec;
  try {
    await f.workspaces.save(f.id, { directory: '/workspace/readonly', networkIsolation: 'private' });
    f.machines.exec = async (...args) => args[1].includes('SAKURA_TASK_NETWORK_MISSING:') ?
      { code: 74, stdout: '', stderr: 'SAKURA_TASK_NETWORK_MISSING: missing original namespace' } : execute(...args);
    await assert.rejects(f.terminals.prepare(f.id, 'default', null, false, undefined, undefined,
      { mode: 'task', verifyOnly: true }), { status: 409 });
    assert.deepEqual(f.controlCalls, []);
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
  } finally { await f.close(); }
});

test('task preparation rejects attaching a tmux or read-only connection before guest actions', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.terminals.prepare(f.id, 'default', 'main', false, undefined, undefined, { mode: 'task' }),
      { status: 400 });
    await assert.rejects(f.terminals.prepare(f.id, 'default', null, true, undefined, undefined, { mode: 'task' }),
      { status: 400 });
    await assert.rejects(f.terminals.prepare(f.id, 'default', null, false, undefined, undefined, { verifyOnly: true }),
      { status: 400 });
    assert.deepEqual(f.commands, []);
  } finally { await f.close(); }
});

test('a replaced live instance cannot inherit a preparation lease or its captured configuration', async () => {
  const f = await fixture(), execute = f.machines.exec;
  f.machines.exec = async (...args) => {
    const result = await execute(...args);
    if (args[1].includes('SAKURA_TASK_DIRECTORY_MISSING:')) f.machines.live.set(f.id, {} as never);
    return result;
  };
  try {
    await assert.rejects(f.terminals.prepare(f.id, 'default', null, false, undefined, undefined, { mode: 'task' }),
      /客户机运行身份在准备期间改变/);
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
  } finally { await f.close(); }
});

test('named terminals survive disconnect and reload while readonly reconnection does not prepare guest tools', async () => {
  const f = await fixture(), reopened = new ProjectTerminals(f.machines, f.workspaces, undefined, f.options);
  try {
    const first = await f.terminals.prepare(f.id, 'default', 'main'); await first.release();
    const before = f.commands.length, creates = f.controlCalls.filter(call => call === 'create').length;
    const view = await reopened.prepare(f.id, 'default', 'main', true, undefined, first.terminalId);
    assert.equal(view.terminalId, first.terminalId);
    assert.match(view.command, /--readonly true/);
    assert.equal(f.commands.length, before + 1, 'Only the migration admission read runs outside the readonly controller.');
    assert.equal(f.controlCalls.filter(call => call === 'create').length, creates);
    await view.release();
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/replaced' }),
      { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
    await reopened.stop(f.id, 'default', 'main');
    assert.deepEqual(f.controlCalls.slice(-2), ['stop', 'retire']);
    await f.workspaces.save(f.id, { directory: '/workspace/replaced' });
  } finally { await reopened.close(); await f.close(); }
});

test('recreating the same terminal label cannot revive an old shared terminal ID', async () => {
  const f = await fixture();
  try {
    const first = await f.terminals.prepare(f.id, 'default', 'main'); await first.release();
    await f.terminals.stop(f.id, 'default', 'main');
    const next = await f.terminals.prepare(f.id, 'default', 'main'); await next.release();
    assert.notEqual(first.terminalId, next.terminalId);
    const calls = f.controlCalls.length;
    await assert.rejects(f.terminals.prepare(f.id, 'default', 'main', true, undefined, first.terminalId),
      { code: 'PROJECT_TERMINAL_SHARE_STALE' });
    assert.equal(f.controlCalls.length, calls, 'A stale viewer never probes, recreates or attaches another terminal.');
    const grant = await f.terminals.validate(f.id, 'default', 'main'); assert.equal(grant.terminalId, next.terminalId);
    await f.terminals.stop(f.id, 'default');
  } finally { await f.close(); }
});

test('a failed anonymous terminal cleanup retains the lease and retries its original run', async () => {
  const f = await fixture(), stop = f.options.scopes.stopTerminal.bind(f.options.scopes);
  let failing = true;
  f.options.scopes.stopTerminal = async (...args) => {
    if (failing) throw new AppError('owned cleanup lost', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    return stop(...args);
  };
  try {
    const connection = await f.terminals.prepare(f.id, 'default');
    await assert.rejects(Promise.resolve(connection.release()), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    assert.equal((await f.options.scopes.terminalRuns(f.id, 'default'))[0].runId, connection.terminalId);
    await assert.rejects(f.terminals.close(), /清理未确认/);
    failing = false; await connection.release();
    assert.equal((await f.options.scopes.terminalRuns(f.id, 'default')).length, 0);
    assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, 'default'));
  } finally { failing = false; await f.close(); }
});

test('recovery stops only unconnected anonymous runs and preserves a live connection and named server', async () => {
  const f = await fixture();
  try {
    const first = await f.terminals.prepare(f.id, 'default');
    const named = await f.terminals.prepare(f.id, 'default', 'main'); await named.release();
    const project = await f.workspaces.config(f.id), orphanId = randomUUID();
    await f.options.scopes.prepareTerminal(f.id, project, orphanId,
      { name: 'sakura-terminal-default-orphan', persistent: false });
    const next = await f.terminals.prepare(f.id, 'default');
    const active = await f.options.scopes.terminalRuns(f.id, 'default');
    assert.ok(!active.some(entry => entry.runId === orphanId));
    assert.ok(active.some(entry => entry.runId === first.terminalId));
    assert.ok(active.some(entry => entry.runId === named.terminalId));
    await first.release(); await next.release(); await f.terminals.stop(f.id, 'default');
  } finally { await f.close(); }
});
