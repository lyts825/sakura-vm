import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Machines } from '../server/machines.ts';
import { inspectTrustedBoot } from '../server/trusted-boot.ts';

test('TPM and Secure Boot check separates host prerequisites from guest evidence', async () => {
  const missing = join(tmpdir(), 'sakura-missing-trusted-boot-file');
  let running = false;
  let response = '';
  const machines = {
    get: () => ({ firmware: 'uefi' }),
    state: () => running ? 'running' : 'stopped',
    exec: async () => ({ code: 0, stdout: response, stderr: '' }),
  } as unknown as Machines;
  const paths = { qemu: missing, secureFirmware: missing,
    varsTemplate: missing, swtpm: missing };
  const stopped = await inspectTrustedBoot(machines, 'vm', paths);
  assert.equal(stopped.guest, null);
  assert.equal(stopped.ready, false);
  assert.equal(stopped.host.tpmBackend, false);
  running = true;
  response = 'EFI=yes\nSecureBoot=0\nSetupMode=1\nTPM=no\n';
  const untrusted = await inspectTrustedBoot(machines, 'vm', paths);
  assert.deepEqual(untrusted.guest, { efi: true, secureBootEnabled: false,
    setupMode: true, tpmDevicePresent: false });
  assert.equal(untrusted.ready, false);
  response = 'EFI=yes\nSecureBoot=1\nSetupMode=0\nTPM=yes\n';
  const trusted = await inspectTrustedBoot(machines, 'vm', paths);
  assert.equal(trusted.observed, true);
  assert.equal(trusted.ready, false);
  assert.equal(trusted.guest?.setupMode, false);
});
