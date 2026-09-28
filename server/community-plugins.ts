import { createHash, createPublicKey, randomUUID, verify, type KeyObject } from 'node:crypto';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { get as httpsGet } from 'node:https';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';

const pluginId = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const signature = z.string().regex(/^[A-Za-z0-9+/]{86}==$/);
const label = z.string().trim().min(1).max(120);
const publisher = z
  .object({
    fingerprint: digest,
    name: label,
    publicKey: z.string().min(100).max(1000),
    addedAt: z.number().int().positive(),
  })
  .strict();
const source = z
  .object({ id: z.uuid(), name: label, url: z.url().max(1024), addedAt: z.number().int().positive() })
  .strict();
const entry = z
  .object({
    schemaVersion: z.literal(1),
    id: pluginId,
    name: label,
    description: z.string().max(500),
    version,
    sha256: digest,
    publisher: digest,
    signature,
    wasmUrl: z.string().min(1).max(1024),
  })
  .strict();
const catalog = z.object({ schemaVersion: z.literal(1), plugins: z.array(entry).max(100) }).strict();
const installed = entry
  .omit({ wasmUrl: true })
  .extend({ sourceId: z.uuid(), installedAt: z.number().int().positive() })
  .strict();
const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    publishers: z.array(publisher).max(32),
    sources: z.array(source).max(32),
    installed: z.array(installed).max(64),
    catalogs: z.record(z.string(), z.array(entry).max(100)),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
type Entry = z.infer<typeof entry>;
const defaults = (): State => ({
  schemaVersion: 1,
  publishers: [],
  sources: [],
  installed: [],
  catalogs: {},
});
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export const communityPluginRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('trust'), name: label, publicKey: z.string().min(100).max(1000) }).strict(),
  z.object({ operation: z.literal('untrust'), fingerprint: digest }).strict(),
  z.object({ operation: z.literal('add-source'), name: label, url: z.url().max(1024) }).strict(),
  z.object({ operation: z.literal('remove-source'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('refresh'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('install'), sourceId: z.uuid(), pluginId }).strict(),
  z.object({ operation: z.literal('uninstall'), pluginId }).strict(),
  z.object({ operation: z.literal('run'), pluginId, input: z.unknown() }).strict(),
]);

function publicKey(value: string): { key: KeyObject; fingerprint: string } {
  if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(value))
    throw new AppError('只接受 Ed25519 公钥 PEM，不能上传私钥');
  let key: KeyObject;
  try {
    key = createPublicKey(value);
  } catch {
    throw new AppError('发布者公钥无效');
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new AppError('发布者公钥必须使用 Ed25519');
  return { key, fingerprint: sha256(key.export({ type: 'spki', format: 'der' })) };
}

export function signedPluginPayload(
  value: Pick<Entry, 'schemaVersion' | 'id' | 'name' | 'description' | 'version' | 'sha256' | 'publisher'>,
) {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: value.schemaVersion,
      id: value.id,
      name: value.name,
      description: value.description,
      version: value.version,
      sha256: value.sha256,
      publisher: value.publisher,
    }),
    'utf8',
  );
}

function validateSource(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash)
    throw new AppError('目录源必须是无凭据的 HTTPS 地址');
  return url.href;
}

function artifactUrl(sourceUrl: string, target: string) {
  const base = new URL(sourceUrl),
    url = new URL(target, base);
  if (url.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password || url.hash)
    throw new AppError('插件文件必须位于目录源的 HTTPS 主机');
  return url.href;
}

async function download(urlText: string, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(
      urlText,
      { timeout: 10_000, headers: { accept: 'application/json, application/wasm' } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new AppError(`插件源返回 HTTP ${response.statusCode || 0}`, 502));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) request.destroy(new AppError('插件源响应超过大小上限', 413));
          else chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new AppError('插件源响应超时', 504)));
    request.on('error', reject);
  });
}

function readU32(bytes: Uint8Array, cursor: { at: number }, end: number) {
  let result = 0;
  for (let shift = 0; shift < 35; shift += 7) {
    if (cursor.at >= end) throw new AppError('WebAssembly 段长度无效');
    const byte = bytes[cursor.at++];
    if (shift === 28 && byte > 15) throw new AppError('WebAssembly 整数溢出');
    result |= (byte & 127) << shift;
    if (!(byte & 128)) return result >>> 0;
  }
  throw new AppError('WebAssembly 整数无效');
}

