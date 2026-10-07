/**
 * 模块职责（中文）：校验并恢复终端分屏布局，把保存布局应用到当前终端集合。
 * Module responsibility (English): Validating and restoring split-terminal layouts.
 * 详细范围（中文）：公开入口包括 TerminalLayout, restoreLayouts, applyTerminalLayout；职责覆盖校验并恢复终端分屏布局，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include TerminalLayout, restoreLayouts, applyTerminalLayout. The scope covers Validating and restoring split-terminal layouts. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { restoreTerminals, type TerminalState } from './terminal-state';

export type TerminalLayout = TerminalState & { id: string; name: string; split: boolean; secondary?: string };
/**
 * 中文：过滤版本外或损坏布局，校验标签、活动/次级选择与名称并去重 ID，最多恢复 20 条；不接受会被恢复器隐式修补的标签集合。
 * English: Filter malformed layouts, validate tabs/active-secondary selection/names, deduplicate IDs and restore at most twenty; reject tab sets requiring implicit repair by the restorer.
 * 中文：输入：input：尚待校验的输入数据
 * English: Inputs: input: input data requiring validation
 * 中文：结果：TerminalLayout[]，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: TerminalLayout[] carrying the described computation/transport result; throwing branches do not provide success
 */
export function restoreLayouts(input: unknown): TerminalLayout[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set<string>();
  return input
    .filter(/**
     * 中文功能：筛选结构、ID 唯一性、名称长度和标签引用均有效的终端布局，并要求 restoreTerminals 不改变保存的标签形状。
     * English: Filter terminal layouts by shape, unique ID, name length and tab references, requiring restoreTerminals to preserve saved tab shape.
     * 输入 / Inputs: value.
     * 结果 / Result: value is TerminalLayout；以声明的类型和上述功能为准 / Follows the declared type and described role.
     * 设计思路：只在全部校验通过后加入 ids 集合，非法重复候选不会预占名称；active 和 secondary 都必须引用已有标签。
     * Design: Add IDs only after all checks pass so invalid candidates do not reserve them; active and secondary must reference existing tabs.
     */
    (value): value is TerminalLayout => {
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

/**
 * 中文：为校验并恢复终端分屏布局构造包含 tabs、active 的局部数据对象，字段取自本次输入和明确默认值，供后续表单或状态流程使用
 * English: Build a local data object containing tabs, active for Validating and restoring split-terminal layouts, using current inputs/explicit defaults for subsequent form/state processing
 * 中文：输入：state：当前状态或草稿快照；layout：已选择的终端分屏布局
 * English: Inputs: state: current state/draft snapshot; layout: selected terminal split layout
 * 中文：结果：包含 tabs、active 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing tabs, active for caller state reads/operations
 * 中文：拒绝原因：终端布局无效；应用布局后超过 8 个终端，请先关闭不需要的会话。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 终端布局无效; 应用布局后超过 8 个终端，请先关闭不需要的会话. These errors reach the direct caller or this function's catch handler
 */
export function applyTerminalLayout(state: TerminalState, layout: TerminalLayout): TerminalState {
  if (restoreLayouts([layout]).length !== 1) throw new Error('终端布局无效');
  const extra = state.tabs.filter((tab) => !layout.tabs.some((item) => item.id === tab.id));
  if (extra.length + layout.tabs.length > 8) throw new Error('应用布局后超过 8 个终端，请先关闭不需要的会话');
  return { tabs: [...layout.tabs.map((tab) => ({ ...tab })), ...extra], active: layout.active };
}
