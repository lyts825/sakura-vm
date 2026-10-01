import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  gpgAgentForwardInput,
  guestGpgForwardingReady,
  runGpgAgentForward,
} from '../server/gpg-agent-forward.ts';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';

test('GPG forwarding requires a confirmed, bounded single command', async () => {
  let executions = 0;
  const machines = {
    requireUnlocked: () => {},
    state: () => 'running',
    exec: async () => {
      executions++;
      return { code: 0, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  assert.equal(gpgAgentForwardInput.safeParse({ command: 'gpg --sign', confirmed: false }).success, false);
  assert.equal(
    gpgAgentForwardInput.safeParse({ command: 'gpg --sign', confirmed: true, timeoutSeconds: 301 }).success,
    false,
  );
  assert.equal(
    gpgAgentForwardInput.safeParse({ command: 'gpg --sign', confirmed: true, hostSocket: '/tmp/other' })
      .success,
    false,
  );
  await assert.rejects(runGpgAgentForward(machines, 'vm', { command: 'true', confirmed: false }));
  assert.equal(executions, 0);
});

test('GPG directory cleanup waits for scope confirmation, retries, and retains an uncertain task home', async (t) => {
  const previousSocket = process.env.SAKURA_GPG_EXTRA_SOCKET;
  const socket =
    process.platform === 'win32'
      ? '\\\\.\\pipe\\sakura-gpg-test-' + randomUUID()
      : join(tmpdir(), 'sakura-gpg-test-' + randomUUID() + '.sock');
  const agent = createServer((connection) => {
    connection.end('OK owned test extra socket\n');
  });
  await new Promise<void>((resolve) => agent.listen(socket, resolve));
  process.env.SAKURA_GPG_EXTRA_SOCKET = socket;
  try {
    for (const mode of ['stage-retry', 'scope-failure', 'bridge-failure']) {
      await t.test(mode, async () => {
        const commands: string[] = [],
          events: string[] = [],
          live = {};
        let removals = 0,
          scopeConfirmed = false;
        const client = new EventEmitter() as any;
        client.openssh_forwardInStreamLocal = (_remote: string, done: (error?: Error) => void) => done();
        client.openssh_unforwardInStreamLocal = (_remote: string, done: () => void) => {
          events.push('bridge-close');
          done();
        };
        client.end = () => {
          events.push('client-close');
        };
        const machines = {
          live: new Map([['vm', live]]),
          requireUnlocked: () => {},
          state: () => 'running',
          locked: async (_id: string, action: () => Promise<unknown>) => action(),
          get: () => ({ distro: 'alpine' }),
          connect: async () => {
            if (mode === 'bridge-failure') throw new Error('owned bridge connection failed');
            return client;
          },
          exec: async (_id: string, command: string) => {
            commands.push(command);
            if (command.includes('sshd -T'))
              return {
                code: 0,
                stdout:
                  'disableforwarding no\nallowtcpforwarding remote\nallowstreamlocalforwarding remote\n',
                stderr: '',
              };
            if (command.includes('mktemp -d'))
              return { code: 0, stdout: '/tmp/sakura-gpg-owned123\n', stderr: '' };
            if (command.includes('# SAKURA_GUEST_TASK_RUN')) return { code: 7, stdout: '', stderr: '' };
            if (command.includes('sakura_owned_anchor')) {
              if (mode === 'scope-failure')
                return { code: 1, stdout: '', stderr: 'owned scope still active' };
              scopeConfirmed = true;
              events.push('scope-confirmed');
            }
            if (command.startsWith('rm -rf --')) {
              ++removals;
              if (mode !== 'bridge-failure') assert.equal(scopeConfirmed, true);
              if (mode !== 'bridge-failure') assert.ok(events.includes('client-close'));
              if (removals === 1) throw new Error('owned first directory cleanup connection failed');
            }
            return { code: 0, stdout: '', stderr: '' };
          },
        } as unknown as Machines;
        const workspaces = {
          resolvedConfig: async () => ({ directory: '/workspace', environment: {} }),
        } as unknown as Workspaces;
        const operation = runGpgAgentForward(
          machines,
          'vm',
          { command: 'exit 7', confirmed: true },
          undefined,
          workspaces,
        );
        if (mode === 'scope-failure') {
          await assert.rejects(operation, (error: any) => error.code === 'GUEST_TASK_CLEANUP_FAILED');
          assert.equal(removals, 0);
          assert.ok(events.includes('bridge-close'));
          assert.equal(
            commands.some((command) => command.includes('# SAKURA_GUEST_TASK_RETIRE')),
            false,
          );
        } else if (mode === 'bridge-failure') {
          await assert.rejects(operation, /owned bridge connection failed/);
          assert.equal(removals, 2);
          assert.equal(
            commands.some((command) => command.includes('# SAKURA_GUEST_TASK_RUN')),
            false,
          );
        } else {
          assert.equal((await operation).code, 7);
          assert.equal(removals, 2);
          assert.ok(events.indexOf('scope-confirmed') < events.indexOf('bridge-close'));
        }
      });
    }
  } finally {
    if (previousSocket === undefined) delete process.env.SAKURA_GPG_EXTRA_SOCKET;
    else process.env.SAKURA_GPG_EXTRA_SOCKET = previousSocket;
    await new Promise<void>((resolve) => agent.close(() => resolve()));
  }
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
