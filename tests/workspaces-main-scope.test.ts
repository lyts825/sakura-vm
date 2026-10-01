import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = await mkdtemp(join(tmpdir(), 'sakura-workspaces-main-test-'));
process.env.SAKURA_DATA_DIR = root;
const { mainFixture } = await import('./project-main-fixture.ts');
const { ProjectServiceScopes } = await import('../server/project-service-scope.ts');
const { serviceSchema } = await import('../server/project-services.ts');
const { writeStore } = await import('../server/local-store.ts');
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), await realpath(tmpdir())); assert.match(basename(owned), /^sakura-workspaces-main-test-/);
  await rm(owned, { recursive: true, force: true });
});
for (const field of ['command', 'remove-command', 'environment', 'secrets', 'runtimes', 'directory', 'network', 'services'] as const) {
  test(`main exited descendants prevent ${field} binding edits until a full stop`, async () => {
    const f = await mainFixture('exited');
    try {
      await f.scope.start(f.scope.intent(f.bootId), 'sleep 600', f.controller.signal);
      const next: any = structuredClone(f.project);
      if (field === 'command') next.command = 'sleep 601';
      if (field === 'remove-command') next.command = '';
      if (field === 'environment') next.environment = { TOKEN: 'replacement' };
      if (field === 'secrets') next.secrets = { TOKEN: 'replacement-key' };
      if (field === 'runtimes') next.runtimes = { node: '22.1.0' };
      if (field === 'directory') next.directory = '/other';
      if (field === 'network') next.networkIsolation = 'host';
      if (field === 'services') next.services = [{ name: 'main', command: 'sleep 601' }];
      await assert.rejects(f.spaces.save(f.id, next), { code: 'PROJECT_MAIN_SCOPE_CHANGED' });
      assert.equal((await f.spaces.config(f.id)).command, f.project.command);
    } finally { await f.spaces.close(); }
  });
}
test('main runtime exposes exited at the top level, explicit main metadata and redacted application logs', async () => {
  const f = await mainFixture('exited');
  try {
    await f.scope.start(f.scope.intent(f.bootId), 'sleep 600', f.controller.signal);
    const runtime = await f.spaces.runtime(f.id);
    assert.equal(runtime.status, 'exited'); assert.equal(runtime.main?.status, 'exited');
    assert.equal(runtime.services, undefined); assert.match(runtime.log, /全部后代/); assert.match(runtime.log, /owned main application log/);
    assert.equal(runtime.log.includes('owned-main-private-token'), false);
  } finally { await f.spaces.close(); }
});
for (const status of ['prepared', 'unconfirmed']) {
  test(`main ${status} status is unconfirmed at the top level and preserves diagnostic logs`, async () => {
    const f = await mainFixture(status === 'unconfirmed' ? 'unconfirmed' : 'normal');
    try {
      await f.scope.start(f.scope.intent(f.bootId), 'sleep 600', f.controller.signal);
      if (status === 'prepared') { f.state.main!.phase = 'prepared'; await writeStore(f.scope.receipt(), f.state.main); }
      const runtime = await f.spaces.runtime(f.id);
      assert.equal(runtime.status, 'unconfirmed'); assert.equal(runtime.main?.status, status);
      assert.match(runtime.log, /owned main application log/); assert.equal(runtime.log.includes('owned-main-private-token'), false);
    } finally { await f.spaces.close(); }
  });
}
test('legacy main runtime exposes migration metadata without Python probes or inferred termination', async () => {
  const f = await mainFixture('legacy');
  try {
    const runtime = await f.spaces.runtime(f.id);
    assert.equal(runtime.status, 'unconfirmed'); assert.equal(runtime.main?.status, 'unmanaged'); assert.match(runtime.log, /管理员/);
    await assert.rejects(f.spaces.save(f.id, { ...f.project, command: 'sleep 601' }), { code: 'PROJECT_MAIN_SCOPE_UNMANAGED' });
    assert.equal(f.commands.some(command => /python3|apk add|apt-get|kill-session/.test(command)), false);
  } finally { await f.spaces.close(); }
});
test('confirmed stopped main permits binding edits and switching to an independently named service', async () => {
  const f = await mainFixture();
  try {
    await f.scope.start(f.scope.intent(f.bootId), 'sleep 600', f.controller.signal);
    await f.scope.stop(f.state.main!);
    await f.spaces.save(f.id, { ...f.project, command: 'sleep 601', directory: '/other', networkIsolation: 'host',
      services: [{ name: 'main', command: 'sleep 600' }] });
    assert.equal((await f.spaces.config(f.id)).services?.[0].name, 'main');
  } finally { await f.spaces.close(); }
});
test('main cleanup failure remains an error Job, redacts keys and prevents namespace removal after services stop', async () => {
  const f = await mainFixture('all-stop-failures');
  try {
    await f.scope.start(f.scope.intent(f.bootId), 'sleep 600', f.controller.signal);
    const service = serviceSchema.parse({ name: 'main', command: 'sleep 600' });
    const services = new ProjectServiceScopes(f.machines, f.id, f.project);
    await services.start(services.intent(service, f.bootId), 'sleep 600', f.controller.signal);
    await f.saveConfig({ ...f.project, services: [service] });
    const job = await f.spaces.run(f.id, 'stop');
    await f.spaces.jobs.wait(f.spaces.projects.key(f.id));
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED');
    assert.equal(job.error!.includes('owned-main-private-token'), false); assert.equal(job.log.includes('owned-main-private-token'), false);
    assert.equal(f.state.services.get('main')?.phase, 'stopped'); assert.equal(f.state.main?.phase, 'running');
    assert.equal(f.state.namespaceRemovals, 0); assert.equal(JSON.parse(await readFile(f.scope.receipt(), 'utf8')).phase, 'running');
  } finally { await f.spaces.close(); }
});
test('named service stop leaves main ownership and network namespace intact', async () => {
  const f = await mainFixture();
  try {
    await f.scope.start(f.scope.intent(f.bootId), 'sleep 600', f.controller.signal);
    const service = serviceSchema.parse({ name: 'main', command: 'sleep 600' }), services = new ProjectServiceScopes(f.machines, f.id, f.project);
    await services.start(services.intent(service, f.bootId), 'sleep 600', f.controller.signal);
    await f.saveConfig({ ...f.project, services: [service] });
    const job = await f.spaces.run(f.id, 'stop', 'main');
    await f.spaces.jobs.wait(f.spaces.projects.key(f.id));
    assert.equal(job.status, 'done'); assert.equal(f.state.main?.phase, 'running');
    assert.equal(f.events.some(event => event.kind === 'main' && event.op === 'stop'), false);
    assert.equal(f.state.namespaceRemovals, 0);
  } finally { await f.spaces.close(); }
});
test('main startup acknowledgment failure retains its own Job error code and redacts resolved secrets', async () => {
  const f = await mainFixture('commit-ack-lost');
  try {
    const job = await f.spaces.run(f.id, 'start');
    await f.spaces.jobs.wait(f.spaces.projects.key(f.id));
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_MAIN_SCOPE_CHANGED');
    assert.equal(f.state.main?.phase, 'stopped'); assert.equal(job.error!.includes('owned-main-private-token'), false);
    assert.equal(job.log.includes('owned-main-private-token'), false);
  } finally { await f.spaces.close(); }
});
test('main cancelled startup with failed cleanup is reported with the retained cleanup recovery code', async () => {
  const f = await mainFixture('cancel-cleanup-failed');
  const execute = f.machines.exec;
  f.machines.exec = async (id, command, timeout, signal, output, agent) => {
    const result = await execute.call(f.machines, id, command, timeout, signal, output, agent);
    if (command.startsWith('# SAKURA_PROJECT_MAIN_COMMIT')) f.spaces.jobs.cancel(f.spaces.projects.key(f.id));
    return result;
  };
  try {
    const job = await f.spaces.run(f.id, 'start');
    await f.spaces.jobs.wait(f.spaces.projects.key(f.id));
    assert.equal(job.status, 'error'); assert.equal(job.errorCode, 'PROJECT_MAIN_CLEANUP_FAILED');
    assert.equal(f.state.main?.phase, 'running'); assert.equal(job.error!.includes('owned-main-private-token'), false);
    assert.equal(job.log.includes('owned-main-private-token'), false);
  } finally { await f.spaces.close(); }
});

