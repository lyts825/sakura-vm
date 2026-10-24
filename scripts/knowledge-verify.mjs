/** 无服务器离线复核；校验不认证作者身份。 Pure Node offline verification without trusting claimed authors. */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
const workerUrl = existsSync(new URL('../server/knowledge-worker.mjs', import.meta.url))
  ? new URL('../server/knowledge-worker.mjs', import.meta.url)
  : new URL('../.sakura-server/assets/knowledge-worker.mjs', import.meta.url);
const { parseMaterial } = await import(workerUrl.href);
export const canonical = (v) =>
  v === null || typeof v !== 'object'
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? '[' + v.map(canonical).join(',') + ']'
      : '{' +
        Object.entries(v)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
          .join(',') +
        '}';
const sha = (v) => createHash('sha256').update(v).digest('hex'),
  hash = (v) => sha(canonical(v)),
  assert = (condition, message) => {
    if (!condition) throw new Error('BUNDLE_UNVERIFIED: ' + message);
  };
const keys = (v, allowed) => {
  assert(v && typeof v === 'object' && !Array.isArray(v), '对象无效');
  assert(
    Object.keys(v).every((k) => allowed.includes(k)) && allowed.every((k) => Object.hasOwn(v, k)),
    '字段不符',
  );
};
export function verifyBundle(input) {
  keys(input, ['format', 'id', 'mode', 'canonical', 'files', 'manifestDigest']);
  assert(
    input.format === 'sakura-knowledge/1' &&
      input.canonical === 'sorted-keys-utf8/1' &&
      ['reading', 'handover'].includes(input.mode),
    '格式版本不支持',
  );
  assert(Array.isArray(input.files) && input.files.length >= 3 && input.files.length <= 5000, '文件数无效');
  const files = new Map(),
    seen = new Set();
  let total = 0;
  for (const f of input.files) {
    keys(f, ['path', 'bytes', 'sha256', 'data']);
    assert(
      typeof f.path === 'string' &&
        f.path === f.path.normalize('NFC') &&
        /^(reading\/document\.(html|md)|objects\/knowledge\.json|sources\/[a-f0-9-]+-\d+\.txt)$/.test(f.path),
      '危险路径或未知文件',
    );
    const name = f.path.toLowerCase();
    assert(!seen.has(name), '重复路径');
    seen.add(name);
    assert(
      typeof f.data === 'string' &&
        f.data.length <= 24 * 1024 ** 2 &&
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.data),
      '字节编码不规范',
    );
    const bytes = Buffer.from(f.data, 'base64');
    total += bytes.length;
    assert(
      total <= 16 * 1024 ** 2 &&
        Number.isSafeInteger(f.bytes) &&
        bytes.length === f.bytes &&
        sha(bytes) === f.sha256,
      '字节大小或摘要错误',
    );
    files.set(f.path, bytes);
  }
  const manifest = input.files
    .map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  assert(hash(manifest) === input.manifestDigest, '清单摘要错误');
  assert(
    files.has('objects/knowledge.json') &&
      files.has('reading/document.html') &&
      files.has('reading/document.md'),
    '缺少必需文件',
  );
  const payload = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(files.get('objects/knowledge.json')),
  );
  keys(payload, ['document', 'entries', 'citations', 'extractions', 'sources', 'review', 'missing']);
  assert(
    canonical(payload) === files.get('objects/knowledge.json').toString('utf8'),
    '元数据编码或排序不规范',
  );
  const find = (rows, r) => {
    assert(Array.isArray(rows), '对象集合无效');
    const value = rows.find((v) => v.id === r.id && v.revision === r.revision);
    assert(value, '引用图缺少固定对象');
    return value;
  };
  const key = (r) => r.id + ':' + r.revision;
  for (const rows of [payload.entries, payload.citations, payload.extractions, payload.sources]) {
    assert(Array.isArray(rows) && rows.length <= 2000, '对象集合超过上限');
    assert(new Set(rows.map(key)).size === rows.length, '对象重复');
    for (const row of rows) assert(row.spaceId === payload.document.spaceId, '跨空间引用');
  }
  const d = payload.document;
  assert(
    hash({
      title: d.title,
      template: d.template,
      applicability: d.applicability,
      sections: d.sections,
      templateRevision: d.templateRevision,
      archived: d.archived,
    }) === d.digest,
    '文稿内容摘要错误',
  );
  for (const s of d.sections) {
    for (const e of s.entries) find(payload.entries, e);
    for (const c of s.citations) find(payload.citations, c);
  }
  for (const e of payload.entries) {
    assert(
      hash({ title: e.title, assertions: e.assertions, archived: e.archived }) === e.digest,
      '条目摘要错误',
    );
    for (const a of e.assertions) for (const c of [...a.supports, ...a.conflicts]) find(payload.citations, c);
  }
  const expected = new Set(['objects/knowledge.json', 'reading/document.html', 'reading/document.md']);
  if (input.mode === 'handover') {
    for (const s of payload.sources) {
      const path = `sources/${s.id}-${s.revision}.txt`;
      expected.add(path);
      assert(
        files.has(path) && sha(files.get(path)) === s.digest && files.get(path).length === s.bytes,
        '原材料摘要错误',
      );
      assert(!s.revoked && s.policy.export, '许可声明禁止导出');
    }
    for (const e of payload.extractions) {
      const s = find(payload.sources, e.source);
      const parsed = parseMaterial(files.get(`sources/${s.id}-${s.revision}.txt`), s.format);
      assert(
        e.parser === parsed.parser &&
          e.sourceDigest === s.digest &&
          e.textDigest === parsed.textDigest &&
          hash(e.blocks) === hash(parsed.blocks),
        '解析版本或位置不符',
      );
    }
    for (const c of payload.citations) {
      const e = find(payload.extractions, c.extraction);
      assert(
        c.source.id === e.source.id &&
          c.source.revision === e.source.revision &&
          c.sourceDigest === e.sourceDigest &&
          c.textDigest === e.textDigest &&
          sha(c.quote) === c.quoteDigest &&
          e.blocks.some(
            (b) => b.start === c.start && b.end === c.end && b.text === c.quote && b.locator === c.locator,
          ),
        '引文定位错误',
      );
    }
    for (const dep of d.dependencies)
      assert(find(payload.sources, dep).digest === dep.digest, '来源依赖摘要错误');
  } else assert(payload.sources.length === 0 && payload.extractions.length === 0, '阅读包含未声明材料');
  assert(
    [...files.keys()].every((k) => expected.has(k)),
    '额外文件',
  );
  const html = files.get('reading/document.html').toString('utf8');
  assert(
    html.startsWith('<!doctype html>') &&
      html.includes("script-src 'none'") &&
      !/<(?:script|iframe|object|embed|svg|img|link)\b/i.test(html),
    '阅读 HTML 不符合安全格式',
  );
  return {
    format: input.format,
    id: input.id,
    mode: input.mode,
    files: files.size,
    bytes: total,
    manifestDigest: input.manifestDigest,
    integrity: 'verified',
    authenticity: 'unverified',
    scope: input.mode === 'handover' ? 'fixed-source-and-location' : 'package-bytes-only',
    missing: payload.missing,
  };
}
