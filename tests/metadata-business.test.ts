/**
 * 模块职责：回归验证模块，围绕 `metadata-business` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `metadata-business`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: concurrent boot failures fill the circuit exactly once and survive reopening without lost attempts.
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: concurrent boot failures fill the circuit exactly once and survive reopening without lost attempts
 * 协作入口 / Collaborators: `randomUUID`, `Promise.allSettled`, `Array.from`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 5)`; `assert.equal((item.reason as { code: string }).code, 'BOOT_CIRCUIT_OPEN')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('concurrent boot failures fill the circuit exactly once and survive reopening without lost attempts', async () => {
  const id = randomUUID(),
    now = 600_000;
  const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => recordBootAttempt(id, now)));
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 5);
  for (const item of attempts.filter((item) => item.status === 'rejected'))
    assert.equal((item.reason as { code: string }).code, 'BOOT_CIRCUIT_OPEN');
  assert.equal((await bootGuardStatus(id, now)).failures, 5);
  const file = join(root, 'machines', id, 'boot-guard.json');
  const reopened = new MetadataStore(file, { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ attempts: [] as number[] })`）。
   * Result: Return the branch-computed value (`({ attempts: [] as number[] })`).
   * 验证场景 / Scenario: concurrent boot failures fill the circuit exactly once and survive reopening without lost attempts
   */
  fallback: () => ({ attempts: [] as number[] }) });
  await reopened.flush();
  assert.deepEqual((await reopened.read()).value.attempts, Array(5).fill(now));
  await resetBootGuard(id);
  await recordBootAttempt(id, now + 1);
  assert.equal((await bootGuardStatus(id, now + 1)).failures, 1);
});

for (const kind of ['suite', 'extended', 'next'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `Object.assign`, `create`, `join`, `randomUUID`.
   * 检查边界 / Checked boundaries: `assert.equal(await enabled(b, first), true)`; `assert.equal(await enabled(a, third), true)`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test(`${kind} metadata merges independent instances and never exposes or republishes a failed edit`, async (t) => {
    const machines: any = Object.assign(new EventEmitter(), {
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: id: string。
       * 结果：返回分支计算值（`({ id })`）。
       * Result: Return the branch-computed value (`({ id })`).
       */
      get: (id: string) => ({ id }),
      records: new Map(),
      live: new Map(),
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`'stopped'`）。
       * Result: Return the branch-computed value (`'stopped'`).
       */
      state: () => 'stopped',
      /**
       * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
       * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       */
      requireUnlocked: () => {},
    });
    const workspaces: any = {
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`() => {}`）。
       * Result: Return the branch-computed value (`() => {}`).
       */
      beforeConfigChange: () => () => {},
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`() => {}`）。
       * Result: Return the branch-computed value (`() => {}`).
       */
      onConfigChange: () => () => {},
      projects: { /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`'default'`）。
       * Result: Return the branch-computed value (`'default'`).
       */
      current: () => 'default', /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: id: string。
       * 结果：返回分支计算值（`id`）。
       * Result: Return the branch-computed value (`id`).
       */
      key: (id: string) => id },
    };
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`kind === 'suite' ? new FeatureSuite(machines, workspaces) : kind === 'extended' …`）。
     * Result: Return the branch-computed value (`kind === 'suite' ? new FeatureSuite(machines, workspaces) : kind === 'extended' …`).
     */
    const create = () =>
      kind === 'suite'
        ? new FeatureSuite(machines, workspaces)
        : kind === 'extended'
          ? new ExtendedFeatures(machines, workspaces)
          : new NextFeatures(machines, workspaces);
    const a = create(),
      b = create();
    const feature = kind === 'extended' ? 'qemu-commandline' : 'network-topology';
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: service: ReturnType<typeof create>; id: string; enabled: boolean。
     * 结果：返回分支计算值（`service instanceof FeatureSuite ? service.update(id, { schedule: { enabled } }) …`）。
     * Result: Return the branch-computed value (`service instanceof FeatureSuite ? service.update(id, { schedule: { enabled } }) …`).
     * 协作入口 / Collaborators: `service.update`, `service.configure`.
     */
    const configure = (service: ReturnType<typeof create>, id: string, enabled: boolean) =>
      service instanceof FeatureSuite
        ? service.update(id, { schedule: { enabled } })
        : service.configure(id, { featureId: feature, enabled });
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: service: ReturnType<typeof create>; id: string。
     * 结果：返回分支计算值（`(view.settings as any)[kind === 'suite' ? 'schedule' : feature]?.enabled`），以 Promise 交付。
     * Result: Return the branch-computed value (`(view.settings as any)[kind === 'suite' ? 'schedule' : feature]?.enabled`) through a Promise.
     * 协作入口 / Collaborators: `service.view`.
     */
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
