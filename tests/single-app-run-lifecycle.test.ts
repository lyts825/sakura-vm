import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../server/model.ts';
import { SingleAppWindows } from '../server/single-app-windows.ts';
import { singleAppFixture } from './single-app-fixture.ts';

test('native prepare lost ACK recovers only the same existing UUID and closes it without relaunch or double release', async () => {
  const f = await singleAppFixture();
  try {
    f.faults.prepareAckLost = true;
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), /native ACK lost/);
    assert.deepEqual(f.actions.map(action => action.action), ['native-prepare', 'recover', 'stop']);
    assert.equal(new Set(f.actions.map(action => action.id)).size, 1); assert.equal(f.releaseCount(), 1);
    assert.equal((await f.journal()).sessions[0].phase, 'stopped');
  } finally { await f.close(); }
});

test('missing native ticket and extant unknown cgroup retain intent and never reissue native prepare', async () => {
  const f = await singleAppFixture();
  try {
    f.faults.missingNativeTicket = f.faults.unknownGroup = true;
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), (error: unknown) => (error as { status: number }).status === 503);
    const session = (await f.journal()).sessions[0]; assert.equal(session.phase, 'cleanup-failed'); assert.equal(session.run, null);
    assert.equal(f.releaseCount(), 0); assert.equal(f.actions.filter(action => action.action === 'native-prepare').length, 1);
    await assert.rejects(f.workspaces.save(f.id, { networkIsolation: 'host' }), /单应用/);
    await assert.rejects(f.apps.stop(f.id, session.id));
    assert.equal(f.actions.filter(action => action.action === 'native-prepare').length, 1);
    f.faults.unknownGroup = false;
    await f.apps.stop(f.id, session.id);
    assert.equal((await f.journal()).sessions[0].absence.ticketAbsent, true); assert.equal(f.releaseCount(), 1);
  } finally { await f.close(); }
});

test('start ACK loss closes the exact original guest run and retains the durable stopped receipt', async () => {
  const f = await singleAppFixture();
  try {
    f.faults.startAckLost = true;
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), /start ACK lost/);
    const session = (await f.journal()).sessions[0]; assert.equal(session.phase, 'stopped');
    assert.equal(session.receipt.directoryView.desktopRunId, session.id); assert.equal(f.releaseCount(), 1);
    assert.equal(f.actions.filter(action => action.action === 'native-prepare').length, 1);
  } finally { await f.close(); }
});

test('cleanup failure and stop ACK loss preserve full original proof and permit precise retry', async () => {
  const f = await singleAppFixture();
  try {
    const session = await f.apps.start(f.id, { program: 'xterm' }); const original = (await f.journal()).sessions[0].run;
    f.faults.stopFail = true; await assert.rejects(f.apps.stop(f.id, session.id));
    const pending = (await f.journal()).sessions[0]; assert.equal(pending.phase, 'cleanup-failed'); assert.deepEqual(pending.run, original);
    assert.equal(f.releaseCount(), 0); assert.equal((await f.apps.list(f.id))[0].cleanupPending, true);
    f.faults.stopFail = false; f.faults.stopAckLost = true; await assert.rejects(f.apps.stop(f.id, session.id));
    assert.equal((await f.journal()).sessions[0].phase, 'cleanup-failed'); assert.equal(f.releaseCount(), 0);
    await f.apps.stop(f.id, session.id); assert.equal(f.releaseCount(), 1);
    assert.equal((await f.journal()).sessions[0].phase, 'stopped');
  } finally { await f.close(); }
});

test('readonly reload uses saved original build/run and current policy despite stale revoked journal', async () => {
  const f = await singleAppFixture(); let reopened: SingleAppWindows | undefined;
  try {
    const session = await f.apps.start(f.id, { program: 'xterm' });
    await writeFile(join(f.root, f.id, 'single-app-clipboard.json'), JSON.stringify({ version: 1,
      rules: { xterm: { copy: false, paste: true } } }));
    assert.equal((await f.journal()).sessions[0].revoked, false);
    const before = await readFile(f.file, 'utf8'), actionCount = f.actions.length;
    reopened = new SingleAppWindows(f.machines, f.workspaces, f.options);
    assert.equal((await reopened.list(f.id))[0].status, 'relaunch-required');
    await assert.rejects(reopened.port(f.id, session.id), /规则已收紧/);
    assert.equal(await readFile(f.file, 'utf8'), before);
    assert.ok(f.actions.slice(actionCount).every(action => action.action === 'status'));
    await reopened.stop(f.id, session.id); await reopened.close(); reopened = undefined;
  } finally { if (reopened) await reopened.close(); await f.close(); }
});

