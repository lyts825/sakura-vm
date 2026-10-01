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
const reuse = process.argv[2] === '--reuse-owned-YkUE8m';
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && reuse));
const root = reuse
  ? await realpath(join(parent, 'sakura-directory-migration-YkUE8m'))
  : await mkdtemp(join(parent, 'sakura-directory-migration-'));
assert.equal(dirname(await realpath(root)), await realpath(parent));
assert.match(basename(root), /^sakura-directory-migration-/);
let prior: any = null,
  priorBytes: Buffer | undefined;
const priorHostFiles: Record<string, Buffer> = {};
if (reuse) {
  assert.equal(basename(root), 'sakura-directory-migration-YkUE8m');
  priorBytes = await readFile(join(root, 'project-directory-migration-evidence.json'));
  prior = JSON.parse(priorBytes.toString());
  assert.equal(prior.fixture, root);
  assert.equal(prior.vmId, '6ffef601-cd66-4b63-a2e8-d73e22ceecfb');
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
  assert.equal(records[0].id, prior.vmId);
  assert.equal(records[0].name, 'directory-migration-smoke');
  assert.equal(records[0].distro, 'debian');
  assert.equal(records[0].bootstrapped, true);
  for (const key of ['storagePoolId', 'sandbox', 'haPromotion', 'haRetirement', 'lastError'])
    assert.equal(records[0][key], undefined);
  const directory = await realpath(join(root, 'machines', prior.vmId));
  assert.equal(dirname(directory), await realpath(join(root, 'machines')));
  assert.equal(dirname(await realpath(join(directory, 'disk.qcow2'))), directory);
  for (const path of [
    join(root, 'project-directory-migration-evidence.json'),
    join(directory, 'project.json'),
    join(directory, 'project-' + 'b'.repeat(16) + '.json'),
    join(directory, 'projects.json'),
  ])
    priorHostFiles[path] = await readFile(path);
  assert.equal(
    JSON.parse(priorHostFiles[join(directory, 'project.json')].toString()).directory,
    '/srv/projects/rebound',
  );
  assert.equal(
    JSON.parse(priorHostFiles[join(directory, 'project-' + 'b'.repeat(16) + '.json')].toString()).directory,
    '/srv/projects/beta',
  );
}
const attempt = reuse ? await mkdtemp(join(root, 'directory-migration-attempt-')) : root;
if (reuse) assert.equal(dirname(await realpath(attempt)), root);
const alphaId = reuse ? randomUUID().replaceAll('-', '').slice(0, 16) : 'default';
const betaId = reuse ? randomUUID().replaceAll('-', '').slice(0, 16) : 'b'.repeat(16);
const projectRoot = reuse ? '/srv/projects/sakura-owned-migration-' + randomUUID() : '/srv/projects';
const mappedDirectory = (value: string) => value.replaceAll('/srv/projects', projectRoot);
process.env.TEMP = process.env.TMP = parent;
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = join(workspace, '.data', 'images');
process.env.SAKURA_IMAGE_PATH = join(workspace, '.data', 'images', 'debian-12.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces, projectSchema } = await import('../server/workspaces.ts');
const ownProject = (value: unknown) => {
  const project = projectSchema.parse(value);
  if (alphaId !== 'default')
    Object.defineProperty(project, '_workspace', { value: alphaId, enumerable: false });
  return project;
};
const { vmDir } = await import('../server/model.ts');
const { ProjectIdentities, projectIdentityAssetNames } = await import('../server/project-identity.ts');
const { ProjectRunScopes } = await import('../server/project-run-scope.ts');
const { ProjectDirectoryMigrations, directoryMigrationHelper, assertNoPendingProjectDirectoryMigration } =
  await import('../server/project-directory-migration.ts');
const { quote } = await import('../server/files.ts');
const { ensureProjectNetworkScript } = await import('../server/project-network-isolation.ts');
const { projectSshPaths } = await import('../server/project-ssh.ts');
const { ProjectTerminals, assertProjectTerminalsStopped } = await import('../server/project-terminals.ts');
const assets = join(attempt, 'identity-sources');
await mkdir(assets);
const aggregate = createHash('sha256'),
  files: { name: string; size: number; sha256: string }[] = [];
for (const name of projectIdentityAssetNames) {
  const data = await readFile(join(workspace, 'native', 'project-identity', name));
  aggregate.update(name).update(data);
  await writeFile(join(assets, name), data);
  files.push({ name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
const manifest = { version: 1, build: aggregate.digest('hex'), files };
if (reuse) assert.deepEqual(manifest, prior.identityBuild);
await writeFile(join(assets, 'manifest.json'), JSON.stringify(manifest));
const machines = new Machines(await createRuntime());
const spaces = new Workspaces(machines);
const terminals = new ProjectTerminals(machines, spaces);
const core = new ProjectIdentities(machines, { sourceDirectory: assets });
const scopes = new ProjectRunScopes(machines, { identities: core });
const options = { scopes, sourceDirectory: assets };
let migration = new ProjectDirectoryMigrations(machines, spaces, options);
const proof: any = {
  version: 1,
  fixture: root,
  attempt,
  reusedOwnedFixture: reuse,
  projectId: alphaId,
  betaProjectId: betaId,
  projectRoot,
  prior: reuse
    ? {
        sha256: createHash('sha256').update(priorBytes!).digest('hex'),
        vmId: prior.vmId,
        cases: prior.cases.length,
        passed: prior.passed,
      }
    : null,
  distro: 'debian',
  client: { node: process.version, execArgv: process.execArgv },
  identityBuild: manifest,
  expectedCaseCount: 28,
  sourceSha256: {},
  cases: [],
};
for (const file of [
  'server/project-directory-migration.ts',
  'server/project-run-scope.ts',
  'server/project-terminals.ts',
  'scripts/smoke-project-directory-migration.ts',
])
  proof.sourceSha256[file] = createHash('sha256')
    .update(await readFile(join(workspace, file)))
    .digest('hex');
let id = '',
  project: ReturnType<typeof projectSchema.parse>,
  originalInput = machines.execInput;
let originalIndex: Buffer | undefined;
let priorGuest: object | undefined;
const projectFile = () =>
  join(vmDir(id), alphaId === 'default' ? 'project.json' : 'project-' + alphaId + '.json');
const checkpoint = (name: string, detail: object = {}) => {
  proof.cases.push({ name, ...detail, passed: true });
  console.log('PASS ' + name);
};
const run = async (command: string, timeout = 15000) => {
  const result = await machines.exec(id, command, timeout);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result.stdout.trim();
};
const py = (source: string) =>
  'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ' +
  quote(source);
const inspect = async (path: string) =>
  JSON.parse(
    await run(
      py(
        `import hashlib,json,os,stat\np=${JSON.stringify(path)}\ni=os.lstat(p)\nprint(json.dumps({'uid':i.st_uid,'gid':i.st_gid,'mode':stat.S_IMODE(i.st_mode),'inode':str(i.st_ino),'links':i.st_nlink,'sha256':hashlib.sha256(open(p,'rb').read()).hexdigest() if stat.S_ISREG(i.st_mode) else None}))`,
      ),
    ),
  );
const start = async () => {
  await machines.start(id);
  const deadline = Date.now() + 270000;
  while (machines.state(id) !== 'running') {
    assert.equal(machines.state(id), 'starting', 'Owned fixture boot failed.');
    assert.ok(Date.now() < deadline, 'Owned fixture boot timeout.');
    await delay(300);
  }
};
const inputFor = (plan: any) => ({
  action: 'apply',
  version: 1,
  planId: plan.proposal.planId,
  sha256: plan.sha256,
  reviewed: true,
});
const expectTerminalGate = async (phase: string) => {
  const originalExec = machines.exec,
    commands: string[] = [];
  machines.exec = async function (vmId, command, ...args) {
    assert.equal(vmId, id);
    commands.push(command);
    return originalExec.call(machines, vmId, command, ...args);
  };
  try {
    await assert.rejects(terminals.prepare(id, alphaId, null), {
      code: 'PROJECT_DIRECTORY_MIGRATION_PENDING',
    });
    await assert.rejects(terminals.prepare(id, alphaId, 'owned', true, undefined, randomUUID()), {
      code: 'PROJECT_DIRECTORY_MIGRATION_PENDING',
    });
  } finally {
    machines.exec = originalExec;
  }
  assert.equal(commands.length, 2);
  for (const command of commands) {
    assert.ok(command.includes('project-directory-migrations'));
    assert.doesNotMatch(command, /apt-get|apk add|mkdir -p|ip netns|tmux new/);
  }
  assert.doesNotThrow(() => assertProjectTerminalsStopped(machines, id, alphaId));
  checkpoint('ordinary-and-readonly-terminal-admission-blocks-' + phase, {
    rootPreparationExecuted: false,
    guestCalls: commands.length,
  });
};
try {
  await machines.init();
  assert.equal(machines.records.size, reuse ? 1 : 0);
  if (reuse) {
    id = prior.vmId;
    assert.equal(machines.state(id), 'stopped');
    assert.equal(machines.live.size, 0);
  } else {
    const vm = await machines.create({
      name: 'directory-migration-smoke',
      distro: 'debian',
      memoryMiB: 1024,
      cpus: 1,
      diskGiB: 4,
      accelerator: 'tcg',
      forwards: [],
      template: 'none',
    });
    id = vm.id;
  }
  proof.vmId = id;
  assert.equal(machines.records.size, 1);
  await start();
  console.log('Owned directory migration fixture: ' + root);
  console.log('Owned directory migration attempt: ' + attempt);
  if (reuse) {
    priorGuest = {
      defaultIdentity: await core.inspect(id, 'default'),
      betaDirectory: await inspect('/srv/projects/beta'),
      betaMarker: await inspect('/srv/projects/beta/marker.txt'),
    };
    proof.priorGuest = priorGuest;
  }
  project = ownProject({ directory: mappedDirectory('/srv/projects/alpha'), networkIsolation: 'private' });
  await writeFile(projectFile(), JSON.stringify(project));
  await writeFile(
    join(vmDir(id), 'project-' + betaId + '.json'),
    JSON.stringify(ownProject({ directory: mappedDirectory('/srv/projects/beta') })),
  );
  originalIndex = reuse ? await readFile(join(vmDir(id), 'projects.json')) : undefined;
  const index = originalIndex ? JSON.parse(originalIndex.toString()) : { active: alphaId, projects: [] };
  assert.ok(!index.projects.some((entry: { id: string }) => [alphaId, betaId].includes(entry.id)));
  index.active = alphaId;
  index.projects.push(
    { id: alphaId, name: 'Owned Alpha ' + alphaId },
    { id: betaId, name: 'Owned Beta ' + betaId },
  );
  await writeFile(join(vmDir(id), 'projects.json'), JSON.stringify(index));
  await spaces.projects.inScope(id, alphaId, async () => {
    if (reuse) assert.equal(await core.inspect(id, alphaId), null);
    assert.equal((await migration.view(id)).plan, null);
    if (reuse) assert.equal(await core.inspect(id, alphaId), null);
    else {
      const absent = await machines.exec(
        id,
        'test ! -e /var/lib/sakura/project-identities/registry.json',
        10000,
      );
      assert.equal(absent.code, 0);
    }
    checkpoint('GET-does-not-create-or-install-account');
    console.log('Installing fixed identity build ' + manifest.build);
    await core.install(id);
    await run(ensureProjectNetworkScript(project, 'debian'), 120000);
    await run(
      'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -ec ' +
        quote(
          mappedDirectory(
            'mkdir -p /srv/projects/alpha /srv/projects/beta\nchmod 0755 /srv/projects\nchmod 0700 /srv/projects/alpha /srv/projects/beta\ncommand -v tmux >/dev/null || { export DEBIAN_FRONTEND=noninteractive; apt-get update >/dev/null; apt-get install -y tmux >/dev/null; }',
          ),
        ),
      300000,
    );
    await machines.writeGuestFile(
      id,
      mappedDirectory('/srv/projects/alpha/data.txt'),
      '专属数据\0' + randomUUID(),
    );
    await machines.writeGuestFile(
      id,
      mappedDirectory('/srv/projects/alpha/executable.sh'),
      '#!/bin/sh\nexit 0\n',
    );
    await machines.writeGuestFile(
      id,
      mappedDirectory('/srv/projects/beta/marker.txt'),
      'Other owned project ' + randomUUID(),
    );
    await run(
      mappedDirectory(
        'chmod 0644 /srv/projects/alpha/data.txt /srv/projects/beta/marker.txt; chmod 0755 /srv/projects/alpha/executable.sh',
      ),
    );
    const before = await inspect(mappedDirectory('/srv/projects/alpha/data.txt')),
      betaBefore = await inspect(mappedDirectory('/srv/projects/beta/marker.txt'));
    const originalEnsure = core.ensure;
    let dropEnsure = true;
    core.ensure = async function (...args) {
      try {
        const result = await originalEnsure.apply(core, args);
        if (dropEnsure) {
          dropEnsure = false;
          throw new Error('Owned ensure ACK lost.');
        }
        return result;
      } catch (error) {
        if (dropEnsure) {
          dropEnsure = false;
          throw new Error('Owned ensure ACK lost.');
        }
        throw error;
      }
    };
    try {
      await assert.rejects(migration.preview(id), /Owned ensure ACK lost/);
    } finally {
      core.ensure = originalEnsure;
    }
    const reservedAfterLostAck = await core.inspect(id, alphaId);
    assert.ok(reservedAfterLostAck);
    const initial = (await migration.preview(id)).plan!;
    assert.equal(initial.proposal.identity.identityId, reservedAfterLostAck.identityId);
    assert.equal(initial.proposal.identity.uid, reservedAfterLostAck.uid);
    checkpoint('same-target-lost-ensure-ack-recovers-fixed-reservation', {
      uid: reservedAfterLostAck.uid,
      identityId: reservedAfterLostAck.identityId,
    });
    assert.equal(initial.proposal.identity.phase, 'intent');
    assert.equal(initial.proposal.summary.files, 2);
    assert.deepEqual(await inspect(mappedDirectory('/srv/projects/alpha/data.txt')), before);
    assert.equal((await inspect(mappedDirectory('/srv/projects/alpha'))).uid, 0);
    checkpoint('preview-fixes-intent-and-full-tree-without-chown', {
      identity: initial.proposal.identity,
      summary: initial.proposal.summary,
      proposalSha256: initial.sha256,
    });
    await run(mappedDirectory('ln -s /srv/projects/beta/marker.txt /srv/projects/alpha/forbidden-link'));
    await assert.rejects(migration.preview(id), { code: 'PROJECT_DIRECTORY_SYMLINK' });
    await run(mappedDirectory('unlink /srv/projects/alpha/forbidden-link'));
    checkpoint('symlink-refused');
    await run(mappedDirectory('ln /srv/projects/beta/marker.txt /srv/projects/alpha/forbidden-hardlink'));
    await assert.rejects(migration.preview(id), { code: 'PROJECT_DIRECTORY_HARDLINK' });
    await run(mappedDirectory('unlink /srv/projects/alpha/forbidden-hardlink'));
    checkpoint('hardlink-to-adjacent-project-refused');
    await run(
      mappedDirectory(
        'mkdir /srv/projects/alpha/mounted; mount --bind /srv/projects/beta /srv/projects/alpha/mounted',
      ),
    );
    await assert.rejects(migration.preview(id), { code: 'PROJECT_DIRECTORY_CROSS_MOUNT' });
    await run(mappedDirectory('umount /srv/projects/alpha/mounted; rmdir /srv/projects/alpha/mounted'));
    checkpoint('same-filesystem-bind-mount-refused');
    await run(mappedDirectory('chmod 0666 /srv/projects/alpha/data.txt'));
    await assert.rejects(migration.preview(id), { code: 'PROJECT_DIRECTORY_FOREIGN_OWNER_OR_WRITER' });
    await run(mappedDirectory('chmod 0644 /srv/projects/alpha/data.txt'));
    checkpoint('foreign-writer-permissions-refused');
    await writeFile(
      join(vmDir(id), 'project-' + betaId + '.json'),
      JSON.stringify(ownProject({ directory: mappedDirectory('/srv/projects') })),
    );
    await assert.rejects(migration.preview(id), { code: 'PROJECT_DIRECTORY_OVERLAP' });
    await writeFile(
      join(vmDir(id), 'project-' + betaId + '.json'),
      JSON.stringify(ownProject({ directory: mappedDirectory('/srv/projects/beta') })),
    );
    checkpoint('overlapping-saved-project-refused');
    const stale = (await migration.preview(id)).plan!;
    await machines.writeGuestFile(
      id,
      mappedDirectory('/srv/projects/alpha/data.txt'),
      'Changed owned body ' + randomUUID(),
    );
    await assert.rejects(migration.apply(id, inputFor(stale)), { code: 'PROJECT_DIRECTORY_TREE_CHANGED' });
    assert.equal((await inspect(mappedDirectory('/srv/projects/alpha/data.txt'))).uid, 0);
    checkpoint('same-plan-content-change-refused-before-chown');
    const fresh = (await migration.preview(id)).plan!;
    const lease = await terminals.prepare(id, alphaId, null);
    const peer = new ProjectTerminals(machines, spaces);
    await peer.close();
    try {
      await assert.rejects(migration.preview(id), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
      await assert.rejects(migration.apply(id, inputFor(fresh)), {
        code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP',
      });
      assert.deepEqual(await inspect(mappedDirectory('/srv/projects/beta/marker.txt')), betaBefore);
    } finally {
      lease.release();
    }
    checkpoint('prepared-raw-terminal-lease-blocks-preview-and-apply-across-peer-close');
    const activeLease = await terminals.prepare(id, alphaId, null),
      ssh = await machines.connect(id);
    let stream: import('ssh2').ClientChannel | undefined;
    try {
      stream = await new Promise<import('ssh2').ClientChannel>((resolve, reject) => {
        ssh.exec(activeLease.command, { pty: { term: 'xterm', cols: 80, rows: 24 } }, (error, channel) =>
          error ? reject(error) : resolve(channel),
        );
      });
      stream.once('close', activeLease.release);
      let output = '';
      stream.on('data', (bytes: Buffer) => {
        output = (output + bytes.toString()).slice(-8192);
      });
      const ready = 'owned-terminal-ready-' + randomUUID();
      stream.write(`printf '%s%s\\n' ${quote(ready.slice(0, 12))} ${quote(ready.slice(12))}\n`);
      for (let attempt = 0; attempt < 150 && !output.includes(ready); ++attempt) await delay(40);
      assert.ok(output.includes(ready), 'The owned raw terminal must execute its fixed readiness marker.');
      assert.equal(stream.destroyed, false);
      await assert.rejects(migration.preview(id), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
      await assert.rejects(migration.apply(id, inputFor(fresh)), {
        code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP',
      });
      const closed = new Promise<void>((resolve) => stream!.once('close', () => resolve()));
      stream.write('exit\n');
      await Promise.race([
        closed,
        delay(5000).then(() => {
          throw new Error('Owned raw terminal did not close.');
        }),
      ]);
    } finally {
      stream?.close();
      ssh.end();
      activeLease.release();
    }
    assert.doesNotThrow(() => assertProjectTerminalsStopped(machines, id, alphaId));
    checkpoint('active-raw-ssh-terminal-blocks-preview-and-apply-until-channel-close', {
      fixedShellMarkerExecuted: true,
      backgroundProcessesStarted: false,
    });
    const applied = (await migration.apply(id, inputFor(fresh))).plan!;
    assert.equal(applied.state, 'applied');
    assert.equal(applied.activatedIdentity?.phase, 'active');
    const identity = applied.activatedIdentity!;
    assert.equal((await inspect(mappedDirectory('/srv/projects/alpha/data.txt'))).uid, identity.uid);
    assert.equal((await inspect(mappedDirectory('/srv/projects/alpha/data.txt'))).mode, 0o600);
    assert.equal((await inspect(mappedDirectory('/srv/projects/alpha/executable.sh'))).mode, 0o700);
    assert.deepEqual(await inspect(mappedDirectory('/srv/projects/beta/marker.txt')), betaBefore);
    checkpoint('explicit-apply-activates-fixed-uid-and-preserves-beta', {
      uid: identity.uid,
      gid: identity.gid,
      completed: applied.completed.length,
      betaUnchanged: true,
    });
    const runTicket = await core.prepare(id, identity);
    const executed = await core.exec(id, identity, runTicket, {
      command: `/usr/bin/python3 -I -S -c ${quote("import json,os;open('owned-write.txt','w').write('new owned marker');print(json.dumps({'uid':os.getuid(),'gid':os.getgid()}))")}`,
    });
    assert.equal(executed.code, 0);
    assert.deepEqual(JSON.parse(executed.stdout), { uid: identity.uid, gid: identity.gid });
    checkpoint('real-project-account-writes-as-unprivileged-uid');
    await run(
      mappedDirectory(
        'mkdir /srv/projects/beta-alias; mount --bind /srv/projects/beta /srv/projects/beta-alias',
      ),
    );
    try {
      project = ownProject({
        directory: mappedDirectory('/srv/projects/beta-alias'),
        networkIsolation: 'private',
      });
      await writeFile(projectFile(), JSON.stringify(project));
      assert.equal(
        (await inspect(mappedDirectory('/srv/projects/beta-alias'))).inode,
        (await inspect(mappedDirectory('/srv/projects/beta'))).inode,
      );
      await assert.rejects(migration.preview(id), { code: 'PROJECT_DIRECTORY_PHYSICAL_OVERLAP' });
      assert.deepEqual(await inspect(mappedDirectory('/srv/projects/beta/marker.txt')), betaBefore);
    } finally {
      await run(mappedDirectory('umount /srv/projects/beta-alias; rmdir /srv/projects/beta-alias'));
      project = ownProject({
        directory: mappedDirectory('/srv/projects/alpha'),
        networkIsolation: 'private',
      });
      await writeFile(projectFile(), JSON.stringify(project));
    }
    checkpoint('root-bind-mount-alias-refused-with-beta-inode-permissions-content-unchanged');
    const ancestorIdentity = await core.inspect(id, alphaId);
    await run(
      mappedDirectory(
        'mkdir /srv/projects/ancestor-beta-alias; mount --bind /srv/projects /srv/projects/ancestor-beta-alias',
      ),
    );
    try {
      project = ownProject({
        directory: mappedDirectory('/srv/projects/ancestor-beta-alias/beta'),
        networkIsolation: 'private',
      });
      await writeFile(projectFile(), JSON.stringify(project));
      assert.equal(
        (await inspect(mappedDirectory('/srv/projects/ancestor-beta-alias/beta'))).inode,
        (await inspect(mappedDirectory('/srv/projects/beta'))).inode,
      );
      await assert.rejects(migration.preview(id), { code: 'PROJECT_DIRECTORY_PHYSICAL_OVERLAP' });
      assert.deepEqual(await inspect(mappedDirectory('/srv/projects/beta/marker.txt')), betaBefore);
      assert.deepEqual(await core.inspect(id, alphaId), ancestorIdentity);
    } finally {
      await run(
        mappedDirectory('umount /srv/projects/ancestor-beta-alias; rmdir /srv/projects/ancestor-beta-alias'),
      );
      project = ownProject({
        directory: mappedDirectory('/srv/projects/alpha'),
        networkIsolation: 'private',
      });
      await writeFile(projectFile(), JSON.stringify(project));
    }
    checkpoint('ancestor-bind-mount-alias-refused-with-beta-and-complete-identity-unchanged');
    const sshPaths = projectSshPaths(alphaId);
    await run(
      `mkdir -p ${quote(sshPaths.config)} /run/sshd; chmod 0700 ${quote(sshPaths.config)}; ssh-keygen -q -t ed25519 -N '' -f ${quote(sshPaths.config + '/owned_host_key')}`,
    );
    await machines.writeGuestFile(
      id,
      sshPaths.config + '/sshd_config',
      `Port 22022\nListenAddress 127.0.0.1\nHostKey ${sshPaths.config}/owned_host_key\nUsePAM no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\nPidFile ${sshPaths.config}/owned.pid\n`,
    );
    await run('chmod 0600 ' + quote(sshPaths.config + '/sshd_config'));
    await run(
      `systemd-run --unit=${sshPaths.unit} --property=PrivateNetwork=yes --property=KillMode=control-group -- /usr/sbin/sshd -D -f ${quote(sshPaths.config + '/sshd_config')}`,
    );
    try {
      await run(`systemctl is-active --quiet ${sshPaths.unit}`);
      await assert.rejects(migration.preview(id), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    } finally {
      await run(`systemctl stop ${sshPaths.unit}`);
    }
    checkpoint('actual-project-sshd-service-refused-until-exact-stop');
    const ownedService = 'sakura-service-' + (alphaId === 'default' ? '' : alphaId + '-') + 'owned';
    for (const session of [
      alphaId === 'default' ? 'sakura-project' : 'sakura-project-' + alphaId,
      ownedService,
      'sakura-terminal-' + alphaId + '-owned',
    ]) {
      if (session === ownedService) {
        project = ownProject({ ...project, services: [{ name: 'owned', command: 'sleep 60' }] });
        await writeFile(projectFile(), JSON.stringify(project));
      }
      await run('tmux new-session -d -s ' + session + ' /bin/sleep 60');
      await assert.rejects(migration.preview(id), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
      await run('tmux kill-session -t ' + session);
      checkpoint('active-legacy-entry-refused:' + session);
    }
    project = ownProject({ directory: mappedDirectory('/srv/projects/alpha'), networkIsolation: 'private' });
    await writeFile(projectFile(), JSON.stringify(project));
    const active = await core.prepare(id, identity);
    try {
      await assert.rejects(migration.preview(id), { code: 'PROJECT_DIRECTORY_IDENTITY_RUNS_MUST_STOP' });
    } finally {
      await core.stop(id, identity, active);
    }
    checkpoint('active-native-identity-ticket-refused');

    // A transport-only fixture pauses after one real fchown. No product/native source is edited.
    await machines.writeGuestFile(
      id,
      mappedDirectory('/srv/projects/alpha/m-fault-data.txt'),
      'Owned interruption marker ' + randomUUID(),
    );
    await run(mappedDirectory('chmod 0644 /srv/projects/alpha/m-fault-data.txt'));
    const fault = (await migration.preview(id)).plan!;
    const barrier = '/tmp/.sakura-directory-migration-barrier-' + randomUUID() + '.json';
    const needle =
      "fd=fds[relative];os.fchown(fd,value['uid'],value['gid']);os.fchmod(fd,entry['targetMode']);os.fsync(fd)";
    assert.equal(directoryMigrationHelper.split(needle).length, 2);
    const replacement =
      "fd=fds[relative];os.fchown(fd,value['uid'],value['gid'])\n" +
      "    if relative=='m-fault-data.txt':\n" +
      '     import signal\n' +
      `     proof={'pid':os.getpid(),'ticks':open('/proc/self/stat').read().rsplit(') ',1)[1].split()[19],'bootId':boot}\n` +
      `     out=os.open(${JSON.stringify(barrier)},os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.write(out,canon(proof));os.fsync(out);os.close(out);os.kill(os.getpid(),signal.SIGSTOP)\n` +
      "    os.fchmod(fd,entry['targetMode']);os.fsync(fd)";
    const injected = directoryMigrationHelper.replace(needle, replacement);
    proof.faultInjection = {
      afterRealFchown: true,
      productSourceModified: false,
      productionHelperSha256: createHash('sha256').update(directoryMigrationHelper).digest('hex'),
      fixtureHelperSha256: createHash('sha256').update(injected).digest('hex'),
    };
    let injectedOnce = false;
    machines.execInput = async function (vmId, command, data, ...rest) {
      const request = JSON.parse(data.toString());
      if (!injectedOnce && request.action === 'apply' && request.planId === fault.proposal.planId) {
        assert.equal(vmId, id);
        injectedOnce = true;
        command = py(injected);
      }
      return originalInput.call(machines, vmId, command, data, ...rest);
    };
    const abort = new AbortController(),
      limit = setTimeout(() => abort.abort(), 30000);
    let failure: unknown, owned: any;
    const interrupted = migration.apply(id, inputFor(fault), abort.signal).catch((error) => {
      failure = error;
    });
    try {
      for (let attempt = 0; attempt < 120; ++attempt) {
        const result = await machines.exec(
          id,
          py(
            `import json,os\np=${JSON.stringify(barrier)}\ntry:\n fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW);data=os.read(fd,8192);os.close(fd);print(json.dumps(json.loads(data)))\nexcept FileNotFoundError: print('null')`,
          ),
          5000,
        );
        assert.equal(result.code, 0);
        owned = JSON.parse(result.stdout);
        if (owned) break;
        await delay(20);
      }
      assert.ok(owned, 'Only the owned injected helper may be signalled.');
      assert.equal(
        (await inspect(mappedDirectory('/srv/projects/alpha/m-fault-data.txt'))).uid,
        identity.uid,
      );
      assert.equal((await inspect(mappedDirectory('/srv/projects/alpha/m-fault-data.txt'))).mode, 0o644);
      await run(
        py(
          `import os,signal\npid=${owned.pid};assert open('/proc/sys/kernel/random/boot_id').read().strip()==${JSON.stringify(owned.bootId)}\nfd=os.pidfd_open(pid);fields=open('/proc/'+str(pid)+'/stat').read().rsplit(') ',1)[1].split();assert fields[19]==${JSON.stringify(owned.ticks)} and fields[0]=='T';signal.pidfd_send_signal(fd,signal.SIGKILL);os.close(fd)`,
        ),
      );
      await interrupted;
      assert.ok(failure);
      checkpoint('real-fchown-interruption-keeps-durable-pending-plan', {
        ownedHelper: owned,
        incompleteMode: 0o644,
        targetMode: 0o600,
      });
    } finally {
      abort.abort();
      clearTimeout(limit);
      await interrupted;
      machines.execInput = originalInput;
    }
    await assert.rejects(assertNoPendingProjectDirectoryMigration(machines, id, alphaId), {
      code: 'PROJECT_DIRECTORY_MIGRATION_PENDING',
    });
    await assert.rejects(core.prepare(id, identity), {
      code: 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_PENDING',
    });
    checkpoint('host-and-real-native-admission-block-partial-migration');
    await expectTerminalGate('applying');
    const failedHelper = directoryMigrationHelper.replace(
      needle,
      "fd=fds[relative];os.fchown(fd,value['uid'],value['gid'])\n" +
        "    if relative=='m-fault-data.txt':fail('OWNED_RETRY_PERMISSION_INTERRUPTED')\n" +
        "    os.fchmod(fd,entry['targetMode']);os.fsync(fd)",
    );
    proof.failedLatchFaultInjection = {
      productionHelperSha256: createHash('sha256').update(directoryMigrationHelper).digest('hex'),
      fixtureHelperSha256: createHash('sha256').update(failedHelper).digest('hex'),
      boundary: 'explicit retry after real fchown and before fchmod; durable failed latch',
    };
    let failRetry = true;
    machines.execInput = async function (vmId, command, bytes, ...args) {
      const request = JSON.parse(bytes.toString());
      if (failRetry && request.action === 'apply' && request.planId === fault.proposal.planId) {
        failRetry = false;
        command = command.replace(quote(directoryMigrationHelper), quote(failedHelper));
      }
      return originalInput.call(machines, vmId, command, bytes, ...args);
    };
    try {
      await assert.rejects(migration.apply(id, inputFor(fault)), {
        code: 'PROJECT_DIRECTORY_OWNED_RETRY_PERMISSION_INTERRUPTED',
      });
    } finally {
      machines.execInput = originalInput;
    }
    const failedLatch = JSON.parse(
      await run(
        py(
          `import json;print(json.dumps(json.load(open(${JSON.stringify('/var/lib/sakura/project-directory-migrations/' + alphaId + '/latch.json')}))))`,
        ),
      ),
    );
    assert.equal(failedLatch.phase, 'failed');
    assert.equal(failedLatch.sha256, fault.sha256);
    await expectTerminalGate('failed');
    const oldBoot = await run('cat /proc/sys/kernel/random/boot_id');
    await run('sync');
    await machines.stop(id, true);
    assert.equal(machines.state(id), 'stopped');
    await start();
    await run(ensureProjectNetworkScript(project, 'debian'), 120000);
    const newBoot = await run('cat /proc/sys/kernel/random/boot_id');
    assert.notEqual(newBoot, oldBoot);
    await assert.rejects(core.prepare(id, identity), {
      code: 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_PENDING',
    });
    migration = new ProjectDirectoryMigrations(machines, spaces, {
      scopes: new ProjectRunScopes(machines, { identities: core }),
      sourceDirectory: assets,
    });
    const recovered = (await migration.preview(id)).plan!;
    assert.equal(recovered.sha256, fault.sha256);
    assert.equal(recovered.attempt, 'm-fault-data.txt');
    assert.ok(recovered.completed.length >= 2);
    const final = (await migration.apply(id, inputFor(recovered))).plan!;
    assert.equal(final.state, 'applied');
    assert.equal(final.sha256, fault.sha256);
    assert.equal((await inspect(mappedDirectory('/srv/projects/alpha/m-fault-data.txt'))).mode, 0o600);
    await assertNoPendingProjectDirectoryMigration(machines, id, alphaId);
    const resumed = await core.prepare(id, final.activatedIdentity!);
    await core.stop(id, final.activatedIdentity!, resumed);
    assert.deepEqual(await inspect(mappedDirectory('/srv/projects/beta/marker.txt')), betaBefore);
    checkpoint('same-plan-recovery-after-real-vm-reboot-and-host-controller-reopen', {
      oldBoot,
      newBoot,
      sha256: final.sha256,
      completed: final.completed.length,
      betaUnchanged: true,
      hostControllerReopened: true,
      hostProcessRestarted: false,
    });
    await run(mappedDirectory('mkdir /srv/projects/rebound; chmod 0700 /srv/projects/rebound'));
    await machines.writeGuestFile(
      id,
      mappedDirectory('/srv/projects/rebound/rebound-marker.txt'),
      'Owned rebind marker ' + randomUUID(),
    );
    project = ownProject({
      directory: mappedDirectory('/srv/projects/rebound'),
      networkIsolation: 'private',
    });
    await writeFile(projectFile(), JSON.stringify(project));
    const rebound = (await migration.preview(id)).plan!;
    assert.equal(rebound.proposal.identity.directory, mappedDirectory('/srv/projects/alpha'));
    const originalRebind = core.rebind;
    let dropRebind = true;
    core.rebind = async function (...args) {
      const result = await originalRebind.apply(core, args);
      if (dropRebind) {
        dropRebind = false;
        throw new Error('Owned rebind ACK lost.');
      }
      return result;
    };
    try {
      await assert.rejects(migration.apply(id, inputFor(rebound)), /Owned rebind ACK lost/);
    } finally {
      core.rebind = originalRebind;
    }
    const actualRebound = await core.inspect(id, alphaId);
    assert.ok(actualRebound);
    assert.equal(actualRebound.revision, identity.revision + 1);
    assert.equal(actualRebound.uid, identity.uid);
    await assert.rejects(core.prepare(id, actualRebound), {
      code: 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_PENDING',
    });
    migration = new ProjectDirectoryMigrations(machines, spaces, {
      scopes: new ProjectRunScopes(machines, { identities: core }),
      sourceDirectory: assets,
    });
    const recovery = (await migration.preview(id)).plan!;
    assert.equal(recovery.sha256, rebound.sha256);
    const confirmed = (await migration.apply(id, inputFor(recovery))).plan!;
    assert.equal(confirmed.activatedIdentity?.revision, actualRebound.revision);
    assert.equal(confirmed.state, 'applied');
    assert.equal(confirmed.sha256, rebound.sha256);
    const allowed = await core.prepare(id, confirmed.activatedIdentity!);
    await core.stop(id, confirmed.activatedIdentity!, allowed);
    assert.deepEqual(await inspect(mappedDirectory('/srv/projects/beta/marker.txt')), betaBefore);
    checkpoint('same-plan-lost-rebind-ack-confirms-only-exact-next-revision', {
      oldRevision: identity.revision,
      newRevision: confirmed.activatedIdentity?.revision,
      unchangedUid: identity.uid,
      betaUnchanged: true,
    });
    await machines.writeGuestFile(
      id,
      mappedDirectory('/srv/projects/rebound/final-confirm.txt'),
      'Owned final confirmation ' + randomUUID(),
    );
    await run(mappedDirectory('chmod 0644 /srv/projects/rebound/final-confirm.txt'));
    const finalWrite = (await migration.preview(id)).plan!;
    const confirmBoundary =
      "core.json_write(receipt_path(project,proposal['planId']),record);latch(core,record,value);return record";
    assert.ok(directoryMigrationHelper.includes(confirmBoundary));
    const interruptedConfirmHelper = directoryMigrationHelper.replace(
      confirmBoundary,
      "core.json_write(receipt_path(project,proposal['planId']),record);fail('OWNED_CONFIRM_FINAL_WRITE_INTERRUPTED');latch(core,record,value);return record",
    );
    proof.confirmFaultInjection = {
      productionHelperSha256: createHash('sha256').update(directoryMigrationHelper).digest('hex'),
      fixtureHelperSha256: createHash('sha256').update(interruptedConfirmHelper).digest('hex'),
      boundary: 'after real applied receipt fsync, before final latch release',
    };
    let interruptConfirm = true;
    machines.execInput = async function (vmId, command, bytes, timeout, signal) {
      const request = JSON.parse(Buffer.from(bytes).toString());
      if (interruptConfirm && request.action === 'confirm' && request.planId === finalWrite.proposal.planId) {
        interruptConfirm = false;
        command = command.replace(quote(directoryMigrationHelper), quote(interruptedConfirmHelper));
      }
      return originalInput.call(machines, vmId, command, bytes, timeout, signal);
    };
    try {
      await assert.rejects(migration.apply(id, inputFor(finalWrite)), {
        code: 'PROJECT_DIRECTORY_OWNED_CONFIRM_FINAL_WRITE_INTERRUPTED',
      });
    } finally {
      machines.execInput = originalInput;
    }
    const uncertain = await migration.view(id);
    assert.equal(uncertain.plan?.state, 'applied');
    assert.ok(uncertain.lastFailure);
    await assert.rejects(core.prepare(id, confirmed.activatedIdentity!), {
      code: 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_PENDING',
    });
    await expectTerminalGate('directory-applied');
    const reviewAgain = (await migration.preview(id)).plan!;
    assert.equal(reviewAgain.state, 'directory-applied');
    assert.equal(reviewAgain.sha256, finalWrite.sha256);
    const release = (await migration.apply(id, inputFor(reviewAgain))).plan!;
    assert.equal(release.state, 'applied');
    assert.equal(release.sha256, finalWrite.sha256);
    const releaseTicket = await core.prepare(id, release.activatedIdentity!);
    await core.stop(id, release.activatedIdentity!, releaseTicket);
    assert.deepEqual(await inspect(mappedDirectory('/srv/projects/beta/marker.txt')), betaBefore);
    checkpoint('applied-receipt-with-pending-latch-keeps-same-plan-explicit-retry', {
      sha256: release.sha256,
      betaUnchanged: true,
    });
  });
} catch (error) {
  proof.error = error instanceof Error ? error.message : String(error);
  console.error(proof.error);
} finally {
  machines.execInput = originalInput;
  await terminals.close();
  if (originalIndex && id) await writeFile(join(vmDir(id), 'projects.json'), originalIndex);
  if (id && machines.live.has(id)) {
    if (reuse && priorGuest) {
      try {
        assert.deepEqual(
          {
            defaultIdentity: await core.inspect(id, 'default'),
            betaDirectory: await inspect('/srv/projects/beta'),
            betaMarker: await inspect('/srv/projects/beta/marker.txt'),
          },
          priorGuest,
        );
        proof.priorGuestUnchanged = true;
      } catch (error) {
        proof.preservationError = String(error);
      }
    }
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
  proof.priorHostFilesUnchanged = !reuse;
  if (reuse) {
    proof.priorHostFilesUnchanged = true;
    for (const [path, bytes] of Object.entries(priorHostFiles)) {
      if (!(await readFile(path)).equals(bytes)) proof.priorHostFilesUnchanged = false;
    }
  }
  proof.finishedAt = new Date().toISOString();
  proof.finishedSourceSha256 = {};
  for (const file of Object.keys(proof.sourceSha256))
    proof.finishedSourceSha256[file] = createHash('sha256')
      .update(await readFile(join(workspace, file)))
      .digest('hex');
  proof.sourcesUnchanged = Object.keys(proof.sourceSha256).every(
    (file) => proof.sourceSha256[file] === proof.finishedSourceSha256[file],
  );
  proof.passed =
    !proof.error &&
    !proof.stopError &&
    !proof.closeError &&
    !proof.syncError &&
    !proof.preservationError &&
    proof.cases.length === proof.expectedCaseCount &&
    proof.priorHostFilesUnchanged &&
    (!reuse || proof.priorGuestUnchanged) &&
    proof.sourcesUnchanged &&
    proof.vmStopped &&
    proof.liveCount === 0;
  const proofPath = join(attempt, 'project-directory-migration-evidence.json');
  await writeFile(proofPath, JSON.stringify(proof, null, 2), { flag: 'wx' });
  console.log(
    JSON.stringify({
      fixture: root,
      proof: proofPath,
      passed: proof.passed,
      cases: proof.cases.length,
      vmStopped: proof.vmStopped,
    }),
  );
  if (!proof.passed) process.exitCode = 1;
}
