import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Machines } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';
import { projectSchema, type Workspaces } from '../server/workspaces.ts';
import { runSyscallProfile, syscallProfileInput } from '../server/syscall-profile.ts';

function fixture() {
  const commands: string[] = [], locks = new Machines({} as Engine);
  let badNamespace = false, wait = false, started!: () => void;
  const executing = new Promise<void>((done) => { started = done; });
  const machines = {
    state: () => 'running', get: () => ({ distro: 'alpine' }), requireUnlocked: () => {},
    locked: locks.locked.bind(locks), live: new Map([['vm', {}]]),
    exec: async (_id: string, command: string, _timeout?: number, signal?: AbortSignal) => {
      commands.push(command);
      if (!command.includes('setsid sh -c')) return { code: badNamespace ? 1 : 0,
        stdout: '', stderr: badNamespace ? '项目命名空间已有网络路由' : '' };
      started();
      if (wait) await new Promise<void>((_done, reject) => {
        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return { code: 7, stdout: 'seccomp-private-value output', stderr: 'seccomp-private-value' };
    },
  } as unknown as Machines;
  const project = { ...projectSchema.parse({ directory: '/workspace/limited', networkIsolation: 'private',
    environment: { TOKEN: 'seccomp-private-value', PATH: '/workspace/tools' }, secrets: { TOKEN: 'seccomp-key' } }),
    _workspace: '0123456789abcdef' };
  const workspaces = { resolvedConfig: async () => project } as unknown as Workspaces;
  return { machines, commands, workspaces, executing,
    badNamespace: () => { badNamespace = true; }, wait: () => { wait = true; } };
}

test('seccomp commands require confirmation, run in the selected project and redact secrets', async () => {
  const f = fixture();
  await assert.rejects(runSyscallProfile(f.machines, 'vm',
    { mode: 'run', command: 'echo' }, undefined, f.workspaces), /confirmed=true/);
  assert.equal(f.commands.length, 0);
  const result = await runSyscallProfile(f.machines, 'vm', {
    mode: 'run', command: 'printf', args: ['hello'], confirmed: true,
  }, undefined, f.workspaces);
  assert.equal(result.code, 7);
  assert.equal(result.ready, false);
  assert.equal('projectId' in result && result.projectId, '0123456789abcdef');
  assert.equal('directory' in result && result.directory, '/workspace/limited');
  assert.equal('networkIsolation' in result && result.networkIsolation, 'private');
  assert.equal('stdout' in result && result.stdout, '[私密配置已隐藏] output');
  assert.equal('stderr' in result && result.stderr, '[私密配置已隐藏]');
  const command = f.commands.find((value) => value.includes('setsid sh -c'))!;
  assert.ok(command.indexOf('ip netns exec sk-0123456789abcdef') < command.indexOf('export TOKEN='));
  assert.ok(command.includes('/usr/bin/python3 -I /usr/local/lib/sakura/seccomp-run.py --run'));
  assert.ok(f.commands.filter((value) => value !== command).every((value) => !value.includes('seccomp-private-value')));
  f.badNamespace();
  await assert.rejects(runSyscallProfile(f.machines, 'vm',
    { mode: 'run', command: 'true', confirmed: true }, undefined, f.workspaces), /网络路由/);
  assert.equal(f.commands.filter((value) => value.includes('setsid sh -c')).length, 1);
  assert.throws(() => syscallProfileInput.parse({ mode: 'run', profile: 'unknown' }));
});

test('seccomp cancellation cleans its process group before releasing the instance lock', async () => {
  const f = fixture(); f.wait();
  const abort = new AbortController();
  const operation = runSyscallProfile(f.machines, 'vm',
    { mode: 'run', command: 'sleep', args: ['600'], confirmed: true }, abort.signal, f.workspaces);
  const rejected = assert.rejects(operation);
  await f.executing;
  await assert.rejects(f.machines.locked('vm', async () => {}), /另一项操作/);
  abort.abort(); await rejected;
  assert.ok(f.commands.some((command) => command.includes('kill -TERM --')));
  await f.machines.locked('vm', async () => {});
});

test('seccomp install writes a guest helper and verifies both policies without project configuration', async () => {
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
  assert.ok(commands.some((command) => command.includes('--self-test restricted') &&
    command.includes('--self-test networkless')));
  assert.ok(commands.every((command) => !command.includes('ip netns exec')));
});
