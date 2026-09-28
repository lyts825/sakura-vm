export type LspPosition = { line: number; character: number };
export type LspRange = { start: LspPosition; end: LspPosition };
export type LspTextEdit = { range: LspRange; newText: string };

// LSP offsets use UTF-16 code units, the same units used by JavaScript strings.
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

export function applyTextEdits(content: string, edits: LspTextEdit[]) {
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
