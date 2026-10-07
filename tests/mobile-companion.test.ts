/**
 * 模块职责：回归验证模块，围绕 `mobile-companion` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `mobile-companion`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: mobile companion pairs through a bounded code and filters durable read-only feeds; mobile disconnect revokes its server credential.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MobileCompanion } from '../server/mobile-companion.ts';
import type { AccessControl } from '../server/access-control.ts';

const ownerId = '00000000-0000-4000-8000-000000000001';
const vmA = '00000000-0000-4000-8000-000000000002';
const vmB = '00000000-0000-4000-8000-000000000003';
const defaultPolicy = { enabled: true, vmIds: [vmA], kinds: ['cpu'] };

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: mobile companion pairs through a bounded code and filters durable read-only feeds
 * 状态影响 / State effects: `now`, `service`, `allowed`, `ownerPresent`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.ok(address && typeof address !== 'string')`; `assert.equal(page.status, 200)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('mobile companion pairs through a bounded code and filters durable read-only feeds', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-mobile-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'mobile.json');
  let now = Date.UTC(2026, 0, 1), ownerPresent = true, allowed = true;
  const access = { enabled: true, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`ownerPresent ? [{ id: ownerId, role: 'owner' }] : []`）。
   * Result: Return the branch-computed value (`ownerPresent ? [{ id: ownerId, role: 'owner' }] : []`).
   * 验证场景 / Scenario: mobile companion pairs through a bounded code and filters durable read-only feeds
   */
  users: () => ownerPresent
    ? [{ id: ownerId, role: 'owner' }] : [] } as unknown as AccessControl;
  let service = new MobileCompanion(access, async () => ({
    vms: [{ id: vmA, name: 'Allowed', status: 'running' },
      { id: vmB, name: 'Private', status: 'stopped' }],
    alerts: [
      { id: 'a', vmId: vmA, kind: 'cpu', message: 'sensitive detail',
        createdAt: new Date(now).toISOString(), acknowledged: false },
      { id: 'b', vmId: vmB, kind: 'cpu', message: 'private machine',
        createdAt: new Date(now).toISOString(), acknowledged: false },
      { id: 'c', vmId: vmA, kind: 'secret', message: 'private secret name',
        createdAt: new Date(now).toISOString(), acknowledged: false },
    ],
  }), () => { if (!allowed) throw new Error('locked'); }, file, () => now);
  await service.init();
  const server = createServer((request, response) => void service.handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await service.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const origin = `https://127.0.0.1:${address.port}`;
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: path: string; input: unknown; extra: Record<string, string> = {}。
   * 结果：返回分支计算值（`fetch(base + path, { method: 'POST', headers: { origin, 'content-type': 'applica…`）。
   * Result: Return the branch-computed value (`fetch(base + path, { method: 'POST', headers: { origin, 'content-type': 'applica…`).
   * 验证场景 / Scenario: mobile companion pairs through a bounded code and filters durable read-only feeds
   * 协作入口 / Collaborators: `fetch`, `JSON.stringify`.
   */
  const post = (path: string, input: unknown, extra: Record<string, string> = {}) =>
    fetch(base + path, { method: 'POST', headers: { origin, 'content-type': 'application/json',
      ...extra }, body: JSON.stringify(input) });

  const page = await fetch(base + '/mobile/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.equal((await fetch(base + '/mobile/feed')).status, 401);
  await assert.rejects(service.action(ownerId, { operation: 'pair', policy: {
    ...defaultPolicy, vmIds: [vmA, vmA] } }));
  const pairing = await service.action(ownerId, { operation: 'pair', policy: defaultPolicy });
  assert.ok('code' in pairing && typeof pairing.code === 'string');
  assert.equal((await fetch(base + '/mobile/connect', { method: 'POST',
    headers: { origin: 'https://attacker.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Phone', code: pairing.code }) })).status, 403);
  for (let index = 0; index < 5; index++)
    assert.equal((await post('/mobile/connect', { name: 'Phone', code: 'x'.repeat(12) })).status, 403);
  assert.equal((await post('/mobile/connect', { name: 'Phone', code: pairing.code })).status, 429);
  now += 60_001;
  const connected = await post('/mobile/connect', { name: 'Phone', code: pairing.code });
  assert.equal(connected.status, 201);
  const cookie = connected.headers.get('set-cookie')?.split(';')[0] || '';
  assert.match(cookie, /^__Host-sakura-mobile=[a-f0-9]{64}$/);
  assert.ok(!await readFile(file, 'utf8').then((content) => content.includes(cookie.split('=')[1])));
  assert.equal((await post('/mobile/connect', { name: 'Replay', code: pairing.code })).status, 403);
  const feedResponse = await fetch(base + '/mobile/feed', { headers: { cookie } });
  assert.equal(feedResponse.status, 200);
  const feed = await feedResponse.json();
  assert.deepEqual(feed.vms, [{ id: vmA, name: 'Allowed', status: 'running' }]);
  assert.deepEqual(feed.alerts.map((item: { id: string }) => item.id), ['a']);
  assert.ok(!JSON.stringify(feed).includes('sensitive detail'));
  assert.ok(!JSON.stringify(feed).includes('Private'));
  assert.ok(!JSON.stringify(feed).includes('private secret'));
  const id = service.view(ownerId).devices[0].id;
  await service.action(ownerId, { operation: 'policy', id,
    policy: { enabled: false, vmIds: [vmA], kinds: ['cpu'] } });
  const paused = await fetch(base + '/mobile/feed', { headers: { cookie } }).then((res) => res.json());
  assert.deepEqual(paused.vms, []);
  assert.deepEqual(paused.alerts, []);
  await service.close();
  service = new MobileCompanion(access, async () => ({ vms: [], alerts: [] }),
    () => { if (!allowed) throw new Error('locked'); }, file, () => now);
  await service.init();
  assert.equal(service.view(ownerId).devices[0].policy.enabled, false);
  allowed = false;
  assert.equal((await fetch(base + '/mobile/feed', { headers: { cookie } })).status, 400);
  allowed = true;
  ownerPresent = false;
  assert.equal((await fetch(base + '/mobile/feed', { headers: { cookie } })).status, 403);
  ownerPresent = true;
  await service.action(ownerId, { operation: 'revoke', id });
  assert.equal((await fetch(base + '/mobile/feed', { headers: { cookie } })).status, 401);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: mobile disconnect revokes its server credential
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.ok(address && typeof address !== 'string')`; `assert.ok('code' in pairing && typeof pairing.code === 'string')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('mobile disconnect revokes its server credential', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-mobile-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const access = { enabled: true, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回列表形式的受控数据，供调用者遍历或比较。
   * Result: Return controlled data as a list for iteration or comparison.
   * 验证场景 / Scenario: mobile disconnect revokes its server credential
   */
  users: () => [{ id: ownerId, role: 'owner' }] } as
    unknown as AccessControl;
  const service = new MobileCompanion(access, async () => ({
    vms: [{ id: vmA, name: 'Allowed', status: 'running' }], alerts: [] }),
    undefined, join(directory, 'mobile.json'));
  await service.init();
  const server = createServer((request, response) => void service.handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await service.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const origin = `https://127.0.0.1:${address.port}`;
  const pairing = await service.action(ownerId, { operation: 'pair', policy: defaultPolicy });
  assert.ok('code' in pairing && typeof pairing.code === 'string');
  const connected = await fetch(base + '/mobile/connect', { method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Phone', code: pairing.code }) });
  const cookie = connected.headers.get('set-cookie')?.split(';')[0] || '';
  assert.equal(service.view(ownerId).devices.length, 1);
  const removed = await fetch(base + '/mobile/disconnect', { method: 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(removed.status, 200);
  assert.match(removed.headers.get('set-cookie') || '', /Max-Age=0/);
  assert.equal(service.view(ownerId).devices.length, 0);
  assert.equal((await fetch(base + '/mobile/feed', { headers: { cookie } })).status, 401);
});
