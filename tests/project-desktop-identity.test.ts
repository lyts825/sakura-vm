import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { Machines as MachinesType } from '../server/machines.ts';
import type { Project, Workspaces as WorkspacesType } from '../server/workspaces.ts';
import type { ProjectDesktopRecord } from '../server/project-service-scope.ts';

import { fixture, projectVersion, ProjectDesktops, ProjectDesktopScope, DesktopBindings, projectDesktopBindingSchema, desktopProjectCommand, desktopAdapterSource, desktopUidCommand, desktopProjectPrepare, desktopProjectEnvironment, desktopProjectImePrepare, desktopProjectImeCommand, projectIdentityPayload, assertProjectTerminalsStopped, vmDir, AppError, defaultDesktopPreferences } from './desktop-identity-fixture.ts';

test('named Desktop captures non-enumerable scope, binary body, native HOME/UID and original service ticket', async (t) => {
  const f = await fixture(t); await f.start();
  const binding = await f.bindings.read(f.id); assert.equal(binding?.version, 2);
  if (binding?.version !== 2) assert.fail();
  assert.equal(binding.projectId, f.alpha); assert.equal(binding.enabled, true);
  assert.equal(binding.execution.identity.home.startsWith('/var/lib/sakura-project-homes/'), true);
  assert.equal(binding.execution.run!.cgroupName, 'sakura-service-' + binding.execution.record.runId);
  assert.equal(projectDesktopBindingSchema.safeParse(binding).success, true);
  assert.equal(binding.configVersion, projectVersion(f.config));
  const frame = f.identity.inputs[0]; assert.equal(frame.subarray(0, 8).toString(), 'SKIDP001');
  const script = frame.subarray(32, 32 + frame.readUInt32LE(24)).toString();
  assert.doesNotMatch(script, /cd |\/home\/sakura-desktop|killall|pgrep -u/);
  assert.match(script, /\/run\/sakura-desktop-uid\/20001/);
  assert.ok(frame.includes(Buffer.from('desktop-secret-雪')));
  assert.ok(f.state.commands.every(command => !command.includes('desktop-secret') && !command.includes('desktop-hook')));
  const serialized = await readFile(join(vmDir(f.id), 'desktop-binding.json'), 'utf8');
  assert.doesNotMatch(serialized, /desktop-secret|BASH_ENV|TOKEN/);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
  await f.workspaces.projects.with(f.id, f.beta, async () => assert.equal((await f.manager.view(f.id)).bindingMismatch, true));
  assert.equal((await f.manager.view(f.id, true)).status, 'ready');
});
test('Desktop readiness retains the lease until the bound result is saved', async (t) => {
  const f = await fixture(t); let held = false;
  f.state.onProbe = async () => {
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' }); held = true;
  };
  // The final readonly check also executes while the preparation lease is held.
  await f.start(); assert.equal(held, true);
  f.state.onProbe = undefined;
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});
test('asynchronous selection keeps the original named project; config/live replacement executes no body', async (t) => {
  const f = await fixture(t); f.state.beforeResolve = async () => {
    await f.workspaces.projects.with(f.id, f.beta, async () => assert.equal((await f.workspaces.config(f.id)).directory, '/workspace/beta'));
  };
  await f.start(); assert.equal((await f.bindings.read(f.id))?.projectId, f.alpha);
  await f.manager.stop(f.id);
  f.state.beforeResolve = async () => { f.machines.live.set(f.id, { ...f.live, startedAt: 'replacement' } as any); };
  const before = f.identity.inputs.length;
  await assert.rejects(f.start(), { code: 'DESKTOP_SCOPE_CHANGED' }); assert.equal(f.identity.inputs.length, before);
});
test('configuration drift before resolution refuses launch and releases the preparation lease', async (t) => {
  const f = await fixture(t); f.state.beforeResolve = async () => {
    await writeFile(f.workspaces.projects.file(f.id), JSON.stringify({ ...f.config, command: 'changed-during-resolution' }));
  };
  await assert.rejects(f.start(), { code: 'DESKTOP_SCOPE_CHANGED' }); assert.equal(f.identity.inputs.length, 0);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});
