import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';
import type { VMRecord } from '../server/model.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-sandbox-test-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_PATH = join(root, 'alpine.qcow2');
await writeFile(process.env.SAKURA_IMAGE_PATH, '');
const { Machines } = await import('../server/machines.ts');
const { Sandboxes, sandboxCreateSchema, sandboxRunSchema } = await import('../server/sandboxes.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
const { Jobs } = await import('../server/jobs.ts');
const { Features } = await import('../server/features.ts');

after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-sandbox-test-'));
  await rm(root, { recursive: true, force: true });
});

async function fixture(t: TestContext) {
  const launches: string[][] = [];
  const engine = {
    whpxAvailable: false,
    runtime: { close: async () => {} },
    run: async (tool, args, options = {}) => {
      if (tool === 'sakura-qemu') {
        launches.push(args);
        await new Promise<void>((finish) => {
          if (options.signal?.aborted) finish();
          else options.signal?.addEventListener('abort', () => finish(), { once: true });
        });
      }
      return '';
    },
  } as Engine;
  const machines = new Machines(engine);
  await mkdir(join(root, 'machines'), { recursive: true });
  machines.exec = async () => ({ stdout: '', stderr: '', code: 0 });
  const jobs = new Jobs('sandbox', join(root, randomUUID()));
  const service = new Sandboxes(machines, jobs);
  t.after(async () => {
    await service.close();
    const running = [...machines.live.values()];
    for (const live of running) live.abort.abort();
    await Promise.allSettled(running.map((live) => live.done));
    await machines.close();
  });
  const add = async (sandbox = true, expired = false, onExpire: 'stop' | 'delete' = 'stop') => {
    const id = randomUUID();
    const vm: VMRecord = {
      ...createSchema.parse({ name: 'sandbox-' + id.slice(0, 8) }),
      id,
      createdAt: new Date().toISOString(),
      snapshots: [],
      ...(sandbox
        ? {
            sandbox: {
              network: 'isolated' as const,
              onExpire,
              expiresAt: new Date(Date.now() + (expired ? -1000 : 60_000)).toISOString(),
            },
          }
        : {}),
    };
    machines.records.set(id, vm);
    await mkdir(vmDir(id));
    return vm;
  };
  return { machines, service, add, launches, jobs };
}

test('sandbox inputs default to isolated disposable environments and reject policy escape fields', () => {
  const input = sandboxCreateSchema.parse({ name: 'sample' });
  assert.equal(input.network, 'isolated');
  assert.equal(input.onExpire, 'delete');
  assert.equal(input.lifetimeMinutes, 60);
  for (const value of [
    { cpus: 5 },
    { memoryMiB: 4097 },
    { diskGiB: 33 },
    { lifetimeMinutes: 0 },
    { lifetimeMinutes: 1441 },
    { forwards: [{ host: 8080, guest: 80 }] },
    { template: 'node' },
    { expiresAt: '2100-01-01T00:00:00.000Z' },
  ])
    assert.equal(sandboxCreateSchema.safeParse({ name: 'sample', ...value }).success, false);
  for (const value of [
    { command: ' ' },
    { command: 'a\0b' },
    { command: 'pwd', cwd: '../host' },
    { command: 'pwd', timeoutSeconds: 0 },
    { command: 'pwd', timeoutSeconds: 3601 },
  ])
    assert.equal(sandboxRunSchema.safeParse(value).success, false);
});

test('creation persists immutable policy and produces independent sandboxes', async (t) => {
  const { machines, service } = await fixture(t);
  const vm = await service.create({ name: 'created-sandbox' });
  assert.equal(vm.sandbox.network, 'isolated');
  assert.equal(vm.forwards.length, 0);
  assert.equal(vm.expired, false);
  const stored = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
  assert.deepEqual(stored.find((item: VMRecord) => item.id === vm.id).sandbox, vm.sandbox);
  await assert.rejects(machines.update(vm.id, { name: vm.name }), /沙箱资源/);
  await assert.rejects(machines.setForwards(vm.id, [{ host: 8080, guest: 80 }]), /沙箱资源/);
  await assert.rejects(machines.resize(vm.id, 16), /沙箱资源/);
});

test('sandbox operations cannot target ordinary instances', async (t) => {
  const { service, add, machines } = await fixture(t);
  const vm = await add(false);
  await assert.rejects(service.control(vm.id, 'destroy'), /不是沙箱/);
  assert.throws(() => service.run(vm.id, { command: 'pwd' }), /不是沙箱/);
  await assert.rejects(machines.terminateSandbox(vm.id), /不是沙箱/);
  assert.equal(machines.records.has(vm.id), true);
  assert.deepEqual((await service.list()).sandboxes, []);
});

