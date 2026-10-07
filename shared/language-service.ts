/**
 * 模块职责（中文）：LSP 文本位置和编辑契约，把行列位置转换为偏移并应用非重叠文本编辑。
 * Module responsibility (English): Converting UTF-16 LSP positions and applying non-overlapping edits.
 * 详细范围（中文）：公开入口包括 LspPosition, LspRange, LspTextEdit, positionOffset, applyTextEdits；职责覆盖转换 UTF-16 LSP 位置并应用非重叠编辑，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include LspPosition, LspRange, LspTextEdit, positionOffset, applyTextEdits. The scope covers Converting UTF-16 LSP positions and applying non-overlapping edits. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export type LspPosition = { line: number; character: number };
export type LspRange = { start: LspPosition; end: LspPosition };
export type LspTextEdit = { range: LspRange; newText: string };

// LSP offsets use UTF-16 code units, the same units used by JavaScript strings.
/**
 * 中文：以 UTF-16 代码单元将零起始行列转换为字符串偏移，拒绝负数、非整数和超出文件/行末的坐标；与 JavaScript 和 LSP 的位置单位一致。
 * English: Convert zero-based line/character positions to string offsets in UTF-16 code units. Reject negative/noninteger coordinates and positions beyond file/line boundaries, matching JavaScript and LSP units.
 * 中文：输入：content：当前文件文本内容；position：签名所示 LspPosition 业务值
 * English: Inputs: content: current file text; position: the LspPosition domain value in the signature
 * 中文：拒绝原因：无效的语言服务位置；语言服务位置超出文件范围。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 无效的语言服务位置; 语言服务位置超出文件范围. These errors reach the direct caller or this function's catch handler
 */
export function positionOffset(content: string, position: LspPosition) {
  if (!Number.isInteger(position.line) || !Number.isInteger(position.character) ||
      position.line < 0 || position.character < 0) throw new Error('无效的语言服务位置');
  let offset = 0;
  for (let line = 0; line < position.line; line++) {
    const end = content.indexOf('\n', offset);
    if (end < 0) throw new Error('语言服务位置超出文件范围');
    offset = end + 1;
  }
  const end = content.indexOf('\n', offset);
  const lineEnd = end < 0 ? content.length : end;
  if (offset + position.character > lineEnd) throw new Error('语言服务位置超出文件范围');
  return offset + position.character;
}

/**
 * 中文：先把全部编辑换算到原文偏移并拒绝倒置/重叠范围，再从后向前替换，避免前一修改移动后续编辑位置。
 * English: Convert all edits against the original text, reject reversed/overlapping ranges and apply replacements from the end so earlier changes cannot shift later edit positions.
 * 中文：输入：content：当前文件文本内容；edits：签名所示 LspTextEdit[] 业务值
 * English: Inputs: content: current file text; edits: the LspTextEdit[] domain value in the signature
 * 中文：拒绝原因：语言服务返回了重叠的编辑范围。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 语言服务返回了重叠的编辑范围. These errors reach the direct caller or this function's catch handler
 */
export function applyTextEdits(content: string, edits: LspTextEdit[]) {
  // 全部范围先基于原始文本换算，再从后向前替换，防止较早编辑改变后续编辑的偏移。
  const spans = edits.map((edit) => {
    const from = positionOffset(content, edit.range.start);
    const to = positionOffset(content, edit.range.end);
    if (from > to) throw new Error('语言服务返回了倒置的编辑范围');
    return { from, to, value: edit.newText };
  }).sort((a, b) => b.from - a.from || b.to - a.to);
  for (let index = 1; index < spans.length; index++)
    if (spans[index].to > spans[index - 1].from || spans[index].from === spans[index - 1].from)
      throw new Error('语言服务返回了重叠的编辑范围');
  for (const span of spans) content = content.slice(0, span.from) + span.value + content.slice(span.to);
  return content;
}
