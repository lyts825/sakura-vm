import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectExecution } from '../server/project-execution.ts';
import type { ProjectTerminals } from '../server/project-terminals.ts';
import { AppError } from '../server/model.ts';
import { projectIdentityPayload } from '../server/project-identity.ts';
import { syscallIdentityFixture as fixture, syscallVmId as id, syscallProjectId as projectId,
  copySyscallProject } from './helpers/syscall-identity.ts';

function setup() {
  const f = fixture();
  const terminals = { workspaces: f.workspaces, prepare: (...args: Parameters<ProjectTerminals['prepare']>) => f.manager.prepare(...args) } as ProjectTerminals;
  const service = new ProjectExecution(f.machines, terminals, (...args) => f.options.runProjectTask!(...args));
  const run = (command = 'UID_TEST_MARKER', requested = projectId, signal = f.abort.signal) =>
    service.run(id, { command, timeoutSeconds: 30 }, requested, signal);
  return { ...f, service, run };
}

test('project exec resolves the captured non-enumerable config once and pins its original Live for native admission', async () => {
  const f = setup(), result = await f.run();
  assert.equal(result.scope, 'project'); assert.equal(result.code, 7);
  assert.equal(result.stdout, '[私密配置已隐藏] output'); assert.equal(f.resolves(), 1);
  const [, , project, execution, , , timeout, , , pins] = f.launches[0];
  assert.equal(project._workspace, projectId); assert.equal(Object.getOwnPropertyDescriptor(project, '_workspace')?.enumerable, false);
  assert.equal(pins?.expectedLive, f.live); assert.equal(execution.environment?.TOKEN, 'seccomp-private-value');
  assert.equal(execution.command, 'UID_TEST_MARKER'); assert.equal(timeout, 30000);
  assert.ok(projectIdentityPayload(execution).input.includes(Buffer.from('UID_TEST_MARKER')));
  assert.deepEqual(f.rootCommands, []);
  assert.deepEqual(f.events, ['prepare', 'uid-start', 'domain-stopped', 'native-closed', 'release']);
  await f.service.close();
});

test('malformed captured lease scope/hash/Live is refused before environment resolution or execution', async () => {
  for (const corrupt of [
    (lease: any) => { lease.captured = undefined; },
    (lease: any) => { lease.captured.live = {}; },
    (lease: any) => { lease.captured.configVersion = '0'.repeat(64); },
    (lease: any) => { lease.captured.project = copySyscallProject(lease.captured.project, 'fedcba9876543210'); },
  ]) {
    const f = setup(), prepare = f.manager.prepare;
    f.manager.prepare = async (...args) => { const lease = await prepare(...args); corrupt(lease); return lease; };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.resolves(), 0); assert.equal(f.releases(), 1);
    await f.service.close();
  }
});

test('changing Live during preparation cannot redirect a request to the replacement guest', async () => {
  const f = setup(), prepare = f.manager.prepare;
  f.manager.prepare = async (...args) => { const lease = await prepare(...args); f.machines.live.set(id, {} as any); return lease; };
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); await f.service.close();
});

test('environment resolution cannot change the captured config, scope or original live', async () => {
  for (const change of ['config', 'scope', 'live']) {
    const f = setup(), resolve = f.workspaces.resolveProject;
    f.workspaces.resolveProject = async (...args) => {
      const value = await resolve(...args);
      if (change === 'config') f.project.environment = { MODE: 'changed' };
      if (change === 'scope') f.forceScope();
      if (change === 'live') f.machines.live.set(id, {} as any);
      return value;
    };
    await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
    assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); await f.service.close();
  }
});

test('a configuration returned from another original scope is refused even with the same JSON version', async () => {
  const f = setup(); f.workspaces.config = async () => copySyscallProject(f.project, 'fedcba9876543210');
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.launches.length, 0); await f.service.close();
});

