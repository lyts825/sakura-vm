import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorSnapshot } from '../server/monitor.ts';

test('monitor snapshots expose bounded instance state and task metadata without secrets or logs', async () => {
  const sensitive = 'PRIVATE_VALUE_MUST_NOT_BE_CACHED';
  const machines: any = {
    list: async () =>
      Array.from({ length: 105 }, (_, index) => ({
        id: `vm-${index}`,
        name: `machine-${index}`,
        status: 'running',
        cpus: 2,
        memoryMiB: 512,
        sshKey: sensitive,
        projects: [sensitive],
      })),
  };
  const stores: any = [
    {
      list: () =>
        Array.from({ length: 110 }, (_, index) => ({
          id: `job-${index}`,
          vmId: 'vm-0',
          scope: 'suite',
          action: index === 109 ? 'cat /private/key' : 'sample',
          title: sensitive,
          status: 'done',
          log: sensitive,
          result: { secret: sensitive },
          execution: { command: sensitive },
          startedAt: new Date(index * 1000).toISOString(),
        })),
    },
  ];
  const snapshot = await monitorSnapshot(machines, stores);
  assert.equal(snapshot.totalVms, 105);
  assert.equal(snapshot.totalJobs, 110);
  assert.equal(snapshot.vms.length, 100);
  assert.equal(snapshot.jobs.length, 100);
  assert.equal(snapshot.jobs[0].id, 'job-109');
  assert.equal(snapshot.jobs[0].action, 'task');
  assert.equal(snapshot.jobs[1].action, 'sample');
  assert.ok(!JSON.stringify(snapshot).includes(sensitive));
  assert.ok(!JSON.stringify(snapshot).includes('/private/key'));
  assert.ok(Math.abs(Date.now() - Date.parse(snapshot.capturedAt)) < 2000);
});
