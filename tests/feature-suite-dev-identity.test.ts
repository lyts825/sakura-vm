import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectSchema, projectVersion } from '../server/workspaces.ts';
import { AppError, setVmStorageRoot } from '../server/model.ts';
import { Jobs } from '../server/jobs.ts';
import { FeatureSuite } from '../server/feature-suite.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import { scopeIdentityFixture } from './project-scope-identity-fixture.ts';
import { runFeatureDevTask, featureDevTaskCommand, type FeatureDevTaskOptions,
  type FeatureDevTaskInput } from '../server/feature-suite-dev-task.ts';

const id = '11111111-1111-4111-8111-111111111111', projectId = '0123456789abcdef';
function fixture() {
  const context = new AsyncLocalStorage<string>();
  let override: string | undefined, leaseOpen = false, releases = 0;
  const live = { startedAt: '2026-10-02T00:00:00Z' };
  const config = projectSchema.parse({ directory: '/srv/projects/original', template: 'none',
    networkIsolation: 'private', environment: { MODE: 'original' }, secrets: { TOKEN: 'fixture-token' } });
  Object.defineProperty(config, '_workspace', { value: projectId, enumerable: false });
  const clone = () => Object.defineProperty(structuredClone(config), '_workspace', { value: projectId, enumerable: false });
  const payloads: any[] = [], results: any[] = [], events: string[] = [], logs: string[] = [];
  const machines = { live: new Map([[id, live]]), state: () => 'running', get: () => ({ distro: 'alpine' }),
    requireUnlocked: () => {}, exec: async () => { throw new Error('Root project execution forbidden'); },
    writeGuestFile: async () => { throw new Error('Root project helper publication forbidden'); },
  } as unknown as Machines;
  const workspaces = { projects: {
    current: () => override || context.getStore() || projectId,
    key: () => id + ':' + (override || context.getStore() || projectId),
    inScope: (_id: string, scope: string, action: () => unknown) => context.run(scope, action),
  }, config: async () => clone(),
  resolvedConfig: async () => { throw new Error('Selected-project reread forbidden'); },
  resolveProject: async (_id: string, captured: typeof config) => {
    assert.equal(projectVersion(captured), projectVersion(config));
    return { ...captured, _workspace: (captured as typeof config & { _workspace?: string })._workspace,
      environment: { ...captured.environment, TOKEN: 'fixture-private-token' } };
  } } as unknown as Workspaces;
  const options: FeatureDevTaskOptions = { terminals: { prepare: async (_id, scope, session, readOnly, signal, _terminalId, mode) => {
    assert.equal(scope, projectId); assert.equal(session, null); assert.equal(readOnly, false);
    assert.deepEqual(mode, { mode: 'task' }); leaseOpen = true;
    return { command: 'unused', projectId, networkIsolation: 'private', signal: signal!, terminalId: undefined,
      captured: { project: clone(), configVersion: projectVersion(config), live: live as any },
      release: () => { leaseOpen = false; ++releases; events.push('release'); } };
  } }, runTask: async (_machines, _id, captured, execution, signal, log, timeout, _agent, _cleanup, pins) => {
    assert.ok(leaseOpen); assert.equal(captured._workspace, projectId);
    assert.equal(pins?.expectedLive, live); assert.equal(signal.aborted, false); assert.equal(timeout, 600000);
    projectIdentityPayload(execution); payloads.push({ captured, execution }); events.push('uid-task');
    log?.('fixture-private-token\n'); return { code: 0, stdout: 'result fixture-private-token', stderr: '' };
  } };
  const save = async (result: unknown) => { assert.ok(leaseOpen); results.push(result); events.push('save'); };
  const run = (input: FeatureDevTaskInput = { operation: 'test' }, signal = new AbortController().signal) =>
    runFeatureDevTask(machines, workspaces, id, input, signal, value => logs.push(value), save, options);
  return { run, save, options, machines, workspaces, live, config, payloads, results, events, logs,
    clone, leaseOpen: () => leaseOpen, releases: () => releases, switchScope: () => { override = 'fedcba9876543210'; } };
}

test('all nine finite dev operations use captured UID commands and protected project environment', async () => {
  for (const operation of ['test', 'test-discover', 'dependencies', 'lock', 'lock-check',
    'install-locked', 'worktree-list', 'worktree-add', 'worktree-remove'] as const) {
    const f = fixture(); await f.run({ operation, branch: 'feature/test', path: '.worktrees/test' });
    assert.equal(f.payloads.length, 1); assert.equal(f.releases(), 1);
    const { captured, execution } = f.payloads[0];
    assert.equal(captured._workspace, projectId); assert.equal(execution.environment.TOKEN, 'fixture-private-token');
    assert.match(execution.command, /^set -eu\ncd '\/srv\/projects\/original'\n/);
    assert.equal(execution.command.includes('export '), false); assert.equal(execution.command.includes('ip netns exec'), false);
  }
});

