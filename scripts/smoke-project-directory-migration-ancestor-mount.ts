import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.ok(process.execArgv.includes('--no-addons'));
const expectedOutcome = process.argv.includes('--expect=accepted') ? 'accepted' : 'refused';
const workspace = await realpath(resolve('.'));
assert.match(workspace, /^[dD]:\\/);
const parent = await realpath(join(workspace, '.data', 'project-directory-migration-test-temp'));
const root = await realpath(join(parent, 'sakura-directory-migration-1KF41h'));
assert.equal(dirname(root), parent);
assert.equal(basename(root), 'sakura-directory-migration-1KF41h');
const originalProof = JSON.parse(
  await readFile(join(root, 'project-directory-migration-evidence.json'), 'utf8'),
);
const expectedId = 'c06d5e80-61c1-43ad-96fc-ed565a0f6ece';
assert.equal(originalProof.fixture, root);
assert.equal(originalProof.vmId, expectedId);
assert.equal(originalProof.passed, false);
assert.equal(originalProof.sourcesUnchanged, false);
assert.equal(originalProof.error, undefined);
assert.equal(originalProof.stopError, undefined);
assert.equal(originalProof.closeError, undefined);
assert.equal(originalProof.syncError, undefined);
assert.equal(originalProof.synced, true);
assert.equal(originalProof.cases.length, 22);
assert.ok(originalProof.cases.every((entry: { passed: boolean }) => entry.passed));
assert.equal(
  originalProof.sourceSha256['server/project-directory-migration.ts'],
  '7e04af4f089dd33c891ef883f8b18b79cfa4e3b5a6b090bc990ad80672443de6',
);
assert.equal(
  originalProof.finishedSourceSha256['server/project-directory-migration.ts'],
  originalProof.sourceSha256['server/project-directory-migration.ts'],
);
assert.equal(
  originalProof.sourceSha256['scripts/smoke-project-directory-migration.ts'],
  originalProof.finishedSourceSha256['scripts/smoke-project-directory-migration.ts'],
);
assert.equal(
  originalProof.sourceSha256['server/project-run-scope.ts'],
  'e4912d581007eb6fcdb275d1e06db12ae11b03e363cae5ab8a1214c5668a2096',
);
assert.equal(
  originalProof.finishedSourceSha256['server/project-run-scope.ts'],
  'c6324e50cd9570dbf94b0e73330a4d07e44aec0da444fda25cc626995dd1bf93',
);
assert.equal(originalProof.vmStopped, true);
assert.equal(originalProof.liveCount, 0);
assert.equal(
  originalProof.identityBuild.build,
  '8aa358c94532654420a1c67671b17a287b9e76707a70e10004d3820a2b8991fb',
);
const records = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
assert.equal(records.length, 1);
assert.equal(records[0].id, expectedId);
assert.equal(records[0].name, 'directory-migration-smoke');
assert.equal(records[0].distro, 'debian');
process.env.TEMP = process.env.TMP = parent;
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = join(workspace, '.data', 'images');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces, projectSchema } = await import('../server/workspaces.ts');
const { vmDir } = await import('../server/model.ts');
const { ProjectIdentities, projectIdentitySources } = await import('../server/project-identity.ts');
const { ProjectRunScopes } = await import('../server/project-run-scope.ts');
const { ProjectDirectoryMigrations, directoryMigrationHelper } =
  await import('../server/project-directory-migration.ts');
const { quote } = await import('../server/files.ts');
const assets = join(root, 'identity-sources');
const source = await projectIdentitySources(assets);
assert.equal(source.manifest.build, originalProof.identityBuild.build);
const machines = new Machines(await createRuntime());
const spaces = new Workspaces(machines);
const core = new ProjectIdentities(machines, { sourceDirectory: assets });
const migration = new ProjectDirectoryMigrations(machines, spaces, {
  scopes: new ProjectRunScopes(machines, { identities: core }),
  sourceDirectory: assets,
});
const nonce = randomUUID();
const aliasParent = '/srv/projects/owned-ancestor-alias-' + nonce;
const target = aliasParent + '/beta';
const proof: any = {
  version: 1,
  fixture: root,
  vmId: expectedId,
  node: process.version,
  execArgv: process.execArgv,
  expectedOutcome,
  identityBuild: source.manifest,
  finalCoreProof: false,
  scope: 'owned ancestor bind alias preview only; never apply; completed 8aa/22-case fixture',
  baselineQualification:
    'all 22 runtime checks passed and guest synced/stopped; source audit failed only for the recorded adapter SHA transition; never a frozen-source completion proof',
  helperSha256: createHash('sha256').update(directoryMigrationHelper).digest('hex'),
  sourceSha256: createHash('sha256')
    .update(await readFile(join(workspace, 'server/project-directory-migration.ts')))
    .digest('hex'),
  cases: [],
};
const run = async (command: string) => {
  const result = await machines.exec(expectedId, command, 15000);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return result.stdout.trim();
};
const py = (code: string) =>
  'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' + quote(code);
const inspect = async (path: string) =>
  JSON.parse(
    await run(
      py(
        `import hashlib,json,os,stat\np=${JSON.stringify(path)}\ni=os.lstat(p)\nprint(json.dumps({'uid':i.st_uid,'gid':i.st_gid,'mode':stat.S_IMODE(i.st_mode),'inode':str(i.st_ino),'links':i.st_nlink,'sha256':hashlib.sha256(open(p,'rb').read()).hexdigest() if stat.S_ISREG(i.st_mode) else None}))`,
      ),
    ),
  );
