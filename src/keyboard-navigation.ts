/**
 * 模块职责（中文）：计算列表的键盘选择索引，为方向键、首尾跳转和循环导航提供一致行为。
 * Module responsibility (English): Computing selection indexes for arrow keys, boundary jumps and wrapping.
 * 详细范围（中文）：公开入口包括 nextSelection；职责覆盖计算方向键、首尾跳转和循环选择的索引，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include nextSelection. The scope covers Computing selection indexes for arrow keys, boundary jumps and wrapping. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
/**
 * Return the next item in a keyboard-navigated list.
 *
 * Keeping this small bit of state transition outside the React components makes
 * the wrap-around behavior consistent between the command palette and the
 * project file tree, and gives it a deterministic interaction contract to test.
 */
/**
 * 中文：根据箭头、Home 和 End 计算列表索引，处理空列表和未选择状态；需要循环时跨边界回到另一端，其他按键保持当前索引。
 * English: Compute a list index for arrows/Home/End, handling empty lists and no selection. Wrap across boundaries when requested; other keys preserve the index.
 * 中文：输入：index：签名所示 number 业务值；count：签名所示 number 业务值；key：签名所示 string 业务值
 * English: Inputs: index: the number domain value in the signature; count: the number domain value in the signature; key: the string domain value in the signature
 * 中文：结果：number | null，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: number | null carrying the described computation/transport result; throwing branches do not provide success
 */
export function nextSelection(index: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown' || key === 'ArrowRight') return (index + 1 + count) % count;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (index - 1 + count) % count;
  return null;
}