test('realistic non-enumerable named scope stays attached without changing the config fingerprint', async () => {
  const f = fixture(); assert.equal(Object.hasOwn(structuredClone(f.config), '_workspace'), false);
  await f.run(); const captured = f.payloads[0].captured;
  assert.equal(captured._workspace, projectId);
  assert.equal(Object.getOwnPropertyDescriptor(captured, '_workspace')?.enumerable, false);
  assert.equal(projectVersion(captured), projectVersion(f.config));
});

test('a wrong prepared named scope is rejected even when its serialized config fingerprint matches', async () => {
  const f = fixture(), prepare = f.options.terminals!.prepare;
  f.options.terminals!.prepare = async (...args) => {
    const result = await prepare(...args), wrong = Object.defineProperty(structuredClone(f.config), '_workspace',
      { value: 'fedcba9876543210', enumerable: false });
    assert.equal(projectVersion(wrong), projectVersion(f.config));
    return { ...result, captured: { ...result.captured!, project: wrong } };
  };
  await assert.rejects(f.run(), (e: any) => e.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.payloads.length, 0); assert.equal(f.releases(), 1);
});

test('caller mutation cannot change an already accepted worktree task', async () => {
  const f = fixture(), input: FeatureDevTaskInput = { operation: 'worktree-add', branch: 'original', path: 'trees/original' };
  const running = f.run(input); input.branch = 'changed'; input.path = 'trees/changed'; await running;
  assert.match(f.payloads[0].execution.command, /trees\/original' 'original'/);
  assert.equal(f.payloads[0].execution.command.includes('changed'), false);
});

test('original live replacement during prepare refuses execution and releases the lease', async () => {
  const f = fixture(), prepare = f.options.terminals!.prepare;
  f.options.terminals!.prepare = async (...args) => { const r = await prepare(...args); f.machines.live.set(id, {} as any); return r; };
  await assert.rejects(f.run(), (e: any) => e.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.payloads.length, 0); assert.equal(f.releases(), 1);
});

test('config changes after capture cannot authorize a newer preparation candidate', async () => {
  const f = fixture(), prepare = f.options.terminals!.prepare;
  f.options.terminals!.prepare = async (...args) => { f.config.environment = { MODE: 'changed' }; return prepare(...args); };
  await assert.rejects(f.run(), (e: any) => e.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.payloads.length, 0); assert.equal(f.releases(), 1);
});

test('cancellation while resolving the captured environment launches no code and releases its lease', async () => {
  const f = fixture(), abort = new AbortController(), resolve = f.workspaces.resolveProject;
  f.workspaces.resolveProject = async (...args) => { const r = await resolve(...args); abort.abort(); return r; };
  await assert.rejects(f.run({ operation: 'test' }, abort.signal));
  assert.equal(f.payloads.length, 0); assert.equal(f.results.length, 0); assert.equal(f.releases(), 1);
});

test('scope switch during execution prevents result publication into another project', async () => {
  const f = fixture(), runTask = f.options.runTask!;
  f.options.runTask = async (...args) => { const r = await runTask(...args); f.switchScope(); return r; };
  await assert.rejects(f.run(), (e: any) => e.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.results.length, 0); assert.equal(f.releases(), 1);
});

test('actual nonzero exit remains observable while output and errors are redacted', async () => {
  const f = fixture(), runTask = f.options.runTask!;
  f.options.runTask = async (...args) => { await runTask(...args); return { code: 7, stdout: 'fixture-private-token', stderr: 'failure fixture-private-token' }; };
  await assert.rejects(f.run(), /failure \[私密配置已隐藏\]/);
  assert.deepEqual(f.results, [{ code: 7, stdout: '[私密配置已隐藏]', stderr: 'failure [私密配置已隐藏]' }]);
  assert.equal(f.logs.join('').includes('fixture-private-token'), false);
  assert.deepEqual(f.events, ['uid-task', 'save', 'release']);
});

test('native cleanup 503 and exact code bypass result parsing and publication', async () => {
  const f = fixture(), error = new AppError('native cleanup pending', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  f.options.runTask = async () => { throw error; };
  await assert.rejects(f.run(), (e: any) => e === error && e.status === 503);
  assert.equal(f.results.length, 0); assert.equal(f.releases(), 1);
});

test('cancelled public Jobs keep cleanup failures as errors with the original cleanup code', async () => {
  const f = fixture(), abort = new AbortController();
  f.options.runTask = async () => { abort.abort(); throw new AppError('cleanup pending', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'); };
  const suite = new FeatureSuite(f.machines, f.workspaces, {}, f.options); suite.jobs = new Jobs();
  try {
    const job = suite.dev(id, { operation: 'test' }, abort.signal); await suite.jobs.wait(job.key!);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    assert.equal(job.result, undefined); assert.equal(f.releases(), 1);
  } finally { await suite.close(); }
});

test('result persistence retains the lease and persistence failure still releases it', async () => {
  const f = fixture();
  await assert.rejects(runFeatureDevTask(f.machines, f.workspaces, id, { operation: 'test' },
    new AbortController().signal, () => {}, async () => { assert.ok(f.leaseOpen()); throw new AppError('save failed', 507); }, f.options),
    (e: any) => e.status === 507);
  assert.equal(f.releases(), 1); assert.equal(f.payloads.length, 1);
});

test('a secondary release error cannot replace the original native cleanup 503', async () => {
  const f = fixture(), prepare = f.options.terminals!.prepare;
  const original = new AppError('native pending', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  f.options.runTask = async () => { throw original; };
  f.options.terminals!.prepare = async (...args) => ({ ...await prepare(...args), release: () => { throw new Error('secondary'); } });
  await assert.rejects(f.run(), (e: any) => e === original);
});

test('native environment entry, reserved identity keys and total bytes are bounded before launch', async () => {
  for (const environment of [{ HOME: '/untrusted' }, Object.fromEntries(Array.from({ length: 129 }, (_, i) => ['K' + i, 'x'])),
    { TOKEN: 'x'.repeat(8193) }, Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['K' + i, '中'.repeat(300)]))]) {
    const f = fixture(); f.workspaces.resolveProject = async () => ({ ...f.config, _workspace: projectId, environment });
    await assert.rejects(f.run()); assert.equal(f.payloads.length, 0); assert.equal(f.releases(), 1);
  }
});

test('finite commands reject unknown operations and worktree traversal before guest execution', async () => {
  const f = fixture();
  for (const input of [{ operation: 'unknown' }, { operation: 'worktree-add', branch: '-malicious', path: 'tree' },
    { operation: 'worktree-remove', path: '../other' }, { operation: 'worktree-add', branch: 'safe', path: '/absolute' }])
    await assert.rejects(f.run(input as FeatureDevTaskInput));
  assert.equal(f.payloads.length, 0);
  const command = featureDevTaskCommand({ ...f.config, directory: '/srv/$(printf exploit)' }, { operation: 'lock' });
  assert.match(command, /'project=\/srv\/\$\(printf exploit\)'/);
  assert.match(featureDevTaskCommand(f.config, { operation: 'test-discover' }), /\\\( -name \.git/);
});

test('real host journal and binary frames retain the named task identity through issuance and full cleanup', async () => {
  const f = fixture(), vmId = randomUUID(), boot = randomUUID(), folder = await mkdtemp(join(tmpdir(), 'sakura-feature-dev-'));
  const commands: string[] = [];
  f.machines.live = new Map([[vmId, f.live as any]]);
  f.machines.locked = async (_key, action) => action();
  f.machines.exec = async (_id, command) => { commands.push(command); return { code: 0, stdout: '', stderr: '' }; };
  setVmStorageRoot(vmId, folder);
  const identity = scopeIdentityFixture(f.machines, f.config, () => boot, () => null);
  const native = f.machines.execInput;
  f.machines.execInput = async (...args) => { const r = await native(...args); return { ...r, stdout: 'actual-result' }; };
  delete f.options.runTask;
  try {
    await runFeatureDevTask(f.machines, f.workspaces, vmId, { operation: 'test' }, new AbortController().signal,
      () => {}, f.save, f.options);
    assert.equal(identity.inputs.length, 1); assert.equal(identity.tickets.size, 1);
    const ticket = [...identity.tickets.values()][0]; assert.equal(ticket.projectId, projectId); assert.equal(ticket.phase, 'closed');
    assert.equal(ticket.cgroupName, 'sakura-task-' + ticket.runId);
    assert.equal(identity.inputs[0].readUInt16LE(10), 0);
    assert.ok(commands.every(command => !command.includes('fixture-private-token') && !command.includes('npm test')));
    const journal = JSON.parse(await readFile(join(folder, vmId, 'project-identities', projectId + '.json'), 'utf8'));
    assert.equal(journal.runs[0].identity.projectId, projectId); assert.equal(journal.runs[0].phase, 'closed');
  } finally { setVmStorageRoot(vmId); await rm(folder, { recursive: true, force: true }); }
});

test('public suite close cancels the UID task and waits for the preparation lease release', async () => {
  const f = fixture(); let began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
  f.options.runTask = async (_m, _i, _p, _e, signal) => {
    began(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    signal.throwIfAborted(); throw new Error('unreachable');
  };
  const suite = new FeatureSuite(f.machines, f.workspaces, {}, f.options); suite.jobs = new Jobs();
  const job = suite.dev(id, { operation: 'test' }); await started; await suite.close();
  assert.equal(job.status, 'cancelled'); assert.equal(f.releases(), 1); assert.equal(f.leaseOpen(), false);
});
