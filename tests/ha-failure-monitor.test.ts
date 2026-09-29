import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { advanceHaMonitor, HaFailureMonitor } from '../server/ha-failure-monitor.ts';
import type { Machines } from '../server/machines.ts';
import type { VMStatus } from '../server/model.ts';

const hostId = randomUUID();
const policy = { enabled: true, options: { targetHostId: hostId, failureThreshold: 3 } };
const at = '2026-09-29T00:00:00.000Z';

test('HA counter arms only after running and ignores planned stops', () => {
  const unarmed = advanceHaMonitor(undefined, 'stopped', policy, at, true);
  assert.equal(unarmed.consecutiveFailures, 0);
  const running = advanceHaMonitor(unarmed, 'running', policy, at, false);
  assert.equal(running.armed, true);
  const stopping = advanceHaMonitor(running, 'stopping', policy, at, false);
  const stopped = advanceHaMonitor(stopping, 'stopped', policy, at, true);
  assert.equal(stopped.armed, false);
  assert.equal(stopped.consecutiveFailures, 0);
  assert.equal(stopped.suspectedAt, undefined);
});

test('HA counter detects consecutive failed samples and resets on recovery', () => {
  let status = advanceHaMonitor(undefined, 'running', policy, at, false);
  for (let i = 1; i <= 3; i++) {
    status = advanceHaMonitor(status, 'error', policy, at, true);
    assert.equal(status.consecutiveFailures, i);
  }
  assert.equal(status.suspectedAt, at);
  status = advanceHaMonitor(status, 'running', policy, at, true);
  assert.equal(status.consecutiveFailures, 0);
  assert.equal(status.suspectedAt, undefined);
});

test('HA counter never carries failure evidence into a new policy revision', () => {
  const oldPolicy = { ...policy, updatedAt: '2026-09-29T00:00:00.000Z' };
  const revisedPolicy = { ...policy, updatedAt: '2026-09-29T01:00:00.000Z' };
  const running = advanceHaMonitor(undefined, 'running', oldPolicy, at, false);
  const failed = advanceHaMonitor(running, 'error', oldPolicy, at, true);
  const revised = advanceHaMonitor(failed, 'error', revisedPolicy, at, true);
  assert.equal(revised.armed, false);
  assert.equal(revised.consecutiveFailures, 0);
});

test('HA background monitor persists failure evidence and disarms on policy changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sakura-ha-monitor-'));
  const file = join(dir, 'monitor.json');
  const id = randomUUID();
  const machine = new EventEmitter() as EventEmitter & { state: (id: string) => VMStatus };
  let vmState: VMStatus = 'stopped';
  machine.state = () => vmState;
  let settings = { ...policy };
  const monitor = new HaFailureMonitor(machine as Machines,
    async () => ({ [id]: settings }), file);
  try {
    await monitor.init();
    assert.equal(monitor.view(id)?.armed, false);
    vmState = 'running';
    machine.emit('change');
    await monitor.sample();
    assert.equal(monitor.view(id)?.armed, true);
    vmState = 'error';
    machine.emit('change');
    await monitor.sample();
    await monitor.sample();
    await monitor.sample();
    assert.equal(monitor.view(id)?.consecutiveFailures, 3);
    assert.equal(monitor.view(id)?.suspected, true);
    const stored = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(stored[id].consecutiveFailures, 3);
    settings = { enabled: false, options: policy.options };
    await monitor.reconfigure(id);
    assert.equal(monitor.view(id)?.armed, false);
    assert.equal(monitor.view(id)?.consecutiveFailures, 0);
  } finally {
    await monitor.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('HA background monitor records an intentional stop even if the VM exits before stopping state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sakura-ha-stop-'));
  const id = randomUUID();
  const machine = new EventEmitter() as EventEmitter & { state: (id: string) => VMStatus };
  let vmState: VMStatus = 'running';
  machine.state = () => vmState;
  const monitor = new HaFailureMonitor(machine as Machines,
    async () => ({ [id]: policy }), join(dir, 'monitor.json'));
  try {
    await monitor.init();
    machine.emit('stop-requested', id);
    assert.equal(monitor.view(id)?.armed, false);
    vmState = 'stopped';
    machine.emit('change');
    await monitor.sample();
    assert.equal(monitor.view(id)?.armed, false);
    assert.equal(monitor.view(id)?.consecutiveFailures, 0);
  } finally {
    await monitor.close();
    await rm(dir, { recursive: true, force: true });
  }
});
