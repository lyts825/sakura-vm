import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Machines as MachinesType } from '../server/machines.ts';
import type { Project } from '../server/workspaces.ts';
import type { ProjectIdentityExecution } from '../server/project-identity.ts';

const base = resolve('.data/runtime-identity-unit-temp');
await mkdir(base, { recursive: true });
const directory = await mkdtemp(join(base, 'sakura-runtime-unit-'));
process.env.SAKURA_DATA_DIR = directory;
const { runtimeProbeCommand, parseRuntimeProbe } = await import('../server/runtime-probe.ts');
const { runtimeInstallCommand, runtimeInstallSetup, parseRuntimeInstall, parseRuntimeInstallRecovery } = await import('../server/runtime-install.ts');
const { RuntimeVersions } = await import('../server/runtime-versions.ts');
const { Workspaces, projectSchema, projectVersion } = await import('../server/workspaces.ts');
const { Machines } = await import('../server/machines.ts');
const { AppError, vmDir } = await import('../server/model.ts');
const { Jobs } = await import('../server/jobs.ts');
const { runtimeEnvironment } = await import('../server/runtime-config.ts');
after(async () => { assert.equal(dirname(resolve(directory)), base); await rm(directory, { recursive: true, force: true }); });

const bootId = randomUUID();
const sample = (actual = { node: '22.12.0', python: '3.12.1' }, declared = {}) => ({ code: 0, stderr: '',
  stdout: JSON.stringify({ version: 1, ok: true, bootId, actual, declared }) });
const receipt = (phase: 'prepared' | 'ready', installId: string = randomUUID(), tool: 'node' | 'python' = 'node', version = '22.12.0') => ({ code: 0, stderr: '',
  stdout: JSON.stringify({ version: 1, ok: true, result: { version: 1, tool, architecture: 'x86_64', requestedVersion: version,
    phase, installId, directoryDevice: '1', directoryInode: '2', executableDevice: '1', executableInode: '3', executableSha256: 'a'.repeat(64) } }) });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(initial: Partial<Project> = {}) {
  const id = randomUUID(), live = { status: 'running', startedAt: 'one' }, calls: string[] = [], tasks: ProjectIdentityExecution[] = [];
  let configuration: Project = projectSchema.parse({ directory: '/srv/projects/one', ...initial });
  let scope = 'default', locked = false, saves = 0, now = Date.now();
  const machines = Object.assign(new EventEmitter(), { live: new Map([[id, live]]), records: new Map([[id, { template: 'none' }]]),
    get: () => ({ name: 'owned', distro: 'debian', template: 'none' }), state: () => machines.live.get(id)?.status || 'stopped',
    exec: async (_id: string, command: string) => { calls.push(command); return command.includes('SAKURA_RUNTIME_INSTALL') ? receipt('ready') : { code: 0, stdout: bootId, stderr: '' }; },
    readGuestFile: async () => { throw new Error('GET must not read guest files'); },
    locked: async <T>(_id: string, action: () => Promise<T>) => { assert.equal(locked, false, 'VM locks must not reenter'); locked = true; try { return await action(); } finally { locked = false; } },
  }) as unknown as MachinesType;
  const workspaces = {
    config: async () => configuration,
    resolveProject: async (_id: string, project: Project) => ({ ...project, environment: {
      ...project.environment, ...runtimeEnvironment(project.runtimes, project.environment?.PATH) } }),
    networkEnvironment: async () => ({}), onConfigChange: () => () => {},
    save: async (_id: string, project: Project, _allowed: unknown, version?: string, commit?: () => void) => machines.locked(id, async () => {
      commit?.(); assert.equal(version, projectVersion(configuration)); ++saves;
      configuration = projectSchema.parse(project); return configuration;
    }),
    projects: { current: () => scope, key: () => scope === 'default' ? id : id + ':' + scope },
  } as unknown as InstanceType<typeof Workspaces>;
  const runtime = new RuntimeVersions(machines, workspaces, { now: () => now, runTask: async (_machine, _id, _project, execution) => {
    assert.equal(locked, true); tasks.push(execution); return sample();
  } });
  runtime.jobs = new Jobs();
  return { id, live, machines, workspaces, runtime, calls, tasks,
    configuration: () => configuration, replace: (project: Partial<Project>) => { configuration = projectSchema.parse({ ...configuration, ...project }); },
    scope: (value: string) => { scope = value; }, advance: (value: number) => { now += value; }, saves: () => saves,
    runTask: (value: NonNullable<ConstructorParameters<typeof RuntimeVersions>[2]>['runTask']) => { (runtime as any).options.runTask = value; },
    runInstallTask: (value: NonNullable<ConstructorParameters<typeof RuntimeVersions>[2]>['runInstallTask']) => { (runtime as any).options.runInstallTask = value; },
  };
}

