/**
 * 模块职责：回归验证模块，围绕 `local-aliases` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `local-aliases`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: managed hosts block preserves unrelated records and rejects takeover or malformed markers; local aliases persist opt-in, reconcile renamed entries and remove only their own block.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingressAlias } from '../shared/http-ingress.ts';
import { LocalAliases, renderLocalAliases } from '../server/local-aliases.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: managed hosts block preserves unrelated records and rejects takeover or malformed markers
 * 协作入口 / Collaborators: `ingressAlias`, `randomUUID`, `Buffer.from`, `renderLocalAliases`.
 * 检查边界 / Checked boundaries: `assert.ok(text.startsWith('\ufeff# Windows hosts\r\n127.0.0.1 custom.test\r\n'))`; `assert.match(text, new RegExp(`127\\.0\\.0\\.1 ${first}`))`.
 */
test('managed hosts block preserves unrelated records and rejects takeover or malformed markers', () => {
  const first = ingressAlias(randomUUID());
  const second = ingressAlias(randomUUID());
  const original = Buffer.from('\ufeff# Windows hosts\r\n127.0.0.1 custom.test\r\n');
  const updated = renderLocalAliases(original, [first, second]).next;
  const text = updated.toString('utf8');
  assert.ok(text.startsWith('\ufeff# Windows hosts\r\n127.0.0.1 custom.test\r\n'));
  assert.match(text, new RegExp(`127\\.0\\.0\\.1 ${first}`));
  assert.deepEqual(renderLocalAliases(updated, [first, second]).next, updated);
  assert.deepEqual(renderLocalAliases(updated, []).next, original);
  assert.throws(() => renderLocalAliases(Buffer.from(`192.0.2.1 ${first}\n`), [first]),
    /已被其他 hosts 规则占用/);
  assert.throws(() => renderLocalAliases(Buffer.from('# BEGIN SAKURA LOCAL ALIASES\n'), [first]),
    /标记区块不完整/);
  assert.throws(() => renderLocalAliases(Buffer.from(
    '# BEGIN SAKURA LOCAL ALIASES\n127.0.0.1 custom.test\n# END SAKURA LOCAL ALIASES\n'),
    [first]), /未知内容/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: local aliases persist opt-in, reconcile renamed entries and remove only their own block
 * 状态影响 / State effects: `names`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.equal((await manager.view()).enabled, false)`; `assert.equal((await manager.view()).missing.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('local aliases persist opt-in, reconcile renamed entries and remove only their own block', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-local-aliases-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hosts = join(root, 'hosts');
  const store = join(root, 'settings.json');
  const first = ingressAlias(randomUUID());
  const second = ingressAlias(randomUUID());
  let names = [first];
  const original = '# existing\n127.0.0.1 custom.test\n';
  await writeFile(hosts, original);
  const manager = new LocalAliases(() => names, hosts, store);
  await manager.init();
  assert.equal((await manager.view()).enabled, false);
  await manager.action({ action: 'set-enabled', enabled: true });
  assert.equal((await manager.view()).missing.length, 0);
  assert.match(await readFile(hosts, 'utf8'), new RegExp(first));
  names = [second];
  await manager.refresh();
  const changed = await readFile(hosts, 'utf8');
  assert.ok(changed.includes(second));
  assert.ok(!changed.includes(first));
  const restarted = new LocalAliases(() => names, hosts, store);
  await restarted.init();
  assert.equal((await restarted.view()).enabled, true);
  await restarted.action({ action: 'set-enabled', enabled: false });
  assert.equal(await readFile(hosts, 'utf8'), original);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed hosts update retains the requested state and can be retried after repair
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.rejects(manager.action({ action: 'set-enabled', enabled: true }))`; `assert.equal((await manager.view()).enabled, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('failed hosts update retains the requested state and can be retried after repair', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-local-alias-retry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hosts = join(root, 'missing-hosts');
  const store = join(root, 'settings.json');
  const alias = ingressAlias(randomUUID());
  const manager = new LocalAliases(() => [alias], hosts, store);
  await manager.init();
  await assert.rejects(manager.action({ action: 'set-enabled', enabled: true }));
  assert.equal((await manager.view()).enabled, true);
  await writeFile(hosts, '127.0.0.1 localhost\n');
  await manager.action({ action: 'sync' });
  assert.equal((await manager.view()).error, undefined);
  assert.match(await readFile(hosts, 'utf8'), new RegExp(alias));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: system resolver mismatch remains visible after hosts synchronization
 * 状态影响 / State effects: `address`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.rejects(manager.action({ action: 'set-enabled', enabled: true }), /不是本机回环地址/)`; `assert.equal((await manager.view()).missing.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('system resolver mismatch remains visible after hosts synchronization', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-local-alias-resolver-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hosts = join(root, 'hosts');
  const alias = ingressAlias(randomUUID());
  let address = '192.0.2.8';
  await writeFile(hosts, '127.0.0.1 localhost\n');
  const manager = new LocalAliases(() => [alias], hosts, join(root, 'settings.json'),
    async () => address);
  await manager.init();
  await assert.rejects(manager.action({ action: 'set-enabled', enabled: true }), /不是本机回环地址/);
  assert.equal((await manager.view()).missing.length, 0);
  assert.match((await manager.view()).error || '', /192\.0\.2\.8/);
  address = '127.0.0.1';
  await manager.action({ action: 'sync' });
  assert.equal((await manager.view()).error, undefined);
});
