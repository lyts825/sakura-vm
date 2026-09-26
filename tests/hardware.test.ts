import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hardwareArguments, deviceArguments } from '../shared/hardware.ts';
const root = await mkdtemp(join(tmpdir(), 'sakura-hardware-'));
process.env.SAKURA_DATA_DIR = root;
const { createSchema, vmDir } = await import('../server/model.ts');
const { Machines } = await import('../server/machines.ts');
const { CapabilityActions } = await import('../server/capability-actions.ts');
const { reservationSchema, validateAdmission, saveResourcePolicy } =
  await import('../server/resource-policies.ts');
after(() => rm(root, { recursive: true, force: true }));

test('CPU topology validates complete NUMA allocation and builds explicit QEMU resources', () => {
  const vm = createSchema.parse({
    name: 'numa',
    cpus: 2,
    memoryMiB: 512,
    hardware: {
      cpu: {
        sockets: 2,
        cores: 2,
        threads: 1,
        numa: [
          { memoryMiB: 256, cpus: [0, 1] },
          { memoryMiB: 256, cpus: [2, 3] },
        ],
      },
    },
  });
  const args = hardwareArguments(vm);
  assert.ok(args.includes('2,sockets=2,cores=2,threads=1,maxcpus=4'));
  assert.ok(args.includes('node,nodeid=1,memdev=sakura-numa-1,cpus=2,cpus=3'));
  for (const cpu of [
    { sockets: 1, cores: 1, threads: 1 },
    { sockets: 8, cores: 8, threads: 1 },
    { sockets: 1, cores: 2, threads: 1, numa: [{ memoryMiB: 512, cpus: [0, 0] }] },
    { sockets: 1, cores: 2, threads: 1, numa: [{ memoryMiB: 256, cpus: [0, 1] }] },
  ])
    assert.throws(() => createSchema.parse({ name: 'bad', hardware: { cpu } }));
  assert.throws(() =>
    createSchema.parse({ name: 'bad', memoryMiB: 512, hardware: { memory: { maxMiB: 256, slots: 2 } } }),
  );
  assert.ok(
    !deviceArguments({
      ...vm,
      hardware: {
        devices: {
          networkCard: 'e1000',
          randomDevice: false,
          balloon: false,
          diskCache: 'none',
          discard: true,
        },
      },
    }).includes('virtio-balloon-pci'),
  );
});

test('resource admission reserves physical memory and serializes CPU budgets without double counting current VM', () => {
  const policy = reservationSchema.parse({ enabled: true, hostReserveMiB: 1024, maxRunningCpus: 4 });
  const a = { id: 'a', memoryMiB: 2048, cpus: 2 },
    b = { id: 'b', memoryMiB: 1024, cpus: 2 };
  const host = { totalMemoryMiB: 4096, freeMemoryMiB: 1000, logicalCpus: 8 };
  assert.doesNotThrow(() => validateAdmission(policy, a, [a, b], host));
  assert.throws(() => validateAdmission(policy, { ...a, memoryMiB: 3072 }, [a, b], host), /预留内存/);
  assert.throws(() => validateAdmission(policy, { ...a, cpus: 3 }, [a, b], host), /vCPU/);
});

test('hardware capabilities persist through restart, reject live edits and enforce admission before QEMU launch', async (t) => {
  const launched: string[][] = [];
  const engine: any = {
    runtime: { close: async () => {} },
    whpxAvailable: false,
    run: async (_tool: string, args: string[], options: any) => {
      launched.push(args);
      await new Promise<void>((resolve) =>
        options.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return '';
    },
  };
  const machines = new Machines(engine);
  await machines.init();
  const id = randomUUID();
  await mkdir(vmDir(id));
  machines.records.set(id, {
    ...createSchema.parse({ name: 'hardware', cpus: 1 }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  machines.exec = async () => ({ code: 0, stdout: '', stderr: '' });
  t.after(async () => {
    for (const live of machines.live.values()) live.abort.abort();
    await machines.close();
  });
  const actions = new CapabilityActions(machines, {} as any),
    signal = new AbortController().signal;
  await actions.run(
    id,
    'cpu-topology',
    { mode: 'save', topology: { sockets: 1, cores: 4, threads: 1 } },
    signal,
  );
  await actions.run(
    id,
    'device-profiles',
    { mode: 'save', name: 'trim', profile: { discard: true } },
    signal,
  );
  await actions.run(id, 'device-profiles', { mode: 'apply', name: 'trim' }, signal);
  const reloaded = new Machines(engine);
  await reloaded.init();
  t.after(() => reloaded.close());
  assert.equal(reloaded.get(id).hardware?.cpu?.cores, 4);
  assert.equal(reloaded.get(id).hardware?.devices?.discard, true);
  await saveResourcePolicy({ enabled: true, maxRunningCpus: 1, hostReserveMiB: 0 });
  const other = randomUUID();
  machines.records.set(other, { ...machines.get(id), id: other, name: 'other' });
  await machines.start(id);
  await assert.rejects(machines.configureHardware(id, {}), /停止/);
  await assert.rejects(machines.start(other), /vCPU/);
  assert.equal(launched.length, 1);
  assert.ok(launched[0].includes('1,sockets=1,cores=4,threads=1,maxcpus=4'));
  assert.ok(launched[0].some((arg) => arg.includes('discard=unmap')));
  machines.live.get(id)!.abort.abort();
  await machines.live.get(id)!.done;
  await saveResourcePolicy({ enabled: false });
});
