import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Machines as MachinesType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-workspace-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Workspaces } = await import('../server/workspaces.ts');
const { Machines } = await import('../server/machines.ts');
const { vmDir } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

const sample =
  'CPU\ncpu 1 0 0 9 0 0 0 0\ncpu 2 0 0 18 0 0 0 0\nMEMORY\nMemTotal: 1000 kB\nMemAvailable: 500 kB\nDISK\n/dev/vda 1000 500 500 50% /\nPROCESSES\n1 init\nUPTIME\n1.0 0.5\n';
function fixture(id = 'vm') {
  const live = { status: 'running', startedAt: 'first' };
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([[id, live]]),
    records: new Map([[id, { template: 'none' }]]),
    state: () => live.status,
  }) as unknown as MachinesType;
  const workspaces = new Workspaces(machines);
  return { machines, live, workspaces };
}

test('metrics deduplicate concurrent reads and a failed old boot cannot evict the new boot sample', async () => {
  const { machines, live, workspaces } = fixture();
  const pending: {
    resolve: (value: { stdout: string; stderr: string; code: number }) => void;
    reject: (error: Error) => void;
  }[] = [];
  machines.exec = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  try {
    const first = workspaces.metrics('vm');
    const rejected = assert.rejects(first, /old boot/);
    assert.equal(workspaces.metrics('vm'), first);
    assert.equal(pending.length, 1);
    live.status = 'stopped';
    machines.emit('change');
    live.status = 'running';
    live.startedAt = 'second';
    machines.emit('change');
    const second = workspaces.metrics('vm');
    assert.notEqual(second, first);
    pending[0].reject(new Error('old boot'));
    await rejected;
    assert.equal(workspaces.metrics('vm'), second);
    assert.equal(pending.length, 2);
    pending[1].resolve({ stdout: sample, stderr: '', code: 0 });
    assert.equal((await second).cpuPercent, 10);
  } finally {
    await workspaces.close();
  }
});

test('workspace shutdown detaches lifecycle observers before later machine events', async () => {
  const { machines, workspaces } = fixture();
  assert.equal(machines.listenerCount('change'), 1);
  await workspaces.close();
  machines.records.get('vm')!.template = 'node';
  assert.equal(machines.listenerCount('change'), 0);
  assert.doesNotThrow(() => machines.emit('change'));
  assert.equal(workspaces.jobs.view('vm'), null);
});

test('saving project configuration cannot race a start that is still loading its configuration', async () => {
  const id = randomUUID();
  const { machines, workspaces } = fixture(id);
  await mkdir(vmDir(id), { recursive: true });
  const file = join(vmDir(id), 'project.json');
  await writeFile(file, JSON.stringify({ command: 'npm start' }));
  const locks = new Machines({} as Engine);
  machines.locked = locks.locked.bind(locks);
  machines.get = () => ({ template: 'none' }) as ReturnType<MachinesType['get']>;
  machines.exec = async () => ({ stdout: '', stderr: '', code: 0 });
  let release!: () => void;
  let entered!: () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const loaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  const config = workspaces.config.bind(workspaces);
  workspaces.config = async (id) => {
    const project = await config(id);
    entered();
    await loaded;
    return project;
  };
  const starting = workspaces.run(id, 'start');
  try {
    await reading;
    await assert.rejects(workspaces.save(id, { command: 'npm run changed' }), /另一项操作/);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).command, 'npm start');
  } finally {
    release();
    await starting;
    await workspaces.close();
  }
});
