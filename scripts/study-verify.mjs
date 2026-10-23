/** Study 离线核验；仅依赖 Node 内置模块，不联网、不提取或执行档案内容。 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';

const LIMIT = 1024 ** 3,
  CHUNK = 512 * 1024,
  METADATA_LIMIT = 16 * 1024 ** 2;
const fail = (message) => {
  throw new Error('Study 核验失败：' + message);
};
const sha = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
      .join(',') +
    '}'
  );
};
const hash = (value) => sha(canonical(value));
const equal = (a, b) => canonical(a) === canonical(b);
const unique = (values, label) => {
  if (new Set(values).size !== values.length) fail(label + '重复');
};

// 与 shared/contracts/data-study.ts/data-common.ts 保持相同的字段、默认值及预算。
// 显式描述字段也固定 deliveryFile 的属性顺序，其摘要使用 JSON.stringify 而非 dataHash。
const text =
  (min = 0, max = Infinity, pattern) =>
  (v, at) => {
    if (typeof v !== 'string' || v.length < min || v.length > max || (pattern && !pattern.test(v)))
      fail(at + ' 文本无效');
    return v;
  };
const number =
  (min = -Infinity, max = Infinity, integer = false) =>
  (v, at) => {
    if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (integer && !Number.isSafeInteger(v))
    )
      fail(at + ' 数值无效');
    return v;
  };
const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => number(min, max, true);
const boolean = (v, at) => {
  if (typeof v !== 'boolean') fail(at + ' 布尔值无效');
  return v;
};
const enumeration =
  (...values) =>
  (v, at) => {
    if (!values.includes(v)) fail(at + ' 不受支持');
    return v;
  };
const optional = (parse) => (v, at) => (v === undefined ? undefined : parse(v, at));
const fallback = (parse, value) => (v, at) => parse(v === undefined ? structuredClone(value) : v, at);
const array =
  (parse, min = 0, max = Infinity) =>
  (v, at) => {
    if (!Array.isArray(v) || v.length < min || v.length > max) fail(at + ' 数组长度无效');
    return v.map((item, i) => parse(item, at + '[' + i + ']'));
  };
const object = (fields) => (v, at) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(at + ' 必须是对象');
  for (const key of Object.keys(v)) if (!Object.hasOwn(fields, key)) fail(at + ' 存在未知字段 ' + key);
  const output = {};
  for (const [key, parse] of Object.entries(fields)) {
    const value = parse(v[key], at + '.' + key);
    if (value !== undefined) Object.defineProperty(output, key, { value, enumerable: true });
  }
  return output;
};
const record =
  (keyParser, valueParser, max = Infinity) =>
  (v, at) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > max)
      fail(at + ' 字典无效');
    return Object.fromEntries(
      Object.entries(v).map(([k, value]) => [keyParser(k, at), valueParser(value, at + '.' + k)]),
    );
  };
const digest = text(64, 64, /^[a-f0-9]{64}$/);
const uuid = text(
  36,
  36,
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i,
);
const datetime = (v, at) => {
  text(1, 64, /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?Z$/)(v, at);
  if (!Number.isFinite(Date.parse(v))) fail(at + ' 日期无效');
  const [year, month, day] = v.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.parse(v));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day)
    fail(at + ' 日期越界');
  return v;
};
const path = (v, at) => {
  text(1, 1024)(v, at);
  if (
    v.startsWith('/') ||
    /[\u0000-\u001f:\\]/.test(v) ||
    v.split('/').some((p) => !p || p === '.' || p === '..')
  )
    fail(at + ' 不是安全相对路径');
  return v;
};
function paths(values) {
  const seen = new Set();
  for (const name of values) {
    if (
      typeof name !== 'string' ||
      name.split('/').length > 32 ||
      name
        .split('/')
        .some(
          (p) =>
            !p ||
            p === '.' ||
            p === '..' ||
            /[<>"|?*\u0000-\u001f:\\]/.test(p) ||
            /[. ]$/.test(p) ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
        )
    )
      fail('ZIP/清单路径不安全：' + name);
    const key = name.normalize('NFC').toLowerCase();
    if (seen.has(key)) fail('ZIP/清单路径重复或大小写冲突：' + name);
    seen.add(key);
  }
  for (const key of seen) {
    const parts = key.split('/');
    parts.pop();
    while (parts.length) {
      if (seen.has(parts.join('/'))) fail('文件与目录路径冲突');
      parts.pop();
    }
  }
}
const scope = object({ vmId: text(1, 128), projectId: text(1, 128) });
const file = object({
  path,
  blobId: text(1, 128),
  sha256: digest,
  bytes: integer(),
  mode: integer(0, 0o777),
});
const manifest = object({
  id: uuid,
  scope,
  label: text(1, 160),
  kind: enumeration('source', 'output', 'report', 'import'),
  digest,
  files: array(file, 0, 10000),
  createdAt: datetime,
});
const format = enumeration('csv', 'jsonl', 'parquet');
const columns = (v, at) => {
  const out = array(object({ name: text(1, 256), type: text(1, 80), nullable: boolean }), 1, 512)(v, at);
  unique(
    out.map((c) => c.name),
    at + ' 列名',
  );
  return out;
};
const parse = object({
  delimiter: fallback(text(1, 1), ','),
  header: fallback(boolean, true),
  nullValue: fallback(text(0, 64), ''),
  schema: optional(columns),
});
const dataset = object({
  id: uuid,
  scope,
  digest,
  name: text(1, 160),
  manifestId: uuid,
  manifestDigest: digest,
  format,
  files: array(path, 1, 128),
  schema: columns,
  parse,
  rows: integer(),
  bytes: integer(0, 512 * 1024 ** 2),
  parents: array(digest, 0, 32),
  definitionDigest: digest,
  sensitivity: enumeration('raw', 'redacted'),
  archived: fallback(boolean, false),
  createdAt: datetime,
});
const environment = object({
  assetId: digest,
  digest,
  memoryMiB: fallback(integer(512, 8192), 2048),
  cpus: fallback(integer(1, 4), 2),
  timeoutSeconds: fallback(integer(1, 1800), 300),
});
const scalar = (v, at) => {
  if (v === null || typeof v === 'boolean') return v;
  return typeof v === 'number' ? number()(v, at) : text(0, 8192)(v, at);
};
const parameters = record(text(1, 64, /^[A-Za-z][A-Za-z0-9_]{0,63}$/), scalar, 32);
const rules = {
  'not-null': object({ kind: enumeration('not-null'), column: text(1, 256) }),
  unique: object({ kind: enumeration('unique'), columns: array(text(1, 256), 1, 32) }),
  range: object({
    kind: enumeration('range'),
    column: text(1, 256),
    min: optional(number()),
    max: optional(number()),
  }),
  allowed: object({
    kind: enumeration('allowed'),
    column: text(1, 256),
    values: array((v, at) => (typeof v === 'string' ? text(0, 1024)(v, at) : scalar(v, at)), 0, 1000),
  }),
  'row-count': object({ kind: enumeration('row-count'), min: integer(), max: optional(integer()) }),
  reference: object({
    kind: enumeration('reference'),
    column: text(1, 256),
    datasetIndex: integer(1, 15),
    referenceColumn: text(1, 256),
  }),
};
const variant = (choices) => (v, at) => {
  if (!v || !Object.hasOwn(choices, v.kind)) fail(at + ' 类型未知');
  return choices[v.kind](v, at);
};
const rule = variant(rules);
const mask = variant({
  drop: object({ kind: enumeration('drop'), column: text(1, 256) }),
  constant: object({ kind: enumeration('constant'), column: text(1, 256), value: text(0, 1024) }),
  prefix: object({ kind: enumeration('prefix'), column: text(1, 256), length: integer(0, 128) }),
  bucket: object({ kind: enumeration('bucket'), column: text(1, 256), size: number(Number.MIN_VALUE) }),
});
const task = object({
  kind: enumeration('inspect', 'transform', 'mask', 'quality', 'notebook'),
  environment,
  inputs: array(object({ manifest, files: array(path, 1, 128), format, parse }), 0, 16),
  sql: optional(text(0, 65536)),
  parameters: fallback(parameters, {}),
  rules: fallback(array(rule, 0, 128), []),
  masks: fallback(array(mask, 0, 512), []),
  notebook: optional(text(0, 8 * 1024 ** 2)),
  allowRaw: fallback(boolean, false),
  sample: fallback(integer(0, 100), 0),
});
const output = object({
  table: optional(
    object({
      schema: columns,
      rows: integer(),
      files: array(path, 0, 128),
      format,
      bytes: integer(0, 256 * 1024 ** 2),
    }),
  ),
  checks: fallback(
    array(
      object({
        rule,
        rows: integer(),
        failed: integer(),
        verdict: enumeration('pass', 'fail', 'unknown'),
        scope: enumeration('full', 'sample'),
      }),
      0,
      128,
    ),
    [],
  ),
  columns: fallback(
    array(object({ name: text(0, 256), rows: integer(), nulls: integer(), distinct: integer() }), 0, 512),
    [],
  ),
  metrics: fallback(record(text(0, 128), number()), {}),
  notebookFile: optional(path),
  executedCells: optional(integer()),
  environment: record(text(0, 64), text(0, 256)),
  truncated: fallback(boolean, false),
});
const run = object({
  id: uuid,
  scope,
  definitionDigest: digest,
  task,
  state: enumeration(
    'queued',
    'preparing',
    'running',
    'collecting',
    'succeeded',
    'failed',
    'cancelled',
    'interrupted',
  ),
  cleanup: enumeration('pending', 'confirmed', 'unknown'),
  manifestId: optional(uuid),
  output: optional(output),
  vmId: optional(uuid),
  vmCreatedAt: optional(text()),
  vmToken: optional(uuid),
  error: optional(text(0, 2048)),
  createdAt: datetime,
  finishedAt: optional(datetime),
});
const evidence = object({
  id: uuid,
  scope,
  kind: enumeration('transform', 'quality', 'notebook', 'experiment'),
  inputIds: array(uuid, 0, 16),
  inputDigests: array(digest, 0, 16),
  definitionDigest: digest,
  runId: uuid,
  outputDatasetId: optional(uuid),
  createdAt: datetime,
});
const studySchema = object({
  type: enumeration('sakura-data-study-v1'),
  schemaVersion: enumeration(1),
  signature: enumeration('unsupported'),
  coreDigest: digest,
  datasets: array(object({ dataset, manifest }), 1, 128),
  executions: fallback(array(object({ evidence, run, manifest }), 0, 32), []),
  missingEnvironmentImages: fallback(array(digest, 0, 32), []),
  missingOutputDatasets: fallback(array(uuid, 0, 32), []),
  missingAncestors: array(digest, 0, 1000),
  reproducibility: enumeration('declared-inputs-and-evidence'),
  createdAt: datetime,
});
const versionDigest = (d) =>
  hash(
    Object.fromEntries(
      [
        'manifestDigest',
        'format',
        'files',
        'schema',
        'parse',
        'rows',
        'bytes',
        'parents',
        'definitionDigest',
        'sensitivity',
      ].map((key) => [key, d[key]]),
    ),
  );

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crcUpdate = (crc, bytes) => {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc;
};
const decoder = new TextDecoder('utf-8', { fatal: true });
function json(bytes) {
  const value = JSON.parse(decoder.decode(bytes));
  const visit = (v, depth) => {
    if (depth > 64) fail('JSON 嵌套超过 64 层');
    if (v && typeof v === 'object') for (const item of Object.values(v)) visit(item, depth + 1);
  };
  visit(value, 0);
  return value;
}

/** 固定句柄、限量读取、完整核对；返回声明与缺失项，不生成信任或运行许可。 */
export async function verifyStudy(filename, { signal } = {}) {
  const full = resolve(filename),
    initial = await lstat(full);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size < 22 || initial.size > LIMIT)
    fail('需要 22 字节至 1 GiB 的普通 ZIP 文件');
  const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    if (before.ino !== initial.ino || before.dev !== initial.dev || before.size !== initial.size)
      fail('打开时文件身份改变');
    const read = async (offset, size) => {
      signal?.throwIfAborted();
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(size) ||
        offset < 0 ||
        size < 0 ||
        size > CHUNK ||
        offset + size > before.size
      )
        fail('ZIP 读取越界');
      const bytes = Buffer.alloc(size);
      for (let at = 0; at < size;) {
        const part = await handle.read(bytes, at, size - at, offset + at);
        if (!part.bytesRead) fail('ZIP 已截断');
        at += part.bytesRead;
      }
      return bytes;
    };
    const end = await read(before.size - 22, 22);
    if (
      end.readUInt32LE() !== 0x06054b50 ||
      end.readUInt16LE(4) ||
      end.readUInt16LE(6) ||
      end.readUInt16LE(20)
    )
      fail('不支持 ZIP64、多卷、注释或尾随字节');
    const count = end.readUInt16LE(10),
      directoryStart = end.readUInt32LE(16),
      directorySize = end.readUInt32LE(12);
    if (
      count < 1 ||
      count > 10000 ||
      count !== end.readUInt16LE(8) ||
      directoryStart + directorySize !== before.size - 22
    )
      fail('ZIP 目录数量或范围无效');
    let cursor = directoryStart,
      localEnd = 0,
      total = 0;
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > before.size - 22) fail('ZIP 中央目录越界');
      const central = await read(cursor, 46);
      if (central.readUInt32LE() !== 0x02014b50 || central.readUInt16LE(6) > 20) fail('ZIP 中央头无效');
      const flags = central.readUInt16LE(8),
        checksum = central.readUInt32LE(16),
        size = central.readUInt32LE(24),
        nameLength = central.readUInt16LE(28),
        local = central.readUInt32LE(42);
      if (
        flags !== 0x800 ||
        central.readUInt16LE(10) ||
        central.readUInt32LE(20) !== size ||
        central.readUInt16LE(30) ||
        central.readUInt16LE(32) ||
        central.readUInt16LE(34) ||
        central.readUInt16LE(36) ||
        central.readUInt32LE(38) ||
        local !== localEnd ||
        !nameLength ||
        nameLength > 8192 ||
        cursor + 46 + nameLength > before.size - 22
      )
        fail('仅支持无扩展、无加密的 UTF-8 STORE 文件');
      const nameBytes = await read(cursor + 46, nameLength),
        name = decoder.decode(nameBytes);
      if (name.length > 1100) fail('ZIP 路径超过 Study 文件名范围');
      if (entries.has(name) || name.endsWith('/')) fail('ZIP 条目重复或为目录');
      const head = await read(local, 30);
      if (
        head.readUInt32LE() !== 0x04034b50 ||
        head.readUInt16LE(4) > 20 ||
        head.readUInt16LE(6) !== flags ||
        head.readUInt16LE(8) ||
        head.readUInt32LE(14) !== checksum ||
        head.readUInt32LE(18) !== size ||
        head.readUInt32LE(22) !== size ||
        head.readUInt16LE(26) !== nameLength ||
        head.readUInt16LE(28) ||
        !(await read(local + 30, nameLength)).equals(nameBytes)
      )
        fail('ZIP 本地头与中央目录不一致');
      const start = local + 30 + nameLength;
      localEnd = start + size;
      if (localEnd > directoryStart || (total += size) > LIMIT) fail('ZIP 条目内容越界');
      let crc = 0xffffffff;
      const contentHash = createHash('sha256');
      for (let at = 0; at < size; at += CHUNK) {
        const bytes = await read(start + at, Math.min(CHUNK, size - at));
        crc = crcUpdate(crc, bytes);
        contentHash.update(bytes);
      }
      if ((crc ^ 0xffffffff) >>> 0 !== checksum) fail('ZIP CRC-32 不符：' + name);
      entries.set(name, { start, bytes: size, sha256: contentHash.digest('hex') });
      cursor += 46 + nameLength;
    }
    if (cursor !== before.size - 22 || localEnd !== directoryStart) fail('ZIP 隐藏区域或目录长度不符');
    paths([...entries.keys()]);
    const metadata = async (name, limit) => {
      const entry = entries.get(name);
      if (!entry || entry.bytes > limit) fail('元数据缺失或过大：' + name);
      const parts = [];
      for (let at = 0; at < entry.bytes; at += CHUNK)
        parts.push(await read(entry.start + at, Math.min(CHUNK, entry.bytes - at)));
      const bytes = Buffer.concat(parts);
      if (sha(bytes) !== entry.sha256) fail('核验期间元数据改变');
      return json(bytes);
    };
    const study = studySchema(await metadata('study.json', METADATA_LIMIT), 'study');
    const { coreDigest, ...core } = study;
    if (hash(core) !== coreDigest) fail('Study coreDigest 不符');
    const expected = new Set(['study.json']);
    const verifyManifest = (m, prefix) => {
      paths(m.files.map((f) => f.path));
      if (sha(JSON.stringify(m.files)) !== m.digest) fail('制品清单摘要不符');
      for (const f of m.files) {
        const name = prefix + f.path,
          entry = entries.get(name);
        if (expected.has(name)) fail('重复声明条目：' + name);
        expected.add(name);
        if (!entry || entry.bytes !== f.bytes || entry.sha256 !== f.sha256 || f.blobId !== f.sha256)
          fail('文件长度、完整摘要或 blob 身份不符：' + name);
      }
    };
    const datasets = new Map(),
      ids = new Map();
    for (const { dataset: d, manifest: m } of study.datasets) {
      if (datasets.has(d.digest) || ids.has(d.id)) fail('数据版本摘要或 ID 重复');
      if (
        versionDigest(d) !== d.digest ||
        m.digest !== d.manifestDigest ||
        m.id !== d.manifestId ||
        !equal(m.scope, d.scope)
      )
        fail('数据版本身份或摘要不符');
      unique(d.files, '数据分区');
      if (
        d.parents.includes(d.digest) ||
        d.files.some((p) => !m.files.some((f) => f.path === p)) ||
        m.files.filter((f) => d.files.includes(f.path)).reduce((sum, f) => sum + f.bytes, 0) !== d.bytes
      )
        fail('数据分区或父版本无效');
      verifyManifest(m, 'datasets/' + d.digest + '/');
      datasets.set(d.digest, d);
      ids.set(d.id, d);
    }
    unique(
      study.executions.map((e) => e.evidence.id),
      '执行证据 ID',
    );
    unique(
      study.executions.map((e) => e.run.id),
      '执行运行 ID',
    );
    for (const { evidence: e, run: r, manifest: m } of study.executions) {
      if (
        !['transform', 'quality', 'notebook'].includes(e.kind) ||
        e.kind !== r.task.kind ||
        !equal(e.scope, r.scope) ||
        !equal(r.scope, m.scope) ||
        e.runId !== r.id ||
        r.state !== 'succeeded' ||
        r.cleanup !== 'confirmed' ||
        r.manifestId !== m.id ||
        !r.output ||
        r.output.truncated ||
        hash(r.task) !== r.definitionDigest ||
        r.task.inputs.length !== e.inputIds.length ||
        e.inputIds.length !== e.inputDigests.length
      )
        fail('执行身份、成功状态或任务摘要不符');
      for (let i = 0; i < r.task.inputs.length; i++) {
        const input = r.task.inputs[i],
          d = datasets.get(e.inputDigests[i]);
        if (
          !d ||
          e.inputIds[i] !== d.id ||
          input.manifest.id !== d.manifestId ||
          input.manifest.digest !== d.manifestDigest ||
          !equal(input.files, d.files) ||
          input.format !== d.format ||
          !equal(input.parse, d.parse) ||
          !equal(input.manifest, study.datasets.find((item) => item.dataset.id === d.id).manifest)
        )
          fail('执行输入引用不闭合或版本内容不符');
      }
      const definition =
        e.kind === 'transform'
          ? { sql: r.task.sql, parameters: r.task.parameters }
          : e.kind === 'quality'
            ? { rules: r.task.rules, sample: r.task.sample }
            : {
                notebook: hash({ content: r.task.notebook, datasets: e.inputDigests }),
                parameters: r.task.parameters,
              };
      if (
        hash(definition) !== e.definitionDigest ||
        (e.kind === 'transform' && !r.task.sql) ||
        (e.kind === 'notebook' && !r.task.notebook)
      )
        fail('执行证据的定义摘要不符');
      verifyManifest(m, 'executions/' + e.id + '/');
      const actual = output(
        await metadata('executions/' + e.id + '/output/result.json', 8 * 1024 ** 2),
        'output',
      );
      if (!equal(actual, r.output)) fail('执行结果文件与回执不符');
      const table = actual.table;
      if (table) {
        unique(table.files, '结果分区');
        if (
          table.files.some((p) => !m.files.some((f) => f.path === p)) ||
          m.files.filter((f) => table.files.includes(f.path)).reduce((sum, f) => sum + f.bytes, 0) !==
            table.bytes
        )
          fail('结果表文件引用或长度不符');
      }
      if (actual.notebookFile && !m.files.some((f) => f.path === actual.notebookFile))
        fail('Notebook 结果文件缺失');
      const d = e.outputDatasetId && ids.get(e.outputDatasetId);
      if (
        d &&
        (!table ||
          d.manifestId !== m.id ||
          d.manifestDigest !== m.digest ||
          d.definitionDigest !== r.definitionDigest ||
          !equal(d.files, table.files) ||
          !equal(d.schema, table.schema) ||
          d.format !== table.format ||
          d.rows !== table.rows ||
          d.bytes !== table.bytes ||
          !equal(d.parents, e.inputDigests))
      )
        fail('执行输出版本与结果不一致');
    }
    if (entries.size !== expected.size || [...entries.keys()].some((k) => !expected.has(k)))
      fail('ZIP 存在未声明文件');
    const declaredSet = (actual, declared, label) => {
      unique(declared, label);
      if (!equal([...new Set(actual)].sort(), [...declared].sort())) fail(label + '不一致');
    };
    declaredSet(
      study.datasets.flatMap(({ dataset: d }) => d.parents).filter((d) => !datasets.has(d)),
      study.missingAncestors,
      '缺失祖先声明',
    );
    declaredSet(
      study.executions.map((e) => e.run.task.environment.digest),
      study.missingEnvironmentImages,
      '缺失环境镜像声明',
    );
    declaredSet(
      study.executions.map((e) => e.evidence.outputDatasetId).filter((id) => id && !ids.has(id)),
      study.missingOutputDatasets,
      '缺失输出版本声明',
    );
    const visiting = new Set(),
      visited = new Set();
    const visit = (id) => {
      if (visiting.has(id)) fail('数据父链形成循环');
      if (visited.has(id) || !datasets.has(id)) return;
      visiting.add(id);
      for (const parent of datasets.get(id).parents) visit(parent);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of datasets.keys()) visit(id);
    const archiveHash = createHash('sha256');
    for (let at = 0; at < before.size; at += CHUNK)
      archiveHash.update(await read(at, Math.min(CHUNK, before.size - at)));
    const after = await handle.stat(),
      current = await lstat(full);
    if (
      [after, current].some(
        (stat) =>
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.dev !== before.dev ||
          stat.ino !== before.ino ||
          stat.size !== before.size ||
          stat.mtimeMs !== before.mtimeMs ||
          stat.ctimeMs !== before.ctimeMs,
      )
    )
      fail('核验期间文件身份或内容改变');
    return {
      valid: true,
      format: study.type,
      schemaVersion: study.schemaVersion,
      coreDigest,
      archiveSha256: archiveHash.digest('hex'),
      bytes: before.size,
      entries: entries.size,
      datasets: study.datasets.length,
      executions: study.executions.length,
      missingAncestors: study.missingAncestors,
      missingEnvironmentImages: study.missingEnvironmentImages,
      missingOutputDatasets: study.missingOutputDatasets,
      signature: 'unsigned',
      publisherIdentity: null,
      execution: 'not-executed',
      message:
        '仅确认所含字节、声明与引用一致；未签名，无法认证发布者身份，也不证明执行结果真实或整个过程可重现。',
    };
  } finally {
    await handle.close();
  }
}
