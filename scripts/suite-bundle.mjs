/** 有界 STORE ZIP 与独立摘要封套；只处理数据，不执行条目。 */
import { createHash } from 'node:crypto';
export const SUITE_BUNDLE_LIMIT = 16 * 1024 * 1024;
const encoder = new TextEncoder(),
  decoder = new TextDecoder('utf-8', { fatal: true });
const table = Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc = (data) => {
  let value = 0xffffffff;
  for (const byte of data) value = table[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
const sha = (data) => createHash('sha256').update(data).digest('hex');
export function canonicalBundle(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalBundle).join(',') + ']';
  return (
    '{' +
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonicalBundle(v))
      .join(',') +
    '}'
  );
}
function check(condition, code) {
  if (!condition) throw new Error(code);
}
function validPath(path) {
  return (
    typeof path === 'string' &&
    path.length <= 240 &&
    path === path.normalize('NFC') &&
    !/[\\\x00-\x20:]/.test(path) &&
    path.split('/').every((s) => s && s !== '.' && s !== '..' && !/[. ]$/.test(s)) &&
    (path === 'manifest.json' ||
      /^(?:objects\/[a-z]+-[a-z-]+|materials)\/[a-f0-9-]{36}-[a-f0-9]{64}\.(?:json|bin)$/.test(path))
  );
}
export function encodeSuiteBundle(format, raw) {
  check(/^sakura-[a-z][a-z-]+\/1$/.test(format), 'BUNDLE_FORMAT');
  check(Array.isArray(raw) && raw.length > 0 && raw.length <= 2000, 'BUNDLE_ENTRY_LIMIT');
  let total = 0;
  const seen = new Set(),
    entries = raw
      .map((entry) => {
        check(
          validPath(entry.path) && entry.path !== 'manifest.json' && !seen.has(entry.path.toLowerCase()),
          'BUNDLE_PATH',
        );
        seen.add(entry.path.toLowerCase());
        check(entry.data instanceof Uint8Array && entry.data.byteLength <= SUITE_BUNDLE_LIMIT, 'BUNDLE_SIZE');
        total += entry.data.byteLength + Buffer.byteLength(entry.path) * 2 + 76;
        check(total <= SUITE_BUNDLE_LIMIT, 'BUNDLE_SIZE');
        const data = Buffer.from(entry.data);
        return { path: entry.path, data };
      })
      .sort((a, b) => (a.path < b.path ? -1 : 1));
  const payload = {
    format,
    files: entries.map((e) => ({ path: e.path, bytes: e.data.length, digest: sha(e.data) })),
  };
  const manifest = { ...payload, digest: sha(canonicalBundle(payload)) };
  entries.unshift({ path: 'manifest.json', data: Buffer.from(canonicalBundle(manifest)) });
  const local = [],
    central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(encoder.encode(entry.path)),
      checksum = crc(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(entry.data.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(entry.data.length, 20);
    directory.writeUInt32LE(entry.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, entry.data);
    central.push(directory, name);
    offset += header.length + name.length + entry.data.length;
    check(offset <= SUITE_BUNDLE_LIMIT, 'BUNDLE_SIZE');
  }
  const centralBytes = central.reduce((n, b) => n + b.length, 0),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes, 12);
  end.writeUInt32LE(offset, 16);
  check(offset + centralBytes + end.length <= SUITE_BUNDLE_LIMIT, 'BUNDLE_SIZE');
  return { data: Buffer.concat([...local, ...central, end]), manifest };
}
export function decodeSuiteBundle(raw, expectedFormat) {
  check(
    raw instanceof Uint8Array && raw.byteLength >= 22 && raw.byteLength <= SUITE_BUNDLE_LIMIT,
    'BUNDLE_SIZE',
  );
  const data = Buffer.from(raw);
  const end = data.subarray(data.length - 22);
  check(
    end.readUInt32LE() === 0x06054b50 &&
      !end.readUInt16LE(4) &&
      !end.readUInt16LE(6) &&
      !end.readUInt16LE(20),
    'BUNDLE_DIRECTORY',
  );
  const count = end.readUInt16LE(10),
    size = end.readUInt32LE(12),
    start = end.readUInt32LE(16);
  check(
    count > 1 && count <= 2001 && end.readUInt16LE(8) === count && start + size === data.length - 22,
    'BUNDLE_DIRECTORY',
  );
  const entries = [],
    seen = new Set();
  let cursor = start,
    localCursor = 0;
  for (let i = 0; i < count; i++) {
    check(cursor + 46 <= data.length - 22, 'BUNDLE_TRUNCATED');
    const c = data.subarray(cursor, cursor + 46),
      nameLength = c.readUInt16LE(28),
      offset = c.readUInt32LE(42),
      bytes = c.readUInt32LE(24);
    check(
      c.readUInt32LE() === 0x02014b50 &&
        c.readUInt16LE(6) === 20 &&
        c.readUInt16LE(8) === 0x800 &&
        !c.readUInt16LE(10) &&
        c.readUInt32LE(20) === bytes &&
        !c.readUInt16LE(30) &&
        !c.readUInt16LE(32) &&
        !c.readUInt16LE(34) &&
        !c.readUInt16LE(36) &&
        !c.readUInt32LE(38),
      'BUNDLE_ENTRY_FORMAT',
    );
    check(
      cursor + 46 + nameLength <= data.length - 22 &&
        offset === localCursor &&
        offset + 30 + nameLength + bytes <= start,
      'BUNDLE_OFFSETS',
    );
    const encodedName = data.subarray(cursor + 46, cursor + 46 + nameLength),
      path = decoder.decode(encodedName);
    check(validPath(path) && !seen.has(path.toLowerCase()), 'BUNDLE_PATH');
    seen.add(path.toLowerCase());
    const h = data.subarray(offset, offset + 30);
    check(
      h.readUInt32LE() === 0x04034b50 &&
        h.readUInt16LE(4) === 20 &&
        h.readUInt16LE(6) === 0x800 &&
        !h.readUInt16LE(8) &&
        h.readUInt32LE(14) === c.readUInt32LE(16) &&
        h.readUInt32LE(18) === bytes &&
        h.readUInt32LE(22) === bytes &&
        h.readUInt16LE(26) === nameLength &&
        !h.readUInt16LE(28) &&
        data.subarray(offset + 30, offset + 30 + nameLength).equals(encodedName),
      'BUNDLE_LOCAL_HEADER',
    );
    const content = data.subarray(offset + 30 + nameLength, offset + 30 + nameLength + bytes);
    check(crc(content) === c.readUInt32LE(16), 'BUNDLE_CRC');
    entries.push({ path, data: content });
    cursor += 46 + nameLength;
    localCursor = offset + 30 + nameLength + bytes;
  }
  check(cursor === start + size && localCursor === start, 'BUNDLE_UNUSED_BYTES');
  const first = entries.find((e) => e.path === 'manifest.json');
  check(first && first.data.length <= 1024 ** 2, 'BUNDLE_MANIFEST');
  const manifest = JSON.parse(decoder.decode(first.data));
  check(
    manifest &&
      Object.keys(manifest).sort().join(',') === 'digest,files,format' &&
      manifest.format === expectedFormat &&
      /^[a-f0-9]{64}$/.test(manifest.digest) &&
      Array.isArray(manifest.files) &&
      manifest.files.length === entries.length - 1,
    'BUNDLE_MANIFEST',
  );
  const named = new Map(entries.map((e) => [e.path, e]));
  let previous = '';
  for (const file of manifest.files) {
    check(
      file &&
        Object.keys(file).sort().join(',') === 'bytes,digest,path' &&
        validPath(file.path) &&
        file.path !== 'manifest.json' &&
        file.path > previous &&
        Number.isSafeInteger(file.bytes) &&
        file.bytes >= 0 &&
        /^[a-f0-9]{64}$/.test(file.digest),
      'BUNDLE_MANIFEST_ENTRY',
    );
    const actual = named.get(file.path);
    check(
      actual && actual.data.length === file.bytes && sha(actual.data) === file.digest,
      'BUNDLE_ENTRY_DIGEST',
    );
    previous = file.path;
  }
  check(
    sha(canonicalBundle({ format: manifest.format, files: manifest.files })) === manifest.digest,
    'BUNDLE_MANIFEST_DIGEST',
  );
  return {
    manifest,
    entries: entries.filter((e) => e.path !== 'manifest.json'),
    integrity: 'verified',
    sourceTrust: 'unauthenticated',
  };
}
