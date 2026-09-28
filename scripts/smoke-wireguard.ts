import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = await mkdtemp(join(tmpdir(), 'sakura-wireguard-smoke-'));
assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
process.env.SAKURA_DATA_DIR = join(root, 'data');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Secrets } = await import('../server/secrets.ts');
const { WireGuardOverlay } = await import('../server/wireguard-overlay.ts');
const { vmDir } = await import('../server/model.ts');
const machines = new Machines(await createRuntime());
const secrets = new Secrets(machines, async (_operation, value) => value);
const wireguard = new WireGuardOverlay(machines, () => secrets);
const signal = new AbortController().signal;

async function boot(id: string) {
  await machines.start(id);
  const deadline = Date.now() + 300_000;
  while (machines.state(id) !== 'running') {
    if (Date.now() > deadline || ['stopped', 'error'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id) || '客户机启动超时');
    await delay(300);
  }
}
async function guest(id: string, command: string) {
  const result = await machines.exec(id, command, 30_000);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

try {
  await machines.init();
  const vm = await machines.create({ name: 'wireguard-source' });
  await boot(vm.id);
  const generated = await wireguard.action(vm.id,
    { mode: 'generate-key', secret: 'WireGuardPrivate' }, 'run', signal);
  assert.ok('publicKey' in generated && generated.publicKey);
  const ownPublic = generated.publicKey;
  const ownPrivate = await secrets.value(vm.id, 'WireGuardPrivate');
  assert.equal(await guest(vm.id, `printf '%s' '${ownPrivate}' | wg pubkey`), ownPublic);
  const peerPrivate = await guest(vm.id, 'wg genkey');
  const peerPublic = await guest(vm.id, `printf '%s' '${peerPrivate}' | wg pubkey`);
  const config = { address: '10.222.0.1/32', listenPort: 51821,
    privateKeySecret: 'WireGuardPrivate', peers: [{ publicKey: peerPublic,
      endpoint: '127.0.0.1:51822', allowedIPs: ['10.222.0.2/32'], keepaliveSeconds: 1 }] };
  await wireguard.action(vm.id, { mode: 'save', config }, 'run', signal);
  assert.ok(!(await readFile(join(vmDir(vm.id), 'wireguard-overlay.json'), 'utf8'))
    .includes(ownPrivate));
  const started = await wireguard.action(vm.id, { mode: 'start' }, 'run', signal);
  assert.equal(started.ready, true);
  assert.equal(started.executed, true);
  assert.ok(!JSON.stringify(started).includes(ownPrivate));
  assert.equal(await guest(vm.id,
    "find /run -maxdepth 1 -name 'sakura-wireguard-*.conf' -print"), '');
  async function startPeer() {
    const content = `[Interface]\nPrivateKey = ${peerPrivate}\nListenPort = 51822\n` +
      `[Peer]\nPublicKey = ${ownPublic}\nEndpoint = 127.0.0.1:51821\n` +
      `AllowedIPs = 10.222.0.1/32\nPersistentKeepalive = 1\n`;
    await guest(vm.id, `umask 077; cat > /run/wg-peer.conf <<'WIREGUARD'\n${content}WIREGUARD\n` +
      `ip link add dev wg-peer type wireguard\nwg setconf wg-peer /run/wg-peer.conf\n` +
      `rm /run/wg-peer.conf\nip address add dev wg-peer 10.222.0.2/32\n` +
      `ip link set up dev wg-peer\nip route add 10.222.0.1/32 dev wg-peer`);
  }
  await startPeer();
  await guest(vm.id, 'ping -c 3 -W 3 10.222.0.2');
  const status = await wireguard.action(vm.id, { mode: 'status' }, 'run', signal);
  assert.ok('status' in status && status.status && 'handshakes' in status.status);
  assert.equal(status.ready, true);
  assert.ok(status.status.active);
  assert.ok(status.status.handshakes?.some((line: string) => Number(line.split(/\s+/)[1]) > 0));
  assert.ok(!JSON.stringify(status).includes(ownPrivate));
  await wireguard.action(vm.id, { mode: 'stop' }, 'run', signal);
  assert.equal((await wireguard.action(vm.id, { mode: 'status' }, 'run', signal)).ready, false);
  await wireguard.action(vm.id, { mode: 'start' }, 'run', signal);
  await guest(vm.id, 'ping -c 2 -W 3 10.222.0.2');
  await machines.stop(vm.id, false);
  await boot(vm.id);
  await wireguard.tick();
  assert.equal((await wireguard.action(vm.id, { mode: 'status' }, 'run', signal)).ready, true);
  await startPeer();
  await guest(vm.id, 'ping -c 2 -W 3 10.222.0.2');
  await wireguard.action(vm.id, { mode: 'stop' }, 'run', signal);
  await machines.stop(vm.id, false);
  await machines.delete(vm.id);
  console.log('WireGuard peer handshake, encrypted guest traffic, stop/start and boot recovery passed.');
} finally {
  await wireguard.close();
  await machines.close();
  await rm(root, { recursive: true, force: true });
}
