import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Toolchains, toolCatalog, type ToolchainsOptions } from '../server/toolchains.ts';
import type { Machines } from '../server/machines.ts';
import { projectSchema, projectVersion, type Project, type Workspaces } from '../server/workspaces.ts';
import { AppError } from '../server/model.ts';
import { Jobs } from '../server/jobs.ts';
import { ProjectIdentities, projectIdentityPayload, type ProjectIdentity, type ProjectIdentityRun } from '../server/project-identity.ts';
import type { ProjectTerminals } from '../server/project-terminals.ts';

const id = '11111111-1111-4111-8111-111111111111', projectId = '0123456789abcdef';
type Output = { code: number; stdout: string; stderr: string };
function copyProject(value: Project, scope = value._workspace) {
  return Object.defineProperty(structuredClone(value), '_workspace', { value: scope, enumerable: false });
}
function output(): Output {
  return { code: 0, stderr: '', stdout: Object.keys(toolCatalog).map(key =>
    `\nSAKURA_TOOL_${key}\n${key === 'php' ? '' : key + ' 1.2.3'}\nSAKURA_REQUIRED_${key}\n${['node', 'rust'].includes(key) ? 'yesyes' : ''}\n`).join('') };
}
function fixture(networkIsolation: 'host' | 'private' = 'private', scope = projectId) {
  const context = new AsyncLocalStorage<string>();
  let forcedScope: string | undefined, outsideScope = scope;
  let status = 'running', distro = 'debian', leaseOpen = false, releases = 0, closes = 0, created = 0, resolutions = 0;
  const live = {}, abort = new AbortController(), preparedAbort = new AbortController();
  const config = copyProject(projectSchema.parse({ directory: '/workspace/app', networkIsolation,
    environment: { MODE: 'original', PATH: '/project/runtime/bin:/usr/bin:/bin' }, secrets: { TOKEN: 'toolchain-token' } }),
  scope === 'default' ? undefined : scope);
  const launches: Parameters<NonNullable<ToolchainsOptions['runTask']>>[] = [];
  const installs: Parameters<NonNullable<ToolchainsOptions['runInstallTask']>>[] = [];
  const events: string[] = [], rootCommands: string[] = [];
  const machines = {
    live: new Map([[id, live]]), state: () => status, get: () => ({ distro }),
    exec: async (_id: string, command: string) => { rootCommands.push(command); throw new Error('Unexpected direct root command'); },
    execInput: async () => { throw new Error('Unexpected direct root input'); },
    writeGuestFile: async () => { throw new Error('Unexpected root file publication'); },
  } as unknown as Machines;
  const workspaces = {
    projects: {
      current: () => forcedScope || context.getStore() || outsideScope,
      inScope: (_id: string, selected: string, action: () => unknown) => context.run(selected, action),
    },
    config: async () => copyProject(config),
    resolvedConfig: async () => { throw new Error('Selected project reread is forbidden'); },
    resolveProject: async (_id: string, captured: Project) => {
      ++resolutions; assert.equal(captured._workspace || 'default', scope);
      assert.equal(projectVersion(captured), projectVersion(config));
      return { ...captured, _workspace: captured._workspace,
        environment: { ...captured.environment, TOKEN: 'private-toolchain-token' } };
    },
    networkEnvironment: async () => ({ HTTPS_PROXY: 'http://admin-proxy:3128', https_proxy: 'http://admin-proxy:3128' }),
  } as unknown as Workspaces;
  const manager: Pick<ProjectTerminals, 'prepare' | 'close'> = {
    prepare: async (_id, selected, session, readOnly, signal, _terminalId, mode) => {
      assert.equal(selected, scope); assert.equal(session, null); assert.equal(readOnly, false);
      assert.deepEqual(mode, { mode: 'task' }); signal?.throwIfAborted(); leaseOpen = true; events.push('prepare');
      return { command: 'unused root terminal command', projectId: scope, networkIsolation, terminalId: undefined,
        signal: AbortSignal.any([signal!, preparedAbort.signal]),
        captured: { project: copyProject(config), configVersion: projectVersion(config), live: live as any },
        release: () => { leaseOpen = false; ++releases; events.push('release'); } };
    },
    close: async () => { ++closes; events.push('close'); assert.equal(leaseOpen, false); },
  };
  const options: ToolchainsOptions = {
    createPreparation: () => { ++created; return manager; },
    runTask: async (...args) => {
      const [transport, vmId, project, execution, signal, log, timeout, agentPath, afterCleanup, pins] = args;
      assert.equal(transport, machines); assert.equal(vmId, id); assert.equal(project._workspace || 'default', scope);
      assert.ok(leaseOpen); assert.equal(signal.aborted, false); assert.equal(timeout, 20000);
      assert.equal(pins?.expectedLive, live); assert.equal(log, undefined); assert.equal(agentPath, undefined);
      assert.equal(afterCleanup, undefined); projectIdentityPayload(execution); launches.push(args); events.push('uid-start');
      events.push('full-domain-stopped'); events.push('native-ticket-closed'); return output();
    },
    runInstallTask: async (...args) => {
      installs.push(args); args[3].throwIfAborted(); assert.equal(leaseOpen, false);
      events.push('admin-start'); events.push('admin-full-domain-stopped'); return { code: 0, stdout: '', stderr: '' };
    },
  };
  const tools = new Toolchains(machines, workspaces, options); tools.jobs = new Jobs();
  return { tools, run: (signal = abort.signal) => tools.view(id, signal), options, manager, machines, workspaces,
    config, live, abort, preparedAbort, launches, installs, events, rootCommands,
    leaseOpen: () => leaseOpen, releases: () => releases, closes: () => closes, created: () => created,
    resolutions: () => resolutions, setStatus: (value: string) => { status = value; }, setDistro: (value: string) => { distro = value; },
    switchOutside: () => { outsideScope = 'fedcba9876543210'; }, forceScope: () => { forcedScope = 'fedcba9876543210'; } };
}
function returning(f: ReturnType<typeof fixture>, value: Output) {
  const launch = f.options.runTask!;
  f.options.runTask = async (...args) => { await launch(...args); return value; };
}

