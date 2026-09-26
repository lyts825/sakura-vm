import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'sakura-disk-maintenance-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Maintenance } = await import('../server/maintenance.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
const { diskMaintenanceState, diskMaintenanceDue, runDiskMaintenance, saveDiskMaintenancePolicy } =
  await import('../server/disk-maintenance.ts');
const { saveMaintenancePolicy } = await import('../server/automation-policy.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-disk-maintenance-'));
  await rm(root, { recursive: true, force: true });
});
const signal = () => new AbortController().signal;
async function fixture() {
  const calls: string[][] = [];
  const engine: any = {
    runtime: { close: async () => {} },
    run: async (_tool: string, args: string[]) => {
      calls.push(args);
      if (args[0] === 'convert') await writeFile(args.at(-1)!, 'verified replacement');
      return '';
    },
  };
  const machines = new Machines(engine),
    id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'disk-test', hardware: { devices: { discard: true } } }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  await mkdir(vmDir(id), { recursive: true });
  const source = join(vmDir(id), 'disk.qcow2');
  await writeFile(source, 'original bytes');
  return { machines, id, source, engine, calls };
}

test('compaction holds the lifecycle lock until publication and cancellation preserves the original disk', async () => {
  const { machines, id, source, engine } = await fixture();
  let entered!: () => void;
  const converting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  engine.run = async (_tool: string, args: string[], { signal }: { signal: AbortSignal }) => {
    if (args[0] === 'convert') {
      await writeFile(args.at(-1)!, 'partial');
      entered();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      signal.throwIfAborted();
    }
    return '';
  };
  const abort = new AbortController(),
    pending = runDiskMaintenance(machines, id, 'compact', abort.signal);
  const rejected = assert.rejects(pending, /cancelled/);
  await converting;
  await assert.rejects(machines.start(id), /另一项操作/);
  await assert.rejects(saveDiskMaintenancePolicy(machines, id, {}), /另一项操作/);
  assert.equal(await readFile(source, 'utf8'), 'original bytes');
  abort.abort(new Error('cancelled'));
  await rejected;
  assert.equal(await readFile(source, 'utf8'), 'original bytes');
  assert.ok(!(await readdir(vmDir(id))).some((name) => name.includes('compact')));
  assert.equal(machines.isBusy(id), false);
  const state = await diskMaintenanceState(id);
  assert.match(state.attempts.compact!.error!, /cancelled/);
  assert.equal(state.successes.compact, undefined);
});

test('failed image comparison cannot replace the source and successful compaction verifies before publishing', async () => {
  const { machines, id, source, engine, calls } = await fixture();
  const original = engine.run;
  engine.run = async (...args: any[]) => {
    if (args[1][0] === 'compare') throw new Error('different disk contents');
    return original(...args);
  };
  await assert.rejects(runDiskMaintenance(machines, id, 'compact', signal()), /different disk contents/);
  assert.equal(await readFile(source, 'utf8'), 'original bytes');
  engine.run = original;
  await runDiskMaintenance(machines, id, 'compact', signal());
  assert.equal(await readFile(source, 'utf8'), 'verified replacement');
  assert.deepEqual(
    calls.slice(-4).map((args) => args[0]),
    ['check', 'convert', 'check', 'compare'],
  );
  assert.ok(calls.some((args) => args[0] === 'convert' && args.includes('-c')));
  assert.ok((await diskMaintenanceState(id)).successes.compact);
  assert.ok(!(await readdir(vmDir(id))).some((name) => name.includes('compact')));
  await writeFile(join(vmDir(id), 'disk.qcow2.before-compact'), 'recovery');
  await assert.rejects(runDiskMaintenance(machines, id, 'compact', signal()), /上次整理/);
  assert.equal(await readFile(join(vmDir(id), 'disk.qcow2.before-compact'), 'utf8'), 'recovery');
});

test('scheduled maintenance persists separate TRIM/compact intervals and respects windows, snapshots and restart', async () => {
  const { machines, id, calls } = await fixture();
  const now = Date.now();
  await saveDiskMaintenancePolicy(machines, id, { enabled: true, intervalHours: 24 });
  let maintenance = new Maintenance(machines);
  try {
    await saveMaintenancePolicy(id, {
      enabled: true,
      windows: [{ days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'UTC', start: '00:00', end: '00:00' }],
    });
    await maintenance.tick(now);
    assert.equal(calls.length, 0);
    await saveMaintenancePolicy(id, { enabled: false, windows: [] });
    machines.get(id).pendingResize = true;
    await maintenance.tick(now);
    assert.equal(calls.length, 0);
    machines.get(id).pendingResize = false;
    await maintenance.tick(now);
    await maintenance.jobs.wait(id);
    assert.equal(maintenance.jobs.view(id)!.status, 'done');
    const count = calls.length;
    await maintenance.close();
    maintenance = new Maintenance(machines);
    await maintenance.tick(now + 3600000);
    assert.equal(calls.length, count);
    const state = await diskMaintenanceState(id);
    assert.equal(diskMaintenanceDue(state, 'stopped', now + 3600000), null);
    assert.equal(diskMaintenanceDue(state, 'running', now + 3600000), 'trim');
    state.attempts.trim = { startedAt: new Date(now).toISOString(), error: 'failed' };
    assert.equal(diskMaintenanceDue(state, 'running', now + 60000), null);
    assert.equal(diskMaintenanceDue(state, 'running', now + 300001), 'trim');
  } finally {
    await maintenance.close();
  }
});

test('TRIM checks discard and propagates guest failures without recording a successful run', async () => {
  const { machines, id } = await fixture();
  machines.get(id).hardware!.devices!.discard = false;
  await assert.rejects(saveDiskMaintenancePolicy(machines, id, { enabled: true }), /discard/);
  await assert.rejects(runDiskMaintenance(machines, id, 'trim', signal()), /运行中的实例/);
  machines.live.set(id, { status: 'running' } as any);
  machines.exec = async () => ({ code: 1, stdout: '', stderr: 'TRIM is not supported' });
  await assert.rejects(runDiskMaintenance(machines, id, 'trim', signal()), /discard/);
  machines.get(id).hardware!.devices!.discard = true;
  await assert.rejects(runDiskMaintenance(machines, id, 'trim', signal()), /TRIM is not supported/);
  assert.equal((await diskMaintenanceState(id)).successes.trim, undefined);
  machines.exec = async () => ({ code: 0, stdout: '/: 1234 bytes trimmed', stderr: '' });
  await runDiskMaintenance(machines, id, 'trim', signal());
  assert.ok((await diskMaintenanceState(id)).successes.trim);
  machines.live.delete(id);
});
