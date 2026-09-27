import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type { Features as FeaturesType } from '../server/features';

const directory = await mkdtemp(join(tmpdir(), 'sakura-network-vm-'));
await mkdir(join(directory, 'images'), { recursive: true });
await copyFile(resolve('.data/images/alpine-3.23.qcow2'), join(directory, 'images/alpine-3.23.qcow2'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = join(directory, 'images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Features } = await import('../server/features.ts');
const { freePort } = await import('../server/qmp.ts');
const { networkSchema } = await import('../server/network-profiles.ts');
const { networkEmulation } = await import('../server/network-emulation.ts');
const { networkQuota } = await import('../server/network-quota.ts');
const { egressPolicy } = await import('../server/egress-policy.ts');
const machines = new Machines(await createRuntime());
await machines.init();
let features: FeaturesType | undefined;

async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 300000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id));
    await delay(250);
  }
}
async function banner(port: number) {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(5000, () => socket.destroy(new Error('Timed out reading SSH banner')));
    socket.once('data', (chunk) => {
      socket.destroy();
      resolve(chunk.toString());
    });
    socket.once('error', reject);
  });
}

try {
  features = await Features.create(machines, ['network', 'automation']);
  const vm = await machines.create({ name: 'network-smoke', memoryMiB: 512, cpus: 2, diskGiB: 4 });
  console.log('Booting isolated Alpine network VM');
  await boot(vm.id);
  const installed = await machines.exec(
    vm.id,
    'apk add --no-cache python3 iproute2 iptables ca-certificates && mkdir -p /workspace/app /workspace/regression/server /workspace/regression/tests',
    300000,
  );
  assert.equal(installed.code, 0, installed.stderr);
  const quotaTools = await machines.exec(vm.id,
    'set -e; iptables --version; iptables -N SAKURA_Q_PROBE; trap "iptables -F SAKURA_Q_PROBE; iptables -X SAKURA_Q_PROBE" EXIT; iptables -A SAKURA_Q_PROBE -p tcp -m conntrack --ctstate NEW -m connlimit --connlimit-above 2 -j REJECT; iptables -A SAKURA_Q_PROBE -p tcp -m conntrack --ctstate NEW -m limit --limit 2/second --limit-burst 2 -j RETURN',
    10000);
  assert.equal(quotaTools.code, 0, quotaTools.stderr);
  const netemOptions = { mode: 'apply', interface: 'lo', delayMs: 15, jitterMs: 0, lossPercent: 0 };
  const netemPreview = await networkEmulation(machines, vm.id, netemOptions, 'check');
  assert.equal(netemPreview.ready, true);
  assert.equal(netemPreview.executed, false);
  const netemApplied = await networkEmulation(machines, vm.id, netemOptions, 'run');
  assert.equal(netemApplied.executed, true);
  assert.match(String(netemApplied.current), /qdisc netem .* root.*delay 15ms/);
  const netemCleared = await networkEmulation(machines, vm.id, { mode: 'clear', interface: 'lo' }, 'run');
  assert.equal(netemCleared.executed, true);
  assert.equal(netemCleared.netemActive, false);
  console.log('Real guest tc/netem preview, delay application and cleanup passed');
  const quota = { mode: 'apply', interface: 'eth0', egressKbps: 4096, burstKiB: 32, latencyMs: 200 };
  const quotaPreview = await networkQuota(machines, vm.id, quota, 'check');
  assert.equal(quotaPreview.ready, true);
  assert.equal(quotaPreview.executed, false);
  const quotaApplied = await networkQuota(machines, vm.id, quota, 'run');
  assert.equal(quotaApplied.active, true);
  assert.match(quotaApplied.current, /^qdisc tbf 42: root/m);
  const quotaTraffic = await machines.exec(vm.id, 'ping -c 1 -W 2 10.0.2.2 >/dev/null; tc -s qdisc show dev eth0');
  assert.equal(quotaTraffic.code, 0, quotaTraffic.stderr);
  assert.match(quotaTraffic.stdout, /Sent [1-9][0-9]* bytes/);
  const quotaCleared = await networkQuota(machines, vm.id, { mode: 'clear', interface: 'eth0' }, 'run');
  assert.equal(quotaCleared.active, false);
  console.log('Real guest outbound bandwidth quota preview, application and cleanup passed');
  const policy = await egressPolicy(machines, vm.id,
    { mode: 'apply', interface: 'eth0', allowedDestinations: ['10.0.2.2/32', '10.0.2.3/32'] },
    'run');
  assert.equal('active' in policy && policy.active, true);
  assert.equal('rules' in policy && policy.rules.length, 2);
  const allowed = await machines.exec(vm.id, 'ping -c 1 -W 2 10.0.2.2');
  assert.equal(allowed.code, 0, allowed.stdout + allowed.stderr);
  const denied = await machines.exec(vm.id, 'ping -c 1 -W 2 1.1.1.1');
  assert.notEqual(denied.code, 0);
  const updated = await egressPolicy(machines, vm.id,
    { mode: 'apply', interface: 'eth0', allowedDestinations: ['10.0.2.3/32'] }, 'run');
  assert.equal('rules' in updated && updated.rules.length, 2);
  const deniedGateway = await machines.exec(vm.id, 'ping -c 1 -W 2 10.0.2.2');
  assert.notEqual(deniedGateway.code, 0);
  const clearedPolicy = await egressPolicy(machines, vm.id, { mode: 'clear' }, 'run');
  assert.equal('active' in clearedPolicy && clearedPolicy.active, false);
  console.log('Real guest IPv4 allow/deny, live policy replacement and cleanup passed');
  await features.workspaces.save(vm.id, { directory: '/workspace/app' });
  const before = await machines.readGuestFile(vm.id, '/etc/resolv.conf');
  const port = await freePort();
  const saved = await features.network.saveProfile({
    name: 'Shared development network',
    config: networkSchema.parse({
      dnsServers: ['10.0.2.3', '1.1.1.1'],
      forwards: [{ name: 'SSH proof', host: port, guest: 22 }],
      npmRegistry: 'https://registry.npmjs.org',
    }),
  });
  const preview = await features.network.preview(vm.id, saved.config);
  await features.network.apply(vm.id, preview.config, preview.token);
  assert.match(await banner(port), /^SSH-2\.0/);
  await machines.setForwards(vm.id, []);
  await assert.rejects(banner(port));
  await machines.setForwards(vm.id, [{ name: 'SSH proof', host: port, guest: 22 }]);
  assert.match(await banner(port), /^SSH-2\.0/);
  console.log('Live QEMU port-forward removal and re-addition passed');
  assert.match(await machines.readGuestFile(vm.id, '/etc/resolv.conf'), /nameserver 1\.1\.1\.1/);
  const report = await features.suite.networkTest(vm.id, 'example.com');
  assert.equal(report.code, 0, report.output);
  console.log('Real DNS, TCP, certificate-verified HTTPS and route diagnostics passed');
  for (const file of ['server/engineering-runner.py', 'tests/capability_runner_test.py'])
    await machines.writeGuestFile(
      vm.id,
      '/workspace/regression/' + file,
      await readFile(file, 'utf8'),
      false,
    );
  const probes = await machines.exec(
    vm.id,
    'cd /workspace/regression && python3 tests/capability_runner_test.py Capabilities.test_network_diagnostics_probe_real_dns_tcp_tls_failure_and_closed_port Capabilities.test_network_diagnostics_deadline_terminates_stalled_https Capabilities.test_network_diagnostics_resolves_a_real_local_route',
    30000,
  );
  assert.equal(probes.code, 0, probes.stdout + probes.stderr);
  console.log('Actual refused ports, invalid TLS, timeout termination and local routing passed');
  await machines.stop(vm.id, false);
  await features?.close();
  features = await Features.create(machines, ['network', 'automation']);
  assert.equal((await features.network.profiles())[0].id, saved.id);
  await boot(vm.id);
  assert.match(await banner(port), /^SSH-2\.0/);
  assert.match(await machines.readGuestFile(vm.id, '/etc/resolv.conf'), /nameserver 1\.1\.1\.1/);
  await features.network.restore(vm.id);
  assert.equal(await machines.readGuestFile(vm.id, '/etc/resolv.conf'), before);
  await assert.rejects(banner(port));
  assert.deepEqual(machines.get(vm.id).forwards, []);
  assert.deepEqual(await features.network.environment(vm.id), {});
  await features.network.removeProfile(saved.id);
  console.log(
    'Saved DNS and QEMU NAT mappings survived restart; restoring removed the listener and recovered original DNS',
  );
} finally {
  await features?.close();
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-network-vm-'));
  await rm(directory, { recursive: true, force: true });
}
