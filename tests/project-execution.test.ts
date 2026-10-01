import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Machines as MachineType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';
import type { Secrets } from '../server/secrets.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-execution-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { ProjectTerminals } = await import('../server/project-terminals.ts');
const { ProjectExecution, withProjectCommand } = await import('../server/project-execution.ts');
const { vmDir } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

async function fixture() {
  const id = randomUUID(), locks = new Machines({} as Engine), commands: string[] = [];
  const live = { status: 'running' };
  let wait = false;
  let started!: () => void;
  const executing = new Promise<void>((done) => { started = done; });
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { template: 'none' }]]), live: new Map([[id, live]]),
    get: () => ({ template: 'none', distro: 'alpine' }), state: () => live.status,
    locked: locks.locked.bind(locks),
    exec: async (_id: string, command: string, _timeout: number, signal?: AbortSignal) => {
      commands.push(command);
      if (!command.includes('setsid sh -c')) return { stdout: '', stderr: '', code: 0 };
      started();
      if (wait) await new Promise<void>((_done, fail) => {
        if (signal?.aborted) fail(signal.reason);
        else signal?.addEventListener('abort', () => fail(signal.reason), { once: true });
      });
      return { stdout: 'private-value\noutput', stderr: 'private-value', code: 7 };
    },
  }) as unknown as MachineType;
  await mkdir(vmDir(id), { recursive: true });
  const workspaces = new Workspaces(machines, { secrets: {
    resolve: async () => ({ TOKEN: 'private-value' }),
  } as unknown as Secrets });
  const terminals = new ProjectTerminals(machines, workspaces), service = new ProjectExecution(machines, terminals);
  return { id, machines, live, commands, workspaces, terminals, service, executing,
    wait: () => { wait = true; },
    close: async () => { await service.close(); await terminals.close(); await workspaces.close(); } };
}

test('default execution uses the saved active project, exports environment inside its namespace and redacts secrets', async () => {
  const f = await fixture();
  try {
    const index = await f.workspaces.projects.create(f.id, 'Private', async () => {
      await f.workspaces.save(f.id, { directory: '/workspace/private', networkIsolation: 'private',
        environment: { MESSAGE: 'hello' }, secrets: { TOKEN: 'secret-token' } });
    });
    const result = await f.service.run(f.id, { command: 'echo "$TOKEN"' });
    assert.equal(result.scope, 'project');
    assert.equal('projectId' in result && result.projectId, index.active);
    assert.equal(result.code, 7);
    assert.equal(result.stdout, '[私密配置已隐藏]\noutput');
    assert.equal(result.stderr, '[私密配置已隐藏]');
    const command = f.commands.find((value) => value.includes('setsid sh -c'))!;
    assert.ok(command.indexOf(`ip netns exec sk-${index.active} sh -lc`) < command.indexOf('export TOKEN='));
    assert.ok(!f.commands.filter((value) => !value.includes('setsid sh -c')).some((value) => value.includes('private-value')));
    const management = await f.service.run(f.id, { command: 'echo admin', scope: 'instance' });
    assert.equal(management.scope, 'instance');
    assert.equal(management.stdout, 'private-value\noutput', 'instance commands do not load project secret values');
    await assert.rejects(f.service.run(f.id, { command: 'true', scope: 'instance' }, index.active), /不能同时指定项目/);
    await assert.rejects(f.service.run(f.id, { command: 'true' }, '1111111111111111'), /项目不存在/);
    assert.throws(() => f.service.run(f.id, { command: 'true' }, ''));
    for (const timeoutSeconds of [0, 3601, 1.5])
      assert.throws(() => f.service.run(f.id, { command: 'true', timeoutSeconds }));
  } finally { await f.close(); }
});

test('abort and service shutdown clean the guest process group and release execution locks', async () => {
  const f = await fixture(); f.wait();
  try {
    const abort = new AbortController();
    const operation = f.service.run(f.id, { command: 'sleep 600' }, null, abort.signal);
    await f.executing;
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/other' }), /另一项操作/);
    const cancelled = assert.rejects(operation);
    abort.abort(); await cancelled;
    assert.ok(f.commands.some((value) => value.includes('sakura_owned_anchor') && value.includes('.pid.stop')));
    await f.workspaces.save(f.id, { directory: '/workspace/other' });
    const second = f.service.run(f.id, { command: 'sleep 600', scope: 'instance' });
    const stopped = assert.rejects(second);
    await f.service.close(); await stopped;
    assert.ok(f.commands.filter((value) => value.includes('sakura_owned_anchor') && value.includes('.pid.stop')).length >= 2);
  } finally { await f.close(); }
});

test('agent command setup resolves the persisted active project and preserves an explicit default scope', async () => {
  const f = await fixture();
  try {
    const index = await f.workspaces.projects.create(f.id, 'Private', async () => {
      await f.workspaces.save(f.id, { directory: '/workspace/agent', networkIsolation: 'private' });
    });
    const inspect = (project: { _workspace?: string; directory: string; networkIsolation?: string }) =>
      Promise.resolve({ projectId: project._workspace || 'default', directory: project.directory,
        networkIsolation: project.networkIsolation || 'host' });
    assert.deepEqual(await withProjectCommand(f.machines, f.id, undefined, undefined, inspect),
      { projectId: index.active, directory: '/workspace/agent', networkIsolation: 'private' });
    assert.deepEqual(await f.workspaces.projects.with(f.id, 'default', () =>
      withProjectCommand(f.machines, f.id, undefined, f.workspaces, inspect)),
      { projectId: 'default', directory: '/workspace', networkIsolation: 'host' });
  } finally { await f.close(); }
});
