import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Machines } from '../server/machines.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-workspace-service-scope-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Workspaces, projectSchema } = await import('../server/workspaces.ts');
const { ProjectServiceScopes } = await import('../server/project-service-scope.ts');
const { writeStore } = await import('../server/local-store.ts');
const { AppError } = await import('../server/model.ts');
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), await realpath(tmpdir()));
  assert.match(basename(owned), /^sakura-workspace-service-scope-test-/);
  await rm(owned, { recursive: true, force: true });
});
async function fixture(status = 'exited', metadata = true) {
  const id = randomUUID(), bootId = randomUUID(), project = projectSchema.parse({ directory: '/workspace',
    environment: { TOKEN: 'owned-private-token' }, secrets: { TOKEN: 'token' },
    services: [{ name: 'api', command: 'sleep 600' }] });
  const commands: string[] = [];
  let machineState = 'running';
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([[id, {}]]), records: new Map([[id, { id, distro: 'alpine' }]]),
    get: () => ({ id, distro: 'alpine' }), state: () => machineState,
    locked: async (_id: string, action: () => Promise<unknown>) => action(),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.startsWith('# SAKURA_PROJECT_MAIN_LEGACY_STATUS'))
        return { code: 0, stdout: 'absent', stderr: '' };
      if (command.startsWith('# SAKURA_PROJECT_SERVICE_STATUS')) {
        if (status === 'uncertain') return { code: 73, stdout: '', stderr: 'owned-private-token ownership mismatch' };
        return { code: 0, stdout: JSON.stringify({ status, bootId, record }), stderr: '' };
      }
      if (command.includes('then echo active')) return { code: 0, stdout: metadata ? '' : 'active', stderr: '' };
      if (command.startsWith('if tmux has-session'))
        return { code: 0, stdout: metadata ? '' : 'running\nold log owned-private-token', stderr: '' };
      if (command.startsWith('test ! -f')) return { code: 0, stdout: 'owned application log owned-private-token', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  }) as unknown as Machines;
  const scopes = new ProjectServiceScopes(machines, id, project);
  const record = { ...scopes.intent(project.services![0], bootId),
    inode: '55555', phase: status === 'stopped' ? 'stopped' as const : 'running' as const,
    panePid: 100, paneStartTicks: '12345', paneId: '%1', sessionId: '$1' };
  if (metadata) await writeStore(scopes.receipt('api'), record);
  const spaces = new Workspaces(machines, { secrets: { resolve: async () => ({ TOKEN: 'owned-private-token' }) } as any });
  await writeStore(spaces.projects.file(id), project);
  return { id, spaces, scopes, project, record, commands, machines, paused: () => { machineState = 'paused'; } };
}
for (const field of ['remove', 'directory', 'network', 'command', 'environment', 'secrets', 'runtimes'] as const) {
  test(`workspace refuses ${field} edits while exited service descendants retain a scope`, async () => {
    const f = await fixture();
    const next: any = structuredClone(f.project);
    if (field === 'remove') next.services = [];
    if (field === 'directory') next.directory = '/other';
    if (field === 'network') next.networkIsolation = 'private';
    if (field === 'command') next.services[0].command = 'sleep 601';
    if (field === 'environment') next.environment = { TOKEN: 'replacement' };
    if (field === 'secrets') next.secrets = { TOKEN: 'different-token' };
    if (field === 'runtimes') next.runtimes = { node: '22.1.0' };
    try {
      await assert.rejects(f.spaces.save(f.id, next), { code: 'SERVICE_SCOPE_CHANGED' });
      assert.equal((await f.spaces.config(f.id)).services?.[0].command, f.project.services![0].command);
    } finally { await f.spaces.close(); }
  });
}
test('workspace runtime displays an exited scope and keeps redacted application logs', async () => {
  const f = await fixture();
  try {
    const runtime = await f.spaces.runtime(f.id);
    assert.equal(runtime.status, 'exited');
    assert.equal(runtime.services![0].status, 'exited');
    assert.match(runtime.services![0].log, /owned application log/);
    assert.match(runtime.services![0].log, /全部后代/);
    assert.equal(runtime.services![0].log.includes('owned-private-token'), false);
  } finally { await f.spaces.close(); }
});
test('unconfirmed scope status remains visible and does not discard available application logs', async () => {
  const f = await fixture('uncertain');
  try {
    const runtime = await f.spaces.runtime(f.id);
    assert.equal(runtime.status, 'unconfirmed');
    assert.equal(runtime.services![0].status, 'unconfirmed');
    assert.match(runtime.services![0].log, /ownership mismatch/);
    assert.match(runtime.services![0].log, /owned application log/);
    assert.equal(runtime.services![0].log.includes('owned-private-token'), false);
    await assert.rejects(f.spaces.save(f.id, { ...f.project, services: [] }), { code: 'SERVICE_SCOPE_CHANGED' });
  } finally { await f.spaces.close(); }
});
test('confirmed stopped scope allows removal and binding changes without blocking configuration', async () => {
  const f = await fixture('stopped');
  try {
    await f.spaces.save(f.id, { ...f.project, directory: '/changed', networkIsolation: 'private', services: [] });
    const saved = await f.spaces.config(f.id);
    assert.equal(saved.directory, '/changed');
    assert.deepEqual(saved.services, []);
    assert.equal(JSON.parse(await readFile(f.scopes.receipt('api'), 'utf8')).phase, 'stopped');
  } finally { await f.spaces.close(); }
});
test('confirmed stopped scope permits service edits while paused without attempting guest status', async () => {
  const f = await fixture('stopped');
  f.paused();
  try {
    await f.spaces.save(f.id, { ...f.project, services: [{ ...f.project.services![0], command: 'sleep 601' }] });
    assert.equal(f.commands.length, 0);
  } finally { await f.spaces.close(); }
});