for (const field of ['command', 'environment', 'secrets', 'runtimes', 'directory', 'network', 'services'] as const) {
  test(`an empty saved command cannot exempt an unknown legacy main from the ${field} guard`, async () => {
    const f = await mainFixture('legacy');
    try {
      const blank = { ...f.project, command: '' }; await f.saveConfig(blank);
      const next: any = structuredClone(blank);
      if (field === 'command') next.command = 'sleep 601';
      if (field === 'environment') next.environment = {};
      if (field === 'secrets') next.secrets = {};
      if (field === 'runtimes') next.runtimes = { node: '22.1.0' };
      if (field === 'directory') next.directory = '/other';
      if (field === 'network') next.networkIsolation = 'host';
      if (field === 'services') next.services = [{ name: 'api', command: 'sleep 600' }];
      await assert.rejects(f.spaces.save(f.id, next), { code: 'PROJECT_MAIN_SCOPE_UNMANAGED' });
      assert.equal((await f.spaces.config(f.id)).command, '');
      assert.equal(f.commands.some(command => /python3|apk add|apt-get|kill-session/.test(command)), false);
      f.state.machine = 'paused'; const calls = f.commands.length;
      await assert.rejects(f.spaces.save(f.id, next), { code: 'PROJECT_MAIN_SCOPE_CHANGED' });
      assert.equal(f.commands.length, calls);
    } finally { await f.spaces.close(); }
  });
}

test('paused projects with confirmed stopped main and service receipts permit service mode edits', async () => {
  const f = await mainFixture();
  try {
    await f.scope.start(f.scope.intent(f.bootId), 'sleep 600', f.controller.signal); await f.scope.stop(f.state.main!);
    const service = serviceSchema.parse({ name: 'api', command: 'sleep 600' }), services = new ProjectServiceScopes(f.machines, f.id, f.project);
    await services.start(services.intent(service, f.bootId), 'sleep 600', f.controller.signal); await services.stop(f.state.services.get('api')!);
    await f.saveConfig({ ...f.project, services: [service] }); f.state.machine = 'paused'; const calls = f.commands.length;
    await f.spaces.save(f.id, { ...f.project, services: [], environment: {}, secrets: {}, command: '' });
    assert.equal(f.commands.length, calls); assert.equal((await f.spaces.config(f.id)).services?.length, 0);
  } finally { await f.spaces.close(); }
});
