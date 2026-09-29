import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'linux') {
  console.log('Virtio-FS guest smoke requires Linux; skipped.');
  process.exit(0);
}
const distro = process.argv[2] || 'alpine';
if (!['alpine', 'debian', 'ubuntu'].includes(distro))
  throw new Error('Choose alpine, debian or ubuntu');
const root = await mkdtemp(join(tmpdir(), 'sakura-vfs-guest-'));
process.env.SAKURA_DATA_DIR = join(root, 'data');
if (distro === 'alpine') process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
else process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_QEMU_DIR ||= '/usr/bin';
const { createRuntime } = await import('../server/runtime.ts');
const { Machines } = await import('../server/machines.ts');
const { VirtioFsShares, VIRTIOFS_GUEST_PATH } = await import('../server/virtio-fs.ts');
const share = join(root, 'share');
await mkdir(share);
await writeFile(join(share, 'marker.txt'), 'sakura-virtiofs-verified\n');
const engine = await createRuntime();
const machines = new Machines(engine);
const service = new VirtioFsShares(machines);
let id = '';
try {
  await machines.init();
  await service.init();
  const vm = await machines.create({ name: `verify-vfs-${distro}`, distro,
    memoryMiB: distro === 'alpine' ? 512 : 1024,
    cpus: 2, diskGiB: 8, accelerator: 'tcg', forwards: [] });
  id = vm.id;
  await service.action(id, { operation: 'configure',
    policy: { enabled: true, hostPath: share, readOnly: true } });
  await machines.start(id);
  const deadline = Date.now() + 270_000;
  while (Date.now() < deadline && machines.state(id) === 'starting') await delay(500);
  assert.equal(machines.state(id), 'running', machines.logs.get(id));
  while (Date.now() < deadline && !(await service.view(id)).mounted) await delay(500);
  assert.equal((await service.view(id)).mounted, true,
    JSON.stringify((await service.view(id)).observation));
  const marker = await machines.exec(id, `cat ${VIRTIOFS_GUEST_PATH}/marker.txt`);
  assert.equal(marker.code, 0, marker.stderr);
  assert.equal(marker.stdout.trim(), 'sakura-virtiofs-verified');
  const readonly = await machines.exec(id,
    `touch ${VIRTIOFS_GUEST_PATH}/must-not-write 2>/dev/null`);
  assert.notEqual(readonly.code, 0, 'read-only share allowed a guest write');
  await machines.stop(id);
  await service.action(id, { operation: 'configure',
    policy: { enabled: true, hostPath: share, readOnly: false } });
  await machines.start(id);
  const writableDeadline = Date.now() + 270_000;
  while (Date.now() < writableDeadline && machines.state(id) === 'starting') await delay(500);
  assert.equal(machines.state(id), 'running', machines.logs.get(id));
  while (Date.now() < writableDeadline && !(await service.view(id)).mounted) await delay(500);
  assert.equal((await service.view(id)).mounted, true,
    JSON.stringify((await service.view(id)).observation));
  const writable = await machines.exec(id,
    `printf 'sakura-guest-write\\n' > ${VIRTIOFS_GUEST_PATH}/guest-write.txt`);
  assert.equal(writable.code, 0, writable.stderr);
  assert.equal(await readFile(join(share, 'guest-write.txt'), 'utf8'), 'sakura-guest-write\n');
  console.log(`Real ${distro} guest mounted Virtio-FS, enforced read-only mode and wrote to the host in writable mode.`);
} finally {
  if (id && machines.live.has(id)) await machines.stop(id).catch(() => {});
  await service.close();
  await machines.close();
  await rm(root, { recursive: true, force: true });
}
