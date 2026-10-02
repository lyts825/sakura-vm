import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../server/model.ts';
import { projectVersion } from '../server/workspaces.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import { checkSyscallProfile } from '../server/syscall-profile.ts';
import { syscallIdentityFixture, syscallVmId, syscallProjectId, copySyscallProject } from './helpers/syscall-identity.ts';

test('host and private seccomp launches keep original UID binding, once-resolved environment and bounded stdin', async () => {
  for (const mode of ['host', 'private'] as const) {
    const f = syscallIdentityFixture(mode), result = await f.run();
    assert.equal(result.code, 7); assert.equal(result.ready, false);
    assert.equal('projectId' in result && result.projectId, syscallProjectId);
    assert.equal('directory' in result && result.directory, '/workspace/limited');
    assert.equal('networkIsolation' in result && result.networkIsolation, mode);
    const [, , project, execution, , , timeout, , , pins] = f.launches[0];
    assert.equal(project._workspace, syscallProjectId); assert.equal(project.networkIsolation, mode);
    assert.equal(Object.getOwnPropertyDescriptor(project, '_workspace')?.enumerable, false);
    assert.equal(execution.environment?.TOKEN, 'seccomp-private-value');
    assert.equal(execution.environment?.PATH, '/workspace/tools'); assert.equal('HOME' in execution.environment!, false);
    assert.match(execution.command, /^\/usr\/bin\/python3 -I -c /); assert.match(execution.command, /--run 'restricted' '60' '--' 'printf' 'UID_TEST_MARKER'$/);
    assert.equal(timeout, 75000); assert.equal(pins?.expectedLive, f.live); assert.equal(f.resolves(), 1);
    const frame = projectIdentityPayload(execution).input;
    assert.ok(frame.length < 65536 + 32); assert.ok(frame.includes(Buffer.from('UID_TEST_MARKER')));
    assert.ok(f.rootCommands.every(command => !command.includes('UID_TEST_MARKER') && !command.includes('seccomp-private-value')));
    assert.deepEqual(f.events, ['prepare', 'admin-status', 'uid-start', 'domain-stopped', 'native-closed', 'release', 'close']);
  }
});

test('concurrent outside project selection cannot change a named original operation', async () => {
  const f = syscallIdentityFixture(), read = f.workspaces.config;
  f.workspaces.config = async (...args) => { await Promise.resolve(); f.switchOutside(); return read(...args); };
  await f.run(); assert.equal(f.launches[0][2]._workspace, syscallProjectId);
  assert.equal(f.workspaces.projects.current(syscallVmId), 'fedcba9876543210');
});

test('lease scope, config and Live mismatches fail before administrative probe or UID execution', async () => {
  for (const corrupt of [
    (lease: any) => { lease.projectId = 'fedcba9876543210'; },
    (lease: any) => { lease.captured.live = {}; },
    (lease: any) => { lease.captured.configVersion = '0'.repeat(64); },
    (lease: any) => { lease.captured.project = copySyscallProject(lease.captured.project, 'fedcba9876543210'); },
    (lease: any) => { lease.captured.project.environment = { MODE: 'changed' }; },
  ]) {
    const f = syscallIdentityFixture(), prepare = f.manager.prepare;
    f.manager.prepare = async (...args) => { const lease = await prepare(...args); corrupt(lease); return lease; };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.rootCommands.length, 0); assert.equal(f.closes(), 1);
  }
});

test('changed original config and Live during secret resolution reject before the system probe', async () => {
  for (const change of ['config', 'live', 'scope', 'stopped']) {
    const f = syscallIdentityFixture(), resolve = f.workspaces.resolveProject;
    f.workspaces.resolveProject = async (...args) => {
      const value = await resolve(...args);
      if (change === 'config') f.project.directory = '/workspace/other';
      if (change === 'live') f.machines.live.set(syscallVmId, {} as any);
      if (change === 'scope') f.forceScope();
      if (change === 'stopped') f.setState('stopped');
      return value;
    };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.rootCommands.length, 0); assert.equal(f.releases(), 1);
  }
});

test('same JSON hash with a wrong original scope cannot authorize execution', async () => {
  const f = syscallIdentityFixture(), read = f.workspaces.config;
  const wrong = copySyscallProject(f.project, 'fedcba9876543210');
  assert.equal(projectVersion(wrong), projectVersion(f.project));
  f.workspaces.config = async () => wrong;
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.rootCommands.length, 0); assert.equal(f.launches.length, 0);
  f.workspaces.config = read;
});

test('trusted system probes clear environment and cwd while user argv exists only in the UID frame', async () => {
  const f = syscallIdentityFixture();
  const args = ["a' ; printf injected", '$TOKEN', '$(touch /root/uid-test)', 'hello\nworld'];
  await f.run({ mode: 'run', command: 'UID_TEST_COMMAND', args, confirmed: true });
  assert.equal(f.rootCommands.length, 1); const command = f.rootCommands[0];
  assert.match(command, /^\/usr\/bin\/env -i PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin HOME=\/ LANG=C LC_ALL=C \/bin\/sh -c /);
  assert.ok(command.includes('cd /\nset -eu')); assert.ok(command.includes('O_NOFOLLOW'));
  assert.ok(command.includes('--self-test restricted')); assert.ok(command.includes('--self-test networkless'));
  for (const value of ['UID_TEST_COMMAND', ...args, 'seccomp-private-value', '/workspace/limited']) assert.equal(command.includes(value), false);
  assert.ok(f.launches[0][3].command.includes("'UID_TEST_COMMAND'"));
});

