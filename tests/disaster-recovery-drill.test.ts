import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Backups } from '../server/backups.ts';
import type { Bundles } from '../server/bundles.ts';
import { DisasterRecoveryDrill } from '../server/disaster-recovery-drill.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-drill-test-'));
assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
after(async () => { await rm(root, { recursive: true, force: true }); });
const file = join(root, 'backup.sakura');
await writeFile(file, 'verified-backup');
const sourceId = randomUUID(), backupId = randomUUID();
const expected = createHash('sha256').update('restored-data').digest('hex');

function fixture(probeCode = 0, hash = expected) {
  const calls: string[] = [];
  const temporaryId = randomUUID();
  let status = 'stopped';
  const machines = {
    get: (id: string) => ({ id, name: id === sourceId ? 'source' : 'drill-copy' }),
    requireUnlocked: () => {},
    start: async (id: string) => { calls.push('start:' + id); status = 'running'; },
    state: () => status,
    exec: async (_id: string, command: string) => {
      calls.push('probe:' + command);
      return { code: probeCode, stdout: `${hash}  /workspace/proof.txt\n`, stderr: '' };
    },
    stop: async (id: string) => { calls.push('stop:' + id); status = 'stopped'; },
    delete: async (id: string) => { calls.push('delete:' + id); },
  } as unknown as Machines;
  const backups = {
    view: async () => ({ items: [{ id: backupId, createdAt: new Date().toISOString(),
      bytes: 15, encrypted: false, storage: 'file', verifiedAt: undefined }] }),
    withVerifiedFile: async (_id: string, _backupId: string, _password: undefined,
      _signal: AbortSignal, work: (file: string) => Promise<unknown>) => {
      calls.push('verify');
      return work(file);
    },
  } as unknown as Backups;
  const bundles = {
    import: async (name: string) => { calls.push('import:' + name); return { id: temporaryId }; },
  } as unknown as Bundles;
  return { service: new DisasterRecoveryDrill(machines, backups, bundles), calls, temporaryId };
}

test('drill verifies a backup, boots a temporary VM, checks a file hash and removes it', async () => {
  const { service, calls, temporaryId } = fixture();
  const status = await service.run(sourceId, { mode: 'status' }, 'check');
  assert.ok('backups' in status);
  assert.equal(status.backups[0].id, backupId);
  const result = await service.run(sourceId, { mode: 'run', backupId,
    probePath: '/workspace/proof.txt', expectedSha256: expected }, 'run');
  assert.ok('temporaryVmRemoved' in result);
  assert.equal(result.ready, true);
  assert.equal(result.temporaryVmRemoved, true);
  assert.equal(result.probeSha256, expected);
  assert.deepEqual(calls.slice(0, 3).map((call) => call.split(':')[0]),
    ['verify', 'import', 'start']);
  assert.equal(calls.at(-2), 'stop:' + temporaryId);
  assert.equal(calls.at(-1), 'delete:' + temporaryId);
});

test('a mismatched file hash fails the drill but still removes its temporary VM', async () => {
  const { service, calls, temporaryId } = fixture(0, '0'.repeat(64));
  const result = await service.run(sourceId, { mode: 'run', backupId,
    probePath: '/workspace/proof.txt', expectedSha256: expected }, 'run');
  assert.ok('temporaryVmRemoved' in result);
  assert.equal(result.ready, false);
  assert.match(result.error || '', /不匹配/);
  assert.equal(result.temporaryVmRemoved, true);
  assert.equal(calls.at(-1), 'delete:' + temporaryId);
});

test('invalid backup and unsafe probe paths fail before creating a temporary VM', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.run(sourceId, { mode: 'run' }, 'run'), /请选择/);
  await assert.rejects(service.run(sourceId,
    { mode: 'run', backupId, probePath: '../../host' }, 'run'), /绝对路径/);
  await assert.rejects(service.run(sourceId,
    { mode: 'run', backupId, expectedSha256: expected }, 'run'), /检查文件路径/);
  assert.deepEqual(calls, []);
});
