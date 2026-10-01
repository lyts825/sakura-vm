import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines } from '../server/machines.ts';
import { AppError } from '../server/model.ts';
import { ProjectIdentities, projectIdentityAssetNames, projectIdentitySchema, projectIdentityRunSchema,
  projectIdentitySources, projectIdentityPayload, projectIdentityNetworkSchema, type ProjectIdentityRun } from '../server/project-identity.ts';

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
function fixture() {
  const identityId = randomUUID(), registryId = randomUUID();
  const identity = projectIdentitySchema.parse({ version: 1, phase: 'active', registryId, projectId: 'default',
    identityId, revision: 1, uid: 20000, gid: 20000, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
    home: '/var/lib/sakura-project-homes/' + identityId, homeDevice: '2049', homeInode: '800',
    directory: '/srv/project', directoryDevice: '2049', directoryInode: '900', networkIsolation: 'private' });
  const runId = randomUUID(), bootId = randomUUID();
  const run = projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'independent', registryId,
    identityId, projectId: 'default', runId, revision: 1, bootId, build: manifest.build,
    networkDevice: '4', networkInode: '4026531992', cgroupDevice: '29', cgroupInode: '8100',
    cgroupName: 'sakura-identity-' + runId, namespace: 'sk-default' });
  const network = projectIdentityNetworkSchema.parse({ version: 1, registryId, identityId, projectId: 'default',
    revision: 1, bootId, namespace: 'sk-default', networkDevice: run.networkDevice, networkInode: run.networkInode, generation: randomUUID() });
  const commands: string[] = [], requests: Record<string, unknown>[] = [];
  const inputs: Buffer[] = [];
  let uploads = 0, cleanups = 0, mode = '', stopAttempts = 0, probeLost = false;
  const reply = (result: unknown) => ({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result }) });
  const machines = {
    get: () => ({ distro: 'alpine' }),
    writeGuestFile: async () => { uploads++; },
    execInput: async (_id: string, command: string, input: Buffer, _timeout?: number, signal?: AbortSignal) => {
      commands.push(command); inputs.push(Buffer.from(input));
      if (signal?.aborted) throw new AppError('owned cancellation', 409);
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
          return reply(mode === 'readonly-old-build' ? { ...run, build: 'f'.repeat(64) } : run);
        }
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
    counts: () => ({ uploads, cleanups, stopAttempts }) };
}
const cleanupFailure = (error: unknown) => error instanceof AppError && error.status === 503 && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED';

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
