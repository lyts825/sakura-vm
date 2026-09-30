import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateQemuWithMirroredDisk, type MigrationQmp } from '../server/live-migration-transport.ts';

const cpus = (model = 'Nehalem-v1', core = 0) => [
  {
    type: model + '-x86_64-cpu',
    'vcpus-count': 1,
    props: { 'socket-id': 0, 'core-id': core, 'thread-id': 0 },
    'qom-path': '/machine/unattached/device[0]',
  },
];

async function check(sourceCpus: unknown, targetCpus: unknown, failure: RegExp) {
  const changes: string[] = [];
  const endpoint =
    (running: boolean, slots: unknown): MigrationQmp =>
    async (command) => {
      if (command === 'query-status') return { running, status: running ? 'running' : 'paused' };
      if (command === 'query-version') return { qemu: { major: 11, minor: 1, micro: 0 } };
      if (command === 'query-hotpluggable-cpus') return slots;
      if (command === 'query-block') throw new Error('CPU compatibility accepted');
      changes.push(command);
      throw new Error('Unexpected mutation');
    };
  await assert.rejects(
    migrateQemuWithMirroredDisk({
      source: endpoint(true, sourceCpus),
      target: endpoint(false, targetCpus),
      sourceDiskNode: 'source',
      targetDiskNode: 'target',
      nbdListen: { type: 'inet', host: '127.0.0.1', port: '12000' },
      nbdConnect: { type: 'inet', host: '127.0.0.1', port: '12000' },
      incomingUri: 'tcp:127.0.0.1:12001',
      outgoingUri: 'tcp:127.0.0.1:12001',
      fenceSource: async () => {
        changes.push('fence');
      },
    }),
    failure,
  );
  assert.deepEqual(changes, [], 'CPU validation must finish before migration or fencing');
}

test('migration refuses legacy CPU models and changed topology before changing either VM', async () => {
  await check(cpus('qemu64-v1'), cpus(), /CPU models or topology differ/);
  await check(cpus(), cpus('Nehalem-v1', 1), /CPU models or topology differ/);
  await check(cpus(), [], /invalid CPU slots/);
});

test('matching CPU layouts allow different QOM paths, property order and slot order', async () => {
  await check(
    [...cpus(), ...cpus('Nehalem-v1', 1)],
    [
      ...cpus('Nehalem-v1', 1),
      {
        ...cpus()[0],
        props: { 'thread-id': 0, 'core-id': 0, 'socket-id': 0 },
        'qom-path': '/different/target/path',
      },
    ],
    /CPU compatibility accepted/,
  );
});
