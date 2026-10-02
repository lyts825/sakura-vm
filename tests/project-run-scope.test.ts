import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Machines } from '../server/machines.ts';
import type { Project } from '../server/workspaces.ts';
import { AppError } from '../server/model.ts';
import { ProjectRunScopes } from '../server/project-run-scope.ts';
import { projectIdentitySchema, projectIdentityRunSchema } from '../server/project-identity.ts';
import { OwnedForwardAgent, type SshAgentContext } from '../server/ssh-agent-scope.ts';
import { OwnedGpgForward } from '../server/gpg-agent-host.ts';
import { gpgAgentHomePath, type GpgAgentContext } from '../server/gpg-agent-scope.ts';
import { syntheticGpgHostSnapshot } from './gpg-agent-fixture.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-run-scope-'));
after(() => rm(root, { recursive: true, force: true }));

async function fixture(agentCleanup?: (context: SshAgentContext) => Promise<void>,
  gpgCleanup?: (context: GpgAgentContext) => Promise<void>) {
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
  const calls: string[] = [], expected: unknown[] = [], instance = {}, locks = new Machines({} as never);
  const machines = {
    live: new Map([[vmId, instance]]),
    locked: locks.locked.bind(locks),
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
    inheritedInput: async (_identity: unknown, execution: { command: string }, options: { runId: string }) => {
      calls.push('payload'); const input = Buffer.from(execution.command);
      return { command: '/fixed/launch --payload ' + createHash('sha256').update(input).digest('hex'), input,
        sha256: createHash('sha256').update(input).digest('hex'), runId: options.runId };
    },
    run: async () => {
      calls.push('run');
      if (unknown) throw new AppError('lost reply', 502, 'PROJECT_IDENTITY_CONTROL_FAILED');
      if (missing) throw new AppError('absent', 409, 'PROJECT_IDENTITY_RECORD_ABSENT');
      return { ...run };
    },
    runReadonly: async () => { calls.push('run-readonly'); return { ...run }; },
    prepare: async (_vm: string, _identity: unknown, options: { runId?: string }) => {
      calls.push('terminal-prepare');
      Object.assign(run, { mode: 'independent', runId: options.runId, cgroupName: 'sakura-identity-' + options.runId });
      return { ...run };
    },
    retireTerminal: async () => { calls.push('terminal-retire'); },
    stop: async () => {
      calls.push('stop');
      if (cleanupFail) throw new AppError('not confirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      if (run.mode === 'independent') run.phase = 'closed';
      return { ...run, phase: 'closed' as const };
    },
  };
  const options = { identities: core, rootDirectory: directory,
    ...(agentCleanup ? { agentScopes: { cleanup: async (_vm: string, context: SshAgentContext) => agentCleanup(context) } } : {}),
    ...(gpgCleanup ? { gpgScopes: { cleanup: async (_vm: string, context: GpgAgentContext) => gpgCleanup(context) } } : {}) };
  const scopes = new ProjectRunScopes(machines, options);
  const project = { directory: identity.directory, networkIsolation: 'host' } as Project;
  const file = join(directory, 'project-identities', 'default.json');
  const view = async () => JSON.parse(await readFile(file, 'utf8'));
  return { scopes, machines, core, identity, owner, run, project, vmId, file, view, calls, expected,
    setAbsent: (value: boolean) => { absent = value; }, setMissing: (value: boolean) => { missing = value; },
    setUnknown: (value: boolean) => { unknown = value; }, setCleanupFail: (value: boolean) => { cleanupFail = value; },
    setMigration: (value: boolean) => { migration = value; }, setIdentity: (value: typeof identity) => { actual = value; },
    setDirectoryLatch: (value: unknown) => { directoryLatch = value; },
    setBoot: (value: string) => { currentBoot = value; },
    reopened: () => new ProjectRunScopes(machines, options) };
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

test('independent terminal tickets persist across reload and require native stop and resource retirement before closure', async () => {
  const f = await fixture(), terminal = { name: 'sakura-terminal-default-main', persistent: true };
  const issued = await f.scopes.prepareTerminal(f.vmId, f.project, f.owner.runId, terminal);
  assert.equal(issued.run.mode, 'independent');
  assert.deepEqual(await f.reopened().terminalRuns(f.vmId, 'default'),
    [{ runId: f.owner.runId, terminal, phase: 'active' }]);
  await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  const checked = await f.reopened().terminalRun(f.vmId, 'default', f.owner.runId); assert.deepEqual(checked.run, issued.run);
  f.calls.length = 0;
  await f.reopened().stopTerminal(f.vmId, 'default', f.owner.runId);
  assert.ok(f.calls.indexOf('stop') < f.calls.indexOf('terminal-retire'));
  assert.ok(f.calls.indexOf('terminal-retire') < f.calls.indexOf('confirm'));
  const closed = (await f.view()).runs[0]; assert.equal(closed.phase, 'closed'); assert.equal(closed.run.phase, 'closed');
  await f.reopened().guard(f.vmId, 'default');
  await assert.rejects(f.scopes.prepareTerminal(f.vmId, f.project, f.owner.runId, terminal), { code: 'PROJECT_IDENTITY_RUN_STALE' });
});

test('terminal resource cleanup failure retains the original full receipt and retries after native already closed', async () => {
  const f = await fixture();
  await f.scopes.prepareTerminal(f.vmId, f.project, f.owner.runId, { name: 'sakura-terminal-default-main', persistent: true });
  const original = (await f.view()).runs[0];
  f.core.retireTerminal = async () => { throw new AppError('resource changed', 409, 'PROJECT_IDENTITY_TERMINAL_SOCKET_CHANGED'); };
  await assert.rejects(f.scopes.stopTerminal(f.vmId, 'default', f.owner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED', status: 503 });
  assert.deepEqual((await f.view()).runs[0], original);
  assert.equal(f.run.phase, 'closed');
  await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  f.core.retireTerminal = async () => { f.calls.push('terminal-retire'); };
  await f.reopened().stopTerminal(f.vmId, 'default', f.owner.runId);
  assert.equal((await f.view()).runs[0].phase, 'closed');
});

test('duplicate terminal labels and foreign owner kinds refuse without issuing or closing another ticket', async () => {
  const f = await fixture(), terminal = { name: 'sakura-terminal-default-main', persistent: true };
  await f.scopes.prepareTerminal(f.vmId, f.project, f.owner.runId, terminal);
  const before = f.calls.filter(call => call === 'terminal-prepare').length;
  await assert.rejects(f.scopes.prepareTerminal(f.vmId, f.project, randomUUID(), terminal), { code: 'PROJECT_IDENTITY_RUN_STALE' });
  assert.equal(f.calls.filter(call => call === 'terminal-prepare').length, before);
  const g = await fixture(); await g.scopes.inherited(g.vmId, g.project, { command: 'fixed' }, g.owner);
  await assert.rejects(g.scopes.stopTerminal(g.vmId, 'default', g.owner.runId), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(g.calls.includes('stop'), false);
});

test('terminal cold-boot recovery retires the original receipt without invoking old native stop', async () => {
  const f = await fixture();
  await f.scopes.prepareTerminal(f.vmId, f.project, f.owner.runId, { name: 'sakura-terminal-default-main', persistent: true });
  const original = (await f.view()).runs[0], reboot = randomUUID(); f.setBoot(reboot); f.calls.length = 0;
  await f.reopened().retireRebootedTerminals(f.vmId, 'default');
  const retired = (await f.view()).runs[0]; assert.equal(retired.phase, 'closed');
  assert.deepEqual(retired.run, original.run);
  assert.deepEqual(retired.retirement, { reason: 'guest-reboot', bootId: reboot });
  assert.equal(f.calls.includes('stop'), false); assert.equal(f.calls.includes('terminal-retire'), false);
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

test('atomic task admission permits two real owners while binding and network guards keep their durable tickets', async () => {
  const f = await fixture(), signal = new AbortController().signal; f.setAbsent(false);
  const first = await f.scopes.admitTask(f.vmId, f.project, { command: 'first' }, signal);
  const second = await f.reopened().admitTask(f.vmId, f.project, { command: 'second' }, signal);
  try {
    assert.notEqual(first.payload.runId, second.payload.runId);
    assert.equal((await f.view()).runs.length, 2);
    f.calls.length = 0;
    await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.deepEqual(f.calls, [], 'confirmed in-process owners are not probed as lost tasks');
    await assert.rejects(f.scopes.guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
    const next = { ...f.project, directory: '/workspace/other' };
    await assert.rejects(f.reopened().identity(f.vmId, next), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
    assert.equal((await f.view()).runs.every((entry: { phase: string }) => entry.phase === 'intent'), true);
    first.release();
    await assert.rejects(f.reopened().admitTask(f.vmId, f.project, { command: 'third' }, signal),
      { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    assert.equal((await f.view()).runs.length, 2, 'a released but populated owner prevents a new payload');
  } finally { first.release(); second.release(); }
});

test('all manager instances queue admission checks behind the same fail-fast Machines lock', async () => {
  const f = await fixture(), signal = new AbortController().signal;
  let entered!: () => void, resume!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { resume = resolve; });
  const ensure = f.core.ensure;
  f.core.ensure = async (...args) => { entered(); await barrier; return ensure(...args); };
  const admission = f.scopes.admitTask(f.vmId, f.project, { command: 'first' }, signal);
  await started;
  assert.equal((await f.view()).pending.kind, 'ensure');
  let checked = false;
  const check = f.reopened().assertAdmission(f.vmId, 'default').then(() => { checked = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(checked, false);
  resume();
  const owner = await admission;
  try { await check; assert.equal(checked, true); }
  finally { owner.release(); }
});

test('cancellation preserves an admitted owner until cleanup and receipt classification explicitly release it', async () => {
  const f = await fixture(), controller = new AbortController(); f.setAbsent(false);
  const owner = await f.scopes.admitTask(f.vmId, f.project, { command: 'sleep' }, controller.signal);
  controller.abort();
  try {
    await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.equal(f.calls.includes('confirm'), false);
    await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  } finally { owner.release(); }
  await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
  f.setAbsent(true); f.setMissing(true);
  await f.reopened().recoverStoppedTasks(f.vmId, 'default');
  assert.equal((await f.view()).runs[0].phase, 'closed');
  await f.reopened().guard(f.vmId, 'default');
});

test('stored task intents never become in-process owners without admission', async () => {
  const f = await fixture(); await f.scopes.inherited(f.vmId, f.project, { command: 'orphan' }, f.owner);
  f.setAbsent(false);
  await assert.rejects(f.reopened().admitTask(f.vmId, f.project, { command: 'new' }, new AbortController().signal),
    { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(f.calls.filter(value => value === 'payload').length, 1);
  assert.equal((await f.view()).runs.length, 1);
});

for (const field of ['sha256', 'owner', 'identity'] as const) {
  test('concurrent recovery refuses a changed admitted ' + field, async () => {
    const f = await fixture(), owner = await f.scopes.admitTask(f.vmId, f.project,
      { command: 'active' }, new AbortController().signal); f.setAbsent(false);
    try {
      const journal = await f.view();
      if (field === 'sha256') journal.runs[0].sha256 = 'b'.repeat(64);
      if (field === 'owner') journal.runs[0].owner.bootId = randomUUID();
      if (field === 'identity') journal.runs[0].identity.homeInode = '999';
      await writeFile(f.file, JSON.stringify(journal));
      await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    } finally { owner.release(); }
  });
}

test('a pinned full native receipt is skipped only while every exact field still matches', async () => {
  const f = await fixture(), owner = await f.scopes.admitTask(f.vmId, f.project,
    { command: 'active' }, new AbortController().signal); f.setAbsent(false);
  f.core.run = async () => ({ ...f.run, runId: owner.payload.runId, cgroupName: 'sakura-task-' + owner.payload.runId });
  try {
    assert.equal(await f.reopened().active(f.vmId, 'default', owner.payload.runId), true);
    await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    const journal = await f.view(); journal.runs[0].run.cgroupInode = '999';
    await writeFile(f.file, JSON.stringify(journal));
    await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  } finally { owner.release(); }
});

for (const change of ['live', 'boot', 'machines'] as const) {
  test('new ' + change + ' state cannot adopt an in-process active task from disk', async () => {
    const f = await fixture(), owner = await f.scopes.admitTask(f.vmId, f.project,
      { command: 'active' }, new AbortController().signal); f.setAbsent(false);
    try {
      if (change === 'live') f.machines.live.set(f.vmId, {} as never);
      if (change === 'boot') f.setBoot(randomUUID());
      const manager = change === 'machines' ? new ProjectRunScopes({ ...f.machines } as Machines,
        { identities: f.core, rootDirectory: dirname(dirname(f.file)) }) : f.reopened();
      // path uses the original host journal; a new Machines object has no active owner.
      await assert.rejects(manager.recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    } finally { owner.release(); }
  });
}

test('admission rejects a changed boot before registration and keeps the exact unexecuted intent recoverable', async () => {
  const f = await fixture(), inherited = f.core.inheritedInput;
  f.core.inheritedInput = async (...args) => { const payload = await inherited(...args); f.setBoot(randomUUID()); return payload; };
  await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must not execute' }, new AbortController().signal),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  const before = await f.view(); assert.equal(before.runs.length, 1); assert.equal(before.runs[0].phase, 'intent');
  await f.reopened().recoverStoppedTasks(f.vmId, 'default');
  assert.equal((await f.view()).runs[0].phase, 'closed');
  assert.equal(f.calls.includes('stop'), false, 'old-boot intent retires without an old guest stop');
});

for (const field of ['runId', 'sha256'] as const) {
  test('admission refuses a mismatched protected payload ' + field + ' before journaling or execution', async () => {
    const f = await fixture(), inherited = f.core.inheritedInput;
    f.core.inheritedInput = async (...args) => ({ ...await inherited(...args),
      [field]: field === 'runId' ? randomUUID() : 'b'.repeat(64) });
    await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must not execute' }, new AbortController().signal),
      { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal((await f.view()).runs.length, 0);
  });
}

test('the captured live instance is mandatory when a prepared task enters the atomic admission', async () => {
  const f = await fixture(), expectedLive = f.machines.live.get(f.vmId)!;
  f.machines.live.set(f.vmId, {} as never);
  await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must not run' },
    new AbortController().signal, { expectedLive }), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.deepEqual(f.calls, []);
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
});

test('a live replacement after durable intent creation keeps the unexecuted ticket and refuses registration', async () => {
  const f = await fixture(), expectedLive = f.machines.live.get(f.vmId)!, execute = f.machines.exec;
  let bootReads = 0;
  f.machines.exec = async (...args) => {
    const result = await execute(...args);
    if (args[1].trim().endsWith('/proc/sys/kernel/random/boot_id') && ++bootReads === 2)
      f.machines.live.set(f.vmId, {} as never);
    return result;
  };
  await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must not run' },
    new AbortController().signal, { expectedLive }), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal((await f.view()).runs[0].phase, 'intent');
  f.setAbsent(false);
  await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
});

test('network retirement cannot use an active task registration to waive the nonclosed-run guard', async () => {
  const f = await privateNetworkFixture(), owner = await f.scopes.admitTask(f.vmId, f.project,
    { command: 'active' }, new AbortController().signal), state = networkCore(f); f.setAbsent(false);
  try {
    const intent = await f.reopened().beginNetworkRelease(f.vmId, 'default'); assert.ok(intent);
    await assert.rejects(f.reopened().releaseNetwork(f.vmId, 'default', intent), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
    assert.deepEqual(state.releases, []);
    await assert.rejects(f.scopes.guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING' });
  } finally { owner.release(); }
});

test('a full ticket pinned during owned cleanup remains in-process until the complete task finally finishes', async () => {
  const f = await fixture(), owner = await f.scopes.admitTask(f.vmId, f.project,
    { command: 'active' }, new AbortController().signal); f.setCleanupFail(true);
  f.core.run = async () => ({ ...f.run, runId: owner.payload.runId, cgroupName: 'sakura-task-' + owner.payload.runId });
  try {
    await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', owner.payload.runId),
      { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    f.calls.length = 0;
    await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.deepEqual(f.calls, [], 'active cleanup does not become an orphan between its retries');
  } finally { owner.release(); }
  await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
});

const agentResource = () => ({ version: 1 as const, kind: 'ssh-agent' as const, leaseId: randomUUID(),
  brokerSha256: 'a'.repeat(64), timeoutSeconds: 60 });

test('Agent resources persist before payload execution and close before the account ticket', async () => {
  const contexts: SshAgentContext[] = [], f = await fixture(async context => { contexts.push(context); f.calls.push('agent-cleanup'); });
  const agent = new OwnedForwardAgent('unit-unused-agent', new AbortController().signal), resource = agentResource();
  const admitted = await f.scopes.admitTask(f.vmId, f.project, { command: 'private-frame-value',
    environment: { SSH_AUTH_SOCK: '/wrong/project/socket' } }, new AbortController().signal,
    { sshAgent: { resource, agent } });
  const runId = admitted.payload.runId;
  f.core.run = async () => { f.calls.push('run'); return { ...f.run, runId, cgroupName: 'sakura-task-' + runId }; };
  f.core.stop = async () => { f.calls.push('stop'); return { ...f.run, runId, cgroupName: 'sakura-task-' + runId, phase: 'closed' }; };
  try {
    const stored = await f.view(); assert.deepEqual(stored.runs[0].sshAgent, resource);
    assert.ok(!JSON.stringify(stored).includes('private-frame-value') && !JSON.stringify(stored).includes('/wrong/project/socket'));
    assert.deepEqual(admitted.agentContext?.identity, f.identity); assert.equal(admitted.agentContext?.owner.runId, runId);
    f.calls.length = 0;
    await f.scopes.closeAfterScopeStopped(f.vmId, 'default', runId);
    assert.equal(contexts.length, 1); assert.equal(contexts[0].resource.leaseId, resource.leaseId);
    assert.ok(f.calls.indexOf('agent-cleanup') > f.calls.indexOf('confirm'));
    assert.ok(f.calls.indexOf('agent-cleanup') < f.calls.indexOf('stop'));
    assert.equal((await f.view()).runs[0].phase, 'closed');
  } finally { admitted.release(); await agent.close(); }
});

test('a failed Agent resource cleanup stays recoverable even when native has already returned closed', async () => {
  let failed = true, attempts = 0;
  const f = await fixture(async () => { ++attempts; if (failed) throw new AppError('host stream close unconfirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'); });
  const agent = new OwnedForwardAgent('unit-unused-agent', new AbortController().signal), resource = agentResource();
  const admitted = await f.scopes.admitTask(f.vmId, f.project, { command: 'true' }, new AbortController().signal,
    { sshAgent: { resource, agent } });
  f.core.run = async () => ({ ...f.run, runId: admitted.payload.runId,
    cgroupName: 'sakura-task-' + admitted.payload.runId, phase: 'closed' });
  try {
    assert.equal(await f.scopes.active(f.vmId, 'default', admitted.payload.runId), false);
    assert.equal((await f.view()).runs[0].phase, 'active', 'a closed native ticket cannot hide unresolved Agent resources');
    await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', admitted.payload.runId),
      { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    assert.equal((await f.view()).runs[0].phase, 'active'); assert.equal(f.calls.includes('stop'), false);
    admitted.release();
    await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
    failed = false; await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.equal(attempts, 2); assert.equal((await f.view()).runs[0].phase, 'closed');
    await f.reopened().guard(f.vmId, 'default');
  } finally { admitted.release(); await agent.close(); }
});

test('an unissued Agent task still cleans its exact resources before accepting native RECORD_ABSENT', async () => {
  const f = await fixture(async context => { assert.equal(context.identity.identityId, f.identity.identityId); f.calls.push('agent-cleanup'); });
  const agent = new OwnedForwardAgent('unit-unused-agent', new AbortController().signal);
  const admitted = await f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-run' }, new AbortController().signal,
    { sshAgent: { resource: agentResource(), agent } });
  f.setMissing(true); admitted.release();
  try {
    await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.ok(f.calls.includes('agent-cleanup')); assert.equal(f.calls.includes('stop'), false);
    assert.equal((await f.view()).runs[0].run, null);
    await assert.rejects(f.reopened().assertTaskIssued(f.vmId, 'default', admitted.payload.runId,
      { code: 1, stderr: '', stdout: JSON.stringify({ ok: false, code: 'SSH_AGENT_SOURCE_INVALID', detail: null }) }),
      { code: 'PROJECT_IDENTITY_SSH_AGENT_SOURCE_INVALID' });
  } finally { await agent.close(); }
});

test('changing immutable Agent metadata disables the concurrent-task exemption', async () => {
  const f = await fixture(), agent = new OwnedForwardAgent('unit-unused-agent', new AbortController().signal);
  const admitted = await f.scopes.admitTask(f.vmId, f.project, { command: 'active' }, new AbortController().signal,
    { sshAgent: { resource: agentResource(), agent } }); f.setAbsent(false);
  try {
    const original = await f.view();
    const changed = structuredClone(original); changed.runs[0].sshAgent.leaseId = randomUUID();
    admitted.agentContext!.resource.leaseId = changed.runs[0].sshAgent.leaseId;
    await writeFile(f.file, JSON.stringify(changed));
    await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    assert.equal(f.calls.includes('stop'), false);
    await writeFile(f.file, JSON.stringify(original));
    f.calls.length = 0; await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.deepEqual(f.calls, [], 'the original exact in-process owner still exists');
  } finally { admitted.release(); await agent.close(); }
});

const gpgResource = () => {
  const snapshot = syntheticGpgHostSnapshot();
  return { version: 1 as const, kind: 'gpg-agent' as const, leaseId: randomUUID(),
    brokerSha256: 'a'.repeat(64), timeoutSeconds: 60,
    hostSourceSha256: snapshot.hostSourceSha256, hostHelperSha256: snapshot.hostHelperSha256 };
};
const gpgBridge = () => {
  const bridge = new OwnedGpgForward(syntheticGpgHostSnapshot(), new AbortController().signal);
  // This file tests the project journal using synthetic host pins. Real helper
  // births and kernel credentials are covered by the separate native smoke.
  bridge.prepareAdmission = async (context, live) => { bridge.bind(context, live); };
  return bridge;
};

test('GPG admission pins its source and writable home, and closes the resource before its account ticket', async () => {
  const contexts: GpgAgentContext[] = [];
  const f = await fixture(undefined, async context => { contexts.push(context); f.calls.push('gpg-cleanup'); });
  const bridge = gpgBridge(), resource = gpgResource(), original = f.core.inheritedInput;
  let environment: Record<string, string> | undefined;
  f.core.inheritedInput = async (identity, execution, options) => {
    environment = (execution as { environment?: Record<string, string> }).environment;
    return original(identity, execution, options);
  };
  const admitted = await f.scopes.admitTask(f.vmId, f.project,
    { command: 'private-frame-value', environment: { GNUPGHOME: '/wrong/project/home', TOKEN: 'private-environment' } },
    new AbortController().signal, { gpgAgent: { resource, bridge } });
  const runId = admitted.payload.runId;
  f.core.run = async () => { f.calls.push('run'); return { ...f.run, runId, cgroupName: 'sakura-task-' + runId }; };
  f.core.stop = async () => { f.calls.push('stop'); return { ...f.run, runId, cgroupName: 'sakura-task-' + runId, phase: 'closed' }; };
  try {
    assert.equal(environment?.GNUPGHOME, gpgAgentHomePath(resource.leaseId));
    assert.equal(environment?.TOKEN, 'private-environment');
    assert.deepEqual((await f.view()).runs[0].gpgAgent, resource);
    const text = await readFile(f.file, 'utf8');
    for (const value of ['private-frame-value', 'private-environment', '/wrong/project/home', 'D:\\private'])
      assert.ok(!text.includes(value));
    assert.deepEqual(admitted.gpgContext?.identity, f.identity);
    assert.equal(admitted.gpgContext?.owner.runId, runId);
    f.calls.length = 0;
    await f.scopes.closeAfterScopeStopped(f.vmId, 'default', runId);
    assert.equal(contexts.length, 1); assert.deepEqual(contexts[0].resource, resource);
    assert.ok(f.calls.indexOf('gpg-cleanup') > f.calls.indexOf('confirm'));
    assert.ok(f.calls.indexOf('gpg-cleanup') < f.calls.indexOf('stop'));
    assert.equal((await f.view()).runs[0].phase, 'closed');
  } finally { admitted.release(); await bridge.close(); }
});

test('a closed native GPG ticket retains its unresolved resource and recovery retries it', async () => {
  let failed = true, attempts = 0;
  const f = await fixture(undefined, async () => {
    ++attempts;
    if (failed) throw new AppError('GPG host helper close unconfirmed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  });
  const bridge = gpgBridge();
  const admitted = await f.scopes.admitTask(f.vmId, f.project, { command: 'true' }, new AbortController().signal,
    { gpgAgent: { resource: gpgResource(), bridge } });
  f.core.run = async () => ({ ...f.run, runId: admitted.payload.runId,
    cgroupName: 'sakura-task-' + admitted.payload.runId, phase: 'closed' });
  try {
    assert.equal(await f.scopes.active(f.vmId, 'default', admitted.payload.runId), false);
    assert.equal((await f.view()).runs[0].phase, 'active');
    await assert.rejects(f.scopes.closeAfterScopeStopped(f.vmId, 'default', admitted.payload.runId),
      { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    admitted.release();
    await assert.rejects(f.reopened().guard(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_RUNS_MUST_STOP' });
    failed = false; await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.equal(attempts, 2); assert.equal((await f.view()).runs[0].phase, 'closed');
    assert.equal(f.calls.includes('stop'), false);
  } finally { admitted.release(); await bridge.close(); }
});

test('GPG source digest mismatch and two Agent kinds refuse before creating any payload', async () => {
  const f = await fixture(), bridge = gpgBridge(), agent = new OwnedForwardAgent('unit-unused', new AbortController().signal);
  try {
    await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-run' }, new AbortController().signal,
      { gpgAgent: { bridge, resource: { ...gpgResource(), hostSourceSha256: 'f'.repeat(64) } } }),
      { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal(f.calls.includes('payload'), false);
    f.calls.length = 0;
    await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-run' }, new AbortController().signal,
      { gpgAgent: { bridge, resource: gpgResource() }, sshAgent: { agent, resource: agentResource() } }),
      { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.deepEqual(f.calls, []);
  } finally { await bridge.close(); await agent.close(); }
});

test('GPG prepared resources must be cleaned even when no native execution ticket was issued', async () => {
  const f = await fixture(undefined, async context => {
    assert.equal(context.identity.identityId, f.identity.identityId); f.calls.push('gpg-cleanup');
  }), bridge = gpgBridge();
  const admitted = await f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-run' }, new AbortController().signal,
    { gpgAgent: { resource: gpgResource(), bridge } });
  f.setMissing(true); admitted.release();
  try {
    await f.reopened().recoverStoppedTasks(f.vmId, 'default');
    assert.ok(f.calls.includes('gpg-cleanup')); assert.equal(f.calls.includes('stop'), false);
    assert.equal((await f.view()).runs[0].run, null); assert.equal((await f.view()).runs[0].phase, 'closed');
  } finally { await bridge.close(); }
});

test('changed GPG resource metadata cannot claim a currently active task owner', async () => {
  const f = await fixture(), bridge = gpgBridge();
  const admitted = await f.scopes.admitTask(f.vmId, f.project, { command: 'active' }, new AbortController().signal,
    { gpgAgent: { resource: gpgResource(), bridge } }); f.setAbsent(false);
  try {
    const original = await f.view(), changed = structuredClone(original);
    changed.runs[0].gpgAgent.hostHelperSha256 = 'f'.repeat(64);
    admitted.gpgContext!.resource.hostHelperSha256 = changed.runs[0].gpgAgent.hostHelperSha256;
    await writeFile(f.file, JSON.stringify(changed));
    await assert.rejects(f.reopened().recoverStoppedTasks(f.vmId, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    assert.equal(f.calls.includes('stop'), false);
    await writeFile(f.file, JSON.stringify(original)); f.calls.length = 0;
    await f.reopened().recoverStoppedTasks(f.vmId, 'default'); assert.deepEqual(f.calls, []);
  } finally { admitted.release(); await bridge.close(); }
});

test('a failed durable host admission cannot leave a GPG project intent without a host receipt', async () => {
  const f = await fixture(), bridge = gpgBridge(); let preparations = 0;
  bridge.prepareAdmission = async () => {
    ++preparations; throw new AppError('owned host receipt write failed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  };
  try {
    await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'private-frame-value' },
      new AbortController().signal, { gpgAgent: { resource: gpgResource(), bridge } }),
      { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    assert.equal(preparations, 1); assert.deepEqual((await f.view()).runs, []);
    assert.equal(f.calls.includes('run'), false); await f.scopes.guard(f.vmId, 'default');
  } finally { await bridge.close(); }
});

test('the GPG host admission is persisted before a later guest boot guard can fail', async () => {
  const f = await fixture(), bridge = gpgBridge(); let prepared = false;
  bridge.prepareAdmission = async (context, live) => {
    assert.deepEqual((await f.view()).runs, []);
    bridge.bind(context, live); prepared = true; f.setBoot(randomUUID());
  };
  try {
    await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-run' },
      new AbortController().signal, { gpgAgent: { resource: gpgResource(), bridge } }),
      { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
    assert.equal(prepared, true);
    const journal = await f.view(); assert.equal(journal.runs.length, 1);
    assert.equal(journal.runs[0].phase, 'intent'); assert.equal(journal.runs[0].run, null);
    assert.equal(f.calls.includes('run'), false);
  } finally { await bridge.close(); }
});

test('a bundle handoff pinned to an earlier guest boot cannot admit project code', async () => {
  const f = await fixture();
  await assert.rejects(f.scopes.admitTask(f.vmId, f.project, { command: 'must-not-checkout-old-bundle' },
    new AbortController().signal, { expectedBootId: randomUUID() }), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(f.calls.includes('run'), false);
  await assert.rejects(f.view(), { code: 'ENOENT' });
});
