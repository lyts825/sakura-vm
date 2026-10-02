import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSyscallProfile, syscallProfileInput } from '../server/syscall-profile.ts';
import { syscallIdentityFixture, syscallVmId } from './helpers/syscall-identity.ts';

test('seccomp requires confirmation, keeps the selected project result and redacts secrets', async () => {
  const f = syscallIdentityFixture();
  await assert.rejects(f.run({ mode: 'run', command: 'echo' }), /confirmed=true/);
  assert.equal(f.rootCommands.length, 0); assert.equal(f.launches.length, 0);
  const result = await f.run();
  assert.equal(result.code, 7); assert.equal(result.ready, false);
  assert.equal('projectId' in result && result.projectId, '0123456789abcdef');
  assert.equal('directory' in result && result.directory, '/workspace/limited');
  assert.equal('networkIsolation' in result && result.networkIsolation, 'private');
  assert.equal('stdout' in result && result.stdout, '[私密配置已隐藏] output');
  assert.equal('stderr' in result && result.stderr, '[私密配置已隐藏]');
  assert.throws(() => syscallProfileInput.parse({ mode: 'run', profile: 'unknown' }));
  assert.throws(() => syscallProfileInput.parse({ mode: 'run', command: 'echo', unexpected: true }));
});

test('a pre-cancelled seccomp request does not prepare or issue any command', async () => {
  const f = syscallIdentityFixture(); f.abort.abort();
  await assert.rejects(f.run(), error => error === f.abort.signal.reason);
  assert.equal(f.rootCommands.length, 0); assert.equal(f.launches.length, 0);
  assert.equal(f.releases(), 0); assert.equal(f.closes(), 0);
});

test('seccomp install publishes only the fixed system helper and verifies both policies without project config', async () => {
  const f = syscallIdentityFixture(), files: Array<{ path: string; content: string }> = [];
  f.workspaces.config = async () => { throw new Error('Administrator install must not read project config'); };
  f.machines.writeGuestFile = async (_id, path, content) => { files.push({ path, content }); };
  const result = await runSyscallProfile(f.machines, syscallVmId, { mode: 'install' }, undefined, f.workspaces);
  assert.equal(result.ready, true); assert.equal(result.executed, true);
  assert.equal(files.length, 1); assert.equal(files[0].path, '/usr/local/lib/sakura/seccomp-run.py');
  assert.ok(files[0].content.includes('PR_SET_NO_NEW_PRIVS')); assert.ok(files[0].content.includes('CLONE_NAMESPACE_FLAGS'));
  assert.ok(f.rootCommands.some(command => command.includes('--self-test restricted') && command.includes('--self-test networkless')));
  assert.ok(f.rootCommands.every(command => command.startsWith('/usr/bin/env -i ') && command.includes('cd /\nset -eu')));
  assert.ok(f.rootCommands.every(command => !command.includes('ip netns exec') && !command.includes('seccomp-private-value')));
  assert.ok(f.rootCommands.some(command => command.includes('chown 0:0') && command.includes('chmod 755')));
  assert.equal(f.resolves(), 0); assert.equal(f.launches.length, 0);
});

test('seccomp install refuses foreign system directories before publishing the helper', async () => {
  const f = syscallIdentityFixture(), exec = f.machines.exec; let writes = 0;
  f.machines.exec = async (...args) => {
    await exec(...args); return { code: args[1].includes('SAKURA_SECCOMP_PARENT_CHECK') ? 1 : 0, stdout: '', stderr: '' };
  };
  f.machines.writeGuestFile = async () => { ++writes; };
  await assert.rejects(runSyscallProfile(f.machines, syscallVmId, { mode: 'install' }),
    (error: any) => error.code === 'SYSCALL_SYSTEM_DIRECTORY_INVALID');
  assert.equal(writes, 0); assert.equal(f.rootCommands.length, 2);
});

test('seccomp install does not continue helper publication in a replacement Live', async () => {
  const f = syscallIdentityFixture(), exec = f.machines.exec; let writes = 0;
  f.machines.exec = async (...args) => { const result = await exec(...args); f.machines.live.set(syscallVmId, {} as any); return result; };
  f.machines.writeGuestFile = async () => { ++writes; };
  await assert.rejects(runSyscallProfile(f.machines, syscallVmId, { mode: 'install' }),
    (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(writes, 0); assert.equal(f.rootCommands.length, 1);
});