let admitted = false,
  madeAlias = false,
  mounted = false,
  savedConfig: Buffer | undefined;
try {
  await machines.init();
  assert.equal(machines.records.size, 1);
  assert.equal(machines.state(expectedId), 'stopped');
  assert.equal(machines.live.size, 0);
  admitted = true;
  await machines.start(expectedId);
  const deadline = Date.now() + 270000;
  while (machines.state(expectedId) !== 'running') {
    assert.equal(machines.state(expectedId), 'starting');
    assert.ok(Date.now() < deadline);
    await delay(300);
  }
  const configFile = join(vmDir(expectedId), 'project.json');
  savedConfig = await readFile(configFile);
  const saved = projectSchema.parse(JSON.parse(savedConfig.toString()));
  assert.equal(saved.directory, '/srv/projects/rebound');
  const before = await inspect('/srv/projects/beta/marker.txt');
  const identity = await core.inspect(expectedId, 'default');
  assert.ok(identity);
  await run('test ! -e ' + quote(aliasParent) + '; mkdir ' + quote(aliasParent));
  madeAlias = true;
  await run('mount --bind /srv/projects ' + quote(aliasParent));
  mounted = true;
  assert.equal((await inspect(target)).inode, (await inspect('/srv/projects/beta')).inode);
  proof.mounts = JSON.parse(
    await run(
      py(
        `import json,os\nresult={}\nfor path in ['/srv/projects',${JSON.stringify(aliasParent)},${JSON.stringify(target)}]:\n fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)\n try:\n  result[path]=next(line.split()[1] for line in open('/proc/self/fdinfo/'+str(fd)) if line.startswith('mnt_id:'))\n finally: os.close(fd)\nprint(json.dumps(result))`,
      ),
    ),
  );
  assert.notEqual(proof.mounts['/srv/projects'], proof.mounts[aliasParent]);
  assert.equal(proof.mounts[aliasParent], proof.mounts[target]);
  await writeFile(configFile, JSON.stringify(projectSchema.parse({ ...saved, directory: target })));
  let observed: 'accepted' | 'refused';
  try {
    const result = await migration.preview(expectedId);
    assert.ok(result.plan);
    assert.equal(result.plan.proposal.directory, target);
    observed = 'accepted';
    proof.preview = {
      sha256: result.plan.sha256,
      planId: result.plan.proposal.planId,
      state: result.plan.state,
      entries: result.plan.proposal.entries.length,
    };
  } catch (error) {
    assert.equal((error as { code?: string }).code, 'PROJECT_DIRECTORY_CROSS_MOUNT');
    observed = 'refused';
    proof.refusalCode = 'PROJECT_DIRECTORY_CROSS_MOUNT';
  }
  proof.observed = observed;
  assert.equal(observed, expectedOutcome);
  assert.deepEqual(await inspect('/srv/projects/beta/marker.txt'), before);
  assert.deepEqual(await core.inspect(expectedId, 'default'), identity);
  proof.betaUnchanged = true;
  proof.identityUnchanged = true;
  proof.cases.push({ name: 'ancestor-bind-alias-preview-' + observed, passed: true });
  console.log('PASS ancestor-bind-alias-preview-' + observed + '; no apply performed');
} catch (error) {
  proof.error = error instanceof Error ? error.message : String(error);
  console.error(proof.error);
} finally {
  if (savedConfig) {
    try {
      await writeFile(join(vmDir(expectedId), 'project.json'), savedConfig);
      proof.configRestored = (await readFile(join(vmDir(expectedId), 'project.json'))).equals(savedConfig);
    } catch (error) {
      proof.restoreError = String(error);
    }
  }
  if (admitted && machines.live.has(expectedId)) {
    try {
      if (mounted) await run('umount ' + quote(aliasParent));
      if (madeAlias) await run('rmdir ' + quote(aliasParent));
      await run('sync');
      proof.synced = true;
    } catch (error) {
      proof.cleanupError = String(error);
    }
  }
  try {
    await spaces.close();
  } catch (error) {
    proof.closeError = String(error);
  }
  if (admitted) {
    try {
      await machines.stop(expectedId, true);
      proof.vmStopped = machines.state(expectedId) === 'stopped' && !machines.live.has(expectedId);
    } catch (error) {
      proof.stopError = String(error);
    }
  }
  try {
    await machines.close();
  } catch (error) {
    proof.runtimeCloseError = String(error);
  }
  proof.liveCount = machines.live.size;
  proof.finishedAt = new Date().toISOString();
  proof.finishedSourceSha256 = createHash('sha256')
    .update(await readFile(join(workspace, 'server/project-directory-migration.ts')))
    .digest('hex');
  proof.sourcesUnchanged = proof.finishedSourceSha256 === proof.sourceSha256;
  proof.passed =
    !proof.error &&
    !proof.restoreError &&
    !proof.closeError &&
    !proof.stopError &&
    !proof.runtimeCloseError &&
    !proof.cleanupError &&
    proof.sourcesUnchanged &&
    proof.configRestored &&
    proof.synced &&
    proof.vmStopped &&
    proof.liveCount === 0;
  const evidence = join(root, 'project-directory-migration-ancestor-mount-evidence-' + nonce + '.json');
  await writeFile(evidence, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ evidence, passed: proof.passed, vmStopped: proof.vmStopped }));
  if (!proof.passed) process.exitCode = 1;
}
