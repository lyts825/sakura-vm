import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Files } from '../server/files.ts';
import type { projectIdentityTask } from '../server/project-run-scope.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-command-tasks-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { CommandPresets } = await import('../server/command-presets.ts');
const { Pipelines } = await import('../server/pipelines.ts');
const { AppError, vmDir } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
type Call = { project: any; execution: any; signal: AbortSignal;
  log?: (text: string) => void; timeout?: number; expectedLive: unknown };

async function fixture() {
  const id = randomUUID(), locks = new Machines({} as any), live = { status: 'running' };
  const commands: string[] = [], calls: Call[] = [];
  let status = 'running', migrations = 'null\n', resolveCount = 0;
  let resolveHook = async () => {};
  let execute = async (_call: Call) => ({ code: 0, stdout: '', stderr: '' });
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { id, distro: 'alpine', template: 'none' }]]),
    live: new Map([[id, live]]), get: () => ({ id, distro: 'alpine', template: 'none' }),
    state: () => status, locked: locks.locked.bind(locks),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.includes('project-directory-migrations')) return { code: 0, stdout: migrations, stderr: '' };
      if (command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS')) return { code: 0, stdout: 'absent\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  }) as any;
  await mkdir(vmDir(id), { recursive: true });
  const workspaces = new Workspaces(machines, { secrets: { resolve: async () => {
    ++resolveCount; await resolveHook(); return { TOKEN: 'private-project-token' };
  } } as any });
  const first = await workspaces.projects.create(id, 'Alpha', () => workspaces.save(id,
    { directory: '/workspace/alpha', networkIsolation: 'private',
      environment: { MESSAGE: 'captured' }, secrets: { TOKEN: 'project-token' } }).then(() => {}));
  const second = await workspaces.projects.create(id, 'Beta', () => workspaces.save(id,
    { directory: '/workspace/beta', environment: { MESSAGE: 'other' } }).then(() => {}));
  const scope = <T>(action: () => T) => workspaces.projects.inScope(id, first.active, action);
  const key = scope(() => workspaces.projects.key(id));
  const runTask: typeof projectIdentityTask = async (_transport, vmId, project, execution, signal, log,
    timeout, _agent, _afterCleanup, options) => {
    assert.ok(options?.expectedLive, 'task runner requires the exact prepared live instance');
    if (options?.expectedLive !== machines.live.get(vmId))
      throw new AppError('prepared live changed before admission', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    const call = { project, execution, signal, log, timeout, expectedLive: options.expectedLive };
    calls.push(call); return execute(call);
  };
  const commandsService = new CommandPresets(machines, workspaces, { runTask });
  const fileCalls: string[] = [];
  const files = { info: async (_vmId: string, path: string) => { fileCalls.push(path); return { size: 0 }; },
    download: async () => {} } as unknown as Files;
  const pipelines = new Pipelines(machines, workspaces, files, { runTask });
  const preset = (await scope(() => commandsService.save(id,
    { name: 'Build', command: 'printf "%s" "$TARGET"', parameters: [{ name: 'TARGET', value: 'default' }] })))[0];
  const pipeline = await scope(() => pipelines.save(id, { name: 'Release', steps: [
    { name: 'Compile', command: 'first-step', timeout: 7 },
    { name: 'Verify', command: 'second-step', timeout: 11 },
  ] }));
  return { id, key, live, machines, workspaces, commands, calls, scope, fileCalls, files,
    projectId: first.active, otherProjectId: second.active, preset, pipeline,
    commandsService, pipelines, resolveCount: () => resolveCount,
    execute: (action: typeof execute) => { execute = action; },
    resolving: (action: typeof resolveHook) => { resolveHook = action; },
    pause: () => { status = 'paused'; }, migration: (value: string) => { migrations = value; },
    bindingChange: () => scope(() => workspaces.save(id, { directory: '/workspace/moved', networkIsolation: 'private' })),
    close: async () => { await commandsService.close(); await pipelines.close(); await workspaces.close(); } };
}

