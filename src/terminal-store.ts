import { restoreTerminals, terminalReducer, type TerminalAction, type TerminalState } from './terminal-state';

type TerminalStorage = Pick<Storage, 'getItem' | 'setItem'>;
type Snapshot = TerminalState & { closing: string | null; error: string };

function createStore(id: string, storage: () => TerminalStorage) {
  const key = `sakura-terminals-${id}`;
  let saved: unknown = null;
  try {
    saved = JSON.parse(storage().getItem(key) || 'null');
  } catch {}
  let snapshot: Snapshot = { ...restoreTerminals(saved), closing: null, error: '' };
  const listeners = new Set<() => void>();

  const update = (next: Snapshot) => {
    const tabsChanged = next.tabs !== snapshot.tabs;
    snapshot = next;
    if (tabsChanged) {
      try {
        storage().setItem(key, JSON.stringify(snapshot.tabs));
      } catch {
        // Keep this page's sessions usable when browser storage is unavailable.
      }
    }
    for (const listener of listeners) listener();
  };
  const dispatch = (action: TerminalAction) => {
    const next = terminalReducer(snapshot, action);
    if (next !== snapshot) update({ ...snapshot, ...next });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    async close(session: string, remove: () => Promise<unknown>) {
      if (snapshot.closing || snapshot.tabs.length < 2 || !snapshot.tabs.some((tab) => tab.id === session))
        return;
      update({ ...snapshot, closing: session, error: '' });
      try {
        await remove();
        // Reduce against the current store, not the component that started the
        // request. It may have unmounted and been replaced while closing.
        dispatch({ type: 'close', id: session });
      } catch (error) {
        update({ ...snapshot, error: error instanceof Error ? error.message : String(error) });
      } finally {
        update({ ...snapshot, closing: null });
      }
    },
  };
}

// One owner per VM outlives its mounted views, including pending close requests.
// Every view subscribes to the same snapshot and writes the same latest tab list.
export function createTerminalStores(storage: () => TerminalStorage) {
  const stores = new Map<string, ReturnType<typeof createStore>>();
  return (id: string) => {
    let store = stores.get(id);
    if (!store) {
      store = createStore(id, storage);
      stores.set(id, store);
    }
    return store;
  };
}

export const getTerminalStore = createTerminalStores(() => localStorage);
