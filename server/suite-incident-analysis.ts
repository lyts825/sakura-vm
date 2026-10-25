/** 固定日志的有界解析；正文和嵌入指令均作为文本，不执行脚本或访问链接。 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import * as I from '../shared/contracts/incident-desk.ts';
import * as S from '../shared/contracts/suite-common.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
import { AppError } from '../shared/errors.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
function fail(code: string): never { throw new AppError('事件材料不受支持或超出限制：' + code, 400, code); }
const inputSchema = I.incidentEvidence.pick({ sourceAt: true, observedAt: true }).extend({
  evidence: S.suiteRef, text: z.string().max(32 * 1024 ** 2), format: z.enum(['text', 'json']),
}).strict();
function clipped(text: string): string {
  let end = Math.min(4000, text.length);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return text.slice(0, end);
}
export function parseIncidentEvents(raw: {
  evidence: S.SuiteRef; sourceAt: string | null; observedAt: string; text: string; format: string;
}): { events: z.infer<typeof I.incidentEvent>[]; unsupportedLines: number; truncatedMessages: number } {
  const input = inputSchema.parse(raw), text = raw.text;
  if (Buffer.byteLength(text, 'utf8') > 32 * 1024 ** 2) fail('INCIDENT_TEXT_LIMIT');
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))
    fail('INCIDENT_UNICODE');
  let values: { value: S.SuiteJson | null; original: string }[];
  if (raw.format === 'json' && text.trimStart().startsWith('[')) {
    const parsed = parseSuiteJson(text, 32 * 1024 ** 2);
    if (!Array.isArray(parsed) || parsed.length > 100000) fail('INCIDENT_EVENT_LIMIT');
    values = parsed.map((value) => ({ value, original: JSON.stringify(value) }));
  } else {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length > 100000) fail('INCIDENT_EVENT_LIMIT');
    values = lines.map((original) => {
      if (raw.format !== 'json' && !original.trimStart().startsWith('{')) return { value: null, original };
      try { return { value: parseSuiteJson(original, 32 * 1024 ** 2), original }; }
      catch { return { value: null, original }; }
    });
  }
  let unsupportedLines = 0, truncatedMessages = 0;
  const events = values.map(({ value, original }, sourceOrder) => {
    let sourceAt = input.sourceAt, message = original;
    let unsupported = false;
    let level: z.infer<typeof I.incidentEvent>['level'] = 'unknown';
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (typeof value.message === 'string') message = value.message;
      else unsupported = true;
      const timestamp = value.timestamp ?? value.time;
      if (timestamp !== undefined) {
        const parsed = I.incidentTime.safeParse(timestamp);
        if (parsed.success) sourceAt = parsed.data;
        else { unsupported = true; sourceAt = null; }
      }
      if (typeof value.level === 'string' && value.level.length < 20) {
        const label = value.level.toLowerCase();
        level = ['error', 'fatal'].includes(label) ? 'error' : ['warn', 'warning'].includes(label) ? 'warning' : label === 'info' ? 'info' : 'unknown';
      }
    } else if (raw.format === 'json') unsupported = true;
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(message)) {
      unsupported = true;
      message = original;
    }
    if (unsupported) unsupportedLines++;
    const summary = clipped(message), messageDigest = sha(message);
    if (summary !== message) truncatedMessages++;
    return I.incidentEvent.parse({
      id: sha(JSON.stringify({ evidence: input.evidence, sourceOrder, sourceAt, messageDigest })),
      evidence: input.evidence, sourceOrder, sourceAt, observedAt: input.observedAt,
      message: summary, messageDigest, level, clockVerified: false,
    });
  });
  return { events, unsupportedLines, truncatedMessages };
}
export const incidentTimelineInput = z.object({
  case: S.suiteRef,
  sources: z.array(inputSchema).min(1).max(50),
}).strict();
export function assembleIncidentTimeline(raw: z.infer<typeof incidentTimelineInput>) {
  const input = incidentTimelineInput.parse(raw);
  if (input.sources.reduce((sum, source) => sum + Buffer.byteLength(source.text, 'utf8'), 0) > 32 * 1024 ** 2)
    fail('INCIDENT_TIMELINE_BYTES');
  if (new Set(input.sources.map((source) => JSON.stringify(source.evidence))).size !== input.sources.length)
    fail('INCIDENT_EVIDENCE_DUPLICATE');
  const sources = [...input.sources].sort((a, b) => {
    const time = Date.parse(a.observedAt) - Date.parse(b.observedAt);
    if (time) return time;
    const left = a.evidence.id + ':' + a.evidence.revision, right = b.evidence.id + ':' + b.evidence.revision;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const events: z.infer<typeof I.incidentEvent>[] = [];
  let unsupportedLines = 0, truncatedMessages = 0;
  for (const source of sources) {
    const parsed = parseIncidentEvents(source);
    if (events.length + parsed.events.length > 100000) fail('INCIDENT_EVENT_LIMIT');
    for (const event of parsed.events) events.push(event);
    unsupportedLines += parsed.unsupportedLines;
    truncatedMessages += parsed.truncatedMessages;
  }
  return I.incidentTimeline.parse({
    format: 'sakura-incident-timeline/1', case: input.case,
    evidence: sources.map((source) => source.evidence), events, clockNotes: [],
    unsupportedLines, truncatedMessages, displayOrder: 'collection-order', crossSourceOrder: 'uncertain',
  });
}
