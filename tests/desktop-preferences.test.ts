/**
 * 模块职责：回归验证模块，围绕 `desktop-preferences` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `desktop-preferences`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: desktop preference drafts survive a remount until a guest read confirms them; legacy raw preference storage is upgraded without allowing unknown fields.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  editDesktopPreferences,
  loadDesktopPreferences,
  mergeDesktopPreferences,
  receiveDesktopPreferences,
  saveDesktopPreferences,
} from '../src/desktop-preferences.ts';
import { defaultDesktopPreferences, parseDesktopPreferencesFile } from '../server/desktop-preferences.ts';

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `getItem, setItem`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `getItem, setItem`; the actual branch determines its shape.
 */
function storage() {
  const values = new Map<string, string>();
  return {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: key: string。
     * 结果：返回分支计算值（`values.get(key) ?? null`）。
     * Result: Return the branch-computed value (`values.get(key) ?? null`).
     * 协作入口 / Collaborators: `values.get`.
     */
    getItem: (key: string) => values.get(key) ?? null,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: key: string; value: string。
     * 结果：返回分支计算值（`void values.set(key, value)`）。
     * Result: Return the branch-computed value (`void values.set(key, value)`).
     * 协作入口 / Collaborators: `values.set`.
     */
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: desktop preference drafts survive a remount until a guest read confirms them
 * 协作入口 / Collaborators: `storage`, `editDesktopPreferences`, `saveDesktopPreferences`, `loadDesktopPreferences`.
 * 检查边界 / Checked boundaries: `assert.equal(remounted.pending, true)`; `assert.equal(remounted.preferences.wallpaper, 'midnight')`.
 */
test('desktop preference drafts survive a remount until a guest read confirms them', () => {
  const browser = storage();
  const id = 'vm';
  const edited = editDesktopPreferences(
    { preferences: defaultDesktopPreferences, pending: false },
    {
      sessionType: 'wayland',
      resolution: '1920x1080',
      monitorLayout: 'dual-horizontal',
      scale: 150,
      theme: 'midnight',
      wallpaper: 'midnight',
      accent: '#e6a6cb',
      panel: 'top',
      autoHidePanel: true,
      animations: false,
    },
  );
  saveDesktopPreferences(id, edited, () => browser);
  const remounted = loadDesktopPreferences(id, () => browser);
  assert.equal(remounted.pending, true);
  assert.equal(remounted.preferences.wallpaper, 'midnight');
  assert.equal(remounted.preferences.monitorLayout, 'dual-horizontal');
  assert.equal(remounted.preferences.sessionType, 'wayland');

  const oldGuest = { status: 'ready' as const, log: '', preferences: defaultDesktopPreferences };
  assert.deepEqual(receiveDesktopPreferences(remounted, oldGuest), remounted);
  const confirmed = { ...oldGuest, preferences: edited.preferences };
  assert.deepEqual(receiveDesktopPreferences(remounted, confirmed), {
    preferences: edited.preferences,
    pending: false,
  });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy raw preference storage is upgraded without allowing unknown fields
 * 协作入口 / Collaborators: `storage`, `browser.setItem`, `JSON.stringify`, `loadDesktopPreferences`.
 * 检查边界 / Checked boundaries: `assert.equal(restored.preferences.resolution, '1440x900')`; `assert.equal(restored.preferences.wallpaper, 'paper')`.
 */
test('legacy raw preference storage is upgraded without allowing unknown fields', () => {
  const browser = storage();
  browser.setItem(
    'sakura-desktop-preferences:vm',
    JSON.stringify({
      resolution: '1440x900',
      wallpaper: 'paper',
      staleField: 'discard me',
    }),
  );
  const restored = loadDesktopPreferences('vm', () => browser);
  assert.equal(restored.preferences.resolution, '1440x900');
  assert.equal(restored.preferences.wallpaper, 'paper');
  assert.equal(restored.preferences.monitorLayout, 'single');
  assert.equal(restored.preferences.sessionType, 'auto');
  assert.equal(restored.pending, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: browser preference validation preserves the server-supported scale range
 * 协作入口 / Collaborators: `assert.equal`, `mergeDesktopPreferences`, `parseDesktopPreferencesFile`.
 * 检查边界 / Checked boundaries: `assert.equal(mergeDesktopPreferences({ scale: 137 }).scale, 137)`; `assert.equal(mergeDesktopPreferences({ scale: 99 }).scale, defaultDesktopPreferences.scale)`.
 */
test('browser preference validation preserves the server-supported scale range', () => {
  assert.equal(mergeDesktopPreferences({ scale: 137 }).scale, 137);
  assert.equal(mergeDesktopPreferences({ scale: 99 }).scale, defaultDesktopPreferences.scale);
  assert.equal(mergeDesktopPreferences({ scale: Number.NaN }).scale, defaultDesktopPreferences.scale);
  assert.equal(mergeDesktopPreferences({ sessionType: 'wayland' }).sessionType, 'wayland');
  assert.equal(mergeDesktopPreferences({ sessionType: 'arbitrary' }).sessionType, 'auto');
  assert.equal(parseDesktopPreferencesFile("SESSION_TYPE='wayland'\nRESOLUTION='1440x900'").sessionType, 'wayland');
  assert.equal(parseDesktopPreferencesFile("SESSION_TYPE='arbitrary'").sessionType, 'auto');
});