/** The module gets no host imports, one bounded linear memory, and no table. */
export async function validatePluginWasm(bytes: Uint8Array) {
  if (
    bytes.length < 8 ||
    bytes.length > 512 * 1024 ||
    Buffer.from(bytes.subarray(0, 8)).toString('hex') !== '0061736d01000000'
  )
    throw new AppError('需要不超过 512 KiB 的 WebAssembly v1 模块');
  const cursor = { at: 8 };
  let memories = 0;
  while (cursor.at < bytes.length) {
    const section = bytes[cursor.at++];
    const length = readU32(bytes, cursor, bytes.length);
    const end = cursor.at + length;
    if (end > bytes.length) throw new AppError('WebAssembly 段长度无效');
    if (section === 4 && readU32(bytes, cursor, end) > 0) throw new AppError('隔离插件不能声明函数表');
    if (section === 5) {
      memories = readU32(bytes, cursor, end);
      if (memories !== 1) throw new AppError('隔离插件必须声明一个内存');
      const flags = readU32(bytes, cursor, end);
      const min = readU32(bytes, cursor, end);
      const max = readU32(bytes, cursor, end);
      if (flags !== 1 || min > max || max > 256)
        throw new AppError('隔离插件内存必须声明不超过 16 MiB 的上限');
    }
    cursor.at = end;
  }
  if (memories !== 1) throw new AppError('隔离插件必须声明有上限的内存');
  let module: WebAssembly.Module;
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  try {
    module = await WebAssembly.compile(copy);
  } catch {
    throw new AppError('WebAssembly 模块无法编译');
  }
  if (WebAssembly.Module.imports(module).length) throw new AppError('隔离插件不能导入宿主函数或内存');
  const exports = WebAssembly.Module.exports(module);
  for (const name of ['memory', 'alloc', 'run'])
    if (
      !exports.some((item) => item.name === name && item.kind === (name === 'memory' ? 'memory' : 'function'))
    )
      throw new AppError(`隔离插件缺少 ${name} 导出`);
}

