import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

const directory = await mkdtemp(join(tmpdir(), 'sakura-capabilities-'));
process.env.SAKURA_DATA_DIR = directory;
const { dependencyOrder, CapabilityActions } = await import('../server/capability-actions.ts');
const { capabilityParameters } = await import('../server/capability-definitions.ts');
const { NextFeatures } = await import('../server/next-features.ts');
const { ExtendedFeatures } = await import('../server/extended-features.ts');
const { taskSlo, metricExport, baselineAnomalies } = await import('../server/capability-reports.ts');
const { Jobs } = await import('../server/jobs.ts');
after(() => rm(directory, { recursive: true, force: true }));
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const c = '33333333-3333-4333-8333-333333333333';

test('large structured job results survive log truncation, restart and detect tampering', async () => {
  const root = await mkdtemp(join(directory, 'job-results-'));
  const jobs = new Jobs('large-result', root);
  const result = { content: '中文内容'.repeat(40000), last: 'complete' };
  const job = jobs.start('large', async (log, _signal, _update, save) => {
    await save(result);
    log(JSON.stringify(result));
    throw new Error('failed check');
  });
  await jobs.wait('large');
  assert.equal(job.status, 'error');
  assert.equal(job.log.length, 32768);
  assert.deepEqual(await jobs.result(job.id!), result);
  await jobs.close();
  const reloaded = new Jobs('large-result', root);
  assert.deepEqual(await reloaded.result(job.id!), result);
  await writeFile(join(root, 'large-result.json.results', job.id! + '.json'), '{"tampered":true}');
  await assert.rejects(reloaded.result(job.id!), /校验/);
  await reloaded.close();
});

test('PAC rules match exact domain boundaries and reject invalid proxy ports', async () => {
  const { runReport } = await import('../server/capability-reports.ts');
  const spaces: any = { projects: { current: () => 'default' } };
  const report: any = await runReport(
    {} as any,
    spaces,
    a,
    'proxy-pac',
    {
      rules: [{ domain: 'example.com', subdomains: true, proxy: 'PROXY localhost:8080' }],
    },
    new AbortController().signal,
  );
  const context = {};
  const fn = runInNewContext(report.download.content + '\nFindProxyForURL', context);
  assert.equal(fn('', 'EXAMPLE.com'), 'PROXY localhost:8080');
  assert.equal(fn('', 'sub.example.com'), 'PROXY localhost:8080');
  assert.equal(fn('', 'evilexample.com'), 'DIRECT');
  await assert.rejects(
    runReport(
      {} as any,
      spaces,
      a,
      'proxy-pac',
      {
        rules: [{ domain: 'example.com', subdomains: true, proxy: 'PROXY localhost:99999' }],
      },
      new AbortController().signal,
    ),
    /端口/,
  );
});

test('dependency startup validates cycles and waits in topological order', async () => {
  assert.deepEqual(dependencyOrder(a, { [a]: [b, c], [b]: [c] }), [c, b, a]);
  assert.throws(() => dependencyOrder(a, { [a]: [b], [b]: [a] }), /循环/);
  const states = new Map<string, string>(),
    started: string[] = [];
  const machines: any = {
    get: (id: string) => ({ id, name: id }),
    requireUnlocked() {},
    state: (id: string) => states.get(id) || 'stopped',
    async start(id: string) {
      started.push(id);
      states.set(id, 'running');
    },
  };
  const actions = new CapabilityActions(machines, {} as any);
  const result = await actions.run(
    a,
    'vm-dependency-start',
    { dependencies: { [a]: [b], [b]: [c] } },
    new AbortController().signal,
  );
  assert.equal(result.ready, true);
  assert.deepEqual(started, [c, b, a]);
  await assert.rejects(
    actions.run(
      a,
      'vm-dependency-start',
      { dependencies: { [a]: [b], [b]: [a] } },
      new AbortController().signal,
    ),
  );
  assert.equal(started.length, 3);
});

test('capability parameters reject traversal and unknown fields', () => {
  assert.throws(() => capabilityParameters('directory-history', { mode: 'snapshot', path: '../outside' }));
  assert.throws(() => capabilityParameters('test-sharding', { files: ['a'], shards: 0 }));
  assert.throws(() => capabilityParameters('test-matrix', { targets: [], argv: ['echo'] }));
  assert.throws(() => capabilityParameters('network-topology', { arbitrary: true }));
});

test('task SLO treats missing samples and interruptions truthfully', () => {
  assert.equal(taskSlo([], 99).actualPercent, null);
  const result = taskSlo(
    [{ status: 'done' }, { status: 'error' }, { status: 'interrupted' }, { status: 'running' }] as any,
    90,
  );
  assert.equal(result.samples, 3);
  assert.equal(result.failed, 2);
  assert.equal(result.achieved, false);
  assert.ok(result.remainingFailures < 0);
});

