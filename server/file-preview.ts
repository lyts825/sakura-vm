import { gunzipSync } from 'node:zlib';
import { posix } from 'node:path';
import { AppError } from './model.ts';

export type Preview = { kind: string; name: string; size: number; [key: string]: unknown };
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
