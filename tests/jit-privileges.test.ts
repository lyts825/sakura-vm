import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JitPrivileges } from '../server/jit-privileges.ts';
import type { AccessControl, Principal } from '../server/access-control.ts';
import type { Machines } from '../server/machines.ts';

const vmId = '00000000-0000-4000-8000-000000000001';
const otherVmId = '00000000-0000-4000-8000-000000000002';
const viewerId = '00000000-0000-4000-8000-000000000003';
const ownerId = '00000000-0000-4000-8000-000000000004';

test('JIT approval is scoped, durable, expiring, revocable and consumed before execution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-jit-'));
  const file = join(directory, 'jit.json');
  let now = Date.UTC(2026, 0, 1), starts = 0, stops = 0, failStart = false;
  const users = [{ id: viewerId, username: 'reader', role: 'viewer' as const,
    vmIds: [vmId], expiresAt: now + 86_400_000 }];
  const access = { enabled: true, users: () => users } as unknown as AccessControl;
  const machines = {
    get: (id: string) => {
      if (id !== vmId && id !== otherVmId) throw new Error('实例不存在');
    },
    requireUnlocked: () => {},
    start: async () => {
      starts++;
      if (failStart) throw new Error('启动失败');
    },
    stop: async (_id: string, force: boolean) => {
      assert.equal(force, false);
      stops++;
    },
  } as unknown as Machines;
  const viewer: Principal = { id: viewerId, username: 'reader', role: 'viewer',
    vmIds: [vmId], expiresAt: now + 3_600_000 };
  const owner: Principal = { id: ownerId, username: 'owner', role: 'owner',
    vmIds: [], expiresAt: now + 8 * 3_600_000 };
  const service = new JitPrivileges(access, machines, file, () => now);
  await service.init();
  try {
    await assert.rejects(service.create(owner,
      { vmId, operation: 'start', reason: 'Need a temporary boot' }), /账户没有/);
    await assert.rejects(service.create(viewer,
      { vmId: otherVmId, operation: 'start', reason: 'Need a temporary boot' }), /账户没有/);
    const requested = await service.create(viewer,
      { vmId, operation: 'start', reason: 'Need a temporary boot' });
    assert.equal(requested.status, 'pending');
    assert.equal(service.list(viewer).length, 1);
    assert.equal(service.list({ ...viewer, id: ownerId }).length, 0);
    await assert.rejects(service.execute(viewer, requested.id), /未获有效批准/);
    await assert.rejects(service.decide(viewer, requested.id,
      { decision: 'approve', minutes: 10 }), /只有管理员/);
    const restored = new JitPrivileges(access, machines, file, () => now);
    await restored.init();
    assert.equal(restored.list(owner)[0].id, requested.id);
    const approved = await restored.decide(owner, requested.id,
      { decision: 'approve', minutes: 10 });
    assert.equal(approved.status, 'approved');
    assert.equal(approved.expiresAt, now + 600_000);
    const [first, replay] = await Promise.allSettled([
      restored.execute(viewer, requested.id), restored.execute(viewer, requested.id),
    ]);
    assert.equal(first.status, 'fulfilled');
    assert.equal(replay.status, 'rejected');
    assert.equal(starts, 1);
    assert.equal(restored.list(owner)[0].status, 'completed');
    const expired = await restored.create(viewer,
      { vmId, operation: 'stop', reason: 'Need a clean shutdown' });
    now += 86_400_001;
    assert.equal(restored.list(owner).find((item) => item.id === expired.id)?.status, 'expired');
    await assert.rejects(restored.decide(owner, expired.id,
      { decision: 'approve', minutes: 1 }), /不再等待审批/);
    await restored.close();
    await service.close();
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('JIT denial, revocation, expiry and failed execution cannot be replayed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-jit-'));
  let now = Date.UTC(2026, 0, 1), attempts = 0, viewerExpiry = now + 86_400_000;
  const access = { enabled: true, users: () => [{ id: viewerId, role: 'viewer',
    vmIds: [vmId], expiresAt: viewerExpiry }] } as unknown as AccessControl;
  const machines = { get: () => ({}), requireUnlocked: () => {},
    start: async () => { attempts++; throw new Error('QEMU failed'); },
    stop: async () => {} } as unknown as Machines;
  const viewer: Principal = { id: viewerId, username: 'reader', role: 'viewer',
    vmIds: [vmId], expiresAt: now + 3_600_000 };
  const owner: Principal = { id: ownerId, username: 'owner', role: 'owner',
    vmIds: [], expiresAt: now + 8 * 3_600_000 };
  const service = new JitPrivileges(access, machines, join(directory, 'jit.json'), () => now);
  await service.init();
  try {
    const denied = await service.create(viewer,
      { vmId, operation: 'start', reason: 'Need a temporary boot' });
    assert.equal((await service.decide(owner, denied.id, { decision: 'deny' })).status, 'denied');
    await assert.rejects(service.execute(viewer, denied.id), /未获有效批准/);
    const revoked = await service.create(viewer,
      { vmId, operation: 'start', reason: 'Need a temporary boot' });
    await service.decide(owner, revoked.id, { decision: 'approve', minutes: 1 });
    assert.equal((await service.decide(owner, revoked.id, { decision: 'deny' })).status, 'revoked');
    await assert.rejects(service.execute(viewer, revoked.id), /未获有效批准/);
    const expired = await service.create(viewer,
      { vmId, operation: 'start', reason: 'Need a temporary boot' });
    await service.decide(owner, expired.id, { decision: 'approve', minutes: 1 });
    now += 60_001;
    await assert.rejects(service.execute(viewer, expired.id), /未获有效批准/);
    const failed = await service.create(viewer,
      { vmId, operation: 'start', reason: 'Need a temporary boot' });
    await service.decide(owner, failed.id, { decision: 'approve', minutes: 1 });
    await assert.rejects(service.execute(viewer, failed.id), /实例启动失败/);
    assert.equal(service.list(owner).find((item) => item.id === failed.id)?.status, 'failed');
    await assert.rejects(service.execute(viewer, failed.id), /已使用/);
    assert.equal(attempts, 1);
    viewerExpiry = now - 1;
    await assert.rejects(service.create(viewer,
      { vmId, operation: 'stop', reason: 'Need a clean shutdown' }), /账户已失效/);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
