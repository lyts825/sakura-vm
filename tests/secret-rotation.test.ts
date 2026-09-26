import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { secretRotation } from '../server/secret-rotation';

const root = await mkdtemp(join(tmpdir(), 'sakura-secret-rotation-'));
process.env.SAKURA_DATA_DIR = root;
const { Secrets } = await import('../server/secrets.ts');
const { Machines } = await import('../server/machines.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-secret-rotation-'));
  await rm(root, { recursive: true, force: true });
});

test('rotation deadlines handle reminder boundaries, disabled policies and unknown timestamps', () => {
  const start = Date.UTC(2026, 0, 1),
    day = 86400000;
  const policy = { enabled: true, maxAgeDays: 90, remindBeforeDays: 14 };
  const view = (days: number) =>
    secretRotation('token', new Date(start).toISOString(), policy, start + days * day);
  assert.equal(view(75).status, 'current');
  assert.equal(view(76).status, 'due-soon');
  assert.equal(view(90).status, 'overdue');
  assert.equal(view(91).daysRemaining, -1);
  assert.equal(view(-1).status, 'unknown');
  assert.equal(secretRotation('token', 'unknown', policy).status, 'unknown');
  assert.equal(secretRotation('token', new Date(start).toISOString(), {}).status, 'disabled');
  assert.throws(() => secretRotation('token', new Date(start).toISOString(), { ...policy, maxAgeDays: 7 }));
});

test('only changing the protected value resets secret age; policy and reminder metadata survive restart', async (t) => {
  let now = Date.UTC(2026, 0, 1),
    decryptions = 0;
  t.mock.method(Date, 'now', () => now);
  const id = randomUUID(),
    machines = new Machines({} as any);
  machines.get = (() => ({ id })) as any;
  const protector = async (operation: 'protect' | 'unprotect', value: string) => {
    if (operation === 'unprotect') {
      decryptions++;
      return value.slice(7);
    }
    return 'cipher:' + value;
  };
  const secrets = new Secrets(machines, protector, root);
  await secrets.save(id, { name: 'api-token', value: 'first-private-value' });
  await secrets.setRotation(id, {
    name: 'api-token',
    policy: { enabled: true, maxAgeDays: 30, remindBeforeDays: 7 },
  });
  now += 25 * 86400000;
  const before = (await secrets.rotation(id))[0];
  assert.equal(before.status, 'due-soon');
  assert.equal(decryptions, 0, 'Age metadata must not decrypt a value');
  await secrets.save(id, { name: 'api-token', value: 'first-private-value' });
  assert.deepEqual((await secrets.rotation(id))[0], before);
  const reloaded = new Secrets(machines, protector, root);
  assert.deepEqual((await reloaded.rotation(id))[0], before);
  await reloaded.save(id, { name: 'api-token', value: 'different-private-value' });
  const changed = (await reloaded.rotation(id))[0];
  assert.equal(changed.ageDays, 0);
  assert.equal(changed.status, 'current');
  assert.deepEqual(changed.policy, before.policy);
  assert.ok(!JSON.stringify(changed).includes('private-value'));
  assert.ok(!(await readFile(join(root, id + '.json'), 'utf8')).includes('private-value'));
  await reloaded.remove(id, 'api-token');
  assert.deepEqual(await reloaded.rotation(id), []);
  await assert.rejects(reloaded.setRotation(id, { name: 'missing', policy: {} }), /不存在/);
});
