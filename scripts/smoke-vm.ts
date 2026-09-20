import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { bootSetup } from '../server/seed.ts';
const testRoot = await mkdtemp(join(tmpdir(), 'sakura-smoke-'));
process.env.SAKURA_DATA_DIR = testRoot;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { freePort } = await import('../server/qmp.ts');
await mkdir('artifacts', { recursive: true });
const log = createWriteStream('artifacts/vm-smoke.log', { flags: 'a' });
const engine = await createRuntime();
console.log('ENGINE', engine.version, 'via PosixLoom', engine.runtime.info().nativeHost);
const machines = new Machines(engine);
await machines.init();
let id = '';
const bootTimes: number[] = [];
async function boot() {
  const began = performance.now();
  await machines.start(id);
  const until = Date.now() + 270000;
  while (Date.now() < until) {
    const status = machines.state(id);
    if (status === 'running') {
      const seconds = Number(((performance.now() - began) / 1000).toFixed(2));
      bootTimes.push(seconds);
      console.log(`SSH ready in ${seconds}s`);
      return;
    }
    if (status === 'error' || status === 'stopped')
      throw new Error(JSON.stringify(await machines.view(id)) + '\n' + machines.logs.get(id));
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Boot timed out\n' + machines.logs.get(id));
}
try {
  const forwardPort = await freePort();
  const vm = await machines.create({
    name: `verify-${Date.now().toString(36)}`,
    memoryMiB: 512,
    cpus: 2,
    diskGiB: 8,
    accelerator: process.env.SAKURA_TEST_ACCELERATOR || 'auto',
    forwards: [{ host: forwardPort, guest: 22 }],
  });
  id = vm.id;
  machines.on(`log:${id}`, (text) => {
    log.write(text);
  });
  console.log('Boot 1: provisioning guest');
  await boot();
  const uname = await machines.exec(id, 'uname -a; cat /etc/alpine-release');
  console.log('\nREAL GUEST', uname.stdout);
  assert.equal(uname.code, 0);
  assert.match(uname.stdout, /Linux/);
  const network = await machines.exec(id, 'ip -4 addr show eth0; ip route; cat /etc/resolv.conf');
  assert.equal(network.code, 0);
  assert.match(network.stdout, /10\.0\.2\.15\/24/);
  assert.match(network.stdout, /default via 10\.0\.2\.2/);
  assert.match(network.stdout, /nameserver 10\.0\.2\.3/);
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: forwardPort });
    let banner = '';
    socket.setTimeout(10000, () => socket.destroy(new Error('Forwarded SSH port timed out')));
    socket.on('error', reject);
    socket.on('close', () => reject(new Error('Forwarded port closed before its SSH banner')));
    socket.on('data', (data) => {
      banner += data.toString();
      if (!banner.includes('\n')) return;
      socket.destroy();
      if (/^SSH-2\.0-/.test(banner)) resolve();
      else reject(new Error(`Unexpected forwarded SSH banner: ${banner}`));
    });
  });
  if (process.env.SAKURA_TEST_NETWORK === '1') {
    const internet = await machines.exec(
      id,
      'nslookup dl-cdn.alpinelinux.org && wget -q -T 15 -O /dev/null https://dl-cdn.alpinelinux.org/alpine/MIRRORS.txt',
    );
    assert.equal(internet.code, 0, internet.stderr);
    console.log('DNS and HTTPS egress OK');
  }
  await machines.writeGuestFile(id, '/workspace/persistence.txt', 'before snapshot\n');
  assert.equal(await machines.readGuestFile(id, '/workspace/persistence.txt'), 'before snapshot\n');
  console.log('SFTP OK', await machines.files(id, '/workspace'));
  await assert.rejects(machines.snapshot(id, 'unsafe'), /停止/);
  await machines.stop(id);
  const snapshot = await machines.snapshot(id, 'Verified clean state');
  console.log('Boot 2: checking persisted files');
  await boot();
  assert.equal(await machines.readGuestFile(id, '/workspace/persistence.txt'), 'before snapshot\n');
  await machines.writeGuestFile(id, '/workspace/persistence.txt', 'after snapshot\n');
  await machines.stop(id);
  await machines.restore(id, snapshot.id);
  console.log('Boot 3: checking restored snapshot');
  await boot();
  assert.equal(await machines.readGuestFile(id, '/workspace/persistence.txt'), 'before snapshot\n');
  // Exercise the real shell migration on a legacy configuration, then ensure
  // subsequent checks preserve a guest owner's custom settings.
  const legacyNetwork =
    '# stock cloud image\nauto lo\niface lo inet loopback\nauto eth0\niface eth0 inet dhcp\n';
  await machines.writeGuestFile(id, '/etc/network/interfaces', legacyNetwork);
  await machines.writeGuestFile(id, '/etc/update-extlinux.conf', 'timeout=10\n');
  await machines.writeGuestFile(id, '/boot/extlinux.conf', 'TIMEOUT 100\n');
  assert.equal((await machines.exec(id, `set -e\n${bootSetup()}`)).code, 0);
  assert.match(await machines.readGuestFile(id, '/etc/network/interfaces'), /iface eth0 inet static/);
  assert.equal(await machines.readGuestFile(id, '/etc/network/interfaces.sakura-backup'), legacyNetwork);
  assert.equal(await machines.readGuestFile(id, '/etc/update-extlinux.conf'), 'timeout=1\n');
  assert.equal(await machines.readGuestFile(id, '/boot/extlinux.conf'), 'TIMEOUT 10\n');
  const customNetwork = 'auto eth0\niface eth0 inet static\n  address 10.0.2.20/24\n';
  await machines.writeGuestFile(id, '/etc/network/interfaces', customNetwork);
  await machines.writeGuestFile(id, '/etc/update-extlinux.conf', 'timeout=5\n');
  await machines.writeGuestFile(id, '/boot/extlinux.conf', 'TIMEOUT 50\n');
  assert.equal((await machines.exec(id, `set -e\n${bootSetup()}`)).code, 0);
  assert.equal(await machines.readGuestFile(id, '/etc/network/interfaces'), customNetwork);
  assert.equal(await machines.readGuestFile(id, '/etc/update-extlinux.conf'), 'timeout=5\n');
  assert.equal(await machines.readGuestFile(id, '/boot/extlinux.conf'), 'TIMEOUT 50\n');
  assert.equal((await machines.exec(id, 'mkdir -p /etc/sakura; touch /etc/sakura/keep-boot-config')).code, 0);
  await machines.writeGuestFile(id, '/etc/network/interfaces', legacyNetwork);
  await machines.writeGuestFile(id, '/etc/update-extlinux.conf', 'timeout=10\n');
  await machines.writeGuestFile(id, '/boot/extlinux.conf', 'TIMEOUT 100\n');
  assert.equal((await machines.exec(id, `set -e\n${bootSetup()}`)).code, 0);
  assert.equal(await machines.readGuestFile(id, '/etc/network/interfaces'), legacyNetwork);
  assert.equal(await machines.readGuestFile(id, '/etc/update-extlinux.conf'), 'timeout=10\n');
  assert.equal(await machines.readGuestFile(id, '/boot/extlinux.conf'), 'TIMEOUT 100\n');
  await writeFile(
    'artifacts/boot-timings.json',
    JSON.stringify(
      {
        engine: engine.version,
        accelerator: (await machines.view(id)).activeAccelerator,
        cpus: 2,
        memoryMiB: 512,
        firstBootSeconds: bootTimes[0],
        subsequentBootSeconds: bootTimes.slice(1),
      },
      null,
      2,
    ),
  );
  console.log(
    '\nPASS: real Linux, SSH, SFTP, NAT forwarding, reboot persistence, snapshot restore, legacy migration.',
  );
} finally {
  if (id) {
    await machines.stop(id, true).catch(() => {});
    await machines.delete(id).catch(() => {});
  }
  await machines.close();
  log.end();
  await finished(log);
  assert.equal(dirname(testRoot), resolve(tmpdir()));
  assert.ok(basename(testRoot).startsWith('sakura-smoke-'));
  await rm(testRoot, { recursive: true, force: true });
}
