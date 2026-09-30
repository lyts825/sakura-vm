import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { HaWitness, type HaWitnessActions } from '../server/ha-witness-core.ts';

const sourceHostId = randomUUID(), sourceVmId = randomUUID(), targetHostId = randomUUID();
const plan = { sourceHostId, sourceVmId, targetHostId,
  transferId: randomUUID(), remoteVmId: randomUUID(), snapshotId: randomUUID(),
  sha256: 'a'.repeat(64), snapshotAt: new Date(100_000).toISOString(),
  maxReplicaAgeMinutes: 10 };
const vm = { sourceHostId, sourceVmId, targetHostId, failureThreshold: 2 };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sakura-ha-witness-'));
  let time = 100_000, poweredOff = false, target: 'stopped' | 'starting' | 'running' = 'stopped';
  let healthy = false, traffic = '', failFence = false, failRetire = false;
  const calls: string[] = [];
  const actions: HaWitnessActions = {
    fence: async () => {
      calls.push('fence');
      if (failFence) throw new Error('BMC did not confirm Off');
      poweredOff = true;
    },
    confirmFence: async () => {
      calls.push('confirm-fence');
      if (!poweredOff) throw new Error('source power is no longer Off');
    },
    targetStatus: async () => { calls.push('target-status'); return target; },
    activate: async () => {
      assert.equal(poweredOff, true);
      calls.push('activate'); target = 'starting';
    },
    applicationReady: async () => { calls.push('app-health'); return healthy; },
    switchTraffic: async () => { calls.push('traffic-switch'); traffic = plan.remoteVmId; },
    trafficTarget: async () => { calls.push('traffic-check'); return traffic; },
    retire: async () => {
      calls.push('retire');
      if (failRetire || target !== 'stopped') throw new Error('target is still running');
    },
  };
  const file = join(root, 'witness.json');
  await HaWitness.initialize(file, [vm]);
  const witness = new HaWitness(file, [vm], actions, () => time);
  await witness.init();
  return { root, file, witness, calls,
    clock: (value: number) => { time = value; },
    target: (value: 'stopped' | 'starting' | 'running') => { target = value; },
    healthy: (value: boolean) => { healthy = value; },
    failFence: (value: boolean) => { failFence = value; },
    failRetire: (value: boolean) => { failRetire = value; },
    poweredOff: (value: boolean) => { poweredOff = value; },
    cleanup: async () => {
      const path = await realpath(root);
      if (!basename(path).startsWith('sakura-ha-witness-') ||
          resolve(path) === resolve(tmpdir())) throw new Error('unsafe witness cleanup');
      await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

test('witness persists fencing before target activation and denies a returning source', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.witness.authorizeStart({ sourceHostId, sourceVmId })).allowed, true);
    await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    f.clock(129_999);
    await f.witness.sample();
    assert.deepEqual(f.calls, []);
    f.clock(130_000);
    await f.witness.sample();
    assert.deepEqual(f.calls.slice(0, 4), ['fence', 'confirm-fence', 'target-status', 'activate']);
    const reopened = new HaWitness(f.file, [vm], {
      fence: async () => { throw new Error('fence must not repeat after confirmation'); },
      confirmFence: async () => {},
      targetStatus: async () => 'running', activate: async () => {},
      applicationReady: async () => true, switchTraffic: async () => {},
      trafficTarget: async () => plan.remoteVmId, retire: async () => {},
    }, () => 131_000);
    await reopened.init();
    await assert.rejects(reopened.authorizeStart({ sourceHostId, sourceVmId }),
      { code: 'HA_WITNESS_FENCED' });
    await assert.rejects(reopened.heartbeat({ sourceHostId, sourceVmId,
      failureThreshold: 2, plan }),
      { code: 'HA_WITNESS_FENCED' });
    await reopened.sample();
    assert.equal((await reopened.status({ sourceHostId, sourceVmId })).phase, 'promoted');
  } finally { await f.cleanup(); }
});

test('uncertain power state never starts the target and survives process restart', async () => {
  const f = await fixture();
  try {
    await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    f.failFence(true);
    f.clock(130_000);
    await f.witness.sample();
    assert.deepEqual(f.calls, ['fence']);
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'fencing');
    await assert.rejects(f.witness.authorizeStart({ sourceHostId, sourceVmId }),
      { code: 'HA_WITNESS_FENCED' });
    f.failFence(false);
    await f.witness.sample();
    assert.deepEqual(f.calls.slice(1, 5), ['fence', 'confirm-fence', 'target-status', 'activate']);
  } finally { await f.cleanup(); }
});

