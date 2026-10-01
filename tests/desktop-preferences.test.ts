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

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

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

test('browser preference validation preserves the server-supported scale range', () => {
  assert.equal(mergeDesktopPreferences({ scale: 137 }).scale, 137);
  assert.equal(mergeDesktopPreferences({ scale: 99 }).scale, defaultDesktopPreferences.scale);
  assert.equal(mergeDesktopPreferences({ scale: Number.NaN }).scale, defaultDesktopPreferences.scale);
  assert.equal(mergeDesktopPreferences({ sessionType: 'wayland' }).sessionType, 'wayland');
  assert.equal(mergeDesktopPreferences({ sessionType: 'arbitrary' }).sessionType, 'auto');
  assert.equal(parseDesktopPreferencesFile("SESSION_TYPE='wayland'\nRESOLUTION='1440x900'").sessionType, 'wayland');
  assert.equal(parseDesktopPreferencesFile("SESSION_TYPE='arbitrary'").sessionType, 'auto');
});
