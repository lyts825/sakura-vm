/**
 * 模块职责：回归验证模块，围绕 `snapshot-merge` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `snapshot-merge`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: three-way merge applies independent edits and refuses conflicting changes; three-way merge rejects a symlink parent crossing into another path.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { planSnapshotMerge } from '../server/snapshot-merge.ts';
import type { SnapshotDiffFile } from '../shared/snapshot-diff.ts';

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: path: string; hash: string。
 * 结果：返回分支计算值（`({ path, type: 'file', bytes: 1, sha256: hash.repeat(64) })`）。
 * Result: Return the branch-computed value (`({ path, type: 'file', bytes: 1, sha256: hash.repeat(64) })`).
 * 协作入口 / Collaborators: `hash.repeat`.
 */
const file = (path: string, hash: string): SnapshotDiffFile =>
  ({ path, type: 'file', bytes: 1, sha256: hash.repeat(64) });
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: files: SnapshotDiffFile[]。
 * 结果：返回分支计算值（`new Map(files.map((item) => [item.path, item]))`）。
 * Result: Return the branch-computed value (`new Map(files.map((item) => [item.path, item]))`).
 * 协作入口 / Collaborators: `files.map`.
 */
const map = (...files: SnapshotDiffFile[]) => new Map(files.map((item) => [item.path, item]));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: three-way merge applies independent edits and refuses conflicting changes
 * 协作入口 / Collaborators: `map`, `file`, `planSnapshotMerge`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(plan.apply.map((item) => item.path), ['/workspace/delete', '/workspace/edit', '/workspace/new'])`; `assert.deepEqual(plan.conflicts, ['/workspace/conflict'])`.
 */
test('three-way merge applies independent edits and refuses conflicting changes', () => {
  const base = map(file('/workspace/edit', 'a'), file('/workspace/delete', 'a'),
    file('/workspace/conflict', 'a'), file('/workspace/same', 'a'));
  const branch = map(file('/workspace/edit', 'b'), file('/workspace/conflict', 'b'),
    file('/workspace/same', 'b'), file('/workspace/new', 'b'));
  const target = map(file('/workspace/edit', 'a'), file('/workspace/delete', 'a'),
    file('/workspace/conflict', 'c'), file('/workspace/same', 'b'),
    file('/workspace/target-only', 'c'));
  const plan = planSnapshotMerge(base, branch, target);
  assert.deepEqual(plan.apply.map((item) => item.path),
    ['/workspace/delete', '/workspace/edit', '/workspace/new']);
  assert.deepEqual(plan.conflicts, ['/workspace/conflict']);
  assert.deepEqual(plan.already, ['/workspace/same']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: three-way merge rejects a symlink parent crossing into another path
 * 协作入口 / Collaborators: `planSnapshotMerge`, `map`, `file`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(plan.conflicts, ['/workspace/dir'])`; `assert.deepEqual(plan.apply, [])`.
 */
test('three-way merge rejects a symlink parent crossing into another path', () => {
  const link: SnapshotDiffFile = { path: '/workspace/dir', type: 'symlink', target: '../elsewhere' };
  const plan = planSnapshotMerge(map(), map(link), map(file('/workspace/dir/child', 'a')));
  assert.deepEqual(plan.conflicts, ['/workspace/dir']);
  assert.deepEqual(plan.apply, []);
});
