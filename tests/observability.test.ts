import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'sakura-observability-'));
process.env.SAKURA_DATA_DIR = root;
const { parseMetrics, networkRates } = await import('../server/metrics.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { saveMaintenancePolicy } = await import('../server/automation-policy.ts');
const { CapabilityActions } = await import('../server/capability-actions.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-observability-'));
  await rm(root, { recursive: true, force: true });
});
const sample = (uptime = 30, rx = 1000, tx = 2000) =>
  parseMetrics(
    `CPU\ncpu 10 0 10 100 0 0 0 0\ncpu 30 0 20 150 20 0 0 0\nMEMORY\nMemTotal: 1024 kB\nMemAvailable: 512 kB\nDISK\n/dev/vda1 1000 400 600 40% /\nNETWORK\n lo: 9999 0 0 0 0 0 0 0 9999 0 0 0 0 0 0 0\n eth0: ${rx} 0 0 0 0 0 0 0 ${tx} 0 0 0 0 0 0 0\nPROCESSES\n123 python3\nUPTIME\n${uptime} 10.0\n`,
  );

test('network metrics exclude loopback, calculate observed rates and leave resets or gaps unknown', () => {
  const previous = sample();
  assert.equal(previous.networkReceivedBytes, 1000);
  assert.equal(previous.networkTransmitBytesPerSecond, null);
  const current = networkRates(sample(40, 2000, 5000), previous);
  assert.equal(current.networkReceiveBytesPerSecond, 100);
  assert.equal(current.networkTransmitBytesPerSecond, 300);
  for (const point of [sample(2), sample(200), sample(40, 1), sample(40, 2000, 1)])
    assert.equal(networkRates(point, previous).networkReceiveBytesPerSecond, null);
  const changed = sample(40, 2000, 5000);
  changed.networkInterfaces[0].name = 'eth1';
  assert.equal(networkRates(changed, previous).networkReceiveBytesPerSecond, null);
  assert.throws(() => sample(40, -1), /网络采样/);
});

function fixture() {
  const id = randomUUID(),
    secondId = randomUUID();
  const vm: any = { id, cpus: 1, memoryMiB: 512 },
    second: any = { ...vm, id: secondId };
  const machines: any = {
    records: new Map([
      [id, vm],
      [secondId, second],
    ]),
    state: () => 'running',
    get: (key: string) => (key === id ? vm : second),
    requireUnlocked: () => {},
  };
  let point = sample(),
    status = 'running';
  machines.state = () => status;
  const workspaces: any = {
    metrics: async () => point,
    projects: { current: () => 'default', key: (key: string) => key },
  };
  return {
    id,
    secondId,
    machines,
    workspaces,
    setPoint: (value: typeof point) => {
      point = value;
    },
    stop: () => {
      status = 'stopped';
    },
  };
}

test('concurrent first samples persist both VMs, cached samples are unique and network history survives restart', async () => {
  const f = fixture(),
    suite = new FeatureSuite(f.machines, f.workspaces);
  const point = networkRates(sample(40, 2000, 5000), sample());
  f.setPoint(point);
  await Promise.all([suite.sample(f.id), suite.sample(f.secondId), suite.sample(f.id)]);
  assert.equal((await suite.view(f.id)).history.length, 1);
  await suite.close();
  const restarted = new FeatureSuite(f.machines, f.workspaces);
  try {
    assert.equal((await restarted.view(f.id)).history[0].networkReceiveBytesPerSecond, 100);
    assert.equal((await restarted.view(f.secondId)).history.length, 1);
    const persisted = JSON.parse(await readFile(join(root, 'feature-suite.json'), 'utf8'));
    assert.equal(persisted.history[f.secondId][0].networkTransmitBytesPerSecond, 300);
  } finally {
    await restarted.close();
  }
});

