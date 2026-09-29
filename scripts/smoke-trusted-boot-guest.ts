import assert from 'node:assert/strict';
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
const engine = await createRuntime();
const machines = new Machines(engine);
const service = new TrustedBootService(machines);
let id = '';
try {
  await machines.init();
  await service.init();
  const vm = await machines.create({ name: 'verify-trust', distro: 'debian',
    firmware: 'uefi', memoryMiB: 1024, cpus: 1, diskGiB: 4,
    accelerator: 'tcg', forwards: [] });
  id = vm.id;
  await service.action(id, { operation: 'configure', policy: { enabled: true } });
  const verifyBoot = async () => {
    await machines.start(id);
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline && machines.state(id) === 'starting') await delay(500);
    assert.equal(machines.state(id), 'running', machines.logs.get(id));
    const result = await inspectTrustedBoot(machines, id);
    assert.equal(result.guest?.efi, true);
    assert.equal(result.guest?.tpmDevicePresent, true);
    assert.equal(result.guest?.secureBootEnabled, true);
    assert.equal(result.guest?.setupMode, false);
    assert.equal(result.ready, true, JSON.stringify(result));
  };
  await verifyBoot();
  assert.ok((await stat(join(vmDir(id), 'uefi-secure-vars.fd'))).size > 65536);
  assert.ok((await stat(join(vmDir(id), 'tpm2'))).isDirectory());
  await machines.stop(id);
  await verifyBoot();
  console.log('Real Debian guest booted twice with Secure Boot and persistent TPM 2.0.');
} finally {
  if (id && machines.live.has(id)) await machines.stop(id).catch(() => {});
  await service.close();
  await machines.close();
  await rm(root, { recursive: true, force: true });
}
