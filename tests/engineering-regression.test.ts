import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'sakura-engineering-regression-'));
process.env.SAKURA_DATA_DIR = directory;
const { ExtendedFeatures, extendedFeatureCatalog } = await import('../server/extended-features.ts');
const { NextFeatures, nextFeatureCatalog } = await import('../server/next-features.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { engineeringOperations, validateOperation } = await import('../server/engineering-operations.ts');
const { Machines } = await import('../server/machines.ts');
const id = '11111111-1111-4111-8111-111111111111';
after(async () => {
  assert.equal(dirname(directory), resolve(tmpdir()));
  await rm(directory, { recursive: true, force: true });
});
function fixture() {
  let time = Date.now(),
    cpu = 0,
    stopped = 0,
    status = 'running',
    fail = false,
    locked = false;
  const machines: any = {
    records: new Map([[id, { id }]]),
    live: new Map(),
    get: () => ({ id }),
    state: () => status,
    stop: async () => {
      stopped++;
      status = 'stopped';
    },
    requireUnlocked: () => {
      if (locked) throw new Error('locked');
    },
    incidentLocked: () => locked,
    setIncidentLockdown: async (_id: string, value: boolean) => {
      locked = value;
      return { locked };
    },
    exec: async () => ({ stdout: '', stderr: 'missing', code: 127 }),
  };
  const workspaces: any = {
    projects: { current: () => 'default', key: () => id + ':default' },
    metrics: async () => {
      if (fail) throw new Error('offline');
      return {
        sampledAt: new Date(time).toISOString(),
        cpuPercent: cpu,
        memoryUsed: 1,
        memoryTotal: 10,
        diskUsed: 1,
        diskTotal: 10,
      };
    },
  };
  return {
    machines,
    workspaces,
    advance: (ms: number) => {
      time += ms;
    },
    busy: () => {
      cpu = 10;
    },
    idle: () => {
      cpu = 0;
    },
    fail: (value: boolean) => {
      fail = value;
    },
    stopped: () => stopped,
    now: () => time,
  };
}

test('all 37 operation envelopes reach the executor and failures mark jobs as error', async () => {
  const { machines, workspaces } = fixture();
  const service = new ExtendedFeatures(machines, workspaces);
  const received: string[] = [];
  (service as any).runOperation = async (_id: string, operation: string) => {
    received.push(operation);
    return { code: 0 };
  };
  try {
    for (const [operation, spec] of Object.entries(engineeringOperations)) {
      const parameters = { ...spec.example };
      if (operation === 'git-cherry-pick') parameters.commit = 'a'.repeat(40);
      const job: any = await service.action(id, { action: 'operation', operation, parameters });
      await service.jobs.wait(job.key);
      assert.equal(service.jobs.view(job.key)?.status, 'done', operation);
    }
    assert.equal(received.length, 37);
    (service as any).runOperation = async () => ({ code: 7, error: 'intentional failure' });
    const job: any = await service.action(id, {
      action: 'operation',
      operation: 'hash-manifest',
      parameters: {},
    });
    await service.jobs.wait(job.key);
    assert.equal(service.jobs.view(job.key)?.status, 'error');
    assert.match(service.jobs.view(job.key)?.log || '', /"code":7/);
  } finally {
    await service.close();
  }
});

test('all 200 configure branches accept the public envelope and reject unexpected fields', async () => {
  const { machines, workspaces } = fixture();
  const services = [
    new ExtendedFeatures(machines, workspaces),
    new NextFeatures(machines, workspaces),
  ] as const;
  try {
    for (const [index, catalog] of [extendedFeatureCatalog, nextFeatureCatalog].entries()) {
      for (const [featureId] of catalog) {
        const result: any = await services[index].action(id, {
          action: 'configure',
          featureId,
          enabled: true,
          options: {},
        });
        assert.equal(result.enabled, true, featureId);
      }
      await assert.rejects(
        services[index].action(id, {
          action: 'configure',
          featureId: catalog[0][0],
          enabled: true,
          unwanted: true,
        }),
      );
    }
  } finally {
    for (const service of services) await service.close();
  }
});

test('checks do not lock machines or claim probe-only features are implemented', async () => {
  const { machines, workspaces } = fixture();
  const next = new NextFeatures(machines, workspaces);
  try {
    assert.equal(
      ((await next.action(id, { action: 'check', featureId: 'incident-lockdown' })) as any).locked,
      false,
    );
    assert.equal(machines.incidentLocked(id), false);
    const missing: any = await next.action(id, { action: 'check', featureId: 'notebook-environment' });
    assert.equal(missing.ready, false);
    assert.equal(missing.probePassed, false);
    machines.exec = async () => ({ stdout: 'version', stderr: '', code: 0 });
    assert.equal(
      ((await next.action(id, { action: 'check', featureId: 'notebook-environment' })) as any).ready,
      false,
    );
    await assert.rejects(next.action(id, { action: 'run', featureId: 'notebook-environment' }), /实现/);
    const recording: any = await next.action(id, { action: 'check', featureId: 'desktop-recording' });
    assert.equal(recording.ready, true);
    assert.equal(recording.executed, false);
    assert.match(recording.message, /录制与回放/);
    await assert.rejects(next.action(id, { action: 'run', featureId: 'incident-lockdown' }));
    await next.action(id, { action: 'run', featureId: 'incident-lockdown', options: { locked: true } });
    assert.equal(machines.incidentLocked(id), true);
    await next.action(id, { action: 'run', featureId: 'incident-lockdown', options: { locked: false } });
    assert.equal(machines.incidentLocked(id), false);
  } finally {
    await next.close();
  }
});

test('idle shutdown requires fresh continuous low CPU samples and resets on activity or failure', async (t) => {
  const f = fixture();
  const suite = new FeatureSuite(f.machines, f.workspaces);
  t.mock.method(Date, 'now', () => f.now());
  try {
    await suite.update(id, { schedule: { enabled: true, idleMinutes: 1 } });
    await suite.tick();
    f.advance(30_000);
    f.busy();
    await suite.tick();
    f.advance(30_000);
    f.idle();
    await suite.tick();
    f.advance(30_000);
    f.fail(true);
    await suite.tick();
    f.advance(30_000);
    f.fail(false);
    await suite.tick();
    f.advance(30_000);
    await suite.tick();
    assert.equal(f.stopped(), 0);
    f.advance(30_000);
    await suite.tick();
    assert.equal(f.stopped(), 1);
  } finally {
    await suite.close();
  }
});

test('lockdown is persisted and blocks machine starts, writes and guest connections after restart', async () => {
  const machines = new Machines({} as any);
  machines.records.set(id, { id } as any);
  (machines as any).stopInternal = async () => {};
  await machines.setIncidentLockdown(id, true);
  assert.throws(() => machines.requireUnlocked(id), /应急锁定/);
  await assert.rejects(machines.connect(id), /应急锁定/);
  await assert.rejects(
    machines.locked('git:' + id + ':default', async () => {}),
    /应急锁定/,
  );
  const restored = new Machines({} as any);
  await restored.init();
  restored.records.set(id, { id } as any);
  assert.equal(restored.incidentLocked(id), true);
  (restored as any).stopInternal = async () => {};
  await restored.setIncidentLockdown(id, false);
  assert.doesNotThrow(() => restored.requireUnlocked(id));
});

test('mutating operation parameters reject missing targets, invalid routes and incomplete rebase plans', () => {
  for (const parameters of [
    { mode: 'add', destination: 'default' },
    { mode: 'delete', destination: '0.0.0.0/0' },
    { mode: 'add', destination: 'bad/24' },
    { mode: 'add', destination: '10.0.0.0/24', gateway: '::1' },
  ])
    assert.throws(() => validateOperation({ operation: 'static-routes', parameters }));
  assert.throws(() =>
    validateOperation({ operation: 'archive', parameters: { mode: 'extract', path: 'a.tar' } }),
  );
  assert.throws(() =>
    validateOperation({ operation: 'git-rebase', parameters: { mode: 'apply', base: 'HEAD~1', todo: [] } }),
  );
  assert.throws(() => validateOperation({ operation: 'git-cherry-pick', parameters: { mode: 'revert' } }));
});

test(
  'engineering executors exercise real files, Git repositories and failing child processes',
  { timeout: 120_000 },
  () => {
    const python = process.env.SAKURA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const env: Record<string, string | undefined> = { ...process.env, PYTHONUTF8: '1' };
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
    if (process.platform === 'win32')
      env[pathKey] = 'C:\\Program Files\\Git\\bin;C:\\Program Files\\Git\\usr\\bin;' + env[pathKey];
    const result = spawnSync(python, ['tests/engineering_runner_test.py'], {
      env,
      encoding: 'utf8',
      timeout: 110_000,
    });
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  },
);
