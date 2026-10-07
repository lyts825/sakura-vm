/**
 * 模块职责：回归验证模块，围绕 `plugin-boundaries` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `plugin-boundaries`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: plugin gates cover internal domain implementations and host authority import aliases.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { pluginBoundaryErrors } from '../scripts/plugin-boundaries.ts';
/**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: file: string; code: string。
 * 结果：返回分支计算值（`pluginBoundaryErrors(file, ts.createSourceFile(file, code, ts.ScriptTarget.Lates…`）。
 * Result: Return the branch-computed value (`pluginBoundaryErrors(file, ts.createSourceFile(file, code, ts.ScriptTarget.Lates…`).
 * 协作入口 / Collaborators: `pluginBoundaryErrors`, `ts.createSourceFile`.
 */
const check = (file: string, code: string) =>
  pluginBoundaryErrors(file, ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true));
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plugin gates cover internal domain implementations and host authority import aliases
 * 协作入口 / Collaborators: `assert.match`, `check`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.match( check('server/domain.ts', "import type { Machines as VM } from './machines.ts';")[0], /VmAccess/, )`; `assert.equal( check('server/domain.ts', "import type { VmAccess as Machines } from './vm-access.ts';").length, 0, )`.
 */
test('plugin gates cover internal domain implementations and host authority import aliases', () => {
  assert.match(
    check('server/domain.ts', "import type { Machines as VM } from './machines.ts';")[0],
    /VmAccess/,
  );
  assert.equal(
    check('server/domain.ts', "import type { VmAccess as Machines } from './vm-access.ts';").length,
    0,
  );
  assert.match(
    check(
      'plugins/example/server.ts',
      "import { withPluginCleanup as allowed } from '../../server/plugin-authority.ts';",
    )[0],
    /host authority/,
  );
  assert.match(check('server/domain.ts', 'const work = new Jobs();')[0], /instance activation/);
  assert.equal(check('server/domain.ts', 'class Domain { jobs = new Jobs(); }').length, 0);
  assert.match(check('server/domain.ts', 'machines.fileBeforeReplace = work;')[0], /managed interceptor/);
  assert.match(check('server/domain.ts', 'new ProjectTerminals(vm);')[0], /shared provider/);
});
