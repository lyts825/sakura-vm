import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Machines } from '../server/machines.ts';
import type { Project } from '../server/workspaces.ts';
import { AppError } from '../server/model.ts';
import { ProjectRunScopes } from '../server/project-run-scope.ts';
import { projectIdentitySchema, projectIdentityRunSchema } from '../server/project-identity.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-run-scope-'));
after(() => rm(root, { recursive: true, force: true }));

async function fixture() {
  const directory = await mkdtemp(join(root, 'owned-')), vmId = randomUUID(), identityId = randomUUID();
  const identity = projectIdentitySchema.parse({ version: 1, phase: 'active', registryId: randomUUID(),
    projectId: 'default', identityId, revision: 1, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
    uid: 20000, gid: 20000, home: '/var/lib/sakura-project-homes/' + identityId,
    directory: '/workspace/owned', directoryDevice: '1', directoryInode: '2', homeDevice: '1', homeInode: '3', networkIsolation: 'host' });
  let actual = { ...identity }, absent = true, missing = false, unknown = false, cleanupFail = false, migration = false;
  let directoryLatch: unknown = null;
  const bootId = randomUUID(), owner = { kind: 'task' as const, runId: randomUUID(), bootId };
  let currentBoot: string = bootId;
  const run = projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'inherit-current',
    registryId: identity.registryId, identityId, projectId: 'default', runId: owner.runId, revision: 1,
    bootId, build: 'a'.repeat(64), networkDevice: '4', networkInode: '5', cgroupDevice: '6', cgroupInode: '7',
    cgroupName: 'sakura-task-' + owner.runId, namespace: '' });
  const calls: string[] = [], expected: unknown[] = [], instance = {}, locks = new Map<string, Promise<unknown>>();
  const machines = {
    live: new Map([[vmId, instance]]),
    locked: async <T>(key: string, action: () => Promise<T>) => {
      const operation = (locks.get(key) || Promise.resolve()).catch(() => {}).then(action);
      locks.set(key, operation);
      try { return await operation; } finally { if (locks.get(key) === operation) locks.delete(key); }
    },
    exec: async (_id: string, command: string) => {
      if (command.includes('/var/lib/sakura/project-directory-migrations/'))
        return { code: 0, stderr: '', stdout: JSON.stringify(directoryLatch) };
      if (command.trim().endsWith('/proc/sys/kernel/random/boot_id'))
        return { code: 0, stderr: '', stdout: currentBoot };
      assert.ok(!command.includes('private-frame-value')); calls.push('confirm');
      return { code: absent ? 0 : 1, stderr: absent ? '' : 'scope exists',
        stdout: JSON.stringify({ bootId: currentBoot, absent: true }) };
    },
  } as unknown as Machines;
  const core = {
    ensure: async (_vm: string, _binding: unknown, prior: unknown) => {
      calls.push('ensure'); expected.push(prior);
      if (migration) throw new AppError('migration', 409, 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED');
      return { ...actual };
    },
    inspect: async (): Promise<typeof identity | null> => { calls.push('inspect'); return { ...actual }; },
    rebind: async (_vm: string, old: typeof identity, next: { directory: string; networkIsolation: 'host' | 'private' }) => {
      calls.push('rebind'); actual = { ...old, ...next, revision: old.revision + 1, directoryInode: '99' }; return { ...actual };
    },
    inheritedInput: async (_identity: unknown, execution: { command: string }) => {
      calls.push('payload'); const input = Buffer.from(execution.command);
      return { command: '/fixed/launch --payload ' + createHash('sha256').update(input).digest('hex'), input,
        sha256: createHash('sha256').update(input).digest('hex'), runId: owner.runId };
    },
    run: async () => {
      calls.push('run');
      if (unknown) throw new AppError('lost reply', 502, 'PROJECT_IDENTITY_CONTROL_FAILED');
      if (missing) throw new AppError('absent', 409, 'PROJECT_IDENTITY_RECORD_ABSENT');
      return { ...run };
    },
    runReadonly: async () => { calls.push('run-readonly'); return { ...run }; },
    stop: async () => {
      calls.push('stop');
      if (cleanupFail) throw new AppError('not confirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      return { ...run, phase: 'closed' as const };
    },
  };
  const scopes = new ProjectRunScopes(machines, { identities: core, rootDirectory: directory });
  const project = { directory: identity.directory, networkIsolation: 'host' } as Project;
  const file = join(directory, 'project-identities', 'default.json');
  const view = async () => JSON.parse(await readFile(file, 'utf8'));
  return { scopes, machines, core, identity, owner, run, project, vmId, file, view, calls, expected,
    setAbsent: (value: boolean) => { absent = value; }, setMissing: (value: boolean) => { missing = value; },
    setUnknown: (value: boolean) => { unknown = value; }, setCleanupFail: (value: boolean) => { cleanupFail = value; },
    setMigration: (value: boolean) => { migration = value; }, setIdentity: (value: typeof identity) => { actual = value; },
    setDirectoryLatch: (value: unknown) => { directoryLatch = value; },
    setBoot: (value: string) => { currentBoot = value; },
    reopened: () => new ProjectRunScopes(machines, { identities: core, rootDirectory: directory }) };
}

test('identities and inherited intents survive manager reload without persisting payload bodies', async () => {
  const f = await fixture();
  const payload = await f.scopes.inherited(f.vmId, f.project,
    { command: 'private-frame-value', environment: { TOKEN: 'private-environment' } }, f.owner);
  assert.equal(payload.input.toString(), 'private-frame-value');
  assert.ok(!payload.command.includes('private-frame-value'));
  const text = await readFile(f.file, 'utf8');
  assert.ok(!text.includes('private-frame-value') && !text.includes('private-environment'));
  assert.deepEqual((await f.view()).runs[0].identity, f.identity);
  assert.equal(await f.reopened().hasRun(f.vmId, 'default', f.owner.runId), true);
  await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  await f.reopened().identity(f.vmId, f.project);
  assert.deepEqual(f.expected[1], { registryId: f.identity.registryId, identityId: f.identity.identityId, revision: 1 });
});

test('a fixed reservation can be previewed but cannot execute before directory migration', async () => {
  const f = await fixture(); f.setMigration(true); f.setIdentity({ ...f.identity, phase: 'intent' });
  const intent = await f.scopes.reserve(f.vmId, f.project);
  assert.equal(intent.phase, 'intent');
  await assert.rejects(f.scopes.inherited(f.vmId, f.project, { command: 'must-not-run' }, f.owner),
    { code: 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED' });
  assert.equal(f.calls.includes('payload'), false);
  assert.equal((await f.view()).runs.length, 0);
  f.setMigration(false); f.setIdentity(f.identity);
  assert.equal((await f.scopes.identity(f.vmId, f.project)).identityId, intent.identityId);
});

test('a typed directory refusal and verified absent first binding do not permanently pin an invalid path', async () => {
  const f = await fixture(); f.setMigration(true);
  f.core.inspect = async () => null;
  await assert.rejects(f.scopes.reserve(f.vmId, f.project), { code: 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED' });
  assert.equal((await f.view()).pending, null); assert.equal((await f.view()).identity, null);
  const next = { ...f.project, directory: '/srv/projects/existing' };
  f.setMigration(false); f.setIdentity({ ...f.identity, directory: next.directory });
  assert.equal((await f.reopened().identity(f.vmId, next)).directory, next.directory);
});

test('full identity fields remain pinned across reload even when IDs and revision match', async () => {
  const f = await fixture(); await f.scopes.identity(f.vmId, f.project);
  f.setIdentity({ ...f.identity, homeInode: '999' });
  await assert.rejects(f.reopened().identity(f.vmId, f.project), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal((await f.view()).identity.homeInode, '3');
  await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_BINDING_PENDING' });
});

test('live outer domains prevent ticket closure and leave the journal unchanged', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  f.setAbsent(false); const before = await readFile(f.file, 'utf8');
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.calls.includes('run'), false);
});

test('closure reads the exact guest ticket only after confirming the outer domain stopped', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  f.calls.length = 0;
  await f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  assert.deepEqual(f.calls, ['confirm', 'run', 'confirm', 'stop']);
  const journal = await f.view(); assert.equal(journal.runs[0].phase, 'closed');
  assert.equal(journal.runs[0].run.phase, 'closed'); await f.scopes.guard(f.vmId, 'default');
  const count = f.calls.length; await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  assert.equal(f.calls.length, count, 'confirmed retirement is idempotent');
});

test('an unknown control failure is never accepted as a ticket that did not start', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  f.setUnknown(true);
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal((await f.view()).runs[0].phase, 'intent'); assert.equal(f.calls.includes('stop'), false);
  f.setUnknown(false); f.setMissing(true);
  await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  assert.equal((await f.view()).runs[0].phase, 'closed'); assert.equal((await f.view()).runs[0].run, null);
});

test('a lost stop acknowledgement pins the full ticket and cannot later accept RECORD_ABSENT', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  f.setCleanupFail(true);
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal((await f.view()).runs[0].phase, 'active');
  assert.deepEqual((await f.view()).runs[0].run, f.run);
  f.setMissing(true); f.setCleanupFail(false);
  await assert.rejects(f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  f.setMissing(false); await f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  assert.equal((await f.view()).runs[0].phase, 'closed');
});

test('a mismatched outer domain or identity ticket cannot be retired', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  const original = f.core.run; f.core.run = async () => ({ ...f.run, cgroupName: 'sakura-main-' + f.owner.runId });
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal((await f.view()).runs[0].phase, 'intent'); f.core.run = original;
  f.machines.live.set(f.vmId, {} as never);
  // Replacement before cleanup begins is a current live instance. Subsequent
  // changes during the actual receipt check are what must invalidate cleanup.
  const exec = f.machines.exec; f.machines.exec = async (...args) => {
    const result = await exec(...args); f.machines.live.set(f.vmId, {} as never); return result;
  };
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
});

test('a controller refusal before issuance is typed only after the exact unissued task intent closes', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  f.setMissing(true); await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  f.calls.length = 0;
  await assert.rejects(f.scopes.assertTaskIssued(f.vmId, 'default', f.owner.runId,
    { code: 1, stdout: '{"ok":false,"code":"DIRECTORY_MIGRATION_IDENTITY","detail":null}', stderr: '' }),
    { code: 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_IDENTITY', status: 409 });
  await assert.rejects(f.scopes.assertTaskIssued(f.vmId, 'default', f.owner.runId,
    { code: 0, stdout: '', stderr: '' }), { code: 'PROJECT_IDENTITY_LAUNCH_UNCONFIRMED' });
  assert.deepEqual(f.calls, [], 'receipt classification performs no guest mutations or probes');
});

test('issued task output that resembles a controller refusal remains an ordinary user exit', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  const result = { code: 1, stdout: '{"ok":false,"code":"DIRECTORY_MIGRATION_IDENTITY","detail":null}', stderr: '' };
  await assert.rejects(f.scopes.assertTaskIssued(f.vmId, 'default', f.owner.runId, result),
    { code: 'PROJECT_IDENTITY_LAUNCH_UNCONFIRMED' });
  await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  f.calls.length = 0; await f.reopened().assertTaskIssued(f.vmId, 'default', f.owner.runId, result);
  assert.deepEqual(f.calls, []);
});

test('bindings only advance after runs stop and a lost rebind reply is recovered by exact next revision', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  const next = { ...f.project, directory: '/workspace/next' };
  await assert.rejects(f.scopes.identity(f.vmId, next), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  const original = f.core.rebind; f.core.rebind = async (...args) => {
    await original(...args); throw new AppError('reply lost', 502, 'PROJECT_IDENTITY_CONTROL_FAILED');
  };
  await assert.rejects(f.scopes.identity(f.vmId, next), { code: 'PROJECT_IDENTITY_CONTROL_FAILED' });
  assert.equal((await f.view()).pending.kind, 'rebind');
  assert.equal((await f.reopened().identity(f.vmId, next)).revision, 2);
  assert.equal((await f.view()).pending, null);
});

test('corrupt host records and escaped lock access refuse operations instead of resetting state', async () => {
  const f = await fixture(); await f.scopes.identity(f.vmId, f.project);
  let access!: Parameters<Parameters<ProjectRunScopes['withLock']>[2]>[0];
  await f.scopes.withLock(f.vmId, 'default', async value => { access = value; });
  await assert.rejects(access.identity(f.project), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  await writeFile(f.file, '{bad', 'utf8');
  await assert.rejects(f.scopes.reserve(f.vmId, f.project), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(await readFile(f.file, 'utf8'), '{bad');
});

test('pending or corrupt migration latches stop payload admission while the explicit migration closure can activate its account', async () => {
  const f = await fixture(); f.setDirectoryLatch({ invalid: true });
  await assert.rejects(f.scopes.inherited(f.vmId, f.project, { command: 'must-not-run' }, f.owner),
    { code: 'PROJECT_DIRECTORY_LATCH_CHANGED' });
  assert.equal(f.calls.includes('payload'), false); assert.equal((await f.view()).runs.length, 0);
  await f.scopes.withLock(f.vmId, 'default', async access => {
    assert.equal((await access.identity(f.project)).identityId, f.identity.identityId);
  });
});

test('idempotent start requires an active pinned guest ticket, not just an intent in host storage', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  f.setMissing(true); assert.equal(await f.scopes.active(f.vmId, 'default', f.owner.runId), false);
  assert.equal((await f.view()).runs[0].phase, 'intent');
  f.setMissing(false); assert.equal(await f.scopes.active(f.vmId, 'default', f.owner.runId), true);
  assert.deepEqual((await f.view()).runs[0].run, f.run);
  f.setMissing(true); await assert.rejects(f.scopes.active(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_RECORD_ABSENT' });
});

test('readonly account state performs no install, mutation, or host receipt advancement', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  const before = await readFile(f.file, 'utf8'); f.calls.length = 0;
  assert.equal(await f.scopes.readonlyActive(f.vmId, 'default', f.owner.runId), true);
  assert.deepEqual(f.calls, ['run-readonly']); assert.equal(await readFile(f.file, 'utf8'), before);
  f.core.runReadonly = async () => ({ ...f.run, bootId: randomUUID() });
  await assert.rejects(f.scopes.readonlyActive(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(await readFile(f.file, 'utf8'), before);
});

test('a stable different kernel boot retires the old host scope without forging or stopping its guest ticket', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  assert.equal(await f.scopes.active(f.vmId, 'default', f.owner.runId), true);
  const bootId = randomUUID(); f.setBoot(bootId); f.setMissing(true); f.calls.length = 0;
  await f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  assert.deepEqual(f.calls, ['confirm', 'confirm']);
  const entry = (await f.view()).runs[0]; assert.equal(entry.phase, 'closed');
  assert.deepEqual(entry.run, f.run, 'the original active guest receipt is preserved');
  assert.deepEqual(entry.retirement, { reason: 'guest-reboot', bootId });
  await f.reopened().guard(f.vmId, 'default');
});

test('boot changes during retirement or a replacement outer domain keep the old ticket unconfirmed', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  await f.scopes.active(f.vmId, 'default', f.owner.runId); f.setBoot(randomUUID()); f.setAbsent(false);
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  f.setAbsent(true); const before = await readFile(f.file, 'utf8'), exec = f.machines.exec;
  f.machines.exec = async (...args) => { const result = await exec(...args); f.setBoot(randomUUID()); return result; };
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.calls.includes('stop'), false);
});

test('recovering stopped one-shot tasks retries exact closure and does not retire main or service ownership', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  const journal = await f.view(), task = journal.runs[0], mainId = randomUUID(), serviceId = randomUUID();
  journal.runs.push({ ...task, runId: mainId, owner: { ...task.owner, kind: 'main', runId: mainId } },
    { ...task, runId: serviceId, owner: { ...task.owner, kind: 'service', runId: serviceId } });
  await writeFile(f.file, JSON.stringify(journal)); f.setAbsent(false);
  await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal((await f.view()).runs[0].phase, 'intent');
  f.setAbsent(true); f.calls.length = 0;
  await f.reopened().recoverStoppedTasks(f.vmId, 'default');
  assert.deepEqual(f.calls, ['confirm', 'run', 'confirm', 'stop']);
  const current = await f.view(); assert.equal(current.runs[0].phase, 'closed');
  assert.equal(current.runs[1].phase, 'intent'); assert.equal(current.runs[2].phase, 'intent');
});

async function fullClosedJournal(f: Awaited<ReturnType<typeof fixture>>) {
  await f.scopes.inherited(f.vmId, f.project, { command: 'true' }, f.owner);
  await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  const journal = await f.view(), original = journal.runs[0];
  journal.runs = Array.from({ length: 1024 }, (_, index) => {
    const runId = index === 0 ? f.owner.runId : randomUUID();
    return { ...original, runId, owner: { ...original.owner, runId },
      run: { ...original.run, runId, cgroupName: 'sakura-task-' + runId } };
  });
  await writeFile(f.file, JSON.stringify(journal), 'utf8');
  return journal;
}
const archivePath = (f: Awaited<ReturnType<typeof fixture>>, runId: string) =>
  join(f.file.slice(0, -'default.json'.length), 'default', 'closed-runs', runId + '.json');

test('full closed history is archived durably and old run UUIDs cannot execute again after reload', async () => {
  const f = await fixture(), journal = await fullClosedJournal(f), next = { ...f.owner, runId: randomUUID() };
  await f.reopened().inherited(f.vmId, f.project, { command: 'next task' }, next);
  const current = await f.view(); assert.equal(current.runs.length, 513);
  assert.equal(current.runs.at(-1).runId, next.runId);
  assert.deepEqual(JSON.parse(await readFile(archivePath(f, f.owner.runId), 'utf8')), journal.runs[0]);
  assert.equal(await f.reopened().hasRun(f.vmId, 'default', f.owner.runId), true);
  f.calls.length = 0;
  await f.reopened().closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  assert.equal(await f.reopened().readonlyActive(f.vmId, 'default', f.owner.runId), false);
  assert.deepEqual(f.calls, [], 'known closed history performs no guest operations');
  await assert.rejects(f.reopened().inherited(f.vmId, f.project, { command: 'replayed task' }, f.owner),
    { code: 'PROJECT_IDENTITY_RUN_STALE' });
  assert.equal((await f.view()).runs.length, 513);
});

test('an interrupted archive retains every journal entry and verifies prior writes before retry', async () => {
  const f = await fixture(), journal = await fullClosedJournal(f);
  await mkdir(join(f.file.slice(0, -'default.json'.length), 'default', 'closed-runs'), { recursive: true });
  await writeFile(archivePath(f, journal.runs[0].runId), JSON.stringify(journal.runs[0]));
  await writeFile(archivePath(f, journal.runs[1].runId), JSON.stringify({ ...journal.runs[1], sha256: 'b'.repeat(64) }));
  const before = await readFile(f.file, 'utf8');
  await assert.rejects(f.reopened().inherited(f.vmId, f.project, { command: 'next' }, { ...f.owner, runId: randomUUID() }),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.deepEqual((await f.view()).runs, JSON.parse(before).runs);
  await writeFile(archivePath(f, journal.runs[1].runId), JSON.stringify(journal.runs[1]));
  await f.reopened().inherited(f.vmId, f.project, { command: 'retry' }, { ...f.owner, runId: randomUUID() });
  assert.equal((await f.view()).runs.length, 513);
});

test('corrupt or nonclosed archives are errors and never treated as missing history', async () => {
  const f = await fixture(); await f.scopes.identity(f.vmId, f.project);
  const path = archivePath(f, f.owner.runId);
  await mkdir(join(f.file.slice(0, -'default.json'.length), 'default', 'closed-runs'), { recursive: true });
  await writeFile(path, '{bad');
  await assert.rejects(f.scopes.hasRun(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.deepEqual(f.calls, ['ensure']);
  await writeFile(path, 'null');
  await assert.rejects(f.scopes.hasRun(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  await writeFile(path, JSON.stringify({ version: 1, projectId: 'default', identity: f.identity, runId: f.owner.runId,
    owner: f.owner, sha256: 'a'.repeat(64), phase: 'active', run: f.run }));
  await assert.rejects(f.scopes.hasRun(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
});

function networkCore(f: Awaited<ReturnType<typeof fixture>>) {
  const leases = new Map<string, { version: 1; phase: 'pending'; releaseId: string; network: {
    version: 1; projectId: string; registryId: string; identityId: string; revision: number; bootId: string;
    namespace: string; networkDevice: string; networkInode: string; generation: string } }>();
  const state = { loseBegin: false, loseRelease: false, absent: false, begins: [] as string[], releases: [] as string[] };
  Object.assign(f.core, {
    beginNetworkRelease: async (_vm: string, identity: typeof f.identity, options: { releaseId: string; bootId: string }) => {
      state.begins.push(options.releaseId);
      if (state.absent) return null;
      let lease = leases.get(options.releaseId);
      if (!lease) {
        lease = { version: 1, phase: 'pending', releaseId: options.releaseId, network: { version: 1,
          projectId: identity.projectId, registryId: identity.registryId, identityId: identity.identityId,
          revision: identity.revision, bootId: options.bootId, namespace: 'sk-' + identity.projectId,
          networkDevice: '4', networkInode: '5', generation: randomUUID() } };
        leases.set(options.releaseId, lease);
      }
      if (state.loseBegin) throw new AppError('begin acknowledgement lost', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      return lease;
    },
    releaseNetwork: async (_vm: string, _identity: typeof f.identity, lease: NonNullable<ReturnType<typeof leases.get>>) => {
      state.releases.push(lease.releaseId);
      assert.deepEqual(lease, leases.get(lease.releaseId));
      if (state.loseRelease) throw new AppError('release acknowledgement lost', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      return { version: 1, phase: 'released', releaseId: lease.releaseId, network: lease.network };
    },
  });
  return state;
}
async function privateNetworkFixture() {
  const f = await fixture(); f.project.networkIsolation = 'private'; f.identity.networkIsolation = 'private';
  f.setIdentity({ ...f.identity }); f.run.namespace = 'sk-default'; return f;
}

test('network release captures one generation before stop and blocks admissions until its exact completion', async () => {
  const f = await privateNetworkFixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'old run' }, f.owner);
  const state = networkCore(f), intent = await f.scopes.beginNetworkRelease(f.vmId, 'default'); assert.ok(intent?.lease);
  assert.deepEqual((await f.view()).networkRelease.intent, intent);
  await assert.rejects(f.reopened().identity(f.vmId, f.project), { code: 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING' });
  await assert.rejects(f.reopened().assertAdmission(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING' });
  f.setAbsent(false);
  await assert.rejects(f.reopened().releaseNetwork(f.vmId, 'default', intent), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.deepEqual(state.releases, []);
  f.setAbsent(true); await f.scopes.closeAfterScopeStopped(f.vmId, 'default', f.owner.runId);
  await f.reopened().releaseNetwork(f.vmId, 'default', intent);
  assert.equal((await f.view()).networkRelease.phase, 'released');
  assert.deepEqual(state.releases, [intent.releaseId]); await f.scopes.assertAdmission(f.vmId, 'default');
  await f.scopes.releaseNetwork(f.vmId, 'default', intent); assert.deepEqual(state.releases, [intent.releaseId]);
});

test('lost network begin and release replies preserve UUID and generation across manager reload', async () => {
  const f = await privateNetworkFixture(); await f.scopes.identity(f.vmId, f.project); const state = networkCore(f);
  state.loseBegin = true;
  await assert.rejects(f.scopes.beginNetworkRelease(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED' });
  const original = (await f.view()).networkRelease; assert.equal(original.phase, 'intent'); assert.equal(original.intent.lease, null);
  state.loseBegin = false; const intent = await f.reopened().beginNetworkRelease(f.vmId, 'default'); assert.ok(intent?.lease);
  assert.equal(intent.releaseId, original.intent.releaseId); assert.deepEqual(state.begins, [intent.releaseId, intent.releaseId]);
  state.loseRelease = true;
  await assert.rejects(f.reopened().releaseNetwork(f.vmId, 'default', intent), { code: 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED' });
  assert.equal((await f.view()).networkRelease.phase, 'pending');
  state.loseRelease = false; await f.reopened().releaseNetwork(f.vmId, 'default', intent);
  assert.deepEqual(state.releases, [intent.releaseId, intent.releaseId]);
  const next = await f.reopened().beginNetworkRelease(f.vmId, 'default'); assert.ok(next?.lease);
  assert.notEqual(next.releaseId, intent.releaseId); assert.notEqual(next.lease.network.generation, intent.lease.network.generation);
  const count = state.releases.length;
  await assert.rejects(f.reopened().releaseNetwork(f.vmId, 'default', intent), { code: 'PROJECT_IDENTITY_NETWORK_STALE' });
  assert.equal(state.releases.length, count, 'late cleanup never follows the new generation');
});

test('a managed absent network is retained as an intent and never falls through to legacy deletion', async () => {
  const f = await privateNetworkFixture(); assert.equal(await f.scopes.beginNetworkRelease(f.vmId, 'default'), null);
  await f.scopes.identity(f.vmId, f.project); const state = networkCore(f); state.absent = true;
  const intent = await f.scopes.beginNetworkRelease(f.vmId, 'default'); assert.ok(intent); assert.equal(intent.lease, null);
  await f.scopes.releaseNetwork(f.vmId, 'default', intent); assert.deepEqual(state.releases, []);
  assert.equal((await f.view()).networkRelease.phase, 'released');
});

test('a lost begin reply followed by a different boot cannot capture or delete a current namespace', async () => {
  const f = await privateNetworkFixture(); await f.scopes.identity(f.vmId, f.project); const state = networkCore(f); state.loseBegin = true;
  await assert.rejects(f.scopes.beginNetworkRelease(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED' });
  const original = (await f.view()).networkRelease.intent;
  f.setBoot(randomUUID()); f.setAbsent(false);
  await assert.rejects(f.reopened().beginNetworkRelease(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED' });
  assert.equal(state.begins.length, 1);
  f.setAbsent(true); const intent = await f.reopened().beginNetworkRelease(f.vmId, 'default'); assert.ok(intent);
  assert.deepEqual(intent, original); assert.equal(intent.lease, null); assert.equal(state.begins.length, 1);
  await f.scopes.releaseNetwork(f.vmId, 'default', intent); assert.deepEqual(state.releases, []);
});
