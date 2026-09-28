import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Machines } from '../server/machines.ts';
import { runSyscallProfile, syscallProfileInput } from '../server/syscall-profile.ts';

test('seccomp command requires explicit confirmation and remains shell quoted', async () => {
  const commands: string[] = [];
  const machines = {
    state: () => 'running', requireUnlocked: () => {},
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  await assert.rejects(runSyscallProfile(machines, 'vm',
    { mode: 'run', command: 'echo' }), /confirmed=true/);
  assert.equal(commands.length, 0);
  const value = "hello'; touch /tmp/escaped; echo '";
  const result = await runSyscallProfile(machines, 'vm', {
    mode: 'run', command: 'printf', args: [value], confirmed: true,
  });
  assert.equal(result.ready, true);
  assert.equal(commands.length, 2);
  assert.match(commands[1], /'hello'\\''; touch \/tmp\/escaped; echo '\\'''/);
  assert.throws(() => syscallProfileInput.parse({ mode: 'run', profile: 'unknown' }));
});

test('seccomp install writes a guest helper and verifies both policies', async () => {
  const commands: string[] = [], files: Array<{ path: string; content: string }> = [];
  const machines = {
    state: () => 'running', requireUnlocked: () => {},
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
    writeGuestFile: async (_id: string, path: string, content: string) => {
      files.push({ path, content });
    },
  } as unknown as Machines;
  const result = await runSyscallProfile(machines, 'vm', { mode: 'install' });
  assert.equal(result.ready, true);
  assert.equal(result.executed, true);
  assert.equal(files[0].path, '/usr/local/lib/sakura/seccomp-run.py');
  assert.match(files[0].content, /PR_SET_NO_NEW_PRIVS/);
  assert.ok(commands.some((command) => command.includes('--self-test restricted') &&
    command.includes('--self-test networkless')));
});
