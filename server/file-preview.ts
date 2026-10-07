/**
 * 模块职责：解析文本、表格等有界文件预览，限制 CSV 字段、列数和格式错误。
 * Module purpose: Parses bounded text and table previews, restricting CSV field/column sizes and rejecting invalid quoting.
 */
import { gunzipSync } from 'node:zlib';
import { posix } from 'node:path';
import { AppError } from '../shared/errors.ts';

export type Preview = { kind: string; name: string; size: number; [key: string]: unknown };
/**
 * 入口 / Entry: csvRows.
 * 功能：在解析文本、表格等有界文件预览中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ rows, truncated: index < text.length - 1 }` / `{ rows, truncated: false }` 供上层消费（`file-preview.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `file-preview.ts`; this entry produces `{ rows, truncated: index < text.length - 1 }` / `{ rows, truncated: false }` for its caller. Module context: Parses bounded text and table previews, restricting CSV field/column sizes and rejecting invalid quoting.
 * 处理：通过 `row.push`, `rows.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `row.push`, `rows.push`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `character === '"'`; `quoted && text[index + 1] === '"'`; `quoted || !field`.
 * 输入 / Inputs: text: string; limit: default=200
 * 输出 / Returns: `{ rows, truncated: index < text.length - 1 }`; `{ rows, truncated: false }`.
 * 副作用 / Effects: `row.push`; `rows.push`; 更新 / updates `field`, `quoted`, `row`.
 * 拒绝 / Refusals: 条件 / conditions `row.length > 200 || field.length > 65536`; `quoted`; 异常 / errors `new AppError('CSV 列数或字段长度超过预览上限')`; `new AppError('CSV 引号未闭合')`.
 */
export function csvRows(text: string, limit = 200) {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (quoted || !field) quoted = !quoted;
      else field += character;
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (rows.length >= limit) return { rows, truncated: index < text.length - 1 };
    } else field += character;
    if (row.length > 200 || field.length > 65536) throw new AppError('CSV 列数或字段长度超过预览上限');
  }
  if (quoted) throw new AppError('CSV 引号未闭合');
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { rows, truncated: false };
}

/**
 * 入口 / Entry: previewFile.
 * 功能：按文件类型解释受限字节片段，返回文本、表格、图片或不支持类型的预览视图。
 * Purpose: Interprets bounded bytes by file type and returns text/table/image/unsupported previews.
 * 设计：使用原文件总大小与已读取片段区分截断；CSV 和结构化输入限制字段及行列，错误不发布伪造解析结果。
 * Design: Total size and sampled bytes distinguish truncation; structured/CSV limits prevent fabricated partial parsing outcomes.
 * 输入 / Inputs: path: string; data: Buffer; size: default=data.length
 * 输出 / Returns: Preview；结果来自 / values from `{ ...base, kind: 'hex', truncated: true, message: '文件超过 16 MiB，显示前 4 KiB。', hex: data.subarray(0, 4096).toString('hex'), }`; `{ ...base, kind: mime === 'application/pdf' ? 'pdf' : 'image', mime, base64: data.toString('base64'), }`; `{ ...base, kind: 'table', ...(lower.endsWith('.tsv') ? { rows: text .split(/\r?\n/) .slice(0, 200) .map((line) => line.split(…`.
 * 副作用 / Effects: `data.toString().replace`; `entries.push`; 更新 / updates `position`.
 * 拒绝 / Refusals: 条件 / conditions `lower.endsWith('.zip')`; `end < 0 || end < data.length - 65557`; `count === 65535 || offset === 0xffffffff || data.readUInt16LE(end + 4) !== 0`; 异常 / errors `new AppError('ZIP 目录无效')`; `new AppError('ZIP64 与分卷 ZIP 暂不支持预览')`.
 */
