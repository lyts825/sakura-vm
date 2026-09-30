import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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
const { projectDependencyCacheScript } = await import('../server/project-dependency-cache.ts');
const { quote } = await import('../server/files.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);
const suite = new FeatureSuite(machines, workspaces);
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
  const nodeHook = `const fs=require('node:fs');fs.appendFileSync('/workspace/npm-cache-test/import-hook-network',fs.readlinkSync('/proc/self/ns/net')+'\\n');`;
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
  const dev = async (manager: 'npm' | 'pip', operation: 'prefetch-dependencies' | 'install-cached-dependencies') => {
    suite.dev(vm.id, { operation, manager });
    await suite.jobs.wait(`${vm.id}:dev`);
    const job = suite.jobs.view(`${vm.id}:dev`);
    assert.equal(job?.status, 'done', job?.error + '\n' + job?.log);
    assert.ok(!job.log.includes('private-prefetch-secret'));
    jobs.push({ manager, operation, status: job.status, log: job.log });
  };
  await workspaces.save(vm.id, malicious);
  await dev('npm', 'prefetch-dependencies');
  await run('test ! -e /workspace/npm-cache-test/import-hook-network && test ! -e /workspace/npm-cache-test/lifecycle-hook');
  // The executable environment is restored only for the offline private action.
  await run('rm -f /workspace/npm-cache-test/.npmrc');
  await workspaces.save(vm.id, { directory: malicious.directory, networkIsolation: 'private',
    environment: { NODE_OPTIONS: malicious.environment.NODE_OPTIONS, TOKEN: malicious.environment.TOKEN } });
  await dev('npm', 'install-cached-dependencies');
  await run('test -f /workspace/npm-cache-test/node_modules/is-number/index.js');
  const privateNetwork = (await run('ip netns exec sk-default readlink /proc/self/ns/net')).stdout.trim();
  const nodeNetworks = (await run('cat /workspace/npm-cache-test/import-hook-network')).stdout.trim().split('\n');
  assert.ok(nodeNetworks.length > 0 && nodeNetworks.every((value) => value === privateNetwork));
  await run('test ! -e /workspace/npm-cache-test/lifecycle-hook');
  console.log(`${distro}: npm download ignored project import hooks, npmrc, environment and unresolved secret; offline import hook stayed private`);
  await run("printf 'idna==3.10\\n' > /workspace/pip-cache-test/requirements.txt");
  await write('/workspace/pip-cache-test/sitecustomize.py', "import os\nwith open('/workspace/pip-cache-test/import-hook-network','a') as output: output.write(os.readlink('/proc/self/ns/net')+'\\n')\n");
  await write('/workspace/pip-cache-test/pip.conf', '[global]\nindex-url = http://127.0.0.1:9\n');
  await workspaces.save(vm.id, { directory: '/workspace/pip-cache-test', networkIsolation: 'private',
    environment: { PYTHONPATH: '/workspace/pip-cache-test', PIP_CONFIG_FILE: '/workspace/pip-cache-test/pip.conf',
      PIP_INDEX_URL: 'http://127.0.0.1:9', TOKEN: malicious.environment.TOKEN }, secrets: malicious.secrets });
  await dev('pip', 'prefetch-dependencies');
  await run('test ! -e /workspace/pip-cache-test/import-hook-network');
  await workspaces.save(vm.id, { directory: '/workspace/pip-cache-test', networkIsolation: 'private',
    environment: { PYTHONPATH: '/workspace/pip-cache-test', TOKEN: malicious.environment.TOKEN } });
  await dev('pip', 'install-cached-dependencies');
  const pythonNetworks = (await run('cat /workspace/pip-cache-test/import-hook-network')).stdout.trim().split('\n');
  assert.ok(pythonNetworks.length > 0 && pythonNetworks.every((value) => value === privateNetwork));
  await run("/workspace/pip-cache-test/.sakura/venv/bin/python -c 'import idna; assert idna.__version__ == \"3.10\"'");
  const changed = await machines.exec(vm.id,
    "printf 'idna==3.11\\n' > /workspace/pip-cache-test/requirements.txt\n" +
    projectDependencyCacheScript('/workspace/pip-cache-test', 'default', 'pip', 'install-cached-dependencies'));
  assert.notEqual(changed.code, 0);
  assert.match(changed.stderr, /FAILED|checksum|sha256sum/i);
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
  await writeFile(join(directory, 'prefetch-evidence.json'), JSON.stringify({ distro, privateNetwork,
    nodeNetworks, pythonNetworks, jobs, rejectedRemoteRequirement: remoteRequirement.stderr,
    rejectedGitDependency: gitDependency.stderr }, null, 2));
  console.log(`PASS ${distro}: npm and pip clean prefetch, private offline install, manifest drift and unsafe-source rejection`);
} finally {
  await suite.jobs.close();
  await workspaces.close();
  await machines.close();
  if (process.env.SAKURA_KEEP_CACHE_SMOKE === '1') console.log('Retained owned fixture:', owned);
  else {
    assert.equal(await realpath(directory), owned);
    assert.equal(dirname(owned), await realpath(tmpdir()));
    await rm(owned, { recursive: true, force: true });
  }
}
