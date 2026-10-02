import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  featureCatalogView,
  implementedFeatureCatalogView,
  resourcePresets,
  FeatureSuite,
} from '../server/feature-suite.ts';
import { projectSchema, projectVersion } from '../server/workspaces.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import { Jobs } from '../server/jobs.ts';
import type { Machines } from '../server/machines.ts';
import type { Workspaces, Project } from '../server/workspaces.ts';
import type { ProjectTerminals } from '../server/project-terminals.ts';
import { AppError, setVmStorageRoot } from '../server/model.ts';
import { scopeIdentityFixture } from './project-scope-identity-fixture.ts';

test('feature suite exposes the complete six-category roadmap', () => {
  const features = featureCatalogView();
  assert.equal(features.length, 50);
  assert.equal(new Set(features.map((feature) => feature.id)).size, 50);
  assert.equal(new Set(features.map((feature) => feature.category)).size, 6);
  assert.ok(features.every((feature) => ['P0', 'P1', 'P2'].includes(feature.priority)));
  assert.ok(features.some((feature) => feature.id === 'metrics-history' && feature.state === 'available'));
  assert.ok(features.some((feature) => feature.id === 'dynamic-memory' && feature.state === 'available'));
  assert.ok(features.some((feature) => feature.id === 'test-explorer' && feature.state === 'available'));
  assert.ok(features.some((feature) => feature.id === 'gpu-acceleration' && feature.state === 'available'));
  assert.deepEqual(implementedFeatureCatalogView(), features);
  assert.ok(features.some((feature) => feature.id === 'single-app-windows' &&
    feature.implemented && feature.state === 'available'));
});

test('resource presets stay within the VM configuration limits', () => {
  assert.deepEqual(Object.keys(resourcePresets), ['light', 'development', 'build', 'desktop']);
  assert.ok(
    Object.values(resourcePresets).every((preset) => preset.memoryMiB >= 256 && preset.memoryMiB <= 8192),
  );
  assert.ok(Object.values(resourcePresets).every((preset) => preset.cpus >= 1 && preset.cpus <= 8));
});

