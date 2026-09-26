import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { withinWindow } from '../shared/time-windows.ts';
import { ByteRate } from '../server/byte-rate.ts';
import type { Engine } from '../server/runtime.ts';
import type { Bundles } from '../server/bundles.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-automation-controls-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Backups, backupLocked } = await import('../server/backups.ts');
const { saveMaintenancePolicy, inMaintenance, timeWindowSchema } =
  await import('../server/automation-policy.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-automation-controls-'));
  await rm(root, { recursive: true, force: true });
});

test('weekly windows handle overnight day boundaries, timezones and repeated DST hours', () => {
  const overnight = { days: [1], start: '22:00', end: '02:00', timeZone: 'Asia/Shanghai' };
  assert.equal(withinWindow(overnight, Date.parse('2026-09-28T14:00:00Z')), true);
  assert.equal(withinWindow(overnight, Date.parse('2026-09-28T17:59:00Z')), true);
  assert.equal(withinWindow(overnight, Date.parse('2026-09-28T18:00:00Z')), false);
  assert.equal(withinWindow(overnight, Date.parse('2026-09-27T17:00:00Z')), false);
  const dst = { days: [0], start: '01:00', end: '02:00', timeZone: 'America/New_York' };
  for (const at of ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'])
    assert.equal(withinWindow(dst, Date.parse(at)), true);
  assert.equal(
    withinWindow({ ...overnight, start: '00:00', end: '00:00' }, Date.parse('2026-09-28T05:00:00Z')),
    true,
  );
  assert.equal(timeWindowSchema.safeParse({ ...overnight, days: [1, 1] }).success, false);
  assert.equal(timeWindowSchema.safeParse({ ...overnight, timeZone: 'not-a-zone' }).success, false);
});

test('byte budgets constrain real stream throughput and cancel waiting transfers promptly', async () => {
  const rate = new ByteRate(2048),
    chunks: Buffer[] = [];
  const start = performance.now();
  await pipeline(
    Readable.from([Buffer.alloc(256), Buffer.alloc(256)]),
    rate.stream(new AbortController().signal),
    new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    }),
  );
  assert.equal(Buffer.concat(chunks).length, 512);
  assert.ok(performance.now() - start >= 225, '512 bytes must consume at least their transmission budget');
  const controller = new AbortController();
  const interrupted = pipeline(
    Readable.from([Buffer.alloc(1024)]),
    new ByteRate(1).stream(controller.signal),
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
    { signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(interrupted, /abort/i);
});

test('backup retention survives policy changes and restart, protects pruning, and expires', async (t) => {
  const id = randomUUID(),
    machines = new Machines({} as Engine);
  machines.get = () => ({ id, name: 'backup-lock' }) as ReturnType<typeof machines.get>;
  const payload = Buffer.from('actual backup payload'),
    manifest = Buffer.from(JSON.stringify({ sha256: createHash('sha256').update(payload).digest('hex') }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(manifest.length);
  const bytes = Buffer.concat([Buffer.from('SAKURA01'), length, manifest, payload]);
  const bundles = {
    export: async (_id: string, output: Writable) => pipeline(Readable.from([bytes]), output),
  } as unknown as Bundles;
  const backups = new Backups(machines, bundles);
  t.after(() => backups.close());
  await backups.policy(id, { keep: 1, lockDays: 2 });
  for (let index = 0; index < 2; index++) {
    await backups.run(id);
    await backups.jobs.wait(id);
    assert.equal(backups.jobs.view(id)?.status, 'done');
  }
  const locked = (await backups.view(id)).items;
  assert.equal(locked.length, 2);
  assert.equal(backupLocked(locked[0]), true);
  await backups.policy(id, { keep: 1, lockDays: 0 });
  await backups.close();
  const reopened = new Backups(machines, bundles);
  t.after(() => reopened.close());
  await assert.rejects(reopened.operate(id, locked[0].id, 'delete'), { code: 'BACKUP_LOCKED' });
  assert.equal((await reopened.view(id)).items[0].retainUntil, locked[0].retainUntil);
  const file = join(root, 'backups', id, 'index.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.items[0].retainUntil = new Date(Date.now() - 1000).toISOString();
  await writeFile(file, JSON.stringify(saved));
  await reopened.operate(id, locked[0].id, 'delete');
  assert.equal((await reopened.view(id)).items.length, 1);
  assert.equal(backupLocked({ retainUntil: 'corrupt-date' }), true);
});

test('maintenance policy is persisted and actually blocks scheduled backups', async (t) => {
  const id = randomUUID(),
    machines = new Machines({} as Engine);
  machines.records.set(id, { id } as any);
  const backups = new Backups(machines, {} as Bundles);
  t.after(() => backups.close());
  let calls = 0;
  backups.run = async () => {
    calls++;
    return {} as any;
  };
  await backups.policy(id, { enabled: true });
  const now = Date.parse('2026-09-28T09:30:00Z');
  await saveMaintenancePolicy(id, {
    enabled: true,
    windows: [{ days: [1], start: '09:00', end: '10:00', timeZone: 'UTC' }],
  });
  assert.equal(await inMaintenance(id, now), true);
  await backups.tick(now);
  assert.equal(calls, 0);
  await backups.tick(now + 3600000);
  assert.equal(calls, 1);
});
