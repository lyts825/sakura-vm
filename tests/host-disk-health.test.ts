import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDiskHealth } from '../server/host-disk-health';
import { windowsProbe } from '../server/windows-probe';

const capacity = { totalBytes: 100 * 1024 ** 3, availableBytes: 50 * 1024 ** 3 };
const observation = {
  volume: { health: 'Healthy', operational: ['OK'], filesystem: 'NTFS' },
  disks: [
    {
      number: 1,
      name: 'test NVMe',
      bus: 'NVMe',
      health: 'Healthy',
      operational: ['Online'],
      counters: {
        temperatureC: 35,
        maximumTemperatureC: 80,
        wearPercent: 0,
        powerOnHours: 10,
        readErrorsUncorrected: 0,
        writeErrorsUncorrected: 0,
      },
    },
  ],
};

test('disk reports distinguish explicit zero counters from missing, partial and unmapped evidence', () => {
  assert.equal(evaluateDiskHealth(observation, capacity, {}).status, 'healthy');
  for (const change of [
    { ...observation, disks: [] },
    { ...observation, disks: [{ ...observation.disks[0], counters: null, countersError: 'Access denied' }] },
    {
      ...observation,
      disks: [{ ...observation.disks[0], counters: { ...observation.disks[0].counters, wearPercent: null } }],
    },
  ]) {
    const report = evaluateDiskHealth(change, capacity, {});
    assert.equal(report.status, 'unknown');
    assert.ok(report.findings.some((item) => item.severity === 'unknown'));
  }
  assert.throws(() => evaluateDiskHealth(observation, capacity, { arbitrary: true }));
});

test('disk reports flag actual capacity, wear, temperature and lifetime errors without inventing current failures', () => {
  const data = structuredClone(observation);
  Object.assign(data.disks[0].counters, { temperatureC: 71, wearPercent: 91, readErrorsUncorrected: 5 });
  const result = evaluateDiskHealth(data, { ...capacity, availableBytes: 1024 ** 3 }, {});
  assert.equal(result.status, 'warning');
  assert.equal(result.findings.length, 4);
  assert.match(result.findings.at(-1)!.message, /历史/);
  data.disks[0].health = 'Unhealthy';
  assert.equal(evaluateDiskHealth(data, capacity, {}).status, 'critical');
});

test(
  'Windows probe keeps shell syntax in stdin data and aborts a running query',
  { skip: process.platform !== 'win32' },
  async () => {
    const value = "中文 '$([Environment]::Exit(9))' `n";
    const result = await windowsProbe('@{value=$request.value} | ConvertTo-Json -Compress', { value });
    assert.deepEqual(result, { value });
    const abort = new AbortController();
    const request = windowsProbe('Start-Sleep -Seconds 10; @{done=$true} | ConvertTo-Json', {}, abort.signal);
    abort.abort(new Error('cancelled Windows probe'));
    await assert.rejects(request, /cancelled Windows probe/);
  },
);
