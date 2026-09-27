import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AutomationRules } from '../server/automation-rules.ts';
import type { WebhookEvent } from '../shared/webhooks.ts';
import type { Machines } from '../server/machines.ts';

const vmId = '11111111-1111-4111-8111-111111111111';
const filter = { types: ['job.finished'] as const, vmIds: [vmId], projectIds: [], tags: [],
  statuses: ['error'] as const, kinds: [] };
const rule = { name: '任务失败后启动实例', enabled: true, previewOnly: true,
  filter, action: 'start' as const, cooldownSeconds: 60 };
const event = (id: string, time: number): WebhookEvent => ({
  id, type: 'job.finished', occurredAt: new Date(time).toISOString(),
  vmId, status: 'error', tags: [],
});

test('automation rules preview by default, deduplicate across restart and execute only new matching events', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-automation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'rules.json');
  let now = Date.parse('2026-09-27T10:00:00.000Z');
  let events: WebhookEvent[] = [];
  const starts: string[] = [];
  const machines = {
    get: (id: string) => { assert.equal(id, vmId); return { id }; },
    requireUnlocked: (id: string) => { assert.equal(id, vmId); },
    start: async (id: string) => { starts.push(id); },
    stop: async () => {}, suspend: async () => {}, resume: async () => {},
  } as unknown as Machines;
  const create = async () => {
    const service = new AutomationRules(async () => events, machines, file, () => now);
    await service.init(false);
    return service;
  };
  let service = await create();
  await service.configure({ operation: 'save', rule });
  const saved = service.view().rules[0];
  assert.equal(saved.previewOnly, true);
  events = [event('a'.repeat(64), now)];
  await service.tick();
  assert.equal(service.view().executions[0].status, 'preview');
  assert.deepEqual(starts, []);
  await service.tick();
  assert.equal(service.view().executions.length, 1);
  await service.close();
  service = await create();
  await service.tick();
  assert.equal(service.view().executions.length, 1);
  now += 1000;
  await service.configure({ operation: 'save', id: saved.id, version: saved.version,
    rule: { ...rule, previewOnly: false } });
  await assert.rejects(service.configure({ operation: 'save', id: saved.id, version: saved.version,
    rule }), /规则已变化/);
  assert.equal(service.view().rules[0].version, 2);
  events.push(event('b'.repeat(64), now));
  const preview = await service.configure({ operation: 'preview', id: saved.id });
  assert.ok('matches' in preview);
  assert.equal(preview.matches[0].wouldExecute, true);
  await service.tick();
  assert.deepEqual(starts, [vmId]);
  assert.equal(service.view().executions[0].status, 'done');
  now += 10_000;
  events.push(event('c'.repeat(64), now));
  await service.tick();
  assert.equal(service.view().executions[0].status, 'skipped');
  assert.deepEqual(starts, [vmId]);
  now += 60_000;
  events.push(event('d'.repeat(64), now));
  await service.tick();
  assert.deepEqual(starts, [vmId, vmId]);
  const executing = service.view().rules[0];
  now += 1000;
  await service.configure({ operation: 'save', id: saved.id, version: executing.version,
    rule: { ...rule, previewOnly: true } });
  events.push(event('e'.repeat(64), now));
  await service.tick();
  assert.equal(service.view().executions[0].status, 'preview');
  assert.deepEqual(starts, [vmId, vmId]);
  await service.close();
  service = await create();
  await service.tick();
  assert.deepEqual(starts, [vmId, vmId]);
  await service.close();
});

test('automation cooldown survives execution history eviction', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-automation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'rules.json');
  let now = Date.parse('2026-09-27T10:00:00.000Z');
  let latest: WebhookEvent[] = [];
  let starts = 0;
  const machines = {
    get: () => ({ id: vmId }), requireUnlocked: () => {},
    start: async () => { starts++; },
    stop: async () => {}, suspend: async () => {}, resume: async () => {},
  } as unknown as Machines;
  const service = new AutomationRules(async () => latest, machines, file, () => now);
  await service.init(false);
  await service.configure({ operation: 'save', rule: { ...rule, previewOnly: false } });
  for (let index = 0; index < 302; index++) {
    now += 1;
    latest = [event(index.toString(16).padStart(64, '0'), now)];
    await service.tick();
  }
  assert.equal(starts, 1);
  assert.equal(service.view().executions.length, 300);
  assert.equal(service.view().executions[0].status, 'skipped');
  await service.close();
  const restarted = new AutomationRules(async () => latest, machines, file, () => now);
  await restarted.init(false);
  now += 1;
  latest = [event('f'.repeat(64), now)];
  await restarted.tick();
  assert.equal(starts, 1);
  await restarted.close();
});