test('saved commands use the captured project, protected payload, declared parameters and exact live instance', async () => {
  const f = await fixture();
  try {
    f.resolving(async () => { await f.workspaces.projects.update(f.id, f.otherProjectId); });
    f.execute(async call => { call.log?.('private-project-'); call.log?.('token\n'); return { code: 0, stdout: '', stderr: '' }; });
    const job = await f.scope(() => f.commandsService.run(f.id, f.preset.id, { TARGET: "x'; touch /tmp/unused; '" }));
    await f.commandsService.jobs.wait(f.key);
    assert.equal(job.status, 'done'); assert.equal(job.projectId, f.projectId);
    assert.equal(f.calls.length, 1); assert.equal(f.resolveCount(), 1);
    assert.equal(f.calls[0].project._workspace, f.projectId);
    assert.equal(f.calls[0].project.directory, '/workspace/alpha');
    assert.equal(f.calls[0].project.networkIsolation, 'private');
    assert.equal(f.calls[0].execution.environment.TOKEN, 'private-project-token');
    assert.match(f.calls[0].execution.command, /export TARGET='x'\\'';/);
    assert.equal(f.calls[0].expectedLive, f.live);
    assert.match(job.log, /私密配置已隐藏/); assert.ok(!job.log.includes('private-project-token'));
    assert.ok(!f.commands.some(command => /private-project-token|touch \/tmp\/unused/.test(command)));
  } finally { await f.close(); }
});

