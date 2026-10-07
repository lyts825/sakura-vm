/**
 * 回归范围（完整情景见下方用例与断言）：
 * - concurrent boot failures fill the circuit exactly once and survive reopening without lost attempts
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { after } from 'node:test';

const root = await fs.mkdtemp(join(tmpdir(), 'sakura-metadata-business-'));
process.env.SAKURA_DATA_DIR = root;
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { ExtendedFeatures } = await import('../server/extended-features.ts');
const { NextFeatures } = await import('../server/next-features.ts');
const { bootGuardStatus, recordBootAttempt, resetBootGuard } = await import('../server/boot-guard.ts');
const { MetadataStore } = await import('../server/metadata-store.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  await fs.rm(root, { recursive: true, force: true });
});

test('concurrent boot failures fill the circuit exactly once and survive reopening without lost attempts', async () => {
  const id = randomUUID(),
    now = 600_000;
  const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => recordBootAttempt(id, now)));
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 5);
  for (const item of attempts.filter((item) => item.status === 'rejected'))
    assert.equal((item.reason as { code: string }).code, 'BOOT_CIRCUIT_OPEN');
  assert.equal((await bootGuardStatus(id, now)).failures, 5);
  const file = join(root, 'machines', id, 'boot-guard.json');
  const reopened = new MetadataStore(file, { fallback: () => ({ attempts: [] as number[] }) });
  await reopened.flush();
  assert.deepEqual((await reopened.read()).value.attempts, Array(5).fill(now));
  await resetBootGuard(id);
  await recordBootAttempt(id, now + 1);
  assert.equal((await bootGuardStatus(id, now + 1)).failures, 1);
});

for (const kind of ['suite', 'extended', 'next'] as const) {
  test(`${kind} metadata merges independent instances and never exposes or republishes a failed edit`, async (t) => {
    const machines: any = Object.assign(new EventEmitter(), {
      get: (id: string) => ({ id }),
      records: new Map(),
      live: new Map(),
      state: () => 'stopped',
      requireUnlocked: () => {},
    });
    const workspaces: any = {
      beforeConfigChange: () => () => {},
      onConfigChange: () => () => {},
      projects: { current: () => 'default', key: (id: string) => id },
    };
    const create = () =>
      kind === 'suite'
        ? new FeatureSuite(machines, workspaces)
        : kind === 'extended'
          ? new ExtendedFeatures(machines, workspaces)
          : new NextFeatures(machines, workspaces);
    const a = create(),
      b = create();
    const feature = kind === 'extended' ? 'qemu-commandline' : 'network-topology';
    const configure = (service: ReturnType<typeof create>, id: string, enabled: boolean) =>
      service instanceof FeatureSuite
        ? service.update(id, { schedule: { enabled } })
        : service.configure(id, { featureId: feature, enabled });
    const enabled = async (service: ReturnType<typeof create>, id: string) => {
      const view = await service.view(id);
      return (view.settings as any)[kind === 'suite' ? 'schedule' : feature]?.enabled;
    };
    const file = join(root, kind === 'suite' ? 'feature-suite.json' : `${kind}-features.json`);
    const first = randomUUID(),
      second = randomUUID(),
      third = randomUUID();
    try {
      await configure(a, first, true);
      assert.equal(await enabled(b, first), true); // Both instances have observed the original generation.
      await Promise.all([configure(a, second, true), configure(b, third, true)]);
      assert.equal(await enabled(a, third), true);
      assert.equal(await enabled(b, second), true);
      const originalRename = fs.rename;
      t.mock.method(
        fs,
        'rename',
        async (source: Parameters<typeof fs.rename>[0], destination: Parameters<typeof fs.rename>[1]) => {
          if (destination === file)
            throw Object.assign(new Error('injected metadata publication failure'), { code: 'EIO' });
          return originalRename(source, destination);
        },
      );
      syncBuiltinESMExports();
      await assert.rejects(configure(a, first, false), /injected metadata publication failure/);
      assert.equal(await enabled(a, first), true);
      t.mock.restoreAll();
      syncBuiltinESMExports();
      await configure(b, third, false);
      assert.equal(
        await enabled(a, first),
        true,
        'A later unrelated commit cannot republish the refused edit',
      );
      const reopened = create();
      try {
        assert.equal(await enabled(reopened, first), true);
      } finally {
        await reopened.close();
      }
      assert.ok(!(await fs.readdir(root)).some((name) => name.endsWith('.tmp')));
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      await Promise.all([a.close(), b.close()]);
    }
  });
}