test('stale replica is disarmed; promotion waits for application health and verified traffic', async () => {
  const f = await fixture();
  try {
    await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    f.clock(130_000);
    await f.witness.sample();
    f.target('running');
    await f.witness.sample();
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'fenced');
    f.healthy(true);
    await f.witness.sample();
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'promoted');
    f.failRetire(true);
    await assert.rejects(f.witness.rejoin({ sourceHostId, sourceVmId }), /invalid_type|Invalid input/);
    await assert.rejects(f.witness.rejoin({ sourceHostId, sourceVmId,
      dataReconciled: true }), /running/);
    await assert.rejects(f.witness.authorizeStart({ sourceHostId, sourceVmId }),
      { code: 'HA_WITNESS_FENCED' });
    f.failRetire(false);
    f.target('stopped');
    await f.witness.rejoin({ sourceHostId, sourceVmId, dataReconciled: true });
    assert.deepEqual(await f.witness.rejoin({ sourceHostId, sourceVmId, dataReconciled: true }),
      { released: true, retiredRemoteVmId: plan.remoteVmId }, 'lost successful responses are idempotent');
    assert.equal((await f.witness.authorizeStart({ sourceHostId, sourceVmId })).allowed, true);
  } finally { await f.cleanup(); }
});

test('expired replica cannot arm a host-loss failover', async () => {
  const f = await fixture();
  try {
    f.clock(100_000 + 11 * 60_000);
    assert.equal((await f.witness.heartbeat({ sourceHostId, sourceVmId,
      failureThreshold: 2, plan })).armed,
      false);
    await f.witness.sample();
    assert.deepEqual(f.calls, []);
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'source');
  } finally { await f.cleanup(); }
});

test('liveness-only heartbeats retain a verified plan until explicit disarm', async () => {
  const f = await fixture();
  try {
    await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    f.clock(120_000);
    assert.equal((await f.witness.heartbeat({ sourceHostId, sourceVmId,
      failureThreshold: 2 })).armed, true);
    f.clock(130_000);
    await f.witness.sample();
    assert.deepEqual(f.calls, [], 'slow validation does not appear as source loss');
    assert.equal((await f.witness.heartbeat({ sourceHostId, sourceVmId,
      failureThreshold: 2, plan: null })).armed, false);
    f.clock(160_000);
    await f.witness.sample();
    assert.deepEqual(f.calls, [], 'explicit disarm removes the failover candidate');
  } finally { await f.cleanup(); }
});

test('a historical fence cannot activate or switch traffic after the source powers on again', async () => {
  const f = await fixture();
  try {
    await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    f.clock(130_000);
    await f.witness.sample();
    f.target('stopped');
    f.poweredOff(false);
    const before = f.calls.length;
    await f.witness.sample();
    assert.deepEqual(f.calls.slice(before), ['confirm-fence']);
    const status = await f.witness.status({ sourceHostId, sourceVmId });
    assert.equal(status.phase, 'fenced');
    assert.match(status.error || '', /no longer Off/);
    await assert.rejects(f.witness.authorizeStart({ sourceHostId, sourceVmId }),
      { code: 'HA_WITNESS_FENCED' });
    f.poweredOff(true);
    f.target('running');
    f.healthy(true);
    await f.witness.sample();
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'promoted');
  } finally { await f.cleanup(); }
});

test('a promoted target restarts the same writable replica and repairs traffic only when needed', async () => {
  const f = await fixture();
  try {
    await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    f.clock(130_000);
    await f.witness.sample();
    f.target('running'); f.healthy(true);
    await f.witness.sample();
    const promoted = await f.witness.status({ sourceHostId, sourceVmId });
    const before = f.calls.length;
    await f.witness.sample();
    assert.equal(f.calls.slice(before).includes('activate'), false);
    assert.equal(f.calls.slice(before).includes('traffic-switch'), false,
      'healthy promoted samples must not rewrite production routing');
    f.target('stopped');
    f.clock(140_000);
    await f.witness.sample();
    assert.equal(f.calls.filter((call) => call === 'activate').length, 2);
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, 'promoted');
    f.target('running');
    await f.witness.sample();
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).promotedAt, promoted.promotedAt);
    assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).error, null);
    f.poweredOff(false); f.target('stopped');
    const activations = f.calls.filter((call) => call === 'activate').length;
    await f.witness.sample();
    assert.equal(f.calls.filter((call) => call === 'activate').length, activations);
    await assert.rejects(f.witness.authorizeStart({ sourceHostId, sourceVmId }),
      { code: 'HA_WITNESS_FENCED' });
  } finally { await f.cleanup(); }
});