test('forged endpoint or stop cgroup receipt never releases the original lease or opens a bridge', async () => {
  const f = await singleAppFixture();
  try {
    const session = await f.apps.start(f.id, { program: 'xterm' }); f.faults.endpointChanged = true;
    await assert.rejects(f.apps.port(f.id, session.id), /监听已变化/);
    f.faults.endpointChanged = false; f.faults.stopForeignRun = true;
    await assert.rejects(f.apps.stop(f.id, session.id), /关闭回执不符/); assert.equal(f.releaseCount(), 0);
    assert.equal((await f.journal()).sessions[0].phase, 'cleanup-failed');
    f.faults.stopForeignRun = false; await f.apps.stop(f.id, session.id); assert.equal(f.releaseCount(), 1);
  } finally { await f.close(); }
});

test('reloaded stop retires the original RAM lease without repeating guest stop or rewriting a sibling or revocation', async () => {
  const f = await singleAppFixture(); let reopened: SingleAppWindows | undefined;
  try {
    const first = await f.apps.start(f.id, { program: 'xterm' });
    reopened = new SingleAppWindows(f.machines, f.workspaces, f.options);
    await reopened.list(f.id); await reopened.stop(f.id, first.id);
    const second = await reopened.start(f.id, { program: 'xterm' });
    await reopened.saveClipboardPolicy(f.id, 'xterm', { copy: false, paste: true });
    const disk = await readFile(f.file, 'utf8'), actionCount = f.actions.length;
    assert.equal(f.releaseCount(), 0);
    await f.apps.stop(f.id, first.id);
    assert.equal(f.releaseCount(), 1); assert.equal(f.actions.length, actionCount);
    assert.equal(await readFile(f.file, 'utf8'), disk);
    assert.equal((await f.journal()).sessions.find((row: { id: string }) => row.id === first.id).closure.phase, 'closed');
    assert.equal((await f.journal()).sessions.find((row: { id: string }) => row.id === second.id).revoked, true);
    await f.apps.stop(f.id, first.id); assert.equal(f.releaseCount(), 1); assert.equal(f.actions.length, actionCount);
    await reopened.stop(f.id, second.id); assert.equal(f.releaseCount(), 2);
  } finally { if (reopened) await reopened.close(); await f.close(); }
});

test('forged durable stopped tuple never retires a RAM lease or issues another guest ticket', async () => {
  const f = await singleAppFixture();
  try {
    const window = await f.apps.start(f.id, { program: 'xterm' });
    const original = await readFile(f.file, 'utf8'), changed = JSON.parse(original), actionCount = f.actions.length;
    changed.sessions[0].phase = 'stopped'; changed.sessions[0].closure = { ...changed.sessions[0].run, phase: 'closed', cgroupInode: '999' };
    await writeFile(f.file, JSON.stringify(changed));
    await assert.rejects(f.apps.stop(f.id, window.id), (error: unknown) => (error as AppError).code === 'SINGLE_APP_HOST_CHANGED');
    assert.equal(f.releaseCount(), 0); assert.equal(f.actions.length, actionCount);
    await writeFile(f.file, original); await f.apps.stop(f.id, window.id);
  } finally { await f.close(); }
});