test('tool catalog and public view shape remain compatible while one lease owns the entire probe', async () => {
  const f = fixture(); const result = await f.run();
  assert.deepEqual(Object.keys(result), ['tools', 'job']); assert.equal(result.job, null);
  assert.deepEqual(result.tools.map(tool => tool.id), ['git', 'node', 'python', 'rust', 'go', 'java', 'php']);
  assert.deepEqual(result.tools[1], { id: 'node', name: 'Node.js / npm', installed: true, version: 'node 1.2.3', required: true });
  assert.deepEqual(result.tools.at(-1), { id: 'php', name: 'PHP', installed: false, version: '', required: false });
  assert.equal(f.created(), 1); assert.equal(f.resolutions(), 1); assert.equal(f.launches.length, 1);
  assert.deepEqual(f.events, ['prepare', 'uid-start', 'full-domain-stopped', 'native-ticket-closed', 'release', 'close']);
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1); assert.deepEqual(f.rootCommands, []);
});

test('all catalog versions and relative markers use the captured descriptor cwd without root wrappers', async () => {
  const f = fixture(); await f.run(); const command = f.launches[0][3].command;
  for (const [key, tool] of Object.entries(toolCatalog)) {
    assert.ok(command.includes(`SAKURA_TOOL_${key}`)); assert.ok(command.includes(tool.version));
    for (const marker of tool.markers) assert.ok(command.includes(`test ! -e '${marker}' || printf yes`));
  }
  assert.doesNotMatch(command, /\/workspace\/app|\bcd\b|ip netns exec|sh -lc|mkdir|chown/);
  assert.equal(f.launches[0][3].environment?.PATH, '/project/runtime/bin:/usr/bin:/bin');
  assert.equal('HOME' in f.launches[0][3].environment!, false);
});

test('named scope survives non-enumerable config capture and concurrent outside project selection', async () => {
  const f = fixture(), read = f.workspaces.config;
  f.workspaces.config = async (...args) => { await Promise.resolve(); f.switchOutside(); return read(...args); };
  await f.run(); const captured = f.launches[0][2];
  assert.equal(captured._workspace, projectId);
  assert.equal(Object.getOwnPropertyDescriptor(captured, '_workspace')?.enumerable, false);
  assert.equal(f.workspaces.projects.current(id), 'fedcba9876543210');
  assert.equal(projectVersion(captured), projectVersion(f.config));
});

