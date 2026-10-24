/** 浏览器导出固定 ZIP；只编码已经校验的普通 JSON 文件。 Browser ZIP export with digest validation. */
import { integrationBundleSchema } from './integration-exchange';
const canonical = (value: unknown): string =>
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
const encode = (value: unknown) => new TextEncoder().encode(canonical(value));
const digest = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
const crc = (bytes: Uint8Array) => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
};
export async function integrationBrowserZip(raw: unknown): Promise<Blob> {
  const bundle = integrationBundleSchema.parse(raw),
    { digest: expected, ...core } = bundle;
  if ((await digest(encode(core))) !== expected) throw Error('BUNDLE_DIGEST');
  const paths = new Set<string>(),
    keys = new Set<string>();
  const files: [string, Uint8Array<ArrayBuffer>][] = [['manifest.json', encode(bundle)]];
  for (const entry of bundle.entries) {
    const bytes = encode(entry.content);
    if (
      entry.path !== `${entry.kind}/${entry.key}.json` ||
      paths.has(entry.path) ||
      keys.has(entry.key) ||
      bytes.length !== entry.bytes ||
      (await digest(bytes)) !== entry.digest
    )
      throw Error('ENTRY_DIGEST_OR_PATH');
    paths.add(entry.path);
    keys.add(entry.key);
    files.push([entry.path, bytes]);
  }
  if ([bundle.root.scenario, bundle.root.mock, bundle.root.assertions].some((k) => k && !keys.has(k)))
    throw Error('BUNDLE_CLOSURE');
  const chunks: Uint8Array<ArrayBuffer>[] = [],
    directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0,
    centralSize = 0;
  for (const [name, bytes] of files) {
    const filename = new TextEncoder().encode(name),
      local = new Uint8Array(30),
      central = new Uint8Array(46);
    const h = new DataView(local.buffer),
      c = new DataView(central.buffer),
      checksum = crc(bytes);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x800, true);
    h.setUint32(14, checksum, true);
    h.setUint32(18, bytes.length, true);
    h.setUint32(22, bytes.length, true);
    h.setUint16(26, filename.length, true);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 0x314, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x800, true);
    c.setUint32(16, checksum, true);
    c.setUint32(20, bytes.length, true);
    c.setUint32(24, bytes.length, true);
    c.setUint16(28, filename.length, true);
    c.setUint32(38, 0x81a40000, true);
    c.setUint32(42, offset, true);
    chunks.push(local, filename, bytes);
    directory.push(central, filename);
    centralSize += central.length + filename.length;
    offset += local.length + filename.length + bytes.length;
  }
  if (offset + centralSize + 22 > 256 * 1024 ** 2) throw Error('ZIP_SIZE');
  const end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end], { type: 'application/zip' });
}
