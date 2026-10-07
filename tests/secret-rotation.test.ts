/**
 * 模块职责：回归验证模块，围绕 `secret-rotation` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `secret-rotation`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: rotation deadlines handle reminder boundaries, disabled policies and unknown timestamps; only changing the protected value resets secret age; policy and reminder metadata survive restart.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: rotation deadlines handle reminder boundaries, disabled policies and unknown timestamps
 * 协作入口 / Collaborators: `Date.UTC`, `assert.equal`, `view`, `secretRotation`.
 * 检查边界 / Checked boundaries: `assert.equal(view(75).status, 'current')`; `assert.equal(view(76).status, 'due-soon')`.
 */
test('rotation deadlines handle reminder boundaries, disabled policies and unknown timestamps', () => {
  const start = Date.UTC(2026, 0, 1),
    day = 86400000;
  const policy = { enabled: true, maxAgeDays: 90, remindBeforeDays: 14 };
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: days: number。
   * 结果：返回分支计算值（`secretRotation('token', new Date(start).toISOString(), policy, start + days * da…`）。
   * Result: Return the branch-computed value (`secretRotation('token', new Date(start).toISOString(), policy, start + days * da…`).
   * 验证场景 / Scenario: rotation deadlines handle reminder boundaries, disabled policies and unknown timestamps
   * 协作入口 / Collaborators: `secretRotation`, `new Date(start).toISOString`.
   */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: only changing the protected value resets secret age; policy and reminder metadata survive restart
 * 状态影响 / State effects: `machines.get`, `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Date.UTC`, `t.mock.method`, `randomUUID`, `secrets.save`.
 * 检查边界 / Checked boundaries: `assert.equal(before.status, 'due-soon')`; `assert.equal(decryptions, 0, 'Age metadata must not decrypt a value')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('only changing the protected value resets secret age; policy and reminder metadata survive restart', async (t) => {
  let now = Date.UTC(2026, 0, 1),
    decryptions = 0;
  t.mock.method(Date, 'now', () => now);
  const id = randomUUID(),
    machines = new Machines({} as any, fakeVmNetwork);
  machines.get = (/**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id })`）。
   * Result: Return the branch-computed value (`({ id })`).
   * 验证场景 / Scenario: only changing the protected value resets secret age; policy and reminder metadata survive restart
   */
  () => ({ id })) as any;
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: operation: 'protect' | 'unprotect'; value: string。
   * 结果：返回分支计算值（`value.slice(7) / 'cipher:' + value`），以 Promise 交付。
   * Result: Return the branch-computed value (`value.slice(7) / 'cipher:' + value`) through a Promise.
   * 验证场景 / Scenario: only changing the protected value resets secret age; policy and reminder metadata survive restart
   * 协作入口 / Collaborators: `value.slice`.
   */
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
