import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines } from '../server/machines.ts';
import { AppError } from '../server/model.ts';
import { ProjectIdentities, projectIdentityAssetNames, projectIdentitySchema, projectIdentityRunSchema,
  projectIdentitySources, type ProjectIdentityRun } from '../server/project-identity.ts';

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
  const commands: string[] = [], requests: Record<string, unknown>[] = [];
  let uploads = 0, cleanups = 0, mode = '', stopAttempts = 0, probeLost = false;
  const reply = (result: unknown) => ({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result }) });
  const machines = {
    get: () => ({ distro: 'alpine' }),
    writeGuestFile: async () => { uploads++; },
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
  return { core: new ProjectIdentities(machines as unknown as Machines, { sourceDirectory: root }), identity, run,
    commands, requests, setMode: (value: string) => { mode = value; }, loseProbe: () => { probeLost = true; },
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
test('command environment is passed as inert arguments and core IDs reject path selection', () => {
  const f = fixture(), command = f.core.command(f.identity, f.run,
    { command: "printf '%s' \"$TOKEN\"", environment: { TOKEN: "'$(touch /root/escape)'" } });
  assert.ok(command.startsWith('env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C '));
  assert.ok(command.includes("'--env'")); assert.ok(command.includes("'/bin/sh' '-c'"));
  assert.throws(() => f.core.command(f.identity, f.run, { command: 'true', environment: { HOME: '/root' } }));
  assert.throws(() => f.core.command(f.identity, { ...f.run, cgroupName: '/sys/fs/cgroup/neighbor' }, { command: 'true' }));
  assert.throws(() => f.core.command({ ...f.identity, directory: '/srv/link/../neighbor' }, f.run, { command: 'true' }));
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
test('inherit interface transmits no caller cgroup path and keeps env only in transient request', async () => {
  const f = fixture(); const command = await f.core.inheritedCommand(f.identity,
    { command: 'private-command', environment: { SECRET: 'private-transient' } });
  const encoded = command.match(/\/controller\.py' '([A-Za-z0-9+/=]+)'$/)![1];
  const request = JSON.parse(Buffer.from(encoded, 'base64').toString());
  assert.equal(request.action, 'exec-current'); assert.deepEqual(request.argv, ['/bin/sh', '-c', 'private-command']);
  assert.deepEqual(request.environment, { SECRET: 'private-transient' });
  assert.ok(!('cgroupName' in request) && !('cgroupPath' in request) && !('uid' in request));
});
