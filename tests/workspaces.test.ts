import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Workspaces } from '../server/workspaces.ts';
import type { Machines } from '../server/machines.ts';

const sample =
  'CPU\ncpu 1 0 0 9 0 0 0 0\ncpu 2 0 0 18 0 0 0 0\nMEMORY\nMemTotal: 1000 kB\nMemAvailable: 500 kB\nDISK\n/dev/vda 1000 500 500 50% /\nPROCESSES\n1 init\nUPTIME\n1.0 0.5\n';
function fixture() {
  const live = { status: 'running', startedAt: 'first' };
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([['vm', live]]),
    records: new Map([['vm', { template: 'none' }]]),
    state: () => live.status,
  }) as unknown as Machines;
  const workspaces = new Workspaces(machines);
  return { machines, live, workspaces };
}

test('metrics deduplicate concurrent reads and a failed old boot cannot evict the new boot sample', async () => {
  const { machines, live, workspaces } = fixture();
  const pending: {
    resolve: (value: { stdout: string; stderr: string; code: number }) => void;
    reject: (error: Error) => void;
  }[] = [];
  machines.exec = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  try {
    const first = workspaces.metrics('vm');
    const rejected = assert.rejects(first, /old boot/);
    assert.equal(workspaces.metrics('vm'), first);
    assert.equal(pending.length, 1);
    live.status = 'stopped';
    machines.emit('change');
    live.status = 'running';
    live.startedAt = 'second';
    machines.emit('change');
    const second = workspaces.metrics('vm');
    assert.notEqual(second, first);
    pending[0].reject(new Error('old boot'));
    await rejected;
    assert.equal(workspaces.metrics('vm'), second);
    assert.equal(pending.length, 2);
    pending[1].resolve({ stdout: sample, stderr: '', code: 0 });
    assert.equal((await second).cpuPercent, 10);
  } finally {
    await workspaces.close();
  }
});

test('workspace shutdown detaches lifecycle observers before later machine events', async () => {
  const { machines, workspaces } = fixture();
  assert.equal(machines.listenerCount('change'), 1);
  await workspaces.close();
  machines.records.get('vm')!.template = 'node';
  assert.equal(machines.listenerCount('change'), 0);
  assert.doesNotThrow(() => machines.emit('change'));
  assert.equal(workspaces.jobs.view('vm'), null);
});