test('committed clipboard policy remains restrictive after journal write failure and a readonly reload', async () => {
  const f = await singleAppFixture(); let reopened: SingleAppWindows | undefined;
  const persistence = f.apps as unknown as { save(id: string): Promise<void> }, save = persistence.save;
  try {
    const window = await f.apps.start(f.id, { program: 'xterm' }); let disconnected = 0;
    f.apps.onSessionInvalidated(f.id, window.id, () => disconnected++);
    const before = await readFile(f.file, 'utf8');
    persistence.save = async () => { throw new AppError('journal ACK failed', 503); };
    await assert.rejects(f.apps.saveClipboardPolicy(f.id, 'xterm', { copy: false, paste: true }), /journal ACK/);
    persistence.save = save;
    assert.equal(disconnected, 1); assert.equal(await readFile(f.file, 'utf8'), before);
    await assert.rejects(f.apps.port(f.id, window.id), /规则已收紧/);
    reopened = new SingleAppWindows(f.machines, f.workspaces, f.options);
    assert.equal((await reopened.list(f.id))[0].status, 'relaunch-required');
    await assert.rejects(reopened.connectionCommand(f.id, window.id, window.port), /规则已收紧/);
    assert.equal(await readFile(f.file, 'utf8'), before);
    await reopened.stop(f.id, window.id); await f.apps.stop(f.id, window.id);
    assert.equal(f.releaseCount(), 1);
  } finally { persistence.save = save; if (reopened) await reopened.close(); await f.close(); }
});

test('owned application natural exit closes the exact independent run including detached descendants', async () => {
  const f = await singleAppFixture({ exitPollMs: 10 });
  try {
    const window = await f.apps.start(f.id, { program: 'xterm' }); const run = (await f.journal()).sessions[0].run;
    f.faults.statusExited = true;
    for (let attempt = 0; attempt < 100 && f.releaseCount() === 0; attempt++) await delay(10);
    assert.equal(f.releaseCount(), 1); assert.equal((await f.journal()).sessions[0].phase, 'stopped');
    assert.deepEqual(f.actions.find(action => action.action === 'stop')!.origin!.run, run);
    assert.equal(f.runs.get(window.id)!.phase, 'closed');
    const count = f.actions.length; await delay(30); assert.equal(f.actions.length, count);
  } finally { await f.close(); }
});

test('natural exit cleanup failure preserves its original lease and read-only reload does not resume an owner watcher', async () => {
  const f = await singleAppFixture({ exitPollMs: 10 }); let reopened: SingleAppWindows | undefined;
  try {
    const window = await f.apps.start(f.id, { program: 'xterm' });
    f.faults.statusExited = f.faults.stopFail = true;
    for (let attempt = 0; attempt < 100 && (await f.journal()).sessions[0].phase !== 'cleanup-failed'; attempt++) await delay(10);
    assert.equal((await f.journal()).sessions[0].phase, 'cleanup-failed'); assert.equal(f.releaseCount(), 0);
    const before = await readFile(f.file, 'utf8'), actionCount = f.actions.length;
    reopened = new SingleAppWindows(f.machines, f.workspaces, f.options);
    assert.equal((await reopened.list(f.id))[0].cleanupPending, true); await delay(50);
    assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.actions.length, actionCount);
    f.faults.stopFail = false; await f.apps.stop(f.id, window.id); assert.equal(f.releaseCount(), 1);
  } finally { if (reopened) await reopened.close(); await f.close(); }
});

test('captured configuration changing during install never launches or prepares a native run', async () => {
  const f = await singleAppFixture();
  try {
    const install = f.options.control.install;
    f.options.control.install = async () => { const project = f.configs.get('default')!;
      project.environment = { ...project.environment, LATE: 'changed' }; return install(); };
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), (error: unknown) => (error as AppError).code === 'SINGLE_APP_CONFIG_CHANGED');
    assert.equal(f.releaseCount(), 1); assert.equal(f.actions.length, 0); assert.equal((await f.apps.list(f.id)).length, 0);
  } finally { await f.close(); }
});

test('caller cancellation after guest prepare closes only the original UUID before application exec', async () => {
  const f = await singleAppFixture();
  try {
    const abort = new AbortController(), call = f.options.control.call;
    f.options.control.call = async (...args) => { const result = await call(...args); if (args[2] === 'prepare') abort.abort(); return result; };
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }, abort.signal));
    assert.deepEqual(f.actions.map(action => action.action), ['native-prepare', 'prepare', 'stop']);
    assert.equal(new Set(f.actions.map(action => action.id)).size, 1); assert.equal(f.releaseCount(), 1);
    assert.equal((await f.journal()).sessions[0].closure.phase, 'closed');
  } finally { await f.close(); }
});