test('metrics formats escape labels and retain nanosecond timestamps without precision loss', () => {
  const point = {
    sampledAt: '2026-09-26T00:00:00.123Z',
    cpuPercent: 25,
    memoryUsed: 10,
    memoryTotal: 20,
    diskUsed: 30,
    diskTotal: 40,
  };
  const text = metricExport(a, 'quoted"\nname', point, 'prometheus').content;
  assert.ok(text.includes('vm_name="quoted\\"\\nname"'));
  const json = JSON.parse(metricExport(a, 'test', point, 'otlp-json').content);
  const gauge = json.resourceMetrics[0].scopeMetrics[0].metrics[0].gauge;
  assert.equal(gauge.dataPoints[0].timeUnixNano, (BigInt(Date.parse(point.sampledAt)) * 1000000n).toString());
  assert.equal(gauge.dataPoints[0].asDouble, 25);
  assert.throws(() => metricExport(a, 'test', { ...point, cpuPercent: NaN }, 'prometheus'));
});

test('anomaly detection excludes the latest point from its baseline', () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({
    sampledAt: new Date(index * 1000).toISOString(),
    cpuPercent: index === 6 ? 90 : 2,
    memoryUsed: 100,
    memoryTotal: 1000,
    diskUsed: 200,
    diskTotal: 2000,
  }));
  const result = baselineAnomalies(rows, 30, 3);
  assert.deepEqual(
    result.anomalies.map((item) => item.field),
    ['cpuPercent'],
  );
  assert.throws(() => baselineAnomalies(rows.slice(0, 3), 30, 3), /至少/);
});

test('capability worker exercises actual files and subprocesses', { timeout: 90000 }, () => {
  const python = process.env.SAKURA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, ['tests/capability_runner_test.py'], {
    encoding: 'utf8',
    timeout: 80000,
    env: { ...process.env, PYTHONUTF8: '1' },
  });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
});

function fixture() {
  let result = { code: 0, shards: [] },
    calls = 0;
  const machines: any = {
    on() {}, off() {},
    get: (id: string) => ({ id, forwards: [], distro: 'alpine' }),
    requireUnlocked() {},
    state: () => 'running',
    live: new Map(),
    locked: async (_: string, action: () => Promise<unknown>) => action(),
    writeGuestFile: async () => {},
    exec: async () => {
      calls++;
      return { stdout: JSON.stringify(result), stderr: '', code: result.code };
    },
  };
  const workspaces: any = {
    beforeConfigChange: () => () => {},
    projects: {
      current: () => 'default',
      key: (id: string) => id,
      with: async (_id: string, _project: string, action: () => Promise<unknown>) => action(),
    },
    resolvedConfig: async () => ({ directory: '/workspace', environment: {} }),
  };
  return {
    machines,
    workspaces,
    fail: () => {
      result = { code: 8, shards: [] };
    },
    calls: () => calls,
  };
}

test('platform action executes sharding, logs failures, and validates before queueing', async () => {
  const f = fixture(),
    service = new NextFeatures(f.machines, f.workspaces);
  try {
    const view = await service.view(a);
    assert.ok(view.capabilities.some((item) => item.id === 'test-sharding'));
    await assert.rejects(
      service.action(a, { action: 'run', featureId: 'test-sharding', options: { files: [] } }),
    );
    assert.equal(f.calls(), 0);
    const job: any = await service.action(a, {
      action: 'run',
      featureId: 'test-sharding',
      options: { files: ['a'], mode: 'plan' },
    });
    await service.jobs.wait(job.key);
    assert.equal(service.jobs.view(job.key)?.status, 'done');
    f.fail();
    const failed: any = await service.action(a, {
      action: 'run',
      featureId: 'test-sharding',
      options: { files: ['a'], mode: 'plan' },
    });
    await service.jobs.wait(failed.key);
    assert.equal(service.jobs.view(failed.key)?.status, 'error');
    assert.match(service.jobs.view(failed.key)?.log || '', /"code":8/);
  } finally {
    await service.close();
  }
});

test('cross-instance test matrix preserves each failure in the job result', async () => {
  const f = fixture(),
    service = new ExtendedFeatures(f.machines, f.workspaces);
  f.fail();
  try {
    const job: any = await service.action(a, {
      action: 'run',
      featureId: 'test-matrix',
      options: {
        targets: [{ vmId: a }, { vmId: b }],
        argv: ['python3', '-m', 'unittest'],
      },
    });
    await service.jobs.wait(job.key);
    assert.equal(service.jobs.view(job.key)?.status, 'error');
    const result = JSON.parse(service.jobs.view(job.key)!.log);
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every((item: any) => item.code === 8));
  } finally {
    await service.close();
  }
});
