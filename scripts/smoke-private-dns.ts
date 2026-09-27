import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'sakura-private-dns-smoke-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.match(basename(directory), /^sakura-private-dns-smoke-/);
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { NetworkProfiles } = await import('../server/network-profiles.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const network = new NetworkProfiles(machines);
try {
  const vm = await machines.create({
    name: 'private-dns-smoke', distro: 'debian', memoryMiB: 1024, cpus: 2,
    diskGiB: 4, accelerator: 'tcg',
  });
  await machines.start(vm.id);
  const deadline = Date.now() + 300000;
  while (machines.state(vm.id) !== 'running') {
    assert.equal(machines.state(vm.id), 'starting', machines.logs.get(vm.id)?.slice(-3000));
    assert.ok(Date.now() < deadline, machines.logs.get(vm.id)?.slice(-3000));
    await delay(300);
  }
  const resolver = await machines.exec(vm.id,
    'systemctl is-active --quiet systemd-resolved && readlink -f /etc/resolv.conf');
  assert.equal(resolver.code, 0, resolver.stderr);
  assert.ok([
    '/run/systemd/resolve/stub-resolv.conf',
    '/run/systemd/resolve/resolv.conf',
  ].includes(resolver.stdout.trim()));
  const originalLink = await machines.exec(vm.id, 'readlink /etc/resolv.conf');
  assert.equal(originalLink.code, 0, originalLink.stderr);
  const original = await machines.exec(vm.id,
    'if test -e /etc/systemd/resolved.conf.d/90-sakura.conf; then cat /etc/systemd/resolved.conf.d/90-sakura.conf; fi');
  assert.equal(original.code, 0, original.stderr);
  const config = {
    dnsServers: ['10.0.2.3'], dnsDomains: ['example.com'], dnssec: 'no' as const,
  };
  const preview = await network.preview(vm.id, config);
  await network.apply(vm.id, preview.config, preview.token);
  const activeLink = await machines.exec(vm.id, 'readlink -f /etc/resolv.conf');
  assert.equal(activeLink.stdout.trim(), '/run/systemd/resolve/stub-resolv.conf');
  const lookup = await machines.exec(vm.id, 'LC_ALL=C resolvectl query example.com', 30000);
  assert.equal(lookup.code, 0, lookup.stdout + lookup.stderr);
  assert.match(lookup.stdout, /example\.com/);
  await network.restore(vm.id);
  const restored = await machines.exec(vm.id,
    'if test -e /etc/systemd/resolved.conf.d/90-sakura.conf; then cat /etc/systemd/resolved.conf.d/90-sakura.conf; fi');
  assert.equal(restored.code, 0, restored.stderr);
  assert.equal(restored.stdout, original.stdout);
  const restoredLink = await machines.exec(vm.id, 'readlink /etc/resolv.conf');
  assert.equal(restoredLink.stdout, originalLink.stdout);
  const strict = await network.preview(vm.id, {
    dnsServers: ['10.0.2.3'], dnsDomains: ['example.com'], dnssec: 'yes',
  });
  await network.apply(vm.id, strict.config, strict.token);
  const policy = await machines.exec(vm.id, 'LC_ALL=C resolvectl dnssec');
  assert.equal(policy.code, 0, policy.stderr);
  assert.match(policy.stdout, /^Global: yes$/m);
  await network.restore(vm.id);
  console.log('Real Debian/QEMU private DNS route, DNSSEC policy and restoration passed.');
} finally {
  await network.close();
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
