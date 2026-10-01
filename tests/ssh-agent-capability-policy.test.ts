import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-agent-capability-'));
process.env.SAKURA_DATA_DIR = directory;
const { ExtendedFeatures } = await import('../server/extended-features.ts');
const id = '39b6dd1c-b788-43a9-8958-4811e6c859ad';
after(async () => {
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-agent-capability-'));
  await rm(directory, { recursive: true, force: true });
});

function fixture() {
  let guestCalls = 0;
  const machines = Object.assign(new EventEmitter(), {
    get: () => ({ id }), requireUnlocked: () => {},
    exec: async () => { guestCalls++; throw new Error('No guest operation is permitted'); },
  }) as unknown as Machines;
  const workspaces = { beforeConfigChange: () => () => {},
    projects: { current: () => 'default', key: () => id + ':default' } } as unknown as Workspaces;
  return { service: new ExtendedFeatures(machines, workspaces), guestCalls: () => guestCalls };
}

test('SSH Agent commands and confirmation cannot become persisted feature defaults', async () => {
  const { service, guestCalls } = fixture();
  try {
    await assert.rejects(service.configure(id, { featureId: 'ssh-agent-forward', enabled: true,
      options: { command: 'ssh-add -L', confirmed: true } }), /一次性命令与确认不能保存/);
    assert.equal(guestCalls(), 0);
    assert.deepEqual(service.jobs.list(), []);
  } finally { await service.close(); }
});

test('legacy saved SSH confirmation never starts a job without fresh complete parameters', async () => {
  const { service, guestCalls } = fixture();
  const legacy = { enabled: true, options: { command: 'ssh-add -L', confirmed: true },
    updatedAt: '2026-09-30T00:00:00.000Z' };
  (service as any).stateValue = { settings: { [id]: { 'ssh-agent-forward': legacy } },
    manifests: {}, executions: {} };
  try {
    for (const options of [undefined, { command: 'ssh-add -L' }, { command: 'ssh-add -L', confirmed: false }])
      await assert.rejects(service.action(id, { action: 'run', featureId: 'ssh-agent-forward', options }),
        /command|confirmed/);
    assert.equal(guestCalls(), 0);
    assert.deepEqual(service.jobs.list(), []);
    assert.deepEqual((service as any).stateValue.settings[id]['ssh-agent-forward'], legacy);
  } finally { await service.close(); }
});
