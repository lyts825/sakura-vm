import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const distro = process.argv[2] || 'alpine';
const images: Record<string, string> = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' };
assert.ok(images[distro], 'unsupported smoke distro');
const ownedParent = resolve('.data/project-identity-test-temp');
await mkdir(ownedParent, { recursive: true });
process.env.TEMP = ownedParent; process.env.TMP = ownedParent;
const directory = process.argv[3] ? await realpath(resolve(process.argv[3])) :
  await mkdtemp(join(ownedParent, 'sakura-project-identity-'));
assert.equal(dirname(directory), await realpath(ownedParent));
assert.match(basename(directory), /^sakura-project-identity-/);
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images', images[distro]);
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { ProjectIdentities, projectIdentitySources } = await import('../server/project-identity.ts');
const { quote } = await import('../server/files.ts');
// The smoke has an explicit development source directory. Its owned snapshot
// survives an unrelated production build replacing .sakura-server; production
// API operation continues to require the packaged manifest without a fallback.
const sourceDirectory = join(directory, 'source-bundle');
await mkdir(sourceDirectory, { recursive: true });
const aggregate = createHash('sha256'), sourceFiles = [];
for (const name of ['protocol.h', 'launcher.c', 'controller.py']) {
  const bytes = await readFile(resolve('native/project-identity', name));
  aggregate.update(name).update(bytes); sourceFiles.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  await writeFile(join(sourceDirectory, name), bytes);
}
await writeFile(join(sourceDirectory, 'manifest.json'), JSON.stringify({ version: 1, build: aggregate.digest('hex'), files: sourceFiles }));
const source = await projectIdentitySources(sourceDirectory);
let machines: InstanceType<typeof Machines> | undefined, vmId = '';
const checks: string[] = [];
let passed = false, failure = '', bootId = '', secondBootId = '';
const projectRoot = '/srv/sakura-identity-fixture';
const betaId = '1111111111111111';
console.log(JSON.stringify({ fixture: directory, distro, build: source.manifest.build }));
async function check(name: string, work: () => Promise<void>) {
  await work(); checks.push(name); console.log('PASS ' + name);
}
async function guest(command: string, timeout = 30000) {
  const result = await machines!.exec(vmId, command, timeout);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
async function python(script: string, timeout = 30000) {
  return await guest(`env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S - <<'SAKURA_IDENTITY_FIXTURE'\n${script}\nSAKURA_IDENTITY_FIXTURE`, timeout);
}
async function ready() {
  const deadline = Date.now() + 300000;
  while (machines!.state(vmId) === 'starting' && Date.now() < deadline) await delay(200);
  const state = machines!.state(vmId);
  if (state !== 'running') await writeFile(join(directory, 'boot-failure.log'), machines!.logs.get(vmId) || '');
  assert.equal(state, 'running', (await machines!.view(vmId)).lastError || 'owned VM did not become ready');
}
try {
  machines = new Machines(await createRuntime());
  await machines.init();
  const records = await machines.list();
  if (process.argv[3]) {
    assert.equal(records.length, 1, 'owned fixture must contain exactly its one VM');
    const record = records[0];
    assert.equal(record.name, 'project-identity-' + distro); assert.equal(record.distro, distro);
    assert.equal(machines.state(record.id), 'stopped'); vmId = record.id;
    try {
      const evidence = JSON.parse(await readFile(join(directory, 'project-identity-evidence.json'), 'utf8'));
      assert.equal(evidence.vmId, vmId); assert.equal(evidence.distro, distro);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  } else {
    assert.equal(records.length, 0);
    vmId = (await machines.create({ name: 'project-identity-' + distro, distro,
      memoryMiB: distro === 'alpine' ? 768 : 1024, cpus: 2, diskGiB: 8, accelerator: 'auto', forwards: [] })).id;
  }
  console.log(JSON.stringify({ fixture: directory, vmId, distro }));
  await machines.start(vmId); await ready();
  await guest('/bin/sync');
  const identities = new ProjectIdentities(machines, { sourceDirectory });
  await check('verified root installation and clean package environment', async () => {
    assert.equal(await identities.install(vmId), source.manifest.build);
    // Recover only zero-byte remnants of this owned fixture's interrupted
    // development installs. Production installation never sweeps old paths.
    await python(`import os,stat,re\nfor n in os.listdir('/tmp'):\n if not re.fullmatch(r'\.sakura-project-identity-[a-f0-9-]{36}',n): continue\n p='/tmp/'+n; i=os.lstat(p); assert stat.S_ISDIR(i.st_mode) and i.st_uid==0 and stat.S_IMODE(i.st_mode)==0o700\n entries=os.listdir(p); assert set(entries).issubset({'controller.py','protocol.h','launcher.c','manifest.json'})\n for f in entries:\n  i=os.lstat(p+'/'+f); assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and i.st_size==0\n  os.unlink(p+'/'+f)\n d=os.open(p,os.O_DIRECTORY); os.fsync(d); os.close(d); os.rmdir(p)\nd=os.open('/tmp',os.O_DIRECTORY); os.fsync(d); os.close(d)`);
    const info = JSON.parse(await python(`import json,os,stat\np=${JSON.stringify(source.directory + '/launch')}\ni=os.lstat(p)\nprint(json.dumps({'uid':i.st_uid,'mode':stat.S_IMODE(i.st_mode),'stages':[n for n in os.listdir('/tmp') if n.startswith('.sakura-project-identity-')]}))`));
    assert.equal(info.uid, 0); assert.equal(info.mode, 0o4755);
    assert.deepEqual(info.stages, []);
  });
  // Reset only explicitly owned fixture directories after a previous failed
  // attempt. New evidence uses persistent identities rather than deleting them.
  await python(`import os,stat\nroot=${JSON.stringify(projectRoot)}\ntry: os.mkdir(root,0o755)\nexcept FileExistsError: pass\ni=os.lstat(root)\nassert stat.S_ISDIR(i.st_mode) and i.st_uid==0\nfor n in ['alpha','beta']:\n try: os.mkdir(root+'/'+n,0o700)\n except FileExistsError: pass`);
  await guest('if ! ip netns exec sk-default true >/dev/null 2>&1; then ip netns add sk-default; fi; ip -n sk-default link set lo up');
  let alpha = await identities.inspect(vmId, 'default');
  await check('account intent blocks launch and preserves directory permissions', async () => {
    if (!alpha) {
      await assert.rejects(identities.ensure(vmId, { projectId: 'default', directory: projectRoot + '/alpha', networkIsolation: 'private' }), /DIRECTORY_MIGRATION_REQUIRED/);
      alpha = await identities.inspect(vmId, 'default');
      assert.equal(alpha!.phase, 'intent');
      const info = JSON.parse(await python(`import json,os,stat\np=${JSON.stringify(projectRoot + '/alpha')}\ni=os.lstat(p)\nprint(json.dumps([i.st_uid,stat.S_IMODE(i.st_mode)]))`));
      assert.deepEqual(info, [0, 0o700]);
      await assert.rejects(identities.prepare(vmId, alpha!), /IDENTITY_INCOMPLETE/);
      await python(`import os\np=${JSON.stringify(projectRoot + '/alpha')}\nos.chown(p,${alpha!.uid},${alpha!.gid})\nos.chmod(p,0o700)`);
    } else if (alpha.phase === 'intent') {
      await python(`import os\np=${JSON.stringify(projectRoot + '/alpha')}\ni=os.stat(p); assert i.st_uid in [0,${alpha.uid}]\nos.chown(p,${alpha.uid},${alpha.gid}); os.chmod(p,0o700)`);
    }
    const prior = alpha!;
    alpha = await identities.ensure(vmId, { projectId: 'default', directory: prior.directory, networkIsolation: 'private' });
    assert.equal(alpha.identityId, prior.identityId); assert.equal(alpha.uid, prior.uid);
    assert.equal(alpha.phase, 'active');
  });
  let beta = await identities.inspect(vmId, betaId);
  if (!beta) {
    await assert.rejects(identities.ensure(vmId, { projectId: betaId, directory: projectRoot + '/beta', networkIsolation: 'host' }), /DIRECTORY_MIGRATION_REQUIRED/);
    beta = await identities.inspect(vmId, betaId);
    await python(`import os\np=${JSON.stringify(projectRoot + '/beta')}\nos.chown(p,${beta!.uid},${beta!.gid})\nos.chmod(p,0o700)`);
  } else if (beta.phase === 'intent') {
    await python(`import os\np=${JSON.stringify(projectRoot + '/beta')}\ni=os.stat(p); assert i.st_uid in [0,${beta.uid}]\nos.chown(p,${beta.uid},${beta.gid}); os.chmod(p,0o700)`);
  }
  beta = await identities.ensure(vmId, { projectId: betaId, directory: beta!.directory, networkIsolation: 'host' });
  await check('ACK retries reuse complete UUID UID GID and distinct home', async () => {
    const retry = await identities.ensure(vmId, { projectId: 'default', directory: alpha!.directory, networkIsolation: 'private' });
    assert.deepEqual(retry, alpha); assert.notEqual(alpha!.uid, beta!.uid); assert.notEqual(alpha!.home, beta!.home);
    await assert.rejects(identities.ensure(vmId, { projectId: 'default', directory: alpha!.directory, networkIsolation: 'private' },
      { registryId: alpha!.registryId, identityId: randomUUID(), revision: alpha!.revision }), /IDENTITY_STALE/);
  });
  await check('TERM and KILL during reserved account creation preserve identity and never activate partial UID', async () => {
    const helper = projectRoot + '/fixture.py';
    await machines!.writeGuestFile(vmId, helper, await readFile(resolve('native/project-identity/fixture.py'), 'utf8'));
    for (const signum of [15, 9]) {
      const id = randomUUID().replaceAll('-', '').slice(0, 16);
      const result = JSON.parse(await guest(`env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S ${quote(helper)} ${source.manifest.build} ${id} ${signum}`, 30000));
      const pending = result.identity;
      assert.equal(pending.phase, 'intent');
      assert.equal(result.signal, signum);
      if (signum === 15) assert.equal(result.toolStoppedByController, true);
      const refused = await machines!.exec(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C ${quote(source.directory + '/launch')} --project ${id} ${pending.identityId} ${pending.revision} ${randomUUID()} -- /bin/true`);
      assert.equal(refused.code, 126); assert.match(refused.stderr, /BINDING_INVALID/);
      await assert.rejects(identities.ensure(vmId, { projectId: id, directory: pending.directory, networkIsolation: 'host' }), /DIRECTORY_MIGRATION_REQUIRED/);
      const retry = await identities.inspect(vmId, id);
      assert.equal(retry!.uid, pending.uid); assert.equal(retry!.identityId, pending.identityId);
      await python(`import os\np=${JSON.stringify(pending.directory)}\nos.chown(p,${pending.uid},${pending.gid}); os.chmod(p,0o700)`);
      const complete = await identities.ensure(vmId, { projectId: id, directory: pending.directory, networkIsolation: 'host' });
      assert.equal(complete.uid, pending.uid); assert.equal(complete.identityId, pending.identityId);
    }
  });
  await check('ancestor traversal is required and an inode replacement requires explicit migration', async () => {
    const id = randomUUID().replaceAll('-', '').slice(0, 16), parent = projectRoot + '/ancestor-' + id, path = parent + '/project';
    await python(`import os\nos.mkdir(${JSON.stringify(parent)},0o700); os.mkdir(${JSON.stringify(path)},0o700)`);
    await assert.rejects(identities.ensure(vmId, { projectId: id, directory: path, networkIsolation: 'host' }), /DIRECTORY_MIGRATION_REQUIRED/);
    const pending = (await identities.inspect(vmId, id))!;
    await python(`import os\nos.chown(${JSON.stringify(path)},${pending.uid},${pending.gid})`);
    await assert.rejects(identities.ensure(vmId, { projectId: id, directory: path, networkIsolation: 'host' }), /DIRECTORY_MIGRATION_REQUIRED/);
    assert.equal(await python(`import os\nprint(oct(os.stat(${JSON.stringify(parent)}).st_mode&0o777))`), '0o700');
    await python(`import os\nos.chmod(${JSON.stringify(parent)},0o711)`);
    const complete = await identities.ensure(vmId, { projectId: id, directory: path, networkIsolation: 'host' });
    assert.equal(complete.uid, pending.uid); assert.equal(complete.identityId, pending.identityId);
  });
  const identityInfo = `import os,json\nstatus={}\nfor line in open('/proc/self/status'):\n key,_,value=line.partition(':')\n if key in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb','NoNewPrivs']: status[key]=value.strip()\nprint(json.dumps({'uid':os.getresuid(),'gid':os.getresgid(),'groups':os.getgroups(),'cwd':os.getcwd(),'home':os.environ.get('HOME'),'net':os.readlink('/proc/self/ns/net'),'cgroup':open('/proc/self/cgroup').read().strip(),'status':status,'marker':os.environ.get('IDENTITY_MARKER')}))`;
  let first = await identities.prepare(vmId, alpha!);
  bootId = first.bootId;
  await check('private UID caps supplementary groups namespace cwd and environment', async () => {
    const result = await identities.exec(vmId, alpha!, first, { command: '/usr/bin/python3 -c ' + quote(identityInfo),
      environment: { IDENTITY_MARKER: '$(touch /tmp/sakura-identity-root-escape)' } });
    assert.equal(result.code, 0, result.stderr);
    const info = JSON.parse(result.stdout);
    assert.deepEqual(info.uid, [alpha!.uid, alpha!.uid, alpha!.uid]);
    assert.deepEqual(info.gid, [alpha!.gid, alpha!.gid, alpha!.gid]); assert.deepEqual(info.groups, []);
    assert.equal(info.cwd, alpha!.directory); assert.equal(info.home, alpha!.home);
    assert.equal(info.net, 'net:[' + first.networkInode + ']');
    assert.equal(info.cgroup, '0::/' + first.cgroupName); assert.equal(info.status.NoNewPrivs, '1');
    for (const name of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.match(info.status[name], /^0+$/);
    assert.equal(info.marker, '$(touch /tmp/sakura-identity-root-escape)');
    await guest('test ! -e /tmp/sakura-identity-root-escape');
    assert.equal((await identities.status(vmId, alpha!, first)).populated, false);
    const stale = await machines!.exec(vmId, identities.command(alpha!, first, { command: 'touch should-not-exist' }));
    assert.equal(stale.code, 126); assert.match(stale.stderr, /RUN_CLOSED_OR_INVALID/);
  });
  await check('real UID mapped setuid entry and foreign UID ticket rejection', async () => {
    const run = await identities.prepare(vmId, alpha!);
    try {
      const reply = await python(`import os,subprocess,json\ndef drop():\n os.setgroups([]); os.setgid(${alpha!.gid}); os.setuid(${alpha!.uid})\np=subprocess.run(['/bin/sh','-c',${JSON.stringify(identities.selfCommand(run, { command: '/usr/bin/python3 -c ' + quote(identityInfo) }))}],preexec_fn=drop,text=True,capture_output=True)\nprint(json.dumps({'code':p.returncode,'stdout':p.stdout,'stderr':p.stderr}))`);
      const result = JSON.parse(reply); assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).uid[0], alpha!.uid);
      const foreign = await python(`import os,subprocess,json\ndef drop():\n os.setgroups([]); os.setgid(${beta!.gid}); os.setuid(${beta!.uid})\np=subprocess.run(['/bin/sh','-c',${JSON.stringify(identities.selfCommand(run, { command: 'touch wrong-project' }))}],preexec_fn=drop,text=True,capture_output=True)\nprint(json.dumps({'code':p.returncode,'stderr':p.stderr}))`);
      assert.equal(JSON.parse(foreign).code, 126); assert.match(JSON.parse(foreign).stderr, /RUN_IDENTITY/);
    } finally { await identities.stop(vmId, alpha!, run); }
  });
  await check('a replaced account home or supplementary group rejects without changing the neighbor', async () => {
    const run = await identities.prepare(vmId, alpha!);
    const neighbor = await identities.inspect(vmId, betaId);
    await guest(`/usr/sbin/usermod -d ${quote(beta!.home)} ${alpha!.account}`);
    try {
      const refused = await machines!.exec(vmId, identities.command(alpha!, run, { command: 'touch wrong-account' }));
      assert.equal(refused.code, 126); assert.match(refused.stderr, /ACCOUNT_REPLACED/);
      await assert.rejects(identities.inspect(vmId, 'default'), /ACCOUNT_REPLACED/);
      assert.deepEqual(await identities.inspect(vmId, betaId), neighbor);
    } finally { await guest(`/usr/sbin/usermod -d ${quote(alpha!.home)} ${alpha!.account}`); }
    await guest(`env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C gpasswd -a ${alpha!.account} ${beta!.account}`);
    try {
      const refused = await machines!.exec(vmId, identities.command(alpha!, run, { command: 'touch wrong-group' }));
      assert.equal(refused.code, 126); assert.match(refused.stderr, /SUPPLEMENTARY_GROUP_CHANGED/);
    } finally {
      await guest(`env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C gpasswd -d ${alpha!.account} ${beta!.account}`);
      await identities.stop(vmId, alpha!, run);
    }
    assert.deepEqual(await identities.inspect(vmId, betaId), neighbor);
  });
  await check('UID index absence cannot authorize an active binding', async () => {
    const path = '/var/lib/sakura/project-identities/uids/' + alpha!.uid + '.bin';
    const run = await identities.prepare(vmId, alpha!);
    await python(`import os\nos.rename(${JSON.stringify(path)},${JSON.stringify(path + '.fixture-backup')})`);
    try {
      const refused = await machines!.exec(vmId, identities.command(alpha!, run, { command: 'touch incomplete-index' }));
      assert.equal(refused.code, 126); assert.match(refused.stderr, /RECORD_ABSENT/);
      const recovered = await identities.ensure(vmId, { projectId: alpha!.projectId, directory: alpha!.directory, networkIsolation: alpha!.networkIsolation });
      assert.equal(recovered.uid, alpha!.uid); assert.equal(recovered.identityId, alpha!.identityId);
    } finally {
      await python(`import os\np=${JSON.stringify(path + '.fixture-backup')}\nif os.path.exists(p): os.unlink(p)`);
      await identities.stop(vmId, alpha!, run);
    }
  });
  await check('directory symlink and inode substitution reject before command', async () => {
    const run = await identities.prepare(vmId, alpha!);
    const path = alpha!.directory, old = path + '-original';
    await python(`import os\nos.rename(${JSON.stringify(path)},${JSON.stringify(old)})\nos.symlink(${JSON.stringify(old)},${JSON.stringify(path)})`);
    try {
      const refused = await machines!.exec(vmId, identities.command(alpha!, run, { command: 'touch replaced-directory' }));
      assert.equal(refused.code, 126); assert.match(refused.stderr, /DIRECTORY_MIGRATION_REQUIRED/);
      await python(`import os\np=${JSON.stringify(path)}\nos.unlink(p); os.mkdir(p,0o700); os.chown(p,${alpha!.uid},${alpha!.gid})`);
      const replacement = await machines!.exec(vmId, identities.command(alpha!, run, { command: 'touch replaced-directory' }));
      assert.equal(replacement.code, 126); assert.match(replacement.stderr, /DIRECTORY_REPLACED/);
    } finally {
      await python(`import os\np=${JSON.stringify(path)}\nif os.path.islink(p): os.unlink(p)\nelse: os.rmdir(p)\nos.rename(${JSON.stringify(old)},p)`);
      await identities.stop(vmId, alpha!, run);
    }
  });
  const detached = (file: string) => `import os,time\nif os.fork(): os._exit(0)\nos.setsid()\nif os.fork(): os._exit(0)\nopen(${JSON.stringify(file)},'w').write(str(os.getpid()))\nfor fd in [0,1,2]:\n try: os.close(fd)\n except OSError: pass\ntime.sleep(300)`;
  await check('independent cancellation contains detached descendants and preserves neighbor', async () => {
    const a = await identities.prepare(vmId, alpha!), b = await identities.prepare(vmId, beta!);
    try {
      assert.equal((await machines!.exec(vmId, identities.command(alpha!, a, { command: '/usr/bin/python3 -c ' + quote(detached(alpha!.directory + '/detached.pid')) }))).code, 0);
      assert.equal((await machines!.exec(vmId, identities.command(beta!, b, { command: '/usr/bin/python3 -c ' + quote(detached(beta!.directory + '/detached.pid')) }))).code, 0);
      await delay(200);
      assert.equal((await identities.status(vmId, alpha!, a)).populated, true);
      assert.equal((await identities.status(vmId, beta!, b)).populated, true);
      await identities.stop(vmId, alpha!, a);
      assert.equal((await identities.status(vmId, alpha!, a)).populated, false);
      assert.equal((await identities.status(vmId, beta!, b)).populated, true);
    } finally { await identities.stop(vmId, alpha!, a); await identities.stop(vmId, beta!, b); }
  });
  await check('replaced cgroup is rejected without killing its new occupant', async () => {
    const run = await identities.prepare(vmId, alpha!);
    const result = JSON.parse(await python(`import os,subprocess,json\np='/sys/fs/cgroup/'+${JSON.stringify(run.cgroupName)}\nos.rmdir(p); os.mkdir(p)\nfd=os.open(p,os.O_RDONLY|os.O_DIRECTORY); inode=os.fstat(fd).st_ino\ndef enter():\n with open(p+'/cgroup.procs','w') as f: f.write(str(os.getpid()))\nchild=subprocess.Popen(['/bin/sleep','300'],preexec_fn=enter,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,stdin=subprocess.DEVNULL)\nprint(json.dumps({'pid':child.pid,'inode':str(inode)})); os.close(fd)`));
    assert.notEqual(result.inode, run.cgroupInode);
    try {
      const refused = await machines!.exec(vmId, identities.command(alpha!, run, { command: 'touch wrong-cgroup' }));
      assert.equal(refused.code, 126); assert.match(refused.stderr, /CGROUP_REPLACED/);
      await assert.rejects(identities.stop(vmId, alpha!, run), /CGROUP_REPLACED/);
      await guest(`kill -0 ${result.pid}`);
    } finally {
      await python(`import os,time\np='/sys/fs/cgroup/'+${JSON.stringify(run.cgroupName)}\nassert str(os.stat(p).st_ino)==${JSON.stringify(result.inode)}\nwith open(p+'/cgroup.kill','w') as f: f.write('1')\nfor _ in range(250):\n try: os.rmdir(p); break\n except OSError: time.sleep(.02)\nelse: raise RuntimeError('owned replacement did not clear')`);
    }
  });
  await check('inherit-current preserves actual upper cgroup and upper stop contains descendants', async () => {
    const upper = 'sakura-task-' + randomUUID(), runId = randomUUID();
    const command = await identities.inheritedCommand(alpha!, { command: '/usr/bin/python3 -c ' + quote(detached(alpha!.directory + '/inherited.pid')) }, { runId });
    const info = JSON.parse(await python(`import os,subprocess,json,time\np='/sys/fs/cgroup/'+${JSON.stringify(upper)}\nos.mkdir(p)\ndef enter():\n with open(p+'/cgroup.procs','w') as f: f.write(str(os.getpid()))\nresult=subprocess.run(['/bin/sh','-c',${JSON.stringify(command)}],preexec_fn=enter,text=True,capture_output=True)\nassert result.returncode==0,result.stderr\nfor _ in range(100):\n try: pid=int(open(${JSON.stringify(alpha!.directory + '/inherited.pid')}).read()); break\n except (OSError,ValueError): time.sleep(.02)\nprint(json.dumps({'pid':pid,'cgroup':open('/proc/'+str(pid)+'/cgroup').read().strip()}))`));
    assert.equal(info.cgroup, '0::/' + upper);
    const receipt = await identities.run(vmId, alpha!, runId);
    assert.equal(receipt.mode, 'inherit-current'); assert.equal(receipt.cgroupName, upper);
    assert.equal((await identities.status(vmId, alpha!, receipt)).populated, true);
    await identities.stop(vmId, alpha!, receipt);
    assert.equal((await identities.status(vmId, alpha!, receipt)).populated, true,
      'closing an inherited identity ticket must preserve its upper domain');
    await python(`import os,time\np='/sys/fs/cgroup/'+${JSON.stringify(upper)}\nwith open(p+'/cgroup.kill','w') as f: f.write('1')\nfor _ in range(250):\n try: os.rmdir(p); break\n except OSError: time.sleep(.02)\nelse: raise RuntimeError('owned upper did not clear')`);
  });
  await check('same boot network replacement refuses new and old tickets; explicit rebind advances revision', async () => {
    const run = await identities.prepare(vmId, alpha!);
    await guest('ip netns del sk-default; ip netns add sk-default; ip -n sk-default link set lo up');
    try {
      const refused = await machines!.exec(vmId, identities.command(alpha!, run, { command: 'touch wrong-network' }));
      assert.equal(refused.code, 126); assert.match(refused.stderr, /NETWORK_REPLACED/);
      await assert.rejects(identities.prepare(vmId, alpha!), /NETWORK_REPLACED/);
    } finally { await identities.stop(vmId, alpha!, run); }
    const old = alpha!;
    alpha = await identities.rebind(vmId, old, { directory: old.directory, networkIsolation: old.networkIsolation });
    assert.equal(alpha.uid, old.uid); assert.equal(alpha.identityId, old.identityId); assert.equal(alpha.revision, old.revision + 1);
    first = await identities.prepare(vmId, alpha);
    assert.notEqual(first.networkInode, run.networkInode); await identities.stop(vmId, alpha, first);
    await assert.rejects(identities.prepare(vmId, old), /IDENTITY_STALE/);
  });
  await check('binding and account persist across a real VM reboot; old boot tickets refuse', async () => {
    const prior = alpha!, oldRun = await identities.prepare(vmId, prior);
    await identities.stop(vmId, prior, oldRun);
    await machines!.stop(vmId, true); assert.equal(machines!.state(vmId), 'stopped');
    await machines!.start(vmId); await ready();
    const after = await identities.inspect(vmId, 'default'); assert.deepEqual(after, prior);
    await guest('ip netns add sk-default; ip -n sk-default link set lo up');
    const run = await identities.prepare(vmId, after!); secondBootId = run.bootId; assert.notEqual(secondBootId, oldRun.bootId);
    const refused = await machines!.exec(vmId, identities.command(after!, oldRun, { command: 'touch stale-boot' }));
    assert.equal(refused.code, 126); assert.match(refused.stderr, /RECORD_ABSENT|RUN_IDENTITY/);
    const result = await identities.exec(vmId, after!, run, { command: '/usr/bin/id -u' });
    assert.equal(result.code, 0, result.stderr); assert.equal(Number(result.stdout.trim()), after!.uid);
  });
  await check('disk snapshot restore preserves the complete registry and rejects the newer revision', async () => {
    const prior = (await identities.inspect(vmId, 'default'))!;
    await guest('/bin/sync');
    await machines!.stop(vmId, true); assert.equal(machines!.state(vmId), 'stopped');
    const snapshot = await machines!.snapshot(vmId, 'owned persistent project identity');
    await machines!.start(vmId); await ready();
    assert.deepEqual(await identities.inspect(vmId, 'default'), prior);
    const later = await identities.rebind(vmId, prior, { directory: prior.directory, networkIsolation: prior.networkIsolation });
    assert.equal(later.revision, prior.revision + 1); assert.equal(later.uid, prior.uid);
    await guest('/bin/sync');
    await machines!.stop(vmId, true); assert.equal(machines!.state(vmId), 'stopped');
    await machines!.restore(vmId, snapshot.id, false);
    await machines!.start(vmId); await ready();
    const restored = (await identities.inspect(vmId, 'default'))!;
    assert.deepEqual(restored, prior); assert.deepEqual(await identities.inspect(vmId, betaId), beta);
    await assert.rejects(identities.prepare(vmId, later), /IDENTITY_STALE/);
    await guest('ip netns add sk-default; ip -n sk-default link set lo up');
    const run = await identities.prepare(vmId, restored);
    const result = await identities.exec(vmId, restored, run, { command: '/usr/bin/id -u' });
    assert.equal(result.code, 0, result.stderr); assert.equal(Number(result.stdout.trim()), prior.uid);
    alpha = restored;
  });
  await check('root records contain no command or environment and all sessions stop', async () => {
    const keys = await python(`import os,stat\nfor root in ['/var/lib/sakura/project-identities','/run/sakura-project-identities']:\n for parent,dirs,files in os.walk(root):\n  for name in files:\n   p=parent+'/'+name; i=os.lstat(p); assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and stat.S_IMODE(i.st_mode)==0o600\n   data=open(p,'rb').read(); assert b'IDENTITY_MARKER' not in data and b'root-escape' not in data\nprint('verified')`);
    assert.equal(keys, 'verified');
  });
  passed = true;
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(error);
} finally {
  let vmStopped = false;
  try {
    if (machines && vmId) {
      // Persist the disposable image's own cloud/SSH setup as well as the
      // explicitly fsynced identity records before releasing the fixture.
      if (machines.state(vmId) === 'running') await machines.exec(vmId, '/bin/sync', 30000).catch(() => {});
      await machines.stop(vmId, true); vmStopped = machines.state(vmId) === 'stopped';
    }
  } finally {
    await writeFile(join(directory, 'project-identity-evidence.json'), JSON.stringify({ version: 1, passed, error: failure,
      distro, fixture: directory, vmId, vmStopped, build: source.manifest.build, files: source.manifest.files,
      client: { node: process.version, execArgv: process.execArgv },
      serverSha256: createHash('sha256').update(await readFile(resolve('server/project-identity.ts'))).digest('hex'),
      checks, bootId, secondBootId }, null, 2) + '\n');
    await machines?.close();
    console.log(JSON.stringify({ passed, error: failure, vmStopped, fixture: directory, vmId, build: source.manifest.build, checks }));
  }
}
if (!passed) process.exitCode = 1;