const workerSource = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const module = await WebAssembly.compile(workerData.wasm);
  const instance = await WebAssembly.instantiate(module, {});
  const { memory, alloc, run } = instance.exports;
  if (!(memory instanceof WebAssembly.Memory) || typeof alloc !== 'function' || typeof run !== 'function')
    throw new Error('Invalid plugin exports');
  const input = Buffer.from(JSON.stringify(workerData.input));
  const ptr = alloc(input.length);
  if (!Number.isInteger(ptr) || ptr < 0 || ptr + input.length > memory.buffer.byteLength)
    throw new Error('Invalid input pointer');
  new Uint8Array(memory.buffer).set(input, ptr);
  const outputPtr = run(ptr, input.length);
  if (!Number.isInteger(outputPtr) || outputPtr < 0 || outputPtr + 4 > memory.buffer.byteLength)
    throw new Error('Invalid output pointer');
  const size = new DataView(memory.buffer).getUint32(outputPtr, true);
  if (size > 65536 || outputPtr + 4 + size > memory.buffer.byteLength)
    throw new Error('Invalid output length');
  const result = JSON.parse(Buffer.from(memory.buffer, outputPtr + 4, size).toString('utf8'));
  parentPort.postMessage({ ok: true, result });
})().catch((error) => parentPort.postMessage({ ok: false, error: String(error.message || error) }));
`;

export class CommunityPlugins {
  private state: State = defaults();
  private writes: Promise<unknown> = Promise.resolve();
  private running = new Map<string, Set<Worker>>();
  private problems: Record<string, string> = {};
  private inFlight = 0;
  private closed = false;
  constructor(
    private file = join(DATA, 'community-plugins.json'),
    private directory = join(DATA, 'community-plugins'),
    private fetchBytes = download,
    private now = Date.now,
  ) {}

  async init() {
    this.state = stateSchema.parse(await readStore(this.file, defaults));
    if (
      new Set(this.state.publishers.map((item) => item.fingerprint)).size !== this.state.publishers.length ||
      new Set(this.state.sources.map((item) => item.id)).size !== this.state.sources.length ||
      new Set(this.state.installed.map((item) => item.id)).size !== this.state.installed.length
    )
      throw new AppError('第三方插件目录包含重复记录', 503);
    for (const trusted of this.state.publishers)
      if (publicKey(trusted.publicKey).fingerprint !== trusted.fingerprint)
        throw new AppError('第三方插件发布者指纹无效', 503);
    for (const item of this.state.installed) {
      const bytes = await readFile(this.wasmFile(item)).catch(() => null);
      if (!bytes || sha256(bytes) !== item.sha256) this.problems[item.id] = '插件文件损坏或丢失';
      const signer = this.state.publishers.find((trusted) => trusted.fingerprint === item.publisher);
      if (
        !signer ||
        !verify(
          null,
          signedPluginPayload(item),
          publicKey(signer.publicKey).key,
          Buffer.from(item.signature, 'base64'),
        )
      )
        this.problems[item.id] = '插件签名或发布者信任无效';
    }
  }

  private wasmFile(item: Pick<Entry, 'id' | 'version' | 'sha256'>) {
    return join(this.directory, `${item.id}-${item.version}-${item.sha256}.wasm`);
  }
  private serial<T>(work: () => Promise<T>) {
    const task = this.writes
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new AppError('插件市场正在关闭', 503);
        return work();
      });
    this.writes = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  private async save(next: State) {
    await writeStore(this.file, next);
    this.state = next;
  }
  view() {
    return {
      publishers: this.state.publishers.map(({ publicKey: _, ...item }) => item),
      sources: this.state.sources,
      installed: this.state.installed,
      catalogs: this.state.catalogs,
      problems: this.problems,
    };
  }

  async action(raw: unknown) {
    const input = communityPluginRequest.parse(raw);
    if (input.operation === 'run') return this.run(input.pluginId, input.input);
    return this.serial(async () => {
      const next = structuredClone(this.state);
      if (input.operation === 'trust') {
        const { fingerprint } = publicKey(input.publicKey);
        if (next.publishers.some((item) => item.fingerprint === fingerprint))
          throw new AppError('此发布者已经受信任', 409);
        if (next.publishers.length >= 32) throw new AppError('发布者数量已达上限', 409);
        next.publishers.push({
          fingerprint,
          name: input.name,
          publicKey: input.publicKey,
          addedAt: this.now(),
        });
      } else if (input.operation === 'untrust') {
        if (next.installed.some((item) => item.publisher === input.fingerprint))
          throw new AppError('请先卸载此发布者的插件', 409);
        next.publishers = next.publishers.filter((item) => item.fingerprint !== input.fingerprint);
      } else if (input.operation === 'add-source') {
        const url = validateSource(input.url);
        if (next.sources.some((item) => item.url === url)) throw new AppError('目录源已存在', 409);
        if (next.sources.length >= 32) throw new AppError('目录源数量已达上限', 409);
        next.sources.push({ id: randomUUID(), name: input.name, url, addedAt: this.now() });
      } else if (input.operation === 'remove-source') {
        next.sources = next.sources.filter((item) => item.id !== input.id);
        delete next.catalogs[input.id];
      } else if (input.operation === 'refresh') {
        const source = next.sources.find((item) => item.id === input.id);
        if (!source) throw new AppError('目录源不存在', 404);
        const response = await this.fetchBytes(source.url, 256 * 1024);
        let parsed: unknown;
        try {
          parsed = JSON.parse(response.toString('utf8'));
        } catch {
          throw new AppError('插件目录不是有效 JSON', 502);
        }
        const listing = catalog.parse(parsed);
        if (new Set(listing.plugins.map((item) => item.id)).size !== listing.plugins.length)
          throw new AppError('插件目录包含重复标识', 502);
        for (const item of listing.plugins) artifactUrl(source.url, item.wasmUrl);
        next.catalogs[source.id] = listing.plugins;
      } else if (input.operation === 'install') {
        const source = next.sources.find((item) => item.id === input.sourceId);
        const item = next.catalogs[input.sourceId]?.find((item) => item.id === input.pluginId);
        if (!source || !item) throw new AppError('请先刷新目录并选择插件', 404);
        const signer = next.publishers.find((trusted) => trusted.fingerprint === item.publisher);
        if (!signer) throw new AppError('发布者未受信任', 403);
        const bytes = await this.fetchBytes(artifactUrl(source.url, item.wasmUrl), 512 * 1024);
        if (sha256(bytes) !== item.sha256) throw new AppError('插件文件 SHA-256 不匹配', 409);
        if (
          !verify(
            null,
            signedPluginPayload(item),
            publicKey(signer.publicKey).key,
            Buffer.from(item.signature, 'base64'),
          )
        )
          throw new AppError('插件签名验证失败', 409);
        await validatePluginWasm(bytes);
        await mkdir(this.directory, { recursive: true });
        const target = this.wasmFile(item);
        await writeFile(target, bytes, { flag: 'wx', mode: 0o600 }).catch(
          async (error: NodeJS.ErrnoException) => {
            if (error.code !== 'EEXIST' || sha256(await readFile(target)) !== item.sha256) throw error;
          },
        );
        const old = next.installed.find((installed) => installed.id === item.id);
        const { wasmUrl: _, ...signed } = item;
        next.installed = [
          ...next.installed.filter((installed) => installed.id !== item.id),
          { ...signed, sourceId: source.id, installedAt: this.now() },
        ];
        if (next.installed.length > 64) throw new AppError('已安装插件数量已达上限', 409);
        await this.save(next);
        delete this.problems[item.id];
        if (old && this.wasmFile(old) !== target) await rm(this.wasmFile(old), { force: true });
        return this.view();
      } else if (input.operation === 'uninstall') {
        const old = next.installed.find((item) => item.id === input.pluginId);
        if (!old) throw new AppError('插件未安装', 404);
        next.installed = next.installed.filter((item) => item.id !== input.pluginId);
        await this.save(next);
        delete this.problems[input.pluginId];
        await Promise.all([...(this.running.get(input.pluginId) || [])].map((worker) => worker.terminate()));
        await rm(this.wasmFile(old), { force: true });
        return this.view();
      }
      await this.save(next);
      return this.view();
    });
  }

  private async run(id: string, input: unknown) {
    if (this.closed) throw new AppError('插件市场正在关闭', 503);
    if (this.inFlight >= 4) throw new AppError('隔离插件执行队列已满', 429);
    this.inFlight++;
    try {
      const item = this.state.installed.find((value) => value.id === id);
      if (!item) throw new AppError('插件未安装', 404);
      const payload = JSON.stringify(input);
      if (payload === undefined || Buffer.byteLength(payload) > 32 * 1024)
        throw new AppError('插件输入必须是小于 32 KiB 的 JSON', 400);
      const bytes = await readFile(this.wasmFile(item));
      if (sha256(bytes) !== item.sha256) throw new AppError('插件文件 SHA-256 不匹配', 409);
      const signer = this.state.publishers.find((trusted) => trusted.fingerprint === item.publisher);
      if (
        !signer ||
        !verify(
          null,
          signedPluginPayload(item),
          publicKey(signer.publicKey).key,
          Buffer.from(item.signature, 'base64'),
        )
      )
        throw new AppError('插件签名或发布者信任无效', 409);
      await validatePluginWasm(bytes);
      if (this.closed) throw new AppError('插件市场正在关闭', 503);
      if (
        !this.state.installed.some(
          (current) =>
            current.id === id && current.version === item.version && current.sha256 === item.sha256,
        )
      )
        throw new AppError('插件在执行前已被卸载或更新', 409);
      return await new Promise<{ result: unknown; pluginId: string; version: string }>((resolve, reject) => {
        const worker = new Worker(workerSource, {
          eval: true,
          workerData: { wasm: bytes, input },
          resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 1 },
        });
        const active = this.running.get(id) || new Set<Worker>();
        active.add(worker);
        this.running.set(id, active);
        let done = false;
        const finish = (error?: Error, result?: unknown) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          active.delete(worker);
          if (!active.size) this.running.delete(id);
          void worker.terminate();
          if (error) reject(error);
          else resolve({ pluginId: id, version: item.version, result });
        };
        const timer = setTimeout(() => finish(new AppError('插件执行超过 1 秒', 408)), 1000);
        worker.once('message', (message: { ok: boolean; result?: unknown; error?: string }) =>
          message.ok
            ? finish(undefined, message.result)
            : finish(new AppError(`插件执行失败：${message.error || '未知错误'}`, 409)),
        );
        worker.once('error', (error) => finish(error));
        worker.once('exit', () => finish(new AppError('插件执行已终止', 409)));
      });
    } finally {
      this.inFlight--;
    }
  }

  async close() {
    this.closed = true;
    await this.writes;
    await Promise.all(
      [...this.running.values()].flatMap((set) => [...set]).map((worker) => worker.terminate()),
    );
    this.running.clear();
  }
}
