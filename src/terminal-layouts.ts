import { restoreTerminals, type TerminalState } from './terminal-state';

export type TerminalLayout = TerminalState & { id: string; name: string; split: boolean; secondary?: string };
export function restoreLayouts(input: unknown): TerminalLayout[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set<string>();
  return input
    .filter((value): value is TerminalLayout => {
      if (
        !value ||
        typeof value.id !== 'string' ||
        !/^[a-z0-9-]{1,48}$/.test(value.id) ||
        ids.has(value.id) ||
        typeof value.name !== 'string' ||
        !value.name.trim() ||
        value.name.length > 40 ||
        typeof value.split !== 'boolean' ||
        !Array.isArray(value.tabs)
      )
        return false;
      const valid = restoreTerminals(value.tabs);
      if (
        JSON.stringify(valid.tabs) !== JSON.stringify(value.tabs) ||
        value.tabs.some((tab: { name: string }) => tab.name.length > 32) ||
        !value.tabs.some((tab: { id: string }) => tab.id === value.active) ||
        (value.secondary && !value.tabs.some((tab: { id: string }) => tab.id === value.secondary))
      )
        return false;
      ids.add(value.id);
      return true;
    })
    .slice(0, 20);
}

export function applyTerminalLayout(state: TerminalState, layout: TerminalLayout): TerminalState {
  if (restoreLayouts([layout]).length !== 1) throw new Error('终端布局无效');
  const extra = state.tabs.filter((tab) => !layout.tabs.some((item) => item.id === tab.id));
  if (extra.length + layout.tabs.length > 8) throw new Error('应用布局后超过 8 个终端，请先关闭不需要的会话');
  return { tabs: [...layout.tabs.map((tab) => ({ ...tab })), ...extra], active: layout.active };
}
