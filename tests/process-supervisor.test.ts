import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { ProcessSupervisor } from '../server/process-supervisor.ts';

function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve: () => resolve(),
  };
}
const governor = () =>
  new HostRuntime({
    budgets: {
      process: { capacity: 4, reserved: 1 },
      'process.vm': { capacity: 1 },
      'process.tool': { capacity: 2, reserved: 1 },
      'process.helper': { capacity: 1 },
    },
  });
function fakeChild() {
  const signals: NodeJS.Signals[] = [];
  const child = Object.assign(new EventEmitter(), {
    stderr: new PassThrough(),
    kill(signal: NodeJS.Signals = 'SIGTERM') {
      signals.push(signal);
      return true;
    },
  }) as unknown as ChildProcess;
  return { child, signals };
}
const helperOptions = {
  owner: 'vm:fixture',
  helper: 'virtiofsd' as const,
  label: 'fixture',
  file: 'fixture',
  args: [],
  graceMs: 1,
  closeTimeoutMs: 5,
};

test('VM, tools and reserved control admission remain independent and bounded', async () => {
  const host = governor(),
    supervisor = new ProcessSupervisor(host),
    release = deferred();
  const vm = supervisor.run({ owner: 'vm:one', kind: 'vm', label: 'QEMU' }, () => release.promise);
  await delay(0);
  const cancel = new AbortController();
  let started = false;
  const queued = supervisor.run(
    { owner: 'vm:two', kind: 'vm', label: 'QEMU', signal: cancel.signal },
    async () => {
      started = true;
    },
  );
  const rejected = assert.rejects(queued);
  const tool = supervisor.run({ owner: 'disk', kind: 'tool', label: 'qemu-img' }, () => release.promise);
  const control = supervisor.run(
    { owner: 'probe', kind: 'tool', label: 'probe', lane: 'control' },
    () => release.promise,
  );
  await delay(0);
  assert.equal(host.snapshot().resources.filter((value) => value.state === 'active').length, 3);
  assert.equal(host.snapshot().queued, 1);
  cancel.abort();
  await rejected;
  assert.equal(started, false);
  release.resolve();
  await Promise.all([vm, tool, control]);
  assert.equal(host.snapshot().resources.length, 0);
  host.close();
});

test('cancellation holds the execution slot until the adapter acknowledges completion', async () => {
  const host = governor(),
    supervisor = new ProcessSupervisor(host),
    release = deferred(),
    cancel = new AbortController();
  const task = supervisor.run(
    { owner: 'vm:one', kind: 'vm', label: 'QEMU', signal: cancel.signal },
    () => release.promise,
  );
  await delay(0);
  cancel.abort();
  await delay(0);
  assert.equal(host.snapshot().budgets.find((value) => value.key === 'process.vm')?.used, 1);
  release.resolve();
  await task;
  assert.equal(host.snapshot().resources.length, 0);
});

test('unconfirmed native retirement retains its visible budget', async () => {
  const host = governor(),
    supervisor = new ProcessSupervisor(host);
  await assert.rejects(
    supervisor.run({ owner: 'vm:one', kind: 'vm', label: 'QEMU' }, async (control) => {
      const error = new Error('missing native receipt');
      control.cleanupPending(error);
      throw error;
    }),
    /missing native receipt/,
  );
  assert.equal(host.snapshot().resources[0].state, 'cleanup-pending');
  assert.equal(host.snapshot().budgets.find((value) => value.key === 'process.vm')?.used, 1);
  assert.throws(() => host.close(), /未确认释放/);
});

test('helper cancellation and exit do not release its slot before physical close', async () => {
  const host = governor(),
    fake = fakeChild(),
    cancel = new AbortController();
  const supervisor = new ProcessSupervisor(host, () => fake.child);
  const helper = await supervisor.helper({ ...helperOptions, signal: cancel.signal, closeTimeoutMs: 100 });
  await helper.ready(async () => true);
  cancel.abort();
  const close = helper.close();
  assert.equal(helper.close(), close);
  fake.child.emit('exit', 0, null);
  await delay(0);
  assert.equal(host.snapshot().resources.length, 1);
  fake.child.emit('close', 0, null);
  await close;
  assert.equal(host.snapshot().resources.length, 0);
});

test('failed helper termination keeps its budget and a later close retires it', async () => {
  const host = governor(),
    fake = fakeChild(),
    supervisor = new ProcessSupervisor(host, () => fake.child);
  const helper = await supervisor.helper(helperOptions);
  await assert.rejects(helper.close(), { code: 'HOST_PROCESS_CLEANUP_PENDING' });
  assert.deepEqual(fake.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(host.snapshot().resources[0].state, 'cleanup-pending');
  fake.child.emit('close', null, 'SIGKILL');
  await helper.close();
  assert.equal(host.snapshot().resources.length, 0);
});

test('helper readiness cannot succeed after exit or wait forever on a probe', async () => {
  const host = governor(),
    fake = fakeChild(),
    supervisor = new ProcessSupervisor(host, () => fake.child);
  const helper = await supervisor.helper(helperOptions);
  await assert.rejects(
    helper.ready(() => new Promise(() => {}), 5),
    /未在限时内就绪/,
  );
  fake.child.emit('exit', 0, null);
  await assert.rejects(
    helper.ready(async () => true),
    /未在限时内就绪/,
  );
  fake.child.emit('close', 0, null);
  await helper.close();
  assert.equal(host.snapshot().resources.length, 0);
});

test('helper spawn failure still waits for close and reports the exact owner exit', async () => {
  const host = governor(),
    fake = fakeChild(),
    exits: unknown[] = [];
  const helper = await new ProcessSupervisor(host, () => fake.child).helper({
    ...helperOptions,
    onExit: (value) => exits.push(value),
  });
  fake.child.emit('error', new Error('spawn denied'));
  await assert.rejects(
    helper.ready(async () => false),
    /spawn denied/,
  );
  assert.equal(host.snapshot().resources.length, 1);
  fake.child.emit('close', -1, null);
  assert.equal(exits.length, 1);
  assert.equal(host.snapshot().resources.length, 0);
});

test('a real dedicated helper is killed and accounted until its observed close', async () => {
  const host = governor();
  let child!: ChildProcess;
  const supervisor = new ProcessSupervisor(
    host,
    (file, args) =>
      (child = spawn(file, args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })),
  );
  const helper = await supervisor.helper({
    ...helperOptions,
    file: process.execPath,
    args: ['-e', "process.stderr.write('READY'); setInterval(()=>{},1000)"],
    graceMs: 200,
    closeTimeoutMs: 2000,
  });
  try {
    await helper.ready(async () => helper.failure.includes('READY'));
    assert.ok(child.pid);
    assert.equal(host.snapshot().resources.length, 1);
  } finally {
    await helper.close();
  }
  assert.equal(host.snapshot().resources.length, 0);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});
