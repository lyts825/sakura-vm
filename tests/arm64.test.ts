import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchema } from '../server/model.ts';
import { distroInfo } from '../server/images.ts';
import { cloudUserData } from '../server/seed.ts';

test('ARM64 instances require a matching Debian image, UEFI and TCG-compatible acceleration', () => {
  const config = { name: 'arm-test', distro: 'debian', architecture: 'aarch64',
    firmware: 'uefi', accelerator: 'tcg' } as const;
  assert.equal(createSchema.parse(config).architecture, 'aarch64');
  assert.match(distroInfo('debian', 'aarch64').file, /debian-12-arm64\.qcow2$/);
  assert.throws(() => createSchema.parse({ ...config, firmware: 'bios' }));
  assert.throws(() => createSchema.parse({ ...config, distro: 'alpine' }));
  assert.throws(() => createSchema.parse({ ...config, accelerator: 'whpx' }));
});

test('ARM64 cloud-init writes the readiness marker to the PL011 serial device', () => {
  assert.match(cloudUserData('arm-test', 'ssh-rsa example', '/dev/ttyAMA0'),
    /SAKURA_READY.*\/dev\/ttyAMA0/);
  assert.match(cloudUserData('x86-test', 'ssh-rsa example'), /SAKURA_READY.*\/dev\/ttyS0/);
});
