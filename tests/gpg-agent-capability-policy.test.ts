import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-gpg-capability-'));
process.env.SAKURA_DATA_DIR = directory;
const { ExtendedFeatures } = await import('../server/extended-features.ts');
const { capabilityParameters, capabilityViews } = await import('../server/capability-definitions.ts');
const id = '81e8e488-f383-4b57-a154-e7d1f1a3f884';
after(async () => {
  const canonical = await realpath(directory), parent = await realpath(tmpdir());
  assert.equal(dirname(canonical), parent); assert.ok(basename(canonical).startsWith('sakura-gpg-capability-'));
  await rm(canonical, { recursive: true, force: true });
});

function fixture() {
  let guestCalls = 0;
  const machines = Object.assign(new EventEmitter(), { get: () => ({ id }), requireUnlocked: () => {},
    exec: async () => { ++guestCalls; throw new Error('No guest operation is permitted'); } }) as unknown as Machines;
  const workspaces = { beforeConfigChange: () => () => {},
    projects: { current: () => 'default', key: () => id + ':default' } } as unknown as Workspaces;
  return { service: new ExtendedFeatures(machines, workspaces), guestCalls: () => guestCalls };
}

test('the GPG capability publishes a single-command form with required fresh confirmation', () => {
  const definition = capabilityViews('extended').find(value => value.id === 'gpg-agent-forward');
  assert.ok(definition); assert.equal(definition.scope, 'extended'); assert.equal(definition.requiresGuest, true);
  assert.match(definition.note, /项目账号/);
  assert.deepEqual(capabilityParameters('gpg-agent-forward', { command: 'gpg --version', confirmed: true }),
    { command: 'gpg --version', confirmed: true, timeoutSeconds: 60 });
  for (const input of [{ command: 'gpg --version' }, { command: 'gpg --version', confirmed: false },
    { command: 'true', confirmed: true, timeoutSeconds: 301 }, { command: 'true', confirmed: true, hostSocket: '/other' }])
    assert.throws(() => capabilityParameters('gpg-agent-forward', input));
});

test('GPG command and confirmation cannot become persisted feature defaults', async () => {
  const { service, guestCalls } = fixture();
  try {
    await assert.rejects(service.configure(id, { featureId: 'gpg-agent-forward', enabled: true,
      options: { command: 'gpg --version', confirmed: true } }), /一次性命令与确认不能保存/);
    assert.equal(guestCalls(), 0); assert.deepEqual(service.jobs.list(), []);
  } finally { await service.close(); }
});

test('legacy GPG confirmation cannot create a job without fresh complete parameters', async () => {
  const { service, guestCalls } = fixture();
  const legacy = { enabled: true, options: { command: 'gpg --version', confirmed: true },
    updatedAt: '2026-09-30T00:00:00.000Z' };
  (service as any).stateValue = { settings: { [id]: { 'gpg-agent-forward': legacy } }, manifests: {}, executions: {} };
  try {
    for (const options of [undefined, { command: 'gpg --version' }, { command: 'gpg --version', confirmed: false }])
      await assert.rejects(service.action(id, { action: 'run', featureId: 'gpg-agent-forward', options }), /command|confirmed/);
    assert.equal(guestCalls(), 0); assert.deepEqual(service.jobs.list(), []);
    assert.deepEqual((service as any).stateValue.settings[id]['gpg-agent-forward'], legacy);
  } finally { await service.close(); }
});
