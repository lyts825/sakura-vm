import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PluginContext } from '../server/plugin-api.ts';
import type { JobView } from '../server/jobs.ts';

const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, 'sakura-ime-project-'));
process.env.SAKURA_DATA_DIR = root;
const { Jobs } = await import('../server/jobs.ts');
const { AppError } = await import('../server/model.ts');
const { activate, installIme } = await import('../plugins/desktop/server.ts');
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), parent); assert.match(basename(owned), /^sakura-ime-project-/);
  await rm(owned, { recursive: true, force: true });
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(t: TestContext) {
  const id = randomUUID(), context = new AsyncLocalStorage<string>();
  let selected = 'alpha';
  const live = new Map([[id, { status: 'running', startedAt: 'original-boot' }]]), calls: string[] = [];
  const jobs = new Jobs();
  const workspaces = { projects: {
    current: () => context.getStore() || selected,
    inScope: <T>(_id: string, project: string, action: () => Promise<T>) => context.run(project, action),
  } };
  const machines = Object.assign(new EventEmitter(), { live,
    state: () => live.get(id)?.status || 'stopped',
    exec: () => { throw new Error('The IME route must use the Desktop lifecycle'); },
  });
  const host = { machines, workspaces, jobs, desktops: { installIme: async (_id: string, signal: AbortSignal,
    log: (text: string) => void) => {
      signal.throwIfAborted(); calls.push(workspaces.projects.current()); log('安装完成\n');
      return { code: 0, stdout: '', stderr: '' };
    } } } as unknown as PluginContext;
  t.after(() => jobs.close());
  return { id, host, jobs, workspaces, live, calls, select: (project: string) => { selected = project; } };
}

test('queued IME work keeps its original project after the user selects another project', async t => {
  const f = fixture(t), queued = gate();
  const flush = f.jobs.flush.bind(f.jobs); let first = true;
  f.jobs.flush = async () => { if (first) { first = false; await queued.promise; } await flush(); };
  const view = installIme.call(f.host, f.id);
  f.select('beta'); queued.resolve(); await f.jobs.wait(f.id);
  assert.equal(view.projectId, 'alpha'); assert.equal(view.status, 'done');
  assert.deepEqual(f.calls, ['alpha']); assert.equal(f.workspaces.projects.current(), 'beta');
});

test('a replacement live is refused before a queued IME operation can start', async t => {
  const f = fixture(t), view = installIme.call(f.host, f.id);
  f.live.set(f.id, { status: 'running', startedAt: 'replacement-boot' });
  await f.jobs.wait(f.id);
  assert.deepEqual(f.calls, []); assert.equal(view.status, 'error');
  assert.equal(view.errorCode, 'DESKTOP_SCOPE_CHANGED');
});

test('a replacement live during IME installation cannot report success for the new guest', async t => {
  const f = fixture(t), entered = gate(), finished = gate();
  f.host.desktops.installIme = async () => {
    f.calls.push(f.workspaces.projects.current()); entered.resolve(); await finished.promise;
    return { code: 0, stdout: '', stderr: '' };
  };
  const view = installIme.call(f.host, f.id); await entered.promise;
  f.live.set(f.id, { status: 'running', startedAt: 'replacement-boot' }); finished.resolve();
  await f.jobs.wait(f.id);
  assert.deepEqual(f.calls, ['alpha']); assert.equal(view.status, 'error');
  assert.equal(view.errorCode, 'DESKTOP_SCOPE_CHANGED');
});

test('cancelled IME cleanup failure remains visible as an error in the public job', async t => {
  const f = fixture(t), entered = gate();
  f.host.desktops.installIme = async (_id, signal) => {
    const aborted = new Promise<void>(done => signal.addEventListener('abort', () => done(), { once: true }));
    entered.resolve(); await aborted;
    throw new AppError('原桌面清理未确认', 503, 'DESKTOP_CLEANUP_FAILED');
  };
  const view = installIme.call(f.host, f.id); await entered.promise;
  f.jobs.cancel(f.id); await f.jobs.wait(f.id);
  assert.equal(view.status, 'error'); assert.equal(view.errorCode, 'DESKTOP_CLEANUP_FAILED');
  assert.equal(view.error, '原桌面清理未确认');
});

test('registered IME retry restores the saved project before capturing its new task', async t => {
  const f = fixture(t), callbacks = new Map<string, (job: JobView) => unknown>();
  const activation = {
    machines: Object.assign(new EventEmitter(), { live: new Map() }),
    provide: (_key: string, service: unknown) => service,
    registerJobs: (jobs: InstanceType<typeof Jobs>, retry: (job: JobView) => unknown) =>
      callbacks.set(jobs === activation.jobs ? 'ime' : randomUUID(), retry),
  } as unknown as PluginContext;
  await activate(activation);
  const installed = activation.desktops, jobStore = activation.jobs;
  t.after(async () => { await installed.close(); await jobStore.close(); });
  activation.machines = f.host.machines; activation.workspaces = f.host.workspaces;
  activation.desktops = f.host.desktops; activation.jobs = f.jobs;
  f.select('beta');
  const retried = await callbacks.get('ime')!({ key: f.id, vmId: f.id, projectId: 'alpha',
    status: 'error', log: '', startedAt: new Date().toISOString() }) as JobView;
  await f.jobs.wait(f.id);
  assert.equal(retried.projectId, 'alpha'); assert.equal(retried.status, 'done');
  assert.deepEqual(f.calls, ['alpha']); assert.equal(f.workspaces.projects.current(), 'beta');
});
