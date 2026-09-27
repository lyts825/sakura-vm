import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-package-cache-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith('sakura-package-cache-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { packageCacheScript } = await import('../server/package-cache.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const suite = new FeatureSuite(machines, new Workspaces(machines));
async function waitRunning(id: string) {
  const deadline = Date.now() + 270000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id));
    await delay(250);
  }
}
try {
  const vm = await machines.create({ name: 'package-cache-smoke', memoryMiB: 512, cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  await waitRunning(vm.id);
  const prefetch = await machines.exec(vm.id,
    packageCacheScript('alpine', 'cache-prefetch', 'tree'), 300000);
  assert.equal(prefetch.code, 0, prefetch.stdout + prefetch.stderr);
  const cache = await machines.exec(vm.id, packageCacheScript('alpine', 'cache-list'));
  assert.equal(cache.code, 0, cache.stdout + cache.stderr);
  assert.match(cache.stdout, /^tree\t[1-9][0-9]*\t[1-9][0-9]*$/m);
  const installed = await machines.exec(vm.id,
    packageCacheScript('alpine', 'cache-install', 'tree'), 300000);
  assert.equal(installed.code, 0, installed.stdout + installed.stderr);
  assert.equal((await machines.exec(vm.id, 'command -v tree')).code, 0);
  const tamper = await machines.exec(vm.id,
    'set -- /var/cache/sakura/packages/tree/*.apk; printf x >> "$1"');
  assert.equal(tamper.code, 0, tamper.stdout + tamper.stderr);
  const corrupt = await machines.exec(vm.id,
    packageCacheScript('alpine', 'cache-install', 'tree'), 300000);
  assert.notEqual(corrupt.code, 0);
  assert.match(corrupt.stderr, /FAILED|checksum/i);
  const cleared = await machines.exec(vm.id, packageCacheScript('alpine', 'cache-clear', 'tree'));
  assert.equal(cleared.code, 0, cleared.stdout + cleared.stderr);
  assert.equal((await machines.exec(vm.id, packageCacheScript('alpine', 'cache-list'))).stdout.trim(), '');
  console.log('PASS Alpine prefetch, offline install, cache listing, tamper rejection and clear');
  await machines.stop(vm.id);

  const debian = await machines.create({
    name: 'package-cache-debian-smoke', distro: 'debian', memoryMiB: 1024, cpus: 2,
    diskGiB: 4,
  });
  await machines.start(debian.id);
  await waitRunning(debian.id);
  const checked = await suite.feature(debian.id, { featureId: 'package-cache', action: 'check' });
  assert.equal('ready' in checked && checked.ready, true);
  suite.package(debian.id, { operation: 'cache-prefetch', name: 'tree' });
  await suite.jobs.wait(`${debian.id}:package`);
  const aptPrefetch = suite.jobs.view(`${debian.id}:package`);
  assert.equal(aptPrefetch?.status, 'done', aptPrefetch?.error + '\n' + aptPrefetch?.log);
  const aptList = await machines.exec(debian.id, packageCacheScript('debian', 'cache-list'));
  assert.equal(aptList.code, 0, aptList.stdout + aptList.stderr);
  assert.match(aptList.stdout, /^tree\t[1-9][0-9]*\t[1-9][0-9]*$/m);
  const aptInstall = await machines.exec(debian.id,
    packageCacheScript('debian', 'cache-install', 'tree'), 300000);
  assert.equal(aptInstall.code, 0, aptInstall.stdout + aptInstall.stderr);
  assert.equal((await machines.exec(debian.id, 'command -v tree')).code, 0);
  console.log('PASS Debian prefetch, offline install and cache listing');
} finally {
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
