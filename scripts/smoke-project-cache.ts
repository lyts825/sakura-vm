import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-project-cache-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith('sakura-project-cache-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { projectDependencyCacheScript } = await import('../server/project-dependency-cache.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);
const suite = new FeatureSuite(machines, workspaces);
try {
  const vm = await machines.create({ name: 'project-cache-smoke', memoryMiB: 1024, cpus: 2, diskGiB: 6 });
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
  await run('apk add --no-cache nodejs npm python3 py3-pip');
  await run('mkdir -p /workspace/npm-cache-test /workspace/pip-cache-test');
  await run('cd /workspace/npm-cache-test && npm init -y >/dev/null && npm install --package-lock-only --ignore-scripts --no-audit --no-fund is-number@7.0.0');
  await workspaces.save(vm.id, { directory: '/workspace/npm-cache-test' });
  for (const operation of ['prefetch-dependencies', 'install-cached-dependencies'] as const) {
    suite.dev(vm.id, { operation, manager: 'npm' });
    await suite.jobs.wait(`${vm.id}:dev`);
    const job = suite.jobs.view(`${vm.id}:dev`);
    assert.equal(job?.status, 'done', job?.error + '\n' + job?.log);
  }
  await run('test -f /workspace/npm-cache-test/node_modules/is-number/index.js');
  await run("printf 'idna==3.10\\n' > /workspace/pip-cache-test/requirements.txt");
  await run(projectDependencyCacheScript('/workspace/pip-cache-test', 'default', 'pip', 'prefetch-dependencies'));
  await run(projectDependencyCacheScript('/workspace/pip-cache-test', 'default', 'pip', 'install-cached-dependencies'));
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
  console.log('PASS npm and pip project dependency prefetch, offline install and manifest drift rejection');
} finally {
  await suite.jobs.close();
  await workspaces.close();
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
