/** 有界 JSON 解析：保留文本语义，拒绝重复键及超深结构。 */
import { AppError } from './errors.ts';
import type { SuiteJson } from './contracts/suite-common.ts';
export function parseSuiteJson(text: string, maximumBytes = 64 * 1024 ** 2): SuiteJson {
  const fail = (code = 'SUITE_JSON_INVALID'): never => {
    throw new AppError('JSON 材料格式无效或超出限制', 400, code);
  };
  if (text.length > maximumBytes || new TextEncoder().encode(text).length > maximumBytes)
    fail('SUITE_JSON_LIMIT');
  let pos = 0,
    nodes = 0;
  const space = () => {
    while (pos < text.length && /[ \t\r\n]/.test(text[pos])) pos++;
  };
  const string = (): string => {
    if (text[pos++] !== '"') fail();
    const start = pos - 1;
    while (pos < text.length) {
      const char = text[pos++];
      if (pos - start > 2 * 1024 ** 2) fail('SUITE_JSON_STRING_LIMIT');
      if (char === '\\') {
        pos++;
        continue;
      }
      if (char === '"') {
        try {
          return JSON.parse(text.slice(start, pos)) as string;
        } catch {
          return fail();
        }
      }
    }
    return fail();
  };
  const value = (depth: number): SuiteJson => {
    if (++nodes > 2000000 || depth > 32) fail('SUITE_JSON_LIMIT');
    space();
    const char = text[pos];
    if (char === '"') return string();
    if (char === '{') {
      pos++;
      space();
      const object: Record<string, SuiteJson> = Object.create(null),
        keys = new Set<string>();
      if (text[pos] === '}') {
        pos++;
        return object;
      }
      for (;;) {
        space();
        const key = string();
        if (keys.has(key)) fail('SUITE_JSON_DUPLICATE_KEY');
        if (keys.size >= 100000 || key.length > 512) fail('SUITE_JSON_LIMIT');
        keys.add(key);
        space();
        if (text[pos++] !== ':') fail();
        object[key] = value(depth + 1);
        space();
        if (text[pos] === '}') {
          pos++;
          return object;
        }
        if (text[pos++] !== ',') fail();
      }
    }
    if (char === '[') {
      pos++;
      space();
      const array: SuiteJson[] = [];
      if (text[pos] === ']') {
        pos++;
        return array;
      }
      for (;;) {
        if (array.length >= 100000) fail('SUITE_JSON_LIMIT');
        array.push(value(depth + 1));
        space();
        if (text[pos] === ']') {
          pos++;
          return array;
        }
        if (text[pos++] !== ',') fail();
      }
    }
    for (const [token, result] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const)
      if (text.startsWith(token, pos)) {
        pos += token.length;
        return result;
      }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(pos, pos + 128));
    if (!number || !Number.isFinite(Number(number[0]))) return fail();
    pos += number[0].length;
    return Number(number[0]);
  };
  const result = value(0);
  space();
  if (pos !== text.length) fail();
  return result;
}
