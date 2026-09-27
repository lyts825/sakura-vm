import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { Engine } from '../server/runtime.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { parseGuestDns } from '../server/guest-dns.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-guest-dns-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { NextFeatures, nextFeatureCatalog } = await import('../server/next-features.ts');
const { createSchema } = await import('../server/model.ts');
const baseResult = z.object({ ready: z.boolean(), executed: z.boolean() }).passthrough();

after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.match(basename(root), /^sakura-guest-dns-test-/);
  await rm(root, { recursive: true, force: true });
});

test('DNS diagnostic parses resolver evidence without claiming DNSSEC validation', () => {
  assert.deepEqual(parseGuestDns([
    'SOURCE=/run/systemd/resolve/stub-resolv.conf',
    'NAMESERVER=127.0.0.53',
    'NAMESERVER=fd00::1',
    'DOMAIN=internal.example',
    'TOOL=resolvectl',
    'TOOL=delv',
    'DNSSEC_STATE=Global: allow-downgrade',
  ].join('\n')), {
    source: '/run/systemd/resolve/stub-resolv.conf',
    nameservers: ['127.0.0.53', 'fd00::1'],
    searchDomains: ['internal.example'],
    dnssecTools: ['resolvectl', 'delv'],
    dnssecState: 'Global: allow-downgrade',
    dnssecValidation: 'not-verified',
  });
});

test('DNS diagnostic checks the guest, runs as a recorded task and reports unreadable configuration', async () => {
  assert.equal(nextFeatureCatalog.find(([name]) => name === 'private-dns-dnssec')?.[5], 'available');
  const machines = new Machines({} as Engine), id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'dns-test' }), id,
    createdAt: new Date().toISOString(), snapshots: [],
  });
  const workspaces = {
    projects: { current: () => 'default', key: (vmId: string) => vmId },
  } as unknown as Workspaces;
  const features = new NextFeatures(machines, workspaces);
  try {
    const stopped = baseResult.parse(await features.action(id, { action: 'check', featureId: 'private-dns-dnssec' }));
    assert.equal(stopped.ready, false);
    machines.live.set(id, { status: 'running' } as any);
    const commands: string[] = [];
    machines.exec = async (_id, command) => {
      commands.push(command);
      return {
        code: 0,
        stdout: 'SOURCE=/etc/resolv.conf\nNAMESERVER=192.168.1.1\nTOOL=dig\n',
        stderr: 'secret stderr must not be reported',
      };
    };
    const checked = baseResult.extend({
      nameservers: z.array(z.string()),
      dnssecValidation: z.literal('not-verified'),
    }).parse(await features.action(id, { action: 'check', featureId: 'private-dns-dnssec' }));
    assert.equal(checked.ready, true);
    assert.equal(checked.executed, false);
    assert.deepEqual(checked.nameservers, ['192.168.1.1']);
    assert.equal(checked.dnssecValidation, 'not-verified');
    assert.equal(commands.length, 1);
    assert.match(commands[0], /\/etc\/resolv\.conf/);
    assert.doesNotMatch(JSON.stringify(checked), /secret stderr/);
    const started = z.object({ id: z.string() }).parse(
      await features.action(id, { action: 'run', featureId: 'private-dns-dnssec' }),
    );
    await features.jobs.wait(`${id}:private-dns-dnssec`);
    assert.equal(features.jobs.get(started.id)?.status, 'done');
    const result = await features.jobs.result(started.id);
    assert.equal(result.executed, true);
    assert.deepEqual(result.dnssecTools, ['dig']);
    machines.exec = async () => ({ code: 2, stdout: '', stderr: 'private failure' });
    const failed = baseResult.extend({ exitCode: z.number() }).parse(
      await features.action(id, { action: 'check', featureId: 'private-dns-dnssec' }),
    );
    assert.equal(failed.ready, false);
    assert.equal(failed.exitCode, 2);
    assert.doesNotMatch(JSON.stringify(failed), /private failure/);
  } finally {
    await features.close();
  }
});