test('host/private/default tasks preserve identity binding and keep body/secrets out of root argv', async () => {
  for (const mode of ['host', 'private'] as const) for (const scope of [projectId, 'default']) {
    const f = fixture(mode, scope); await f.run(); const [, , project, execution] = f.launches[0];
    const identityId = '22222222-2222-4222-8222-222222222222', runId = '33333333-3333-4333-8333-333333333333';
    const identity: ProjectIdentity = { version: 1, phase: 'active', registryId: '44444444-4444-4444-8444-444444444444',
      projectId: scope, identityId, revision: 1, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 22000, gid: 22000,
      home: '/var/lib/sakura-project-homes/' + identityId, directory: project.directory, networkIsolation: mode,
      homeDevice: '1', homeInode: '2', directoryDevice: '1', directoryInode: '3' };
    const run: ProjectIdentityRun = { version: 1, phase: 'active', mode: 'inherit-current', registryId: identity.registryId,
      identityId, projectId: scope, runId, revision: 1, bootId: '55555555-5555-4555-8555-555555555555', build: 'a'.repeat(64),
      networkDevice: '1', networkInode: '4', cgroupDevice: '1', cgroupInode: '5', cgroupName: 'sakura-task-' + runId,
      namespace: mode === 'private' ? 'sk-' + scope : '' };
    const frame = new ProjectIdentities(f.machines).input(identity, run, execution);
    assert.equal(project.networkIsolation, mode); assert.equal(project._workspace || 'default', scope);
    assert.ok(!frame.command.includes(execution.command)); assert.ok(!frame.command.includes('private-toolchain-token'));
    assert.ok(frame.input.includes(Buffer.from(execution.command))); assert.ok(frame.input.includes(Buffer.from('private-toolchain-token')));
    assert.equal(frame.input.readUInt32LE(12), 0); assert.equal(frame.input.readUInt32LE(24), Buffer.byteLength(execution.command));
    assert.deepEqual(f.rootCommands, []);
  }
});

test('capture is detached from the first config object before preparation starts', async () => {
  const f = fixture(), read = f.workspaces.config; let original: Project | undefined;
  f.workspaces.config = async (...args) => { const value = await read(...args); original ||= value; return value; };
  const prepare = f.manager.prepare;
  f.manager.prepare = async (...args) => { original!.directory = '/workspace/foreign'; return prepare(...args); };
  await f.run(); assert.equal(f.launches[0][2].directory, '/workspace/app');
});

test('wrong preparation project/config/live proof prevents any UID command', async () => {
  for (const field of ['scope', 'config', 'live', 'missing'] as const) {
    const f = fixture(), prepare = f.manager.prepare;
    f.manager.prepare = async (...args) => {
      const lease = await prepare(...args);
      if (field === 'scope') lease.projectId = 'fedcba9876543210';
      if (field === 'config') lease.captured!.configVersion = 'different';
      if (field === 'live') lease.captured!.live = {} as any;
      if (field === 'missing') lease.captured = undefined;
      return lease;
    };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
  }
});

test('original live and config changes during environment resolution never chase a replacement', async () => {
  for (const field of ['live', 'directory', 'scope', 'mode'] as const) {
    const f = fixture(), resolve = f.workspaces.resolveProject;
    f.workspaces.resolveProject = async (...args) => {
      const resolved = await resolve(...args);
      if (field === 'live') f.machines.live.set(id, {} as any);
      if (field === 'directory') f.config.directory = '/workspace/new';
      if (field === 'scope') f.forceScope();
      if (field === 'mode') resolved.networkIsolation = 'host';
      return resolved;
    };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.resolutions(), 1); assert.equal(f.releases(), 1);
    assert.deepEqual(f.rootCommands, []);
  }
});

test('a completed task cannot publish output for changed original config/live or an aborted request', async () => {
  for (const field of ['live', 'config', 'abort'] as const) {
    const f = fixture(), launch = f.options.runTask!;
    f.options.runTask = async (...args) => {
      const result = await launch(...args);
      if (field === 'live') f.machines.live.set(id, {} as any);
      if (field === 'config') f.config.environment!.MODE = 'changed';
      if (field === 'abort') f.abort.abort();
      return result;
    };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED' || error.name === 'AbortError');
    assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
  }
});