for (const mode of ['prepare-ack-lost', 'pane-ack-lost', 'commit-ack-lost'])
  test(`Desktop ${mode} cleans the original full domain and preserves a stopped receipt`, async (t) => {
    const f = await fixture(t, mode); await assert.rejects(f.start());
    const binding = await f.bindings.read(f.id); assert.equal(binding?.version, 2);
    if (binding?.version !== 2) assert.fail();
    assert.equal(binding.state, 'stopped'); assert.equal(binding.enabled, false);
    assert.equal(binding.execution.record.phase, 'stopped'); assert.equal(f.state.neighbor, true);
    for (const run of f.identity.tickets.values()) assert.equal(run.phase, 'closed');
  });
test('abort after native commit retires detached descendants and only the original run', async (t) => {
  const f = await fixture(t), controller = new AbortController();
  f.state.onCommit = () => controller.abort(new Error('operation cancelled'));
  await assert.rejects(f.start(controller)); assert.equal(f.state.detached, false);
  assert.equal(f.state.neighbor, true); assert.equal((await f.bindings.read(f.id))?.enabled, false);
});
for (const mode of ['stop-ack-lost', 'first-stop-failure'])
  test(`Desktop ${mode} confirms complete native retirement on retry`, async (t) => {
    const f = await fixture(t, mode); await f.start();
    if (mode === 'first-stop-failure') f.state.stopFailures = 1;
    await f.manager.stop(f.id); assert.ok(f.state.stopCalls >= 2); assert.equal(f.state.killed, 1);
    assert.equal(f.state.neighbor, true); assert.equal((await f.bindings.read(f.id))?.enabled, false);
  });
