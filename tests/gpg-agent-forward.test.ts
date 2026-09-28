import test from 'node:test';
import assert from 'node:assert/strict';
import { gpgAgentForwardInput, guestGpgForwardingReady,
  runGpgAgentForward } from '../server/gpg-agent-forward.ts';
import type { Machines } from '../server/machines.ts';

test('GPG forwarding requires a confirmed, bounded single command', async () => {
  let executions = 0;
  const machines = {
    requireUnlocked: () => {}, state: () => 'running',
    exec: async () => { executions++; return { code: 0, stdout: '', stderr: '' }; },
  } as unknown as Machines;
  assert.equal(gpgAgentForwardInput.safeParse({ command: 'gpg --sign',
    confirmed: false }).success, false);
  assert.equal(gpgAgentForwardInput.safeParse({ command: 'gpg --sign',
    confirmed: true, timeoutSeconds: 301 }).success, false);
  assert.equal(gpgAgentForwardInput.safeParse({ command: 'gpg --sign',
    confirmed: true, hostSocket: '/tmp/other' }).success, false);
  await assert.rejects(runGpgAgentForward(machines, 'vm',
    { command: 'true', confirmed: false }));
  assert.equal(executions, 0);
});

test('remote Unix forwarding accepts only guest SSH settings that allow it', async () => {
  let config = 'disableforwarding no\nallowtcpforwarding no\nallowstreamlocalforwarding yes\n';
  const machines = {
    exec: async () => ({ code: 0, stdout: config, stderr: '' }),
  } as unknown as Machines;
  assert.equal(await guestGpgForwardingReady(machines, 'vm'), false);
  config = 'disableforwarding no\nallowtcpforwarding remote\nallowstreamlocalforwarding remote\n';
  assert.equal(await guestGpgForwardingReady(machines, 'vm'), true);
  config = 'disableforwarding yes\nallowtcpforwarding yes\nallowstreamlocalforwarding yes\n';
  assert.equal(await guestGpgForwardingReady(machines, 'vm'), false);
});
