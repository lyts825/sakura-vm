/**
 * 模块职责：回归验证模块，围绕 `clipboard-policy` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `clipboard-policy`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: clipboard rules inherit per application and explicit instance overrides stay isolated; clipboard directions, binary items and byte limits enforce independent policies including terminal transport bounds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipboardPolicyReason,
  defaultClipboardPolicies,
  effectiveClipboardRule,
  parseClipboardPolicies,
} from '../shared/clipboard-policy.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: clipboard rules inherit per application and explicit instance overrides stay isolated
 * 状态影响 / State effects: `state.defaults.terminal.paste`, `state.instances[id]`, `state.instances[id].terminal!.copy`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `defaultClipboardPolicies`, `parseClipboardPolicies`, `assert.equal`, `effectiveClipboardRule`.
 * 检查边界 / Checked boundaries: `assert.equal(effectiveClipboardRule(parsed, { app: 'terminal' }).paste, false)`; `assert.equal(effectiveClipboardRule(parsed, { app: 'terminal', vmId: id }).paste, true)`.
 */
test('clipboard rules inherit per application and explicit instance overrides stay isolated', () => {
  const state = defaultClipboardPolicies(),
    id = '11111111-1111-4111-8111-111111111111';
  state.defaults.terminal.paste = false;
  state.instances[id] = { terminal: { ...state.defaults.terminal, paste: true } };
  const parsed = parseClipboardPolicies(state);
  assert.equal(effectiveClipboardRule(parsed, { app: 'terminal' }).paste, false);
  assert.equal(effectiveClipboardRule(parsed, { app: 'terminal', vmId: id }).paste, true);
  assert.equal(
    effectiveClipboardRule(parsed, { app: 'terminal', vmId: '22222222-2222-4222-8222-222222222222' }).paste,
    false,
  );
  assert.equal(effectiveClipboardRule(parsed, { app: 'files', vmId: id }).paste, true);
  state.instances[id].terminal!.copy = false;
  assert.equal(parsed.instances[id].terminal!.copy, true, 'stored snapshots are independent copies');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: clipboard directions, binary items and byte limits enforce independent policies including terminal transport bounds
 * 状态影响 / State effects: `rule.copy`, `rule.files`, `rule.maxTextBytes`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `defaultClipboardPolicies`, `assert.equal`, `clipboardPolicyReason`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(clipboardPolicyReason(rule, 'paste', 1, true, 'files'), null)`; `assert.match(clipboardPolicyReason(rule, 'copy', 1, false, 'files')!, /禁止.*复制/)`.
 */
test('clipboard directions, binary items and byte limits enforce independent policies including terminal transport bounds', () => {
  const rule = defaultClipboardPolicies().defaults.files;
  assert.equal(clipboardPolicyReason(rule, 'paste', 1, true, 'files'), null);
  rule.copy = false;
  assert.match(clipboardPolicyReason(rule, 'copy', 1, false, 'files')!, /禁止.*复制/);
  assert.equal(clipboardPolicyReason(rule, 'paste', 1, false, 'files'), null);
  rule.files = false;
  assert.match(clipboardPolicyReason(rule, 'paste', 0, true, 'files')!, /文件与图片/);
  rule.maxTextBytes = 4096;
  assert.equal(clipboardPolicyReason(rule, 'paste', 4096, false, 'files'), null);
  assert.match(clipboardPolicyReason(rule, 'paste', 4097, false, 'files')!, /4 KiB/);
  rule.maxTextBytes = 1048576;
  assert.match(clipboardPolicyReason(rule, 'paste', 16385, false, 'terminal')!, /16 KiB/);
  assert.equal(clipboardPolicyReason(rule, 'paste', 16385, false, 'files'), null);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: invalid or unbounded clipboard policies are rejected instead of weakening constraints
 * 协作入口 / Collaborators: `defaultClipboardPolicies`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.throws(() => parseClipboardPolicies(input))`; `assert.throws(() => parseClipboardPolicies({ ...valid, defaults: { ...valid.defaults, files: { ...valid.defaults.files, maxTextByt…`.
 */
test('invalid or unbounded clipboard policies are rejected instead of weakening constraints', () => {
  const valid = defaultClipboardPolicies();
  for (const input of [
    null,
    [],
    {},
    { ...valid, version: 2 },
    { ...valid, secret: 'not allowed' },
    { ...valid, defaults: { ...valid.defaults, unknown: valid.defaults.files } },
    { ...valid, instances: { global: {} } },
  ])
    assert.throws(() => parseClipboardPolicies(input));
  for (const size of [0, 1023, 1048577, 1024.5, Infinity])
    assert.throws(() =>
      parseClipboardPolicies({
        ...valid,
        defaults: { ...valid.defaults, files: { ...valid.defaults.files, maxTextBytes: size } },
      }),
    );
  assert.throws(() =>
    parseClipboardPolicies({
      ...valid,
      defaults: { ...valid.defaults, files: { ...valid.defaults.files, copy: 'false' } },
    }),
  );
});
