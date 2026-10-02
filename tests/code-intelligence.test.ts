import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { CodeIntelligence, type CodeIntelligenceOptions } from '../server/code-intelligence.ts';
import type { Machines } from '../server/machines.ts';
import { projectSchema, projectVersion, type Project, type Workspaces } from '../server/workspaces.ts';
import { AppError } from '../server/model.ts';
import { ProjectIdentities, projectIdentityPayload, type ProjectIdentity, type ProjectIdentityRun } from '../server/project-identity.ts';
import { ProjectTerminals } from '../server/project-terminals.ts';

const id = '11111111-1111-4111-8111-111111111111', projectId = '0123456789abcdef';
type Output = { code: number; stdout: string; stderr: string };
function copyProject(value: Project, scope = value._workspace) {
  return Object.defineProperty(structuredClone(value), '_workspace', { value: scope, enumerable: false });
}
function fixture(networkIsolation: 'host' | 'private' = 'private') {
  const context = new AsyncLocalStorage<string>();
  let forcedScope: string | undefined, outsideScope = projectId;
  let status = 'running', leaseOpen = false, releases = 0, closes = 0, created = 0;
  const live = {}, abort = new AbortController();
  const config = copyProject(projectSchema.parse({ directory: '/workspace/app', networkIsolation,
    environment: { MODE: 'original' }, secrets: { TOKEN: 'diagnostics-secret' } }), projectId);
  const launches: Parameters<NonNullable<CodeIntelligenceOptions['runProjectTask']>>[] = [];
  const events: string[] = [], rootCommands: string[] = [];
  const machines = {
    live: new Map([[id, live]]), state: () => status, get: () => ({ distro: 'debian' }),
    locked: async (_id: string, action: () => unknown) => action(),
    exec: async (_id: string, command: string) => {
      rootCommands.push(command); throw new Error('Unexpected direct root command');
    },
    execInput: async () => { throw new Error('Unexpected direct root input execution'); },
    writeGuestFile: async () => { throw new Error('Unexpected root file publication'); },
  } as unknown as Machines;
  const workspaces = {
    projects: {
      current: () => forcedScope || context.getStore() || outsideScope,
      inScope: (_id: string, scope: string, action: () => unknown) => context.run(scope, action),
      with: async (_id: string, scope: string, action: () => unknown) => context.run(scope, action),
    },
    config: async () => copyProject(config),
    resolvedConfig: async () => { throw new Error('Selected config reread is forbidden'); },
    resolveProject: async (_id: string, captured: Project) => {
      assert.equal(captured._workspace, projectId);
      assert.equal(projectVersion(captured), projectVersion(config));
      return { ...captured, _workspace: captured._workspace,
        environment: { ...captured.environment, TOKEN: 'private-diagnostic-token' } };
    },
  } as unknown as Workspaces;
  const manager: Pick<ProjectTerminals, 'prepare' | 'close'> = {
    prepare: async (_id, scope, session, readOnly, signal, _terminalId, mode) => {
      assert.equal(scope, projectId); assert.equal(session, null); assert.equal(readOnly, false);
      assert.deepEqual(mode, { mode: 'task' }); signal?.throwIfAborted(); leaseOpen = true;
      events.push('prepare');
      return { command: 'unused terminal command', projectId, networkIsolation, terminalId: undefined,
        signal: signal!, captured: { project: copyProject(config), configVersion: projectVersion(config), live: live as any },
        release: () => { leaseOpen = false; ++releases; events.push('release'); } };
    },
    close: async () => { ++closes; events.push('close'); assert.equal(leaseOpen, false); },
  };
  const options: CodeIntelligenceOptions = {
    createPreparation: () => { ++created; return manager; },
    runProjectTask: async (...args) => {
      const [transport, vmId, project, execution, signal, log, timeout, agentPath, afterCleanup, pins] = args;
      assert.equal(transport, machines); assert.equal(vmId, id); assert.equal(project._workspace, projectId);
      assert.ok(leaseOpen); assert.equal(projectVersion(project), projectVersion(config));
      assert.equal(signal.aborted, false); assert.equal(timeout, 30000); assert.equal(pins?.expectedLive, live);
      assert.equal(log, undefined); assert.equal(agentPath, undefined); assert.equal(afterCleanup, undefined);
      projectIdentityPayload(execution); launches.push(args); events.push('uid-start');
      events.push('full-domain-stopped'); events.push('native-ticket-closed');
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  const checks = new CodeIntelligence(machines, workspaces, options);
  const run = (path = 'src/a.js', signal = abort.signal) => checks.diagnose(id, path, signal);
  return { run, options, checks, manager, machines, workspaces, config, live, abort, launches, events, rootCommands,
    leaseOpen: () => leaseOpen, releases: () => releases, closes: () => closes, created: () => created,
    setStatus: (value: string) => { status = value; },
    switchOutside: () => { outsideScope = 'fedcba9876543210'; },
    forceScope: () => { forcedScope = 'fedcba9876543210'; } };
}
function returning(f: ReturnType<typeof fixture>, output: Output) {
  const launch = f.options.runProjectTask!;
  f.options.runProjectTask = async (...args) => { await launch(...args); return output; };
}

test('editor and CLI paths execute the same finite UID check and reject paths outside the original project', async () => {
  const f = fixture();
  for (const input of ['/workspace/app/src/a.js', 'src/a.js']) {
    const result = await f.run(input);
    assert.deepEqual(result, { path: 'src/a.js', diagnostics: [], supported: true });
  }
  assert.equal(f.launches.length, 2);
  for (const [, , project, execution] of f.launches) {
    assert.equal(project._workspace, projectId);
    assert.equal(execution.command, "node --check '/workspace/app/src/a.js'");
  }
  for (const path of ['/workspace/app-other/a.js', '/etc/a.js', '../a.js', '/workspace/app/../a.js', '/workspace/app'])
    await assert.rejects(f.run(path));
  assert.equal(f.launches.length, 2); assert.equal(f.created(), 2); assert.deepEqual(f.rootCommands, []);
});

test('all existing checker commands, including the TypeScript fallback, stay inside the UID body', async () => {
  const f = fixture();
  for (const ext of ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'json']) await f.run(`src/a.${ext}`);
  assert.equal(f.launches.length, 8);
  const commands = f.launches.map((args) => args[3].command);
  for (const value of commands.slice(0, 4)) assert.match(value, /^node --check /);
  for (const value of commands.slice(4, 6))
    assert.match(value, /^if command -v tsc >\/dev\/null; then tsc --noEmit --pretty false .*; else node --check .*; fi$/);
  assert.equal(commands[6], "python3 -m py_compile '/workspace/app/src/a.py'");
  assert.equal(commands[7], "python3 -m json.tool '/workspace/app/src/a.json' >/dev/null");
  assert.equal(f.releases(), 8); assert.equal(f.closes(), 8); assert.deepEqual(f.rootCommands, []);
});

test('unsupported extensions and canceled requests never prepare a task or select a root fallback', async () => {
  const f = fixture(); f.setStatus('stopped'); f.machines.live.delete(id);
  assert.deepEqual(await f.run('src/a.rs'), { path: 'src/a.rs', diagnostics: [], supported: false });
  f.abort.abort();
  await assert.rejects(f.run('src/a.js'), (error: any) => error.name === 'AbortError');
  await assert.rejects(f.run('src/a.unknown'), (error: any) => error.name === 'AbortError');
  assert.equal(f.created(), 0); assert.equal(f.launches.length, 0); assert.deepEqual(f.rootCommands, []);
});

test('non-enumerable named project identity survives captured config and a concurrent selection change', async () => {
  const f = fixture(), read = f.workspaces.config;
  f.workspaces.config = async (...args) => { await Promise.resolve(); f.switchOutside(); return read(...args); };
  await f.run();
  const project = f.launches[0][2];
  assert.equal(project._workspace, projectId);
  assert.equal(Object.getOwnPropertyDescriptor(project, '_workspace')?.enumerable, false);
  assert.equal(projectVersion(project), projectVersion(f.config));
  assert.equal(f.workspaces.projects.current(id), 'fedcba9876543210');
});

test('host and private checks use captured isolation and resolved secrets without root argv or UID HOME overrides', async () => {
  for (const mode of ['host', 'private'] as const) {
    const f = fixture(mode); await f.run("src/a' $TOKEN.js");
    const [, , project, execution] = f.launches[0];
    assert.equal(project.networkIsolation, mode);
    assert.equal(execution.environment?.TOKEN, 'private-diagnostic-token');
    assert.equal('HOME' in execution.environment!, false);
    const identityId = '22222222-2222-4222-8222-222222222222', runId = '33333333-3333-4333-8333-333333333333';
    const identity: ProjectIdentity = { version: 1, phase: 'active', registryId: '44444444-4444-4444-8444-444444444444',
      projectId, identityId, revision: 1, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 22000, gid: 22000,
      home: '/var/lib/sakura-project-homes/' + identityId, directory: project.directory, networkIsolation: mode,
      homeDevice: '1', homeInode: '2', directoryDevice: '1', directoryInode: '3' };
    const run: ProjectIdentityRun = { version: 1, phase: 'active', mode: 'inherit-current', registryId: identity.registryId,
      identityId, projectId, runId, revision: 1, bootId: '55555555-5555-4555-8555-555555555555', build: 'a'.repeat(64),
      networkDevice: '1', networkInode: '4', cgroupDevice: '1', cgroupInode: '5', cgroupName: 'sakura-task-' + runId,
      namespace: mode === 'private' ? 'sk-' + projectId : '' };
    const payload = new ProjectIdentities(f.machines).input(identity, run, execution);
    assert.equal(payload.command.includes(execution.command), false);
    assert.equal(payload.command.includes('private-diagnostic-token'), false);
    assert.equal(payload.command.includes('$TOKEN'), false);
    assert.ok(payload.input.includes(Buffer.from(execution.command)));
    assert.ok(payload.input.includes(Buffer.from('private-diagnostic-token')));
    assert.equal(payload.input.readUInt32LE(12), 0);
    assert.equal(payload.input.readUInt32LE(24), Buffer.byteLength(execution.command));
    assert.deepEqual(f.rootCommands, []);
  }
});

test('reported diagnostics retain positions, first 100 lines and message limits, while hiding resolved secrets', async () => {
  const f = fixture();
  returning(f, { code: 2, stdout: '/workspace/app/src/a.ts(7,12): error TS1000: private-diagnostic-token\r\n',
    stderr: 'src/a.ts:9:4: second\n' + 'x'.repeat(600) + '\n' + Array.from({ length: 110 }, (_, i) => `extra ${i}`).join('\n') });
  const result = await f.run('src/a.ts');
  assert.equal(result.supported, true); assert.equal(result.diagnostics.length, 100);
  // Keep the existing parser's leading colon after a TypeScript (line,column).
  assert.deepEqual(result.diagnostics[0], { severity: 'error', line: 7, column: 12, message: ': error TS1000: [私密配置已隐藏]' });
  assert.deepEqual(result.diagnostics[1], { severity: 'error', line: 9, column: 4, message: 'second' });
  assert.equal(result.diagnostics[2].message, 'x'.repeat(500));
  assert.equal(JSON.stringify(result).includes('private-diagnostic-token'), false);
  assert.deepEqual(f.events, ['prepare', 'uid-start', 'full-domain-stopped', 'native-ticket-closed', 'release', 'close']);
});

test('captured config is independent of the object returned by the first asynchronous read', async () => {
  const f = fixture(); let first = true, returned: Project | undefined;
  const read = f.workspaces.config;
  f.workspaces.config = async (...args) => {
    const value = await read(...args);
    if (first) { first = false; returned = value; }
    return value;
  };
  const prepare = f.manager.prepare;
  f.manager.prepare = async (...args) => { returned!.directory = '/workspace/other'; return prepare(...args); };
  await f.run();
  assert.equal(f.launches[0][2].directory, '/workspace/app');
  assert.match(f.launches[0][3].command, /\/workspace\/app\/src\/a\.js/);
});

test('a changed captured lease version, scope or live fails before execution and always closes the manager', async () => {
  for (const corrupt of [
    (lease: any) => { lease.captured.configVersion = '0'.repeat(64); },
    (lease: any) => { lease.projectId = 'fedcba9876543210'; },
    (lease: any) => { lease.captured.live = {}; },
    (lease: any) => { lease.captured.project = copyProject(lease.captured.project, 'fedcba9876543210'); },
    (lease: any) => { lease.captured.project.environment = { MODE: 'changed' }; },
  ]) {
    const f = fixture(), prepare = f.manager.prepare;
    f.manager.prepare = async (...args) => { const lease = await prepare(...args); corrupt(lease); return lease; };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
  }
});

test('live replacement or config edits during preparation and resolution prevent the UID launch', async () => {
  for (const phase of ['prepare', 'resolve'] as const) for (const change of ['live', 'config'] as const) {
    const f = fixture();
    const mutate = () => { if (change === 'live') f.machines.live.set(id, {} as any); else f.config.environment = { MODE: 'changed' }; };
    if (phase === 'prepare') {
      const prepare = f.manager.prepare;
      f.manager.prepare = async (...args) => { const lease = await prepare(...args); mutate(); return lease; };
    } else {
      const resolve = f.workspaces.resolveProject;
      f.workspaces.resolveProject = async (...args) => { const value = await resolve(...args); mutate(); return value; };
    }
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
  }
});

test('changed execution boundaries or unsafe resolved native environments are rejected before the UID launch', async () => {
  for (const mutate of [
    (resolved: Project) => { resolved._workspace = 'fedcba9876543210'; },
    (resolved: Project) => { resolved.directory = '/workspace/other'; },
    (resolved: Project) => { resolved.networkIsolation = 'host'; },
    (resolved: Project) => { resolved.environment = { HOME: '/root' }; },
    (resolved: Project) => { resolved.environment = { TOKEN: 'x'.repeat(8193) }; },
    (resolved: Project) => { resolved.environment = { TOKEN: 'bad\0value' }; },
  ]) {
    const f = fixture(), resolve = f.workspaces.resolveProject;
    f.workspaces.resolveProject = async (...args) => { const value = await resolve(...args); mutate(value); return value; };
    await assert.rejects(f.run());
    assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
    assert.deepEqual(f.rootCommands, []);
  }
});

test('late config, scope and live changes suppress results after full native cleanup', async () => {
  for (const change of ['config', 'scope', 'live', 'paused'] as const) {
    const f = fixture(), launch = f.options.runProjectTask!;
    f.options.runProjectTask = async (...args) => {
      const result = await launch(...args);
      if (change === 'config') f.config.environment = { MODE: 'changed' };
      if (change === 'scope') f.forceScope();
      if (change === 'live') f.machines.live.set(id, {} as any);
      if (change === 'paused') f.setStatus('paused');
      return result;
    };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 1); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
    assert.deepEqual(f.events.slice(-4), ['full-domain-stopped', 'native-ticket-closed', 'release', 'close']);
  }
});

