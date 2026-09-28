import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcmeRenewal } from '../server/acme-renewal.ts';
import type { Machines } from '../server/machines.ts';

const vmId = '00000000-0000-4000-8000-000000000001';

test('Certbot renewal checks existing lineages, schedules due runs, and persists results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-acme-'));
  const file = join(directory, 'acme.json');
  let now = Date.UTC(2026, 0, 1), ready = false, running = true;
  const commands: string[] = [];
  const machines = {
    records: new Map([[vmId, {}]]), get: () => ({}),
    state: () => running ? 'running' : 'stopped', requireUnlocked: () => {},
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: command.includes('command -v certbot') ? (ready ? 0 : 1) : 0,
        stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  const service = new AcmeRenewal(machines, file, () => now);
  await service.init();
  service.setAllowed(() => false);
  try {
    assert.equal((await service.check(vmId)).ready, false);
    await assert.rejects(service.run(vmId, { mode: 'renew' }, 'run'), /锁定或数据迁移/);
    ready = true;
    assert.equal((await service.check(vmId)).ready, true);
    const saved = await service.save(vmId,
      { mode: 'save', enabled: true, intervalHours: 12 });
    assert.equal(saved.policy?.enabled, true);
    assert.equal(commands.filter((item) => item.startsWith('certbot renew')).length, 0);
    service.setAllowed(() => true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await service.tick();
    assert.equal(commands.filter((item) => item ===
      'certbot renew --non-interactive --quiet').length, 1);
    assert.equal(service.view(vmId).attempts[0].status, 'success');
    await service.tick();
    assert.equal(commands.filter((item) => item.startsWith('certbot renew')).length, 1);
    now += 12 * 3_600_000;
    running = false;
    await service.tick();
    assert.equal(commands.filter((item) => item.startsWith('certbot renew')).length, 1);
    running = true;
    await service.tick();
    assert.equal(commands.filter((item) => item.startsWith('certbot renew')).length, 2);
    const dryRun = await service.run(vmId, { mode: 'dry-run' }, 'run');
    assert.equal(dryRun.ready, true);
    assert.equal(commands.at(-1), 'certbot renew --non-interactive --quiet --dry-run');
    assert.equal(service.view(vmId).attempts.length, 3);
    const before = service.view(vmId).policy?.nextAttemptAt;
    await service.save(vmId, { mode: 'save', enabled: false });
    now += 12 * 3_600_000;
    await service.tick();
    assert.equal(commands.filter((item) => item.startsWith('certbot renew')).length, 3);
    assert.ok(before);
    await service.close();
    const restored = new AcmeRenewal(machines, file, () => now);
    await restored.init();
    assert.equal(restored.view(vmId).policy?.enabled, false);
    assert.equal(restored.view(vmId).attempts.length, 3);
    await restored.close();
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed renewal records failure and exact guest command is not replayed while active', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-acme-'));
  let now = Date.UTC(2026, 0, 1), ready = false, finish: (() => void) | undefined;
  let renewals = 0;
  const machines = {
    records: new Map([[vmId, {}]]), get: () => ({}),
    state: () => 'running', requireUnlocked: () => {},
    exec: async (_id: string, command: string) => {
      if (command.includes('command -v certbot'))
        return { code: ready ? 0 : 1, stdout: '', stderr: '' };
      renewals++;
      await new Promise<void>((resolve) => { finish = resolve; });
      return { code: 2, stdout: '', stderr: 'challenge failed' };
    },
  } as unknown as Machines;
  const service = new AcmeRenewal(machines, join(directory, 'acme.json'), () => now);
  await service.init();
  let mutations = 0;
  service.setMutationCounter((delta) => { mutations += delta; });
  service.setAllowed(() => true);
  try {
    await assert.rejects(service.run(vmId, { mode: 'renew' }, 'run'), /Certbot/);
    assert.equal(service.view(vmId).attempts[0].status, 'failed');
    ready = true;
    const first = service.run(vmId, { mode: 'renew' }, 'run');
    assert.equal(mutations, 1);
    await assert.rejects(service.run(vmId, { mode: 'renew' }, 'run'), /正在执行/);
    await assert.rejects(service.save(vmId,
      { mode: 'save', enabled: false }), /正在执行/);
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 1));
    finish();
    const result = await first;
    assert.equal(result.ready, false);
    assert.ok('exitCode' in result);
    assert.equal(result.exitCode, 2);
    assert.equal(renewals, 1);
    assert.equal(mutations, 0);
    assert.equal(service.view(vmId).attempts[0].exitCode, 2);
    now += 1;
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
