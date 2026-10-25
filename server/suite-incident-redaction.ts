/** 固定键和字面量脱敏。输出仍需人工审阅，不声称发现了全部敏感信息。 */
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { incidentRedactionRules } from '../shared/contracts/incident-desk.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
import type { SuiteJson } from '../shared/contracts/suite-common.ts';

const limit = 32 * 1024 ** 2;
const marker = '[已脱敏]';
export const incidentRedactionInput = z
  .object({
    text: z.string().max(limit),
    format: z.enum(['text', 'json']),
    rules: incidentRedactionRules,
  })
  .strict();
export type IncidentRedactionOutput = { text: string; replacements: number; warnings: string[] };
function fail(code: string): never {
  throw new AppError('脱敏材料格式或范围无效', 400, code);
}
export function redactIncidentText(raw: z.infer<typeof incidentRedactionInput>): IncidentRedactionOutput {
  const input = incidentRedactionInput.parse(raw),
    { rules } = input;
  const unicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
  if (Buffer.byteLength(input.text) > limit) fail('INCIDENT_TEXT_LIMIT');
  if ([input.text, ...rules.literals].some((value) => unicode.test(value))) fail('INCIDENT_UNICODE');
  if (!rules.maskKeys.length && !rules.literals.length) fail('INCIDENT_REDACTION_RULES');
  if (
    new Set(rules.maskKeys).size !== rules.maskKeys.length ||
    new Set(rules.literals).size !== rules.literals.length
  )
    fail('INCIDENT_REDACTION_DUPLICATE');
  const escaped = rules.literals
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const literals = escaped.length ? new RegExp(escaped.join('|'), 'gu') : null;
  let replacements = 0;
  const replace = (value: string) =>
    literals
      ? value.replace(literals, () => {
          replacements++;
          return marker;
        })
      : value;
  const keys = new Set<string>(rules.maskKeys);
  const walk = (value: SuiteJson, depth = 0): SuiteJson => {
    if (depth > 32) fail('INCIDENT_REDACTION_DEPTH');
    if (typeof value === 'string') {
      if (unicode.test(value)) fail('INCIDENT_UNICODE');
      return replace(value);
    }
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1));
    if (value && typeof value === 'object') {
      const output: Record<string, SuiteJson> = Object.create(null);
      for (const [key, child] of Object.entries(value)) {
        if (unicode.test(key)) fail('INCIDENT_UNICODE');
        const nextKey = replace(key);
        if (Object.hasOwn(output, nextKey)) fail('INCIDENT_REDACTION_KEY_COLLISION');
        if (keys.has(key.toLowerCase())) {
          output[nextKey] = marker;
          replacements++;
        } else output[nextKey] = walk(child, depth + 1);
      }
      return output;
    }
    const text = JSON.stringify(value),
      changed = replace(text);
    return text === changed ? value : marker;
  };
  let text: string;
  if (input.format === 'json') {
    const original = input.text.replace(/^\uFEFF/, '');
    let parsed: SuiteJson | undefined;
    try {
      parsed = parseSuiteJson(original, limit);
    } catch {
      /* 仅完整 JSON 失败时尝试逐行 JSON；不保留未解析的敏感片段。 */
    }
    if (parsed !== undefined) text = JSON.stringify(walk(parsed), null, 2);
    else {
      const lines = original.split(/\r?\n/);
      if (lines.length > 100000) fail('INCIDENT_EVENT_LIMIT');
      text = lines
        .map((line) => (line.trim() ? JSON.stringify(walk(parseSuiteJson(line, limit))) : ''))
        .join('\n');
    }
  } else {
    text = input.text;
    if (rules.maskKeys.length) {
      const selected = rules.maskKeys.join('|');
      const expression = new RegExp(
        `(^|[^\\p{L}\\p{N}_])(?:["']?(${selected})["']?)\\s*[:=]\\s*(?:(?:Bearer|Basic)\\s+[^\\s,;]+|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;]+)`,
        'giu',
      );
      text = text.replace(expression, (_match, prefix: string, key: string) => {
        replacements++;
        return `${prefix}${key}=${marker}`;
      });
      if (keys.has('email'))
        text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi, () => {
          replacements++;
          return marker;
        });
    }
    text = replace(text);
  }
  if (Buffer.byteLength(text) > limit) fail('INCIDENT_REDACTION_OUTPUT_LIMIT');
  return {
    text,
    replacements,
    warnings: [
      input.format === 'text'
        ? '纯文本仅覆盖所选键的常见写法和显式字面量；请人工核对全部输出。'
        : 'JSON 已重排格式；只处理所选键与显式字面量，仍需人工核对全部输出。',
    ],
  };
}
