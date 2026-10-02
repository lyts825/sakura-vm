import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectProtocolDuplex, ProjectProtocolStreams, projectProtocolRelaySource, projectProtocolStreamSchema,
  type ProjectProtocolStreamRecord } from '../server/project-protocol-stream.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import { guestTaskControlPlan } from '../server/guest-task.ts';
import { AppError } from '../server/model.ts';
import { Jobs } from '../server/jobs.ts';
import { projectVersion, type Project, type Workspaces } from '../server/workspaces.ts';
import type { Machines } from '../server/machines.ts';
import { identityFor, runFor } from './project-protocol-fixture.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-owned-protocol-'));
after(() => rm(directory, { recursive: true, force: true }));
async function fixture(network: 'host' | 'private' = 'host') {
  const root = await mkdtemp(join(directory, 'case-')), vmId = randomUUID(), projectId = '1234567890abcdef', live = {};
  const project: Project = { directory: '/workspace/stream', template: 'none', repository: '', setup: '', command: '', networkIsolation: network, environment: { SESSION_SECRET: 'protocol-only-secret', PATH: '/project/bin' } };
  Object.defineProperty(project, '_workspace', { value: projectId, enumerable: false });
  const identity = identityFor(project), bootId = randomUUID();
  let boot: string = bootId;
  let taskRun = runFor(identity, randomUUID(), bootId), nativeSha = '', nativeIdentity = { ...identity }, nativeClosed = false;
  let activeFailure: Error | undefined, queryFailure: Error | undefined, cleanupFailure = false, afterFailure = false, cleanupCode = 'PROJECT_IDENTITY_CLEANUP_FAILED';
  let prepareFailure = false, resolveWrongScope = false, capturedWrongScope = false, disconnectAfterFrame = false, rejectExec = false;
  let preparationLeases = 0, admissionLeases = 0, admits = 0, activeCalls = 0, localScope = projectId;
  const calls: string[] = [], commands: string[] = [], sent: Buffer[] = [];
  let recordFile = '', plan: ReturnType<typeof guestTaskControlPlan> | undefined, wire: Duplex | undefined;
  const machines = { live: new Map([[vmId, live]]), state: () => 'running', exec: async (_id: string, command: string) => {
    commands.push(command);
    if (command.endsWith('/proc/sys/kernel/random/boot_id')) { calls.push('boot'); return { code: 0, stdout: boot, stderr: '' }; }
    if (plan?.cleanup === command) { calls.push('whole-cgroup-stop'); return { code: cleanupFailure ? 1 : 0, stdout: '', stderr: cleanupFailure ? 'original cgroup still contains detached child' : '' }; }
    if (plan?.confirmStopped === command) { calls.push('original-scope-absent'); return { code: 0, stdout: '', stderr: '' }; }
    if (plan?.retire === command) { calls.push('root-owner-retire'); return { code: 0, stdout: '', stderr: '' }; }
    if (command.includes('test ! -e')) { calls.push('old-root-owner-absent'); return { code: 0, stdout: '', stderr: '' }; }
    throw new Error('Unexpected root command');
  } } as unknown as Machines;
  const workspaces = { projects: { current: () => localScope, inScope: async (_id: string, scope: string, action: () => Promise<unknown>) => {
    const previous = localScope; localScope = scope; try { return await action(); } finally { localScope = previous; }
  } }, config: async () => project, resolveProject: async (_id: string, value: Project) => {
    assert.equal(value._workspace, projectId); assert.equal(Object.keys(value).includes('_workspace'), false);
    const resolved = { ...value }; Object.defineProperty(resolved, '_workspace', { value: resolveWrongScope ? 'fedcba0987654321' : value._workspace, enumerable: false });
    return resolved;
  } } as unknown as Workspaces;
  const preparation = { prepare: async (_id: string, scope: string, _cwd: unknown, _install: boolean, signal: AbortSignal) => {
    calls.push('prepare-lease'); assert.equal(scope, projectId);
    if (prepareFailure) throw new AppError('prep refusal', 409);
    ++preparationLeases;
    const captured = Object.defineProperty({ ...project }, '_workspace', { value: capturedWrongScope ? 'fedcba0987654321' : projectId, enumerable: false });
    return { projectId, signal, captured: { project: captured, configVersion: projectVersion(project), live },
      release: async () => { calls.push('prepare-release'); preparationLeases = 0; } };
  }, close: async () => { calls.push('preparation-close'); } };
  const scopes = { admitTask: async (_id: string, original: Project, execution: Parameters<typeof projectIdentityPayload>[0], _signal: AbortSignal, options: any) => {
    ++admits; assert.equal(original._workspace, projectId); assert.equal(options.expectedLive, live); assert.equal(options.expectedBootId, bootId);
    const payload = projectIdentityPayload(execution); nativeSha = payload.sha256;
    taskRun = runFor(identity, randomUUID(), bootId);
    await options.beforeIntent({ identity, sha256: payload.sha256, owner: { kind: 'task', runId: taskRun.runId, bootId } });
    recordFile = join(root, 'project-protocol-streams', projectId, taskRun.runId + '.json');
    const intent = JSON.parse(await readFile(recordFile, 'utf8'));
    assert.equal(intent.phase, 'intent'); assert.equal(intent.issued, false); assert.equal(intent.sha256, nativeSha);
    calls.push('lower-host-intent'); ++admissionLeases;
    plan = guestTaskControlPlan(taskRun.runId, intent.controlToken, '', intent.timeoutMs);
    return { live: live as never, owner: { kind: 'task' as const, runId: taskRun.runId, bootId }, agentContext: undefined, forwarding: undefined, gpgContext: undefined, gpgForwarding: undefined, payload: { ...payload, identity, runId: taskRun.runId,
      command: '/usr/bin/env -i HOME=/ /usr/bin/python3 -I -S /fixed/controller.py ' + Buffer.from(JSON.stringify({ action: 'exec-current-session', run: taskRun.runId, sha256: payload.sha256 })).toString('base64') },
      release: () => { calls.push('admission-release'); admissionLeases = 0; } };
  }, active: async () => { ++activeCalls; calls.push('native-activate-query'); if (activeFailure) throw activeFailure; return true; },
    readonlyTask: async () => { calls.push('native-readonly'); if (queryFailure) throw queryFailure;
      return { identity: nativeIdentity, owner: { kind: 'task' as const, runId: taskRun.runId, bootId }, sha256: nativeSha,
        phase: 'active' as const, run: taskRun }; },
    taskRun: async () => { calls.push('lower-intent-readonly'); return { identity: { ...nativeIdentity },
      owner: { kind: 'task' as const, runId: taskRun.runId, bootId }, sha256: nativeSha, phase: 'active' as const,
      run: structuredClone(taskRun) }; },
    closeAfterScopeStopped: async () => { calls.push(boot !== bootId ? 'old-boot-native-retire' : 'native-close-after-scope');
      if (afterFailure) throw new AppError('native cleanup query failed', 503, cleanupCode); nativeClosed = true; },
  };
  const options = { rootDirectory: root, scopes, identities: { runReadonly: async () => { if (queryFailure) throw queryFailure; return structuredClone(taskRun); } },
    createPreparation: () => preparation as never,
    channel: async (_id: string, command: string) => {
      calls.push('ssh-protocol-exec'); commands.push(command);
      assert.ok(!command.includes('protocol-only-secret')); assert.ok(!command.includes('/project/bin'));
      const issued = JSON.parse(await readFile(recordFile, 'utf8')); assert.equal(issued.issued, true);
      if (rejectExec) throw new Error('lost SSH exec acknowledgement');
      wire = new Duplex({ allowHalfOpen: true, read() {}, write(chunk, _encoding, done) {
        sent.push(Buffer.from(chunk)); if (disconnectAfterFrame) queueMicrotask(() => wire!.destroy()); done();
      } }); wire.on('error', () => {}); return { wire, close: () => { calls.push('ssh-client-close'); wire!.destroy(); } };
    } };
  const streams = new ProjectProtocolStreams(machines, workspaces, options);
  return { streams, machines, workspaces, options, root, vmId, projectId, project, identity, calls, commands, sent,
    open: (signal?: AbortSignal) => streams.open(vmId, 'dap', project, () => ({ command: 'exec /fixed/adapter --stdio' }), signal),
    reload: () => new ProjectProtocolStreams(machines, workspaces, options),
    record: async () => JSON.parse(await readFile(recordFile, 'utf8')) as ProjectProtocolStreamRecord,
    archived: async () => JSON.parse(await readFile(join(root, 'project-protocol-streams', projectId, 'closed', taskRun.runId + '.json'), 'utf8')) as ProjectProtocolStreamRecord,
    nativeClosed: () => nativeClosed, leases: () => [preparationLeases, admissionLeases], admits: () => admits,
    taskRun: () => structuredClone(taskRun), activeCalls: () => activeCalls,
    setBoot: (value: string) => { boot = value; }, setCleanupFailure: (value: boolean) => { cleanupFailure = value; },
    setAfterFailure: (value: boolean, code = 'PROJECT_IDENTITY_CLEANUP_FAILED') => { afterFailure = value; cleanupCode = code; }, setPrepareFailure: () => { prepareFailure = true; },
    setWrongScope: (where: 'resolve' | 'capture') => { if (where === 'resolve') resolveWrongScope = true; else capturedWrongScope = true; },
    setQueryFailure: (value: Error | undefined) => { queryFailure = value; }, setActiveFailure: (value: Error) => { activeFailure = value; },
    setPin: (patch: Partial<typeof taskRun>) => { Object.assign(taskRun, patch); },
    setIdentity: (patch: Partial<typeof identity>) => { Object.assign(nativeIdentity, patch); },
    setSha: (value: string) => { nativeSha = value; }, setDisconnectAfterFrame: () => { disconnectAfterFrame = true; }, setRejectExec: () => { rejectExec = true; },
  };
}