test('same-boot live replacement keeps cleanup retryable and a proven later boot retires the original run', async () => {
  const f = await singleAppFixture();
  try {
    const window = await f.apps.start(f.id, { program: 'xterm' }), original = (await f.journal()).sessions[0].run;
    f.machines.live.set(f.id, { ...f.machines.live.get(f.id)! });
    await assert.rejects(f.apps.stop(f.id, window.id), (error: unknown) => (error as AppError).code === 'SINGLE_APP_LIVE_CHANGED');
    assert.equal(f.releaseCount(), 0); assert.deepEqual((await f.journal()).sessions[0].run, original);
    assert.equal(f.actions.filter(action => action.action === 'stop').length, 0);
    f.faults.reboot = true; await f.apps.stop(f.id, window.id);
    const retired = (await f.journal()).sessions[0];
    assert.deepEqual(retired.run, original); assert.deepEqual(retired.closure, original);
    assert.deepEqual(retired.retirement, { reason: 'guest-reboot', bootId: f.rebootId }); assert.equal(f.releaseCount(), 1);
  } finally { await f.close(); }
});

test('recovery rejects a foreign native tuple before adopting it or closing any other run', async () => {
  const f = await singleAppFixture();
  try {
    f.faults.prepareAckLost = true; const recover = f.options.control.recover;
    f.options.control.recover = async (...args) => { const result = await recover(...args);
      return result.run ? { ...result, run: { ...result.run, bootId: f.rebootId } } : result; };
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), (error: unknown) => (error as AppError).status === 503);
    const journal = await f.journal(); assert.equal(journal.sessions[0].run, null); assert.equal(f.releaseCount(), 0);
    assert.equal(f.actions.filter(action => action.action === 'stop').length, 0);
    f.options.control.recover = recover; await f.apps.stop(f.id, journal.sessions[0].id); assert.equal(f.releaseCount(), 1);
  } finally { await f.close(); }
});

test('a no-run durable intent cannot change its captured native build during retry', async () => {
  const f = await singleAppFixture();
  try {
    f.faults.prepareAckLost = f.faults.unknownGroup = true;
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }));
    const original = await readFile(f.file, 'utf8'), modified = JSON.parse(original);
    const session = modified.sessions[0]; assert.equal(session.run, null);
    session.nativeBuild = 'c'.repeat(64); await writeFile(f.file, JSON.stringify(modified));
    const actionCount = f.actions.length;
    await assert.rejects(f.apps.stop(f.id, session.id), (error: unknown) => (error as AppError).code === 'SINGLE_APP_HOST_CHANGED');
    assert.equal(f.actions.length, actionCount); assert.equal(f.releaseCount(), 0);
    await writeFile(f.file, original); f.faults.unknownGroup = false;
    await f.apps.stop(f.id, session.id); assert.equal(f.releaseCount(), 1);
  } finally { await f.close(); }
});

test('changed installed source is rejected before intent and a foreign returned source is recovered only from the captured build', async () => {
  const f = await singleAppFixture();
  try {
    const expected = f.options.nativeBuild;
    f.options.nativeBuild = async () => 'c'.repeat(64);
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), (error: unknown) => (error as AppError).code === 'SINGLE_APP_NATIVE_CHANGED');
    assert.equal(f.releaseCount(), 1); assert.equal(f.actions.length, 0);
    f.options.nativeBuild = expected;
    const prepareRun = f.options.control.prepareRun;
    f.options.control.prepareRun = async (...args) => ({ ...await prepareRun(...args), build: 'c'.repeat(64) });
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }));
    assert.deepEqual(f.actions.map(action => action.action), ['native-prepare', 'recover', 'stop']);
    const session = (await f.journal()).sessions[0];
    assert.equal(session.nativeBuild, await expected()); assert.equal(session.run.build, session.nativeBuild);
    assert.equal(session.phase, 'stopped'); assert.equal(f.releaseCount(), 2);
  } finally { await f.close(); }
});
