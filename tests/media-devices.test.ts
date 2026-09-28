import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSchema } from '../server/model.ts';
import { audioArguments } from '../shared/hardware.ts';
import { MediaDevices } from '../server/media-devices.ts';

test('HDA audio uses the selected host backend and rejects unsupported ARM64 PCI profiles', () => {
  const config = createSchema.parse({ name: 'media', hardware: { devices: {
    audio: 'hda-duplex', audioBackend: 'dsound' } } });
  assert.deepEqual(audioArguments(config), ['-audiodev', 'dsound,id=sakura-audio',
    '-device', 'ich9-intel-hda', '-device', 'hda-duplex,audiodev=sakura-audio']);
  assert.equal(createSchema.safeParse({ name: 'arm-media', architecture: 'aarch64',
    distro: 'debian', firmware: 'uefi', hardware: { devices: {
      audio: 'hda-duplex', audioBackend: 'dsound' } } }).success, false);
});

test('media settings preview reviewed audio changes and forward typed USB media rules', async () => {
  const vmId = randomUUID();
  const vm = { id: vmId, name: 'media-vm', memoryMiB: 1024,
    architecture: 'x86_64' as const, hardware: undefined as any };
  let status = 'stopped';
  const usbActions: unknown[] = [];
  const usbView = { ready: false, hostDevices: '', hostError: '',
    rules: [], configured: [], events: [] };
  const usb = { view: async () => usbView,
    action: async (_id: string, input: unknown) => { usbActions.push(input); return usbView; } } as any;
  const machines = { records: new Map([[vmId, vm]]), get: () => vm,
    state: () => status, requireUnlocked: () => {},
    configureHardware: async (_id: string, hardware: unknown, expected: any) => {
      assert.deepEqual(expected.hardware, vm.hardware || {});
      vm.hardware = hardware;
    },
    exec: async () => ({ code: 0,
      stdout: 'AUDIO\n0 [HDA]: HDA\nVIDEO\n/dev/video0\n', stderr: '' }),
  } as any;
  const media = new MediaDevices(machines, usb, undefined, undefined,
    async (_machines, backend) => ({ available: backend !== 'dsound',
      ...(backend === 'dsound' ? { reason: 'host playback unavailable' } : {}) }));
  const unavailable = await media.action(vmId,
    { operation: 'preview-audio', mode: 'host' }) as { ready: boolean; reasons: string[] };
  assert.equal(unavailable.ready, false);
  assert.match(unavailable.reasons.join(' '), /host playback unavailable/);
  const preview = await media.action(vmId,
    { operation: 'preview-audio', mode: 'virtual' }) as { ready: boolean;
      previewToken: string; qemuAudioArguments: string[] };
  assert.equal(preview.ready, true);
  assert.match(preview.qemuAudioArguments.join(' '), /hda-duplex/);
  await assert.rejects(media.action(vmId, { operation: 'apply-audio', mode: 'virtual',
    previewToken: '0'.repeat(64) }), /预览已过期/);
  await media.action(vmId, { operation: 'apply-audio', mode: 'virtual',
    previewToken: preview.previewToken });
  assert.equal(vm.hardware.devices.audio, 'hda-duplex');
  assert.equal(vm.hardware.devices.audioBackend, 'none');
  await media.action(vmId, { operation: 'save-usb', kind: 'camera',
    vendorId: 0x1234, productId: 0x5678 });
  assert.deepEqual(usbActions[0], { operation: 'save-rule', mediaKind: 'camera',
    vendorId: 0x1234, productId: 0x5678 });
  status = 'running';
  const view = await media.view(vmId);
  assert.match(view.guest?.audio || '', /HDA/);
  assert.match(view.guest?.video || '', /video0/);
  await media.action(vmId, { operation: 'attach-usb', ruleId: randomUUID() });
  assert.equal((usbActions[1] as any).operation, 'apply-rule');
  media.close();
});
