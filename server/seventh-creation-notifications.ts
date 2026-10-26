/** 受限通知模板与本地渲染；renders fixed templates without transport or external resources. */
import {
  type Data,
  cancelled,
  digest,
  escapeHtml,
  graph,
  integer,
  list,
  number,
  object,
  reject,
  rows,
  strings,
  text,
  unique,
} from './seventh-creation-common.ts';

type Node = {
  kind: 'text' | 'variable' | 'if' | 'each';
  value: string;
  format?: 'date' | 'number';
  children?: Node[];
  otherwise?: Node[];
};
function parse(source: string) {
  if (source.length > 262144) reject('NOTIFY_TEMPLATE_LIMIT');
  const references = new Set<string>();
  const nodes: Node[] = [];
  const stack: { node: Node; parent: Node[] }[] = [];
  let current = nodes,
    offset = 0,
    count = 0;
  for (const match of source.matchAll(/{{([^{}]+)}}/g)) {
    const plain = source.slice(offset, match.index);
    if (/{{|}}/.test(plain)) reject('NOTIFY_TEMPLATE_SYNTAX');
    if (plain) current.push({ kind: 'text', value: plain });
    offset = match.index! + match[0].length;
    const value = match[1].trim();
    if (++count > 1000) reject('NOTIFY_TEMPLATE_NODE_LIMIT');
    if (value === 'else') {
      const frame = stack.at(-1);
      if (!frame || frame.node.kind !== 'if' || frame.node.otherwise) reject('NOTIFY_TEMPLATE_ELSE');
      frame.node.otherwise = [];
      current = frame.node.otherwise;
      continue;
    }
    if (value === '/if' || value === '/each') {
      const frame = stack.pop();
      if (!frame || frame.node.kind !== value.slice(1)) reject('NOTIFY_TEMPLATE_BLOCK');
      current = frame.parent;
      continue;
    }
    const block = /^#(if|each)\s+([a-zA-Z][\w.-]*)$/.exec(value);
    if (block) {
      if (stack.length >= 16) reject('NOTIFY_TEMPLATE_DEPTH');
      const node: Node = { kind: block[1] as 'if' | 'each', value: block[2], children: [] };
      current.push(node);
      stack.push({ node, parent: current });
      current = node.children!;
      references.add(block[2]);
      continue;
    }
    const variable = /^(?:(date|number)\s+)?([a-zA-Z][\w.-]*)$/.exec(value);
    if (!variable) reject('NOTIFY_TEMPLATE_SYNTAX');
    references.add(variable[2]);
    current.push({
      kind: 'variable',
      value: variable[2],
      ...(variable[1]?{format:variable[1] as 'date'|'number'}:{}),
    });
  }
  const tail = source.slice(offset);
  if (/{{|}}/.test(tail) || stack.length) reject('NOTIFY_TEMPLATE_BLOCK');
  if (tail) current.push({ kind: 'text', value: tail });
  return {
    references: [...references].filter((r) => r !== 'this' && !r.startsWith('this.')),
    nodes: count,
    ast: nodes,
  };
}
function valueAt(variables: Data, key: string) {
  let value: unknown = variables;
  for (const part of key.split('.')) {
    if (['__proto__', 'prototype', 'constructor'].includes(part)) reject('NOTIFY_VARIABLE_PATH');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) reject('NOTIFY_VARIABLE_MISSING');
    value = (value as Data)[part];
  }
  return value;
}
function renderOne(source: string, variables: Data, html: boolean, locale = 'en', timeZone = 'UTC') {
  const parsed = parse(source);
  if (
    html &&
    /<(?:script|iframe|object|embed|form|link|meta)\b|\bon\w+\s*=|(?:src|href)\s*=|url\s*\(/i.test(source)
  )
    reject('NOTIFY_HTML_UNSAFE');
  if (html) {
    const allowed = new Set([
      'p',
      'br',
      'strong',
      'em',
      'b',
      'i',
      'u',
      'ul',
      'ol',
      'li',
      'div',
      'span',
      'table',
      'tr',
      'td',
      'th',
      'thead',
      'tbody',
      'h1',
      'h2',
      'h3',
    ]);
    for (const m of source.matchAll(/<\/?\s*([\w:-]+)/g))
      if (!allowed.has(m[1].toLowerCase())) reject('NOTIFY_HTML_ELEMENT');
  }
  let steps = 0,
    units = 0;
  const emit = (value: string) => {
    units += value.length;
    if (units > 262144) reject('NOTIFY_RENDER_ITEM_LIMIT');
    return value;
  };
  const renderNodes = (nodes: Node[], context: Data): string =>
    nodes
      .map((node) => {
        if (++steps > 100000) reject('NOTIFY_RENDER_STEP_LIMIT');
        if (node.kind === 'text') return emit(node.value);
        const value = valueAt(context, node.value);
        if (node.kind === 'if')
          return renderNodes(value === true ? (node.children ?? []) : (node.otherwise ?? []), context);
        if (node.kind === 'each')
          return list(value, 100)
            .map((item) => renderNodes(node.children ?? [], { ...context, this: item }))
            .join('');
        let formatted: unknown = value;
        if (node.format === 'date') {
          const stamp = Date.parse(text(value));
          if (!Number.isFinite(stamp)) reject('NOTIFY_DATE');
          formatted = new Intl.DateTimeFormat(locale, {
            timeZone,
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(stamp));
        }
        if (node.format === 'number')
          formatted = new Intl.NumberFormat(locale, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          }).format(number(value));
        if (formatted !== null && typeof formatted === 'object') reject('NOTIFY_SCALAR_VARIABLE');
        return emit(html ? escapeHtml(formatted) : String(formatted ?? ''));
      })
      .join('');
  return renderNodes(parsed.ast, variables);
}
function render(input: Data) {
  const templates = rows(input.templates, 100);
  const audiences = rows(input.audiences, 500);
  unique(audiences.map(a=>text(a.id)),'NOTIFY_DUPLICATE_RECIPIENT');
  unique(templates.map(t=>`${text(t.id)}\0${t.channel??'text'}\0${t.locale??'en'}`),'NOTIFY_DUPLICATE_TEMPLATE_LOCALE');
  const groups = [...new Set(templates.map((t) => `${text(t.id)}\0${t.channel ?? 'text'}`))];
  if (groups.length * audiences.length > 5000) reject('NOTIFY_MATRIX_LIMIT');
  const results: Data[] = [];
  let bytes = 0;
  for (const audience of audiences)
    for (const group of groups) {
      const [id, channel] = group.split('\0');
      const choices = templates.filter((t) => t.id === id && (t.channel ?? 'text') === channel);
      let selected = choices[0];
      let fallback = false;
      const locale = text(audience.locale ?? 'en');
      if (selected.locale !== locale) {
        const candidate = choices.find((t) => t.locale === locale);
        if (candidate) selected = candidate;
        else fallback = true;
      }
      const variables = { ...object(input.variables ?? {}), ...object(audience.variables ?? {}) };
      try {
        const title = renderOne(
          text(selected.title ?? ''),
          variables,
          false,
          locale,
          text(input.timeZone ?? 'UTC'),
        );
        const html = selected.channel === 'html';
        const body = renderOne(text(selected.body), variables, html, locale, text(input.timeZone ?? 'UTC'));
        const maximum = integer(selected.maxLength ?? 262144, 1, 262144);
        if (body.length > maximum) reject('NOTIFY_CHANNEL_LENGTH');
        bytes += Buffer.byteLength(body) + Buffer.byteLength(title);
        if (bytes > 64 * 1024 ** 2) reject('NOTIFY_OUTPUT_LIMIT');
        results.push({
          recipientId: text(audience.id),
          templateId: text(selected.id),
          locale: selected.locale ?? locale,
          fallback,
          title,
          body,
          channel: selected.channel ?? 'text',
          templateDigest: digest(selected),
          digest: digest({ title, body }),
          state: 'rendered',
          delivery: 'local-only',
        });
      } catch (error) {
        results.push({
          recipientId: audience.id,
          templateId: selected.id,
          state: 'failed',
          code: error instanceof Error ? error.message : 'NOTIFY_RENDER_ERROR',
        });
      }
    }
  return {
    results,
    bytes,
    passed: results.length > 0 && results.every((r) => r.state === 'rendered'),
    matrixSize: results.length,
    externalRequests: 0,
    formatterVersion: 'node-intl-' + process.versions.icu,
    timeZone: input.timeZone ?? 'UTC',
  };
}
export type LocalNotificationEntry={key:string;eventId:string;recipientId:string;templateId:string;channel:string;locale:string;templateDigest:string;renderDigest:string;delivery:'local-only'};
export type LocalNotificationDelivery={eventId:string;intentDigest:string;entries:LocalNotificationEntry[]};
export function prepareLocalNotificationDelivery(input:Data):LocalNotificationDelivery{
  const items=rows(input.renders,5000);if(!items.length)reject('NOTIFY_RENDER_REQUIRED');const eventId=text(input.eventId);
  const entries=items.map(row=>{
    if(row.state!=='rendered')reject('NOTIFY_RENDER_REQUIRED');
    const recipientId=text(row.recipientId),templateId=text(row.templateId),channel=text(row.channel??'text'),locale=text(row.locale??'en'),renderDigest=text(row.digest),templateDigest=text(row.templateDigest??row.digest);
    if(!/^[a-f0-9]{64}$/.test(renderDigest)||!/^[a-f0-9]{64}$/.test(templateDigest))reject('NOTIFY_RENDER_DIGEST');
    const key=digest([eventId,recipientId,templateId,channel,locale,templateDigest,renderDigest]);
    return {key,eventId,recipientId,templateId,channel,locale,templateDigest,renderDigest,delivery:'local-only' as const};
  });
  unique(entries.map(entry=>entry.key),'NOTIFY_DUPLICATE_DELIVERY');
  return {eventId,entries,intentDigest:digest({eventId,entries:[...entries].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0)})};
}
export function computeNotifications(action: string, input: Data, signal?: AbortSignal): unknown {
  cancelled(signal);
  if (action === 'templates.parse') {
    const result = parse(text(input.body));
    const known = strings(input.variables ?? [], 500);
    const missing = result.references.filter((r) => !known.includes(r));
    return { ...result, missing, passed: missing.length === 0 };
  }
  if (action === 'locales.checkCoverage') {
    const required = strings(input.required, 20);
    const present = strings(input.present, 20);
    return {
      missing: required.filter((l) => !present.includes(l)),
      passed: required.length > 0 && required.every((l) => present.includes(l)),
    };
  }
  if (action === 'audiences.generate') {
    const count = integer(input.count, 1, 500);
    const defaults = object(input.defaults ?? {});
    return {
      audiences: Array.from({ length: count }, (_, i) => ({
        id: `synthetic-${i + 1}`,
        locale: input.locale ?? 'en',
        synthetic: true,
        variables: { ...defaults, index: i + 1 },
      })),
    };
  }
  if (action === 'rules.simulate') {
    const events = rows(input.events, 5000);
    const suppressed = new Set(strings(input.suppressed ?? [], 500));
    return {
      decisions: events.map((e) => ({
        eventId: text(e.id),
        recipientId: text(e.recipientId),
        selected: !suppressed.has(text(e.recipientId)),
        reason: suppressed.has(text(e.recipientId)) ? 'explicit-suppression' : 'selected',
      })),
    };
  }
  if (action === 'renders.start') return render(input);
  if (action === 'checks.evaluate') {
    const result = render(input);
    return {
      passed: result.passed,
      results: result.results.map((r) => ({
        recipientId: r.recipientId,
        templateId: r.templateId,
        state: r.state,
        code: r.code ?? null,
        fallback: r.fallback ?? false,
      })),
      scope: 'local synthetic rendering',
      externalRequests: 0,
    };
  }
  if (action === 'inboxes.deliverLocal') {
    const prepared=prepareLocalNotificationDelivery(input);
    const existing = new Set(strings(input.existingKeys ?? [], 10000));
    return {
      entries: prepared.entries.map(entry=>({...entry,duplicate:existing.has(entry.key)})),
      intentDigest: prepared.intentDigest,
      externalRequests: 0,
    };
  }
  reject('CREATION_ACTION_UNSUPPORTED');
}