test('command cancellation holds its preparation lease until cleanup finishes and preserves a 503 failure', async () => {
  const f = await fixture(), started = gate(), cleanup = gate();
  try {
    f.execute(async call => {
      started.resolve(); await new Promise<void>(done => call.signal.addEventListener('abort', () => done(), { once: true }));
      await cleanup.promise;
      throw new AppError('private-project-token cleanup uncertain', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    });
    const job = await f.scope(() => f.commandsService.run(f.id, f.preset.id, {}));
    await started.promise; f.commandsService.jobs.cancel(f.key);
    await assert.rejects(f.bindingChange(), /请先结束此项目的终端或命令/);
    cleanup.resolve(); await f.commandsService.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    assert.ok(!job.error?.includes('private-project-token'));
    await f.bindingChange();
  } finally { cleanup.resolve(); await f.close(); }
});

test('ordinary command failures redact their message without changing the exit classification', async () => {
  const f = await fixture();
  try {
    f.execute(async () => ({ code: 9, stdout: '', stderr: 'private-project-token failed' }));
    const job = await f.scope(() => f.commandsService.run(f.id, f.preset.id, {}));
    await f.commandsService.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.match(job.error!, /私密配置已隐藏/);
    assert.equal(job.errorCode, undefined);
    await assert.rejects(f.scope(() => f.commandsService.run(f.id, f.preset.id, { UNKNOWN: 'value' })), /未声明/);
    assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});

test('a paused instance and unresolved directory migration cannot execute a saved command', async () => {
  const f = await fixture();
  try {
    f.migration('{"phase":"unknown"}\n');
    const job = await f.scope(() => f.commandsService.run(f.id, f.preset.id, {}));
    await f.commandsService.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.equal(f.calls.length, 0);
    f.pause();
    await assert.rejects(f.scope(() => f.commandsService.run(f.id, f.preset.id, {})), /请先启动/);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('instance replacement during secret resolution refuses command admission with its original identity error', async () => {
  const f = await fixture();
  try {
    f.resolving(async () => { f.machines.live.set(f.id, {}); });
    const job = await f.scope(() => f.commandsService.run(f.id, f.preset.id, {}));
    await f.commandsService.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('pipeline steps share one captured configuration and protected environment but retain separate task calls and timeouts', async () => {
  const f = await fixture();
  try {
    f.execute(async call => {
      if (f.calls.length === 1) await f.scope(() => f.workspaces.save(f.id,
        { directory: call.project.directory, networkIsolation: call.project.networkIsolation,
          environment: { MESSAGE: 'changed later' }, secrets: { TOKEN: 'different-reference' } }));
      call.log?.('private-project-token\n'); return { code: 0, stdout: '', stderr: '' };
    });
    const job = await f.scope(() => f.pipelines.run(f.id, f.pipeline.id));
    await f.pipelines.jobs.wait(f.key);
    assert.equal(job.status, 'done', job.error); assert.equal(f.calls.length, 2); assert.equal(f.resolveCount(), 1);
    assert.deepEqual(f.calls.map(call => call.timeout), [7000, 11000]);
    assert.deepEqual(f.calls.map(call => call.execution.command), ['first-step', 'second-step']);
    for (const call of f.calls) {
      assert.equal(call.project._workspace, f.projectId); assert.equal(call.execution.environment.MESSAGE, 'captured');
      assert.equal(call.execution.environment.TOKEN, 'private-project-token'); assert.equal(call.expectedLive, f.live);
    }
    const [run] = await f.scope(() => f.pipelines.runs(f.id));
    assert.equal(run.status, 'done'); assert.equal(run.projectId, f.projectId);
    assert.deepEqual(run.steps.map(step => step.status), ['done', 'done']);
    assert.ok(!run.steps.some(step => step.log.includes('private-project-token')));
    assert.ok(!f.commands.some(command => /first-step|second-step|private-project-token/.test(command)));
  } finally { await f.close(); }
});

test('a pipeline holds its binding across steps and artifact collection and releases it only after final persistence', async () => {
  const f = await fixture(), collecting = gate(), finish = gate();
  try {
    f.execute(async () => {
      await assert.rejects(f.bindingChange(), /请先结束此项目的终端或命令/);
      return { code: 0, stdout: '', stderr: '' };
    });
    f.files.info = async (_id: string, path: string) => {
      f.fileCalls.push(path); collecting.resolve(); await finish.promise;
      throw new AppError('artifact missing', 404);
    };
    await f.scope(() => f.pipelines.save(f.id, { ...f.pipeline, artifacts: ['output.txt'] }));
    const job = await f.scope(() => f.pipelines.run(f.id, f.pipeline.id));
    await collecting.promise;
    await assert.rejects(f.bindingChange(), /请先结束此项目的终端或命令/);
    finish.resolve(); await f.pipelines.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.deepEqual(f.fileCalls, ['/workspace/alpha/output.txt']);
    await f.bindingChange();
  } finally { finish.resolve(); await f.close(); }
});

test('pipeline cancellation with unconfirmed cleanup remains an error in both durable run and job after reload', async () => {
  const f = await fixture(), started = gate(), cleanup = gate();
  try {
    f.execute(async call => {
      started.resolve(); await new Promise<void>(done => call.signal.addEventListener('abort', () => done(), { once: true }));
      await cleanup.promise; throw new AppError('private-project-token cleanup uncertain', 503, 'GUEST_TASK_CLEANUP_FAILED');
    });
    const job = await f.scope(() => f.pipelines.run(f.id, f.pipeline.id));
    await started.promise; f.pipelines.jobs.cancel(f.key);
    await assert.rejects(f.bindingChange(), /请先结束此项目的终端或命令/);
    cleanup.resolve(); await f.pipelines.jobs.wait(f.key);
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'GUEST_TASK_CLEANUP_FAILED');
    const reloaded = new Pipelines(f.machines, f.workspaces, f.files);
    try {
      const [run] = await f.scope(() => reloaded.runs(f.id));
      assert.equal(run.status, 'error'); assert.equal(run.errorCode, 'GUEST_TASK_CLEANUP_FAILED');
      assert.equal(run.steps[0].status, 'error'); assert.equal(run.steps[0].errorCode, 'GUEST_TASK_CLEANUP_FAILED');
      assert.equal(run.steps[1].status, 'pending'); assert.ok(!JSON.stringify(run).includes('private-project-token'));
    } finally { await reloaded.close(); }
    assert.equal(f.calls.length, 1);
  } finally { cleanup.resolve(); await f.close(); }
});

test('closing the command service cancels its execution and drains exact cleanup before dropping the configuration guard', async () => {
  const f = await fixture(), started = gate(), cleaning = gate(), finish = gate();
  try {
    f.execute(async call => {
      started.resolve(); await new Promise<void>(done => call.signal.addEventListener('abort', () => done(), { once: true }));
      cleaning.resolve(); await finish.promise; throw call.signal.reason;
    });
    const job = await f.scope(() => f.commandsService.run(f.id, f.preset.id, {}));
    await started.promise; let closed = false;
    const closing = f.commandsService.close().then(() => { closed = true; });
    await cleaning.promise; assert.equal(closed, false);
    await assert.rejects(f.bindingChange(), /请先结束此项目的终端或命令/);
    finish.resolve(); await closing;
    assert.equal(job.status, 'cancelled'); await f.bindingChange();
  } finally { finish.resolve(); await f.close(); }
});

test('pipeline records stay in the original project when the saved active selection changes', async () => {
  const f = await fixture();
  try {
    f.resolving(async () => { await f.workspaces.projects.update(f.id, f.otherProjectId); });
    const job = await f.scope(() => f.pipelines.run(f.id, f.pipeline.id));
    await f.pipelines.jobs.wait(f.key);
    assert.equal(job.status, 'done'); assert.equal(job.projectId, f.projectId);
    assert.equal((await f.scope(() => f.pipelines.runs(f.id)))[0].projectId, f.projectId);
    assert.equal((await f.workspaces.projects.inScope(f.id, f.otherProjectId, () => f.pipelines.runs(f.id))).length, 0);
    const persisted = await readFile(f.scope(() => f.workspaces.projects.file(f.id, 'pipeline-runs')), 'utf8');
    assert.equal(JSON.parse(persisted)[0].status, 'done');
  } finally { await f.close(); }
});
