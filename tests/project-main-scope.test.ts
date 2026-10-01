import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-main-test-'));
process.env.SAKURA_DATA_DIR = root;
const { mainFixture } = await import('./project-main-fixture.ts');
const { ProjectMainScope, ProjectServiceScopes, projectMainRecordSchema, projectServiceRecordSchema } = await import('../server/project-service-scope.ts');
const { serviceSchema } = await import('../server/project-services.ts');
const { runProjectMain, stopProjectMain } = await import('../server/project-main.ts');
const { writeStore } = await import('../server/local-store.ts');
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), await realpath(tmpdir())); assert.match(basename(owned), /^sakura-project-main-test-/);
  await rm(owned, { recursive: true, force: true });
});

test('protected main command and secret bytes never enter root controller or tmux argv', async () => {
  const f = await mainFixture();
  try {
    await f.startMain();
    assert.ok(f.identity.inputs.length);
    assert.ok(f.identity.inputs[0].includes(Buffer.from('owned-main-private-token')));
    for (const command of f.commands) {
      assert.equal(command.includes('owned-main-private-token'), false);
      assert.equal(command.includes(Buffer.from('owned-main-private-token').toString('base64')), false);
    }
    const transport = JSON.parse(await readFile(join(f.scope.receipt(), '..', `transport-${f.state.main!.runId}.json`), 'utf8'));
    assert.equal(transport.bytes, f.identity.inputs[0].length);
    assert.equal(JSON.stringify(transport).includes('owned-main-private-token'), false);
    const before = await readFile(f.scope.receipt(), 'utf8');
    await assert.rejects(f.scope.persistIntent(f.scope.intent(f.bootId)), { code: 'PROJECT_MAIN_SCOPE_CHANGED' });
    assert.equal(await readFile(f.scope.receipt(), 'utf8'), before);
  } finally { await f.spaces.close(); }
});

test('old main v2 receipt is stoppable but cannot silently run a root command again', async () => {
  const f = await mainFixture();
  try {
    const old = { ...f.scope.intent(f.bootId), phase: 'running' as const, inode: '555',
      sessionId: '$1', paneId: '%1', panePid: 100, paneStartTicks: '1234' };
    f.state.main = old; await writeStore(f.scope.receipt(), old);
    await assert.rejects(runProjectMain(f.machines, f.id, f.project, () => {}, f.controller.signal,
      async () => assert.fail('legacy root run must not execute setup')), { code: 'PROJECT_MAIN_IDENTITY_REQUIRED' });
    await stopProjectMain(f.machines, f.id, f.project, () => {});
    assert.equal(f.state.main.phase, 'stopped'); assert.equal(f.identity.state.stopCalls, 0);
  } finally { await f.spaces.close(); }
});

