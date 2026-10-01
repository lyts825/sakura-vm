import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

const root = await mkdtemp(join(tmpdir(), 'sakura-build-farm-test-'));
process.env.SAKURA_DATA_DIR = root;
const { BuildFarm } = await import('../server/build-farm.ts');
const { Jobs } = await import('../server/jobs.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { ProjectTerminals } = await import('../server/project-terminals.ts');
const { vmDir } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 20));
  assert.ok(predicate(), 'condition did not become true');
};
const build = (name: string, labels: string[] = []) => ({ name,
  command: `printf ${name}`, cwd: '/workspace', labels, timeoutSeconds: 30 });
function guest(records: Map<string, { id: string; name: string }>, state: () => string,
  execute: (...args: any[]) => Promise<any>) {
  const locks = new Machines({} as any);
  const commands: string[] = [];
  return Object.assign(new EventEmitter(), { records,
    commands,
    live: new Map([...records.keys()].map((id) => [id, {}])),
    get: (id: string) => records.get(id), state, locked: locks.locked.bind(locks),
    exec: (...args: any[]) => {
      commands.push(args[1]);
      return args[1].includes('setsid sh -c') ? execute(...args)
        : Promise.resolve({ code: 0, stdout: '', stderr: '' });
    },
  }) as any;
}

test('build farm persists a queued build, dispatches to a matching running VM and records the result', async () => {
  const vmId = randomUUID();
  const vm = { id: vmId, name: 'builder-1' };
  let status = 'stopped';
  const calls: { id: string; command: string }[] = [];
  const machines = guest(new Map([[vmId, vm]]), () => status,
    async (id: string, command: string, _timeout: number, _signal: AbortSignal,
      output: (value: string) => void) => {
      calls.push({ id, command });
      output('compiled\n');
      return { code: 0, stdout: 'compiled\n', stderr: '' };
    });
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
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, vmId);
    assert.match(calls[0].command, /cd .*workspace/);
    assert.match(calls[0].command, /printf compile/);
    assert.equal(farm.view().tasks[0].projectId, 'default');
    assert.equal(farm.view().tasks[0].directory, '/workspace');
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
  const machines = guest(records, () => 'running',
    (id: string, _command: string, _timeout: number, signal: AbortSignal,
      output: (value: string) => void) => new Promise((resolve, reject) => {
      started.push(id);
      const release = () => { output('ok\n'); resolve({ code: 0, stdout: 'ok\n', stderr: '' }); };
      releases.push(release);
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }));
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
  const machines = guest(new Map([[vmId, vm]]), () => 'running',
    async () => ({ code, stdout: '', stderr: 'compile failed' }));
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
    exitCode: 7, vmId, projectId: 'default', directory: '/workspace',
    networkIsolation: 'host', stdout: '', stderr: 'compile failed' });
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

async function projectFixture(execute: (...args: any[]) => Promise<any>) {
  const vmId = randomUUID(), file = join(root, vmId + '-farm.json');
  let status = 'stopped';
  const machines = guest(new Map([[vmId, { id: vmId, name: 'private-builder' }]]), () => status, execute);
  await mkdir(vmDir(vmId), { recursive: true });
  const workspaces = new Workspaces(machines, { secrets: {
    resolve: async (_id: string, references: Record<string, string>) =>
      references?.TOKEN ? { TOKEN: 'private-farm-token' } : {},
  } as any });
  const alpha = (await workspaces.projects.create(vmId, 'Private', async () => {
    await workspaces.save(vmId, { directory: '/workspace/private', networkIsolation: 'private',
      environment: { BUILD_SCOPE: 'alpha' }, secrets: { TOKEN: 'build-key' } });
  })).active;
  const beta = (await workspaces.projects.create(vmId, 'Other', async () => {
    await workspaces.save(vmId, { directory: '/workspace/other' });
  })).active;
  await workspaces.projects.update(vmId, alpha);
  const terminals = new ProjectTerminals(machines, workspaces);
  const create = () => new BuildFarm(machines, file, undefined, undefined,
    new Jobs('farm-' + vmId, join(root, vmId + '-jobs')), terminals);
  return { vmId, file, machines, workspaces, terminals, alpha, beta, create,
    run: () => { status = 'running'; }, close: async () => {
      await terminals.close(); await workspaces.close();
    } };
}

test('a queued build keeps its node project across restart and activity changes, and redacts split secret logs', async () => {
  const f = await projectFixture(async (_id, _command, _timeout, _signal, log) => {
    log('private-'); log('farm-token\ncompiled');
    return { code: 0, stdout: 'private-farm-token\ncompiled', stderr: 'private-farm-token' };
  });
  let farm = f.create();
  try {
    await farm.init();
    const node = await farm.action({ operation: 'save-node', node: {
      vmId: f.vmId, slots: 1, labels: [], enabled: true } }) as { projectId: string };
    assert.equal(node.projectId, f.alpha);
    await farm.action({ operation: 'submit', build: { name: 'Scoped',
      command: 'printf "$TOKEN"', labels: [], timeoutSeconds: 30 } });
    await farm.close();
    await f.workspaces.projects.update(f.vmId, f.beta);
    farm = f.create();
    await farm.init(); f.run();
    await waitFor(() => farm.view().tasks[0].status === 'done');
    const task = farm.view().tasks[0];
    assert.equal(task.projectId, f.alpha);
    assert.equal(task.directory, '/workspace/private');
    assert.equal(task.networkIsolation, 'private');
    assert.equal(task.job?.projectId, f.alpha);
    const command = f.machines.commands.find((value: string) => value.includes('setsid sh -c'))!;
    assert.ok(command.indexOf(`ip netns exec sk-${f.alpha}`) < command.indexOf('export TOKEN='));
    assert.match(command, /export BUILD_SCOPE=/);
    assert.match(command, /cd .*workspace\/private/);
    const result = await farm.jobs.result(task.jobId!);
    assert.match(result.stdout, /私密配置已隐藏/);
    assert.doesNotMatch(JSON.stringify({ task, result }), /private-farm-token/);
    assert.doesNotMatch(await readFile(f.file, 'utf8'), /private-farm-token/);
  } finally { await farm.close(); await f.close(); }
});