test('real task failures and unhealthy desired services create durable alerts once, while stopped services and old tasks stay quiet', async () => {
  const f = fixture();
  let jobs: any[] = [],
    services: any[] = [];
  const observations = { jobs: () => jobs, services: (id: string) => (id === f.id ? services : []) };
  let suite = new FeatureSuite(f.machines, f.workspaces, observations);
  suite.enableBackground();
  await suite.update(f.id, { alerts: { enabled: true } });
  const backup = {
    id: randomUUID(),
    vmId: f.id,
    scope: 'backups',
    status: 'error',
    title: '创建备份',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    error: 'password=must-not-be-notified',
  };
  jobs = [backup, { ...backup, id: randomUUID(), finishedAt: new Date(0).toISOString() }];
  services = [
    {
      name: 'web',
      desired: true,
      status: 'exhausted',
      projectId: 'project-one',
      checkedAt: new Date().toISOString(),
    },
    {
      name: 'stopped',
      desired: false,
      status: 'unhealthy',
      projectId: 'default',
      checkedAt: new Date().toISOString(),
    },
  ];
  // Monitoring continues in an automation maintenance window, without starting or stopping the guest.
  await saveMaintenancePolicy(f.id, {
    enabled: true,
    windows: [{ days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'UTC', start: '00:00', end: '00:00' }],
  });
  try {
    await suite.tick();
    let events = (await suite.view(f.id)).events;
    assert.equal(events.length, 2);
    assert.ok(events.some((entry) => entry.kind === 'backup' && entry.jobId === backup.id));
    assert.ok(events.some((entry) => entry.kind === 'service' && entry.projectId === 'project-one'));
    assert.ok(!JSON.stringify(events).includes('must-not-be-notified'));
    await suite.acknowledge(f.id, events[0].id);
    await suite.tick();
    assert.equal((await suite.view(f.id)).events.length, 2);
    await suite.close();
    suite = new FeatureSuite(f.machines, f.workspaces, observations);
    suite.enableBackground();
    f.stop();
    await suite.tick();
    events = (await suite.view(f.id)).events;
    assert.equal(events.length, 2);
    assert.equal(events.filter((event) => event.acknowledged).length, 1);
    jobs = [];
    await suite.tick();
    jobs = [backup];
    await suite.tick();
    assert.equal((await suite.view(f.id)).events.length, 2);
    assert.equal((await suite.view(f.secondId)).events.length, 0);
  } finally {
    await suite.close();
  }
});

test('resource thresholds respect cooldown and disabled operational categories do not create events', async () => {
  const f = fixture();
  const suite = new FeatureSuite(f.machines, f.workspaces, {
    jobs: () => [
      {
        id: randomUUID(),
        vmId: f.id,
        status: 'error',
        scope: 'backups',
        log: '',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      },
    ],
  });
  suite.enableBackground();
  try {
    await suite.update(f.id, {
      alerts: { enabled: true, cpuPercent: 10, taskFailures: false, serviceFailures: false },
    });
    await suite.tick();
    f.setPoint({ ...sample(), sampledAt: new Date(Date.now() + 1).toISOString() });
    await suite.tick();
    const events = (await suite.view(f.id)).events;
    assert.deepEqual(
      events.map((entry) => entry.kind),
      ['cpu'],
    );
  } finally {
    await suite.close();
  }
});

test('the scheduler records successful probes, failed probes and stopped time for an exportable availability report', async (t) => {
  const f = fixture(),
    suite = new FeatureSuite(f.machines, f.workspaces);
  let now = Date.UTC(2026, 0, 1),
    status = 'running',
    failed = false;
  t.mock.method(Date, 'now', () => now);
  f.machines.state = () => status;
  f.workspaces.metrics = async () => {
    if (failed) throw new Error('SSH unavailable');
    return { ...sample(), sampledAt: new Date(now).toISOString() };
  };
  suite.enableBackground();
  try {
    await suite.tick();
    now += 30000;
    await suite.tick();
    now += 30000;
    failed = true;
    await suite.tick();
    now += 30000;
    await suite.tick();
    now += 30000;
    status = 'stopped';
    await suite.tick();
    now += 30000;
    await suite.tick();
    const result = (await new CapabilityActions(f.machines, f.workspaces).run(
      f.id,
      'availability-report',
      { hours: 1 },
      new AbortController().signal,
    )) as any;
    assert.equal(result.code, 0);
    assert.equal(result.availablePercent, 40);
    assert.equal(result.durationsSeconds.running, 60);
    assert.equal(result.durationsSeconds.unreachable, 60);
    assert.equal(result.durationsSeconds.stopped, 30);
    assert.equal(JSON.parse(result.download.content).lastStatus, 'stopped');
  } finally {
    await suite.close();
  }
});