test('all exact cleanup failures stay 503 with full active proof and permit accurate retry', async (t) => {
  const f = await fixture(t); await f.start(); f.state.stopFailures = 3;
  await assert.rejects(f.manager.stop(f.id), { status: 503, code: 'SERVICE_CLEANUP_FAILED' });
  let binding = await f.bindings.read(f.id); assert.equal(binding?.version, 2);
  if (binding?.version !== 2) assert.fail();
  const original = binding.execution.run; assert.ok(original); assert.equal(binding.state, 'review');
  assert.equal(f.state.detached, true); assert.equal(f.identity.tickets.get(original.runId)!.phase, 'active');
  await f.manager.stop(f.id); binding = await f.bindings.read(f.id);
  assert.equal(binding?.version === 2 && binding.state, 'stopped'); assert.equal(f.state.neighbor, true);
});
test('guard partial publication rolls back before any UID body; failed retirement retains full proof', async (t) => {
  const f = await fixture(t); f.state.guardFailure = true; f.state.cleanupFailure = true;
  await assert.rejects(f.start(), { status: 503, code: 'DESKTOP_CLEANUP_FAILED' });
  assert.equal(f.identity.inputs.length, 0);
  const binding = await f.bindings.read(f.id); assert.equal(binding?.version === 2 && binding.state, 'review');
  f.state.cleanupFailure = false; await f.manager.stop(f.id);
  assert.equal((await f.bindings.read(f.id))?.version === 2 && (await f.bindings.read(f.id) as any).state, 'stopped');
});
test('replacement cgroup inode is never killed or adopted; original full ticket remains available', async (t) => {
  const f = await fixture(t); await f.start(); const original = f.owner.inode; f.owner.inode = '887766';
  await assert.rejects(f.manager.stop(f.id), { status: 503 }); assert.equal(f.state.killed, 0);
  assert.equal(f.state.detached, true); assert.equal(f.state.neighbor, true);
  const binding = await f.bindings.read(f.id); assert.equal(binding?.version === 2 && binding.execution.run!.cgroupInode, original);
  f.owner.inode = original; await f.manager.stop(f.id); assert.equal(f.state.killed, 1);
});
test('reload reads full ticket and endpoint without advancing host journals or reinstalling helpers', async (t) => {
  const f = await fixture(t); await f.start(); const file = join(vmDir(f.id), 'desktop-binding.json'), before = await readFile(file);
  const ensures = f.identity.state.ensureCalls, commands = f.state.commands.length;
  assert.equal(await f.manager.restore(f.id), null); await f.manager.view(f.id, true);
  assert.deepEqual(await readFile(file), before); assert.equal(f.identity.state.ensureCalls, ensures);
  assert.ok(f.state.commands.slice(commands).every(command => !/SAKURA_PROJECT_SERVICE_(PREPARE|START|COMMIT|STOP)/.test(command)));
  f.state.endpointDrift = true;
  await assert.rejects(f.manager.view(f.id, true), { code: 'DESKTOP_SCOPE_CHANGED' });
  assert.deepEqual(await readFile(file), before);
});
test('cold boot retires absent original domain without signaling new neighbors before authorized restore', async (t) => {
  const f = await fixture(t); await f.start(); const original = f.owner.record!;
  f.state.boot = randomUUID(); f.owner.record = null; f.owner.inode = null; f.state.detached = false;
  // Guest /run native receipts are volatile and absent after a true reboot.
  f.identity.tickets.clear();
  const restored = await f.manager.restore(f.id);
  assert.equal(restored?.projectId, f.alpha); assert.equal(f.state.stopCalls, 0); assert.equal(f.state.killed, 0);
  assert.equal(f.state.neighbor, true); assert.equal(f.identity.tickets.has(original.runId), false);
  assert.equal((await f.bindings.read(f.id))?.version === 2 && (await f.bindings.read(f.id) as any).execution.record.runId, original.runId);
});
test('legacy shared launcher records are review-only and never trigger global UID cleanup', async (t) => {
  const f = await fixture(t);
  await writeFile(join(vmDir(f.id), 'desktop-binding.json'), JSON.stringify({ version: 1, projectId: f.alpha,
    directory: '/workspace/alpha', networkIsolation: 'private', launcherSha256: 'c'.repeat(64), enabled: true }));
  await assert.rejects(f.start(), { code: 'DESKTOP_LEGACY_REVIEW_REQUIRED' });
  await assert.rejects(f.manager.stop(f.id), { code: 'DESKTOP_LEGACY_REVIEW_REQUIRED' });
  assert.equal((await f.manager.view(f.id)).status, 'error'); assert.equal(f.identity.inputs.length, 0);
  assert.ok(f.state.commands.every(command => !command.includes('killall') && !command.includes('pgrep -u')));
});
test('clipboard preparation pins original project and retains lease through the caller result', async (t) => {
  const f = await fixture(t); await f.start();
  const context = await f.workspaces.projects.with(f.id, f.alpha, () => f.manager.application(f.id));
  assert.equal(context.desktop.identity.uid, context.desktop.run.projectId === f.alpha ? 20001 : -1);
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
  await f.workspaces.projects.with(f.id, f.alpha, () => context.validate()); await context.release();
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});
test('UID payload bounds and fixed Root package adapter keep commands/environment out of Root scope argv', () => {
  const uid = desktopUidCommand(randomUUID(), { ...defaultDesktopPreferences, monitorLayout: 'dual-horizontal', sessionType: 'wayland' }, 'alpine', 20001);
  assert.doesNotMatch(uid, /cd |setpriv|killall|\/home\/sakura-desktop/);
  assert.match(uid, /kwin_wayland_wrapper|startplasma-wayland/); assert.match(uid, /xrandr --setmonitor/);
  assert.ok(projectIdentityPayload({ command: uid, environment: { TOKEN: 'snow-雪' } }).input.length < 131072);
  assert.deepEqual(desktopProjectEnvironment({ HOME: '/root', USER: 'root', DISPLAY: ':99', XAUTHORITY: '/tmp/x',
    SAKURA_DESKTOP_RUNTIME: '/tmp/fake', TOKEN: 'kept', BASH_ENV: 'uid-hook' }), { TOKEN: 'kept', BASH_ENV: 'uid-hook' });
  assert.throws(() => projectIdentityPayload({ command: uid, environment: { TOKEN: 'x'.repeat(8193) } }));
  const prepare = desktopProjectPrepare('alpine', defaultDesktopPreferences);
  assert.match(prepare, /env -i/); assert.doesNotMatch(prepare, /sakura-desktop-session|sakura-desktop-launcher|chown -R|\/home\/sakura-desktop/);
  assert.match(prepare, /apk add/);
});
test('fixed adapter Python compiles and stream errors stay off binary stdout', () => {
  const parsed = spawnSync('python', ['-c', "import ast,sys;ast.parse(sys.stdin.read());print('compiled')"], { input: desktopAdapterSource, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr); assert.match(parsed.stdout, /compiled/);
  assert.match(desktopAdapterSource, /request\.get\('op'\)!='stream'/);
  assert.match(desktopAdapterSource, /desktop_authority\(proof\)/); assert.doesNotMatch(desktopAdapterSource, /eval\(.*command|killall/);
});

test('start rollback 503 retains reservation and config guard until original stop retry completes', async t => {
  const f = await fixture(t, 'commit-ack-lost'); f.state.stopFailures = 3;
  await assert.rejects(f.start(), { status: 503, code: 'SERVICE_CLEANUP_FAILED' });
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
  await assert.rejects(f.start(), { status: 503, code: 'DESKTOP_CLEANUP_FAILED' });
  const retried = new ProjectDesktops(f.machines, f.workspaces, f.options);
  await retried.stop(f.id);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
  assert.equal(f.state.neighbor, true); assert.equal(f.state.detached, false);
});

test('adapter cleanup 503 keeps pending lease after native closure until adapter retirement is confirmed', async t => {
  const f = await fixture(t); f.state.onProbe = async () => { throw new AppError('readiness failed', 409, 'MODEL_FAILURE'); };
  f.state.cleanupFailure = true;
  await assert.rejects(f.start(), { status: 503, code: 'DESKTOP_CLEANUP_FAILED' });
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
  f.state.cleanupFailure = false; await f.manager.stop(f.id);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});

test('registered application full-domain cleanup precedes native retirement and its 503 retains original reservation', async t => {
  const f = await fixture(t); let fail = true, checked = false;
  f.options.beforeRetire = async () => {
    assert.ok(f.state.detached); assert.ok([...f.identity.tickets.values()].some(run => run.phase === 'active'));
    checked = true; if (fail) throw new AppError('original app group not confirmed', 503, 'LINUX_CLIPBOARD_CLEANUP_FAILED');
  };
  f.state.onProbe = async () => { throw new AppError('readiness failed', 409, 'MODEL_FAILURE'); };
  await assert.rejects(f.start(), { status: 503, code: 'LINUX_CLIPBOARD_CLEANUP_FAILED' });
  assert.equal(checked, true);
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
  fail = false; await f.manager.stop(f.id);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});

test('partial preferences are copied before awaits and configure retains original saved preferences', async t => {
  const f = await fixture(t), input = { theme: 'midnight' as const, panel: 'top' as const };
  const started = f.start(new AbortController(), input); (input as any).theme = 'paper';
  await started;
  let binding = await f.bindings.read(f.id); assert.equal(binding?.version === 2 && binding.preferences.theme, 'midnight');
  const configure = { scale: 150 }, updated = f.start(new AbortController(), configure, 'configure');
  configure.scale = 200; await updated;
  binding = await f.bindings.read(f.id);
  assert.equal(binding?.version === 2 && binding.preferences.scale, 150);
  assert.equal(binding?.version === 2 && binding.preferences.theme, 'midnight');
  assert.equal(binding?.version === 2 && binding.preferences.panel, 'top');
});

test('administrative cleanup captures the original live object and refuses replacement control connections', async t => {
  const f = await fixture(t); f.state.installed = false;
  f.state.beforePrepare = async () => { f.machines.live.set(f.id, { ...f.live, startedAt: 'replacement-live' } as any); };
  await assert.rejects(f.start(new AbortController(), undefined, 'install'), { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' });
  assert.ok(!f.state.commands.some(command => command.startsWith('# SAKURA_GUEST_TASK_CLEANUP')));
  assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
  const before = f.state.commands.length;
  await assert.rejects(f.manager.stop(f.id), { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' });
  assert.equal(f.state.commands.length, before);
  f.machines.live.set(f.id, f.live as any); await f.manager.stop(f.id);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});

test('IME retires the original complete desktop and writes only its native HOME in the UID frame', async t => {
  const f = await fixture(t); await f.start(new AbortController(), { theme: 'midnight', panel: 'top' });
  const original = await f.bindings.read(f.id); assert.equal(original?.version, 2);
  f.state.beforePrepare = async () => {
    assert.equal(f.state.detached, false);
    assert.ok([...f.identity.tickets.values()].every(ticket => ticket.phase === 'closed'));
    assert.throws(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
    await f.workspaces.projects.update(f.id, f.beta);
  };
  await f.start(new AbortController(), undefined, 'ime');
  const binding = await f.bindings.read(f.id); assert.equal(binding?.version, 2);
  if (binding?.version !== 2 || original?.version !== 2) assert.fail();
  assert.equal(binding.projectId, f.alpha); assert.equal(binding.state, 'running');
  assert.equal(binding.preferences.theme, 'midnight'); assert.equal(binding.preferences.panel, 'top');
  assert.notEqual(binding.execution.run!.runId, original.execution.run!.runId);
  assert.equal(f.state.killed, 1); assert.equal(f.state.neighbor, true);
  const frame = f.identity.inputs.at(-1)!, script = frame.subarray(32, 32 + frame.readUInt32LE(24)).toString();
  assert.match(script, /"\$HOME\/\.config\/autostart\/fcitx5\.desktop"/);
  assert.match(script, /"\$HOME\/\.sakura-ime"/); assert.match(script, /\. \$HOME\/\.sakura-ime/);
  assert.doesNotMatch(script, /\/home\/sakura-desktop|chown -R|sakura-desktop-launcher|\bcd /);
  const administration = f.state.commands.find(command => command.startsWith('# SAKURA_GUEST_TASK_RUN') && command.includes('fcitx5'))!;
  assert.ok(administration); assert.match(administration, /env -i PATH=/);
  assert.doesNotMatch(administration, /desktop-secret|desktop-hook|\.sakura-ime|sakura-desktop-session|\/workspace\/alpha/);
  assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines, f.id, f.alpha));
});

test('IME fixed package boundary and combined UID payload obey native limits without replacing existing profiles', () => {
  for (const distro of ['alpine', 'debian']) {
    const root = desktopProjectImePrepare(distro);
    assert.match(root, /^env -i PATH=.*HOME=\//); assert.match(root, /fcitx5/);
    assert.doesNotMatch(root, /\/home|\.sakura-ime|autostart|sakura-desktop-launcher|chown|setpriv/);
    const script = desktopProjectImeCommand + '\n' + desktopUidCommand(randomUUID(), defaultDesktopPreferences, distro, 20001);
    assert.match(script, /if \[ ! -f "\$HOME\/\.config\/fcitx5\/profile" \]/);
    assert.ok(projectIdentityPayload({ command: script, environment: { TOKEN: '雪' } }).input.length < 131072);
  }
});

test('IME refuses unavailable Desktop and another project owner without issuing an administration task', async t => {
  const f = await fixture(t); f.state.installed = false;
  await assert.rejects(f.start(new AbortController(), undefined, 'ime'), { status: 409 });
  assert.equal(f.state.preparations, 0); assert.equal(f.identity.inputs.length, 0);
  f.state.installed = true; await f.start();
  await assert.rejects(f.manager.start(f.id, 'ime', undefined, { ...f.pins, projectId: f.beta },
    new AbortController().signal, () => {}, () => {}), { status: 409, code: 'DESKTOP_SCOPE_CHANGED' });
  assert.equal(f.state.preparations, 0); assert.equal(f.state.killed, 0);
});