test('stopped, missing, cancelled and unknown tasks do not get a root fallback or implicit directory migration', async () => {
  for (const field of ['stopped', 'live', 'cancelled', 'missing-directory', 'unknown'] as const) {
    const f = fixture();
    if (field === 'stopped') f.setStatus('stopped');
    if (field === 'live') f.machines.live.delete(id);
    if (field === 'cancelled') f.abort.abort();
    if (field === 'missing-directory') f.manager.prepare = async () => {
      throw new AppError('explicit migration required', 409, 'PROJECT_IDENTITY_DIRECTORY_MISSING');
    };
    if (field === 'unknown') f.options.runTask = async () => { throw new Error('native outcome unknown'); };
    await assert.rejects(f.run()); assert.deepEqual(f.rootCommands, []); assert.equal(f.installs.length, 0);
    if (field === 'missing-directory') { assert.equal(f.resolutions(), 0); assert.equal(f.closes(), 1); }
  }
});

test('prepared cancellation propagates to the UID transport and still releases the original lease', async () => {
  const f = fixture();
  f.options.runTask = async (...args) => { f.preparedAbort.abort(); args[4].throwIfAborted(); return output(); };
  await assert.rejects(f.run(), error => error === f.preparedAbort.signal.reason);
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1); assert.deepEqual(f.rootCommands, []);
});

test('display versions and errors hide resolved project secrets while raw parsing retains marker semantics', async () => {
  const f = fixture(); returning(f, { code: 0, stderr: '', stdout:
    '\nSAKURA_TOOL_git\nprivate-toolchain-token version\nSAKURA_REQUIRED_git\nyes\n' });
  const result = await f.run(); assert.equal(result.tools[0].version, '[私密配置已隐藏] version');
  assert.equal(result.tools[0].installed, true); assert.equal(result.tools[0].required, true);
  assert.ok(!JSON.stringify(result).includes('private-toolchain-token'));
  const bad = fixture(); returning(bad, { code: 7, stderr: 'failure private-toolchain-token', stdout: '' });
  await assert.rejects(bad.run(), (error: any) => error.message === 'failure [私密配置已隐藏]');
  const unknown = fixture(); unknown.options.runTask = async () => { throw new Error('transport private-toolchain-token'); };
  await assert.rejects(unknown.run(), (error: any) => error.message === 'transport [私密配置已隐藏]');
});

test('input/output bounds and invalid task replies fail explicitly without partial parsing or root execution', async () => {
  const oversized = fixture();
  oversized.config.environment!.LARGE = 'x'.repeat(8193);
  await assert.rejects(oversized.run(), (error: any) => error.status === 413 && error.code === 'PROJECT_IDENTITY_PAYLOAD_INVALID');
  assert.equal(oversized.launches.length, 0); assert.equal(oversized.releases(), 1);
  const bytes = fixture(); returning(bytes, { code: 0, stdout: '界'.repeat(400000), stderr: '' });
  await assert.rejects(bytes.run(), (error: any) => error.status === 413 && error.code === 'TOOLCHAIN_OUTPUT_TOO_LARGE');
  const invalid = fixture(); returning(invalid, { code: NaN, stdout: '', stderr: '' });
  await assert.rejects(invalid.run(), (error: any) => error.status === 502 && error.code === 'TOOLCHAIN_TASK_RESULT_INVALID');
  assert.deepEqual(oversized.rootCommands, []); assert.deepEqual(bytes.rootCommands, []);
});