test('cancellation during preparation or secret resolution releases the lease without launching any code', async () => {
  for (const phase of ['prepare', 'resolve'] as const) {
    const f = fixture();
    if (phase === 'prepare') {
      const prepare = f.manager.prepare;
      f.manager.prepare = async (...args) => { const value = await prepare(...args); f.abort.abort(); return value; };
    } else {
      const resolve = f.workspaces.resolveProject;
      f.workspaces.resolveProject = async (...args) => { const value = await resolve(...args); f.abort.abort(); return value; };
    }
    await assert.rejects(f.run(), (error: any) => error.name === 'AbortError');
    assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
  }
});

test('task cancellation, transport errors and uncertain native cleanup propagate instead of becoming diagnostics', async () => {
  for (const failure of [new DOMException('canceled', 'AbortError'), new Error('SSH transport disconnected'),
    new AppError('original cgroup still populated', 503, 'GUEST_TASK_CLEANUP_FAILED'),
    new AppError('original native receipt retained', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')]) {
    const f = fixture(); f.options.runProjectTask = async () => { assert.ok(f.leaseOpen()); throw failure; };
    await assert.rejects(f.run(), (error) => error === failure);
    assert.equal(f.releases(), 1); assert.equal(f.closes(), 1); assert.deepEqual(f.rootCommands, []);
  }
});

test('the preparation lease stays held while a UID task performs its full domain and ticket cleanup', async () => {
  const f = fixture(); let started!: () => void, finish!: () => void;
  const running = new Promise<void>((resolve) => { started = resolve; });
  const cleanup = new Promise<void>((resolve) => { finish = resolve; });
  f.options.runProjectTask = async () => {
    started(); await cleanup; assert.ok(f.leaseOpen()); f.events.push('native-cleanup-confirmed');
    return { code: 0, stdout: '', stderr: '' };
  };
  const operation = f.run(); await running;
  assert.ok(f.leaseOpen()); assert.equal(f.releases(), 0); assert.equal(f.closes(), 0);
  finish(); await operation;
  assert.deepEqual(f.events, ['prepare', 'native-cleanup-confirmed', 'release', 'close']);
});

test('failed preparation closes its per-call manager and never creates or migrates the project directory', async () => {
  for (const failure of [new AppError('directory absent', 409, 'PROJECT_IDENTITY_DIRECTORY_MISSING'),
    new AppError('explicit migration required', 409, 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED')]) {
    const f = fixture(); f.manager.prepare = async () => { throw failure; };
    await assert.rejects(f.run(), (error) => error === failure);
    assert.equal(f.created(), 1); assert.equal(f.releases(), 0); assert.equal(f.closes(), 1);
    assert.equal(f.launches.length, 0); assert.deepEqual(f.rootCommands, []);
  }
});

test('preparation cleanup failure is never hidden by successful diagnostic output, and close still runs', async () => {
  for (const phase of ['release', 'close'] as const) {
    const f = fixture(), failure = new Error(phase + ' failed');
    if (phase === 'release') {
      const prepare = f.manager.prepare;
      f.manager.prepare = async (...args) => {
        const lease = await prepare(...args), release = lease.release;
        lease.release = () => { release(); throw failure; }; return lease;
      };
    } else f.manager.close = async () => { f.events.push('close-attempted'); throw failure; };
    await assert.rejects(f.run(), (error) => error === failure);
    assert.equal(f.releases(), 1);
    assert.ok(f.events.includes(phase === 'close' ? 'close-attempted' : 'close'));
  }
});

test('simultaneous task and preparation cleanup failures preserve all causes and the native 503 code', async () => {
  const f = fixture(), aborted = new DOMException('canceled', 'AbortError');
  const critical = new AppError('native original run retained', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  const releaseFailure = new Error('lease release failed'), prepare = f.manager.prepare;
  f.manager.prepare = async (...args) => {
    const lease = await prepare(...args), release = lease.release;
    lease.release = () => { release(); throw releaseFailure; }; return lease;
  };
  f.manager.close = async () => { f.events.push('close-attempted'); throw critical; };
  f.options.runProjectTask = async () => { throw aborted; };
  await assert.rejects(f.run(), (error: any) => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [aborted, releaseFailure, critical]);
    assert.equal(error.cause, critical); assert.equal((error as any).status, 503); assert.equal((error as any).code, critical.code); return true;
  });
  assert.ok(f.events.includes('close-attempted'));
});

test('real task preparation protects directory edits through UID cleanup and performs no project mkdir or terminal install', async () => {
  const f = fixture(), guards = new Set<(id: string, previous: Project, next: Project) => Promise<void>>();
  f.workspaces.beforeConfigChange = (guard: any) => { guards.add(guard); return () => guards.delete(guard); };
  const commands: string[] = [];
  f.machines.exec = async (_id, command) => {
    commands.push(command);
    if (command.includes('project-directory-migrations')) return { code: 0, stdout: 'null\n', stderr: '' };
    assert.match(command, /SAKURA_TASK_DIRECTORY_MISSING/);
    return { code: 0, stdout: '', stderr: '' };
  };
  let admissions = 0;
  f.options.createPreparation = () => new ProjectTerminals(f.machines, f.workspaces, undefined, { scopes: {
    assertAdmission: async (_id: string, scope: string) => { assert.equal(scope, projectId); ++admissions; },
    terminalRuns: async () => { throw new Error('Task must not use terminal ownership'); },
  } as any });
  const changed = { ...f.config, directory: '/workspace/other', _workspace: projectId };
  f.options.runProjectTask = async (_machines, _id, captured, execution, signal, _log, timeout, _agent, _cleanup, pins) => {
    assert.equal(captured._workspace, projectId); assert.equal(pins?.expectedLive, f.live);
    assert.equal(timeout, 30000); assert.equal(signal.aborted, false); projectIdentityPayload(execution);
    assert.equal(guards.size, 1);
    for (const guard of guards) await assert.rejects(guard(id, f.config, changed), /请先结束/);
    return { code: 0, stdout: '', stderr: '' };
  };
  await f.run(); assert.equal(guards.size, 0); assert.equal(admissions, 1);
  assert.equal(commands.length, 2);
  assert.ok(commands.every((value) => !value.includes("mkdir -p '/workspace/app'")));
  assert.ok(commands.every((value) => !value.includes('install -y tmux') && !value.includes('apk add --no-cache --timeout 30 tmux') && !value.includes('node --check')));
  assert.ok(commands.every((value) => !value.includes('private-diagnostic-token')));
});

test('the real missing-directory preparation code rejects before any UID task and removes its temporary guard', async () => {
  const f = fixture('host'); let guards = 0;
  f.workspaces.beforeConfigChange = () => { ++guards; return () => { --guards; return true; }; };
  const commands: string[] = [];
  f.machines.exec = async (_id, command) => {
    commands.push(command);
    return command.includes('project-directory-migrations') ? { code: 0, stdout: 'null\n', stderr: '' }
      : { code: 74, stdout: '', stderr: 'SAKURA_TASK_DIRECTORY_MISSING: missing original directory' };
  };
  f.options.createPreparation = () => new ProjectTerminals(f.machines, f.workspaces, undefined,
    { scopes: { assertAdmission: async () => {} } as any });
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_DIRECTORY_MISSING');
  assert.equal(guards, 0); assert.equal(f.launches.length, 0);
  assert.ok(commands.every((value) => !value.includes("mkdir -p '/workspace/app'")));
});