test('changed original Live at task completion cannot publish stale stdout or successful results', async () => {
  const f = setup(), run = f.options.runProjectTask!;
  f.options.runProjectTask = async (...args) => { const result = await run(...args); f.machines.live.set(id, {} as any); return result; };
  await assert.rejects(f.run(), (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(f.releases(), 1); await f.service.close();
});

test('body plus captured environment beyond the native boundary returns 413 without issuing a command', async () => {
  const f = setup();
  await assert.rejects(f.run('x'.repeat(65536)), (error: any) => error.status === 413 && error.code === 'PROJECT_IDENTITY_PAYLOAD_INVALID');
  assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); await f.service.close();
});

test('a preparation cancellation is applied before project command launch', async () => {
  const f = setup(), prepare = f.manager.prepare, abort = new AbortController();
  f.manager.prepare = async (...args) => { const lease = await prepare(...args); return { ...lease, signal: abort.signal }; };
  const resolve = f.workspaces.resolveProject;
  f.workspaces.resolveProject = async (...args) => { const result = await resolve(...args); abort.abort(); return result; };
  await assert.rejects(f.run(), error => error === abort.signal.reason);
  assert.equal(f.launches.length, 0); assert.equal(f.releases(), 1); await f.service.close();
});

test('the response waits for an asynchronous lease release after complete task closure', async () => {
  const f = setup(), prepare = f.manager.prepare; let entered!: () => void, finish!: () => void, returned = false;
  const releasing = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { finish = resolve; });
  f.manager.prepare = async (...args) => {
    const lease = await prepare(...args), release = lease.release;
    lease.release = async () => { entered(); await gate; await release(); }; return lease;
  };
  const operation = f.run().then(result => { returned = true; return result; }); await releasing;
  assert.equal(returned, false); assert.equal(f.releases(), 0); assert.ok(f.events.includes('native-closed'));
  finish(); await operation; assert.equal(returned, true); assert.equal(f.releases(), 1); await f.service.close();
});

test('an unconfirmed lease release prevents a successful command response', async () => {
  const f = setup(), prepare = f.manager.prepare, failure = new AppError('lease cleanup unknown', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  f.manager.prepare = async (...args) => {
    const lease = await prepare(...args), release = lease.release;
    lease.release = async () => { await release(); throw failure; }; return lease;
  };
  await assert.rejects(f.run(), error => error === failure); await f.service.close();
});

test('native and preparation cleanup failures retain the original 503 code and all causes', async () => {
  const f = setup(), prepare = f.manager.prepare, native = new AppError('original domain populated', 503, 'GUEST_TASK_CLEANUP_FAILED');
  const failure = new Error('release failed');
  f.options.runProjectTask = async () => { throw native; };
  f.manager.prepare = async (...args) => {
    const lease = await prepare(...args), release = lease.release;
    lease.release = async () => { await release(); throw failure; }; return lease;
  };
  await assert.rejects(f.run(), (error: any) => {
    assert.ok(error instanceof AppError); assert.equal(error.status, 503); assert.equal(error.code, native.code);
    assert.equal(error.cause, native); assert.deepEqual((error as any).errors, [native, failure]); return true;
  });
  await f.service.close();
});

test('service close waits for pending full-domain cleanup and surfaces its original 503', async () => {
  const f = setup(), native = new AppError('original domain unknown', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  let entered!: () => void, finish!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { finish = resolve; });
  f.options.runProjectTask = async (...args) => {
    entered(); await new Promise<void>(resolve => args[4].addEventListener('abort', () => resolve(), { once: true }));
    await gate; throw native;
  };
  const operation = f.run(), rejected = assert.rejects(operation, error => error === native); await ready;
  const closing = f.service.close(); assert.equal(f.service.close(), closing);
  const closeRejected = assert.rejects(closing, error => error === native);
  assert.equal(f.releases(), 0); finish(); await rejected; await closeRejected; assert.equal(f.releases(), 1);
});
