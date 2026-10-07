/**
 * 模块职责：回归验证模块，围绕 `shortcuts` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `shortcuts`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: shortcut normalization protects standard operations and accepts platform-neutral modifier aliases; project bindings inherit live global changes, can disable individual actions, and reject conflicts in every scope.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveShortcuts,
  eventShortcut,
  normalizeShortcut,
  shortcutContext,
  validateShortcuts,
} from '../src/shortcuts.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: shortcut normalization protects standard operations and accepts platform-neutral modifier aliases
 * 协作入口 / Collaborators: `assert.equal`, `normalizeShortcut`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.equal(normalizeShortcut(' Shift + Ctrl + k '), 'Mod+Shift+K')`; `assert.equal(normalizeShortcut('cmd+k'), 'Mod+K')`.
 */
test('shortcut normalization protects standard operations and accepts platform-neutral modifier aliases', () => {
  assert.equal(normalizeShortcut(' Shift + Ctrl + k '), 'Mod+Shift+K');
  assert.equal(normalizeShortcut('cmd+k'), 'Mod+K');
  assert.equal(normalizeShortcut('/'), '/');
  assert.equal(normalizeShortcut(' '), '');
  for (const key of [
    'Mod+C',
    'Mod+T',
    'Mod+Shift+I',
    'Ctrl+1',
    'K',
    'Alt+F4',
    'Alt+Ctrl+Q',
    'Ctrl+Mod+K',
    'Mod+Shift+Shift+K',
    'Mod+Space',
  ])
    assert.throws(() => normalizeShortcut(key));
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: project bindings inherit live global changes, can disable individual actions, and reject conflicts in every scope
 * 协作入口 / Collaborators: `shortcutContext`, `assert.notEqual`, `validateShortcuts`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.notEqual(first, second)`; `assert.equal(effectiveShortcuts(preferences, first).palette, '')`.
 */
test('project bindings inherit live global changes, can disable individual actions, and reject conflicts in every scope', () => {
  const first = shortcutContext('vm-a', 'default')!,
    second = shortcutContext('vm-b', 'default')!;
  assert.notEqual(first, second);
  const preferences = validateShortcuts({
    version: 1,
    global: { theme: 'Mod+Shift+M' },
    projects: { [first]: { palette: '', theme: 'Mod+Shift+K' } },
  });
  assert.equal(effectiveShortcuts(preferences, first).palette, '');
  assert.equal(effectiveShortcuts(preferences, first).theme, 'Mod+Shift+K');
  assert.equal(effectiveShortcuts(preferences, second).palette, 'Mod+K');
  assert.equal(effectiveShortcuts(preferences, second).theme, 'Mod+Shift+M');
  assert.throws(
    () => validateShortcuts({ ...preferences, global: { settings: 'Mod+Shift+K' } }),
    /项目快捷键冲突/,
  );
  assert.throws(
    () => validateShortcuts({ version: 1, global: { theme: 'Mod+K' }, projects: {} }),
    /全局快捷键冲突/,
  );
  assert.throws(() => validateShortcuts({ version: 1, global: { unknown: 'Mod+Q' }, projects: {} }));
  assert.throws(() => validateShortcuts({ version: 1, global: {}, projects: { bad: {} } }));
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: keyboard events ignore repeats, IME, prevented events, AltGr and ambiguous modifier combinations
 * 协作入口 / Collaborators: `assert.equal`, `eventShortcut`.
 * 检查边界 / Checked boundaries: `assert.equal(eventShortcut(event), 'Mod+Shift+K')`; `assert.equal(eventShortcut({ ...event, ctrlKey: false, metaKey: true }), 'Mod+Shift+K')`.
 */
test('keyboard events ignore repeats, IME, prevented events, AltGr and ambiguous modifier combinations', () => {
  const event = {
    key: 'K',
    code: 'KeyK',
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: false,
    isComposing: false,
    repeat: false,
    defaultPrevented: false,
  };
  assert.equal(eventShortcut(event), 'Mod+Shift+K');
  assert.equal(eventShortcut({ ...event, ctrlKey: false, metaKey: true }), 'Mod+Shift+K');
  for (const patch of [
    { repeat: true },
    { isComposing: true },
    { defaultPrevented: true },
    { altKey: true },
    { metaKey: true },
  ])
    assert.equal(eventShortcut({ ...event, ...patch }), '');
  assert.equal(eventShortcut({ ...event, key: 'Process' }), '');
  assert.equal(eventShortcut({ ...event, ctrlKey: false, shiftKey: false, key: '/', code: 'Slash' }), '/');
});
