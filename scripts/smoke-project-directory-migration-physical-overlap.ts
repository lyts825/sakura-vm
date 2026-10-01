import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.ok(process.execArgv.includes('--no-addons'), 'Use node --no-addons --import tsx.');
const expect = process.argv[2] || 'refused';
assert.ok(['accepted', 'refused'].includes(expect));
const workspace = await realpath(resolve('.'));
assert.match(workspace, /^[dD]:\\/);
const parent = await realpath(join(workspace, '.data', 'project-directory-migration-test-temp'));
const root = await realpath(join(parent, 'sakura-directory-migration-YkUE8m'));
assert.equal(dirname(root), parent);
assert.equal(basename(root), 'sakura-directory-migration-YkUE8m');
const id = '6ffef601-cd66-4b63-a2e8-d73e22ceecfb';
const priorBytes = await readFile(join(root, 'project-directory-migration-evidence.json'));
const prior = JSON.parse(priorBytes.toString());
assert.equal(prior.fixture, root);
assert.equal(prior.vmId, id);
assert.equal(prior.distro, 'debian');
assert.equal(prior.passed, true);
assert.equal(prior.sourcesUnchanged, true);
assert.equal(prior.synced, true);
assert.equal(prior.vmStopped, true);
assert.equal(prior.liveCount, 0);
assert.equal(prior.cases.length, 23);
assert.equal(prior.error, undefined);
assert.equal(prior.identityBuild.build, '94bc2a7fb050ac8a72cce5fcf56997c6c44ba4a8473cd543cff6d36ff407b905');
const records = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
assert.equal(records.length, 1);
assert.equal(records[0].id, id);
assert.equal(records[0].name, 'directory-migration-smoke');
assert.equal(records[0].bootstrapped, true);
assert.equal(records[0].distro, 'debian');
for (const key of ['storagePoolId', 'sandbox', 'haPromotion', 'haRetirement', 'lastError'])
  assert.equal(records[0][key], undefined);
