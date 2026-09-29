import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TerminalSharing } from '../server/terminal-sharing.ts';
import type { Machines } from '../server/machines.ts';
import type { ProjectTerminals } from '../server/project-terminals.ts';

test('shared terminal grants require an exact running tmux session, persist and expire', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-terminal-share-'));
  let now = Date.UTC(2026, 0, 1), found = false;
  const commands: string[] = [];
  const machines = {
    state: () => 'running',
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { stdout: '', stderr: '', code: found ? 0 : 1 };
    },
  } as unknown as Machines;
  const file = join(directory, 'grants.json');
  const service = new TerminalSharing(machines, file, () => now);
  const vmId = '00000000-0000-4000-8000-000000000001';
  const viewerId = '00000000-0000-4000-8000-000000000002';
  await service.init();
  try {
    const input = { vmId, viewerId, session: 'abc-123', minutes: 2 };
    await assert.rejects(service.create(input), /tmux/);
    assert.deepEqual(service.list(), []);
    found = true;
    const grant = await service.create(input);
    assert.equal(commands.at(-1),
      'command -v tmux >/dev/null && tmux has-session -t =sakura-terminal-abc-123');
    assert.equal(service.find(viewerId, vmId, input.session)?.id, grant.id);
    assert.equal(service.list('00000000-0000-4000-8000-000000000003').length, 0);
    await assert.rejects(service.create({ ...input, session: '../../other' }));
    const repeated = await service.create(input);
    assert.equal(repeated.id, grant.id);
    const restored = new TerminalSharing(machines, file, () => now);
    await restored.init();
    assert.equal(restored.find(viewerId, vmId, input.session)?.id, grant.id);
    await restored.revokeViewer(viewerId);
    assert.equal(restored.list().length, 0);
    await restored.close();
    now += 120_000;
    assert.equal(service.find(viewerId, vmId, input.session), null);
    await service.revoke(grant.id);
    assert.deepEqual(service.list(), []);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('terminal grants persist exact projects and never retarget old or other-project sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-scoped-terminal-share-'));
  const vmId = '00000000-0000-4000-8000-000000000001';
  const viewerId = '00000000-0000-4000-8000-000000000002';
  const service = new TerminalSharing({ state: () => 'running' } as unknown as Machines,
    join(directory, 'grants.json'));
  let active = 'default', valid = true;
  service.useProjectTerminals({ validate: async (_vm: string, scope: string | undefined) => {
    if (!valid) throw new Error('终端窗格未处于项目网络空间');
    return { projectId: scope || active, terminalId: '00000000-0000-4000-8000-000000000003' };
  } } as unknown as ProjectTerminals);
  await service.init();
  try {
    const input = { vmId, viewerId, session: 'main' };
    const first = await service.create(input);
    assert.equal(first.projectId, 'default');
    active = '0123456789abcdef';
    const second = await service.create(input);
    assert.equal(second.projectId, active);
    assert.notEqual(second.id, first.id);
    assert.equal(service.find(viewerId, vmId, 'main'), null);
    assert.equal(service.find(viewerId, vmId, 'main', 'default')?.id, first.id);
    assert.equal(service.list(viewerId, vmId, active).length, 1);
    const refreshed = await service.create({ ...input, projectId: 'default' });
    assert.equal(refreshed.id, first.id);
    valid = false;
    await assert.rejects(service.create(input), /网络空间/);
    assert.equal(service.list().length, 2, 'failed validation cannot grant another session');
    const restored = new TerminalSharing({} as Machines, join(directory, 'grants.json'));
    await restored.init();
    assert.equal(restored.find(viewerId, vmId, 'main', active)?.id, second.id);
    assert.equal(restored.find(viewerId, vmId, 'main'), null);
    await restored.close();
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
});