test('private finite developer tasks use captured UID contracts and reject shared-network containers', async () => {
  const commands: string[] = [];
  const project = projectSchema.parse({ directory: '/workspace/app', networkIsolation: 'private', environment: {} });
  const live = { startedAt: 'fixture' }, uidCommands: string[] = [];
  const machines = {
    get: () => ({ distro: 'alpine' }),
    live: new Map([['vm', live]]), state: () => 'running',
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  const workspaces = { projects: { key: () => 'vm', current: () => 'default',
    inScope: (_id: string, _scope: string, action: () => unknown) => action() },
    config: async () => project, resolveProject: async () => project,
    resolvedConfig: async () => project } as unknown as Workspaces;
  const suite = new FeatureSuite(machines, workspaces, {}, {
    cacheTransfers: { allocate: async () => ({ stageId: '11111111-1111-4111-8111-111111111111',
      directory: '/run/sakura-project-cache-transfers/11111111-1111-4111-8111-111111111111/data',
      resource: { descriptor: { stageId: '11111111-1111-4111-8111-111111111111', manager: 'npm', build: 'a'.repeat(64) },
        prepare: async () => {}, retire: async () => {} } }) },
    terminals: { prepare: async (_id, scope, _session, _readOnly, signal) => ({
      command: 'unused', projectId: scope!, networkIsolation: 'private', terminalId: undefined, signal: signal!,
      captured: { project, configVersion: projectVersion(project), live: live as any }, release: () => {},
    }) }, runTask: async (_machines, _id, captured, execution, _signal, _log, _timeout, _agent, _cleanup, pins) => {
      assert.equal(captured.networkIsolation, 'private'); assert.equal(pins?.expectedLive, live);
      projectIdentityPayload(execution); uidCommands.push(execution.command);
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  suite.jobs = new Jobs();
  try {
    suite.dev('vm', { operation: 'test-discover' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'done');
    assert.match(uidCommands[0], /find \. -type d/);
    assert.equal(commands.length, 0);
    suite.dev('vm', { operation: 'install-cached-dependencies', manager: 'npm' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'done');
    assert.match(uidCommands[1], /npm ci --offline --ignore-scripts/);
    assert.equal(commands.length, 0);
    suite.dev('vm', { operation: 'install-locked' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'done');
    assert.match(uidCommands[2], /npm ci/);
    suite.dev('vm', { operation: 'database', database: 'redis',
      password: 'very-long-password' });
    await suite.jobs.wait('vm:dev');
    assert.equal(suite.jobs.view('vm:dev')?.status, 'error');
    assert.match(suite.jobs.view('vm:dev')?.error || '', /私有数据库需要启用容器插件/);
    assert.equal(commands.length, 0);
    assert.equal(uidCommands.length, 3);
  } finally { await suite.close(); }
});

async function dispatchFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sakura-feature-dispatch-')), id = randomUUID(), bootId = randomUUID();
  const projectId = '0123456789abcdef', otherId = 'fedcba9876543210', live = { status: 'running' };
  let selected = projectId, override: string | undefined, held = false, releases = 0;
  const context = new AsyncLocalStorage<string>(), commands: string[] = [], events: string[] = [], failures: any[] = [];
  const project = Object.defineProperty(projectSchema.parse({ directory: '/srv/named-project', template: 'none',
    networkIsolation: 'private', environment: { PATH: '/project/hook/bin', MODE: 'named' }, secrets: { TOKEN: 'project-private-token' } }),
    '_workspace', { value: projectId, enumerable: false }) as Project;
  const current = () => override || context.getStore() || selected;
  const clone = () => Object.defineProperty(structuredClone(project), '_workspace', { value: current(), enumerable: false });
  const machines = { live: new Map([[id, live]]), state: () => 'running', get: () => ({ distro: 'alpine', forwards: [] }),
    requireUnlocked: () => {}, locked: async (_key: string, action: () => unknown) => action(),
    writeGuestFile: async () => assert.fail('No root helper publication'),
    exec: async (_id: string, command: string) => { commands.push(command); return { code: 0, stdout: '', stderr: '' }; },
  } as unknown as Machines;
  const workspaces = { projects: { current, key: () => id + ':' + current(),
    inScope: (_id: string, scope: string, action: () => unknown) => context.run(scope, action) },
    config: async () => clone(), resolvedConfig: async () => assert.fail('No selected resolved-config reread'),
    resolveProject: async (_id: string, captured: typeof project) => {
      assert.equal(captured._workspace, projectId); assert.equal(Object.getOwnPropertyDescriptor(captured, '_workspace')?.enumerable, false);
      return { ...captured, environment: { ...captured.environment, TOKEN: 'project-private-token' } };
    },
  } as unknown as Workspaces;
  setVmStorageRoot(id, root);
  const native = scopeIdentityFixture(machines, project, () => bootId, () => null), execInput = machines.execInput.bind(machines);
  const state = { code: 0, afterExecute: () => {}, afterLock: () => {}, save: () => {} };
  machines.execInput = async (...args: Parameters<Machines['execInput']>) => {
    assert.ok(held); events.push('uid-task');
    const result = await execInput(...args); state.afterExecute();
    return { ...result, code: state.code, stdout: JSON.stringify({ code: state.code, operation: 'format-lint', stdout: 'project-private-token' }) };
  };
  machines.locked = async (_key, action) => { state.afterLock(); return action(); };
  const terminals = { prepare: async (_id: string, scope: string, session: null, readOnly: boolean, signal: AbortSignal,
    _terminalId: unknown, mode: unknown) => {
    assert.equal(scope, projectId); assert.equal(current(), projectId); assert.equal(session, null); assert.equal(readOnly, false);
    assert.deepEqual(mode, { mode: 'task' }); held = true;
    return { command: 'unused', projectId, networkIsolation: 'private', terminalId: undefined, signal,
      captured: { project: clone(), configVersion: projectVersion(project), live },
      release: () => { events.push('release'); held = false; ++releases; } };
  } } as unknown as ProjectTerminals;
  const suite = new FeatureSuite(machines, workspaces); suite.setProjectTerminals(terminals); suite.jobs = new Jobs();
  const start = suite.jobs.start.bind(suite.jobs);
  suite.jobs.start = (key, work, meta) => start(key, async (log, signal, update, save) => {
    try { await work(log, signal, update, async value => {
      assert.ok(held, 'Engineering result must be saved before lease release'); assert.equal(current(), projectId);
      events.push('save'); await save(value); state.save();
    }); } catch (error) { failures.push(error); throw error; }
  }, meta);
  return { suite, machines, workspaces, project, id, projectId, live, native, state, commands, events, failures,
    key: id + ':' + projectId + ':dev', selectOther: () => { selected = otherId; }, forceOther: () => { override = otherId; },
    held: () => held, releases: () => releases, journal: async () => JSON.parse(await readFile(join(root, id, 'project-identities', projectId + '.json'), 'utf8')),
    dispose: async () => { await suite.close(); setVmStorageRoot(id); await rm(root, { recursive: true, force: true }); } };
}

test('lint and format preserve the submitted named scope and save public results while the engineering lease is held', async () => {
  for (const operation of ['lint', 'format'] as const) {
    const f = await dispatchFixture();
    try {
      const job = f.suite.dev(f.id, { operation }); f.selectOther(); await f.suite.jobs.wait(f.key);
      assert.equal(job.status, 'done', job.error); assert.equal(job.projectId, f.projectId);
      assert.deepEqual(f.events, ['uid-task', 'save', 'release']); assert.equal(f.releases(), 1);
      const result: any = await f.suite.jobs.result(job.id!);
      assert.deepEqual(result, { code: 0, operation: 'format-lint', stdout: '[私密配置已隐藏]', ready: true, executed: true });
      const journal = await f.journal(); assert.equal(journal.runs[0].projectId, f.projectId);
      assert.equal(journal.runs[0].run.cgroupInode, '23456'); assert.equal(journal.runs[0].phase, 'closed');
      assert.ok(f.commands.every(command => !command.includes('project-private-token') && !command.includes('/project/hook/bin')));
      assert.equal(f.native.inputs.length, 1); assert.equal(f.held(), false);
    } finally { await f.dispose(); }
  }
});

test('a queued lint job rejects a changed original live before preparation or protected execution', async () => {
  const f = await dispatchFixture();
  try {
    f.state.afterLock = () => { f.machines.live.set(f.id, {} as any); };
    const job = f.suite.dev(f.id, { operation: 'lint' }); await f.suite.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.native.inputs.length, 0); assert.equal(f.releases(), 0); assert.deepEqual(f.events, []);
  } finally { await f.dispose(); }
});

test('format cancellation and scope changes after UID execution refuse result publication while closing the original native task', async () => {
  for (const failure of ['cancel', 'scope-switch'] as const) {
    const f = await dispatchFixture(), abort = new AbortController();
    try {
      f.state.afterExecute = () => { if (failure === 'cancel') abort.abort(); else f.forceOther(); };
      const job = f.suite.dev(f.id, { operation: 'format' }, abort.signal); await f.suite.jobs.wait(f.key);
      assert.equal(job.status, 'error'); assert.equal(job.result, undefined);
      assert.equal(f.releases(), 1); assert.equal(f.events.includes('save'), false);
      assert.equal((await f.journal()).runs[0].phase, 'closed');
      if (failure === 'scope-switch') assert.equal(job.errorCode, 'PROJECT_IDENTITY_HOST_CHANGED');
    } finally { await f.dispose(); }
  }
});

test('engineering cleanup 503 survives the lint dispatcher without JSON parsing or successful-result replacement', async () => {
  const f = await dispatchFixture();
  try {
    f.native.state.stopFailures = 100;
    const job = f.suite.dev(f.id, { operation: 'lint' }); await f.suite.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    assert.equal(f.failures[0].status, 503); assert.equal(job.result, undefined); assert.equal(f.releases(), 1);
    assert.equal((await f.journal()).runs[0].phase, 'active');
  } finally { await f.dispose(); }
});

test('actual engineering nonzero exits remain in the stored lint result after lease-bound saving', async () => {
  const f = await dispatchFixture();
  try {
    f.state.code = 7;
    const job = f.suite.dev(f.id, { operation: 'lint' }); await f.suite.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.equal((await f.suite.jobs.result(job.id!) as any).code, 7);
    assert.deepEqual(f.events, ['uid-task', 'save', 'release']); assert.equal(f.failures[0].status, 409);
    assert.equal(job.log.includes('project-private-token'), false);
  } finally { await f.dispose(); }
});

test('explicit database management stays in the original project with a fixed root environment and rejects unknown database names', async () => {
  const f = await dispatchFixture();
  try {
    assert.throws(() => f.suite.dev(f.id, { operation: 'database', database: 'unknown' as any, password: 'safe-long-password' }));
    const managed: string[] = [], failure = new AppError('management cleanup pending', 503, 'GUEST_TASK_CLEANUP_FAILED');
    const suite = new FeatureSuite(f.machines, f.workspaces, { privateDatabase: async () => {
      managed.push(f.workspaces.projects.current(f.id)); throw failure;
    } }); suite.jobs = new Jobs();
    try {
      const job = suite.dev(f.id, { operation: 'database', database: 'redis', password: 'safe-long-password' });
      f.selectOther(); await suite.jobs.wait(f.key);
      assert.deepEqual(managed, [f.projectId]); assert.equal(job.errorCode, failure.code);
      assert.equal(f.native.inputs.length, 0);
    } finally { await suite.close(); }
    f.project.networkIsolation = 'host';
    const job = f.workspaces.projects.inScope(f.id, f.projectId, () =>
      f.suite.dev(f.id, { operation: 'database', database: 'redis', password: 'safe-long-password' }));
    f.selectOther(); await f.suite.jobs.wait(f.key);
    assert.equal(job.status, 'done', job.error); assert.equal(job.projectId, f.projectId);
    const administrative = f.commands.find(command => command.includes('docker run -d'));
    assert.ok(administrative); assert.match(administrative, /\/usr\/bin\/env -i HOME=\/ USER=root LOGNAME=root PATH=\/usr\/sbin:/);
    assert.equal(administrative.includes('/project/hook/bin'), false); assert.equal(administrative.includes('project-private-token'), false);
    assert.equal(administrative.includes('cd /srv/named-project'), false); assert.equal(f.native.inputs.length, 0);
  } finally { await f.dispose(); }
});
