import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { gpuComputeStatus } from '../server/gpu-compute.ts';
import { devicePassthroughPreview, devicePassthroughInput } from '../server/device-passthrough-preview.ts';
import { VtpmEnrollment } from '../server/vtpm-enrollment.ts';
import type { Machines } from '../server/machines.ts';

const id = '11111111-1111-4111-8111-111111111111';

test('compute check needs a real driver query and guest device nodes', async () => {
  let running = false;
  let nodes = false;
  let nvidia = false;
  let rocm = false;
  const machines = {
    get: () => ({ id }),
    state: () => (running ? 'running' : 'stopped'),
    exec: async (_id: string, command: string) => {
      if (command.includes('nvidia-smi'))
        return { code: nvidia ? 0 : 127, stdout: nvidia ? 'NVIDIA A10, GPU-123\n' : '', stderr: '' };
      if (command.includes('rocminfo'))
        return { code: rocm ? 0 : 127, stdout: rocm ? 'Device Type: GPU\nName: gfx1030\n' : '', stderr: '' };
      return { code: nodes ? 0 : 1, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  assert.equal((await gpuComputeStatus(machines, id, {}, 'check')).ready, false);
  running = true;
  nvidia = true;
  assert.equal((await gpuComputeStatus(machines, id, { provider: 'cuda' }, 'check')).ready, false);
  nodes = true;
  const cuda = await gpuComputeStatus(machines, id, { provider: 'cuda' }, 'run');
  assert.equal(cuda.ready, true);
  assert.equal(cuda.cuda?.devices[0], 'NVIDIA A10, GPU-123');
  nvidia = false;
  rocm = true;
  assert.equal((await gpuComputeStatus(machines, id, { provider: 'auto' }, 'check')).ready, true);
  await assert.rejects(gpuComputeStatus(machines, id, { provider: 'invalid' }, 'check'));
});

test('PCI and USB declaration previews never mutate host or VM devices', async () => {
  let calls = 0;
  const machines = {
    get: () => ({ architecture: 'x86_64' }),
    exec: async () => {
      calls++;
      throw new Error('preview must be read-only');
    },
  } as unknown as Machines;
  const usb = await devicePassthroughPreview(
    machines,
    id,
    { mode: 'preview', device: { kind: 'usb', vendorId: 0x1234, productId: 0x5678 } },
    'run',
    '/nonexistent',
    'win32',
  );
  assert.equal(usb.ready, true);
  assert.equal(usb.prerequisitesMet, true);
  assert.equal(usb.checks.hostDevicePresent, null);
  const pci = await devicePassthroughPreview(
    machines,
    id,
    { mode: 'preview', device: { kind: 'pci', address: '0000:01:00.0' } },
    'run',
    '/nonexistent',
    'win32',
  );
  assert.equal(pci.prerequisitesMet, false);
  assert.equal(pci.checks.linuxHost, false);
  assert.equal(calls, 0);
  assert.equal(
    devicePassthroughInput.safeParse({ mode: 'preview', device: { kind: 'pci', address: '0000:01:00.0;rm' } })
      .success,
    false,
  );
  assert.equal(
    devicePassthroughInput.safeParse({ mode: 'preview', device: { kind: 'usb', vendorId: 0, productId: 1 } })
      .success,
    false,
  );
});

test('vTPM enrollment persists public fingerprints and computes rotation reminders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-vtpm-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  const file = join(root, 'enrollment.json');
  const machines = { get: () => ({ id }) } as unknown as Machines;
  const fingerprint = 'a'.repeat(64);
  const service = new VtpmEnrollment(machines, file);
  try {
    await service.init();
    const input = {
      mode: 'save',
      fingerprint,
      label: 'Signing key',
      enrolledAt: '2020-01-01T00:00:00.000Z',
      rotateAfterDays: 365,
    };
    const preview = await service.action(id, input, 'check');
    assert.equal(preview.records.length, 0);
    assert.equal((preview as { preview?: { rotateDueAt: string } }).preview?.rotateDueAt,
      '2020-12-31T00:00:00.000Z');
    await service.action(id, input, 'run');
    assert.equal(service.status(id).overdueCount, 1);
    assert.equal(service.status(id).records[0].fingerprint, fingerprint);
    await assert.rejects(service.action(id, { ...input, privateKey: 'secret' }, 'run'));
    await service.close();
    const restored = new VtpmEnrollment(machines, file);
    await restored.init();
    assert.equal(restored.status(id).records.length, 1);
    await restored.action(id, { mode: 'remove', fingerprint }, 'run');
    assert.equal(restored.status(id).records.length, 0);
    await restored.close();
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
