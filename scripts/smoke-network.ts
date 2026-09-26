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
    'apk add --no-cache python3 iproute2 ca-certificates && mkdir -p /workspace/app /workspace/regression/server /workspace/regression/tests',
    300000,
  );
  assert.equal(installed.code, 0, installed.stderr);
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
