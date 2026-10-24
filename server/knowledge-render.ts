/** 发布与出包共用无脚本渲染。 Shared deterministic renderer; all user text is escaped. */
import * as K from '../shared/contracts/knowledge-studio.ts';
import type { KnowledgeEntriesV1, KnowledgeEvidenceV1 } from './service-contracts/knowledge-studio.ts';
import { hash, ref, uniqueDeps, fail } from './knowledge-store.ts';
export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const safeText = (s: string) => s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1 [图片未收录]');
export async function collectDocument(
  document: K.Document,
  purpose: K.Purpose,
  entries: KnowledgeEntriesV1,
  evidence: KnowledgeEvidenceV1,
) {
  const entryMap = new Map<string, K.Entry>(),
    citationMap = new Map<string, K.Citation>();
  const cite = async (r: K.Ref) => {
    const key = `${r.id}:${r.revision}`;
    if (!citationMap.has(key))
      citationMap.set(key, await evidence.inspect({ spaceId: document.spaceId, ...r, purpose }));
  };
  for (const section of document.sections) {
    for (const pinned of section.entries) {
      const key = `${pinned.id}:${pinned.revision}`;
      if (!entryMap.has(key)) {
        const entry = await entries.readPinned({ spaceId: document.spaceId, ...pinned, purpose });
        entryMap.set(key, entry);
        for (const a of entry.assertions) for (const c of [...a.supports, ...a.conflicts]) await cite(c);
      }
    }
    for (const c of section.citations) await cite(c);
  }
  const dependencies = uniqueDeps(
    [...entryMap.values()]
      .flatMap((e) => e.dependencies)
      .concat([...citationMap.values()].flatMap((c) => c.dependencies)),
  );
  if (
    hash(dependencies.map(({ policyRevision, ...d }) => d)) !==
    hash(document.dependencies.map(({ policyRevision, ...d }) => d))
  )
    fail('CITATION_MISMATCH', '渲染输入依赖不完整');
  return { entries: [...entryMap.values()], citations: [...citationMap.values()] };
}
export function renderDocument(
  document: K.Document,
  entries: K.Entry[],
  citations: K.Citation[],
): K.Rendered {
  const warnings: string[] = [];
  const text: string[] = [
    `# ${document.title}`,
    `适用范围：${document.applicability}`,
    '来源身份未认证。引文校验不证明事实真实性。',
  ];
  const citation = (r: K.Ref) => {
    const c = citations.find((c) => c.id === r.id && c.revision === r.revision);
    if (!c) fail('CITATION_MISMATCH', '渲染缺少引用');
    return `> ${c.quote}\n出处：${c.source.id}@${c.source.revision}，${c.locator}，UTF-8 字节 ${c.start}–${c.end}，SHA-256 ${c.sourceDigest}`;
  };
  for (const s of document.sections) {
    text.push(`## ${s.heading}`, s.text);
    for (const selected of s.entries) {
      const e = entries.find((e) => e.id === selected.id && e.revision === selected.revision);
      if (!e) fail('CITATION_MISMATCH', '渲染缺少条目');
      text.push(`### ${e.title}`);
      for (const a of e.assertions) {
        const label = { fact: '原文事实', judgment: '作者判断', procedure: '操作建议', unverified: '待核实' }[
          a.kind
        ];
        text.push(`[${label}] ${a.text}`, `条件：${a.applicability}`);
        if (a.kind === 'unverified' || (!a.supports.length && !a.verification)) {
          warnings.push(`待核实：${e.title}`);
          text.push('【待核实：尚无完整支持或人工验证】');
        }
        if (a.verification) text.push(`人工验证说明：${a.verification}`);
        for (const c of a.supports) text.push(citation(c));
        for (const c of a.conflicts) text.push('相反依据：', citation(c));
        if (a.conflicts.length) text.push(`人工判断：${a.resolution || '尚未解决'}`);
      }
    }
    for (const c of s.citations) text.push(citation(c));
  }
  const markdown = safeText(text.join('\n\n'));
  const html =
    "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'\"><meta name=\"referrer\" content=\"no-referrer\"><title>" +
    escapeHtml(document.title) +
    '</title><style>body{max-width:68rem;margin:3rem auto;padding:0 1.5rem;background:#fff;color:#17212b;font:16px/1.7 system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style></head><body><pre>' +
    escapeHtml(markdown) +
    '</pre></body></html>';
  return K.renderSchema.parse({
    title: document.title,
    markdown,
    html,
    digest: hash({ markdown, html }),
    warnings,
  });
}