const machineDirectory = await realpath(join(root, 'machines', id));
assert.equal(dirname(machineDirectory), await realpath(join(root, 'machines')));
assert.equal(dirname(await realpath(join(machineDirectory, 'disk.qcow2'))), machineDirectory);
const savedBytes = await readFile(join(machineDirectory, 'project.json'));
const saved = JSON.parse(savedBytes.toString());
assert.equal(saved.directory, '/srv/projects/rebound');
assert.equal(saved.networkIsolation, 'private');
const indexBytes = await readFile(join(machineDirectory, 'projects.json'));
const betaFile = join(machineDirectory, 'project-' + 'b'.repeat(16) + '.json');
const betaBytes = await readFile(betaFile);
assert.equal(JSON.parse(betaBytes.toString()).directory, '/srv/projects/beta');
process.env.TEMP = process.env.TMP = parent;
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = join(workspace, '.data', 'images');
process.env.SAKURA_IMAGE_PATH = join(workspace, '.data', 'images', 'debian-12.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces, projectSchema } = await import('../server/workspaces.ts');
const { ProjectIdentities } = await import('../server/project-identity.ts');
const { ProjectRunScopes } = await import('../server/project-run-scope.ts');
const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
const { quote } = await import('../server/files.ts');
const machines = new Machines(await createRuntime()),
  spaces = new Workspaces(machines);
const core = new ProjectIdentities(machines, { sourceDirectory: join(root, 'identity-sources') });
const migration = new ProjectDirectoryMigrations(machines, spaces, {
  sourceDirectory: join(root, 'identity-sources'),
  scopes: new ProjectRunScopes(machines, { identities: core }),
});
const proof: any = {
  version: 1,
  fixture: root,
  vmId: id,
  expect,
  previewOnly: true,
  applyCalled: false,
  prior: {
    sha256: createHash('sha256').update(priorBytes).digest('hex'),
    caseCount: prior.cases.length,
    build: prior.identityBuild.build,
  },
  sourceSha256: {},
  cases: [],
};
for (const file of [
  'server/project-directory-migration.ts',
  'server/project-run-scope.ts',
  'scripts/smoke-project-directory-migration-physical-overlap.ts',
])
  proof.sourceSha256[file] = createHash('sha256')
    .update(await readFile(join(workspace, file)))
    .digest('hex');
let mounted = false,
  created = false;
const expectedCases = expect === 'accepted' ? 1 : 5;
const py = (source: string) =>
  'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' +
  quote(source);
const run = async (command: string) => {
  const result = await machines.exec(id, command, 15000);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result.stdout.trim();
};
const inspect = async (path: string) =>
  JSON.parse(
    await run(
      py(
        `import hashlib,json,os,stat\np=${JSON.stringify(path)};s=os.lstat(p);fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW);fs=os.fstatvfs(fd).f_fsid;os.close(fd);print(json.dumps({'device':str(s.st_dev),'inode':str(s.st_ino),'filesystemId':str(fs & ((1<<64)-1)),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'sha256':hashlib.sha256(open(p,'rb').read()).hexdigest() if stat.S_ISREG(s.st_mode) else None}))`,
      ),
    ),
  );
try {
  await machines.init();
  assert.equal(machines.records.size, 1);
  assert.equal(machines.state(id), 'stopped');
  assert.equal(machines.live.size, 0);
  await machines.start(id);
  const deadline = Date.now() + 270000;
  while (machines.state(id) !== 'running') {
    assert.equal(machines.state(id), 'starting');
    assert.ok(Date.now() < deadline);
    await delay(300);
  }
  const before = {
    beta: await inspect('/srv/projects/beta'),
    marker: await inspect('/srv/projects/beta/marker.txt'),
    identity: await core.inspect(id, 'default'),
  };
  await run(
    py(
      "import os,stat\nfor p in ('/','/opt'):\n i=os.lstat(p);assert stat.S_ISDIR(i.st_mode) and i.st_uid==0 and not i.st_mode&0o022\nassert not os.path.lexists('/opt/projects')",
    ),
  );
  await run('mkdir /opt/projects; chmod 0755 /opt/projects');
  created = true;
  await run('mount --bind /srv/projects /opt/projects');
  mounted = true;
  const alias = await inspect('/opt/projects/beta');
  assert.deepEqual(alias, before.beta);
  await writeFile(
    join(machineDirectory, 'project.json'),
    JSON.stringify(projectSchema.parse({ directory: '/opt/projects/beta', networkIsolation: 'private' })),
  );
  let plan: any = null,
    refusal: string | undefined;
  try {
    plan = (await migration.preview(id)).plan;
  } catch (error) {
    refusal = (error as { code?: string }).code;
    if (!refusal) throw error;
  }
  if (expect === 'accepted') {
    assert.ok(plan);
    assert.equal(refusal, undefined);
  } else {
    assert.equal(refusal, 'PROJECT_DIRECTORY_PHYSICAL_OVERLAP');
    assert.equal(plan, null);
  }
  assert.deepEqual(await inspect('/srv/projects/beta'), before.beta);
  assert.deepEqual(await inspect('/srv/projects/beta/marker.txt'), before.marker);
  assert.deepEqual(await core.inspect(id, 'default'), before.identity);
  proof.cases.push({
    name: 'allowed-base-bind-alias-of-saved-beta',
    accepted: !!plan,
    refusal,
    directory: '/opt/projects/beta',
    otherDirectory: '/srv/projects/beta',
    physical: alias,
    planId: plan?.proposal.planId,
    betaUnchanged: true,
    identityUnchanged: true,
    passed: true,
  });
  console.log('PASS allowed-base-bind-alias: ' + (plan ? 'accepted before repair (no apply)' : refusal));
  if (expect === 'refused') {
    const assertRefused = async (directory: string, name: string) => {
      await writeFile(
        join(machineDirectory, 'project.json'),
        JSON.stringify(projectSchema.parse({ directory, networkIsolation: 'private' })),
      );
      await assert.rejects(migration.preview(id), { code: 'PROJECT_DIRECTORY_PHYSICAL_OVERLAP' });
      assert.deepEqual(await inspect('/srv/projects/beta'), before.beta);
      assert.deepEqual(await inspect('/srv/projects/beta/marker.txt'), before.marker);
      assert.deepEqual(await core.inspect(id, 'default'), before.identity);
      proof.cases.push({
        name,
        directory,
        code: 'PROJECT_DIRECTORY_PHYSICAL_OVERLAP',
        betaUnchanged: true,
        identityUnchanged: true,
        passed: true,
      });
      console.log('PASS ' + name);
    };
    await writeFile(betaFile, JSON.stringify(projectSchema.parse({ directory: '/srv/projects' })));
    try {
      await assertRefused('/opt/projects/beta', 'saved-other-root-is-physical-target-ancestor');
    } finally {
      await writeFile(betaFile, betaBytes);
    }
    const nativeId = randomUUID().replaceAll('-', '').slice(0, 16);
    await assert.rejects(
      core.ensure(id, { projectId: nativeId, directory: '/srv/projects/beta', networkIsolation: 'host' }),
      {
        code: 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED',
      },
    );
    const nativeBeta = await core.inspect(id, nativeId);
    assert.ok(nativeBeta);
    assert.equal(nativeBeta.phase, 'intent');
    const index = JSON.parse(indexBytes.toString());
    index.projects = index.projects.filter((entry: { id: string }) => entry.id !== 'b'.repeat(16));
    await writeFile(join(machineDirectory, 'projects.json'), JSON.stringify(index));
    proof.nativeOnlyBeta = {
      identity: nativeBeta,
      savedCatalogContainsBeta: false,
      accountReservationOnly: true,
    };
    await assertRefused('/opt/projects/beta', 'native-only-beta-binding-is-physically-protected');
    assert.deepEqual(await core.inspect(id, nativeId), nativeBeta);
    await run('umount /opt/projects');
    mounted = false;
    await run('mount -t tmpfs -o size=1m,mode=0755 tmpfs /opt/projects');
    mounted = true;
    await run('mkdir /opt/projects/owned-independent; chmod 0700 /opt/projects/owned-independent');
    await machines.writeGuestFile(
      id,
      '/opt/projects/owned-independent/marker.txt',
      'Owned distinct filesystem ' + randomUUID(),
    );
    await run('chmod 0644 /opt/projects/owned-independent/marker.txt');
    await writeFile(
      join(machineDirectory, 'project.json'),
      JSON.stringify(
        projectSchema.parse({ directory: '/opt/projects/owned-independent', networkIsolation: 'private' }),
      ),
    );
    const independent = (await migration.preview(id)).plan!;
    assert.ok(independent);
    assert.equal(independent.state, 'preview');
    assert.equal(independent.proposal.summary.files, 1);
    assert.notEqual(independent.proposal.entries[0].device, before.beta.device);
    assert.deepEqual(await inspect('/srv/projects/beta/marker.txt'), before.marker);
    proof.cases.push({
      name: 'independent-filesystem-unrelated-preview-remains-allowed',
      mount: 'kernel tmpfs',
      device: independent.proposal.entries[0].device,
      originalDevice: before.beta.device,
      applyCalled: false,
      betaUnchanged: true,
      passed: true,
    });
    console.log('PASS independent-filesystem-unrelated-preview-remains-allowed');
    await run('umount /opt/projects');
    mounted = false;
    await run('mount --bind / /opt/projects');
    mounted = true;
    await assertRefused(
      '/opt/projects/srv/projects/beta',
      'root-of-filesystem-bind-does-not-bypass-native-overlap',
    );
    assert.deepEqual(await core.inspect(id, nativeId), nativeBeta);
  }
} catch (error) {
  proof.error = error instanceof Error ? error.message : String(error);
  console.error(proof.error);
} finally {
  await writeFile(join(machineDirectory, 'project.json'), savedBytes);
  await writeFile(join(machineDirectory, 'projects.json'), indexBytes);
  await writeFile(betaFile, betaBytes);
  if (machines.live.has(id)) {
    try {
      if (mounted) await run('umount /opt/projects');
      if (created) await run('rmdir /opt/projects');
      proof.aliasRemoved = true;
    } catch (error) {
      proof.cleanupError = String(error);
    }
    try {
      await run('sync');
      proof.synced = true;
    } catch (error) {
      proof.syncError = String(error);
    }
  }
  await spaces.close();
  try {
    await machines.stop(id, true);
    proof.vmStopped = machines.state(id) === 'stopped' && !machines.live.has(id);
  } catch (error) {
    proof.stopError = String(error);
  }
  await machines.close();
  proof.liveCount = machines.live.size;
  proof.savedConfigRestored = (await readFile(join(machineDirectory, 'project.json'))).equals(savedBytes);
  proof.finishedSourceSha256 = {};
  for (const file of Object.keys(proof.sourceSha256))
    proof.finishedSourceSha256[file] = createHash('sha256')
      .update(await readFile(join(workspace, file)))
      .digest('hex');
  proof.sourcesUnchanged = Object.keys(proof.sourceSha256).every(
    (file) => proof.sourceSha256[file] === proof.finishedSourceSha256[file],
  );
  proof.finishedAt = new Date().toISOString();
  proof.passed =
    !proof.error &&
    !proof.cleanupError &&
    !proof.syncError &&
    !proof.stopError &&
    proof.cases.length === expectedCases &&
    proof.aliasRemoved &&
    proof.savedConfigRestored &&
    proof.sourcesUnchanged &&
    proof.vmStopped &&
    proof.liveCount === 0;
  const proofPath = join(
    root,
    'project-directory-migration-physical-overlap-evidence-' + randomUUID() + '.json',
  );
  await writeFile(proofPath, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ proof: proofPath, passed: proof.passed, expect, vmStopped: proof.vmStopped }));
  if (!proof.passed) process.exitCode = 1;
}