test('GET is host-only before and after thousands of polls; stale samples never launch a task', async () => {
  const f = fixture({ environment: { PATH: '/srv/projects/one/bin', TOKEN: 'owned-private-body' } });
  try {
    assert.equal((await f.runtime.view(f.id)).probe.state, 'unprobed');
    assert.deepEqual((await f.runtime.view(f.id)).mismatches, []);
    for (let index = 0; index < 2200; index++) await f.runtime.view(f.id);
    assert.equal(f.calls.length, 0); assert.equal(f.tasks.length, 0);
    const result = await f.runtime.probe(f.id);
    assert.equal(result.probe.state, 'cached'); assert.equal(result.probe.bootId, bootId);
    assert.equal(f.tasks.length, 1); assert.equal(f.calls.length, 0);
    assert.equal(f.tasks[0].environment?.TOKEN, 'owned-private-body');
    assert.equal(f.tasks[0].environment?.PATH, '/srv/projects/one/bin');
    assert.ok(!JSON.stringify(result).includes('owned-private-body'));
    for (let index = 0; index < 2200; index++) await f.runtime.view(f.id);
    assert.equal(f.tasks.length, 1);
    f.advance(300001); assert.equal((await f.runtime.view(f.id)).probe.state, 'stale');
    f.machines.live.set(f.id, { ...f.live } as any);
    assert.equal((await f.runtime.view(f.id)).probe.state, 'stale');
    assert.equal(f.tasks.length, 1);
  } finally { await f.runtime.close(); }
});

test('sample cache is bounded, separates scopes, and a new module does not reuse a previous ticket', async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 260; index++) { f.scope(index.toString(16).padStart(16, '0')); await f.runtime.probe(f.id); }
    assert.equal((f.runtime as any).samples.size, 256);
    f.scope('0000000000000000'); assert.equal((await f.runtime.view(f.id)).probe.state, 'unprobed');
    f.scope('0000000000000103'); assert.equal((await f.runtime.view(f.id)).probe.state, 'cached');
    assert.equal(f.tasks.length, 260);
    await f.runtime.close();
    const replacement = new RuntimeVersions(f.machines, f.workspaces, { runTask: async () => { f.tasks.push({ command: 'new-ticket' }); return sample(); } });
    replacement.jobs = new Jobs();
    try { await replacement.probe(f.id); assert.equal(f.tasks.length, 261); }
    finally { await replacement.close(); }
  } finally { await f.runtime.close(); }
});

