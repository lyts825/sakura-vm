import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter, once } from 'node:events';
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { PassThrough, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { HostNetworkPool } from '../server/network/host-pool.ts';
import { ROOT } from '../server/paths.ts';

const binary = join(
  process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu'),
  `qemu-system-x86_64${process.platform === 'win32' ? '.exe' : ''}`,
);
const options = { maxWorkers: 4, connectionsPerWorker: 8, scaleAt: 1, idleMs: 60_000 };
const governor = (processes = 4, network = 4) =>
  new HostRuntime({ budgets: { process: { capacity: processes }, 'network.worker': { capacity: network } } });
const used = (runtime: HostRuntime, key = 'process') =>
  runtime.snapshot().budgets.find((budget) => budget.key === key)!.used;
async function eventually(check: () => boolean) {
  const until = Date.now() + 3000;
  while (!check()) {
    assert.ok(Date.now() < until, 'Network resources did not settle');
    await delay(5);
  }
}
const forkWorker = (file: string) =>
  fork(file, [], { execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
const qmpFixture = `process.stdout.write(JSON.stringify({QMP:{version:{}}})+'\\n'); let text='';
process.stdin.setEncoding('utf8'); process.stdin.on('data', bytes=>{text+=bytes;let end;
while((end=text.indexOf('\\n'))>=0){const line=text.slice(0,end);text=text.slice(end+1);const m=JSON.parse(line);
process.stdout.write(JSON.stringify({id:m.id,return:{name:'fixture',value:m.arguments?.value}})+'\\n');}});`;
function fakeBackend() {
  return spawn(process.execPath, ['-e', qmpFixture], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
}
class UnconfirmedBackend extends EventEmitter {
  pid = 424242;
  kills = 0;
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new Writable({
    write: (chunk, _encoding, done) => {
      for (const line of String(chunk).trim().split('\n')) {
        const message = JSON.parse(line);
        this.stdout.write(JSON.stringify({ id: message.id, return: {} }) + '\n');
      }
      done();
    },
  });
  kill() {
    this.kills++;
    return true;
  }
  constructor() {
    super();
    setImmediate(() => this.stdout.write('{"QMP":{}}\n'));
  }
}

test('tryAcquire is atomic, preserves queued fairness and leaves no failed partition allocations', async () => {
  const runtime = governor(2, 2);
  const first = runtime.tryAcquire({
    owner: 'one',
    kind: 'fixture',
    label: 'occupied',
    cost: { process: 2 },
  })!;
  const before = runtime.snapshot();
  assert.equal(
    runtime.tryAcquire({
      owner: 'two',
      kind: 'fixture',
      label: 'blocked',
      cost: { process: 1, 'network.worker': 1 },
      partitions: [{ key: 'never-created', limit: 1 }],
    }),
    undefined,
  );
  const after = runtime.snapshot();
  // Diagnostic clocks advance without changing admission or partition ownership.
  assert.deepEqual({ ...after, resources: after.resources.map(({ timings, ...resource }) => resource) },
    { ...before, resources: before.resources.map(({ timings, ...resource }) => resource) });
  assert.ok(after.resources[0].timings!.executionMs >= before.resources[0].timings!.executionMs);
  const queued = runtime.acquire({ owner: 'queued', kind: 'fixture', label: 'older', cost: { process: 1 } });
  assert.equal(
    runtime.tryAcquire({
      owner: 'new',
      kind: 'fixture',
      label: 'no overtaking',
      cost: { 'network.worker': 1 },
    }),
    undefined,
  );
  first.release();
  const second = await queued;
  second.release();
  const partition = runtime.tryAcquire({
    owner: 'partition',
    kind: 'fixture',
    label: 'atomic',
    cost: { process: 1, 'network.worker': 1 },
    partitions: [{ key: 'temporary', limit: 1 }],
  })!;
  assert.equal(used(runtime), 1);
  assert.equal(used(runtime, 'network.worker'), 1);
  partition.release();
  assert.equal(
    runtime.snapshot().budgets.some((budget) => budget.key.startsWith('partition:')),
    false,
  );
  runtime.close();
});

test('independent pools share the global cap and an expansion failure reuses live worker capacity', async () => {
  const runtime = governor(3, 1),
    first = new HostNetworkPool(options, { governor: runtime }),
    second = new HostNetworkPool(options, { governor: runtime });
  try {
    const one = first.pin(() => {}),
      two = first.pin(() => {});
    assert.equal(one.resources().worker, two.resources().worker);
    assert.equal(used(runtime), 1);
    assert.throws(() => second.pin(() => {}), { code: 'NETWORK_BUSY' });
    const answers = await Promise.all([
      one.call('lookup', { hostname: 'localhost', options: {} }),
      two.call('lookup', { hostname: 'localhost', options: {} }),
    ]);
    assert.equal(answers.length, 2);
    one.release();
    two.release();
  } finally {
    await first.close();
    await second.close();
  }
  assert.equal(used(runtime), 0);
  assert.equal(runtime.snapshot().resources.length, 0);
  runtime.close();
});

test('cancelled startup and failed forks release budget only after owned process closure', async () => {
  const runtime = governor(),
    pool = new HostNetworkPool(options, { governor: runtime });
  const abort = new AbortController(),
    reason = new Error('cancelled startup');
  const lookup = pool.lookup('localhost', {}, abort.signal);
  abort.abort(reason);
  await assert.rejects(lookup, (error) => error === reason);
  await pool.close();
  assert.equal(used(runtime), 0);
  const failed = new HostNetworkPool(options, {
    governor: runtime,
    forkWorker: () => {
      throw new Error('fork refused');
    },
  });
  await assert.rejects(failed.start(), /fork refused/);
  assert.equal(used(runtime), 0);
  await failed.close();
  runtime.close();
});

test('backend must be authorized and budgeted before spawn', async () => {
  const runtime = governor(1, 1);
  let started = 0;
  const pool = new HostNetworkPool(options, {
    governor: runtime,
    spawnBackend: () => {
      started++;
      return fakeBackend();
    },
  });
  const pin = pool.pin(() => {});
  try {
    await assert.rejects(
      pin.call('qmp', { binary: process.execPath, execute: 'query-version', args: {} }),
      /program/,
    );
    await assert.rejects(pin.call('qmp', { binary, execute: 'query-version', args: {} }), {
      code: 'NETWORK_BUSY',
    });
    assert.equal(started, 0);
    assert.equal(used(runtime), 1);
  } finally {
    await pool.close();
  }
  assert.equal(used(runtime), 0);
  runtime.close();
});

test('VM supervisor/backend reservations are acquired as a pair before spawning and can reuse an existing pair', async () => {
  const runtime = governor(3, 3);
  let forks = 0;
  const pool = new HostNetworkPool(
    { ...options, reserveBackend: true },
    {
      governor: runtime,
      forkWorker: (file) => {
        forks++;
        return forkWorker(file);
      },
      spawnBackend: fakeBackend,
    },
  );
  try {
    const first = pool.pin(() => {});
    assert.equal(used(runtime), 2);
    assert.ok(first.resources().backend);
    const second = pool.pin(() => {});
    assert.equal(forks, 1);
    assert.equal(used(runtime), 2);
    assert.equal(first.resources().worker, second.resources().worker);
    await first.call('qmp', { binary, execute: 'query-version', args: {} });
    assert.equal(used(runtime), 2);
    first.release();
    second.release();
  } finally {
    await pool.close();
  }
  assert.equal(used(runtime), 0);
  const occupied = runtime.tryAcquire({
    owner: 'fixture',
    kind: 'fixture',
    label: 'one remaining slot',
    cost: { process: 2 },
  })!;
  const blocked = new HostNetworkPool(
    { ...options, reserveBackend: true },
    {
      governor: runtime,
      forkWorker: () => {
        throw new Error('must not fork');
      },
    },
  );
  assert.throws(() => blocked.pin(() => {}), { code: 'NETWORK_BUSY' });
  assert.equal(used(runtime), 2);
  await blocked.close();
  occupied.release();
  runtime.close();
});

test('backend spawn failures and closing a worker before backend launch return both reservations', async () => {
  const runtime = governor(2, 2);
  const startup = new HostNetworkPool({ ...options, reserveBackend: true }, { governor: runtime });
  startup.pin(() => {});
  assert.equal(used(runtime), 2);
  await startup.close();
  assert.equal(used(runtime), 0);
  const failed = new HostNetworkPool(
    { ...options, reserveBackend: true },
    {
      governor: runtime,
      spawnBackend: () =>
        spawn(join(ROOT, '__missing-network-budget-fixture__'), [], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
    },
  );
  const pin = failed.pin(() => {});
  await assert.rejects(pin.call('qmp', { binary, execute: 'query-version', args: {} }));
  await failed.close();
  assert.equal(used(runtime), 0);
  runtime.close();
});

test('a worker crash reaps the originally owned backend handle and both resource leases', async () => {
  const runtime = governor(2, 2);
  let worker!: ChildProcess, backend!: ChildProcess;
  const pool = new HostNetworkPool(options, {
    governor: runtime,
    forkWorker: (file) => (worker = forkWorker(file)),
    spawnBackend: () => (backend = fakeBackend()),
  });
  const pin = pool.pin(() => {});
  try {
    const answer = await pin.call('qmp', { binary, execute: 'query-version', args: { value: '网络✓' } });
    assert.equal(answer.value, '网络✓');
    assert.equal(used(runtime), 2);
    assert.ok(pool.snapshot()[0].backendResourceId);
    assert.equal(pin.resources().backend, pool.snapshot()[0].backendResourceId);
    const stopped = once(backend, 'close');
    worker.kill('SIGKILL');
    await stopped;
    await eventually(() => used(runtime) === 0 && pool.snapshot().length === 0);
  } finally {
    await pool.close();
  }
  runtime.close();
});

test('unconfirmed backend close retains budget, uses the original handle and ignores stale resource IDs', async () => {
  const runtime = governor(3, 3);
  let original!: UnconfirmedBackend;
  const pool = new HostNetworkPool(options, {
    governor: runtime,
    closeTimeoutMs: 80,
    spawnBackend: () => (original = new UnconfirmedBackend()) as unknown as ChildProcess,
  });
  const pin = pool.pin(() => {});
  try {
    await pin.call('qmp', { binary, execute: 'query-version', args: {} });
    const id = pin.resources().backend!;
    await assert.rejects(pin.terminate(), { code: 'HOST_PROCESS_CLEANUP_PENDING' });
    assert.equal(used(runtime), 1);
    assert.equal(
      runtime.snapshot().resources.find((resource) => resource.id === id)?.state,
      'cleanup-pending',
    );
    original.emit('exit', 0, null);
    const kills = original.kills;
    await assert.rejects(pool.retryCleanup(id), { code: 'HOST_PROCESS_CLEANUP_PENDING' });
    assert.equal(original.kills, kills, 'An exited PID must never be killed again while waiting for close');
    original.emit('close', 0, null);
    await eventually(() => used(runtime) === 0);
    const replacement = pool.pin(() => {});
    await replacement.call('lookup', { hostname: 'localhost', options: {} });
    await assert.rejects(pool.retryCleanup(id), { code: 'NETWORK_RESOURCE_NOT_FOUND' });
    assert.equal(used(runtime), 1);
    replacement.release();
  } finally {
    original?.emit('close', 0, null);
    await pool.close();
  }
  runtime.close();
});
