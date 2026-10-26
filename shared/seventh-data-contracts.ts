/** 第七批数据计算的有限输入、精确数和确定性工具；不读取网络或文件。 */
import { z } from 'zod';
import { AppError } from './errors.ts';

export const dataCell = z.union([z.string().max(262144), z.number().finite(), z.boolean(), z.null()]);
export const dataRow = z.record(z.string().min(1).max(256), dataCell);
export const dataRows = z.array(dataRow).max(100000);
export type DataCell = z.infer<typeof dataCell>;
export type DataRow = z.infer<typeof dataRow>;
export const dataId = z.string().min(1).max(256);
export function dataError(code: string, message: string): never {
  throw new AppError(message, 400, code);
}
export function checkDataSignal(signal?: AbortSignal) {
  if (signal?.aborted) throw new AppError('数据计算已取消', 409, 'SEVENTH_DATA_CANCELLED');
}
export function uniqueDataIds(values: string[], label = '记录') {
  const found = new Set<string>();
  for (const id of values) {
    if (found.has(id)) dataError('SEVENTH_DATA_DUPLICATE_ID', label + ' ID 重复：' + id);
    found.add(id);
  }
}
/** 按 UTF-16 码元排序，不依赖宿主语言或 ICU 版本。 */
export function dataCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
export function stableData(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableData).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableData((value as Record<string, unknown>)[key]))
      .join(',') +
    '}'
  );
}
export function scalarKey(row: DataRow, keys: string[]) {
  return stableData(keys.map((key) => row[key] ?? null));
}
export function finiteData(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    dataError('SEVENTH_DATA_NUMBER', field + ' 必须是有限数');
  return value;
}
export function exactDecimal(value: unknown): { units: bigint; scale: number } {
  if (typeof value !== 'string' || !/^[+-]?\d{1,100}(?:\.\d{1,30})?$/.test(value))
    dataError('SEVENTH_DATA_DECIMAL', '精确十进制须使用有界十进制字符串');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  return { units: BigInt(whole + fraction) * (negative ? -1n : 1n), scale: fraction.length };
}
export function decimalAt(value: ReturnType<typeof exactDecimal>, scale: number) {
  return value.units * 10n ** BigInt(scale - value.scale);
}
export function decimalText(units: bigint, scale: number) {
  const sign = units < 0n ? '-' : '';
  const text = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  return scale ? sign + text.slice(0, -scale) + '.' + text.slice(-scale) : sign + text;
}
export function makeDataRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function dataMean(values: number[]) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
export function dataQuantile(sorted: number[], q: number) {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}
const tableInput = z
  .object({
    format: z.enum(['rows', 'csv', 'jsonl']),
    rows: dataRows.optional(),
    text: z
      .string()
      .max(32 * 1024 ** 2)
      .optional(),
    delimiter: z.enum([',', '\t', ';']).default(','),
    nullToken: z.string().max(256).optional(),
  })
  .strict();
/** CSV 保留字符串和空值区别；不推断大整数或十进制。 */
export function inspectDataTable(raw: unknown) {
  const input = tableInput.parse(raw);
  let rows: DataRow[];
  if (input.format === 'rows') {
    if (!input.rows || input.text !== undefined)
      dataError('SEVENTH_DATA_INPUT', 'rows 格式须且仅须提供 rows');
    rows = input.rows;
  } else {
    if (input.text === undefined || input.rows !== undefined)
      dataError('SEVENTH_DATA_INPUT', '文本格式须且仅须提供 text');
    if (input.format === 'jsonl') {
      const lines = input.text.split(/\r?\n/);
      if (lines.at(-1) === '') lines.pop();
      rows = lines.map((line, i) => {
        if (!line.trim()) dataError('SEVENTH_DATA_JSONL', '空记录行：' + (i + 1));
        try {
          return dataRow.parse(JSON.parse(line));
        } catch {
          return dataError('SEVENTH_DATA_JSONL', 'JSONL 记录无效：' + (i + 1));
        }
      });
    } else {
      const records: string[][] = [];
      let record: string[] = [],
        cell = '',
        quoted = false,
        afterQuote = false;
      for (let i = 0; i < input.text.length; i++) {
        const char = input.text[i];
        if (quoted) {
          if (char === '"') {
            if (input.text[i + 1] === '"') {
              cell += '"';
              i++;
            } else {
              quoted = false;
              afterQuote = true;
            }
          } else cell += char;
        } else if (char === input.delimiter) {
          record.push(cell);
          cell = '';
          afterQuote = false;
        } else if (char === '\n' || char === '\r') {
          if (char === '\r' && input.text[i + 1] === '\n') i++;
          record.push(cell);
          records.push(record);
          record = [];
          cell = '';
          afterQuote = false;
        } else if (char === '"' && cell === '' && !afterQuote) quoted = true;
        else {
          if (afterQuote || char === '"') dataError('SEVENTH_DATA_CSV', 'CSV 引号位置无效');
          cell += char;
        }
        if (records.length > 100001 || cell.length > 262144)
          dataError('SEVENTH_DATA_INPUT_LIMIT', '表格超过行数或单值上限');
      }
      if (quoted) dataError('SEVENTH_DATA_CSV', 'CSV 引号未结束');
      if (cell !== '' || record.length || afterQuote) {
        record.push(cell);
        records.push(record);
      }
      const headers = records.shift() ?? [];
      if (!headers.length || headers.some((h) => !h)) dataError('SEVENTH_DATA_CSV', 'CSV 缺少有效列名');
      uniqueDataIds(headers, '列');
      rows = records.map((cells, i) => {
        if (cells.length !== headers.length) dataError('SEVENTH_DATA_CSV', 'CSV 列数不一致：' + (i + 2));
        return Object.fromEntries(
          headers.map((header, j) => [
            header,
            input.nullToken !== undefined && cells[j] === input.nullToken ? null : cells[j],
          ]),
        );
      });
    }
  }
  dataRows.parse(rows);
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort();
  if (columns.length > 2000) dataError('SEVENTH_DATA_INPUT_LIMIT', '列数超过 2000');
  return { rows, columns, rowCount: rows.length, numberInference: 'none' };
}

export type SeventhDataTemplate = {
  id: string;
  name: string;
  description: string;
  domain: string;
  method: string;
  input: Record<string, unknown>;
};
