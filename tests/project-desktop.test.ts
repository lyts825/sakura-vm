import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, vmDir, AppError, assertProjectTerminalsStopped } from './desktop-identity-fixture.ts';
import { Desktops } from '../server/desktop.ts';

async function publicFixture(t: Parameters<typeof fixture>[0], mode = '') {
  const f = await fixture(t, mode), desktops = new Desktops(f.machines, f.workspaces, f.options);
  t.after(() => desktops.close());
  // Let the constructor's readonly recovery observe the empty original intent.
  await delay(5);
  const scope = <T>(project: string, action: () => Promise<T>) => f.workspaces.projects.with(f.id, project, action);
  const settled = async (project: string) => {
    for (let i = 0; i < 500; ++i) {
      const view = await scope(project, () => desktops.view(f.id));
      if (!['installing', 'starting'].includes(view.status)) return view;
      await delay(5);
    }
    throw Error('Desktop public operation did not settle');
  };
  const start = async (project: string) => {
    await scope(project, async () => { desktops.start(f.id, 'start'); });
    return settled(project);
  };
  return { ...f, desktops, scope, settled, publicStart: start };
}

test('KDE public start captures its named project, exports secrets in UID frame and protects display identity', async t => {
  const f = await publicFixture(t), view = await f.publicStart(f.alpha);
  assert.equal(view.status, 'ready'); assert.equal(view.projectId, f.alpha); assert.equal(view.networkIsolation, 'private');
  const binding = await f.bindings.read(f.id); assert.equal(binding?.version, 2);
  if (binding?.version !== 2) assert.fail();
  assert.equal(binding.enabled, true); assert.equal(binding.execution.identity.uid, 20001);
  const frame = f.identity.inputs[0]; assert.match(frame.toString(), /desktop-secret-雪/);
  assert.doesNotMatch(frame.subarray(32, 32 + frame.readUInt32LE(24)).toString(), /cd |setpriv|killall|\/home\/sakura-desktop/);
  assert.ok(f.state.commands.every(command => !command.includes('desktop-secret') && !command.includes('desktop-hook')));
  assert.doesNotMatch(JSON.stringify(view), /desktop-secret/);
  assert.doesNotMatch(await readFile(join(vmDir(f.id), 'desktop-binding.json'), 'utf8'), /TOKEN|desktop-secret/);
  assert.equal((await f.scope(f.beta, () => f.desktops.view(f.id))).bindingMismatch, true);
  assert.equal((await f.desktops.view(f.id, true)).bindingMismatch, undefined);
});

test('public running KDE requires exact stop before rebinding or directory/network edits', async t => {
  const f = await publicFixture(t); await f.publicStart(f.alpha);
  assert.equal((await f.publicStart(f.beta)).status, 'error'); assert.equal(f.identity.inputs.length, 1);
  await f.scope(f.alpha, async () => {
    const config = await f.workspaces.config(f.id);
    await assert.rejects(f.workspaces.save(f.id, { ...config, directory: '/workspace/new' }), /停止/);
    await assert.rejects(f.workspaces.save(f.id, { ...config, networkIsolation: 'host' }), /停止/);
  });
  await f.desktops.stop(f.id); assert.equal((await f.bindings.read(f.id))!.enabled, false);
  assert.equal((await f.scope(f.beta, () => f.desktops.view(f.id))).bindingMismatch, undefined);
  assert.equal((await f.publicStart(f.beta)).status, 'ready');
  assert.equal((await f.bindings.read(f.id))!.projectId, f.beta);
});

test('lost preparation ACK and endpoint/network drift cannot authorize discovery or recovery', async t => {
  const f = await publicFixture(t, 'prepare-ack-lost');
  assert.equal((await f.publicStart(f.alpha)).status, 'error'); assert.equal(f.identity.inputs.length, 0);
  assert.equal((await f.bindings.read(f.id))!.enabled, false);
  const g = await publicFixture(t); assert.equal((await g.publicStart(g.alpha)).status, 'ready');
  g.state.endpointDrift = true;
  await assert.rejects(g.scope(g.alpha, () => g.desktops.view(g.id)), { code: 'DESKTOP_SCOPE_CHANGED' });
  await assert.rejects(g.desktops.view(g.id, true), { code: 'DESKTOP_SCOPE_CHANGED' });
});

