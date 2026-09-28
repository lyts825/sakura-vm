import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PackageWorkbench, parsePackageRows } from '../server/package-workbench.ts';
import type { Machines } from '../server/machines.ts';

test('apk and apt listings retain package names, versions and upgrade pairs', () => {
  assert.deepEqual(parsePackageRows('apk', 'installed',
    'alpine-baselayout-data-3.7.2-r0 x86_64 {alpine-baselayout} (GPL) [installed]\n'),
  [{ name: 'alpine-baselayout-data', version: '3.7.2-r0', installedVersion: '3.7.2-r0' }]);
  assert.deepEqual(parsePackageRows('apk', 'updates',
    'Installed: Available:\nalpine-base-3.23.4-r0 < 3.23.6-r0\n'),
  [{ name: 'alpine-base', version: '3.23.6-r0',
    installedVersion: '3.23.4-r0', availableVersion: '3.23.6-r0' }]);
  assert.deepEqual(parsePackageRows('apt', 'installed',
    'ii \tlibssl3\t3.0.0\nrc \toldpkg\t1.0\n'),
  [{ name: 'libssl3', version: '3.0.0', installedVersion: '3.0.0' }]);
  assert.deepEqual(parsePackageRows('apt', 'updates',
    'Listing...\nlibssl3/stable 3.0.1 amd64 [upgradable from: 3.0.0]\n'),
  [{ name: 'libssl3', version: '3.0.1',
    installedVersion: '3.0.0', availableVersion: '3.0.1' }]);
});

test('package changes require an unchanged one-time preview on the same VM boot', async () => {
  const boot = {};
  const vmId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  let plan = '(1/1) Installing jq (1.8.2-r0)';
  const applied: string[] = [];
  const machines = {
    get: () => ({ distro: 'alpine' }),
    state: () => 'running',
    live: new Map([[vmId, boot]]),
    requireUnlocked: () => {},
    exec: async (_id: string, command: string) => {
      assert.match(command, /^apk add --simulate/);
      return { code: 0, stdout: plan, stderr: '' };
    },
  } as unknown as Machines;
  const workbench = new PackageWorkbench(machines, (_id, operation, name) => {
    applied.push(`${operation}:${name}`);
    return { status: 'running' };
  });
  await assert.rejects(workbench.action(vmId,
    { operation: 'preview', change: 'install', name: 'jq-' }));
  const preview = await workbench.action(vmId,
    { operation: 'preview', change: 'install', name: 'jq' }) as { token: string };
  plan = '(1/1) Installing jq (1.8.3-r0)';
  await assert.rejects(workbench.action(vmId,
    { operation: 'apply', token: preview.token }), /计划已变化/);
  const next = await workbench.action(vmId,
    { operation: 'preview', change: 'install', name: 'jq' }) as { token: string };
  await workbench.action(vmId, { operation: 'apply', token: next.token });
  assert.deepEqual(applied, ['install:jq']);
  await assert.rejects(workbench.action(vmId,
    { operation: 'apply', token: next.token }), /预览已过期/);
  const stale = await workbench.action(vmId,
    { operation: 'preview', change: 'install', name: 'jq' }) as { token: string };
  machines.live.set(vmId, {} as any);
  await assert.rejects(workbench.action(vmId,
    { operation: 'apply', token: stale.token }), /预览已过期/);
});