test('two slots on one private node stay concurrent, guard project edits and clean cancelled process groups', async () => {
  let active = 0, peak = 0;
  const releases: Array<() => void> = [];
  const f = await projectFixture(async (_id, _command, _timeout, signal) => {
    active++; peak = Math.max(peak, active);
    try {
      await new Promise<void>((done, fail) => {
        releases.push(done);
        if (signal.aborted) fail(signal.reason);
        else signal.addEventListener('abort', () => fail(signal.reason), { once: true });
      });
      return { code: 0, stdout: 'compiled', stderr: '' };
    } finally { active--; }
  });
  const farm = f.create();
  try {
    await farm.init();
    await farm.action({ operation: 'save-node', node: {
      vmId: f.vmId, projectId: f.alpha, slots: 2, labels: [], enabled: true } });
    for (const name of ['one', 'two', 'three']) await farm.action({ operation: 'submit', build: {
      name, command: 'sleep 600', labels: [], timeoutSeconds: 30 } });
    f.run();
    await waitFor(() => releases.length === 2);
    assert.equal(active, 2); assert.equal(peak, 2);
    await f.workspaces.projects.with(f.vmId, f.alpha, async () => {
      const project = await f.workspaces.config(f.vmId);
      await assert.rejects(f.workspaces.save(f.vmId, { ...project, networkIsolation: 'host' }), /终端|命令/);
    });
    await assert.rejects(farm.action({ operation: 'save-node', node: {
      vmId: f.vmId, projectId: f.beta, slots: 2, labels: [], enabled: true } }), /执行构建/);
    const first = farm.view().tasks.find((task) => task.name === 'one')!;
    await farm.action({ operation: 'cancel', id: first.id });
    await waitFor(() => releases.length === 3);
    assert.equal(peak, 2);
    assert.ok(f.machines.commands.some((command: string) =>
      command.includes('sakura_owned_anchor') && command.includes('.pid.stop')));
    for (const release of releases) release();
    await waitFor(() => farm.view().tasks.filter((task) => task.status === 'done').length === 2);
    assert.equal(farm.view().tasks.find((task) => task.id === first.id)?.status, 'cancelled');
    await f.workspaces.projects.with(f.vmId, f.alpha, async () => {
      const project = await f.workspaces.config(f.vmId);
      await f.workspaces.save(f.vmId, { ...project, networkIsolation: 'host' });
    });
  } finally { await farm.close(); await f.close(); }
});

test('outside directories and missing node projects reject builds without running them in the default network', async () => {
  const f = await projectFixture(async () => { throw new Error('must not execute'); });
  const farm = f.create();
  try {
    await farm.init();
    await farm.action({ operation: 'save-node', node: {
      vmId: f.vmId, projectId: f.alpha, slots: 1, labels: [], enabled: true } });
    await assert.rejects(farm.action({ operation: 'save-node', node: {
      vmId: f.vmId, projectId: 'ffffffffffffffff', slots: 1, labels: [], enabled: true } }), /项目不存在/);
    await farm.action({ operation: 'submit', build: build('outside') });
    f.run();
    await waitFor(() => farm.view().tasks[0].status === 'error');
    assert.match(farm.view().tasks[0].error || '', /项目目录内/);
    const index = await f.workspaces.projects.list(f.vmId);
    await writeFile(join(vmDir(f.vmId), 'projects.json'), JSON.stringify({ ...index,
      active: f.beta, projects: index.projects.filter((project) => project.id !== f.alpha) }));
    await farm.action({ operation: 'submit', build: { name: 'Deleted project',
      command: 'true', labels: [], timeoutSeconds: 30 } });
    await waitFor(() => farm.view().tasks[0].status === 'error');
    assert.match(farm.view().tasks[0].error || '', /项目不存在/);
    assert.equal(f.machines.commands.some((command: string) => command.includes('setsid sh -c')), false);
  } finally { await farm.close(); await f.close(); }
});

test('legacy node records bind once to their saved active project without replacing valid bindings later', async () => {
  const f = await projectFixture(async () => ({ code: 0, stdout: '', stderr: '' }));
  const legacy = { version: 1, nodes: [{ vmId: f.vmId, slots: 1, labels: [], enabled: true }], tasks: [] };
  await writeFile(f.file, JSON.stringify(legacy));
  let farm = f.create();
  try {
    await farm.init();
    assert.equal(farm.view().nodes[0].projectId, f.alpha);
    assert.equal(JSON.parse(await readFile(f.file, 'utf8')).nodes[0].projectId, f.alpha);
    await farm.close();
    await f.workspaces.projects.update(f.vmId, f.beta);
    farm = f.create(); await farm.init();
    assert.equal(farm.view().nodes[0].projectId, f.alpha);
    const projects = await farm.projects(f.vmId);
    assert.equal(projects.vmId, f.vmId);
    assert.equal(projects.active, f.beta);
  } finally { await farm.close(); await f.close(); }
});
