import assert from 'node:assert/strict';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'linux') {
  console.log('Trusted boot guest smoke requires Linux; skipped.');
  process.exit(0);
}
const root = await mkdtemp(join(tmpdir(), 'sakura-trusted-guest-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_QEMU_DIR ||= '/usr/bin';
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { TrustedBootService } = await import('../server/trusted-boot-service.ts');
const { inspectTrustedBoot } = await import('../server/trusted-boot.ts');
const { vmDir } = await import('../server/model.ts');
const { Bundles } = await import('../server/bundles.ts');
const engine = await createRuntime();
const machines = new Machines(engine);
const service = new TrustedBootService(machines);
const bundles = new Bundles(machines);
let id = '', restoredId = '';
try {
  await machines.init();
  await service.init();
  bundles.setTrustedBoot(service);
  const vm = await machines.create({ name: 'verify-trust', distro: 'debian',
    firmware: 'uefi', memoryMiB: 1024, cpus: 1, diskGiB: 4,
    accelerator: 'tcg', forwards: [] });
  id = vm.id;
  await service.action(id, { operation: 'configure', policy: { enabled: true } });
  const verifyBoot = async (targetId: string) => {
    await machines.start(targetId);
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline && machines.state(targetId) === 'starting') await delay(500);
    assert.equal(machines.state(targetId), 'running', machines.logs.get(targetId));
    const result = await inspectTrustedBoot(machines, targetId);
    assert.equal(result.guest?.efi, true);
    assert.equal(result.guest?.tpmDevicePresent, true);
    assert.equal(result.guest?.secureBootEnabled, true);
    assert.equal(result.guest?.setupMode, false);
    assert.equal(result.ready, true, JSON.stringify(result));
  };
  await verifyBoot(id);
  assert.ok((await stat(join(vmDir(id), 'uefi-secure-vars.fd'))).size > 65536);
  assert.ok((await stat(join(vmDir(id), 'tpm2'))).isDirectory());
  await machines.stop(id);
  await verifyBoot(id);
  await machines.stop(id);
  const snapshot = await machines.snapshot(id, 'trusted history');
  const historicalState = await service.capture(id, snapshot.id);
  assert.equal(historicalState?.enabled, true);
  await verifyBoot(id);
  const write = await machines.exec(id, "printf changed > /workspace/trusted-snapshot-change", 10000);
  assert.equal(write.code, 0, write.stderr);
  await machines.stop(id);
  await machines.restore(id, snapshot.id);
  assert.deepEqual(await service.capture(id), historicalState);
  await verifyBoot(id);
  const rolledBack = await machines.exec(id, 'test ! -e /workspace/trusted-snapshot-change', 10000);
  assert.equal(rolledBack.code, 0, rolledBack.stderr);
  await machines.stop(id);
  const bundle = join(root, 'trusted-history.sakura');
  await bundles.export(id, createWriteStream(bundle, { flags: 'wx', mode: 0o600 }),
    () => {}, undefined, 0, snapshot.id);
  const restored = await bundles.import('verify-restored', createReadStream(bundle));
  restoredId = restored.id;
  const restoredState = await service.capture(restoredId);
  assert.equal(restoredState?.enabled, true);
  assert.deepEqual(restoredState?.files, historicalState?.files);
  await verifyBoot(restoredId);
  console.log('Real Debian guest booted with TPM and Secure Boot, rolled back a trusted offline snapshot, then booted its historical export.');
} finally {
  if (id && machines.live.has(id)) await machines.stop(id).catch(() => {});
  if (restoredId && machines.live.has(restoredId)) await machines.stop(restoredId).catch(() => {});
  await service.close();
  await machines.close();
  await rm(root, { recursive: true, force: true });
}