test('owned SESSION2 admission persists own intent before lower intent and sends exact frame without protocol EOF', async () => {
  const f = await fixture('private'), owner = await f.open();
  assert.equal(owner.record().phase, 'active'); assert.deepEqual(owner.record().run, f.taskRun());
  assert.equal(owner.record().identity.home, f.identity.home); assert.equal(owner.record().run?.namespace, 'sk-' + f.projectId);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].readUInt32LE(12), 2); assert.ok(f.sent[0].includes(Buffer.from('protocol-only-secret')));
  assert.equal(owner.stream.writableEnded, false); assert.deepEqual(f.leases(), [1, 1]);
  await owner.assertCurrent(); await owner.assertNative(); await owner.close();
  assert.equal(f.nativeClosed(), true); assert.deepEqual(f.leases(), [0, 0]);
  for (const [before, after] of [['whole-cgroup-stop', 'original-scope-absent'], ['original-scope-absent', 'native-close-after-scope'],
    ['native-close-after-scope', 'root-owner-retire'], ['root-owner-retire', 'prepare-release']])
    assert.ok(f.calls.indexOf(before) < f.calls.indexOf(after));
  assert.equal((await f.archived()).closure?.reason, 'scope-stopped'); assert.deepEqual(await f.streams.recordsAll(f.vmId), []);
});

