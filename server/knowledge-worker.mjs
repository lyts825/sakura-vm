/** 固定文本解析与中文词项计算；材料从不执行。 Fixed data-only worker; no loaders or network. */
import { parentPort, workerData, isMainThread } from 'node:worker_threads';
import { createHash } from 'node:crypto';
const digest = (text) => createHash('sha256').update(text).digest('hex');
const error = (message) => {
  throw new Error(message);
};
export function tokenize(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 8192) error('EXTRACT_LIMIT');
  const normalized = text.normalize('NFKC').toLowerCase();
  const words = normalized.match(/[\p{L}\p{N}_]+/gu) || [],
    terms = [];
  for (const word of words) {
    if (word.length <= 128) terms.push(word);
    const chars = [...word];
    for (let i = 0; i < chars.length; i++) {
      if (/\p{Script=Han}/u.test(chars[i])) {
        terms.push(chars[i]);
        if (i + 1 < chars.length && /\p{Script=Han}/u.test(chars[i + 1])) terms.push(chars[i] + chars[i + 1]);
      }
    }
  }
  return [...new Set(terms)].slice(0, 10000);
}
export function parseMaterial(data, format) {
  const bytes = Buffer.from(data);
  if (bytes.length > 8 * 1024 ** 2) error('EXTRACT_LIMIT');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.includes('\0')) error('SOURCE_FORMAT_UNSUPPORTED');
  const offsets = new Uint32Array(text.length + 1);
  let n = 0;
  for (let i = 0; i < text.length;) {
    const c = String.fromCodePoint(text.codePointAt(i));
    offsets[i] = n;
    if (c.length === 2) offsets[i + 1] = n;
    n += Buffer.byteLength(c);
    i += c.length;
    offsets[i] = n;
  }
  const lines = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lines.push(i + 1);
  for (let i = 0; i < lines.length; i++)
    if (offsets[lines[i + 1] ?? text.length] - offsets[lines[i]] > 65536)
      error('EXTRACT_LIMIT: line exceeds 64 KiB');
  const blocks = [],
    warnings = [];
  const lineAt = (p) => {
    let lo = 0,
      hi = lines.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid] <= p) lo = mid;
      else hi = mid;
    }
    return lo + 1;
  };
  const add = (start, end, locator, value) => {
    if (start === end) return;
    const original = text.slice(start, end);
    if (value !== undefined && Buffer.byteLength(value) > 8192) error('EXTRACT_LIMIT');
    if (value !== undefined) {
      if (value.trim())
        blocks.push({ text: value, start: offsets[start], end: offsets[end], line: lineAt(start), locator });
      return;
    }
    let from = start,
      len = 0;
    for (let i = start; i < end;) {
      const c = String.fromCodePoint(text.codePointAt(i)),
        size = Buffer.byteLength(c);
      if (len + size > 8192) {
        blocks.push({
          text: text.slice(from, i),
          start: offsets[from],
          end: offsets[i],
          line: lineAt(from),
          locator,
        });
        from = i;
        len = 0;
      }
      len += size;
      i += c.length;
    }
    if (from < end && original.trim())
      blocks.push({
        text: text.slice(from, end),
        start: offsets[from],
        end: offsets[end],
        line: lineAt(from),
        locator,
      });
  };
  if (format === 'json') {
    let depth = 0,
      quoted = false,
      escaped = false;
    for (const c of text) {
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{' || c === '[') {
        if (++depth > 64) error('EXTRACT_LIMIT: JSON depth');
      } else if (c === '}' || c === ']') depth--;
    }
    JSON.parse(text.replace(/^\uFEFF/, ''));
    let p = 0;
    const ws = () => {
      while (/\s/.test(text[p] || 'x')) p++;
    };
    const str = () => {
      const start = p++;
      while (p < text.length) {
        if (text[p++] === '"') break;
        if (text[p - 1] === '\\') p++;
      }
      return JSON.parse(text.slice(start, p));
    };
    const value = (path, depth) => {
      if (depth > 64) error('EXTRACT_LIMIT');
      ws();
      const start = p;
      if (text[p] === '{') {
        p++;
        ws();
        if (text[p] === '}') {
          p++;
          add(start, p, path);
          return;
        }
        while (true) {
          ws();
          const key = str();
          ws();
          p++;
          value(path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'), depth + 1);
          ws();
          if (text[p++] === '}') break;
        }
      } else if (text[p] === '[') {
        p++;
        ws();
        let index = 0;
        if (text[p] === ']') {
          p++;
          add(start, p, path);
          return;
        }
        while (true) {
          value(path + '/' + index++, depth + 1);
          ws();
          if (text[p++] === ']') break;
        }
      } else {
        if (text[p] === '"') str();
        else while (p < text.length && !/[\s,}\]]/.test(text[p])) p++;
        add(start, p, 'JSON ' + (path || '/'));
      }
    };
    value('', 0);
  } else if (format === 'html') {
    const hidden = new Set([
      'script',
      'style',
      'iframe',
      'object',
      'embed',
      'svg',
      'math',
      'template',
      'noscript',
      'head',
    ]);
    let pos = 0,
      skip = [];
    let removed = false;
    const entity = (s) =>
      s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, v) => {
        if (v[0] === '#') {
          const cp = v[1]?.toLowerCase() === 'x' ? parseInt(v.slice(2), 16) : parseInt(v.slice(1), 10);
          return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '�';
        }
        return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[v.toLowerCase()] || _;
      });
    while (pos < text.length) {
      if (text.startsWith('<!--', pos)) {
        const end = text.indexOf('-->', pos + 4);
        if (end < 0) {
          removed = true;
          break;
        }
        pos = end + 3;
        removed = true;
        continue;
      }
      if (text[pos] === '<') {
        let end = pos + 1,
          q = '';
        for (; end < text.length; end++) {
          const c = text[end];
          if (q) {
            if (c === q) q = '';
          } else if (c === '"' || c === "'") q = c;
          else if (c === '>') break;
        }
        if (end >= text.length) {
          removed = true;
          break;
        }
        const tag = text.slice(pos + 1, end).match(/^\s*(\/?)\s*([a-zA-Z][\w:-]*)/);
        if (tag) {
          const name = tag[2].toLowerCase();
          if (hidden.has(name)) {
            removed = true;
            if (tag[1]) {
              const idx = skip.lastIndexOf(name);
              if (idx >= 0) skip.length = idx;
            } else if (!/\/\s*$/.test(text.slice(pos + 1, end))) skip.push(name);
          }
        }
        pos = end + 1;
      } else {
        const end = text.indexOf('<', pos),
          stop = end < 0 ? text.length : end;
        if (!skip.length) {
          let from = pos;
          for (let i = pos; i < stop; i++) {
            if (text[i] === '\n' || offsets[i] - offsets[from] > 4000) {
              add(from, i, 'HTML 文本，行 ' + lineAt(from), entity(text.slice(from, i)));
              from = i;
            }
          }
          add(from, stop, 'HTML 文本，行 ' + lineAt(from), entity(text.slice(from, stop)));
        }
        pos = stop;
      }
    }
    warnings.push('HTML 仅保留文本；不加载脚本、样式、图片或外部资源');
    if (removed) warnings.push('已丢弃活动或不可见 HTML 内容');
  } else if (format === 'csv') {
    let quoted = false,
      start = 0,
      row = 1;
    for (let i = 0; i <= text.length; i++) {
      if (text[i] === '"') {
        if (quoted && text[i + 1] === '"') i++;
        else quoted = !quoted;
      }
      if (i === text.length || (!quoted && text[i] === '\n')) {
        add(start, i, 'CSV 行 ' + row++);
        start = i + 1;
      }
    }
    if (quoted) error('SOURCE_FORMAT_UNSUPPORTED: unclosed CSV quote');
  } else if (format === 'text' || format === 'markdown') {
    let heading = '';
    for (let i = 0; i < lines.length; i++) {
      const start = lines[i],
        end = lines[i + 1] ?? text.length,
        line = text.slice(start, end);
      if (format === 'markdown' && /^#{1,6}\s/.test(line)) heading = line.trim().slice(0, 150);
      add(start, end, heading || '行 ' + (i + 1));
    }
    if (format === 'markdown' && /!\[/.test(text)) warnings.push('图片未收录，仅保留替代文字');
  } else error('SOURCE_FORMAT_UNSUPPORTED');
  if (blocks.length > 100000 || Buffer.byteLength(JSON.stringify(blocks)) > 16 * 1024 ** 2)
    error('EXTRACT_LIMIT');
  return {
    parser: 'sakura-text/1',
    blocks,
    warnings,
    textDigest: digest(blocks.map((b) => b.text).join('\n')),
  };
}
if (!isMainThread) {
  try {
    let result;
    if (workerData?.task === 'parse' && workerData.data instanceof Uint8Array)
      result = parseMaterial(workerData.data, workerData.format);
    else if (
      workerData?.task === 'index' &&
      Array.isArray(workerData.blocks) &&
      workerData.blocks.length <= 256
    )
      result = workerData.blocks.map((b) => tokenize(b.text));
    else error('COMPUTE_INPUT');
    parentPort.postMessage({ ok: true, result });
  } catch (e) {
    parentPort.postMessage({
      ok: false,
      error: String(e?.message || e),
      code: String(e?.message || '').startsWith('EXTRACT_LIMIT')
        ? 'EXTRACT_LIMIT'
        : 'SOURCE_FORMAT_UNSUPPORTED',
      status: 422,
    });
  }
}