test('a failed authority write freezes source start and prevents external takeover work', async () => {
  const f = await fixture();
  try {
    await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    await rm(f.file);
    await mkdir(f.file);
    f.clock(130_000);
    await assert.rejects(f.witness.sample());
    assert.deepEqual(f.calls, []);
    await assert.rejects(f.witness.authorizeStart({ sourceHostId, sourceVmId }),
      { code: 'HA_WITNESS_STORAGE_UNAVAILABLE' });
    await assert.rejects(f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2 }),
      { code: 'HA_WITNESS_STORAGE_UNAVAILABLE' });
    assert.match((await f.witness.status({ sourceHostId, sourceVmId })).error || '', /持久存储写入失败/);
  } finally { await f.cleanup(); }
});

for (const failedPhase of ['fencing', 'fenced'] as const)
  test(`an interrupted ${failedPhase} takeover can release only an explicitly reconciled, retired target`, async () => {
    const f = await fixture();
    try {
      await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
      f.failFence(failedPhase === 'fencing');
      f.clock(130_000);
      await f.witness.sample();
      assert.equal((await f.witness.status({ sourceHostId, sourceVmId })).phase, failedPhase);
      f.target('running');
      await assert.rejects(f.witness.rejoin({ sourceHostId, sourceVmId, dataReconciled: true }),
        /still running/);
      await assert.rejects(f.witness.authorizeStart({ sourceHostId, sourceVmId }),
        { code: 'HA_WITNESS_FENCED' });
      f.target('stopped');
      const result = await f.witness.rejoin({ sourceHostId, sourceVmId, dataReconciled: true });
      assert.deepEqual(result, { released: true, retiredRemoteVmId: plan.remoteVmId });
      const saved = JSON.parse(await readFile(f.file, 'utf8'));
      assert.equal(saved.entries[sourceVmId].retiredRemoteVmId, plan.remoteVmId);
      await f.witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan: null });
      const actions: HaWitnessActions = {
        fence: async () => {}, confirmFence: async () => {}, targetStatus: async () => 'stopped',
        activate: async () => {}, applicationReady: async () => false,
        switchTraffic: async () => {}, trafficTarget: async () => '',
        retire: async () => { throw new Error('successful durable retirement must not repeat'); },
      };
      const reopened = new HaWitness(f.file, [vm], actions, () => 131_000);
      await reopened.init();
      assert.deepEqual(await reopened.rejoin({ sourceHostId, sourceVmId, dataReconciled: true }), result);
      assert.equal((await reopened.authorizeStart({ sourceHostId, sourceVmId })).allowed, true);
    } finally { await f.cleanup(); }
  });

