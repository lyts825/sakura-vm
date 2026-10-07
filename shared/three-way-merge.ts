/**
 * 模块职责（中文）：按行计算三方文本差异和冲突片段，将用户的冲突选择还原为合并文本。
 * Module responsibility (English): Computing bounded line-based three-way differences and requiring complete conflict decisions.
 * 详细范围（中文）：公开入口包括 MergePart, threeWayMerge, resolvedMerge；职责覆盖按行计算受限三方差异并要求完整冲突决策，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include MergePart, threeWayMerge, resolvedMerge. The scope covers Computing bounded line-based three-way differences and requiring complete conflict decisions. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
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
/**
 * 中文：把文本拆成保留原换行分隔的行片段，供差异算法逐行比较后无损拼回。
 * English: Split text into line fragments retaining original newline separators so line-based differences can be joined losslessly.
 * 中文：输入：text：待处理的文本内容
 * English: Inputs: text: text content to process
 */
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
/**
 * 中文：删除共同首尾后用 LCS 矩阵计算连续编辑区间，以 400 万单元限制最坏计算量；返回携带 side 的基础行范围与替换行，供三方重叠判断使用。
 * English: Remove common prefix/suffix lines and use an LCS matrix to derive contiguous edits, capped at four million cells. Return side-tagged base-line ranges and replacement lines for three-way overlap decisions.
 * 中文：输入：base：签名所示 string[] 业务值；changed：签名所示 string[] 值，用于当前changed处理；side：签名所示 Edit['side'] 业务值
 * English: Inputs: base: the string[] domain value in the signature; changed: the string[] value used by this changed flow; side: the Edit['side'] domain value in the signature
 * 中文：结果：Edit[]，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Edit[] carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：差异过大，请分段手动合并。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 差异过大，请分段手动合并. These errors reach the direct caller or this function's catch handler
 */
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
  // 去掉共同首尾后仍以 LCS 表计算差异；矩阵上限限制最坏情况下的内存与计算量。
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
/**
 * 中文：按基础文本重叠范围组成冲突组，仅单方变化自动合并，双方相同变化合并为文本；保留原换行字节，拒绝超过 1 MiB 或含 NUL 的输入。
 * English: Group conflicts by overlapping base ranges, automatically merge one-sided changes and turn identical two-sided changes into text. Preserve original newline bytes and reject inputs over one MiB or containing NUL.
 * 中文：输入：baseText：签名所示 string 业务值；ourText：签名所示 string 业务值；theirText：签名所示 string 业务值
 * English: Inputs: baseText: the string domain value in the signature; ourText: the string domain value in the signature; theirText: the string domain value in the signature
 * 中文：结果：MergePart[]，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: MergePart[] carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：三方合并只支持不超过 1 MiB 的文本。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 三方合并只支持不超过 1 MiB 的文本. These errors reach the direct caller or this function's catch handler
 */
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
    /**
     * 中文：在基础范围中按顺序应用指定侧编辑并保留未改行，供重叠组判断两侧结果是否相同。
     * English: Apply one side's edits in base-range order while retaining unchanged lines, allowing overlapping groups to compare both rendered results.
     * 中文：输入：side：签名所示 Edit['side'] 业务值
     * English: Inputs: side: the Edit['side'] domain value in the signature
     */
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

/**
 * 中文：按冲突 ID 应用用户选择并连接所有文本片段；缺失或无效选择拒绝生成最终文本，避免静默丢掉冲突。
 * English: Apply user choices by conflict ID and join text pieces; reject missing/invalid choices rather than silently dropping conflicts.
 * 中文：输入：parts：签名所示 MergePart[] 业务值；choices：签名所示 Record<number, string> 业务值
 * English: Inputs: parts: the MergePart[] domain value in the signature; choices: the Record<number, string> domain value in the signature
 */
export function resolvedMerge(parts: MergePart[], choices: Record<number, string>) {
  return parts
    .map((part, index) => {
      if (part.kind === 'text') return part.text;
      if (!Object.hasOwn(choices, index)) throw new Error('仍有未处理的冲突');
      return choices[index];
    })
    .join('');
}