test('paused stopped services without a main receipt require resume before changing main binding or service mode', async () => {
  const f = await fixture('stopped'); f.paused();
  try {
    for (const update of [{ environment: {} }, { services: [] }, { command: 'sleep 601' }])
      await assert.rejects(f.spaces.save(f.id, { ...f.project, ...update }), { code: 'PROJECT_MAIN_SCOPE_CHANGED' });
    assert.equal(f.commands.length, 0); assert.equal((await f.spaces.config(f.id)).services?.length, 1);
  } finally { await f.spaces.close(); }
});

test('paused unknown legacy services refuse command changes and partial removal before any guest access', async () => {
  const f = await fixture('running', false);
  const project = projectSchema.parse({ ...f.project, services: [...f.project.services!, { name: 'second', command: 'sleep 600' }] });
  await writeStore(f.spaces.projects.file(f.id), project); f.paused();
  try {
    for (const services of [[{ ...project.services![0], command: 'sleep 601' }, project.services![1]], [project.services![1]]])
      await assert.rejects(f.spaces.save(f.id, { ...project, services }), { code: 'SERVICE_SCOPE_UNMANAGED' });
    assert.equal(f.commands.length, 0); assert.equal((await f.spaces.config(f.id)).services?.length, 2);
    assert.equal((await f.spaces.config(f.id)).services?.[0].command, 'sleep 600');
  } finally { await f.spaces.close(); }
});
test('legacy running services expose migration state and use no Python or installation probes', async () => {
  const f = await fixture('running', false);
  try {
    const runtime = await f.spaces.runtime(f.id);
    assert.equal(runtime.status, 'unconfirmed');
    assert.equal(runtime.services![0].status, 'migration-required');
    assert.match(runtime.services![0].log, /旧服务/);
    await assert.rejects(f.spaces.save(f.id, { ...f.project, services: [] }), { code: 'SERVICE_SCOPE_UNMANAGED' });
    assert.equal(f.commands.some(command => /python3|apk add|apt-get|SAKURA_PROJECT_SERVICE_/.test(command)), false);
  } finally { await f.spaces.close(); }
});

test('workspace service cleanup failure retains the job error code while redacting private values', async () => {
  const f = await fixture('running'), execute = f.machines.exec;
  f.machines.exec = async (id, command) => {
    if (command.startsWith('# SAKURA_PROJECT_SERVICE_STOP'))
      throw new AppError('owned-private-token cleanup connection failed', 503, 'SERVICE_CLEANUP_FAILED');
    return execute.call(f.machines, id, command);
  };
  try {
    const job = await f.spaces.run(f.id, 'stop', 'api');
    await f.spaces.jobs.wait(f.spaces.projects.key(f.id));
    assert.equal(job.status, 'error');
    assert.equal(job.errorCode, 'SERVICE_CLEANUP_FAILED');
    assert.match(job.error!, /清理未确认/);
    assert.equal(job.error!.includes('owned-private-token'), false);
    assert.equal(job.log.includes('owned-private-token'), false);
    assert.equal(JSON.parse(await readFile(f.scopes.receipt('api'), 'utf8')).phase, 'running');
  } finally { await f.spaces.close(); }
});
