/**
 * 模块职责：回归验证模块，围绕 `clipboard-protection` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `clipboard-protection`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: clipboard detection reports categories without exposing any matching secret; clipboard detection preserves ordinary text and references, and bounds multibyte payloads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sensitiveClipboardReason, assertClipboardSafe } from '../src/clipboard-protection';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: clipboard detection reports categories without exposing any matching secret
 * 协作入口 / Collaborators: `'a'.repeat`, `'Ab1_'.repeat`, `'Q'.repeat`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(sensitiveClipboardReason(text))`; `assert.throws( () => assertClipboardSafe(text, true), (error: any) => { assert.ok(!error.message.includes(text)); return /已阻止/.tes…`.
 */
test('clipboard detection reports categories without exposing any matching secret', () => {
  const inputs = [
    '-----BEGIN OPENSSH PRIVATE KEY-----\nprivate content',
    'ghp_' + 'a'.repeat(36),
    'sk-proj-' + 'Ab1_'.repeat(30),
    'AKIA' + 'Q'.repeat(16),
    'https://example-user:password1234@example.invalid/',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJleGFtcGxlIn0.' + 'a'.repeat(24),
    'API_KEY="a-long-private-value-1234"',
  ];
  for (const text of inputs) {
    assert.ok(sensitiveClipboardReason(text));
    assert.throws(
      () => assertClipboardSafe(text, true),
      (error: any) => {
        assert.ok(!error.message.includes(text));
        return /已阻止/.test(error.message);
      },
    );
    assert.doesNotThrow(() => assertClipboardSafe(text, false));
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: clipboard detection preserves ordinary text and references, and bounds multibyte payloads
 * 协作入口 / Collaborators: `assert.equal`, `sensitiveClipboardReason`, `assert.match`, `'花'.repeat`.
 * 检查边界 / Checked boundaries: `assert.equal(sensitiveClipboardReason(text), null, text)`; `assert.match(sensitiveClipboardReason('花'.repeat(400000))!, /上限/)`.
 */
test('clipboard detection preserves ordinary text and references, and bounds multibyte payloads', () => {
  for (const text of [
    '樱花项目的说明',
    'ssh-ed25519 AAAA public@example',
    'password: ${DATABASE_PASSWORD}',
    'api_key = process.env.SERVICE_KEY',
    'client_secret = <placeholder-value>',
    'password = [REDACTED]',
  ])
    assert.equal(sensitiveClipboardReason(text), null, text);
  assert.match(sensitiveClipboardReason('花'.repeat(400000))!, /上限/);
  for (let index = 0; index < 3; index++) assert.ok(sensitiveClipboardReason('ghp_' + 'a'.repeat(36)));
});