test('identity close failure keeps the stopped scope and journal recoverable until a later stop', async () => {
  const f = await mainFixture();
  try {
    await f.startMain(); const old = { ...f.state.main! };
    f.identity.state.stopFailures = 10;
    await assert.rejects(f.scope.stop(old), { code: 'PROJECT_MAIN_CLEANUP_FAILED' });
    assert.equal((await f.scope.metadata())!.phase, 'stopped');
    const before = await readFile(f.scope.receipt(), 'utf8');
    await assert.rejects(f.scope.persistIntent(f.scope.intent(f.bootId)), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    assert.equal(await readFile(f.scope.receipt(), 'utf8'), before);
    f.identity.state.stopFailures = 0;
    await f.scope.stop(old);
    await f.startMain(); assert.notEqual(f.state.main!.runId, old.runId);
  } finally { await f.spaces.close(); }
});

test('main v2 is independent from a real service named main and v1 records remain recoverable', async () => {
  const f = await mainFixture(), services = new ProjectServiceScopes(f.machines, f.id, f.project);
  const service = serviceSchema.parse({ name: 'main', command: 'sleep 600' }), main = f.scope.intent(f.bootId);
  try {
    const worker = services.intent(service, f.bootId);
    assert.equal(projectServiceRecordSchema.safeParse(worker).success, true);
    assert.equal(projectMainRecordSchema.safeParse(main).success, true);
    assert.equal(projectMainRecordSchema.safeParse(worker).success, false);
    assert.equal(projectServiceRecordSchema.safeParse(main).success, false);
    assert.equal('name' in main, false); assert.notEqual(main.binding, worker.binding);
    assert.notEqual(f.scope.receipt(), services.receipt('main')); assert.notEqual(main.session, worker.session);
    await f.startService(services, worker);
    await f.scope.persistIntent(main);
    await f.scope.start(main, await f.identity.payload(f.id, main), f.controller.signal);
    const restored = new ProjectServiceScopes(f.machines, f.id, f.project);
    assert.equal((await restored.status('main')).record!.version, 1);
    await restored.stop((await restored.metadata('main'))!);
    assert.equal((await f.scope.status()).status, 'running');
    await stopProjectMain(f.machines, f.id, f.project, () => {}, f.controller.signal);
  } finally { await f.spaces.close(); }
});
test('main start is idempotent and does not rerun setup or overwrite its durable run', async () => {
  const f = await mainFixture(); let prepared = 0;
  try {
    await runProjectMain(f.machines, f.id, f.project, () => {}, f.controller.signal, async () => { ++prepared; });
    const record = { ...f.state.main! };
    await runProjectMain(f.machines, f.id, f.project, () => {}, f.controller.signal, async () => { ++prepared; });
    assert.equal(prepared, 1); assert.equal(f.state.commits, 1); assert.deepEqual(f.state.main, record);
  } finally { await f.spaces.close(); }
});
for (const mode of ['prepare-ack-lost', 'pane-ack-lost', 'commit-ack-lost', 'cancel-after-commit', 'unavailable']) {
  test(`main ${mode} rolls back its known run without losing the stopped receipt`, async () => {
    const f = await mainFixture(mode);
    try {
      await assert.rejects(runProjectMain(f.machines, f.id, f.project, () => {}, f.controller.signal, async () => {}));
      assert.equal(f.state.stopAttempts, 1); assert.equal(f.state.main?.phase, 'stopped');
      assert.equal(JSON.parse(await readFile(f.scope.receipt(), 'utf8')).phase, 'stopped');
    } finally { await f.spaces.close(); }
  });
}
for (const mode of ['first-stop-failure', 'stop-ack-lost']) {
  test(`main ${mode} retries independently and repeated stop retains the same run`, async () => {
    const f = await mainFixture(mode);
    try {
      await f.startMain();
      await stopProjectMain(f.machines, f.id, f.project, () => {}, f.controller.signal);
      assert.equal(f.state.stopAttempts, 2);
      const stopped = f.state.main!;
      await stopProjectMain(f.machines, f.id, f.project, () => {}, f.controller.signal);
      assert.deepEqual(f.state.main, stopped);
    } finally { await f.spaces.close(); }
  });
}
test('all main stop failures retain the running receipt and expose cleanup failure', async () => {
  const f = await mainFixture('all-stop-failures');
  try {
    await f.startMain();
    const before = await readFile(f.scope.receipt(), 'utf8');
    await assert.rejects(stopProjectMain(f.machines, f.id, f.project, () => {}, f.controller.signal),
      { code: 'PROJECT_MAIN_CLEANUP_FAILED', status: 503 });
    assert.equal(f.state.stopAttempts, 3); assert.equal(f.state.stopped, 0);
    assert.equal(await readFile(f.scope.receipt(), 'utf8'), before);
  } finally { await f.spaces.close(); }
});
test('changed live instance prevents cleanup retries against a replacement machine', async () => {
  const f = await mainFixture('replace-live');
  try {
    await f.startMain();
    await assert.rejects(f.scope.stop(f.state.main!), { code: 'PROJECT_MAIN_CLEANUP_FAILED' });
    assert.equal(f.state.stopAttempts, 1); assert.equal(f.state.stopped, 0);
  } finally { await f.spaces.close(); }
});
for (const field of ['runId', 'bootId', 'inode', 'panePid', 'paneStartTicks'] as const) {
  test(`main replaced ${field} is refused before any process is stopped`, async () => {
    const f = await mainFixture();
    try {
      await f.startMain();
      (f.state.main as any)[field] = field.endsWith('Id') ? randomUUID() : field === 'panePid' ? 999 : '55555';
      await assert.rejects(f.scope.status(), { code: 'PROJECT_MAIN_SCOPE_CHANGED' });
      await assert.rejects(stopProjectMain(f.machines, f.id, f.project, () => {}, f.controller.signal),
        { code: 'PROJECT_MAIN_CLEANUP_FAILED' });
      assert.equal(f.state.stopped, 0);
    } finally { await f.spaces.close(); }
  });
}
test('unknown legacy main sessions are refused without prepare, commit or inferred cleanup', async () => {
  const f = await mainFixture('legacy');
  try {
    await assert.rejects(runProjectMain(f.machines, f.id, f.project, () => {}, f.controller.signal, async () => {
      assert.fail('legacy main must be refused before setup');
    }), { code: 'PROJECT_MAIN_SCOPE_UNMANAGED' });
    await assert.rejects(stopProjectMain(f.machines, f.id, f.project, () => {}, f.controller.signal), { code: 'PROJECT_MAIN_SCOPE_UNMANAGED' });
    assert.equal(f.state.prepared, 0); assert.equal(f.state.commits, 0); assert.equal(f.state.stopAttempts, 0);
  } finally { await f.spaces.close(); }
});
test('same-boot intent without a guest receipt remains unconfirmed until explicit cancellation', async () => {
  const f = await mainFixture();
  try {
    await writeStore(f.scope.receipt(), f.scope.intent(f.bootId));
    assert.equal((await f.scope.status()).status, 'unconfirmed');
    await assert.rejects(runProjectMain(f.machines, f.id, f.project, () => {}, f.controller.signal, async () => {}),
      { code: 'PROJECT_MAIN_SCOPE_CHANGED' });
    await stopProjectMain(f.machines, f.id, f.project, () => {}, f.controller.signal);
    assert.equal((await f.scope.status()).status, 'stopped');
  } finally { await f.spaces.close(); }
});
test('main rejects corrupt host receipts and incomplete success replies with its own error code', async () => {
  const f = await mainFixture('malformed-status');
  try {
    await assert.rejects(f.scope.status(), { code: 'PROJECT_MAIN_SCOPE_CHANGED' });
    await writeStore(f.scope.receipt(), f.scope.intent(f.bootId));
    await writeFile(f.scope.receipt(), '{');
    await assert.rejects(f.scope.metadata(), { code: 'PROJECT_MAIN_SCOPE_CHANGED' });
  } finally { await f.spaces.close(); }
});

test('a confirmed different boot retires only the exact absent main run and repeated stop sends no signal', async () => {
  const f = await mainFixture();
  try {
    await f.startMain();
    const record = await f.scope.metadata();
    f.state.currentBoot = randomUUID(); f.state.main = null; f.machines.live.set(f.id, {} as any);
    await stopProjectMain(f.machines, f.id, f.project, () => {});
    await stopProjectMain(f.machines, f.id, f.project, () => {});
    assert.deepEqual(await f.scope.metadata(), { ...record, phase: 'stopped' });
    assert.equal(f.state.stopAttempts, 0); assert.equal(f.state.rebootProbes, 2);
    await assert.rejects(f.scope.stop(record!), { code: 'PROJECT_MAIN_CLEANUP_FAILED' });
    assert.equal(f.state.stopAttempts, 0);
  } finally { await f.spaces.close(); }
});

for (const blocked of ['new guest owner exists', 'replacement cgroup exists', 'replacement pane exists']) {
  test(`different-boot ${blocked} refuses retirement and preserves the old receipt`, async () => {
    const f = await mainFixture();
    try {
      await f.startMain();
      const before = await readFile(f.scope.receipt(), 'utf8');
      f.state.currentBoot = randomUUID(); f.state.main = null; f.state.rebootBlock = blocked;
      await assert.rejects(stopProjectMain(f.machines, f.id, f.project, () => {}),
        { code: 'PROJECT_MAIN_CLEANUP_FAILED', status: 503 });
      assert.equal(f.state.rebootProbes, 3); assert.equal(f.state.stopAttempts, 0);
      assert.equal(await readFile(f.scope.receipt(), 'utf8'), before);
    } finally { await f.spaces.close(); }
  });
}

test('reboot ownership probe retries a failed connection before recording a confirmed stop', async () => {
  const f = await mainFixture();
  try {
    await f.startMain();
    f.state.currentBoot = randomUUID(); f.state.main = null; f.state.rebootProbeFailures = 1;
    await stopProjectMain(f.machines, f.id, f.project, () => {});
    assert.equal(f.state.rebootProbes, 2); assert.equal(f.state.stopAttempts, 0);
    assert.equal((await f.scope.metadata())?.phase, 'stopped');
  } finally { await f.spaces.close(); }
});

test('unconfirmed reboot probes never change the retained receipt or send cleanup signals', async () => {
  const f = await mainFixture();
  try {
    await f.startMain();
    const before = await readFile(f.scope.receipt(), 'utf8');
    f.state.currentBoot = randomUUID(); f.state.main = null; f.state.rebootProbeFailures = 3;
    await assert.rejects(stopProjectMain(f.machines, f.id, f.project, () => {}), { code: 'PROJECT_MAIN_CLEANUP_FAILED' });
    assert.equal(f.state.rebootProbes, 3); assert.equal(f.state.stopAttempts, 0);
    assert.equal(await readFile(f.scope.receipt(), 'utf8'), before);
  } finally { await f.spaces.close(); }
});

for (const changed of ['live', 'host']) {
  test(`reboot probe cannot retire a ${changed} replacement made before its acknowledgement`, async () => {
    const f = await mainFixture();
    try {
      await f.startMain();
      const before = await readFile(f.scope.receipt(), 'utf8'), exec = f.machines.exec.bind(f.machines);
      f.state.currentBoot = randomUUID(); f.state.main = null;
      f.machines.exec = (async (...args: Parameters<typeof f.machines.exec>) => {
        const result = await exec(...args);
        if (args[1].startsWith('# SAKURA_PROJECT_MAIN_REBOOT_STOP') && f.state.rebootProbes === 1) {
          if (changed === 'live') f.machines.live.set(f.id, {} as any);
          else await writeStore(f.scope.receipt(), new ProjectMainScope(f.machines, f.id, f.project).intent(f.state.currentBoot));
        }
        return result;
      }) as typeof f.machines.exec;
      await assert.rejects(stopProjectMain(f.machines, f.id, f.project, () => {}), { code: 'PROJECT_MAIN_CLEANUP_FAILED' });
      assert.equal(f.state.rebootProbes, 1); assert.equal(f.state.stopAttempts, 0);
      if (changed === 'live') assert.equal(await readFile(f.scope.receipt(), 'utf8'), before);
      else assert.notEqual((await f.scope.metadata())?.runId, JSON.parse(before).runId);
    } finally { await f.spaces.close(); }
  });
}