test('frozen errors with resolved secrets retain status/code and the original cause without exposing their message', async () => {
  const f = fixture(), original = Object.freeze(new AppError('failure private-toolchain-token', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'));
  f.options.runTask = async () => { throw original; };
  await assert.rejects(f.run(), (error: any) => {
    assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(error.code, original.code);
    assert.equal(error.message, 'failure [私密配置已隐藏]'); assert.equal(error.cause, original); return true;
  });
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
});

test('native cleanup 503 stays the original error and simultaneous preparation failures retain every cause', async () => {
  const single = fixture(), cleanup = new AppError('native full domain unconfirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  single.options.runTask = async () => { throw cleanup; };
  await assert.rejects(single.run(), error => error === cleanup);
  assert.equal(single.releases(), 1); assert.equal(single.closes(), 1);
  const all = fixture(), release = new Error('lease release failed'), closing = new Error('manager close failed');
  all.options.runTask = async () => { throw cleanup; };
  const prepare = all.manager.prepare;
  all.manager.prepare = async (...args) => {
    const prepared = await prepare(...args);
    prepared.release = () => { all.events.push('release-failed'); throw release; };
    return prepared;
  };
  all.manager.close = async () => { all.events.push('close-failed'); throw closing; };
  await assert.rejects(all.run(), (error: any) => {
    assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(error.code, cleanup.code);
    assert.equal(error.cause, cleanup);
    assert.deepEqual((error as AppError & { errors: unknown[] }).errors, [cleanup, release, closing]); return true;
  });
  assert.deepEqual(all.events, ['prepare', 'release-failed', 'close-failed']);
});

test('successful task results do not hide lease or manager cleanup failure', async () => {
  const f = fixture(), prepare = f.manager.prepare;
  f.manager.prepare = async (...args) => { const lease = await prepare(...args); lease.release = () => { throw new Error('lease'); }; return lease; };
  f.manager.close = async () => { f.events.push('close-failed'); throw new Error('manager'); };
  await assert.rejects(f.run(), (error: any) => error.status === 503 && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED' && error.errors.length === 2);
  assert.ok(f.events.includes('native-ticket-closed')); assert.ok(f.events.includes('close-failed'));
});

test('close waits for full pending task cleanup and preserves unconfirmed cleanup errors', async () => {
  for (const unconfirmed of [false, true]) {
    const f = fixture(); let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    const cleanup = new AppError('full domain unconfirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    f.options.runTask = async (...args) => {
      assert.ok(f.leaseOpen()); started();
      await new Promise<void>(resolve => args[4].addEventListener('abort', () => resolve(), { once: true }));
      assert.ok(f.leaseOpen()); f.events.push('full-domain-cleanup');
      if (unconfirmed) throw cleanup;
      args[4].throwIfAborted(); return output();
    };
    const pending = f.run(); const handled = pending.catch(error => error); await ready;
    if (unconfirmed) await assert.rejects(f.tools.close(), error => error === cleanup); else await f.tools.close();
    const error = await handled; assert.ok(error instanceof Error);
    assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
    assert.ok(f.events.indexOf('release') > f.events.indexOf('full-domain-cleanup'));
    await assert.rejects(f.run(), (error: any) => error.name === 'AbortError');
  }
});

test('administrator installs keep catalog package selection and fixed env/cwd with proxy data on stdin', async () => {
  for (const distro of ['alpine', 'debian', 'ubuntu']) {
    const f = fixture(); f.setDistro(distro);
    f.workspaces.config = async () => { throw new Error('Administrator install must not load project config'); };
    f.workspaces.resolveProject = async () => { throw new Error('Administrator install must not resolve project env'); };
    f.workspaces.networkEnvironment = async () => ({ HTTPS_PROXY: 'http://admin-proxy:3128',
      https_proxy: 'http://admin-proxy:3128', PATH: '/workspace/hostile', HOME: '/workspace/hostile',
      APT_CONFIG: '/workspace/hostile/apt.conf', ENV: '/workspace/hostile/.shrc',
      LD_PRELOAD: '/workspace/hostile/preload.so', PYTHONPATH: '/workspace/hostile', NPM_CONFIG_REGISTRY: 'http://unused' });
    const job = await f.tools.install(id, { tools: ['git', 'python', 'git'] }); await f.tools.jobs.wait(id);
    assert.equal(job.status, 'done'); assert.equal(job.key, id); assert.equal(f.installs.length, 1); assert.equal(f.created(), 0);
    const [, , command, , , , , , options] = f.installs[0], body = options!.input!.toString();
    assert.match(command, /^exec \/usr\/bin\/env -i PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin HOME=\/ USER=root LOGNAME=root LANG=C LC_ALL=C \/bin\/sh -eu -s$/);
    assert.ok(!command.includes('admin-proxy')); assert.match(body, /^set -eu\ncd \/\n/);
    assert.ok(body.includes("export HTTPS_PROXY='http://admin-proxy:3128'"));
    assert.doesNotMatch(body, /hostile|NPM_CONFIG_REGISTRY|LD_PRELOAD|PYTHONPATH|APT_CONFIG/);
    assert.ok(body.includes(distro === 'alpine' ? '/sbin/apk add --no-cache --timeout 30 git python3 py3-pip' :
      '/usr/bin/apt-get -y install git python3 python3-pip python3-venv'));
    // The shell owns its bounded stdin body; package helpers must not consume
    // later script lines while installation is running.
    assert.equal(body.match(/<\/dev\/null/g)?.length, distro === 'alpine' ? 1 : 2);
    assert.deepEqual(f.rootCommands, []);
  }
});

test('administrator environment quoting and log redaction work across chunks and reject oversized/NUL values', async () => {
  const f = fixture(), proxy = "http://user:private-proxy-token@proxy/$(touch /root/marker)'";
  f.workspaces.networkEnvironment = async () => ({ HTTPS_PROXY: proxy });
  f.options.runInstallTask = async (...args) => {
    f.installs.push(args); args[4]!('error ' + proxy.slice(0, 20)); args[4]!(proxy.slice(20) + '\n');
    return { code: 0, stdout: '', stderr: '' };
  };
  const job = await f.tools.install(id, { tools: ['node'] }); await f.tools.jobs.wait(id);
  assert.equal(job.status, 'done'); assert.ok(job.log.includes('[私密配置已隐藏]')); assert.ok(!job.log.includes('private-proxy-token'));
  assert.ok(!f.installs[0][2].includes(proxy));
  assert.ok(f.installs[0][8]!.input!.toString().includes("'\\''"));
  for (const value of ['x'.repeat(16385), 'nul\0value']) {
    const invalid = fixture(); invalid.workspaces.networkEnvironment = async () => ({ HTTPS_PROXY: value });
    await assert.rejects(invalid.tools.install(id, { tools: ['git'] }), (error: any) => error.status === 413 && error.code === 'GUEST_INPUT_INVALID');
    assert.equal(invalid.installs.length, 0); assert.equal(invalid.tools.jobs.list().length, 0);
  }
});

test('administrator install pins original Live/distro before async network resolution and accepted job execution', async () => {
  const stale = fixture(); stale.workspaces.networkEnvironment = async () => { stale.machines.live.set(id, {} as any); return {}; };
  await assert.rejects(stale.tools.install(id, { tools: ['git'] }), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(stale.installs.length, 0); assert.equal(stale.tools.jobs.list().length, 0);
  const distro = fixture(); distro.workspaces.networkEnvironment = async () => { distro.setDistro('alpine'); return {}; };
  const job = await distro.tools.install(id, { tools: ['git'] }); await distro.tools.jobs.wait(id);
  assert.equal(job.status, 'done'); assert.ok(distro.installs[0][8]!.input!.includes(Buffer.from('/usr/bin/apt-get')));
  const accepted = fixture();
  Jobs.instrument = async (_view, work) => { accepted.machines.live.set(id, {} as any); await work(); };
  try {
    const pending = await accepted.tools.install(id, { tools: ['git'] }); await accepted.tools.jobs.wait(id);
    assert.equal(pending.status, 'error'); assert.equal(pending.errorCode, 'PROJECT_IDENTITY_HOST_CHANGED'); assert.equal(accepted.installs.length, 0);
  } finally { Jobs.instrument = undefined; }
});

test('administrator cleanup 503 remains a durable error even when the job was cancelled', async () => {
  const f = fixture(); let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  f.options.runInstallTask = async (...args) => {
    started(); await new Promise<void>(resolve => args[3].addEventListener('abort', () => resolve(), { once: true }));
    throw new AppError('administrator cgroup cleanup unconfirmed', 503, 'GUEST_TASK_CLEANUP_FAILED');
  };
  const job = await f.tools.install(id, { tools: ['git'] }); await ready; f.tools.jobs.cancel(job.id!); await f.tools.jobs.wait(id);
  assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'GUEST_TASK_CLEANUP_FAILED');
  assert.deepEqual(f.rootCommands, []);
});

test('invalid tool input and stopped or missing original administrator instances do not launch a job', async () => {
  const invalid = fixture();
  for (const value of [{ tools: [] }, { tools: ['unknown'] }, { tools: ['git'], command: 'hostile' }])
    await assert.rejects(invalid.tools.install(id, value));
  for (const field of ['stopped', 'live'] as const) {
    const f = fixture(); if (field === 'stopped') f.setStatus('stopped'); else f.machines.live.delete(id);
    await assert.rejects(f.tools.install(id, { tools: ['git'] })); assert.equal(f.tools.jobs.list().length, 0);
  }
  assert.equal(invalid.installs.length, 0); assert.equal(invalid.created(), 0);
});
