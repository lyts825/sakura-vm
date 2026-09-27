import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { WebhookEvent } from '../shared/webhooks.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-remediation-'));
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith('sakura-remediation-'));
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { runEngineeringOperation } = await import('../server/engineering-runner.ts');
const { AutomationRules } = await import('../server/automation-rules.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const workspaces = new Workspaces(machines);
let latest: WebhookEvent[] = [];
const rules = new AutomationRules(async () => latest, machines, join(directory, 'automation-rules.json'),
  Date.now, () => false, () => {}, async (id, steps, projectId, signal) =>
    workspaces.projects.with(id, projectId, () =>
      runEngineeringOperation(machines, workspaces, id, 'runbooks', { steps }, signal)));
await rules.init(false);

try {
  const vm = await machines.create({ name: 'remediation-smoke', memoryMiB: 512, cpus: 2, diskGiB: 4 });
  console.log('Booting isolated Alpine/QEMU guest');
  await machines.start(vm.id);
  const deadline = Date.now() + 270000;
  while (machines.state(vm.id) !== 'running') {
    if (Date.now() > deadline || ['error', 'stopped'].includes(machines.state(vm.id)))
      throw new Error(machines.logs.get(vm.id));
    await delay(250);
  }
  const installed = await machines.exec(vm.id, 'apk add --no-cache python3 && touch /workspace/ready', 300000);
  assert.equal(installed.code, 0, installed.stdout + installed.stderr);
  const stopped = await workspaces.projects.with(vm.id, 'default', () =>
    runEngineeringOperation(machines, workspaces, vm.id, 'runbooks', { steps: [
      { name: '失败前置检查', command: 'test -f /workspace/missing', timeout: 10 },
      { name: '不应执行', command: 'touch /workspace/should-not-exist', timeout: 10 },
    ] }, new AbortController().signal));
  assert.notEqual(stopped.code, 0);
  assert.ok(Array.isArray(stopped.results));
  assert.equal(stopped.results.length, 1);
  assert.notEqual((await machines.exec(vm.id, 'test -e /workspace/should-not-exist')).code, 0);
  const rule = {
    name: '服务修复', enabled: true, previewOnly: true, action: 'runbook' as const,
    filter: { types: ['alert.raised'] as const, vmIds: [vm.id], projectIds: ['default'],
      tags: [], statuses: [], kinds: ['service'] as const },
    cooldownSeconds: 60,
    steps: [
      { name: '检查前置文件', command: 'test -f /workspace/ready', timeout: 10 },
      { name: '写入修复标记', command: 'printf repaired > /workspace/repaired', timeout: 10 },
    ],
  };
  await rules.configure({ operation: 'save', rule });
  const saved = rules.view().rules[0];
  const preview = await rules.configure({ operation: 'preview', id: saved.id });
  assert.ok('approval' in preview && preview.approval);
  await rules.configure({ operation: 'save', id: saved.id, version: saved.version,
    approval: preview.approval, rule: { ...rule, previewOnly: false } });
  latest = [{ id: 'a'.repeat(64), type: 'alert.raised', kind: 'service', vmId: vm.id,
    projectId: 'default', occurredAt: new Date().toISOString(), tags: [] }];
  await rules.tick();
  assert.equal(rules.view().executions[0].status, 'done');
  assert.deepEqual(rules.view().executions[0].steps,
    [{ name: '检查前置文件', code: 0 }, { name: '写入修复标记', code: 0 }]);
  assert.equal(await machines.readGuestFile(vm.id, '/workspace/repaired'), 'repaired');
  await rules.tick();
  assert.equal(rules.view().executions.length, 1);
  console.log('PASS reviewed event Runbook, ordered guest repair, first-failure stop and deduplication');
} finally {
  await rules.close();
  await workspaces.close();
  await machines.close();
  await rm(directory, { recursive: true, force: true });
}