test('selected pins require a read-only ready receipt before the project task and compare exact versions', async () => {
  const f = fixture();
  try {
    await f.runtime.select(f.id, { node: '22.12.0' });
    assert.equal(f.calls.length, 1); assert.match(f.calls[0], /"operation\\":\\"verify/);
    assert.equal(f.saves(), 1); assert.equal((await f.runtime.view(f.id)).probe.state, 'cached');
    assert.match(f.tasks[0].command, /node-22\.12\.0\/bin\/node/);
    assert.match(f.tasks[0].environment!.PATH, /^\/opt\/sakura-runtimes\/node-22\.12\.0\/bin:/);
    f.runTask(async () => sample({ node: '22.12.01', python: '3.12.1' }));
    await assert.rejects(f.runtime.select(f.id, { node: '22.12.0' }), (error: unknown) => error instanceof AppError && error.code === 'RUNTIME_VERSION_MISMATCH');
    assert.equal(f.saves(), 1);
    f.machines.exec = async () => ({ code: 73, stdout: JSON.stringify({ version: 1, ok: false, code: 'INSTALL_INCOMPLETE' }), stderr: '' });
    await assert.rejects(f.runtime.select(f.id, { node: '22.12.0' }), /INSTALL_INCOMPLETE/);
    assert.equal(f.saves(), 1);
  } finally { await f.runtime.close(); }
});

test('select validates a candidate environment instead of retaining the previous runtime overrides', async () => {
  const f = fixture({ runtimes: { python: '3.12.1' }, environment: { PATH: '/srv/projects/one/bin', TOKEN: 'private' } });
  try {
    await f.runtime.select(f.id, {});
    assert.equal(f.tasks[0].environment?.PATH, '/srv/projects/one/bin');
    assert.equal(f.tasks[0].environment?.VIRTUAL_ENV, undefined);
    assert.equal(f.calls.length, 0); assert.equal(f.saves(), 1);
    await f.runtime.select(f.id, { node: undefined, python: undefined });
    assert.deepEqual(f.configuration().runtimes, {});
    assert.equal(f.calls.length, 0); assert.equal(f.saves(), 2);
  } finally { await f.runtime.close(); }
});

test('configuration, scope or live changes during validation refuse cache and selection', async () => {
  for (const change of ['config', 'scope', 'live'] as const) {
    const f = fixture();
    try {
      f.runTask(async () => {
        if (change === 'config') f.replace({ environment: { FLAG: 'new' } });
        if (change === 'scope') f.scope('0123456789abcdef');
        if (change === 'live') f.machines.live.set(f.id, { ...f.live } as any);
        return sample();
      });
      await assert.rejects(f.runtime.probe(f.id), /已变化/);
      assert.equal((f.runtime as any).samples.size, 0);
    } finally { await f.runtime.close(); }
  }
});

test('select supplies CAS and a lock-local guard for stop/start or abort while save awaits', async () => {
  for (const change of ['config', 'live', 'abort', 'scope'] as const) {
    const f = fixture(), controller = new AbortController();
    const original = f.configuration();
    f.workspaces.save = async (_id, project, _allowed, expected, commit) => f.machines.locked<Project>(f.id, async () => {
      assert.equal(expected, projectVersion(original)); commit?.();
      await Promise.resolve();
      if (change === 'config') f.replace({ environment: { KEEP: 'concurrent' } });
      if (change === 'live') f.machines.live.set(f.id, { ...f.live } as any);
      if (change === 'abort') controller.abort();
      if (change === 'scope') f.scope('0123456789abcdef');
      if (projectVersion(f.configuration()) !== expected) throw new AppError('配置已变化', 409);
      commit?.(); return projectSchema.parse(project);
    });
    try {
      await assert.rejects(f.runtime.select(f.id, {}, controller.signal));
      assert.equal((f.runtime as any).samples.size, 0); assert.equal(f.saves(), 0);
      assert.equal(f.configuration().environment?.KEEP, change === 'config' ? 'concurrent' : undefined);
    } finally { await f.runtime.close(); }
  }
});

test('malformed tool replies, timeout and unconfirmed cleanup never publish raw data or save', async () => {
  const f = fixture();
  try {
    for (const result of [{ code: 0, stderr: '', stdout: 'private-body' },
      { ...sample(), stdout: 'x'.repeat(4097) }, { ...sample(), stderr: 'private-body' },
      { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true, bootId, declared: {}, actual: { node: 'private-body', python: '' } }) },
      { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: false, code: 'TOOL_TIMEOUT' }) }]) {
      f.runTask(async () => result); await assert.rejects(f.runtime.select(f.id, {}));
      assert.equal(f.saves(), 0); assert.equal((f.runtime as any).samples.size, 0);
      assert.ok(!JSON.stringify(await f.runtime.view(f.id)).includes('private-body'));
    }
    f.runTask(async () => { throw new AppError('unconfirmed private-body', 503, 'GUEST_TASK_CLEANUP_FAILED'); });
    await assert.rejects(f.runtime.probe(f.id), (error: unknown) => error instanceof AppError && error.status === 503);
    assert.equal((await f.runtime.view(f.id)).probe.errorCode, 'GUEST_TASK_CLEANUP_FAILED');
    assert.ok(!JSON.stringify(await f.runtime.view(f.id)).includes('private-body'));
  } finally { await f.runtime.close(); }
});