test('UID readiness failures redact resolved private values and persist disabled full recovery proof', async t => {
  const f = await publicFixture(t);
  f.state.onProbe = async () => { throw new AppError('desktop-secret-雪', 409, 'MODEL_UID_START_FAILED'); };
  const view = await f.publicStart(f.alpha); assert.equal(view.status, 'error');
  assert.doesNotMatch(JSON.stringify(view), /desktop-secret/);
  const binding = await f.bindings.read(f.id); assert.equal(binding?.enabled, false);
  assert.equal(binding?.version === 2 && binding.state, 'stopped');
});

test('public stop aborts fixed administrative preparation before waiting for the VM lock', async t => {
  const f = await publicFixture(t); f.state.installed = false;
  f.state.beforePrepare = signal => delay(60000, undefined, { signal });
  await f.scope(f.alpha, async () => { f.desktops.start(f.id, 'install'); });
  for (let i = 0; i < 500 && !f.state.preparations; ++i) await delay(5);
  assert.equal(f.state.preparations, 1); assert.equal(f.identity.inputs.length, 0);
  await f.desktops.stop(f.id);
  assert.equal(await f.bindings.read(f.id), null);
  assert.ok(f.state.commands.some(command => command.includes('SAKURA_GUEST_TASK_CLEANUP')));
  assert.equal((await f.scope(f.alpha, () => f.desktops.view(f.id))).status, 'not-installed');
});

test('public controller reload preserves original running GUI and true boot retires old proof before recovery', async t => {
  const f = await publicFixture(t); await f.publicStart(f.alpha); await f.desktops.close();
  const resumed = new Desktops(f.machines, f.workspaces, f.options); t.after(() => resumed.close());
  await delay(30); assert.equal(f.identity.inputs.length, 1);
  f.live.status = 'stopped'; f.machines.emit('change');
  f.state.boot = randomUUID(); f.owner.record = null; f.owner.inode = null; f.state.detached = false;
  f.identity.tickets.clear(); f.live.status = 'running'; f.live.startedAt = 'desktop-model-boot-2'; f.machines.emit('change');
  for (let i = 0; i < 500 && f.identity.inputs.length === 1; ++i) await delay(5);
  for (let i = 0; i < 500; ++i) {
    if ((await f.scope(f.alpha, () => resumed.view(f.id))).status === 'ready') break;
    await delay(5);
  }
  assert.equal(f.identity.inputs.length, 2);
  assert.equal((await f.scope(f.alpha, () => resumed.view(f.id))).projectId, f.alpha);
  assert.equal(f.state.neighbor, true); assert.equal(f.state.killed, 0);
});

test('stopped-instance edits retain the exact old proof; corrupt bindings cannot be cleared by Root fallback', async t => {
  const f = await publicFixture(t); await f.publicStart(f.alpha);
  f.live.status = 'stopped'; f.machines.emit('change');
  await f.scope(f.alpha, async () => {
    const config = await f.workspaces.config(f.id);
    await assert.rejects(f.workspaces.save(f.id, { ...config, networkIsolation: 'host' }), /停止/);
  });
  assert.equal((await f.bindings.read(f.id))!.enabled, true);
  const file = join(vmDir(f.id), 'desktop-binding.json'), before = await readFile(file);
  await writeFile(file, 'null'); await assert.rejects(f.bindings.read(f.id));
  f.live.status = 'running';
  await assert.rejects(f.scope(f.alpha, () => f.desktops.view(f.id)));
  await assert.rejects(f.desktops.stop(f.id)); assert.equal(await readFile(file, 'utf8'), 'null');
  await writeFile(file, before); await f.desktops.stop(f.id);
  assert.equal((await f.publicStart(f.alpha)).status, 'ready');
});