test('detached child prevents native closure and retains original ticket plus leases until explicit retry', async () => {
  const f = await fixture(), owner = await f.open(), original = owner.record(); f.setCleanupFailure(true);
  await assert.rejects(owner.close(), { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' });
  assert.deepEqual((await f.record()).run, original.run); assert.equal((await f.record()).phase, 'review');
  assert.equal(f.nativeClosed(), false); assert.deepEqual(f.leases(), [1, 1]);
  assert.equal(f.calls.includes('native-close-after-scope'), false); assert.equal(f.calls.includes('root-owner-retire'), false);
  f.setCleanupFailure(false); await owner.close(); assert.deepEqual(f.leases(), [0, 0]); assert.equal((await f.archived()).phase, 'closed');
});

test('native cleanup failure preserves full original scope receipt and status code', async () => {
  const f = await fixture(), owner = await f.open(); f.setAfterFailure(true);
  await assert.rejects(owner.close(), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal((await f.record()).phase, 'review'); assert.deepEqual(f.leases(), [1, 1]); assert.equal(f.calls.includes('root-owner-retire'), false);
  f.setAfterFailure(false); await owner.close();
});

test('closed native phase cannot close the host stream while the original full cgroup survives', async () => {
  const f = await fixture(), owner = await f.open(), original = owner.record();
  f.setPin({ phase: 'closed' }); f.setCleanupFailure(true);
  await assert.rejects(owner.close(), { status: 503 }); assert.deepEqual((await f.record()).run, original.run);
  assert.equal((await f.record()).phase, 'review'); assert.equal(f.calls.includes('native-close-after-scope'), false);
  f.setCleanupFailure(false); await owner.close();
});

test('protocol cancellation cleanup 503 remains a durable Jobs failure rather than cancelled success', async () => {
  const f = await fixture(), jobs = new Jobs('owned-stream-job', f.root), abort = new AbortController();
  f.setCleanupFailure(true); let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const tracked = jobs.track('lsp', async (_log, signal) => {
    const owner = await f.open(signal), cancelled = new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    entered(); await cancelled; await owner.close();
  }, {}, abort.signal);
  const refused = assert.rejects(tracked, { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' });
  await ready; abort.abort(); await refused; await jobs.close();
  const restored = new Jobs('owned-stream-job', f.root); assert.equal(restored.view('lsp')?.status, 'error');
  assert.equal(restored.view('lsp')?.errorCode, 'GUEST_TASK_CLEANUP_FAILED'); await restored.close();
  const original = await f.record(); assert.equal(original.phase, 'review'); assert.deepEqual(f.leases(), [1, 1]);
  f.setCleanupFailure(false); await f.streams.stop(f.vmId, f.projectId, original.runId); assert.deepEqual(f.leases(), [0, 0]);
});

test('other project stop and orphan recovery cannot affect a connected original protocol owner', async () => {
  const f = await fixture(), owner = await f.open();
  await assert.rejects(f.streams.stop(f.vmId, 'fedcba0987654321', owner.record().runId), { status: 409 });
  await f.streams.recover(f.vmId, f.projectId, 'dap');
  await f.streams.recover(f.vmId, 'fedcba0987654321', 'dap');
  assert.equal(f.calls.includes('whole-cgroup-stop'), false); assert.equal(owner.stream.destroyed, false); await owner.close();
});

test('lost activation acknowledgement retains cleanup intent and reload cleans original domain without new prepare', async () => {
  const f = await fixture(); f.setActiveFailure(new AppError('native activation ack lost', 502, 'PROJECT_IDENTITY_CONTROL_FAILED')); f.setCleanupFailure(true);
  await assert.rejects(f.open(), { status: 503, code: 'GUEST_TASK_CLEANUP_FAILED' });
  const original = await f.record(); assert.equal(original.phase, 'review'); assert.equal(original.run, null); assert.equal(original.issued, true);
  f.setCleanupFailure(false); const reloaded = f.reload(); await reloaded.stop(f.vmId, f.projectId, original.runId);
  assert.equal(f.admits(), 1); assert.equal((await f.archived()).phase, 'closed'); await f.streams.close();
});

test('lost exec acknowledgement is conservatively issued and cannot discard original cleanup authority', async () => {
  const f = await fixture(); f.setRejectExec(); f.setCleanupFailure(true);
  await assert.rejects(f.open(), { status: 503 }); const original = await f.record();
  assert.equal(original.issued, true); assert.equal(original.phase, 'review');
  f.setCleanupFailure(false); await f.reload().stop(f.vmId, f.projectId, original.runId); await f.streams.close();
  assert.deepEqual(f.leases(), [0, 0]);
});

test('protocol close after frame performs full scope cleanup and preserves cleanup failures for retry', async () => {
  const f = await fixture(); f.setDisconnectAfterFrame(); f.setCleanupFailure(true);
  await assert.rejects(f.open(), { status: 503 });
  assert.equal((await f.record()).phase, 'review'); assert.deepEqual(f.leases(), [1, 1]);
  f.setCleanupFailure(false); await f.streams.close(); assert.deepEqual(f.leases(), [0, 0]);
});

test('readonly reload uses full original pinned receipt without install, prepare or host phase change', async () => {
  const f = await fixture(), owner = await f.open(), original = await f.record(), reloaded = f.reload();
  const before = f.admits(), queries = f.activeCalls(); await reloaded.readonly(original);
  assert.deepEqual(await f.record(), original); assert.equal(f.admits(), before); assert.equal(f.activeCalls(), queries);
  await assert.rejects(reloaded.readonly({ ...original, phase: 'intent', run: null }), { status: 409 });
  assert.deepEqual(await f.record(), original); await owner.close();
});

for (const [label, patch] of Object.entries({ cgroupInode: { cgroupInode: '99' }, networkInode: { networkInode: '99' },
  build: { build: 'b'.repeat(64) }, boot: { bootId: randomUUID() }, run: { runId: randomUUID() }, closed: { phase: 'closed' as const } })) {
  test('readonly protocol owner refuses changed native ' + label + ' without modifying original receipt', async () => {
    const f = await fixture(), owner = await f.open(), original = await f.record(); f.setPin(patch);
    await assert.rejects(owner.assertNative(), { status: 409 }); assert.deepEqual(await f.record(), original);
    f.setPin(original.run!); await owner.close();
  });
}
test('readonly protocol owner binds full identity and transport digest, and does not swallow native query error', async () => {
  const f = await fixture(), owner = await f.open(), original = await f.record();
  f.setIdentity({ homeInode: '999' }); await assert.rejects(owner.assertNative(), { status: 409 }); f.setIdentity(original.identity);
  f.setSha('c'.repeat(64)); await assert.rejects(owner.assertNative(), { status: 409 }); f.setSha(original.sha256);
  f.setQueryFailure(new AppError('native proof unavailable', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'));
  await assert.rejects(owner.assertNative(), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.deepEqual(await f.record(), original); f.setQueryFailure(undefined); await owner.close();
});

test('cold boot rejects old readonly owner and retires old complete ticket without issuing a new-boot kill', async () => {
  const f = await fixture(), owner = await f.open(), original = await f.record(), boot = randomUUID();
  f.setBoot(boot); await assert.rejects(f.reload().readonly(original), { status: 409 });
  f.calls.length = 0; await owner.close();
  assert.equal(f.calls.includes('whole-cgroup-stop'), false); assert.equal(f.calls.includes('root-owner-retire'), false);
  assert.equal(f.calls.includes('old-boot-native-retire'), true);
  const closed = await f.archived(); assert.deepEqual(closed.run, original.run); assert.deepEqual(closed.closure, { reason: 'guest-reboot', bootId: boot });
});

test('live replacement cannot target another VM process and preserves original cleanup authority', async () => {
  const f = await fixture(), owner = await f.open(), old = f.machines.live.get(f.vmId)!;
  f.machines.live.set(f.vmId, {} as never); await assert.rejects(owner.close(), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(f.calls.includes('whole-cgroup-stop'), false); assert.deepEqual(f.leases(), [1, 1]);
  f.machines.live.set(f.vmId, old); await owner.close();
});

for (const where of ['resolve', 'capture'] as const) test('non-enumerable named project capture cannot be replaced despite matching hash: ' + where, async () => {
  const f = await fixture(); f.setWrongScope(where); assert.equal(Object.keys(f.project).includes('_workspace'), false);
  await assert.rejects(f.open(), { status: 409, code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(f.admits(), 0); assert.deepEqual(f.leases(), [0, 0]);
});
test('prepare refusal closes only own manager and never issues native or SSH execution', async () => {
  const f = await fixture(); f.setPrepareFailure(); await assert.rejects(f.open(), /prep refusal/);
  assert.equal(f.admits(), 0); assert.equal(f.calls.includes('ssh-protocol-exec'), false); assert.deepEqual(f.leases(), [0, 0]);
});

test('explicit expected original live refuses replacement before any prepare or native issuance', async () => {
  const f = await fixture(), original = f.machines.live.get(f.vmId)!; f.machines.live.set(f.vmId, {} as never);
  await assert.rejects(f.streams.open(f.vmId, 'dap', f.project, () => ({ command: 'never-executed' }), undefined, undefined, original),
    { status: 409, code: 'PROJECT_IDENTITY_HOST_CHANGED' }); assert.equal(f.calls.length, 0); assert.equal(f.admits(), 0);
});

test('cleanup rejects a changed full lower pin before guest signal and native network 503 preserves its code', async () => {
  const f = await fixture(), owner = await f.open(), original = owner.record(); f.setPin({ cgroupInode: '999' });
  await assert.rejects(owner.close(), { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(f.calls.includes('whole-cgroup-stop'), false); assert.deepEqual((await f.record()).run, original.run);
  f.setPin(original.run!); f.setAfterFailure(true, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
  await assert.rejects(owner.close(), { status: 503, code: 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED' });
  assert.equal(f.calls.includes('root-owner-retire'), false); f.setAfterFailure(false); await owner.close();
});

test('schema refuses full ticket from another project, wrong original domain, incomplete active and early closed receipt', async () => {
  const f = await fixture(), owner = await f.open(), original = owner.record();
  for (const value of [{ ...original, vmId: 'not-uuid' }, { ...original, projectId: 'fedcba0987654321' },
    { ...original, run: { ...original.run!, cgroupName: 'sakura-service-' + original.runId } }, { ...original, run: null },
    { ...original, phase: 'closed' }, { ...original, phase: 'closed', closure: { reason: 'guest-reboot', bootId: original.bootId } }])
    assert.equal(projectProtocolStreamSchema.safeParse(value).success, false);
  await owner.close();
});

test('malformed persisted protocol receipt returns cleanup 503 without signaling or removing original evidence', async () => {
  const f = await fixture(), owner = await f.open(), original = owner.record();
  const file = join(f.root, 'project-protocol-streams', f.projectId, original.runId + '.json');
  const text = await readFile(file, 'utf8'), broken = '{invalid protected ownership json'; await writeFile(file, broken);
  f.calls.length = 0;
  await assert.rejects(f.reload().stop(f.vmId, f.projectId, original.runId),
    { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(await readFile(file, 'utf8'), broken); assert.equal(f.calls.length, 0); assert.deepEqual(f.leases(), [1, 1]);
  await writeFile(file, text); await owner.close();
});

test('closed receipts are archived intact and do not exhaust live protocol ledger on repeated LSP requests', async () => {
  const f = await fixture(), owner = await f.open(), original = owner.record(); await owner.close();
  const archive = join(f.root, 'project-protocol-streams', f.projectId, 'closed');
  const closed = await f.archived();
  await Promise.all(Array.from({ length: 1025 }, () => {
    const runId = randomUUID();
    const receipt = projectProtocolStreamSchema.parse({ ...closed, runId, run: { ...closed.run!, runId, cgroupName: 'sakura-task-' + runId } });
    return writeFile(join(archive, runId + '.json'), JSON.stringify(receipt));
  }));
  assert.deepEqual(await f.reload().recordsAll(f.vmId), []); assert.ok((await readdir(archive)).length > 1024);
  assert.deepEqual((await f.archived()).run, original.run);
});

test('binary protocol stream preserves NUL, half-close EOF, stdout bytes and write callback backpressure', async () => {
  let callback!: () => void, stopped = 0; const written: Buffer[] = [];
  const wire = new Duplex({ allowHalfOpen: true, read() {}, write(chunk, _encoding, done) { written.push(Buffer.from(chunk)); callback = done; } });
  const stream = new ProjectProtocolDuplex(wire, () => { ++stopped; }); let completed = false;
  const binary = Buffer.from([0, 255, 128, 10, 0]); stream.write(binary, () => { completed = true; });
  await delay(0); assert.equal(completed, false); callback(); await delay(0); assert.equal(completed, true);
  assert.deepEqual(written[0], binary); stream.end(); await new Promise<void>(resolve => wire.once('finish', resolve));
  assert.equal(stream.destroyed, false); wire.push(binary); wire.push(null);
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), binary); await delay(0); assert.equal(stopped, 1);
});

test('unconsumed protocol output pauses the SSH channel at bounded stream high-water mark', async () => {
  let stop = 0; const wire = new Duplex({ read() {}, write(_chunk, _encoding, done) { done(); } });
  const stream = new ProjectProtocolDuplex(wire, () => { ++stop; });
  assert.equal(wire.isPaused(), true); stream.read(0); wire.push(Buffer.alloc(65536, 0x7f)); await delay(0);
  assert.equal(wire.isPaused(), true); assert.ok(stream.readableLength <= 65536);
  stream.destroy(); await delay(0); assert.equal(stop, 1);
});

const pythonModel = String.raw`import ast,base64,hashlib,json,stat,struct,sys,time,types
case=json.loads(sys.stdin.buffer.read());source=ast.parse(case['source'])
program=ast.Module(body=[node for node in source.body if isinstance(node,ast.FunctionDef) and node.name in ('frame','refuse')],type_ignores=[])
data=base64.b64decode(case['data']);reads=[];original=case.get('flags',0);state={'data':data,'flags':original}
def read(fd,size):
 assert fd==0;reads.append(size);n=min(size,case.get('fragment',7));part=state['data'][:n];state['data']=state['data'][n:];return part
class Poller:
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def register(self,*args):pass
 def select(self,*args):return [] if case.get('timeout') else [1]
def fcntl(fd,operation,value=None):
 assert fd==0
 if operation==1:return state['flags']
 state['flags']=value
namespace={'request':{'sha256':case['sha256']},'hashlib':hashlib,'struct':struct,'stat':stat,'time':time,
 'selectors':types.SimpleNamespace(DefaultSelector=Poller,EVENT_READ=1),
 'fcntl':types.SimpleNamespace(fcntl=fcntl,F_GETFL=1,F_SETFL=2),
 'os':types.SimpleNamespace(O_ACCMODE=3,O_WRONLY=1,O_NONBLOCK=2048,read=read,fstat=lambda fd:types.SimpleNamespace(st_mode=case.get('mode',stat.S_IFIFO)))}
exec(compile(program,'original-protected-relay','exec'),namespace)
try:payload=namespace['frame']();result={'ok':True,'payload':base64.b64encode(payload).decode()}
except Exception as error:result={'ok':False,'error':str(error)}
result.update(rest=base64.b64encode(state['data']).decode(),reads=reads,restored=state['flags']==original);print(json.dumps(result))
`;
function frameModel(input: Buffer, sha256: string, options: Record<string, unknown> = {}) {
  const source = projectProtocolRelaySource(sha256, '/fixed/controller --metadata');
  const result = spawnSync(process.env.SAKURA_TEST_PYTHON || 'python', ['-I', '-S', '-c', pythonModel],
    { input: JSON.stringify({ source, data: input.toString('base64'), sha256, ...options }), encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}
test('original Python frame reader accepts fragmented protected frame while leaving binary protocol tail and EOF untouched', () => {
  const payload = projectIdentityPayload({ command: 'exec /adapter', environment: { TOKEN: '你好' }, stdin: 'session' });
  const tail = Buffer.from([0, 255, 128, 0, 13, 10]), result = frameModel(Buffer.concat([payload.input, tail]), payload.sha256, { fragment: 1 });
  assert.equal(result.ok, true); assert.equal(result.payload, payload.input.toString('base64'));
  assert.equal(result.rest, tail.toString('base64')); assert.equal(result.restored, true); assert.ok(Math.max(...result.reads) <= 65536);
});
test('original Python frame reader rejects unsupported transport combinations, bounds, wrong digest, truncate, fd type and timeout', () => {
  const payload = projectIdentityPayload({ command: 'exec /adapter', stdin: 'session' });
  const variants: [Buffer, Record<string, unknown>][] = [
    ...[0, 1, 3, 4, 0xffffffff].map(flags => { const input = Buffer.from(payload.input); input.writeUInt32LE(flags, 12); return [input, {}] as [Buffer, Record<string, unknown>]; }),
    [payload.input.subarray(0, 31), {}], [payload.input.subarray(0, -1), {}], [payload.input, { flags: 1 }],
    [payload.input, { mode: 32768 }], [payload.input, { mode: 8192 }], [payload.input, { timeout: true }],
  ];
  const reserved = Buffer.from(payload.input); reserved.writeUInt32LE(1, 28); variants.push([reserved, {}]);
  const huge = Buffer.from(payload.input); huge.writeUInt32LE(131041, 16); variants.push([huge, {}]);
  const wrongScript = Buffer.from(payload.input); wrongScript.writeUInt32LE(65537, 24); variants.push([wrongScript, {}]);
  const wrongCount = Buffer.from(payload.input); wrongCount.writeUInt32LE(129, 20); variants.push([wrongCount, {}]);
  const wrongVersion = Buffer.from(payload.input); wrongVersion.writeUInt32LE(2, 8); variants.push([wrongVersion, {}]);
  for (const [input, options] of variants) { const result = frameModel(input, createHash('sha256').update(input).digest('hex'), options); assert.equal(result.ok, false); assert.equal(result.restored, true); }
  const bad = frameModel(payload.input, 'f'.repeat(64)); assert.equal(bad.ok, false);
});
test('Root relay child launch owns separate PIPE frame and fd3 protocol, with pure stdout and metadata-only argv', () => {
  const payload = projectIdentityPayload({ command: 'echo secret-script', environment: { TOKEN: 'private-env' }, stdin: 'session' });
  const source = projectProtocolRelaySource(payload.sha256, '/fixed/controller --uuid --sha256');
  assert.match(source, /os.dup2\(0,3\)/); assert.match(source, /stdin=subprocess.PIPE,stdout=None,stderr=None/);
  assert.match(source, /close_fds=True,pass_fds=\(3,\)/); assert.match(source, /finally:os.close\(3\)/);
  assert.match(source, /child.stdin.close\(\);code=child.wait/); assert.ok(!source.includes('secret-script') && !source.includes('private-env'));
  assert.ok(Buffer.byteLength(source) < 8192);
});
