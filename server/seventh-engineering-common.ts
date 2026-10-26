/** 工程实验共享的有界数据解析与稳定摘要；不执行输入代码。 */
import { createHash } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
export type R = Record<string, unknown>;
export function reject(code: string, message = code): never { throw new AppError(message, 400, code); }
export function obj(value: unknown, name = 'object'): R {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('ENGINEERING_OBJECT', name);
  return value as R;
}
export function list(value: unknown, max = 100000, name = 'array'): unknown[] {
  if (!Array.isArray(value) || value.length > max) reject('ENGINEERING_ARRAY', name);
  return value;
}
export function str(value: unknown, name = 'string', max = 1024): string {
  if (typeof value !== 'string' || !value.length || value.length > max || value.includes('\0')) reject('ENGINEERING_STRING', name);
  return value;
}
export function n(value: unknown, fallback = 0, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number {
  const x = value === undefined ? fallback : value;
  if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) reject('ENGINEERING_NUMBER');
  return x;
}
export function integer(value: unknown, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const x = n(value, fallback, min, max); if (!Number.isSafeInteger(x)) reject('ENGINEERING_INTEGER'); return x;
}
export function strings(value: unknown, max = 10000): string[] { return list(value, max).map(x => str(x)); }
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) reject('ENGINEERING_NONFINITE'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const source = obj(value); return '{' + Object.keys(source).sort().map(k => JSON.stringify(k) + ':' + canonical(source[k])).join(',') + '}';
}
export function digest(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function checkpoint(signal?: AbortSignal) { if (signal?.aborted) reject('ENGINEERING_CANCELLED'); }
export function boundedInput(input: R, bytes = 8 * 1024 ** 2) {
  if (Buffer.byteLength(JSON.stringify(input)) > bytes) reject('ENGINEERING_INPUT_LIMIT');
  let total = 0; const visit = (v: unknown, depth: number) => {
    if (depth > 24 || ++total > 500000) reject('ENGINEERING_STRUCTURE_LIMIT');
    if (Array.isArray(v)) v.forEach(x => visit(x, depth + 1));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k,x]) => { if (['__proto__','constructor','prototype'].includes(k)) reject('ENGINEERING_RESERVED_KEY'); visit(x,depth+1); });
  }; visit(input,0);
}
export function unique<T>(values: T[], key: (x:T)=>string) {
  const found = new Set<string>(); for (const x of values) { const k = key(x); if (found.has(k)) reject('ENGINEERING_DUPLICATE', k); found.add(k); } return values;
}
export function instant(value: unknown) { const s = str(value); if (!/(?:Z|[+-]\d\d:\d\d)$/.test(s)) reject('ENGINEERING_TIMEZONE_REQUIRED'); const t = Date.parse(s); if (!Number.isFinite(t)) reject('ENGINEERING_TIME'); return t; }
export function deterministic(seed: number) { let state = seed >>> 0; return () => { state = (Math.imul(state,1664525)+1013904223) >>> 0; return state / 4294967296; }; }
export function result(kind: string, value: R): R & {schemaVersion:number;kind:string;digest:string} { return { schemaVersion: 1, kind, ...value, digest: digest(value) }; }
