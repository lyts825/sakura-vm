import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const distro = process.argv[2] || 'alpine';
assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro));
const directory = await mkdtemp(join(tmpdir(), 'sakura-project-cache-'));
const owned = await realpath(directory);
assert.equal(dirname(owned), await realpath(tmpdir()));
assert.ok(basename(directory).startsWith('sakura-project-cache-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/' +
  ({ alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' }[distro]));
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
const { ProjectTerminals } = await import('../server/project-terminals.ts');
const { ProjectExecution } = await import('../server/project-execution.ts');
const { vmDir } = await import('../server/model.ts');
const { projectDependencyCacheScript } = await import('../server/project-dependency-cache.ts');
const { quote } = await import('../server/files.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);
const suite = new FeatureSuite(machines, workspaces);
const migrations = new ProjectDirectoryMigrations(machines, workspaces);
const terminals = new ProjectTerminals(machines, workspaces), execution = new ProjectExecution(machines, terminals);
let primaryFailure: unknown;
try {
  const vm = await machines.create({ name: 'project-cache-smoke', distro: distro as 'alpine' | 'debian' | 'ubuntu', memoryMiB: 1024, cpus: 2, diskGiB: 6 });
  await machines.start(vm.id);
  const deadline = Date.now() + 270000;
  while (machines.state(vm.id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(vm.id)))
      throw new Error(machines.logs.get(vm.id));
    await delay(250);
  }
  const run = async (command: string, timeout = 300000) => {
    const result = await machines.exec(vm.id, command, timeout);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    return result;
  };
  await run(distro === 'alpine' ? 'apk add --no-cache nodejs npm python3 py3-pip iproute2 git' :
    'export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y nodejs npm python3-pip python3-venv iproute2 git');
  await run('mkdir -p /workspace/npm-cache-test /workspace/pip-cache-test');
  await run('cd /workspace/npm-cache-test && npm init -y >/dev/null && npm install --package-lock-only --ignore-scripts --no-audit --no-fund is-number@7.0.0');
  const write = async (path: string, content: string) => run(
    `printf '%s' ${quote(Buffer.from(content).toString('base64'))} | base64 -d > ${quote(path)}`);
  const nodeHook = `const fs=require('node:fs');fs.appendFileSync('/workspace/npm-cache-test/import-hook-network',JSON.stringify({uid:process.getuid(),gid:process.getgid(),home:process.env.HOME,cwd:process.cwd(),network:fs.readlinkSync('/proc/self/ns/net'),cgroup:fs.readFileSync('/proc/self/cgroup','utf8').trim()})+'\\n');`;
  await write('/workspace/npm-cache-test/hook.cjs', nodeHook);
  await write('/workspace/npm-cache-test/.npmrc', 'node-options=--require /workspace/npm-cache-test/hook.cjs\nregistry=http://127.0.0.1:9\n');
  await run(`cd /workspace/npm-cache-test && node -e ${quote("const fs=require('node:fs');const p=JSON.parse(fs.readFileSync('package.json'));p.scripts={preinstall:'touch lifecycle-hook'};fs.writeFileSync('package.json',JSON.stringify(p))")}`);
  const malicious = { directory: '/workspace/npm-cache-test', networkIsolation: 'private' as const,
    environment: { NODE_OPTIONS: '--require /workspace/npm-cache-test/hook.cjs',
      HOME: '/workspace/npm-cache-test', PATH: '/workspace/does-not-exist',
      TOKEN: 'private-prefetch-secret', NPM_CONFIG_REGISTRY: 'http://127.0.0.1:9',
      NPM_CONFIG_USERCONFIG: '/workspace/npm-cache-test/.npmrc' },
    secrets: { DOWNLOAD_TOKEN: 'missing-secret-provider' } };
  const jobs: { manager: string; operation: string; status: string; log: string }[] = [];
  const dev = async (manager: 'npm' | 'pip', operation: 'prefetch-dependencies' | 'install-cached-dependencies', expectedError?: RegExp) => {
    suite.dev(vm.id, { operation, manager });
    await suite.jobs.wait(`${vm.id}:dev`);
    const job = suite.jobs.view(`${vm.id}:dev`);
    assert.equal(job?.status, expectedError ? 'error' : 'done', job?.error + '\n' + job?.log);
    if (expectedError) assert.match(job.error + '\n' + job.log, expectedError);
    assert.ok(!job.log.includes('private-prefetch-secret'));
    jobs.push({ manager, operation, status: job.status, log: job.log });
  };
  const authorize = async () => {
    const preview = await migrations.preview(vm.id); assert.ok(preview.plan);
    const result = await migrations.apply(vm.id, { action: 'apply', version: 1, reviewed: true,
      planId: preview.plan.proposal.planId, sha256: preview.plan.sha256 });
    assert.equal(result.plan?.state, 'applied'); assert.ok(result.plan?.activatedIdentity);
    assert.notEqual(result.plan.activatedIdentity.uid, 0);
    return result.plan.activatedIdentity;
  };
  const cacheSnapshot = async (manager: 'npm' | 'pip') => {
    const source = `import hashlib,json,os,stat\nroot=${JSON.stringify('/var/cache/sakura/project-deps/default/') }+${JSON.stringify(manager)}\nsha=hashlib.sha256();count=0;total=0\nfor parent,dirs,files in os.walk(root,followlinks=False):\n for name in sorted(dirs+files):\n  path=os.path.join(parent,name);info=os.lstat(path)\n  assert info.st_uid==0 and not info.st_mode&0o022 and not stat.S_ISLNK(info.st_mode)\n  sha.update(os.path.relpath(path,root).encode());sha.update(str((info.st_uid,info.st_gid,info.st_mode)).encode())\n  if stat.S_ISREG(info.st_mode):\n   count+=1;total+=info.st_size\n   with open(path,'rb') as stream:\n    for block in iter(lambda:stream.read(65536),b''):sha.update(block)\nprint(json.dumps({'sha256':sha.hexdigest(),'files':count,'bytes':total}))\n`;
    return JSON.parse((await run('/usr/bin/env -i HOME=/ PATH=/usr/sbin:/usr/bin:/sbin:/bin /usr/bin/python3 -I -S -c ' + quote(source))).stdout);
  };
  const closures: unknown[] = [];
  const verifyClosedCache = async (manager: 'npm' | 'pip') => {
    const journal = JSON.parse(await readFile(join(vmDir(vm.id), 'project-identities', 'default.json'), 'utf8'));
    const entries = journal.runs.filter((entry: any) => entry.cacheTransfer?.manager === manager);
    assert.ok(entries.length > 0);
    for (const entry of entries) {
      assert.equal(entry.phase, 'closed'); assert.equal(entry.run?.phase, 'closed');
      assert.equal(entry.cacheTransfer.phase, 'closed');
      const stageId = entry.cacheTransfer.stageId;
      const record = JSON.parse(await readFile(join(vmDir(vm.id), 'project-cache-transfers', 'default', 'closed', stageId.slice(0, 2), stageId + '.json'), 'utf8'));
      assert.equal(record.phase, 'closed'); assert.deepEqual(record.owner.identity, entry.identity);
      assert.deepEqual(record.owner.owner, entry.owner); assert.equal(record.owner.sha256, entry.sha256);
      assert.deepEqual(record.task.run, entry.run);
      const source = `import json,os\nroot=${JSON.stringify('/run/sakura-project-cache-transfers/') }+${JSON.stringify(stageId)}\nwith open(root+'/receipt.json') as stream:record=json.load(stream)\nassert record['phase']=='closed' and not os.path.lexists(root+'/data')\nassert not os.path.lexists('/sys/fs/cgroup/'+record['task']['run']['cgroupName'])\nprint(json.dumps(record))\n`;
      const guest = JSON.parse((await run('/usr/bin/env -i HOME=/ PATH=/usr/sbin:/usr/bin:/sbin:/bin /usr/bin/python3 -I -S -c ' + quote(source))).stdout);
      assert.deepEqual(guest, record.retirement.receipt); closures.push(record);
    }
  };
  await workspaces.save(vm.id, malicious);
  await dev('npm', 'prefetch-dependencies');
  await run('test ! -e /workspace/npm-cache-test/import-hook-network && test ! -e /workspace/npm-cache-test/lifecycle-hook');
  // The executable environment is restored only for the offline private action.
  await run('rm -f /workspace/npm-cache-test/.npmrc');
  await workspaces.save(vm.id, { directory: malicious.directory, networkIsolation: 'private',
    environment: { NODE_OPTIONS: malicious.environment.NODE_OPTIONS, TOKEN: malicious.environment.TOKEN } });
  const npmIdentity = await authorize(), npmCache = await cacheSnapshot('npm');
  await dev('npm', 'install-cached-dependencies');
  assert.deepEqual(await cacheSnapshot('npm'), npmCache); await verifyClosedCache('npm');
  await run('test -f /workspace/npm-cache-test/node_modules/is-number/index.js');
  const privateNetwork = (await run('ip netns exec sk-default readlink /proc/self/ns/net')).stdout.trim();
  const nodeIdentities = (await run('cat /workspace/npm-cache-test/import-hook-network')).stdout.trim().split('\n').map(value => JSON.parse(value));
  const nodeNetworks = nodeIdentities.map(value => value.network);
  assert.ok(nodeNetworks.length > 0 && nodeNetworks.every((value) => value === privateNetwork));
  for (const value of nodeIdentities) {
    assert.equal(value.uid, npmIdentity.uid); assert.equal(value.gid, npmIdentity.gid);
    assert.equal(value.home, npmIdentity.home); assert.equal(value.cwd, npmIdentity.directory);
    assert.match(value.cgroup, /^0::\/sakura-task-[a-f0-9-]{36}$/);
  }
  await run('test ! -e /workspace/npm-cache-test/lifecycle-hook');
  console.log(`${distro}: npm download ignored project import hooks, npmrc, environment and unresolved secret; offline import hook stayed private`);
  await run("printf 'idna==3.10\\n' > /workspace/pip-cache-test/requirements.txt");
  await write('/workspace/pip-cache-test/sitecustomize.py', "import json,os\nwith open('/workspace/pip-cache-test/import-hook-network','a') as output: output.write(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'home':os.environ['HOME'],'cwd':os.getcwd(),'network':os.readlink('/proc/self/ns/net'),'cgroup':open('/proc/self/cgroup').read().strip()})+'\\n')\n");
  await write('/workspace/pip-cache-test/pip.conf', '[global]\nindex-url = http://127.0.0.1:9\n');
  await workspaces.save(vm.id, { directory: '/workspace/pip-cache-test', networkIsolation: 'private',
    environment: { PYTHONPATH: '/workspace/pip-cache-test', PIP_CONFIG_FILE: '/workspace/pip-cache-test/pip.conf',
      PIP_INDEX_URL: 'http://127.0.0.1:9', TOKEN: malicious.environment.TOKEN }, secrets: malicious.secrets });
  await dev('pip', 'prefetch-dependencies');
  await run('test ! -e /workspace/pip-cache-test/import-hook-network');
  await workspaces.save(vm.id, { directory: '/workspace/pip-cache-test', networkIsolation: 'private',
    environment: { PYTHONPATH: '/workspace/pip-cache-test', TOKEN: malicious.environment.TOKEN } });
  const pipIdentity = await authorize(), pipCache = await cacheSnapshot('pip');
  await dev('pip', 'install-cached-dependencies');
  assert.deepEqual(await cacheSnapshot('pip'), pipCache); await verifyClosedCache('pip');
  const pipPrivateNetwork = (await run('ip netns exec sk-default readlink /proc/self/ns/net')).stdout.trim();
  const pythonIdentities = (await run('cat /workspace/pip-cache-test/import-hook-network')).stdout.trim().split('\n').map(value => JSON.parse(value));
  const pythonNetworks = pythonIdentities.map(value => value.network);
  assert.ok(pythonNetworks.length > 0 && pythonNetworks.every((value) => value === pipPrivateNetwork));
  for (const value of pythonIdentities) {
    assert.equal(value.uid, pipIdentity.uid); assert.equal(value.gid, pipIdentity.gid);
    assert.equal(value.home, pipIdentity.home); assert.equal(value.cwd, pipIdentity.directory);
    assert.match(value.cgroup, /^0::\/sakura-task-[a-f0-9-]{36}$/);
  }
  const imported = await execution.run(vm.id, { scope: 'project', timeoutSeconds: 30,
    command: "/workspace/pip-cache-test/.sakura/venv/bin/python -c 'import idna,os; assert os.getuid() != 0; assert idna.__version__ == \"3.10\"'" }, 'default');
  assert.equal(imported.code, 0, JSON.stringify(imported));
  await run("printf 'idna==3.11\\n' > /workspace/pip-cache-test/requirements.txt");
  await dev('pip', 'install-cached-dependencies', /FAILED|checksum|sha256sum/i);
  assert.deepEqual(await cacheSnapshot('pip'), pipCache); await verifyClosedCache('pip');
  const remoteRequirement = await machines.exec(vm.id,
    "printf 'idna @ https://example.invalid/idna.whl\\n' > /workspace/pip-cache-test/requirements.txt\n" +
    projectDependencyCacheScript('/workspace/pip-cache-test', 'default', 'pip', 'prefetch-dependencies'));
  assert.notEqual(remoteRequirement.code, 0);
  assert.match(remoteRequirement.stderr, /仅支持固定版本/);
  await run('mkdir -p /workspace/prepare-dependency');
  await write('/workspace/prepare-dependency/package.json', JSON.stringify({ name: 'prepare-dependency', version: '1.0.0',
    scripts: { prepare: 'readlink /proc/self/ns/net > /workspace/npm-cache-test/git-prepare-hook-network' } }));
  await run('cd /workspace/prepare-dependency && git init -q && git add package.json && git -c user.name=Sakura -c user.email=smoke@example.invalid commit -qm fixture');
  const gitDependency = await machines.exec(vm.id,
    `cd /workspace/npm-cache-test\nnode -e ${quote("const fs=require('node:fs');const p=JSON.parse(fs.readFileSync('package.json'));p.dependencies['is-number']='git+file:/workspace/prepare-dependency';fs.writeFileSync('package.json',JSON.stringify(p))")}\n` +
    projectDependencyCacheScript('/workspace/npm-cache-test', 'default', 'npm', 'prefetch-dependencies'));
  assert.notEqual(gitDependency.code, 0);
  assert.match(gitDependency.stderr, /共享预取仅支持/);
  await run('test ! -e /workspace/npm-cache-test/git-prepare-hook-network');
  await writeFile(join(directory, 'prefetch-evidence.json'), JSON.stringify({ distro, privateNetwork, pipPrivateNetwork,
    nodeNetworks, pythonNetworks, nodeIdentities, pythonIdentities, npmIdentity, pipIdentity, closures,
    npmCache, pipCache, jobs, rejectedRemoteRequirement: remoteRequirement.stderr,
    rejectedGitDependency: gitDependency.stderr }, null, 2));
  console.log(`PASS ${distro}: npm and pip clean prefetch, private offline install, manifest drift and unsafe-source rejection`);
} catch (error) { primaryFailure = error; throw error; }
finally {
  const cleanupErrors: unknown[] = [];
  for (const close of [() => execution.close(), () => terminals.close(), () => suite.close(), () => workspaces.close(), () => machines.close()]) {
    try { await close(); } catch (error) { cleanupErrors.push(error); }
  }
  if (cleanupErrors.length) throw new AggregateError([...(primaryFailure ? [primaryFailure] : []), ...cleanupErrors], 'Project cache smoke cleanup failed; owned fixture retained');
  if (primaryFailure || process.env.SAKURA_KEEP_CACHE_SMOKE === '1') console.log('Retained owned fixture:', owned);
  else {
    assert.equal(machines.live.size, 0);
    assert.equal(await realpath(directory), owned);
    assert.equal(dirname(owned), await realpath(tmpdir()));
    await rm(owned, { recursive: true, force: true });
  }
}
