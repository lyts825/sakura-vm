/** 离线 ZIP 完整性核验，无服务、插件或网络加载。 Standalone offline ZIP integrity verifier. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
export const canonical = (value) =>
  value === null || typeof value !== 'object'
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? '[' + value.map(canonical).join(',') + ']'
      : '{' +
        Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
          .join(',') +
        '}';
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hash = (value) => sha256(Buffer.from(canonical(value)));
const requireValue = (test, code) => {
  if (!test) throw Object.assign(new Error(code), { code });
};
const table = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes) {
  let n = 0xffffffff;
  for (const b of bytes) n = table[(n ^ b) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
export function verifyBundle(bundle) {
  requireValue(
    bundle && Object.keys(bundle).sort().join(',') === 'createdAt,digest,entries,format,root,tool',
    'BUNDLE_FIELDS',
  );
  requireValue(
    bundle.format === 'sakura-integration-bundle/1' && bundle.tool === 'integration-http-v1',
    'BUNDLE_FORMAT',
  );
  const { digest, ...core } = bundle;
  requireValue(hash(core) === digest, 'BUNDLE_DIGEST');
  requireValue(Array.isArray(bundle.entries) && bundle.entries.length <= 2000, 'BUNDLE_ENTRIES');
  const keys = new Set(),
    paths = new Set();
  let total = 0;
  for (const e of bundle.entries) {
    requireValue(
      e && Object.keys(e).sort().join(',') === 'bytes,content,digest,key,kind,path',
      'ENTRY_FIELDS',
    );
    requireValue(
      /^(spec|environment|fixture|mock|scenario|assertion|report)$/.test(e.kind) &&
        /^[a-f0-9]{64}$/.test(e.key) &&
        e.path === e.kind + '/' + e.key + '.json',
      'ENTRY_PATH',
    );
    requireValue(!keys.has(e.key) && !paths.has(e.path.toLowerCase()), 'ENTRY_DUPLICATE');
    keys.add(e.key);
    paths.add(e.path.toLowerCase());
    const data = Buffer.from(canonical(e.content));
    requireValue(data.length === e.bytes && sha256(data) === e.digest, 'ENTRY_DIGEST');
    total += e.bytes;
    if (e.kind === 'environment')
      requireValue(
        e.content.target.kind === 'unbound' &&
          e.content.credentials.every((c) => !c.sourceVmId && !c.name && !c.version),
        'ENTRY_AUTHORITY',
      );
    if (e.kind === 'report') requireValue(e.content.origin === 'imported', 'REPORT_ORIGIN');
  }
  requireValue(total <= 512 * 1024 ** 2, 'BUNDLE_SIZE');
  for (const k of [bundle.root.scenario, bundle.root.mock, bundle.root.assertions].filter(Boolean))
    requireValue(keys.has(k), 'BUNDLE_CLOSURE');
  return {
    format: bundle.format,
    digest,
    entries: bundle.entries.length,
    bytes: total,
    integrity: 'verified',
    publisherAuthenticated: false,
    businessAssertionsRecomputed: false,
  };
}
/** 仅接受普通文件条目；不解压到文件系统。 Validate archive metadata before decoding bytes. */
export function readIntegrationZip(bytes) {
  requireValue(Buffer.isBuffer(bytes) && bytes.length <= 256 * 1024 ** 2, 'ZIP_SIZE');
  let eocd = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
    if (bytes.readUInt32LE(p) === 0x06054b50) {
      eocd = p;
      break;
    }
  requireValue(eocd >= 0, 'ZIP_DIRECTORY');
  requireValue(
    bytes.readUInt16LE(eocd + 4) === 0 &&
      bytes.readUInt16LE(eocd + 6) === 0 &&
      bytes.readUInt16LE(eocd + 8) === bytes.readUInt16LE(eocd + 10),
    'ZIP_MULTIDISK',
  );
  const count = bytes.readUInt16LE(eocd + 10),
    size = bytes.readUInt32LE(eocd + 12),
    offset = bytes.readUInt32LE(eocd + 16);
  requireValue(
    count <= 2000 && offset + size === eocd && eocd + 22 + bytes.readUInt16LE(eocd + 20) === bytes.length,
    'ZIP_LAYOUT',
  );
  const entries = new Map(),
    paths = new Set(),
    ranges = [];
  let p = offset,
    total = 0;
  for (let i = 0; i < count; i++) {
    requireValue(p + 46 <= eocd && bytes.readUInt32LE(p) === 0x02014b50, 'ZIP_ENTRY');
    const flags = bytes.readUInt16LE(p + 8),
      method = bytes.readUInt16LE(p + 10),
      crc = bytes.readUInt32LE(p + 16),
      packed = bytes.readUInt32LE(p + 20),
      length = bytes.readUInt32LE(p + 24),
      n = bytes.readUInt16LE(p + 28),
      extra = bytes.readUInt16LE(p + 30),
      comment = bytes.readUInt16LE(p + 32),
      attributes = bytes.readUInt32LE(p + 38),
      start = bytes.readUInt32LE(p + 42);
    requireValue(
      p + 46 + n + extra + comment <= eocd && [0, 8].includes(method) && !(flags & ~0x800) && extra === 0,
      'ZIP_UNSUPPORTED',
    );
    const name = bytes.subarray(p + 46, p + 46 + n).toString('utf8'),
      mode = (attributes >>> 16) & 0xf000;
    requireValue(mode === 0 || mode === 0x8000, 'ZIP_LINK_OR_DEVICE');
    requireValue(
      /^(manifest\.json|(?:spec|environment|fixture|mock|scenario|assertion|report)\/[a-f0-9]{64}\.json)$/.test(
        name,
      ) && !paths.has(name.toLowerCase()),
      'ZIP_PATH',
    );
    paths.add(name.toLowerCase());
    total += length;
    requireValue(
      total <= 512 * 1024 ** 2 && start + 30 <= offset && bytes.readUInt32LE(start) === 0x04034b50,
      'ZIP_EXPANSION',
    );
    const localNameLength = bytes.readUInt16LE(start + 26),
      localExtra = bytes.readUInt16LE(start + 28),
      dataStart = start + 30 + localNameLength + localExtra;
    requireValue(
      localExtra === 0 &&
        bytes.readUInt16LE(start + 6) === flags &&
        bytes.readUInt16LE(start + 8) === method &&
        bytes.readUInt32LE(start + 14) === crc &&
        bytes.readUInt32LE(start + 18) === packed &&
        bytes.readUInt32LE(start + 22) === length &&
        bytes.subarray(start + 30, start + 30 + localNameLength).toString('utf8') === name &&
        dataStart + packed <= offset,
      'ZIP_LOCAL_MISMATCH',
    );
    requireValue(!ranges.some(([a, b]) => start < b && dataStart + packed > a), 'ZIP_OVERLAP');
    ranges.push([start, dataStart + packed]);
    const compressed = bytes.subarray(dataStart, dataStart + packed),
      content =
        method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, length) });
    requireValue(content.length === length && crc32(content) === crc, 'ZIP_CRC');
    entries.set(name, content);
    p += 46 + n + extra + comment;
  }
  requireValue(p === eocd && entries.has('manifest.json'), 'ZIP_DIRECTORY');
  const bundle = JSON.parse(entries.get('manifest.json').toString('utf8'));
  verifyBundle(bundle);
  requireValue(entries.size === bundle.entries.length + 1, 'ZIP_UNDECLARED_ENTRY');
  for (const e of bundle.entries)
    requireValue(
      entries.has(e.path) &&
        sha256(entries.get(e.path)) === e.digest &&
        entries.get(e.path).length === e.bytes,
      'ZIP_MANIFEST_MISMATCH',
    );
  return bundle;
}
export function writeIntegrationZip(bundle) {
  verifyBundle(bundle);
  const files = [
      ['manifest.json', Buffer.from(canonical(bundle))],
      ...bundle.entries.map((e) => [e.path, Buffer.from(canonical(e.content))]),
    ],
    chunks = [],
    directory = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name),
      crc = crc32(data),
      h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x800, 6);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26);
    chunks.push(h, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(0x314, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(0x81a40000, 38);
    c.writeUInt32LE(offset, 42);
    directory.push(c, n);
    offset += h.length + n.length + data.length;
  }
  const central = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...chunks, central, end]);
  requireValue(zip.length <= 256 * 1024 ** 2, 'ZIP_SIZE');
  return zip;
}
export async function verifyIntegrationFile(file) {
  const bytes = await readFile(file);
  const bundle = readIntegrationZip(bytes);
  return verifyBundle(bundle);
}
/** 离线 HTML 只显示文本，并禁止外部资源。 Offline report escapes every supplied value. */
export function integrationHtml(bundle) {
  const summary = verifyBundle(bundle);
  const escape = (value) =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  return (
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>接口集成离线证据</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:0 24px;color:#202530}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f3f6;padding:20px}</style><h1>接口集成离线证据</h1><p>仅核验包完整性和记录关联；不认证发布者，不重新计算业务断言。</p><pre>' +
    escape(
      JSON.stringify(
        {
          summary,
          reports: bundle.entries.filter((e) => e.kind === 'report').map((e) => e.content),
          definitions: bundle.entries
            .filter((e) => e.kind !== 'report')
            .map((e) => ({ kind: e.kind, digest: e.digest, bytes: e.bytes })),
        },
        null,
        2,
      ),
    ) +
    '</pre></html>'
  );
}
if (
  process.argv[1]?.endsWith('integration-verify.mjs') &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(JSON.stringify(await verifyIntegrationFile(process.argv[2]), null, 2));
  } catch (e) {
    console.error(JSON.stringify({ code: e.code || 'VERIFY_FAILED', error: e.message }));
    process.exitCode = 2;
  }
}
