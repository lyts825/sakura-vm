/**
 * 模块职责：回归验证模块，围绕 `plugin-data` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `plugin-data`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: concurrent version writers cannot downgrade and preserve each exact recovery generation; plugin data migrates only in memory until a write, retaining a recovery copy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { readVersionedStore, writeVersionedStore } from '../server/plugin-data.ts';
import { MetadataStore } from '../server/metadata-store.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: concurrent version writers cannot downgrade and preserve each exact recovery generation
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `t.after`.
 * 检查边界 / Checked boundaries: `assert.deepEqual( outcomes.map((item) => item.status), ['fulfilled', 'fulfilled', 'rejected'], )`; `assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { schemaVersion: 3, data: values[1] })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('concurrent version writers cannot downgrade and preserve each exact recovery generation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-plugin-versions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'data.json'),
    schema = z.object({ name: z.string() });
  const original = '{"schemaVersion":1,"data":{"name":"initial"}}';
  await writeFile(file, original);
  const values = [{ name: 'v2' }, { name: 'v3' }, { name: 'stale' }];
  const outcomes = await Promise.allSettled(
    values.map((value, index) => writeVersionedStore(file, [2, 3, 2][index], schema, value)),
  );
  assert.deepEqual(
    outcomes.map((item) => item.status),
    ['fulfilled', 'fulfilled', 'rejected'],
  );
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { schemaVersion: 3, data: values[1] });
  assert.equal(await readFile(`${file}.v1.bak`, 'utf8'), original);
  assert.deepEqual(JSON.parse(await readFile(`${file}.v2.bak`, 'utf8')), {
    schemaVersion: 2,
    data: values[0],
  });
  await new MetadataStore(file, { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`null`）。
   * Result: Return the branch-computed value (`null`).
   * 验证场景 / Scenario: concurrent version writers cannot downgrade and preserve each exact recovery generation
   */
  fallback: () => null }).flush();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plugin data migrates only in memory until a write, retaining a recovery copy
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `z.object({ names: z.array(z.string()) }).strict`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(value, { names: ['build', 'test'] })`; `assert.equal(await readFile(file, 'utf8'), original)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('plugin data migrates only in memory until a write, retaining a recovery copy', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sakura-plugin-data-'));
  const file = join(folder, 'commands.json');
  const schema = z.object({ names: z.array(z.string()) }).strict();
  const original = JSON.stringify(['build', 'test']);
  try {
    await writeFile(file, original);
    const value = await readVersionedStore(file, 1, schema, () => ({ names: [] }), {
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: raw。
       * 结果：返回分支计算值（`({ names: raw })`）。
       * Result: Return the branch-computed value (`({ names: raw })`).
       * 验证场景 / Scenario: plugin data migrates only in memory until a write, retaining a recovery copy
       */
      0: (raw) => ({ names: raw }),
    });
    assert.deepEqual(value, { names: ['build', 'test'] });
    assert.equal(await readFile(file, 'utf8'), original);
    await writeVersionedStore(file, 1, schema, value);
    assert.equal(await readFile(`${file}.v0.bak`, 'utf8'), original);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { schemaVersion: 1, data: value });
    await assert.rejects(readVersionedStore(file, 0, schema, () => ({ names: [] })));
    await writeFile(file, JSON.stringify({ schemaVersion: 2, data: value }));
    await assert.rejects(
      readVersionedStore(file, 1, schema, () => ({ names: [] })),
      /版本过新/,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
