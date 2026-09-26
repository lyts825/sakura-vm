import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalStores } from '../src/terminal-store.ts';
import { applyTerminalLayout, restoreLayouts } from '../src/terminal-layouts.ts';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  const getStore = createTerminalStores(() => storage);
  const store = getStore('first-vm');
  store.dispatch({ type: 'add', id: 'build' });
  store.dispatch({ type: 'add', id: 'logs' });
  return { getStore, store, storage, saved };
}

test('saved layouts restore names, ordering and selection without losing active sessions', () => {
  const { store, storage } = fixture();
  const layout = {
    id: 'dev-layout',
    name: 'Development',
    tabs: [
      { id: 'main', name: 'Shell' },
      { id: 'build', name: 'Build' },
    ],
    active: 'build',
    split: true,
    secondary: 'main',
  };
  assert.equal(restoreLayouts([layout]).length, 1);
  store.applyLayout(layout);
  assert.deepEqual(
    store.getSnapshot().tabs.map((tab) => tab.id),
    ['main', 'build', 'logs'],
  );
  assert.equal(store.getSnapshot().active, 'build');
  assert.equal(createTerminalStores(() => storage)('first-vm').getSnapshot().tabs[0].name, 'Shell');
  assert.deepEqual(restoreLayouts([{ ...layout, active: 'missing' }]), []);
  assert.throws(
    () =>
      applyTerminalLayout(
        {
          tabs: Array.from({ length: 8 }, (_, index) => ({ id: 'existing-' + index, name: 'Existing' })),
          active: 'existing-0',
        },
        layout,
      ),
    /8/,
  );
});

test('a terminal closed after all views unmount stays removed when restored from storage', async () => {
  const { store, storage, saved } = fixture();
  let notifications = 0;
  const unmount = store.subscribe(() => {
    notifications++;
  });
  const response = deferred();
  const pending = store.close('logs', () => response.promise);
  unmount();
  const count = notifications;
  response.resolve();
  await pending;
  assert.equal(notifications, count, 'the unmounted view receives no updates');
  assert.deepEqual(
    JSON.parse(saved.get('sakura-terminals-first-vm')!).map((tab: { id: string }) => tab.id),
    ['main', 'build'],
  );
  // A fresh store registry models reopening the page from persistent storage.
  const restored = createTerminalStores(() => storage)('first-vm');
  assert.deepEqual(
    restored.getSnapshot().tabs.map((tab) => tab.id),
    ['main', 'build'],
  );
});

test('a late close preserves additions, renames and selection made by a remounted view', async () => {
  const { getStore, store, saved } = fixture();
  const response = deferred();
  const pending = store.close('main', () => response.promise);
  const unmount = store.subscribe(() => {});
  unmount();

  // Switching to a different VM changes an entirely separate store.
  const other = getStore('second-vm');
  other.dispatch({ type: 'add', id: 'other-shell' });
  const otherSaved = saved.get('sakura-terminals-second-vm');
  const remounted = getStore('first-vm');
  assert.equal(remounted, store);
  remounted.dispatch({ type: 'add', id: 'new-shell' });
  remounted.dispatch({ type: 'rename', id: 'build', name: 'Build renamed after remount' });
  remounted.dispatch({ type: 'select', id: 'new-shell' });
  let current = remounted.getSnapshot();
  const unsubscribe = remounted.subscribe(() => {
    current = remounted.getSnapshot();
  });
  response.resolve();
  await pending;
  unsubscribe();

  assert.deepEqual(
    current.tabs.map((tab) => tab.id),
    ['build', 'logs', 'new-shell'],
  );
  assert.equal(current.tabs[0].name, 'Build renamed after remount');
  assert.equal(current.active, 'new-shell');
  assert.equal(current.closing, null);
  assert.deepEqual(JSON.parse(saved.get('sakura-terminals-first-vm')!), current.tabs);
  assert.equal(saved.get('sakura-terminals-second-vm'), otherSaved);
  assert.equal(other.getSnapshot().active, 'other-shell');
});

test('closing remains serialized after remount and never sends a request for the final session', async () => {
  const { getStore, store } = fixture();
  const response = deferred();
  let requests = 0;
  const pending = store.close('logs', () => {
    requests++;
    return response.promise;
  });
  const remounted = getStore('first-vm');
  assert.equal(remounted.getSnapshot().closing, 'logs');
  await remounted.close('build', async () => {
    requests++;
  });
  assert.equal(requests, 1);
  response.resolve();
  await pending;
  await remounted.close('build', async () => {
    requests++;
  });
  await remounted.close('main', async () => {
    requests++;
  });
  assert.equal(requests, 2);
  assert.deepEqual(
    remounted.getSnapshot().tabs.map((tab) => tab.id),
    ['main'],
  );
});

test('a failed close retains the latest tabs and exposes a retryable error to the remounted view', async () => {
  const { getStore, store, saved } = fixture();
  const response = deferred();
  const pending = store.close('logs', () => response.promise);
  const remounted = getStore('first-vm');
  remounted.dispatch({ type: 'rename', id: 'logs', name: 'Keep this session' });
  response.reject(new Error('SSH disconnected'));
  await pending;
  assert.equal(remounted.getSnapshot().error, 'SSH disconnected');
  assert.equal(remounted.getSnapshot().closing, null);
  assert.equal(remounted.getSnapshot().tabs.find((tab) => tab.id === 'logs')?.name, 'Keep this session');
  assert.deepEqual(JSON.parse(saved.get('sakura-terminals-first-vm')!), remounted.getSnapshot().tabs);
  await remounted.close('logs', async () => {});
  assert.equal(remounted.getSnapshot().error, '');
  assert.ok(!remounted.getSnapshot().tabs.some((tab) => tab.id === 'logs'));
});

test('unavailable storage does not break closing or in-page recovery after remount', async () => {
  const getStore = createTerminalStores(() => {
    throw new Error('Storage is disabled');
  });
  const store = getStore('private-vm');
  store.dispatch({ type: 'add', id: 'second' });
  const response = deferred();
  const pending = store.close('main', () => response.promise);
  response.resolve();
  await pending;
  const remounted = getStore('private-vm').getSnapshot();
  assert.deepEqual(
    remounted.tabs.map((tab) => tab.id),
    ['second'],
  );
  assert.equal(remounted.active, 'second');
});
