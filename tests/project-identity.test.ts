import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines } from '../server/machines.ts';
import { AppError } from '../server/model.ts';
import { ProjectIdentities, projectIdentityAssetNames, projectIdentitySchema, projectIdentityRunSchema,
  projectIdentitySources, projectIdentityPayload, projectIdentityNetworkSchema, projectIdentitySshDaemonSchema,
  type ProjectIdentityRun } from '../server/project-identity.ts';

const parent = resolve('.data/project-identity-unit-tests');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'sakura-project-identity-unit-'));
const aggregate = createHash('sha256'), files = [];
for (const name of projectIdentityAssetNames) {
  const bytes = await readFile(resolve('native/project-identity', name));
  aggregate.update(name).update(bytes);
  files.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  await writeFile(join(root, name), bytes);
}
const manifest = { version: 1, build: aggregate.digest('hex'), files };
await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), await realpath(parent));
  assert.match(basename(owned), /^sakura-project-identity-unit-/);
  await rm(owned, { recursive: true, force: true });
});
function fixture(projectId = 'default') {
  const identityId = randomUUID(), registryId = randomUUID();
  const identity = projectIdentitySchema.parse({ version: 1, phase: 'active', registryId, projectId,
    identityId, revision: 1, uid: 20000, gid: 20000, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
    home: '/var/lib/sakura-project-homes/' + identityId, homeDevice: '2049', homeInode: '800',
    directory: '/srv/project', directoryDevice: '2049', directoryInode: '900', networkIsolation: 'private' });
  const runId = randomUUID(), bootId = randomUUID();
  const run = projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'independent', registryId,
    identityId, projectId, runId, revision: 1, bootId, build: manifest.build,
    networkDevice: '4', networkInode: '4026531992', cgroupDevice: '29', cgroupInode: '8100',
    cgroupName: 'sakura-identity-' + runId, namespace: 'sk-' + projectId });
  const network = projectIdentityNetworkSchema.parse({ version: 1, registryId, identityId, projectId,
    revision: 1, bootId, namespace: 'sk-' + projectId, networkDevice: run.networkDevice, networkInode: run.networkInode, generation: randomUUID() });
  const commands: string[] = [], requests: Record<string, unknown>[] = [];
  const inputs: Buffer[] = [];
  let uploads = 0, cleanups = 0, mode = '', stopAttempts = 0, probeLost = false;
  let sshRunReply: unknown, readonlyRunReply: unknown, snapshotReply: unknown, snapshotExit = 0;
  const reply = (result: unknown) => ({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result }) });
  const machines = {
    get: () => ({ distro: 'alpine' }),
    writeGuestFile: async () => { uploads++; },
    execInput: async (_id: string, command: string, input: Buffer, _timeout?: number, signal?: AbortSignal) => {
      commands.push(command); inputs.push(Buffer.from(input));
      if (signal?.aborted) throw new AppError('owned cancellation', 409);
      const encoded = command.match(/\/controller\.py' '([A-Za-z0-9+/=]+)'$/)?.[1];
      if (encoded) {
        const request = JSON.parse(Buffer.from(encoded, 'base64').toString()); requests.push(request);
        assert.equal(request.action, 'ssh-snapshot');
        if (mode === 'snapshot-lost') throw new Error('owned snapshot acknowledgement lost');
        if (mode === 'snapshot-malformed') return { code: 0, stderr: '', stdout: 'not-json' };
        return { ...reply(snapshotReply === undefined ? { version: 1, projectId: request.projectId,
          runId: request.runId, snapshotSha256: request.snapshotSha256 } : snapshotReply), code: snapshotExit };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
    exec: async (_id: string, command: string, _timeout?: number, signal?: AbortSignal) => {
      commands.push(command);
      if (command.includes('SAKURA_IDENTITY_CLEANUP')) {
        cleanups++;
        if (mode === 'cleanup-lost') throw new Error('owned cleanup transport lost');
        return { code: cleanups < 3 && mode === 'create-ack-lost' ? 1 : 0, stderr: '', stdout: '' };
      }
      const encoded = command.match(/\/controller\.py' '([A-Za-z0-9+/=]+)'$/)?.[1];
      if (encoded) {
        const request = JSON.parse(Buffer.from(encoded, 'base64').toString()); requests.push(request);
        if (request.action === 'install') {
          if (probeLost) { probeLost = false; return { code: 127, stdout: '', stderr: 'missing controller' }; }
          return reply({ version: 1, build: manifest.build, registryId, bootId });
        }
        if (request.action === 'prepare') return reply(mode === 'retarget' ? { ...run, identityId: randomUUID() } : run);
        if (request.action === 'ssh-prepare') return reply(sshRunReply === undefined ? { ...run, mode: 'inherit-current',
          runId: request.runId, bootId: request.daemon.bootId, cgroupName: request.daemon.cgroupName } : sshRunReply);
        if (request.action === 'network') return reply(mode === 'network-absent' ? null :
          mode === 'network-foreign' ? { ...network, identityId: randomUUID() } : network);
        if (request.action === 'begin-network-release') {
          if (request.bootId !== bootId) return { code: 1, stderr: '', stdout: JSON.stringify({ ok: false, code: 'BOOT_CHANGED' }) };
          return reply(mode === 'network-absent' ? null : { version: 1, phase: 'pending', releaseId: request.releaseId,
            network: mode === 'network-foreign' ? { ...network, generation: randomUUID(), identityId: randomUUID() } : network });
        }
        if (request.action === 'release-network') {
          if (signal?.aborted) throw new AppError('owned release cancellation', 409);
          if (mode === 'network-conflict') return { code: 1, stderr: '', stdout: JSON.stringify({ ok: false, code: 'NETWORK_REPLACED' }) };
          if (mode === 'network-tool') return { code: 1, stderr: '', stdout: JSON.stringify({ ok: false, code: 'NETWORK_TOOL_RUNNING' }) };
          if (mode === 'network-lost') throw new Error('owned release acknowledgement lost');
          return reply({ version: 1, phase: 'released', releaseId: request.releaseId,
            network: mode === 'network-retarget' ? { ...request.network, generation: randomUUID() } : request.network });
        }
        if (request.action === 'run-readonly') {
          if (mode === 'readonly-missing') return { code: 127, stderr: 'missing controller', stdout: '' };
          if (mode === 'readonly-absent') return { code: 1, stderr: '', stdout: JSON.stringify({ ok: false, code: 'RECORD_ABSENT' }) };
          return reply(mode === 'readonly-old-build' ? { ...run, build: 'f'.repeat(64) } :
            readonlyRunReply === undefined ? run : readonlyRunReply);
        }
        if (request.action === 'terminal-probe' || request.action === 'terminal-create') {
          if (mode === 'terminal-lost') throw new Error('owned terminal reply lost');
          return reply({ version: 1, terminalId: run.runId, run: mode === 'terminal-retarget' ?
            { ...run, cgroupInode: '9911' } : run, name: request.name, serverPid: 456, serverTicks: '92', sessionId: '$0' });
        }
        if (request.action === 'terminal-retire') return reply({ version: 1,
          terminalId: mode === 'terminal-retarget' ? randomUUID() : run.runId, retired: true });
        if (request.action === 'ensure' || request.action === 'inspect') return reply(identity);
        if (request.action === 'stop') {
          stopAttempts++;
          if (mode === 'stop-transient' && stopAttempts < 3) throw new Error('owned stop transport lost');
          if (mode === 'stop-conflict') return { code: 1, stderr: '', stdout: JSON.stringify({ ok: false, code: 'CGROUP_REPLACED' }) };
          if (mode === 'stop-active') return reply(run);
          if (mode === 'stop-retarget') return reply({ ...run, phase: 'closed', networkInode: '4026532999' });
          return reply({ ...run, phase: 'closed' });
        }
        throw new Error('unexpected mock control operation');
      }
      if (command.includes('umask 077; mkdir') && mode === 'create-ack-lost') throw new Error('owned create acknowledgement lost');
      if (signal?.aborted || command.includes("'/bin/sh' '-c'")) throw new AppError('owned cancellation', 409);
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return { core: new ProjectIdentities(machines as unknown as Machines, { sourceDirectory: root }), identity, run, network,
    commands, requests, inputs, setMode: (value: string) => { mode = value; }, loseProbe: () => { probeLost = true; },
    setSshRunReply: (value: unknown) => { sshRunReply = value; },
    setReadonlyRunReply: (value: unknown) => { readonlyRunReply = value; },
    setSnapshotReply: (value: unknown, code = 0) => { snapshotReply = value; snapshotExit = code; },
    counts: () => ({ uploads, cleanups, stopAttempts }) };
}

test('inherited SESSION2 SDK transport chooses fixed stderr-only entry while ordinary payload remains flags0', async () => {
  const f = fixture('1234567890abcdef');
  const execution = { command: 'printf protected-project-code', environment: { TOKEN: 'protected-project-env' }, stdin: 'session' as const };
  const payload = await f.core.inheritedInput(f.identity, execution, { runId: f.run.runId });
  assert.equal(payload.input.readUInt32LE(12), 2); assert.equal(payload.sha256, createHash('sha256').update(payload.input).digest('hex'));
  const request = JSON.parse(Buffer.from(payload.command.match(/\/controller\.py' '([A-Za-z0-9+/=]+)'$/)![1], 'base64').toString());
  assert.equal(request.action, 'exec-current-session'); assert.equal(request.runId, f.run.runId);
  assert.ok(!payload.command.includes('protected-project-code') && !payload.command.includes('protected-project-env'));
  assert.equal(f.commands.length, 0); assert.equal(f.counts().uploads, 0);
  const ordinary = await f.core.inheritedInput(f.identity, { command: execution.command, environment: execution.environment }, { runId: randomUUID() });
  assert.equal(ordinary.input.readUInt32LE(12), 0);
  const plain = JSON.parse(Buffer.from(ordinary.command.match(/\/controller\.py' '([A-Za-z0-9+/=]+)'$/)![1], 'base64').toString());
  assert.equal(plain.action, 'exec-current');
  assert.throws(() => projectIdentityPayload({ ...execution, stdin: 'terminal' as never }));
});
const cleanupFailure = (error: unknown) => error instanceof AppError && error.status === 503 && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED';
const sshMetadata = (command: string) => {
  const encoded = command.match(/\/controller\.py' '([A-Za-z0-9+/=]+)'$/)?.[1];
  assert.ok(encoded, 'the controller receives only a fixed metadata argument');
  return JSON.parse(Buffer.from(encoded, 'base64').toString());
};

test('explicit asset directory is verified and substitution fails before guest installation', async () => {
  const source = await projectIdentitySources(root); assert.equal(source.manifest.build, manifest.build);
  const bad = await mkdtemp(join(parent, 'sakura-project-identity-unit-'));
  try {
    for (const name of projectIdentityAssetNames) await writeFile(join(bad, name), await readFile(join(root, name)));
    await writeFile(join(bad, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(bad, 'launcher.c'), 'substituted input');
    await assert.rejects(projectIdentitySources(bad), (error: unknown) => error instanceof AppError && error.code === 'PROJECT_IDENTITY_SOURCE_INVALID');
  } finally {
    const owned = await realpath(bad); assert.equal(dirname(owned), await realpath(parent));
    assert.match(basename(owned), /^sakura-project-identity-unit-/); await rm(owned, { recursive: true });
  }
});

test('terminal readonly probes and attach plans use exact identity metadata without installation or shell bodies', async () => {
  const f = await fixture(), name = 'sakura-terminal-default-main';
  const checked = await f.core.terminal('owned-vm', f.identity, f.run, name);
  assert.equal(checked.terminalId, f.run.runId); assert.equal(checked.serverPid, 456);
  assert.deepEqual(f.requests.map(request => request.action), ['terminal-probe']);
  assert.equal(f.counts().uploads, 0); assert.equal(f.counts().cleanups, 0);
  const command = await f.core.terminalCommand(f.identity, f.run, name, true);
  const request = JSON.parse(Buffer.from(command.match(/\/controller\.py' '([A-Za-z0-9+/=]+)'$/)![1], 'base64').toString());
  assert.deepEqual(request, { action: 'terminal-attach', projectId: 'default',
    expected: { registryId: f.identity.registryId, identityId: f.identity.identityId, revision: 1 },
    runId: f.run.runId, name, readOnly: true });
  assert.doesNotMatch(command, /tmux|sh -l|\/root\//);
  assert.equal(f.requests.length, 1, 'Generating an attach command does not mutate the guest.');
});

test('terminal receipts cannot replace an original cgroup or retired UUID', async () => {
  const f = await fixture(); f.setMode('terminal-retarget');
  await assert.rejects(f.core.terminal('owned-vm', f.identity, f.run, 'sakura-terminal-default-main'),
    { code: 'PROJECT_IDENTITY_RUN_STALE' });
  await assert.rejects(f.core.retireTerminal('owned-vm', f.identity, { ...f.run, phase: 'closed' }), cleanupFailure);
  const before = f.requests.length;
  await assert.rejects(f.core.terminalCommand(f.identity, { ...f.run, phase: 'closed' }, 'sakura-terminal-default-main', false),
    { code: 'PROJECT_IDENTITY_RUN_STALE' });
  assert.equal(f.requests.length, before);
});
test('command and environment stay in the bounded input buffer and legacy argv paths refuse', async () => {
  const f = fixture(), plan = f.core.input(f.identity, f.run,
    { command: "printf '%s' \"$TOKEN\"", environment: { TOKEN: "'$(touch /root/escape)'" } });
  assert.ok(plan.command.startsWith('env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C '));
  assert.ok(plan.command.includes("'--payload'")); assert.ok(!plan.command.includes('TOKEN') && !plan.command.includes('/root/escape'));
  assert.equal(plan.sha256, createHash('sha256').update(plan.input).digest('hex'));
  assert.equal(plan.input.subarray(0, 8).toString(), 'SKIDP001');
  assert.ok(plan.input.includes(Buffer.from("'$(touch /root/escape)'")));
  for (const legacy of [() => f.core.command(f.identity, f.run, { command: 'secret' }),
    () => f.core.selfCommand(f.run, { command: 'secret' })])
    assert.throws(legacy, (error: unknown) => error instanceof AppError && error.code === 'PROJECT_IDENTITY_PAYLOAD_REQUIRED');
  await assert.rejects(f.core.inheritedCommand(f.identity, { command: 'secret' }), /stdin payload/);
  assert.throws(() => f.core.input(f.identity, f.run, { command: 'true', environment: { HOME: '/root' } }));
  assert.throws(() => f.core.input(f.identity, { ...f.run, cgroupName: '/sys/fs/cgroup/neighbor' }, { command: 'true' }));
  assert.throws(() => f.core.input({ ...f.identity, directory: '/srv/link/../neighbor' }, f.run, { command: 'true' }));
});
test('payload encodes exact UTF8 byte limits and rejects NUL unpaired surrogates and oversized environments', () => {
  for (const execution of [{ command: 'x\0y' }, { command: '\ud800' }, { command: 'x', environment: { TOKEN: '\udfff' } },
    { command: 'x', environment: { TOKEN: 'x'.repeat(8192) } }, { command: 'x'.repeat(65537) },
    { command: 'é'.repeat(32769) }, { command: 'x', environment: Object.fromEntries(Array.from({ length: 129 }, (_, i) => ['K' + i, ''])) }])
    assert.throws(() => projectIdentityPayload(execution));
  const boundary = projectIdentityPayload({ command: 'é'.repeat(32768) });
  assert.equal(boundary.input.readUInt32LE(24), 65536); assert.equal(boundary.input.length, 65568);
  const empty = projectIdentityPayload({ command: 'true', environment: { EMPTY: '' } });
  assert.equal(empty.input.readUInt32LE(20), 1);
});
test('exec uses the input channel and leaves only identity metadata in control and cleanup commands', async () => {
  const f = fixture(); await f.core.exec('owned-vm', f.identity, f.run,
    { command: 'private-command-only', environment: { TOKEN: 'private-env-only' } });
  assert.equal(f.inputs.length, 1); assert.ok(f.inputs[0].includes(Buffer.from('private-env-only')));
  assert.ok(f.commands.every(command => !command.includes('private-command-only') && !command.includes('private-env-only')));
  assert.equal(f.counts().stopAttempts, 1);
  await assert.rejects(f.core.exec('owned-vm', f.identity, f.run, { command: 'invalid\0payload' }));
  assert.equal(f.inputs.length, 1, 'invalid local payload must not open the input execution channel');
  assert.equal(f.counts().stopAttempts, 2, 'local payload refusal must also close the prepared ticket');
});

test('readonly run verifies the current receipt without installation or writes and never accepts missing or old builds', async () => {
  const f = fixture();
  assert.deepEqual(await f.core.runReadonly('owned-vm', f.identity, f.run.runId), f.run);
  assert.equal(f.counts().uploads, 0); assert.equal(f.counts().cleanups, 0);
  assert.deepEqual(f.requests.map(request => request.action), ['run-readonly']);
  assert.equal(f.commands.length, 1);
  for (const [mode, code] of [['readonly-missing', 'PROJECT_IDENTITY_CONTROL_FAILED'],
    ['readonly-absent', 'PROJECT_IDENTITY_RECORD_ABSENT'], ['readonly-old-build', 'PROJECT_IDENTITY_RUN_BUILD_STALE']]) {
    f.setMode(mode);
    await assert.rejects(f.core.runReadonly('owned-vm', f.identity, f.run.runId),
      (error: unknown) => error instanceof AppError && error.code === code);
  }
  assert.equal(f.counts().uploads, 0); assert.ok(f.requests.every(request => request.action === 'run-readonly'));
});
test('foreign prepare reply cannot retarget an expected persistent account', async () => {
  const f = fixture(); f.setMode('retarget');
  await assert.rejects(f.core.prepare('owned-vm', f.identity), (error: unknown) => error instanceof AppError && error.code === 'PROJECT_IDENTITY_RUN_STALE');
  const input = f.requests.find(request => request.action === 'prepare')!;
  assert.deepEqual(input.expected, { registryId: f.identity.registryId, identityId: f.identity.identityId, revision: f.identity.revision });
  assert.ok(!('directory' in input) && !('uid' in input) && !('cgroup' in input));
});
test('stop retries independent connections and validates the whole closed receipt', async () => {
  const f = fixture(); f.setMode('stop-transient');
  const controller = new AbortController(); controller.abort();
  const closed = await f.core.stop('owned-vm', f.identity, f.run, controller.signal);
  assert.equal(closed.phase, 'closed'); assert.equal(f.counts().stopAttempts, 3);
  for (const mode of ['stop-active', 'stop-retarget']) {
    const broken = fixture(); broken.setMode(mode);
    await assert.rejects(broken.core.stop('owned-vm', broken.identity, broken.run), cleanupFailure);
    assert.equal(broken.counts().stopAttempts, 3);
  }
});
test('cancelled execution preserves unconfirmed cgroup cleanup as a 503 failure', async () => {
  const f = fixture(); f.setMode('stop-conflict');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.core.exec('owned-vm', f.identity, f.run, { command: 'project-only-secret-command',
    environment: { SECRET: 'project-only-secret-value' } }, controller.signal), cleanupFailure);
  assert.equal(f.counts().stopAttempts, 3);
  for (const request of f.requests.filter(request => request.action === 'stop')) {
    assert.ok(!JSON.stringify(request).includes('project-only-secret'));
    assert.ok(!('argv' in request) && !('environment' in request));
  }
});
test('invalid caller ticket fails before a guest cleanup operation', async () => {
  const f = fixture(), foreign: ProjectIdentityRun = { ...f.run, identityId: randomUUID() };
  await assert.rejects(f.core.stop('owned-vm', f.identity, foreign), (error: unknown) => error instanceof AppError && error.status === 409);
  assert.deepEqual(f.commands, []);
});
test('lost stage creation ACK is cleaned even before any source upload', async () => {
  const f = fixture(); f.setMode('create-ack-lost');
  await assert.rejects(f.core.install('owned-vm'), /owned create acknowledgement lost/);
  assert.equal(f.counts().cleanups, 3); assert.equal(f.counts().uploads, 0);
  const cleanup = f.commands.filter(command => command.includes('SAKURA_IDENTITY_CLEANUP'));
  assert.equal(cleanup.length, 3); assert.ok(cleanup.every(command => command.includes('os.fsync')));
});
test('install cleanup transport failure is bounded and preserves 503 classification', async () => {
  const f = fixture(); f.setMode('cleanup-lost');
  await assert.rejects(f.core.install('owned-vm'), cleanupFailure);
  assert.equal(f.counts().cleanups, 3);
});
test('same host VM ID with missing guest build invalidates the installation cache', async () => {
  const f = fixture(); await f.core.install('owned-vm'); const count = f.counts().uploads;
  f.loseProbe(); await f.core.install('owned-vm');
  assert.equal(f.counts().uploads, count + 4);
});
test('inherit metadata contains only IDs and digest while the complete body stays on stdin', async () => {
  const f = fixture(); const plan = await f.core.inheritedInput(f.identity,
    { command: 'private-command', environment: { SECRET: 'private-transient' } });
  const encoded = plan.command.match(/\/controller\.py' '([A-Za-z0-9+/=]+)'$/)![1];
  const request = JSON.parse(Buffer.from(encoded, 'base64').toString());
  assert.equal(request.action, 'exec-current'); assert.equal(request.runId, plan.runId); assert.equal(request.payloadSha256, plan.sha256);
  assert.ok(!JSON.stringify(request).includes('private-') && !('argv' in request) && !('environment' in request));
  assert.ok(plan.input.includes(Buffer.from('private-transient')));
  assert.ok(!('cgroupName' in request) && !('cgroupPath' in request) && !('uid' in request));
});
test('network freeze sends the pre-persisted boot and nonce and preserves every generation field for release', async () => {
  const f = fixture(), releaseId = randomUUID();
  assert.deepEqual(await f.core.network('owned-vm', f.identity), f.network);
  const lease = await f.core.beginNetworkRelease('owned-vm', f.identity, { releaseId, bootId: f.network.bootId });
  assert.deepEqual(lease, { version: 1, phase: 'pending', releaseId, network: f.network });
  const first = await f.core.releaseNetwork('owned-vm', f.identity, lease!);
  assert.deepEqual(first, { version: 1, phase: 'released', releaseId, network: f.network });
  assert.deepEqual(await f.core.releaseNetwork('owned-vm', f.identity, lease!), first);
  const begins = f.requests.filter(request => request.action === 'begin-network-release');
  assert.equal(begins.length, 1); assert.equal(begins[0].bootId, f.network.bootId); assert.equal(begins[0].releaseId, releaseId);
  for (const request of f.requests.filter(request => request.action === 'release-network')) {
    assert.deepEqual(request.network, f.network); assert.equal(request.releaseId, releaseId);
    assert.ok(!('namespacePath' in request) && !('uid' in request) && !('cgroupPath' in request));
  }
});
test('network capture refuses foreign bindings and begin never follows a changed boot', async () => {
  const f = fixture(); f.setMode('network-foreign');
  await assert.rejects(f.core.network('owned-vm', f.identity), /当前身份/);
  await assert.rejects(f.core.beginNetworkRelease('owned-vm', f.identity, { releaseId: randomUUID(), bootId: f.network.bootId }), /原请求/);
  f.setMode('');
  await assert.rejects(f.core.beginNetworkRelease('owned-vm', f.identity, { releaseId: randomUUID(), bootId: randomUUID() }),
    (error: unknown) => error instanceof AppError && error.code === 'PROJECT_IDENTITY_BOOT_CHANGED');
  f.setMode('network-absent');
  assert.equal(await f.core.network('owned-vm', f.identity), null);
  assert.equal(await f.core.beginNetworkRelease('owned-vm', f.identity, { releaseId: randomUUID(), bootId: f.network.bootId }), null);
});
test('release rejects local foreign leases before transport and retains uncertain fixed leases as 503 cleanup failures', async () => {
  const f = fixture(), lease = { version: 1 as const, phase: 'pending' as const, releaseId: randomUUID(), network: f.network };
  const before = f.commands.length;
  await assert.rejects(f.core.releaseNetwork('owned-vm', f.identity, { ...lease, network: { ...lease.network, identityId: randomUUID() } }),
    (error: unknown) => error instanceof AppError && error.status === 409);
  assert.equal(f.commands.length, before);
  for (const mode of ['network-conflict', 'network-tool', 'network-lost', 'network-retarget']) {
    f.setMode(mode);
    await assert.rejects(f.core.releaseNetwork('owned-vm', f.identity, lease),
      (error: unknown) => error instanceof AppError && error.status === 503 && error.code === 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
  }
  f.setMode(''); const cancellation = new AbortController(); cancellation.abort();
  await assert.rejects(f.core.releaseNetwork('owned-vm', f.identity, lease, cancellation.signal),
    (error: unknown) => error instanceof AppError && error.status === 503 && error.code === 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
  assert.ok(f.requests.filter(request => request.action === 'release-network').every(request => request.releaseId === lease.releaseId));
});

test('SSH snapshot generation and publication keep exact UTF8 environment bytes on stdin and only identity plus digest in argv', async () => {
  const f = fixture('0123456789abcdef'), runId = randomUUID();
  const environment = { TOKEN: 'private-ssh-token-雪', BASH_ENV: 'private-ssh-init;$(id)', LD_PRELOAD: 'private-ssh-library' };
  const expected = { registryId: f.identity.registryId, identityId: f.identity.identityId, revision: f.identity.revision };
  const snapshot = await f.core.sshSnapshotInput(f.identity, runId, environment);
  assert.deepEqual(JSON.parse(snapshot.input.toString('utf8')),
    { version: 1, projectId: f.identity.projectId, runId, identity: expected, environment });
  assert.equal(snapshot.sha256, createHash('sha256').update(snapshot.input).digest('hex'));
  assert.equal(snapshot.build, manifest.build); assert.equal(snapshot.runId, runId);
  const metadata = { action: 'ssh-snapshot', projectId: f.identity.projectId, expected, runId, snapshotSha256: snapshot.sha256 };
  assert.deepEqual(sshMetadata(snapshot.command), metadata);
  assert.equal(f.commands.length, 0, 'creating the frozen snapshot does not contact or install guest helpers');
  await f.core.publishSshSnapshot('owned-vm', f.identity, snapshot);
  assert.deepEqual(f.inputs, [snapshot.input]); assert.deepEqual(f.requests, [metadata]);
  assert.equal(f.commands.length, 1); assert.equal(f.counts().uploads, 0); assert.equal(f.counts().cleanups, 0);
  assert.match(f.commands[0], /^env -i .* \/usr\/bin\/python3 -I -S /);
  assert.ok(!f.commands[0].includes('private-ssh-') && !JSON.stringify(sshMetadata(f.commands[0])).includes('private-ssh-'));
});

test('SSH snapshot refusal prevents changed bytes, builds, identity environment and invalid UTF8 from reaching guest transport', async () => {
  const f = fixture(), runId = randomUUID();
  const invalidEnvironments: Record<string, string>[] = [{ HOME: '/foreign' }, { USER: 'root' }, { LOGNAME: 'root' },
    { TOKEN: 'bad\0value' }, { TOKEN: '\ud800' }, { 'INVALID-NAME': 'value' },
    { TOKEN: 'x'.repeat(8193) }, Object.fromEntries(Array.from({ length: 129 }, (_, index) => ['KEY' + index, 'value']))];
  for (const environment of invalidEnvironments) {
    await assert.rejects(f.core.sshSnapshotInput(f.identity, runId, environment));
  }
  await assert.rejects(f.core.sshSnapshotInput({ ...f.identity, phase: 'intent' }, runId),
    { code: 'PROJECT_IDENTITY_INCOMPLETE' });
  const snapshot = await f.core.sshSnapshotInput(f.identity, runId, { TOKEN: 'frozen-value' });
  await assert.rejects(f.core.publishSshSnapshot('owned-vm', f.identity,
    { ...snapshot, input: Buffer.from(snapshot.input.toString().replace('frozen-value', 'foreign-value')) }),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  await assert.rejects(f.core.publishSshSnapshot('owned-vm', f.identity, { ...snapshot, build: 'f'.repeat(64) }),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.deepEqual(f.commands, []); assert.deepEqual(f.inputs, []); assert.equal(f.counts().uploads, 0);
});

test('SSH snapshot publication requires the exact successful project, run and digest receipt', async () => {
  const f = fixture(), snapshot = await f.core.sshSnapshotInput(f.identity, randomUUID(), { TOKEN: 'private-ssh-token' });
  const receipt = { version: 1, projectId: f.identity.projectId, runId: snapshot.runId, snapshotSha256: snapshot.sha256 };
  for (const value of [{ ...receipt, projectId: '0123456789abcdef' }, { ...receipt, runId: randomUUID() },
    { ...receipt, snapshotSha256: 'f'.repeat(64) }, { ...receipt, version: 2 }, { ...receipt, extra: true }, null]) {
    f.setSnapshotReply(value);
    await assert.rejects(f.core.publishSshSnapshot('owned-vm', f.identity, snapshot),
      { code: 'PROJECT_IDENTITY_SSH_SNAPSHOT_FAILED' });
  }
  f.setSnapshotReply(receipt, 1);
  await assert.rejects(f.core.publishSshSnapshot('owned-vm', f.identity, snapshot),
    { code: 'PROJECT_IDENTITY_SSH_SNAPSHOT_FAILED' });
  f.setSnapshotReply(receipt); f.setMode('snapshot-malformed');
  await assert.rejects(f.core.publishSshSnapshot('owned-vm', f.identity, snapshot),
    { code: 'PROJECT_IDENTITY_SSH_SNAPSHOT_FAILED' });
  f.setMode('snapshot-lost');
  await assert.rejects(f.core.publishSshSnapshot('owned-vm', f.identity, snapshot), /owned snapshot acknowledgement lost/);
  assert.ok(f.inputs.every(input => input.equals(snapshot.input)));
  assert.ok(f.requests.every(request => request.action === 'ssh-snapshot'));
  assert.equal(f.counts().uploads, 0);
});

test('SSH ForceCommand is one fixed isolated Python entry that preserves sshd client environment without placing code in argv', async () => {
  const f = fixture(), snapshot = await f.core.sshSnapshotInput(f.identity, randomUUID(), { TOKEN: 'private-ssh-client-token' });
  const command = await f.core.sshSessionCommand(f.identity, snapshot);
  assert.match(command, new RegExp("^/usr/bin/python3 -I -S '/usr/local/lib/sakura-project-identity/" + manifest.build + "/controller\\.py' "));
  assert.ok(!command.includes('env -i') && !command.includes('/bin/sh') && !command.includes('SSH_ORIGINAL_COMMAND'));
  assert.deepEqual(sshMetadata(command), { action: 'ssh-session', projectId: f.identity.projectId,
    expected: { registryId: f.identity.registryId, identityId: f.identity.identityId, revision: f.identity.revision },
    runId: snapshot.runId, snapshotSha256: snapshot.sha256 });
  assert.ok(!command.includes('private-ssh-client-token') && !JSON.stringify(sshMetadata(command)).includes('private-ssh-client-token'));
  await assert.rejects(f.core.sshSessionCommand(f.identity, { ...snapshot, build: 'f'.repeat(64) }),
    { code: 'PROJECT_IDENTITY_RUN_BUILD_STALE' });
  assert.deepEqual(f.commands, []); assert.equal(f.counts().uploads, 0);
});

test('SSH inherited cgroups accept only the exact project OpenRC or systemd service while UUID domains and independent mode keep their rules', () => {
  for (const projectId of ['default', '0123456789abcdef']) {
    const f = fixture(projectId), names = ['openrc.sakura-ssh-' + projectId, 'system.slice/sakura-ssh-' + projectId + '.service'];
    for (const cgroupName of names) {
      assert.equal(projectIdentityRunSchema.safeParse({ ...f.run, mode: 'inherit-current', cgroupName }).success, true);
      assert.equal(projectIdentitySshDaemonSchema.safeParse({ pid: 321, startTicks: '91', bootId: f.run.bootId, cgroupName }).success, true);
      assert.equal(projectIdentityRunSchema.safeParse({ ...f.run, cgroupName }).success, false);
    }
    const foreign = projectId === 'default' ? '0123456789abcdef' : 'default';
    for (const cgroupName of ['openrc.sakura-ssh-' + foreign, 'system.slice/sakura-ssh-' + foreign + '.service',
      names[0] + '/child', names[1] + '/child', 'system.slice/../' + names[0], '/' + names[1],
      'system.slice//sakura-ssh-' + projectId + '.service', 'user.slice/sakura-ssh-' + projectId + '.service',
      'sakura-ssh-' + projectId, names[1] + '.suffix'])
      assert.equal(projectIdentityRunSchema.safeParse({ ...f.run, mode: 'inherit-current', cgroupName }).success, false, cgroupName);
    for (const kind of ['task', 'main', 'service'])
      assert.equal(projectIdentityRunSchema.safeParse({ ...f.run, mode: 'inherit-current', cgroupName: 'sakura-' + kind + '-' + randomUUID() }).success, true);
    assert.equal(projectIdentityRunSchema.safeParse(f.run).success, true);
  }
});

test('SSH native preparation pins the exact daemon and binding metadata and requires an active inherited receipt', async () => {
  for (const cgroupName of ['openrc.sakura-ssh-default', 'system.slice/sakura-ssh-default.service']) {
    const f = fixture(), runId = randomUUID(), daemon = { pid: 321, startTicks: '91', bootId: f.run.bootId, cgroupName };
    const snapshot = await f.core.sshSnapshotInput(f.identity, runId, { TOKEN: 'private-ssh-token' });
    const issued = await f.core.prepareSsh('owned-vm', f.identity, { runId, daemon, snapshotSha256: snapshot.sha256 });
    assert.deepEqual(issued, { ...f.run, mode: 'inherit-current', runId, bootId: daemon.bootId, cgroupName });
    const request = f.requests.find(request => request.action === 'ssh-prepare');
    assert.deepEqual(request, { action: 'ssh-prepare', projectId: f.identity.projectId,
      expected: { registryId: f.identity.registryId, identityId: f.identity.identityId, revision: f.identity.revision },
      runId, snapshotSha256: snapshot.sha256, daemon });
    assert.ok(!JSON.stringify(request).includes('private-ssh-token'));
    const mutations: Partial<ProjectIdentityRun>[] = [{ identityId: randomUUID() }, { registryId: randomUUID() },
      { revision: 2 }, { projectId: '0123456789abcdef', namespace: 'sk-0123456789abcdef', cgroupName: 'openrc.sakura-ssh-0123456789abcdef' },
      { phase: 'closed' }, { mode: 'independent', cgroupName: 'sakura-identity-' + runId },
      { runId: randomUUID() }, { bootId: randomUUID() }, { namespace: '' },
      { cgroupName: cgroupName.startsWith('openrc.') ? 'system.slice/sakura-ssh-default.service' : 'openrc.sakura-ssh-default' }];
    for (const mutation of mutations) {
      f.setSshRunReply({ ...issued, ...mutation });
      await assert.rejects(f.core.prepareSsh('owned-vm', f.identity, { runId, daemon, snapshotSha256: snapshot.sha256 }),
        { code: 'PROJECT_IDENTITY_RUN_STALE' });
    }
    f.setSshRunReply({ ...issued, cgroupInode: '0' });
    await assert.rejects(f.core.prepareSsh('owned-vm', f.identity, { runId, daemon, snapshotSha256: snapshot.sha256 }),
      { code: 'PROJECT_IDENTITY_CONTROL_FAILED' });
  }
});

test('SSH daemon scope validation refuses another project or traversal before installation and readonly probes never install', async () => {
  const f = fixture(), runId = randomUUID(), daemon = { pid: 321, startTicks: '91', bootId: f.run.bootId,
    cgroupName: 'openrc.sakura-ssh-0123456789abcdef' };
  await assert.rejects(f.core.prepareSsh('owned-vm', f.identity, { runId, daemon, snapshotSha256: 'b'.repeat(64) }),
    { code: 'PROJECT_IDENTITY_RUN_STALE' });
  for (const cgroupName of ['system.slice/../openrc.sakura-ssh-default', 'openrc.sakura-ssh-default/child'])
    await assert.rejects(f.core.prepareSsh('owned-vm', f.identity,
      { runId, daemon: { ...daemon, cgroupName }, snapshotSha256: 'b'.repeat(64) }));
  assert.equal(f.commands.length, 0); assert.equal(f.counts().uploads, 0);
  const run = { ...f.run, mode: 'inherit-current' as const, runId, cgroupName: 'system.slice/sakura-ssh-default.service' };
  f.setReadonlyRunReply(run);
  assert.deepEqual(await f.core.runReadonly('owned-vm', f.identity, runId), run);
  assert.deepEqual(f.requests.map(request => request.action), ['run-readonly']);
  assert.equal(f.counts().uploads, 0); assert.equal(f.counts().cleanups, 0);
});