test('slow fencing and retirement for one host do not block another host heartbeat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-ha-witness-multi-'));
  const file = join(root, 'witness.json');
  const secondVm = { sourceHostId, sourceVmId: randomUUID(),
    targetHostId: randomUUID(), failureThreshold: 2 };
  const secondPlan = { ...plan, sourceVmId: secondVm.sourceVmId,
    targetHostId: secondVm.targetHostId, transferId: randomUUID(),
    remoteVmId: randomUUID() };
  let time = 100_000;
  let releaseFence = () => {}, enteredFence = () => {};
  let releaseRetire = () => {}, enteredRetire = () => {};
  const fenceGate = new Promise<void>((resolve) => { releaseFence = resolve; });
  const fenceStarted = new Promise<void>((resolve) => { enteredFence = resolve; });
  const retireGate = new Promise<void>((resolve) => { releaseRetire = resolve; });
  const retireStarted = new Promise<void>((resolve) => { enteredRetire = resolve; });
  const actions: HaWitnessActions = {
    fence: async (source) => {
      if (source.sourceVmId === sourceVmId) { enteredFence(); await fenceGate; }
      else throw new Error('healthy host must not be fenced');
    },
    confirmFence: async () => {},
    targetStatus: async () => 'running', activate: async () => {},
    applicationReady: async () => true, switchTraffic: async () => {},
    trafficTarget: async (_source, candidate) => candidate.remoteVmId,
    retire: async () => { enteredRetire(); await retireGate; },
  };
  await HaWitness.initialize(file, [vm, secondVm]);
  const witness = new HaWitness(file, [vm, secondVm], actions, () => time);
  let sample: ReturnType<HaWitness['sample']> | undefined;
  let rejoining: ReturnType<HaWitness['rejoin']> | undefined;
  let draining: ReturnType<HaWitness['drain']> | undefined;
  const keepSecondAlive = async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        witness.heartbeat({ sourceHostId, sourceVmId: secondVm.sourceVmId,
          failureThreshold: 2 }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('healthy host heartbeat stalled')), 2000);
        }),
      ]);
      assert.equal(response.armed, true);
    } finally { clearTimeout(timeout); }
  };
  try {
    await witness.init();
    await witness.heartbeat({ sourceHostId, sourceVmId, failureThreshold: 2, plan });
    time = 115_000;
    await witness.heartbeat({ sourceHostId, sourceVmId: secondVm.sourceVmId,
      failureThreshold: 2, plan: secondPlan });
    time = 130_000;
    sample = witness.sample();
    await fenceStarted;
    let drainFinished = false;
    draining = witness.drain().then(() => { drainFinished = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(drainFinished, false, 'shutdown must wait for in-flight fencing');
    time = 140_000;
    await keepSecondAlive();
    releaseFence();
    await sample;
    await draining;
    assert.equal(drainFinished, true);
    assert.equal((await witness.status({ sourceHostId, sourceVmId })).phase, 'promoted');
    rejoining = witness.rejoin({ sourceHostId, sourceVmId, dataReconciled: true });
    await retireStarted;
    time = 145_000;
    await keepSecondAlive();
    releaseRetire();
    await rejoining;
    assert.equal((await witness.status({ sourceHostId,
      sourceVmId: secondVm.sourceVmId })).phase, 'source');
  } finally {
    releaseFence(); releaseRetire();
    await Promise.allSettled([sample, rejoining, draining].filter(Boolean));
    const path = await realpath(root);
    if (!basename(path).startsWith('sakura-ha-witness-multi-') ||
        resolve(path) === resolve(tmpdir())) throw new Error('unsafe witness cleanup');
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('witness refuses a missing state file and refuses to overwrite an existing state', async () => {
  const f = await fixture();
  try {
    await assert.rejects(HaWitness.initialize(f.file, [vm]), /已存在/);
    await rm(f.file);
    const empty = new HaWitness(f.file, [vm], {
      fence: async () => {}, confirmFence: async () => {}, targetStatus: async () => 'stopped',
      activate: async () => {}, applicationReady: async () => false,
      switchTraffic: async () => {}, trafficTarget: async () => '',
      retire: async () => {},
    });
    await assert.rejects(empty.init(), { code: 'HA_WITNESS_STATE_MISSING' });
  } finally { await f.cleanup(); }
});

test('witness refuses missing entries, changed identities and legacy state', async () => {
  const f = await fixture();
  try {
    const original = JSON.parse(await readFile(f.file, 'utf8'));
    const actions: HaWitnessActions = {
      fence: async () => {}, confirmFence: async () => {}, targetStatus: async () => 'stopped',
      activate: async () => {}, applicationReady: async () => false,
      switchTraffic: async () => {}, trafficTarget: async () => '',
      retire: async () => {},
    };
    const reopen = async (config = vm) => {
      const witness = new HaWitness(f.file, [config], actions);
      await witness.init();
    };
    for (const invalid of [
      { ...original, entries: {} },
      { ...original, bindings: {} },
      { ...original, bindings: {
        [sourceVmId]: { ...original.bindings[sourceVmId], targetHostId: randomUUID() },
      } },
      { version: 1, entries: original.entries },
      { ...original, entries: { [sourceVmId]: { ...original.entries[sourceVmId],
        phase: 'fenced', plan: null } } },
      { ...original, entries: { [sourceVmId]: { ...original.entries[sourceVmId],
        plan: { ...plan, sourceVmId: randomUUID() } } } },
      { ...original, entries: { [sourceVmId]: { ...original.entries[sourceVmId],
        plan: { ...plan, sourceHostId: randomUUID() } } } },
      { ...original, entries: { [sourceVmId]: { ...original.entries[sourceVmId],
        plan: { ...plan, targetHostId: randomUUID() } } } },
    ]) {
      await writeFile(f.file, JSON.stringify(invalid));
      await assert.rejects(reopen(), { code: 'HA_WITNESS_STATE_MISMATCH' });
    }
    await writeFile(f.file, JSON.stringify(original));
    await assert.rejects(reopen({ ...vm, failureThreshold: 3 }),
      { code: 'HA_WITNESS_STATE_MISMATCH' });
    await assert.rejects(reopen({ ...vm, sourceHostId: randomUUID() }),
      { code: 'HA_WITNESS_STATE_MISMATCH' });
    await reopen();
  } finally { await f.cleanup(); }
});