test('automation rules reject stale saves and preserve ambiguous pending actions without replay', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-automation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'rules.json');
  let now = Date.parse('2026-09-27T10:00:00.000Z');
  const events = [event('e'.repeat(64), now)];
  let blocked = false;
  let starts = 0;
  const machines = {
    get: () => ({ id: vmId }), requireUnlocked: () => {},
    start: async () => { starts++; throw new Error('实例启动失败'); },
    stop: async () => {}, suspend: async () => {}, resume: async () => {},
  } as unknown as Machines;
  const service = new AutomationRules(async () => events, machines, file, () => now,
    () => blocked);
  await service.init(false);
  await service.configure({ operation: 'save', rule: { ...rule, previewOnly: false } });
  blocked = true;
  await assert.rejects(service.configure({ operation: 'remove', id: service.view().rules[0].id,
    version: 1 }), /维护中/);
  await service.tick();
  assert.equal(starts, 0);
  blocked = false;
  await service.tick();
  assert.equal(starts, 1);
  assert.equal(service.view().executions[0].status, 'failed');
  await service.close();
  const stored = JSON.parse(await readFile(file, 'utf8'));
  stored.executions[0].status = 'pending';
  delete stored.executions[0].finishedAt;
  await writeFile(file, JSON.stringify(stored));
  const restarted = new AutomationRules(async () => events, machines, file, () => now);
  await restarted.init(false);
  await restarted.tick();
  assert.equal(starts, 1);
  assert.equal(restarted.view().executions[0].status, 'pending');
  await restarted.close();
});

test('automation rules enforce the durable daily action ceiling', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-automation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'rules.json');
  let now = Date.parse('2026-09-27T10:00:00.000Z');
  let latest: WebhookEvent[] = [];
  let starts = 0;
  const machines = {
    get: () => ({ id: vmId }), requireUnlocked: () => {},
    start: async () => { starts++; },
    stop: async () => {}, suspend: async () => {}, resume: async () => {},
  } as unknown as Machines;
  const service = new AutomationRules(async () => latest, machines, file, () => now);
  await service.init(false);
  await service.configure({ operation: 'save', rule: { ...rule, previewOnly: false } });
  for (let index = 0; index < 26; index++) {
    now += 61_000;
    latest = [event(index.toString(16).padStart(64, '0'), now)];
    await service.tick();
  }
  assert.equal(starts, 25);
  assert.equal(service.view().executions[0].status, 'skipped');
  await service.close();
  const restarted = new AutomationRules(async () => latest, machines, file, () => now);
  await restarted.init(false);
  now += 61_000;
  latest = [event('f'.repeat(64), now)];
  await restarted.tick();
  assert.equal(starts, 25);
  assert.equal(restarted.view().executions[0].status, 'skipped');
  await restarted.close();
});

test('runbook approval binds the reviewed steps and executes each event at most once', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-automation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'rules.json');
  let now = Date.parse('2026-09-27T10:00:00.000Z');
  let latest: WebhookEvent[] = [];
  let fail = false;
  const calls: Array<{ id: string; projectId?: string; commands: string[] }> = [];
  const machines = {
    get: () => ({ id: vmId }), requireUnlocked: () => {},
    start: async () => {}, stop: async () => {}, suspend: async () => {}, resume: async () => {},
  } as unknown as Machines;
  const executor = async (id: string, steps: Array<{ command: string }>, projectId?: string) => {
    calls.push({ id, projectId, commands: steps.map((step) => step.command) });
    return { code: fail ? 1 : 0, results: steps.map((_, index) => ({ code: fail && index === 0 ? 1 : 0 })) };
  };
  const create = async () => {
    const service = new AutomationRules(async () => latest, machines, file, () => now,
      () => false, () => {}, executor);
    await service.init(false);
    return service;
  };
  let service = await create();
  const repair = { ...rule, name: '重启服务', action: 'runbook' as const, steps: [
    { name: '检查', command: 'test -f /workspace/ready', timeout: 10 },
    { name: '修复', command: 'touch /workspace/repaired', timeout: 20 },
  ] };
  await service.configure({ operation: 'save', rule: repair });
  const saved = service.view().rules[0];
  const preview = await service.configure({ operation: 'preview', id: saved.id });
  assert.ok('approval' in preview && preview.approval);
  await assert.rejects(service.configure({ operation: 'save', id: saved.id,
    version: saved.version, rule: { ...repair, previewOnly: false } }), /预览/);
  await assert.rejects(service.configure({ operation: 'save', id: saved.id,
    version: saved.version, approval: preview.approval,
    rule: { ...repair, previewOnly: false, steps: [{ ...repair.steps[0], command: 'touch /workspace/changed' }] } }),
  /规则内容已变化/);
  await service.configure({ operation: 'save', id: saved.id, version: saved.version,
    approval: preview.approval, rule: { ...repair, previewOnly: false } });
  now += 1000;
  latest = [{ ...event('a'.repeat(64), now), projectId: 'default' }];
  await service.tick();
  assert.deepEqual(calls, [{ id: vmId, projectId: 'default', commands: repair.steps.map((step) => step.command) }]);
  assert.equal(service.view().executions[0].status, 'done');
  assert.deepEqual(service.view().executions[0].steps,
    [{ name: '检查', code: 0 }, { name: '修复', code: 0 }]);
  fail = true;
  now += 61_000;
  latest = [event('b'.repeat(64), now)];
  await service.tick();
  assert.equal(service.view().executions[0].status, 'failed');
  assert.deepEqual(service.view().executions[0].steps,
    [{ name: '检查', code: 1 }, { name: '修复', code: 0 }]);
  await service.close();
  service = await create();
  await service.tick();
  assert.equal(calls.length, 2);
  await service.close();
});
