import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveShortcuts,
  eventShortcut,
  normalizeShortcut,
  shortcutContext,
  validateShortcuts,
} from '../src/shortcuts.ts';

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
