import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectVirtioFs } from '../server/virtio-fs.ts';
import type { Machines } from '../server/machines.ts';

const vmId = '6635836f-891f-49d1-98bf-833ad751f2fa';
const paths = { qemu: 'qemu', virtiofsd: 'virtiofsd' };
const machines = (running: boolean, output = '') => ({
  get: () => ({ architecture: 'x86_64' }),
  state: () => running ? 'running' : 'stopped',
  exec: async () => ({ code: 0, stdout: output, stderr: '' }),
}) as unknown as Machines;

test('Virtio-FS check distinguishes actual guest mounts from available host prerequisites', async () => {
  const probe = async (_file: string, args: string[]) => ({ ok: true,
    output: args[0] === '-device' ? 'vhost-user-fs-pci\nvirtio-9p-pci' :
      args[0] === '-object' ? 'memory-backend-memfd' : 'virtiofsd 1.0' });
  const result = await inspectVirtioFs(machines(true,
    'VIRTIOFS=yes\n9P=yes\nMOUNT=/mnt/shared|virtiofs|host\n'), vmId,
    undefined, paths, probe);
  assert.equal(result.host.qemuVirtioFs, true);
  assert.equal(result.host.qemuNineP, true);
  assert.equal(result.host.sharedMemory, true);
  assert.deepEqual(result.guest?.mounts, [{ path: '/mnt/shared', type: 'virtiofs', tag: 'host' }]);
  assert.equal(result.ready, false);
  assert.equal(result.executed, false);
  assert.ok(result.blockers.some((item) => item.includes('尚未编排')));
});

test('Virtio-FS check reports unavailable QEMU and stopped guest without claiming a mount', async () => {
  const result = await inspectVirtioFs(machines(false), vmId, undefined, paths,
    async () => ({ ok: false, output: 'unsupported' }));
  assert.equal(result.guest, null);
  assert.equal(result.host.qemuVirtioFs, false);
  assert.ok(result.blockers.some((item) => item.includes('QEMU 构建')));
  assert.ok(result.blockers.some((item) => item.includes('客户机未运行')));
});