export function previewFile(path: string, data: Buffer, size = data.length): Preview {
  const name = posix.basename(path),
    lower = name.toLowerCase();
  const base = { name, size };
  if (data.length < size)
    return {
      ...base,
      kind: 'hex',
      truncated: true,
      message: '文件超过 16 MiB，显示前 4 KiB。',
      hex: data.subarray(0, 4096).toString('hex'),
    };
  const mime = data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    ? 'image/png'
    : data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
      ? 'image/jpeg'
      : /^GIF8[79]a$/.test(data.subarray(0, 6).toString())
        ? 'image/gif'
        : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP'
          ? 'image/webp'
          : data.subarray(0, 5).toString() === '%PDF-'
            ? 'application/pdf'
            : undefined;
  if (mime)
    return {
      ...base,
      kind: mime === 'application/pdf' ? 'pdf' : 'image',
      mime,
      base64: data.toString('base64'),
    };
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
    const text = data.toString('utf8').replace(/^\uFEFF/, '');
    return {
      ...base,
      kind: 'table',
      ...(lower.endsWith('.tsv')
        ? {
            rows: text
              .split(/\r?\n/)
              .slice(0, 200)
              .map((line) => line.split('\t').slice(0, 200)),
            truncated: text.split('\n').length > 200,
          }
        : csvRows(text)),
    };
  }
  if (lower.endsWith('.zip')) {
    let end = data.length - 22;
    for (; end >= Math.max(0, data.length - 65557); end--) {
      if (data.readUInt32LE(end) === 0x06054b50 && end + 22 + data.readUInt16LE(end + 20) === data.length)
        break;
    }
    if (end < 0 || end < data.length - 65557) throw new AppError('ZIP 目录无效');
    const count = data.readUInt16LE(end + 10),
      offset = data.readUInt32LE(end + 16);
    if (count === 65535 || offset === 0xffffffff || data.readUInt16LE(end + 4) !== 0)
      throw new AppError('ZIP64 与分卷 ZIP 暂不支持预览');
    let position = offset;
    const entries = [];
    for (let index = 0; index < count; index++) {
      if (position + 46 > end || data.readUInt32LE(position) !== 0x02014b50)
        throw new AppError('ZIP 成员目录损坏');
      const length = data.readUInt16LE(position + 28),
        extra = data.readUInt16LE(position + 30),
        comment = data.readUInt16LE(position + 32);
      const next = position + 46 + length + extra + comment;
      if (next > end) throw new AppError('ZIP 成员目录越界');
      if (entries.length < 1000)
        entries.push({
          name: data.subarray(position + 46, position + 46 + length).toString('utf8'),
          bytes: data.readUInt32LE(position + 24),
          compressedBytes: data.readUInt32LE(position + 20),
        });
      position = next;
    }
    return { ...base, kind: 'archive', entries, truncated: count > entries.length, totalEntries: count };
  }
  if (lower.endsWith('.tar') || /\.(tar\.gz|tgz)$/.test(lower)) {
    const archive = /\.(tar\.gz|tgz)$/.test(lower)
      ? gunzipSync(data, { maxOutputLength: 64 * 1024 ** 2 })
      : data;
    const entries = [];
    let position = 0,
      count = 0;
    while (position + 512 <= archive.length) {
      const header = archive.subarray(position, position + 512);
      if (header.every((byte) => byte === 0)) break;
      /**
       * 入口 / Entry: previewFile.text.
       * 功能：在解析文本、表格等有界文件预览中，执行此领域的具体处理步骤并返回其结果；本入口产生 `header .subarray(start, start + length) .toString('utf8') .replace(/\0.*$/, '')` 供上层消费（`file-preview.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `file-preview.ts`; this entry produces `header .subarray(start, start + length) .toString('utf8') .replace(/\0.*$/, '')` for its caller. Module context: Parses bounded text and table previews, restricting CSV field/column sizes and rejecting invalid quoting.
       * 处理：通过 `header.subarray().toString().replace`, `header.subarray().toString`, `header.subarray` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `header.subarray().toString().replace`, `header.subarray().toString`, `header.subarray`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: start: number; length: number
       * 输出 / Returns: `header .subarray(start, start + length) .toString('utf8') .replace(/\0.*$/, '')`.
       * 副作用 / Effects: `header.subarray().toString().replace`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const text = (start: number, length: number) =>
        header
          .subarray(start, start + length)
          .toString('utf8')
          .replace(/\0.*$/, '');
      const bytes = parseInt(text(124, 12).trim(), 8);
      const expected = parseInt(text(148, 8).trim(), 8);
      const checksum = [...header].reduce(
        (sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value),
        0,
      );
      if (
        !Number.isSafeInteger(bytes) ||
        bytes < 0 ||
        expected !== checksum ||
        position + 512 + bytes > archive.length
      )
        throw new AppError('TAR 成员或校验和无效');
      const type = text(156, 1),
        prefix = text(345, 155);
      if (!['x', 'g', 'L', 'K'].includes(type)) {
        count++;
        if (entries.length < 1000)
          entries.push({ name: (prefix ? prefix + '/' : '') + text(0, 100), bytes, directory: type === '5' });
      }
      position += 512 + Math.ceil(bytes / 512) * 512;
    }
    return { ...base, kind: 'archive', entries, totalEntries: count, truncated: count > entries.length };
  }
  return { ...base, kind: 'hex', hex: data.subarray(0, 4096).toString('hex'), truncated: data.length > 4096 };
}