test('close aborts and waits for the complete task cleanup before resolving', async () => {
  const f = fixture(), entered = deferred<void>(), cleanup = deferred<void>();
  f.runTask(async (_machine, _id, _project, _execution, signal) => {
    entered.resolve(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    await cleanup.promise; signal.throwIfAborted(); return sample();
  });
  const operation = f.runtime.probe(f.id), rejected = assert.rejects(operation);
  await entered.promise;
  let closed = false; const closing = f.runtime.close().then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false);
  cleanup.resolve(); await Promise.all([closing, rejected]);
  assert.equal(closed, true); assert.equal((f.runtime as any).samples.size, 0);
  await assert.rejects(f.runtime.probe(f.id), /正在关闭/);
});

test('close preserves an unconfirmed cleanup failure after cancellation', async () => {
  const f = fixture(), entered = deferred<void>();
  f.runTask(async (_machine, _id, _project, _execution, signal) => {
    entered.resolve(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    throw new AppError('cleanup unconfirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  });
  const operation = f.runtime.probe(f.id), failed = assert.rejects(operation,
    (error: unknown) => error instanceof AppError && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED');
  await entered.promise;
  await assert.rejects(f.runtime.close(), (error: unknown) => error instanceof AppError &&
    error.status === 503 && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED');
  await failed; assert.equal((f.runtime as any).samples.size, 0);
});

test('real Workspaces candidate resolver does not reread config and preserves only the candidate pins', async () => {
  const f = fixture(), workspaces = new Workspaces(f.machines, { network: { environment: async () => ({ HTTPS_PROXY: 'https://proxy.example' }) } as any,
    secrets: { resolve: async (_id: string, references: object) => Object.keys(references || {}).length ? { TOKEN: 'resolved' } : {} } as any });
  workspaces.config = async () => { throw new Error('candidate resolver must not read current config'); };
  try {
    const candidate = projectSchema.parse({ directory: '/srv/projects/one', environment: { PATH: '/project/bin' }, secrets: { TOKEN: 'ref' }, runtimes: { node: '22.12.0' } });
    const resolved = await workspaces.resolveProject(f.id, candidate);
    assert.equal(resolved.environment?.TOKEN, 'resolved');
    assert.equal(resolved.environment?.PATH, '/opt/sakura-runtimes/node-22.12.0/bin:/project/bin');
    assert.equal(resolved.environment?.VIRTUAL_ENV, undefined);
    assert.equal(resolved.environment?.HTTPS_PROXY, 'https://proxy.example');
    assert.deepEqual(candidate.environment, { PATH: '/project/bin' });
  } finally { await Promise.all([f.runtime.close(), workspaces.close()]); }
});

test('real Workspaces commit guard runs after an async guard and prevents publication', async () => {
  const id = randomUUID(), live = { status: 'running' }, locks = new Machines({} as any);
  const machines = Object.assign(new EventEmitter(), { records: new Map([[id, { template: 'none' }]]), live: new Map([[id, live]]),
    state: () => 'running', get: () => ({ template: 'none' }), locked: locks.locked.bind(locks) }) as unknown as MachinesType;
  const workspaces = new Workspaces(machines);
  await mkdir(vmDir(id), { recursive: true }); const file = join(vmDir(id), 'project.json');
  const project = projectSchema.parse({ directory: '/srv/projects/one' }); await writeFile(file, JSON.stringify(project));
  const controller = new AbortController(), entered = deferred<void>(), resume = deferred<void>(); let checks = 0;
  workspaces.beforeConfigChange(async () => { entered.resolve(); await resume.promise; });
  const saving = workspaces.save(id, project, undefined, projectVersion(project), () => { ++checks; controller.signal.throwIfAborted(); });
  const rejected = assert.rejects(saving); await entered.promise; controller.abort(); resume.resolve();
  try { await rejected; assert.ok(checks >= 2); assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), project); }
  finally { await workspaces.close(); }
});

test('real Workspaces rechecks CAS after an async guard and preserves a concurrent file update', async () => {
  const id = randomUUID(), live = { status: 'running' }, locks = new Machines({} as any);
  const machines = Object.assign(new EventEmitter(), { records: new Map([[id, { template: 'none' }]]), live: new Map([[id, live]]),
    state: () => 'running', get: () => ({ template: 'none' }), locked: locks.locked.bind(locks) }) as unknown as MachinesType;
  const workspaces = new Workspaces(machines);
  await mkdir(vmDir(id), { recursive: true }); const file = join(vmDir(id), 'project.json');
  const original = projectSchema.parse({ directory: '/srv/projects/one' }), concurrent = { ...original, repository: 'https://example.test/new' };
  await writeFile(file, JSON.stringify(original));
  workspaces.beforeConfigChange(async () => { await writeFile(file, JSON.stringify(concurrent)); });
  try {
    await assert.rejects(workspaces.save(id, original, undefined, projectVersion(original)), /项目配置已变化/);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), concurrent);
  } finally { await workspaces.close(); }
});

test('helpers are fixed isolated Python, bounded and syntactically valid without executing project code', () => {
  const probe = runtimeProbeCommand({ node: '22.12.0' }), install = runtimeInstallCommand({ operation: 'verify', tool: 'python', version: '3.12.1' });
  assert.match(probe, /exec \/usr\/bin\/python3 -I -S -/);
  assert.match(probe, /os\.O_NOFOLLOW\|os\.O_NONBLOCK/); assert.match(probe, /stat\.S_ISREG/);
  assert.match(probe, /monotonic\(\)\+4/); assert.match(probe, /len\(buffer\)\+len\(data\)>4096/);
  const sources = [probe.split("<<'SAKURA_RUNTIME_PROBE'\n")[1].replace(/SAKURA_RUNTIME_PROBE$/, ''),
    install.split("<<'SAKURA_RUNTIME_INSTALL'\n")[1].replace(/SAKURA_RUNTIME_INSTALL$/, '')];
  const parsed = spawnSync('python', ['-I', '-S', '-c', 'import ast,json,sys; [ast.parse(item) for item in json.load(sys.stdin)]'], { input: JSON.stringify(sources), encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr || parsed.error?.message);
  assert.throws(() => runtimeInstallCommand({ operation: 'verify', tool: 'node', version: '22.12.0', network: { PATH: '/project/bin' } }));
  assert.throws(() => runtimeInstallSetup('debian', { HTTPS_PROXY: 'https://user:secret@proxy.example' }));
  assert.ok(!runtimeInstallSetup('debian').includes('project'));
});

test('receipt parser rejects unknown fields, wrong identity and prepared artifacts cannot verify ready', () => {
  const id = randomUUID();
  assert.equal(parseRuntimeInstall(receipt('ready', id), { tool: 'node', version: '22.12.0', phase: 'ready' }).installId, id);
  assert.throws(() => parseRuntimeInstall(receipt('prepared', id), { tool: 'node', version: '22.12.0', phase: 'ready' }));
  assert.throws(() => parseRuntimeInstall(receipt('ready', id), { tool: 'node', version: '22.12.0', phase: 'ready', installId: randomUUID() }));
  assert.throws(() => parseRuntimeInstall(receipt('ready', id), { tool: 'node', version: '22.12.0', phase: 'ready', architecture: 'aarch64' }));
  assert.throws(() => parseRuntimeProbe({ ...sample(), stdout: JSON.stringify({ ...JSON.parse(sample().stdout), secret: 'body' }) }));
});

test('install holds the VM lock, confirms only after the full task and passes no project environment', async () => {
  const f = fixture({ environment: { TOKEN: 'project-private-body', PATH: '/project/bin' } });
  let completed = false, confirm = 0;
  f.machines.exec = async (_id, command) => {
    f.calls.push(command);
    if (!command.includes('SAKURA_RUNTIME_INSTALL')) return { code: 0, stdout: bootId, stderr: '' };
    if (command.includes('\\"operation\\":\\"confirm\\"')) {
      assert.equal(completed, true); ++confirm;
      const id = command.match(/\\"installId\\":\\"([a-f0-9-]{36})/)!;
      return receipt('ready', id[1]);
    }
    return { code: 0, stdout: JSON.stringify({ version: 1, ok: true, result: null }), stderr: '' };
  };
  f.runInstallTask(async (_machine, _id, script, _signal, _log, _timeout, _agent, _cleanup, options) => {
    assert.ok(!script.includes('project-private-body')); assert.ok(!script.includes('/project/bin'));
    assert.match(script, /env -i PATH=/); assert.match(script, /--relocatable/);
    const id = script.match(/\\"installId\\":\\"([a-f0-9-]{36})/)!;
    assert.ok(options?.runId); completed = true; return receipt('prepared', id[1]);
  });
  try {
    const job = await f.runtime.install(f.id, { tool: 'node', version: '22.12.0' }); await f.runtime.jobs.wait(f.id);
    assert.equal(job.status, 'done', job.error); assert.equal(confirm, 1);
    assert.ok(f.calls.every(value => !value.includes('project-private-body')));
  } finally { await f.runtime.close(); }
});

test('install cleanup failure is retained and never calls ready confirmation', async () => {
  const f = fixture();
  f.machines.exec = async (_id, command) => {
    f.calls.push(command);
    return command.includes('SAKURA_RUNTIME_INSTALL') ? { code: 73, stdout: JSON.stringify({ version: 1, ok: false, code: 'INSTALL_SCOPE_ACTIVE' }), stderr: '' }
      : { code: 0, stdout: bootId, stderr: '' };
  };
  f.runInstallTask(async () => { throw new AppError('task cleanup unconfirmed', 503, 'GUEST_TASK_CLEANUP_FAILED'); });
  try {
    const job = await f.runtime.install(f.id, { tool: 'node', version: '22.12.0' }); await f.runtime.jobs.wait(f.id);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'RUNTIME_INSTALL_CLEANUP_FAILED');
    assert.equal(f.calls.filter(value => value.includes('\\"operation\\":\\"recover\\"')).length, 3);
    assert.ok(!f.calls.some(value => value.includes('\\"operation\\":\\"confirm\\"')));
  } finally { await f.runtime.close(); }
});

test('install refuses confirmation after its captured live changes', async () => {
  const f = fixture();
  f.runInstallTask(async (_machine, _id, script) => {
    const id = script.match(/\\"installId\\":\\"([a-f0-9-]{36})/)!;
    f.machines.live.set(f.id, { ...f.live } as any);
    return receipt('prepared', id[1]);
  });
  try {
    const job = await f.runtime.install(f.id, { tool: 'node', version: '22.12.0' }); await f.runtime.jobs.wait(f.id);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'RUNTIME_INSTALL_CLEANUP_FAILED');
    assert.ok(!f.calls.some(value => value.includes('\\"operation\\":\\"confirm\\"')));
  } finally { await f.runtime.close(); }
});

test('close waits for installer cancellation and preserves its cleanup failure', async () => {
  const f = fixture(), entered = deferred<void>();
  f.machines.exec = async (_id, command) => {
    f.calls.push(command);
    return command.includes('SAKURA_RUNTIME_INSTALL') ? { code: 73, stdout: JSON.stringify({ version: 1, ok: false, code: 'INSTALL_SCOPE_ACTIVE' }), stderr: '' }
      : { code: 0, stdout: bootId, stderr: '' };
  };
  f.runInstallTask(async (_machine, _id, _script, signal) => {
    entered.resolve(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    throw new AppError('cleanup unconfirmed', 503, 'GUEST_TASK_CLEANUP_FAILED');
  });
  const job = await f.runtime.install(f.id, { tool: 'node', version: '22.12.0' }); await entered.promise;
  await assert.rejects(f.runtime.close(), (error: unknown) => error instanceof AppError &&
    error.status === 503 && error.code === 'RUNTIME_INSTALL_CLEANUP_FAILED');
  assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'RUNTIME_INSTALL_CLEANUP_FAILED');
});