test('public IME captures the named original project and restarts its full UID desktop without legacy Root start', async t => {
  const f = await publicFixture(t); await f.publicStart(f.alpha);
  const controller = new AbortController(), output: string[] = [];
  const running = f.scope(f.alpha, () => f.desktops.installIme(f.id, controller.signal, line => output.push(line)));
  await f.workspaces.projects.update(f.id, f.beta);
  assert.equal((await running).code, 0);
  const binding = await f.bindings.read(f.id); assert.equal(binding?.projectId, f.alpha);
  assert.equal(f.identity.inputs.length, 2); assert.equal(f.state.killed, 1); assert.equal(f.state.neighbor, true);
  assert.ok(f.identity.inputs[1].toString().includes('.config/autostart/fcitx5.desktop'));
  assert.doesNotMatch(output.join(''), /desktop-secret/);
  assert.ok(f.state.commands.every(command => !command.includes('id sakura-desktop') && !command.includes('/home/sakura-desktop')));
});

test('public IME retains exact administration proof on cleanup503 and stop retries only the original live', async t => {
  const f = await publicFixture(t); await f.publicStart(f.alpha);
  f.state.beforePrepare = async () => { f.machines.live.set(f.id, { ...f.live, startedAt: 'replacement-ime-live' } as any); };
  await assert.rejects(f.scope(f.alpha, () => f.desktops.installIme(f.id, new AbortController().signal, () => {})),
    { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' });
  assert.equal(f.identity.inputs.length, 1); assert.equal(f.state.detached, false);
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
  const before = f.state.commands.length;
  await assert.rejects(f.desktops.stop(f.id), { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' });
  assert.equal(f.state.commands.length, before);
  f.machines.live.set(f.id, f.live as any); await f.desktops.stop(f.id);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});

test('public IME cancellation completes original package task cleanup and does not start a legacy or new UID desktop', async t => {
  const f = await publicFixture(t); await f.publicStart(f.alpha);
  f.state.beforePrepare = signal => delay(60000, undefined, { signal });
  const controller = new AbortController();
  const result = f.scope(f.alpha, () => f.desktops.installIme(f.id, controller.signal, () => {}));
  const failed = assert.rejects(result);
  for (let i = 0; i < 500 && !f.state.preparations; ++i) await delay(5);
  assert.equal(f.state.preparations, 1); controller.abort(); await failed;
  assert.equal(f.identity.inputs.length, 1); assert.equal(f.state.detached, false);
  assert.ok(f.state.commands.some(command => command.startsWith('# SAKURA_GUEST_TASK_CLEANUP')));
  await f.desktops.stop(f.id);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});

test('failed Desktop cleanup exposes explicit stop retry before and after controller reload', async t => {
  const f = await publicFixture(t);
  f.state.onProbe = async () => { throw new AppError('readiness failed', 409, 'MODEL_UID_START_FAILED'); };
  f.state.cleanupFailure = true;
  const view = await f.publicStart(f.alpha);
  assert.equal(view.status, 'error'); assert.equal(view.cleanupPending, true);
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
  await f.desktops.close();
  const reloaded = new Desktops(f.machines, f.workspaces, f.options); t.after(() => reloaded.close());
  const recovered = await f.scope(f.alpha, () => reloaded.view(f.id));
  assert.equal(recovered.status, 'error'); assert.equal(recovered.cleanupPending, true);
  f.state.cleanupFailure = false; await reloaded.stop(f.id);
  assert.equal((await f.scope(f.alpha, () => reloaded.view(f.id))).status, 'stopped');
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});

test('cancelled IME cleanup503 is visible in Desktop status instead of an unfinished installation', async t => {
  const f = await publicFixture(t); await f.publicStart(f.alpha);
  const controller = new AbortController();
  f.state.onCommit = () => { f.state.cleanupFailure = true; controller.abort(); };
  await assert.rejects(f.scope(f.alpha, () => f.desktops.installIme(f.id, controller.signal, () => {})),
    { status: 503, code: 'DESKTOP_CLEANUP_FAILED' });
  const view = await f.scope(f.alpha, () => f.desktops.view(f.id));
  assert.equal(view.status, 'error'); assert.equal(view.cleanupPending, true);
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
  f.state.cleanupFailure = false; await f.desktops.stop(f.id);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});
