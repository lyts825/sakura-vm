/**
 * 模块职责（中文）：定义终端标签与分屏状态，通过 reducer 维护选择、移动、拆分和恢复行为。
 * Module responsibility (English): Maintaining terminal tabs, selection and splits through a reducer.
 * 详细范围（中文）：公开入口包括 TerminalTab, TerminalState, TerminalAction, restoreTerminals, terminalReducer；职责覆盖以 reducer 维护终端标签、选择与分屏状态，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include TerminalTab, TerminalState, TerminalAction, restoreTerminals, terminalReducer. The scope covers Maintaining terminal tabs, selection and splits through a reducer. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export type TerminalTab = { id: string; name: string };
export type TerminalState = { tabs: TerminalTab[]; active: string };
export type TerminalAction =
  | { type: 'select' | 'close'; id: string }
  | { type: 'add'; id: string }
  | { type: 'rename'; id: string; name: string };

/**
 * 中文：为以 reducer 维护终端标签、选择与分屏状态构造包含 tabs、active 的局部数据对象，字段取自本次输入和明确默认值，供后续表单或状态流程使用
 * English: Build a local data object containing tabs, active for Maintaining terminal tabs, selection and splits through a reducer, using current inputs/explicit defaults for subsequent form/state processing
 * 中文：输入：saved：签名所示 unknown 业务值
 * English: Inputs: saved: the unknown domain value in the signature
 * 中文：结果：包含 tabs、active 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing tabs, active for caller state reads/operations
 */
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
/**
 * 中文：为以 reducer 维护终端标签、选择与分屏状态构造包含 tabs、active 的局部数据对象，字段取自本次输入和明确默认值，供后续表单或状态流程使用
 * English: Build a local data object containing tabs, active for Maintaining terminal tabs, selection and splits through a reducer, using current inputs/explicit defaults for subsequent form/state processing
 * 中文：输入：state：当前状态或草稿快照；action：本次动作或状态机输入
 * English: Inputs: state: current state/draft snapshot; action: current action/state-machine input
 * 中文：结果：包含 tabs、active 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing tabs, active for caller state reads/operations
 */
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
