import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-security-scan-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith('sakura-security-scan-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { guestPackageInventory, scanGuestVulnerabilities } =
  await import('../server/security-vulnerabilities.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const suite = new FeatureSuite(machines, new Workspaces(machines));
async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 270000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id));
    await delay(250);
  }
}
try {
  for (const distro of ['alpine', 'debian', 'ubuntu'] as const) {
    const vm = await machines.create({ name: `security-${distro}`, distro,
      memoryMiB: distro === 'alpine' ? 512 : 1024, cpus: 2, diskGiB: 4 });
    await boot(vm.id);
    const inventory = await guestPackageInventory(machines, vm.id);
    assert.ok(inventory.packages.length > 20);
    assert.ok(inventory.ecosystem.startsWith(distro === 'alpine' ? 'Alpine:v' :
      distro === 'debian' ? 'Debian:' : 'Ubuntu:'));
    const scan = await scanGuestVulnerabilities(machines, vm.id);
    assert.equal(scan.status, 'complete', scan.error);
    assert.equal(scan.packagesChecked, inventory.packages.length);
    console.log(`PASS ${distro}: ${scan.packagesChecked} source packages, ${scan.affectedPackages} affected, ${scan.vulnerabilityCount} OSV IDs`);
    if (distro === 'alpine') {
      const result = await suite.securityScan(vm.id);
      assert.equal(result.vulnerabilityScan.status, 'complete', result.vulnerabilityScan.error);
      assert.match(result.output, /CVE\nOSV:/);
    }
    await machines.stop(vm.id);
  }
} finally {
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
