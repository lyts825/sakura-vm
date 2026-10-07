/**
 * 模块职责：回归验证模块，围绕 `three-way-merge` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `three-way-merge`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: three-way merge retains independent edits, insertions, deletions and newline bytes; overlapping edits and simultaneous insertions need an explicit resolution.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { threeWayMerge, resolvedMerge } from '../shared/three-way-merge.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: three-way merge retains independent edits, insertions, deletions and newline bytes
 * 协作入口 / Collaborators: `assert.equal`, `resolvedMerge`, `threeWayMerge`.
 * 检查边界 / Checked boundaries: `assert.equal(resolvedMerge(threeWayMerge(base, ours, theirs), {}), expected)`.
 */
test('three-way merge retains independent edits, insertions, deletions and newline bytes', () => {
  const cases = [
    ['a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n', 'A\nb\nC\n'],
    ['a\nb\nc\n', 'a\nc\n', 'a\nb\nc\nd\n', 'a\nc\nd\n'],
    ['a\r\nb\r\nc', 'A\r\nb\r\nc', 'a\r\nb\r\nC', 'A\r\nb\r\nC'],
    ['', 'a', 'a', 'a'],
    ['a', 'a\n', 'a', 'a\n'],
  ];
  for (const [base, ours, theirs, expected] of cases)
    assert.equal(resolvedMerge(threeWayMerge(base, ours, theirs), {}), expected);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: overlapping edits and simultaneous insertions need an explicit resolution
 * 协作入口 / Collaborators: `threeWayMerge`, `assert.equal`, `parts.filter`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.equal(parts.filter((part) => part.kind === 'conflict').length, 1)`; `assert.throws(() => resolvedMerge(parts, {}), /冲突/)`.
 */
test('overlapping edits and simultaneous insertions need an explicit resolution', () => {
  for (const input of [
    ['a\nb\n', 'a\nours\nb\n', 'a\ntheirs\nb\n'],
    ['a\nb\n', 'a\n', 'a\nB\n'],
  ]) {
    const parts = threeWayMerge(...(input as [string, string, string]));
    assert.equal(parts.filter((part) => part.kind === 'conflict').length, 1);
    assert.throws(() => resolvedMerge(parts, {}), /冲突/);
    const choices = Object.fromEntries(
      parts.flatMap((part, index) => (part.kind === 'conflict' ? [[index, part.ours]] : [])),
    );
    assert.equal(resolvedMerge(parts, choices), input[1]);
  }
  assert.throws(() => threeWayMerge('a\0b', 'a', 'b'), /文本/);
  assert.throws(() => threeWayMerge('a\n'.repeat(2100), 'b\n'.repeat(2100), 'c\n'.repeat(2100)), /差异过大/);
});
