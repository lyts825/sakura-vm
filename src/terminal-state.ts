export type TerminalTab = { id: string; name: string };
export type TerminalState = { tabs: TerminalTab[]; active: string };
export type TerminalAction =
  | { type: 'select' | 'close'; id: string }
  | { type: 'add'; id: string }
  | { type: 'rename'; id: string; name: string };

export function restoreTerminals(saved: unknown): TerminalState {
  const valid =
    Array.isArray(saved) &&
    saved.length > 0 &&
    saved.length <= 8 &&
    saved.every(
      (tab) =>
        tab && typeof tab.id === 'string' && /^[a-z0-9-]{1,48}$/.test(tab.id) && typeof tab.name === 'string',
    ) &&
    new Set(saved.map((tab) => tab.id)).size === saved.length;
  const tabs: TerminalTab[] = valid ? saved : [{ id: 'main', name: '终端 1' }];
  return { tabs, active: tabs[0].id };
}

// Keep the visible session and the tab list in one update. Close responses may
// arrive after the user has selected or created a different session.
export function terminalReducer(state: TerminalState, action: TerminalAction): TerminalState {
  switch (action.type) {
    case 'select':
      return state.tabs.some((tab) => tab.id === action.id) ? { ...state, active: action.id } : state;
    case 'add':
      if (state.tabs.length >= 8 || state.tabs.some((tab) => tab.id === action.id)) return state;
      return {
        tabs: [...state.tabs, { id: action.id, name: `终端 ${state.tabs.length + 1}` }],
        active: action.id,
      };
    case 'rename':
      if (!action.name.trim()) return state;
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === action.id ? { ...tab, name: action.name.trim().slice(0, 32) } : tab,
        ),
      };
    case 'close': {
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      if (!tabs.length || tabs.length === state.tabs.length) return state;
      return { tabs, active: state.active === action.id ? tabs[0].id : state.active };
    }
  }
}
