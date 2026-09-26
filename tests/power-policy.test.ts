import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'sakura-power-test-'));
process.env.SAKURA_DATA_DIR = root;
const { powerPolicySchema, powerPolicy, savePowerPolicy, powerDecision, hostPower } =
  await import('../server/power-policy.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { FeatureScheduler } = await import('../server/feature-scheduler.ts');
const { saveMaintenancePolicy } = await import('../server/automation-policy.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-power-test-'));
  await rm(root, { recursive: true, force: true });
});

test('power policy fails closed for starts with stale or unknown samples, and never stops without a known low battery', () => {
  const now = Date.now(),
    sample = {
      checkedAt: new Date(now).toISOString(),
      onAC: false,
      batteryPresent: true,
      batteryPercent: 50,
    };
  const policy = powerPolicySchema.parse({
    enabled: true,
    allowBatteryStarts: true,
    minimumBatteryPercent: 30,
    stopBelowPercent: 10,
  });
  assert.equal(powerDecision(policy, sample, now).allowStart, true);
  assert.equal(powerDecision(policy, { ...sample, batteryPercent: 20 }, now).allowStart, false);
  assert.equal(powerDecision(policy, { ...sample, batteryPercent: 10 }, now).stop, true);
  assert.equal(powerDecision(policy, { ...sample, onAC: true, batteryPercent: 5 }, now).stop, false);
  for (const patch of [
    { onAC: null },
    { batteryPresent: null },
    { batteryPercent: null },
    { checkedAt: new Date(now - 90001).toISOString() },
    { checkedAt: new Date(now + 1).toISOString() },
  ]) {
    const result = powerDecision(policy, { ...sample, ...patch }, now);
    assert.equal(result.allowStart, false);
    assert.equal(result.stop, false);
  }
  assert.equal(powerDecision(powerPolicySchema.parse({}), { ...sample, batteryPercent: 0 }, now).stop, false);
  assert.equal(
    powerPolicySchema.safeParse({ minimumBatteryPercent: 10, stopBelowPercent: 10 }).success,
    false,
  );
});

test('scheduler uses persisted power policy to defer starts and stop at low battery while honoring maintenance', async () => {
  const id = randomUUID(),
    vm = { id, cpus: 1, memoryMiB: 512 };
  let status = 'stopped',
    starts = 0,
    stops = 0,
    samples = 0;
  let sample = {
    checkedAt: new Date().toISOString(),
    onAC: false as boolean | null,
    batteryPresent: true,
    batteryPercent: 50 as number | null,
  };
  const machines: any = {
    records: new Map([[id, vm]]),
    get: () => vm,
    state: () => status,
    start: async () => {
      starts++;
      status = 'running';
    },
    stop: async (_id: string, force: boolean) => {
      assert.equal(force, false);
      stops++;
      status = 'stopped';
    },
  };
  const workspaces: any = {
    projects: { current: () => 'default', key: () => id },
    metrics: async () => ({
      sampledAt: new Date().toISOString(),
      cpuPercent: 50,
      memoryTotal: 100,
      memoryUsed: 50,
      diskTotal: 100,
      diskUsed: 50,
    }),
  };
  const suite = new FeatureSuite(machines, workspaces, {
    power: async () => {
      samples++;
      return sample;
    },
  });
  suite.enableBackground();
  const now = new Date(),
    startAt = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  await suite.update(id, { schedule: { enabled: true, startAt } });
  const policy = await savePowerPolicy(id, {
    enabled: true,
    minimumBatteryPercent: 30,
    stopBelowPercent: 10,
  });
  assert.deepEqual(await powerPolicy(id), policy);
  try {
    await suite.tick();
    assert.equal(starts, 0);
    sample.onAC = true;
    await suite.tick();
    assert.equal(starts, 1);
    sample = { ...sample, onAC: false, batteryPercent: 5 };
    await saveMaintenancePolicy(id, {
      enabled: true,
      windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00', timeZone: 'UTC' }],
    });
    await suite.tick();
    assert.equal(stops, 0);
    await saveMaintenancePolicy(id, { enabled: false, windows: [] });
    sample.batteryPercent = null;
    await suite.tick();
    assert.equal(stops, 0);
    sample.batteryPercent = 5;
    await suite.tick();
    assert.equal(stops, 1);
    await suite.tick();
    assert.equal(starts, 1);
    assert.equal(samples, 5);
  } finally {
    await suite.close();
  }
});

test(
  'host power reads the real Windows source without changing its power plan',
  { skip: process.platform !== 'win32' },
  async () => {
    const sample = await hostPower();
    assert.equal(sample.error, undefined);
    assert.ok([true, false, null].includes(sample.onAC));
    if (sample.batteryPercent !== null) assert.ok(sample.batteryPercent >= 0 && sample.batteryPercent <= 100);
  },
);

test('closing the scheduler during a power query cannot start or stop an instance afterwards', async () => {
  const id = randomUUID();
  let complete!: (sample: any) => void,
    entered!: () => void,
    calls = 0;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const machines: any = {
    records: new Map([[id, { id }]]),
    get: () => ({ id }),
    state: () => 'stopped',
    start: async () => {
      calls++;
    },
  };
  const workspaces: any = { projects: { current: () => 'default', key: () => id } };
  const suite = new FeatureSuite(machines, workspaces, {
    power: () =>
      new Promise((resolve) => {
        complete = resolve;
        entered();
      }),
  });
  const now = new Date(),
    clock = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  await savePowerPolicy(id, { enabled: true });
  await suite.update(id, { schedule: { enabled: true, startAt: clock } });
  const running = suite.tick();
  await waiting;
  await suite.close();
  complete({ checkedAt: new Date().toISOString(), onAC: true, batteryPresent: true, batteryPercent: 100 });
  await running;
  assert.equal(calls, 0);
});

test('disabling and re-enabling the scheduler cancels its power query and uses a new signal', async () => {
  const id = randomUUID();
  let entered!: () => void,
    aborted = false;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const machines: any = { records: new Map([[id, { id }]]), state: () => 'stopped', get: () => ({ id }) };
  const workspaces: any = { projects: { current: () => 'default', key: () => id } };
  const suite = new FeatureSuite(machines, workspaces, {
    power: (signal) =>
      new Promise((_resolve, reject) => {
        assert.equal(signal.aborted, false);
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new Error('cancelled'));
          },
          { once: true },
        );
        entered();
      }),
  });
  await savePowerPolicy(id, { enabled: true });
  let scheduler = new FeatureScheduler(suite);
  await waiting;
  await scheduler.close();
  assert.equal(aborted, true);
  aborted = false;
  const resumed = new Promise<void>((resolve) => {
    entered = resolve;
  });
  scheduler = new FeatureScheduler(suite);
  await resumed;
  await scheduler.close();
  assert.equal(aborted, true);
  await suite.close();
});
