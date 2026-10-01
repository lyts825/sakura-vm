import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.argv.length, 4, 'Use node --no-addons --import tsx scripts/smoke-project-uid-migration-overlap.ts alpine|debian|ubuntu <stopped-owned-scope-fixture>.');
assert.ok(process.execArgv.includes('--no-addons'), 'Record the actual --no-addons client condition.');
const distro = process.argv[2];
assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro));
const workspace = await realpath(resolve('.'));
assert.match(workspace, /^[dD]:\\/);
const parent = await realpath(join(workspace, '.data', 'network-remaining-test-temp'));
const root = await realpath(resolve(process.argv[3]));
assert.equal(dirname(root), parent);
assert.match(basename(root), /^sakura-guest-task-[A-Za-z0-9_-]+$/);
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const oldSummaryFile = join(parent, 'project-uid-scopes-final-summary.json');
const oldSummaryBytes = await readFile(oldSummaryFile), oldSummary = JSON.parse(oldSummaryBytes.toString());
assert.equal(oldSummary.status, 'passed');
assert.equal(oldSummary.casesTotal, 54);
const oldFiles: { file: string; sha256: string }[] = [{ file: oldSummaryFile, sha256: digest(oldSummaryBytes) }];
for (const entry of oldSummary.proofs) {
  const file = await realpath(entry.file), bytes = await readFile(file);
  assert.equal(dirname(dirname(file)), parent);
  assert.equal(digest(bytes), entry.fileSha256);
  const evidence = JSON.parse(bytes.toString());
  assert.equal(evidence.cases.length, 18);
  assert.equal(evidence.vmStopped, true);
  assert.equal(evidence.liveEntries, 0);
  assert.equal(evidence.error, undefined);
  assert.equal(evidence.sourceSha256['server/project-directory-migration.ts'], '778d598ec30b8f70c4f9b24800a2fe36ff11ac36431b3de99a338fedb3e4f09d');
  oldFiles.push({ file, sha256: digest(bytes) });
}
const prior = oldSummary.proofs.find((value: { distro: string }) => value.distro === distro);
assert.ok(prior);
assert.equal(dirname(await realpath(prior.file)), root);
const owned = JSON.parse(await readFile(join(root, 'guest-task-cgroup-evidence.json'), 'utf8'));
assert.equal(owned.vmId, prior.vmId);
assert.equal(owned.distro, distro);
assert.equal(owned.vmStopped, true);
assert.equal(owned.error, undefined);
const records = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
assert.equal(records.length, 1);
assert.equal(records[0].id, owned.vmId);
assert.equal(records[0].distro, distro);
assert.equal(records[0].name, 'guest-task-cgroup-smoke');
assert.equal(records[0].bootstrapped, true);
for (const name of ['sandbox', 'storagePoolId', 'haPromotion', 'haRetirement', 'lastError']) assert.equal(records[0][name], undefined);
const machineDirectory = await realpath(join(root, 'machines', owned.vmId));
assert.equal(dirname(machineDirectory), await realpath(join(root, 'machines')));
assert.equal(dirname(await realpath(join(machineDirectory, 'disk.qcow2'))), machineDirectory);
const exactQemu = () => {
  const ps = "$r='" + root.replaceAll("'", "''") + "';$v='" + owned.vmId + "';@(" +
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(sakura-qemu|qemu-system[^.]*)\\.exe$' -and $_.CommandLine -and $_.CommandLine.Contains($r) -and $_.CommandLine.Contains($v) }).Count";
  return Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }).trim());
};
assert.equal(exactQemu(), 0, 'An existing owned QEMU process must not be reused.');
process.env.TEMP = process.env.TMP = parent;
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = join(workspace, '.data', 'images');
process.env.SAKURA_IMAGE_PATH = join(workspace, '.data', 'images', { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' }[distro]!);
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces, projectSchema } = await import('../server/workspaces.ts');
const { ProjectIdentities } = await import('../server/project-identity.ts');
const { ProjectRunScopes, projectIdentityTask } = await import('../server/project-run-scope.ts');
const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
const { quote } = await import('../server/files.ts');
const sources = ['server/project-main.ts', 'server/project-services.ts', 'server/project-service-scope.ts',
  'server/workspaces.ts', 'server/project-run-scope.ts', 'server/guest-task.ts', 'server/project-identity.ts',
  'server/project-directory-migration.ts', 'server/project-terminals.ts', 'server/jobs.ts',
  'native/project-identity/controller.py', 'native/project-identity/launcher.c', 'native/project-identity/protocol.h'];
const invocation = randomUUID(), scriptFile = join(workspace, 'scripts', 'smoke-project-uid-migration-overlap.ts');
const proofFile = join(root, 'project-uid-migration-overlap-evidence-' + invocation + '.json');
const qemuExecutions: { startedAt: string; endedAt?: string; settled: boolean; argvSha256: string }[] = [];
const proof: any = { version: 1, fixture: root, vmId: owned.vmId, distro, invocation,
  scope: 'New helper positive migration and exact physical-preflight rejection for owned nested bind aliases; old nested-bind acceptance is not claimed.',
  client: { node: process.version, execArgv: process.execArgv, pid: process.pid },
  startedAt: new Date().toISOString(), cases: [], sourceSha256: {}, qemuExecutions,
  previousEvidence: { role: '54-case success with its original migration dependency 778d; not relabelled for this helper', files: oldFiles },
  scriptSha256: digest(await readFile(scriptFile)) };
for (const source of sources) proof.sourceSha256[source] = digest(await readFile(join(workspace, source)));
assert.equal(proof.sourceSha256['server/project-directory-migration.ts'], 'e3ed3c6041923ad9344e7aea0c7b357045a87d17cb02b42ddf4f4dbed9e41f35');
for (const source of sources.slice(0, 4)) assert.equal(proof.sourceSha256[source], prior.sourceSha256[source]);
proof.packagedIdentity = JSON.parse(await readFile(join(workspace, '.sakura-server', 'assets', 'project-identity', 'manifest.json'), 'utf8'));
assert.equal(proof.packagedIdentity.build, '94bc2a7fb050ac8a72cce5fcf56997c6c44ba4a8473cd543cff6d36ff407b905');
await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
const runtime = await createRuntime(), nativeRun = runtime.run.bind(runtime);
runtime.run = (async (...args: Parameters<typeof nativeRun>) => {
  if (args[0] !== 'sakura-qemu' || !args[1].some(value => value.includes(root))) return nativeRun(...args);
  const execution = { startedAt: new Date().toISOString(), settled: false, argvSha256: digest(JSON.stringify(args[1])) };
  qemuExecutions.push(execution);
  try { return await nativeRun(...args); }
  finally { execution.settled = true; Object.assign(execution, { endedAt: new Date().toISOString() }); }
}) as typeof runtime.run;
const machines = new Machines(runtime);
await machines.init();
assert.equal(machines.records.size, 1);
assert.equal(machines.state(owned.vmId), 'stopped');
assert.equal(machines.live.size, 0);
const spaces = new Workspaces(machines), scopes = new ProjectRunScopes(machines), core = new ProjectIdentities(machines);
const migration = new ProjectDirectoryMigrations(machines, spaces);
const nativeExec = machines.exec.bind(machines);
const fixed = 'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C ';
const py = (source: string) => fixed + '/usr/bin/python3 -I -S -c ' + quote(source);
const run = async (command: string, timeout = 30000) => {
  const result = await nativeExec(owned.vmId, command, timeout);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  return result.stdout.trim();
};
const inspect = async (path: string) => JSON.parse(await run(py(
  'import hashlib,json,os,stat\np=' + JSON.stringify(path) + '\nf=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC);i=os.fstat(f)\n' +
  "mount=next(x.split()[1] for x in open('/proc/self/fdinfo/'+str(f)) if x.startswith('mnt_id:'))\n" +
  "value={'device':str(i.st_dev),'inode':str(i.st_ino),'filesystemId':str(os.fstatvfs(f).f_fsid & ((1<<64)-1)),'mountId':mount,'uid':i.st_uid,'gid':i.st_gid,'mode':stat.S_IMODE(i.st_mode),'kind':'directory' if stat.S_ISDIR(i.st_mode) else 'file'}\n" +
  "if stat.S_ISREG(i.st_mode):value['sha256']=hashlib.sha256(os.read(f,8192)).hexdigest();value['size']=i.st_size\n" +
  'os.close(f);print(json.dumps(value))'
)));
const sameObject = (a: any, b: any) => {
  for (const key of ['device', 'inode', 'filesystemId']) assert.equal(a[key], b[key], key);
};
const existingIdentities: Record<string, unknown> = {};
const checkOriginalIdentities = async () => {
  for (const [id, value] of Object.entries(existingIdentities)) assert.deepEqual(await core.inspect(owned.vmId, id), value, 'Existing identity changed: ' + id);
};
const check = async (name: string, action: () => Promise<unknown>) => {
  const startedAt = new Date().toISOString(), evidence = await action();
  proof.cases.push({ name, startedAt, finishedAt: new Date().toISOString(), evidence });
  await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
  console.log('PASS ' + distro + ' ' + name);
};
const originalCatalog = await spaces.projects.list(owned.vmId);
assert.ok(originalCatalog.projects.length <= 18, 'Two new owned catalog entries require space.');
const originalConfigs: { file: string; sha256: string }[] = [];
for (const project of originalCatalog.projects) {
  const file = spaces.projects.inScope(owned.vmId, project.id, () => spaces.projects.file(owned.vmId));
  try { originalConfigs.push({ file, sha256: digest(await readFile(file)) }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
let alphaId: string | undefined, alphaConfig: any, originalAlphaIdentity: any, nativeBetaId: string | undefined;
let mount: any;
const positive = '/workspace/sakura-owned-migration-positive-' + invocation;
const origin = '/srv/projects/sakura-owned-migration-' + invocation;
const alias = '/opt/projects/sakura-owned-migration-' + invocation;
const makeCatalog = async (name: string, directory: string) => {
  const index = await spaces.projects.create(owned.vmId, name + ' ' + invocation.slice(0, 8), async () => {
    await spaces.save(owned.vmId, { directory, networkIsolation: 'host' });
  });
  return index.active;
};
const inAlpha = async <T>(action: () => Promise<T>) => spaces.projects.inScope(owned.vmId, alphaId!, action);
const restoreAlpha = async () => { if (alphaId && alphaConfig) await inAlpha(async () => { await spaces.save(owned.vmId, alphaConfig); }); };
try {
  await machines.start(owned.vmId);
  const deadline = Date.now() + 270000;
  while (machines.state(owned.vmId) !== 'running') {
    assert.equal(machines.state(owned.vmId), 'starting');
    assert.ok(Date.now() < deadline, machines.logs.get(owned.vmId));
    await delay(300);
  }
  proof.bootId = await run(fixed + '/bin/cat /proc/sys/kernel/random/boot_id');
  if (distro === 'alpine') await run(fixed + '/sbin/rc-service cgroups start');
  const installed = await core.install(owned.vmId);
  assert.equal(installed, proof.packagedIdentity.build);
  const ids = JSON.parse(await run(py(
    "import json,os,stat\np='/var/lib/sakura/project-identities/registry.json'\nf=os.open(p,os.O_RDONLY|os.O_NOFOLLOW);i=os.fstat(f);assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and i.st_nlink==1 and stat.S_IMODE(i.st_mode)==0o600\nb=os.read(f,1048577);os.close(f);assert len(b)<=1048576\nv=json.loads(b);assert v['version']==1\nprint(json.dumps(sorted(x['projectId'] for x in v['reserved'].values())))"
  )));
  for (const id of ids) existingIdentities[id] = await core.inspect(owned.vmId, id);
  proof.originalIdentities = existingIdentities;
  await run(py(
    'import os,stat\nfor p in ("/","/workspace","/srv","/opt"):\n i=os.lstat(p);assert stat.S_ISDIR(i.st_mode) and i.st_uid==0 and not i.st_mode&0o022\n' +
    'for p in ("/srv/projects","/opt/projects"):\n' +
    ' if not os.path.lexists(p):os.mkdir(p,0o755)\n' +
    ' i=os.lstat(p);assert stat.S_ISDIR(i.st_mode) and i.st_uid==0 and not i.st_mode&0o022 and i.st_mode&0o001\n' +
    'for p in ' + JSON.stringify([positive, origin, alias]) + ':\n assert not os.path.lexists(p)\n os.mkdir(p,0o700 if p==' + JSON.stringify(positive) + ' else 0o755)\n' +
    'f=os.open(' + JSON.stringify(positive + '/marker.txt') + ',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)\nos.write(f,' +
    JSON.stringify('owned-positive-marker-' + invocation) + '.encode());os.close(f)'
  ));
  alphaId = await makeCatalog('Owned physical migration Alpha', positive);
  alphaConfig = await inAlpha(() => spaces.config(owned.vmId));
  await check('reviewed-new-helper-migration-and-project-uid-task', async () => {
    const before = { directory: await inspect(positive), marker: await inspect(positive + '/marker.txt') };
    assert.equal(before.directory.uid, 0); assert.equal(before.directory.mode, 0o700);
    const preview = await inAlpha(() => migration.preview(owned.vmId)); assert.ok(preview.plan);
    assert.equal(preview.plan.state, 'preview');
    assert.deepEqual(preview.plan.proposal.entries.map(value => value.path), ['.', 'marker.txt']);
    assert.deepEqual(await inspect(positive), before.directory);
    assert.deepEqual(await inspect(positive + '/marker.txt'), before.marker);
    const applied = await inAlpha(() => migration.apply(owned.vmId, { action: 'apply', version: 1, reviewed: true,
      planId: preview.plan!.proposal.planId, sha256: preview.plan!.sha256 }));
    assert.equal(applied.plan?.state, 'applied');
    originalAlphaIdentity = await scopes.identity(owned.vmId, alphaConfig);
    const after = { directory: await inspect(positive), marker: await inspect(positive + '/marker.txt') };
    sameObject(before.directory, after.directory); sameObject(before.marker, after.marker);
    assert.equal(after.directory.uid, originalAlphaIdentity.uid); assert.equal(after.directory.mode, 0o700);
    assert.equal(after.marker.uid, originalAlphaIdentity.uid); assert.equal(after.marker.mode, 0o600);
    assert.equal(after.marker.sha256, before.marker.sha256);
    const result = await projectIdentityTask(machines, owned.vmId, alphaConfig, { command: '/usr/bin/python3 -I -S -c ' + quote(
      "import hashlib,json,os\nprint(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'home':os.environ.get('HOME'),'cwd':os.getcwd(),'sha256':hashlib.sha256(open('marker.txt','rb').read()).hexdigest()}))"
    ), environment: {} }, new AbortController().signal, undefined, 60000);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.uid, originalAlphaIdentity.uid); assert.equal(value.gid, originalAlphaIdentity.gid);
    assert.equal(value.home, originalAlphaIdentity.home); assert.equal(value.cwd, positive);
    assert.equal(value.sha256, before.marker.sha256);
    await scopes.guard(owned.vmId, alphaId!);
    const journal = JSON.parse(await readFile(join(machineDirectory, 'project-identities', alphaId! + '.json'), 'utf8'));
    assert.equal(journal.runs.length, 1); assert.equal(journal.runs[0].phase, 'closed');
    assert.equal(journal.runs[0].run.phase, 'closed');
    await checkOriginalIdentities();
    return { before, after, planId: preview.plan.proposal.planId, sha256: preview.plan.sha256,
      identity: originalAlphaIdentity, projectResult: value, ticketClosed: true };
  });
  await run(py(
    'import os,stat\nfor name in ("saved","native"):\n p=' + JSON.stringify(origin) + '+"/"+name\n os.mkdir(p,0o700)\n' +
    ' f=os.open(p+"/marker.txt",os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.write(f,("owned-"+name+' +
    JSON.stringify('-' + invocation) + ').encode());os.close(f)'
  ));
  const placeholder = await inspect(alias), source = await inspect(origin);
  await run(fixed + '/bin/mount --bind ' + quote(origin) + ' ' + quote(alias));
  mount = { source: origin, target: alias, bootId: proof.bootId, sourceInfo: source, placeholder, current: await inspect(alias) };
  sameObject(mount.current, source); assert.notEqual(mount.current.mountId, placeholder.mountId);
  proof.mount = mount;
  const negative = async (name: 'saved' | 'native', betaId?: string) => {
    const sourcePath = origin + '/' + name, target = alias + '/' + name;
    const before = { directory: await inspect(sourcePath), marker: await inspect(sourcePath + '/marker.txt') };
    const aliasInfo = await inspect(target); sameObject(aliasInfo, before.directory);
    assert.notEqual(aliasInfo.mountId, before.directory.mountId);
    const betaIdentity = betaId ? await core.inspect(owned.vmId, betaId) : null;
    await inAlpha(async () => { await spaces.save(owned.vmId, { ...alphaConfig, directory: target }); });
    let refusal: string | undefined, accepted = false;
    try { await inAlpha(() => migration.preview(owned.vmId)); accepted = true; }
    catch (error) { refusal = (error as { code?: string }).code; if (!refusal) throw error; }
    assert.equal(accepted, false);
    assert.equal(refusal, 'PROJECT_DIRECTORY_PHYSICAL_OVERLAP');
    assert.deepEqual(await inspect(sourcePath), before.directory);
    assert.deepEqual(await inspect(sourcePath + '/marker.txt'), before.marker);
    assert.deepEqual(await core.inspect(owned.vmId, alphaId!), originalAlphaIdentity);
    if (betaId) assert.deepEqual(await core.inspect(owned.vmId, betaId), betaIdentity);
    await restoreAlpha();
    await scopes.guard(owned.vmId, alphaId!);
    await checkOriginalIdentities();
    return { sourcePath, target, before, alias: aliasInfo, refusal, applyCalled: false,
      betaIdentity, alphaIdentityUnchanged: true, betaUnchanged: true,
      claim: 'Exercises the new preflight before original CROSS_MOUNT policy; does not claim this nested alias was accepted by the old helper.' };
  };
  const savedBetaId = await makeCatalog('Owned physical saved Beta', origin + '/saved');
  assert.equal(await core.inspect(owned.vmId, savedBetaId), null);
  await check('saved-only-directory-physical-alias-refused-before-mutation', () => negative('saved'));
  nativeBetaId = randomBytes(8).toString('hex');
  const nativeBeta = { ...projectSchema.parse({ directory: origin + '/native', networkIsolation: 'host' }), _workspace: nativeBetaId };
  const nativeIdentity = await scopes.reserve(owned.vmId, nativeBeta);
  assert.equal(nativeIdentity.phase, 'intent');
  assert.equal((await spaces.projects.list(owned.vmId)).projects.some(value => value.id === nativeBetaId), false);
  await check('native-only-intent-directory-physical-alias-refused-before-mutation', () => negative('native', nativeBetaId));
  for (const projectId of [alphaId, nativeBetaId]) await scopes.guard(owned.vmId, projectId);
  proof.allTestTicketsClosed = true;
  await checkOriginalIdentities();
  proof.originalIdentitiesUnchanged = true;
} catch (error) {
  proof.error = error instanceof Error ? error.stack || error.message : String(error);
  console.error(proof.error);
} finally {
  proof.cleanupErrors = [];
  if (machines.live.has(owned.vmId)) {
    try { await restoreAlpha(); } catch (error) { proof.cleanupErrors.push('Alpha config restore: ' + String(error)); }
    if (mount) {
      try {
        assert.equal(await run(fixed + '/bin/cat /proc/sys/kernel/random/boot_id'), mount.bootId);
        const current = await inspect(mount.target);
        assert.deepEqual(current, mount.current);
        sameObject(await inspect(mount.source), mount.sourceInfo);
        const mountLine = await run(py('import json\np=' + JSON.stringify(mount.target) +
          "\nlines=[x.split() for x in open('/proc/self/mountinfo') if x.split()[4]==p];assert len(lines)==1;print(json.dumps(lines[0][:6]))"));
        assert.equal(JSON.parse(mountLine)[0], mount.current.mountId);
        await run(fixed + '/bin/umount ' + quote(mount.target));
        assert.deepEqual(await inspect(mount.target), mount.placeholder);
        proof.ownedBindUnmounted = true;
      } catch (error) { proof.cleanupErrors.push('Owned bind cleanup: ' + String(error)); }
    }
    try {
      await spaces.projects.update(owned.vmId, originalCatalog.active);
      proof.originalSelectionRestored = true;
      for (const entry of originalConfigs) assert.equal(digest(await readFile(entry.file)), entry.sha256);
      proof.originalProjectConfigurationsUnchanged = true;
    } catch (error) { proof.cleanupErrors.push('Original configuration check: ' + String(error)); }
  }
  try { await spaces.close(); } catch (error) { proof.cleanupErrors.push('Workspaces close: ' + String(error)); }
  try { await machines.close(); } catch (error) { proof.cleanupErrors.push('Machines close: ' + String(error)); }
  proof.vmStopped = machines.state(owned.vmId) === 'stopped';
  proof.liveEntries = machines.live.size;
  proof.ownedQemuSettled = qemuExecutions.every(value => value.settled);
  proof.exactQemuMatches = exactQemu();
  proof.stoppedAt = new Date().toISOString();
  proof.finalSourceSha256 = {};
  for (const source of sources) {
    const sha = digest(await readFile(join(workspace, source))); proof.finalSourceSha256[source] = sha;
    if (sha !== proof.sourceSha256[source]) proof.cleanupErrors.push('Source changed: ' + source);
  }
  proof.finalScriptSha256 = digest(await readFile(scriptFile));
  if (proof.finalScriptSha256 !== proof.scriptSha256) proof.cleanupErrors.push('Smoke source changed during execution.');
  for (const entry of oldFiles) if (digest(await readFile(entry.file)) !== entry.sha256) proof.cleanupErrors.push('Old proof changed: ' + entry.file);
  if (!proof.vmStopped || proof.liveEntries || !proof.ownedQemuSettled || proof.exactQemuMatches) proof.cleanupErrors.push('Owned process cleanup did not settle.');
  if (!proof.ownedBindUnmounted) proof.cleanupErrors.push('Owned bind cleanup was not confirmed.');
  proof.passed = !proof.error && !proof.cleanupErrors.length && proof.cases.length === 3;
  await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
  console.log('Migration overlap proof: ' + proofFile);
}
if (!proof.passed) throw new Error('Migration overlap proof failed; retained original evidence at ' + proofFile);
