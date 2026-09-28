import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'sakura-build-farm-test-'));
process.env.SAKURA_DATA_DIR = root;
const { BuildFarm } = await import('../server/build-farm.ts');
const { Jobs } = await import('../server/jobs.ts');
after(() => rm(root, { recursive: true, force: true }));

const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 20));
  assert.ok(predicate(), 'condition did not become true');
};
const build = (name: string, labels: string[] = []) => ({ name,
  command: `printf ${name}`, cwd: '/workspace', labels, timeoutSeconds: 30 });

test('build farm persists a queued build, dispatches to a matching running VM and records the result', async () => {
  const vmId = randomUUID();
  const vm = { id: vmId, name: 'builder-1' };
  let status = 'stopped';
  const calls: { id: string; command: string }[] = [];
  const machines = { records: new Map([[vmId, vm]]), get: () => vm,
    state: () => status,
    exec: async (id: string, command: string, _timeout: number, _signal: AbortSignal,
      output: (value: string) => void) => {
      calls.push({ id, command });
      output('compiled\n');
      return { code: 0, stdout: 'compiled\n', stderr: '' };
    } } as any;
  const file = join(root, 'farm-one.json');
  let farm = new BuildFarm(machines, file, undefined, undefined,
    new Jobs('farm-one', join(root, 'jobs')));
  await farm.init();
  const saved = await farm.action({ operation: 'save-node', node: {
    vmId, slots: 1, labels: ['linux', 'typescript'], enabled: true } });
  assert.equal((saved as { vmId: string }).vmId, vmId);
  const queued = (await farm.action({ operation: 'submit',
    build: build('compile', ['typescript']) })) as { id: string };
  assert.equal(farm.view().tasks[0].status, 'queued');
  assert.equal(calls.length, 0);
  await farm.close();
  farm = new BuildFarm(machines, file, undefined, undefined,
    new Jobs('farm-one', join(root, 'jobs')));
  await farm.init();
  try {
    assert.equal(farm.view().tasks[0].id, queued.id);
    status = 'running';
    await waitFor(() => farm.view().tasks[0].status === 'done');
    assert.deepEqual(calls, [{ id: vmId, command: "cd '/workspace' && printf compile" }]);
    assert.match(farm.view().tasks[0].job?.log || '', /compiled/);
    const another = (await farm.action({ operation: 'submit',
      build: build('second', ['linux']) })) as { id: string };
    await waitFor(() => farm.view().tasks[0].id === another.id &&
      farm.view().tasks[0].status === 'done');
    assert.equal(farm.view().tasks.length, 2);
  } finally { await farm.close(); }
});

test('build farm uses two nodes concurrently, keeps excess work queued and cancels a running build', async () => {
  const ids = [randomUUID(), randomUUID()];
  const records = new Map<string, { id: string; name: string }>(
    ids.map((id, index) => [id, { id, name: `builder-${index}` }]));
  const started: string[] = [];
  const releases: Array<() => void> = [];
  const machines = { records,
    get: (id: string) => records.get(id), state: () => 'running',
    exec: (id: string, _command: string, _timeout: number, signal: AbortSignal,
      output: (value: string) => void) => new Promise((resolve, reject) => {
      started.push(id);
      const release = () => { output('ok\n'); resolve({ code: 0, stdout: 'ok\n', stderr: '' }); };
      releases.push(release);
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }),
  } as any;
  const farm = new BuildFarm(machines, join(root, 'farm-two.json'), undefined, undefined,
    new Jobs('farm-two', join(root, 'jobs')));
  await farm.init();
  try {
    for (const vmId of ids) await farm.action({ operation: 'save-node', node: {
      vmId, slots: 1, labels: ['node'], enabled: true } });
    for (const name of ['one', 'two', 'three'])
      await farm.action({ operation: 'submit', build: build(name, ['node']) });
    await waitFor(() => started.length === 2);
    assert.equal(new Set(started).size, 2);
    assert.equal(farm.view().tasks.filter((task) => task.status === 'queued').length, 1);
    const first = farm.view().tasks.find((task) => task.name === 'one')!;
    await farm.action({ operation: 'cancel', id: first.id });
    await waitFor(() => farm.view().tasks.find((task) => task.id === first.id)?.status === 'cancelled');
    await waitFor(() => started.length === 3);
    for (const release of releases) release();
    await waitFor(() => farm.view().tasks.filter((task) => task.status === 'done').length === 2);
    assert.equal(farm.view().tasks.filter((task) => task.status === 'cancelled').length, 1);
    await assert.rejects(farm.action({ operation: 'retry', id: farm.view().tasks.find((task) =>
      task.status === 'done')!.id }), /只有失败或中断/);
    const retry = await farm.action({ operation: 'retry', id: first.id }) as { retryOf: string };
    assert.equal(retry.retryOf, first.id);
  } finally { await farm.close(); }
});

test('failed guest exit is retained, retry creates a new build, and shutdown does not replay it', async () => {
  const vmId = randomUUID(), vm = { id: vmId, name: 'builder-failure' };
  let code = 7;
  const machines = { records: new Map([[vmId, vm]]), get: () => vm,
    state: () => 'running', exec: async () => ({ code, stdout: '', stderr: 'compile failed' }) } as any;
  const file = join(root, 'farm-failure.json');
  let farm = new BuildFarm(machines, file, undefined, undefined,
    new Jobs('farm-failure', join(root, 'jobs')));
  await farm.init();
  await farm.action({ operation: 'save-node', node: {
    vmId, slots: 1, labels: [], enabled: true } });
  const original = (await farm.action({ operation: 'submit',
    build: build('compile') })) as { id: string };
  await waitFor(() => farm.view().tasks.find((task) => task.id === original.id)?.status === 'error');
  const first = farm.view().tasks.find((task) => task.id === original.id)!;
  assert.match(first.error || '', /退出码 7/);
  assert.deepEqual(await farm.jobs.result(first.jobId!), {
    exitCode: 7, vmId, stdout: '', stderr: 'compile failed' });
  code = 0;
  const retry = await farm.action({ operation: 'retry', id: original.id }) as { id: string };
  await waitFor(() => farm.view().tasks.find((task) => task.id === retry.id)?.status === 'done');
  await farm.close();
  farm = new BuildFarm(machines, file, undefined, undefined,
    new Jobs('farm-failure', join(root, 'jobs')));
  await farm.init();
  try {
    assert.equal(farm.view().tasks.find((task) => task.id === original.id)?.status, 'error');
    assert.equal(farm.view().tasks.find((task) => task.id === retry.id)?.status, 'done');
    assert.equal(farm.view().tasks.length, 2);
  } finally { await farm.close(); }
});