test('QEMU isolates network while keeping only the controller SSH forward', async (t) => {
  const { machines, add, launches } = await fixture(t);
  const vm = await add();
  await machines.start(vm.id);
  const args = launches[0],
    network = args[args.indexOf('-netdev') + 1];
  assert.match(network, /restrict=on,ipv6=off/);
  assert.equal(network.match(/hostfwd=/g)?.length, 1);
  assert.match(network, /hostfwd=tcp:127\.0\.0\.1:\d+-:22/);
  assert.ok(args.includes('-no-user-config'));
  const ordinary = await add(false);
  await machines.start(ordinary.id);
  assert.doesNotMatch(launches[1][launches[1].indexOf('-netdev') + 1], /restrict=on/);
});

test('expiry terminates powered-on guests even while a separate instance operation holds the lock', async (t) => {
  const { machines, add } = await fixture(t);
  const vm = await add();
  await machines.start(vm.id);
  let release!: () => void;
  const held = machines.locked(
    vm.id,
    () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  vm.sandbox!.expiresAt = new Date(Date.now() - 1).toISOString();
  await machines.expireSandboxes();
  assert.equal(machines.live.has(vm.id), false);
  release();
  await held;
  await assert.rejects(machines.start(vm.id), /已到期/);
  await assert.rejects(machines.resume(vm.id), /已到期/);
});

test('startup without the plugin removes expired disposable disks but retains stop-only disks', async (t) => {
  const { machines, add } = await fixture(t);
  const disposable = await add(true, true, 'delete');
  const retained = await add(true, true, 'stop');
  const ordinary = await add(false);
  await writeFile(join(root, 'machines.json'), JSON.stringify([...machines.records.values()]));
  const restarted = new Machines(machines.engine);
  try {
    await restarted.init();
    assert.equal(restarted.records.has(disposable.id), false);
    assert.equal(restarted.records.has(retained.id), true);
    assert.equal(restarted.records.has(ordinary.id), true);
    await assert.rejects(readFile(join(vmDir(disposable.id), 'disk.qcow2')), { code: 'ENOENT' });
    await assert.rejects(restarted.start(retained.id), /已到期/);
  } finally {
    await restarted.close();
  }
});

test('commands preserve shell quoting, record output and terminate the VM on completion', async (t) => {
  const { machines, service, add, jobs } = await fixture(t);
  const vm = await add();
  let submitted = '';
  machines.exec = async (_id, command, _timeout, _signal, output) => {
    if (command.startsWith('cd ')) {
      submitted = command;
      output?.('result\n');
    }
    return { stdout: 'result\n', stderr: '', code: 0 };
  };
  const job = service.run(vm.id, { command: "printf '%s' '$(touch host-file)'", cwd: "/workspace/a'b" });
  assert.throws(() => service.run(vm.id, { command: 'pwd' }), /操作仍在进行/);
  await jobs.wait(vm.id);
  assert.equal(job.status, 'done');
  assert.match(job.log, /result\n/);
  assert.match(job.log, /退出码：0/);
  assert.match(submitted, /^cd '\/workspace\/a'\\''b' && exec sh -c /);
  assert.equal(machines.live.has(vm.id), false);
  await service.control(vm.id, 'destroy');
  assert.equal(jobs.list()[0].id, job.id);
});

test('nonzero exits, timeouts and cancellation all stop the entire guest', async (t) => {
  for (const outcome of ['failure', 'timeout', 'cancel'] as const) {
    const { machines, service, add, jobs } = await fixture(t);
    const vm = await add();
    let entered!: () => void;
    const executing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    machines.exec = async (_id, command, _timeout, signal) => {
      if (!command.startsWith('cd ')) return { stdout: '', stderr: '', code: 0 };
      entered();
      if (outcome === 'failure') return { stdout: '', stderr: 'failed', code: 7 };
      await new Promise<void>((_resolve, reject) => {
        if (signal?.aborted) reject(new Error('aborted'));
        else signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      return { stdout: '', stderr: '', code: 0 };
    };
    const job = service.run(vm.id, { command: 'sleep 30', timeoutSeconds: 1 });
    await executing;
    if (outcome === 'cancel') jobs.cancel(vm.id);
    await jobs.wait(vm.id);
    assert.equal(job.status, outcome === 'cancel' ? 'cancelled' : 'error');
    assert.match(
      job.error || '',
      outcome === 'failure' ? /退出码 7/ : outcome === 'timeout' ? /超时/ : /取消/,
    );
    assert.equal(machines.live.has(vm.id), false);
  }
});

test('sandbox plugin activates by itself, owns its routes and registers execution history', async (t) => {
  const { machines } = await fixture(t);
  const host = await Features.create(machines, ['sandbox']);
  try {
    assert.deepEqual(host.errors, {});
    assert.deepEqual([...host.enabled], ['sandbox']);
    assert.ok(host.serviceValue('sandboxes') instanceof Sandboxes);
    assert.ok(
      host
        .jobStores()
        .some((store) => store === (host.serviceValue('sandboxes') as InstanceType<typeof Sandboxes>).jobs),
    );
  } finally {
    await host.close();
  }
});
