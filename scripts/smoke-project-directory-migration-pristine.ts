import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.ok(process.execArgv.includes('--no-addons'), 'Use node --no-addons --import tsx.');
const workspace = await realpath(resolve('.'));
assert.match(workspace, /^[dD]:\\/);
const parent = join(workspace, '.data', 'project-directory-migration-test-temp');
await mkdir(parent, { recursive: true });
assert.equal(dirname(await realpath(parent)), await realpath(join(workspace, '.data')));
const root = await mkdtemp(join(parent, 'sakura-directory-pristine-'));
assert.equal(dirname(await realpath(root)), await realpath(parent));
assert.match(basename(root), /^sakura-directory-pristine-/);
process.env.TEMP = process.env.TMP = parent;
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = join(workspace, '.data', 'images');
process.env.SAKURA_IMAGE_PATH = join(workspace, '.data', 'images', 'alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces, projectSchema } = await import('../server/workspaces.ts');
const { vmDir } = await import('../server/model.ts');
const { ProjectTerminals, assertProjectTerminalsStopped } = await import('../server/project-terminals.ts');
const { assertNoPendingProjectDirectoryMigration } = await import('../server/project-directory-migration.ts');
const machines = new Machines(await createRuntime()),
  spaces = new Workspaces(machines),
  terminals = new ProjectTerminals(machines, spaces),
  originalExec = machines.exec;
const proof: any = {
  version: 1,
  fixture: root,
  distro: 'alpine',
  client: { node: process.version, execArgv: process.execArgv },
  sourceSha256: {},
  cases: [],
  pythonUnavailableFixture: {
    transportOnly: true,
    replacement: '/usr/bin/python3 -I -S -c → /bin/false -I -S -c',
    systemPythonModified: false,
    installedPackages: false,
  },
};
for (const file of [
  'server/project-directory-migration.ts',
  'server/project-terminals.ts',
  'scripts/smoke-project-directory-migration-pristine.ts',
])
  proof.sourceSha256[file] = createHash('sha256')
    .update(await readFile(join(workspace, file)))
    .digest('hex');
let id = '',
  unavailable = false,
  guards = 0;
const checkpoint = (name: string, detail: object = {}) => {
  proof.cases.push({ name, ...detail, passed: true });
  console.log('PASS ' + name);
};
const run = async (command: string) => {
  const result = await originalExec.call(machines, id, command, 10000);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result.stdout.trim();
};
machines.exec = async function (vmId, command, ...args) {
  assert.equal(vmId, id);
  if (command.includes('for sakura_migration_directory in / /var ')) {
    ++guards;
    assert.equal(command.split('/usr/bin/python3 -I -S -c').length, 2);
    if (unavailable) command = command.replace('/usr/bin/python3 -I -S -c', '/bin/false -I -S -c');
  }
  return originalExec.call(machines, vmId, command, ...args);
};
try {
  await machines.init();
  assert.equal(machines.records.size, 0);
  const vm = await machines.create({
    name: 'directory-pristine-alpine-smoke',
    distro: 'alpine',
    memoryMiB: 512,
    cpus: 1,
    diskGiB: 2,
    accelerator: 'tcg',
    forwards: [],
    template: 'none',
  });
  id = vm.id;
  proof.vmId = id;
  assert.equal(machines.records.size, 1);
  await machines.start(id);
  const deadline = Date.now() + 270000;
  while (machines.state(id) !== 'running') {
    assert.equal(machines.state(id), 'starting');
    assert.ok(Date.now() < deadline);
    await delay(300);
  }
  console.log('Owned pristine migration fixture: ' + root);
  proof.environment = {
    busyBox: await run('busybox | head -n 1'),
    python: await run(
      "if command -v python3 >/dev/null 2>&1; then python3 --version; else printf '%s\\n' absent; fi",
    ),
  };
  await run(
    'test ! -e /var/lib/sakura/project-directory-migrations; test ! -L /var/lib/sakura/project-directory-migrations',
  );
  await assertNoPendingProjectDirectoryMigration(machines, id, 'default');
  checkpoint('pristine-alpine-real-busybox-stat-check-allows-missing-ledger', proof.environment);
  unavailable = true;
  const project = projectSchema.parse({
    directory: '/workspace/owned-pristine-' + randomUUID(),
    networkIsolation: 'host',
  });
  await writeFile(join(vmDir(id), 'project.json'), JSON.stringify(project));
  const lease = await terminals.prepare(id, 'default', null);
  try {
    assert.throws(() => assertProjectTerminalsStopped(machines, id, 'default'), {
      code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP',
    });
  } finally {
    lease.release();
  }
  assert.doesNotThrow(() => assertProjectTerminalsStopped(machines, id, 'default'));
  checkpoint('missing-ledger-allows-normal-terminal-with-python-unavailable', {
    transportUnavailablePython: true,
    baselineActuallyHasNoPython: proof.environment.python === 'absent',
  });
  await run(
    'test ! -e /var/lib/sakura/project-identities/registry.json; test ! -e /usr/local/lib/sakura-project-identity',
  );
  await run(
    'mkdir -p /var/lib/sakura/project-directory-migrations; chmod 0700 /var/lib/sakura/project-directory-migrations',
  );
  if (proof.environment.python === 'absent') {
    unavailable = false;
    await assert.rejects(assertNoPendingProjectDirectoryMigration(machines, id, 'default'), {
      code: 'PROJECT_DIRECTORY_LATCH_CHANGED',
    });
    unavailable = true;
    proof.existingLedgerWithoutSystemPythonRejected = true;
  }
  await assert.rejects(assertNoPendingProjectDirectoryMigration(machines, id, 'default'), {
    code: 'PROJECT_DIRECTORY_LATCH_CHANGED',
  });
  await assert.rejects(terminals.prepare(id, 'default', null), { code: 'PROJECT_DIRECTORY_LATCH_CHANGED' });
  checkpoint('existing-protected-ledger-requires-python-and-fails-closed');
  unavailable = false;
  if (proof.environment.python !== 'absent') {
    await assertNoPendingProjectDirectoryMigration(machines, id, 'default');
    checkpoint('existing-protected-ledger-with-python-checks-missing-project-nofollow');
  }
  await run(
    'rmdir /var/lib/sakura/project-directory-migrations; ln -s /tmp /var/lib/sakura/project-directory-migrations',
  );
  await assert.rejects(assertNoPendingProjectDirectoryMigration(machines, id, 'default'), {
    code: 'PROJECT_DIRECTORY_LATCH_CHANGED',
  });
  await run(
    'unlink /var/lib/sakura/project-directory-migrations; mkdir /var/lib/sakura/project-directory-migrations; chmod 0777 /var/lib/sakura/project-directory-migrations',
  );
  await assert.rejects(assertNoPendingProjectDirectoryMigration(machines, id, 'default'), {
    code: 'PROJECT_DIRECTORY_LATCH_CHANGED',
  });
  await run('chmod 0700 /var/lib/sakura/project-directory-migrations');
  checkpoint('symlink-or-writable-ledger-does-not-take-pristine-shortcut');
  proof.guardCalls = guards;
} catch (error) {
  proof.error = error instanceof Error ? error.message : String(error);
  console.error(proof.error);
} finally {
  machines.exec = originalExec;
  await terminals.close();
  if (id && machines.live.has(id)) {
    try {
      await run('sync');
      proof.synced = true;
    } catch (error) {
      proof.syncError = String(error);
    }
  }
  try {
    await spaces.close();
  } catch (error) {
    proof.closeError = String(error);
  }
  if (id) {
    try {
      await machines.stop(id, true);
      proof.vmStopped = machines.state(id) === 'stopped' && !machines.live.has(id);
    } catch (error) {
      proof.stopError = String(error);
    }
  }
  await machines.close();
  proof.liveCount = machines.live.size;
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
    !proof.syncError &&
    !proof.closeError &&
    !proof.stopError &&
    proof.sourcesUnchanged &&
    proof.vmStopped &&
    proof.liveCount === 0;
  await writeFile(
    join(root, 'project-directory-migration-pristine-evidence.json'),
    JSON.stringify(proof, null, 2),
  );
  console.log(
    JSON.stringify({
      fixture: root,
      passed: proof.passed,
      cases: proof.cases.length,
      vmStopped: proof.vmStopped,
    }),
  );
  if (!proof.passed) process.exitCode = 1;
}