test('oversized accepted args fail with 413 before launching a partial command', async () => {
  const f = syscallIdentityFixture();
  await assert.rejects(f.run({ mode: 'run', command: 'printf', args: Array(32).fill('x'.repeat(4096)), confirmed: true }),
    (error: any) => error.status === 413 && error.code === 'PROJECT_IDENTITY_PAYLOAD_INVALID');
  assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
});

test('cancel waits for original full-domain cleanup before releasing preparation', async () => {
  const f = syscallIdentityFixture(); let started!: () => void, closeDomain!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  const cleanup = new Promise<void>(resolve => { closeDomain = resolve; });
  f.options.runProjectTask = async (...args) => {
    assert.ok(f.leaseOpen()); started();
    await new Promise<void>(resolve => args[4].addEventListener('abort', () => resolve(), { once: true }));
    await cleanup; assert.ok(f.leaseOpen());
    f.events.push('domain-stopped', 'native-closed'); args[4].throwIfAborted();
    return { code: 0, stdout: '', stderr: '' };
  };
  const operation = f.run(), rejection = assert.rejects(operation, (error: any) => error.name === 'AbortError');
  await running; f.abort.abort(); await Promise.resolve();
  assert.equal(f.releases(), 0); assert.equal(f.closes(), 0); assert.ok(f.leaseOpen());
  closeDomain(); await rejection;
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
  assert.ok(f.events.indexOf('native-closed') < f.events.indexOf('release'));
});

test('native cleanup 503 propagates as the original exception rather than a command result', async () => {
  const f = syscallIdentityFixture(), failure = new AppError('original domain still running', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  f.options.runProjectTask = async () => { throw failure; };
  await assert.rejects(f.run(), error => error === failure);
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
});

test('frozen private cleanup errors keep status/code/cause while the public message is redacted', async () => {
  const f = syscallIdentityFixture(), failure = Object.freeze(new AppError('seccomp-private-value original domain unknown', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'));
  f.options.runProjectTask = async () => { throw failure; };
  await assert.rejects(f.run(), (error: any) => {
    assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(error.code, failure.code);
    assert.equal(error.cause, failure); assert.equal(error.message.includes('seccomp-private-value'), false);
    return true;
  });
});

test('combined cleanup errors retain native status/code and every original cause', async () => {
  const f = syscallIdentityFixture(), native = new AppError('original domain unknown', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  const release = new Error('lease release failed'), close = new Error('manager close failed');
  f.options.runProjectTask = async () => { throw native; };
  const prepare = f.manager.prepare;
  f.manager.prepare = async (...args) => {
    const lease = await prepare(...args), done = lease.release;
    lease.release = async () => { await done(); throw release; }; return lease;
  };
  f.manager.close = async () => { throw close; };
  await assert.rejects(f.run(), (error: any) => {
    assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(error.code, native.code);
    assert.equal(error.cause, native); assert.deepEqual((error as any).errors, [native, release, close]); return true;
  });
});

test('no stale output is returned after original config changes at the UID completion boundary', async () => {
  const f = syscallIdentityFixture(), run = f.options.runProjectTask!;
  f.options.runProjectTask = async (...args) => { const result = await run(...args); f.project.directory = '/workspace/changed'; return result; };
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
});

test('maximum configured timeout retains native task deadline and timedOut result', async () => {
  const f = syscallIdentityFixture(), run = f.options.runProjectTask!;
  f.options.runProjectTask = async (...args) => { await run(...args); return { code: 124, stdout: '', stderr: 'timed out' }; };
  const result = await f.run({ mode: 'run', command: 'sleep', args: ['600'], profile: 'networkless', timeoutSeconds: 300, confirmed: true });
  assert.equal(result.code, 124); assert.equal('timedOut' in result && result.timedOut, true);
  assert.equal(f.launches[0][6], 315000); assert.match(f.launches[0][3].command, /--run 'networkless' '300' '--' 'sleep' '600'$/);
});

test('readonly system status refuses a changed Live and performs no preparation', async () => {
  const f = syscallIdentityFixture(), exec = f.machines.exec;
  f.machines.exec = async (...args) => { const result = await exec(...args); f.machines.live.set(syscallVmId, {} as any); return result; };
  await assert.rejects(checkSyscallProfile(f.machines, syscallVmId), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.launches.length, 0); assert.equal(f.resolves(), 0);
});

test('unavailable system policies stop a prepared operation without UID fallback', async () => {
  const f = syscallIdentityFixture();
  f.machines.exec = async () => ({ code: 1, stdout: '', stderr: 'helper digest differs' });
  await assert.rejects(f.run(), /未就绪/); assert.equal(f.launches.length, 0);
  assert.equal(f.releases(), 1); assert.equal(f.closes(), 1);
});
