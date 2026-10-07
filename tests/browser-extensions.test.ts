/**
 * 模块职责：回归验证模块，围绕 `browser-extensions` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `browser-extensions`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: browser extension pairing grants only scoped read access and survives restart until revoked; extension pairing limits guesses and global revocation removes durable tokens.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserExtensions } from '../server/browser-extensions.ts';
import type { AccessControl } from '../server/access-control.ts';

const ownerId = '00000000-0000-4000-8000-000000000001';
const firstOrigin = 'chrome-extension://' + 'a'.repeat(32);
const otherOrigin = 'chrome-extension://' + 'b'.repeat(32);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: browser extension pairing grants only scoped read access and survives restart until revoked
 * 状态影响 / State effects: `ownerPresent`, `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Date.UTC`.
 * 检查边界 / Checked boundaries: `assert.match(pairing.code, /^[A-Za-z0-9_-]{12}$/)`; `assert.rejects(service.connect('https://example.com', { code: pairing.code }))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('browser extension pairing grants only scoped read access and survives restart until revoked', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-extension-'));
  const file = join(directory, 'extensions.json');
  let now = Date.UTC(2026, 0, 1), ownerPresent = true;
  const access = { enabled: true, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`ownerPresent ? [{ id: ownerId, role: 'owner' }] : []`）。
   * Result: Return the branch-computed value (`ownerPresent ? [{ id: ownerId, role: 'owner' }] : []`).
   * 验证场景 / Scenario: browser extension pairing grants only scoped read access and survives restart until revoked
   */
  users: () => ownerPresent
    ? [{ id: ownerId, role: 'owner' }] : [] } as unknown as AccessControl;
  const service = new BrowserExtensions(access, file, () => now);
  await service.init();
  try {
    const pairing = service.createPairing(ownerId);
    assert.match(pairing.code, /^[A-Za-z0-9_-]{12}$/);
    await assert.rejects(service.connect('https://example.com', { code: pairing.code }));
    await assert.rejects(service.connect(firstOrigin, { code: 'A'.repeat(12) }), /配对码/);
    const connected = await service.connect(firstOrigin, { code: pairing.code });
    assert.deepEqual(connected.permissions, ['inventory:read']);
    assert.equal(service.authorize(firstOrigin, connected.token).id, connected.id);
    assert.throws(() => service.authorize(otherOrigin, connected.token), /凭证/);
    assert.throws(() => service.authorize(firstOrigin, 'f'.repeat(64)), /凭证/);
    await assert.rejects(service.connect(otherOrigin, { code: pairing.code }), /配对码/);
    assert.equal(service.list(ownerId).length, 1);
    assert.ok(!JSON.stringify(service.list(ownerId)).includes(connected.token));
    assert.ok(!await readFile(file, 'utf8').then((text) => text.includes(connected.token)));
    await service.close();
    const restarted = new BrowserExtensions(access, file, () => now);
    await restarted.init();
    assert.equal(restarted.authorize(firstOrigin, connected.token).id, connected.id);
    await restarted.revoke(ownerId, connected.id);
    assert.throws(() => restarted.authorize(firstOrigin, connected.token), /凭证/);
    const second = restarted.createPairing(ownerId);
    const renewed = await restarted.connect(firstOrigin, { code: second.code });
    ownerPresent = false;
    assert.throws(() => restarted.authorize(firstOrigin, renewed.token), /管理员账户已失效/);
    ownerPresent = true;
    now += 30 * 86_400_000;
    assert.throws(() => restarted.authorize(firstOrigin, renewed.token), /已过期/);
    await restarted.close();
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: extension pairing limits guesses and global revocation removes durable tokens
 * 状态影响 / State effects: `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Date.UTC`.
 * 检查边界 / Checked boundaries: `assert.rejects(service.connect(firstOrigin, { code: 'x'.repeat(12) }), /配对码/)`; `assert.rejects(service.connect(firstOrigin, { code: pairing.code }), /尝试过多/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('extension pairing limits guesses and global revocation removes durable tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-extension-'));
  const file = join(directory, 'extensions.json');
  let now = Date.UTC(2026, 0, 1);
  const access = { enabled: true, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回列表形式的受控数据，供调用者遍历或比较。
   * Result: Return controlled data as a list for iteration or comparison.
   * 验证场景 / Scenario: extension pairing limits guesses and global revocation removes durable tokens
   */
  users: () => [{ id: ownerId, role: 'owner' }] } as unknown as AccessControl;
  const service = new BrowserExtensions(access, file, () => now);
  await service.init();
  try {
    const pairing = service.createPairing(ownerId);
    for (let count = 0; count < 5; count++)
      await assert.rejects(service.connect(firstOrigin, { code: 'x'.repeat(12) }), /配对码/);
    await assert.rejects(service.connect(firstOrigin, { code: pairing.code }), /尝试过多/);
    now += 60_001;
    const granted = await service.connect(firstOrigin, { code: pairing.code });
    await service.revokeAll();
    assert.throws(() => service.authorize(firstOrigin, granted.token), /凭证/);
    assert.deepEqual(service.list(ownerId), []);
    const expired = service.createPairing(ownerId);
    now += 5 * 60_000;
    await assert.rejects(service.connect(otherOrigin, { code: expired.code }), /已过期/);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
