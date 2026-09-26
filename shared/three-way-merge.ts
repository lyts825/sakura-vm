export type MergePart =
  | { kind: 'text'; text: string }
  | {
      kind: 'conflict';
      base: string;
      ours: string;
      theirs: string;
      line: number;
    };
type Edit = { start: number; end: number; lines: string[]; side: 'ours' | 'theirs' };
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
function edits(base: string[], changed: string[], side: Edit['side']): Edit[] {
  let prefix = 0,
    suffix = 0;
  while (prefix < base.length && prefix < changed.length && base[prefix] === changed[prefix]) prefix++;
  while (
    suffix < base.length - prefix &&
    suffix < changed.length - prefix &&
    base[base.length - 1 - suffix] === changed[changed.length - 1 - suffix]
  )
    suffix++;
  const a = base.slice(prefix, base.length - suffix),
    b = changed.slice(prefix, changed.length - suffix);
  if ((a.length + 1) * (b.length + 1) > 4_000_000) throw new Error('差异过大，请分段手动合并');
  const width = b.length + 1,
    table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  let i = 0,
    j = 0,
    edit: Edit | undefined;
  const result: Edit[] = [];
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      if (edit) {
        result.push(edit);
        edit = undefined;
      }
      i++;
      j++;
    } else {
      edit ||= { start: i + prefix, end: i + prefix, lines: [], side };
      if (j < b.length && (i === a.length || table[i * width + j + 1] >= table[(i + 1) * width + j]))
        edit.lines.push(b[j++]);
      else edit.end = ++i + prefix;
    }
  }
  if (edit) result.push(edit);
  return result;
}

/** Only changes to overlapping base ranges conflict; newline bytes are retained. */
export function threeWayMerge(baseText: string, ourText: string, theirText: string): MergePart[] {
  if ([baseText, ourText, theirText].some((text) => text.length > 1024 * 1024 || text.includes('\0')))
    throw new Error('三方合并只支持不超过 1 MiB 的文本');
  if (ourText === theirText || theirText === baseText) return [{ kind: 'text', text: ourText }];
  if (ourText === baseText) return [{ kind: 'text', text: theirText }];
  const base = lines(baseText);
  const all = [...edits(base, lines(ourText), 'ours'), ...edits(base, lines(theirText), 'theirs')].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  const result: MergePart[] = [];
  let cursor = 0,
    index = 0;
  while (index < all.length) {
    const first = all[index++],
      start = first.start,
      group = [first];
    let end = first.end;
    while (index < all.length) {
      const next = all[index];
      if (!(next.start < end || next.start === start || (next.start === end && next.end === next.start)))
        break;
      group.push(next);
      index++;
      end = Math.max(end, next.end);
    }
    if (cursor < start) result.push({ kind: 'text', text: base.slice(cursor, start).join('') });
    const render = (side: Edit['side']) => {
      let at = start,
        value = '';
      for (const edit of group.filter((item) => item.side === side)) {
        value += base.slice(at, edit.start).join('') + edit.lines.join('');
        at = edit.end;
      }
      return value + base.slice(at, end).join('');
    };
    const original = base.slice(start, end).join(''),
      ours = render('ours'),
      theirs = render('theirs');
    if (ours === theirs || theirs === original) result.push({ kind: 'text', text: ours });
    else if (ours === original) result.push({ kind: 'text', text: theirs });
    else result.push({ kind: 'conflict', base: original, ours, theirs, line: start + 1 });
    cursor = end;
  }
  if (cursor < base.length) result.push({ kind: 'text', text: base.slice(cursor).join('') });
  return result;
}

export function resolvedMerge(parts: MergePart[], choices: Record<number, string>) {
  return parts
    .map((part, index) => {
      if (part.kind === 'text') return part.text;
      if (!Object.hasOwn(choices, index)) throw new Error('仍有未处理的冲突');
      return choices[index];
    })
    .join('');
}
