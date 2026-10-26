/** 七批创作计算的有界数据校验；bounded data validation for creation computations. */
import { createHash } from 'node:crypto';

export type Data = Record<string, unknown>;
export type CreationTemplate = {
  id: string;
  name: string;
  description: string;
  domain: string;
  method: string;
  input: Data;
};
export class CreationError extends Error {
  constructor(
    public readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'CreationError';
  }
}
export function reject(code: string): never {
  throw new CreationError(code);
}
export function object(value: unknown, code = 'CREATION_OBJECT_REQUIRED'): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject(code);
  const result = value as Data;
  if (Object.keys(result).some((k) => ['__proto__', 'constructor', 'prototype'].includes(k)))
    reject('CREATION_UNSAFE_KEY');
  return result;
}
export function list(value: unknown, max = 100000): unknown[] {
  if (!Array.isArray(value) || value.length > max) reject('CREATION_ARRAY_LIMIT');
  return value;
}
export function rows(value: unknown, max = 100000): Data[] {
  return list(value, max).map((v) => object(v));
}
export function text(value: unknown, max = 262144): string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > max) reject('CREATION_TEXT_LIMIT');
  return value;
}
export function number(value: unknown, min = -1e15, max = 1e15): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    reject('CREATION_NUMBER_RANGE');
  return value;
}
export function integer(value: unknown, min = 0, max = 100000): number {
  const n = number(value, min, max);
  if (!Number.isSafeInteger(n)) reject('CREATION_INTEGER_REQUIRED');
  return n;
}
export function strings(value: unknown, max = 100000): string[] {
  return list(value, max).map((v) => text(v, 1024));
}
export function unique(values: string[], code = 'CREATION_DUPLICATE_ID') {
  if (new Set(values).size !== values.length) reject(code);
}
export function cancelled(signal?: AbortSignal) {
  signal?.throwIfAborted();
}
export const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
export function digest(value: unknown) {
  let nodes=0;
  const canonical=(item:unknown,depth=0):unknown=>{
    if(++nodes>2000000||depth>24)reject('CREATION_DIGEST_LIMIT');
    if(item===null||typeof item==='string'||typeof item==='boolean')return item;
    if(typeof item==='number'){if(!Number.isFinite(item))reject('CREATION_DIGEST_NUMBER');return item;}
    if(Array.isArray(item))return item.map(value=>canonical(value,depth+1));
    if(item&&typeof item==='object'){const source=object(item);return Object.fromEntries(Object.keys(source).sort().map(key=>[key,canonical(source[key],depth+1)]));}
    reject('CREATION_DIGEST_JSON');
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function graph(nodes: { id: string; deps: string[] }[]) {
  unique(nodes.map((n) => n.id));
  const known = new Map(nodes.map((n) => [n.id, n]));
  const done = new Set<string>(),
    active = new Set<string>(),
    order: string[] = [];
  function visit(id: string) {
    if (!known.has(id)) reject('CREATION_GRAPH_MISSING_NODE');
    if (active.has(id)) reject('CREATION_GRAPH_CYCLE');
    if (done.has(id)) return;
    active.add(id);
    for (const dep of known.get(id)!.deps) visit(dep);
    active.delete(id);
    done.add(id);
    order.push(id);
  }
  nodes.forEach((n) => visit(n.id));
  return order;
}
export function escapeHtml(value: unknown) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
export function assertBytes(value: unknown, maximum = 16 * 1024 ** 2) {
  if (Buffer.byteLength(JSON.stringify(value)) > maximum) reject('CREATION_INPUT_LIMIT');
}
