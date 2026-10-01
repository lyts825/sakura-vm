import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.ok(process.execArgv.includes('--no-addons'));
const workspace = await realpath(resolve('.'));
assert.match(workspace, /^[dD]:\\/);
const parent = await realpath(join(workspace, '.data', 'project-directory-migration-test-temp'));
const root = await realpath(join(parent, 'sakura-directory-migration-RBQBw9'));
assert.equal(dirname(root), parent);
assert.equal(basename(root), 'sakura-directory-migration-RBQBw9');
const originalProof = JSON.parse(
  await readFile(join(root, 'project-directory-migration-evidence.json'), 'utf8'),
);
const expectedId = 'f16ec065-3458-4a0c-81e1-ad2bb58e3852';
assert.equal(originalProof.fixture, root);
assert.equal(originalProof.vmId, expectedId);
assert.equal(originalProof.passed, true);
assert.equal(originalProof.cases.length, 20);
assert.equal(originalProof.vmStopped, true);
assert.equal(originalProof.liveCount, 0);
assert.equal(
  originalProof.identityBuild.build,
  '66dd392618be1d9977935a1e0a32bbc3bb26c84bcf23ef2d0236993205b4428c',
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
const alias = '/srv/projects/owned-beta-alias-' + nonce;
const budget = '/srv/projects/owned-budget-' + nonce;
const proof: any = {
  version: 1,
  fixture: root,
  vmId: expectedId,
  node: process.version,
  execArgv: process.execArgv,
  identityBuild: source.manifest,
  finalCoreProof: false,
  scope: 'owned root bind mount preview refusal; original 66dd fixture only',
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
const inspect = async (path: string) =>
  JSON.parse(
    await run(
      'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' +
        quote(
          `import hashlib,json,os,stat\np=${JSON.stringify(path)}\ni=os.lstat(p)\nprint(json.dumps({'uid':i.st_uid,'gid':i.st_gid,'mode':stat.S_IMODE(i.st_mode),'inode':str(i.st_ino),'links':i.st_nlink,'sha256':hashlib.sha256(open(p,'rb').read()).hexdigest() if stat.S_ISREG(i.st_mode) else None}))`,
        ),
    ),
  );
let admitted = false,
  madeAlias = false,
  mounted = false,
  madeBudget = false,
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
  await run('test ! -e ' + quote(alias) + '; mkdir ' + quote(alias));
  madeAlias = true;
  await run('mount --bind /srv/projects/beta ' + quote(alias));
  mounted = true;
  assert.equal((await inspect(alias)).inode, (await inspect('/srv/projects/beta')).inode);
  await writeFile(configFile, JSON.stringify(projectSchema.parse({ ...saved, directory: alias })));
  await assert.rejects(migration.preview(expectedId), { code: 'PROJECT_DIRECTORY_CROSS_MOUNT' });
  assert.deepEqual(await inspect('/srv/projects/beta/marker.txt'), before);
  assert.deepEqual(await core.inspect(expectedId, 'default'), identity);
  proof.cases.push({ name: 'root-bind-alias-refused-with-beta-and-account-unchanged', passed: true });
  console.log('PASS root-bind-alias-refused-with-beta-and-account-unchanged');
  await run(
    'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' +
      quote(
        `import os\nroot=${JSON.stringify(budget)}\nos.mkdir(root,0o700)\npath=root\nfor level in range(4):\n path+='/level-'+str(level)+'-'+('x'*180);os.mkdir(path,0o700)\nfor index in range(260):\n fd=os.open(path+'/file-'+str(index)+'-'+('x'*180),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644);os.close(fd)`,
      ),
  );
  madeBudget = true;
  await writeFile(configFile, JSON.stringify(projectSchema.parse({ ...saved, directory: budget })));
  let refused: any;
  try {
    await migration.preview(expectedId);
  } catch (error) {
    refused = error;
  }
  assert.equal(refused?.code, 'PROJECT_DIRECTORY_PLAN_RECEIPT_LIMIT');
  const bounded = refused.migrationDetail.plan;
  assert.ok(bounded);
  const initialBytes = Buffer.byteLength(JSON.stringify(bounded));
  const completedBytes = Buffer.byteLength(
    JSON.stringify({ ...bounded, completed: bounded.proposal.entries.map((entry: any) => entry.path) }),
  );
  assert.ok(initialBytes <= 524288);
  assert.ok(completedBytes > 524288);
  assert.equal((await inspect(budget)).uid, 0);
  assert.deepEqual(await inspect('/srv/projects/beta/marker.txt'), before);
  assert.deepEqual(await core.inspect(expectedId, 'default'), identity);
  proof.cases.push({
    name: 'future-retry-journal-size-refused-before-ownership-change',
    initialBytes,
    completedBytes,
    entries: bounded.proposal.entries.length,
    passed: true,
  });
  console.log('PASS future-retry-journal-size-refused-before-ownership-change');
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
      if (mounted) await run('umount ' + quote(alias));
      if (madeAlias) await run('rmdir ' + quote(alias));
      if (madeBudget)
        await run(
          'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' +
            quote(
              `import os,shutil,stat\nroot=${JSON.stringify(budget)}\ninfo=os.lstat(root)\nassert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and root.startswith('/srv/projects/owned-budget-') and os.path.dirname(root)=='/srv/projects'\nshutil.rmtree(root)`,
            ),
        );
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
  proof.passed =
    !proof.error &&
    !proof.restoreError &&
    !proof.closeError &&
    !proof.stopError &&
    !proof.runtimeCloseError &&
    !proof.cleanupError &&
    proof.configRestored &&
    proof.synced &&
    proof.vmStopped &&
    proof.liveCount === 0;
  const evidence = join(root, 'project-directory-migration-root-mount-evidence-' + nonce + '.json');
  await writeFile(evidence, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ evidence, passed: proof.passed, vmStopped: proof.vmStopped }));
  if (!proof.passed) process.exitCode = 1;
}
