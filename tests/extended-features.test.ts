/**
 * 模块职责：回归验证模块，围绕 `extended-features` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `extended-features`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: the second feature tranche has 100 unique, categorized entries; engineering operations expose JSON schemas and reject unsafe project paths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extendedFeatureCatalog } from '../server/extended-features.ts';
import {
  engineeringOperations,
  operationViews,
  validateOperation,
} from '../server/engineering-operations.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the second feature tranche has 100 unique, categorized entries
 * 协作入口 / Collaborators: `assert.equal`, `extendedFeatureCatalog.map`, `assert.ok`, `extendedFeatureCatalog.every`.
 * 检查边界 / Checked boundaries: `assert.equal(extendedFeatureCatalog.length, 100)`; `assert.equal(new Set(extendedFeatureCatalog.map(([id]) => id)).size, 100)`.
 */
test('the second feature tranche has 100 unique, categorized entries', () => {
  assert.equal(extendedFeatureCatalog.length, 100);
  assert.equal(new Set(extendedFeatureCatalog.map(([id]) => id)).size, 100);
  assert.ok(new Set(extendedFeatureCatalog.map(([, , category]) => category)).size >= 8);
  assert.ok(extendedFeatureCatalog.every(([, , , priority]) => ['P0', 'P1', 'P2'].includes(priority)));
  assert.equal(extendedFeatureCatalog.find(([id]) => id === 'disk-encryption')?.[5], 'available');
  assert.equal(extendedFeatureCatalog.find(([id]) => id === 'git-stash')?.[5], 'available');
  assert.equal(extendedFeatureCatalog.find(([id]) => id === 'self-update')?.[5], 'available');
  assert.equal(extendedFeatureCatalog.find(([id]) => id === 'secure-erase')?.[5], 'available');
  assert.equal(extendedFeatureCatalog.find(([id]) => id === 'gpg-agent-forward')?.[5], 'available');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: engineering operations expose JSON schemas and reject unsafe project paths
 * 协作入口 / Collaborators: `operationViews`, `assert.ok`, `views.every`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.ok(views.length >= 30)`; `assert.ok(views.every((view) => view.schema && typeof view.schema === 'object'))`.
 */
test('engineering operations expose JSON schemas and reject unsafe project paths', () => {
  const views = operationViews();
  assert.ok(views.length >= 30);
  assert.ok(views.every((view) => view.schema && typeof view.schema === 'object'));
  assert.equal(
    validateOperation({ operation: 'hash-manifest', parameters: { path: 'src' } }).operation,
    'hash-manifest',
  );
  assert.throws(
    () => validateOperation({ operation: 'archive', parameters: { mode: 'create', path: '../outside' } }),
    /项目内的相对路径/,
  );
  assert.throws(() => validateOperation({ operation: 'missing', parameters: {} }), /操作不存在/);
  assert.equal(
    validateOperation({ operation: 'feature-run', parameters: { featureId: 'session-lock', mode: 'check' } })
      .operation,
    'feature-run',
  );
  assert.ok(engineeringOperations['command-risk'].writes === false);
});
