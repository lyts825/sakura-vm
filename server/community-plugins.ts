import { createHash, createPublicKey, randomUUID, verify, type KeyObject } from 'node:crypto';
import { readFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { get as httpsGet } from 'node:https';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import { eventSchema } from './webhooks.ts';
import { webhookTypes, type WebhookEvent } from '../shared/webhooks.ts';

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
const extensionId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const extensionRoute = z.object({ id: extensionId, name: label }).strict();
const extensionField = z.object({ key: extensionId, label,
  type: z.enum(['text', 'number', 'boolean']), required: z.boolean() }).strict();
const extensionPanel = z.object({ id: extensionId, title: label,
  description: z.string().max(200), routeId: extensionId,
  fields: z.array(extensionField).max(8) }).strict();
const extensions = z.object({ routes: z.array(extensionRoute).max(8),
  panels: z.array(extensionPanel).max(4) }).strict().superRefine((value, context) => {
  if (new Set(value.routes.map((item) => item.id)).size !== value.routes.length)
    context.addIssue({ code: 'custom', path: ['routes'], message: '扩展路由不能重复' });
  if (new Set(value.panels.map((item) => item.id)).size !== value.panels.length)
    context.addIssue({ code: 'custom', path: ['panels'], message: '扩展面板不能重复' });
  for (const [index, panel] of value.panels.entries()) {
    if (!value.routes.some((route) => route.id === panel.routeId))
      context.addIssue({ code: 'custom', path: ['panels', index, 'routeId'],
        message: '扩展面板必须引用已声明的路由' });
    if (new Set(panel.fields.map((field) => field.key)).size !== panel.fields.length)
      context.addIssue({ code: 'custom', path: ['panels', index, 'fields'],
        message: '扩展表单字段不能重复' });
  }
});
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
    extensions: extensions.optional(),
  })
  .strict();
const catalog = z.object({ schemaVersion: z.literal(1), plugins: z.array(entry).max(100) }).strict();
const installed = entry
  .omit({ wasmUrl: true })
  .extend({ sourceId: z.uuid(), installedAt: z.number().int().positive() })
  .strict();
const subscribedTypes = z.array(z.enum(webhookTypes)).min(1).max(2)
  .refine((values) => new Set(values).size === values.length, '事件类型不能重复');
const subscription = z.object({ pluginId, types: subscribedTypes, enabled: z.boolean(),
  activeSince: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative() }).strict();
const schedule = z.object({ pluginId, intervalMinutes: z.number().int().min(1).max(1440),
  enabled: z.boolean(), nextRunAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative() }).strict();
const timerEvent = z.object({ id: digest, type: z.literal('plugin.timer'),
  occurredAt: z.iso.datetime(), tags: z.tuple([]) }).strict();
const delivery = z.object({ id: digest, pluginId, event: z.union([eventSchema, timerEvent]),
  status: z.enum(['pending', 'done', 'failed']),
  processedAt: z.number().int().nonnegative().optional(),
  error: z.string().max(300).optional(), resultPreview: z.string().max(8192).optional() }).strict();
const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    publishers: z.array(publisher).max(32),
    sources: z.array(source).max(32),
    installed: z.array(installed).max(64),
    catalogs: z.record(z.string(), z.array(entry).max(100)),
    subscriptions: z.array(subscription).max(64).default([]),
    schedules: z.array(schedule).max(64).default([]),
    deliveries: z.array(delivery).max(200).default([]),
    observed: z.record(digest, z.number().int().nonnegative()).default({}),
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
  subscriptions: [],
  schedules: [],
  deliveries: [],
  observed: {},
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
  z.object({ operation: z.literal('subscribe'), pluginId, types: subscribedTypes,
    enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('unsubscribe'), pluginId }).strict(),
  z.object({ operation: z.literal('schedule'), pluginId,
    intervalMinutes: z.number().int().min(1).max(1440), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('unschedule'), pluginId }).strict(),
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
  value: Pick<Entry, 'schemaVersion' | 'id' | 'name' | 'description' | 'version' | 'sha256' | 'publisher' | 'extensions'>,
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
      ...(value.extensions ? { extensions: value.extensions } : {}),
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
  private source?: () => Promise<WebhookEvent[]>;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private eventError?: string;
  private blocked = () => false;
  private mutation = (_delta: number) => {};
  private closed = false;
  constructor(
    private file = join(DATA, 'community-plugins.json'),
    private directory = join(DATA, 'community-plugins'),
    private fetchBytes = download,
    private now = Date.now,
  ) {}

  async init() {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 8 * 1024 ** 2))
      throw new AppError('第三方插件记录类型或大小无效', 503);
    this.state = stateSchema.parse(await readStore(this.file, defaults));
    if (
      new Set(this.state.publishers.map((item) => item.fingerprint)).size !== this.state.publishers.length ||
      new Set(this.state.sources.map((item) => item.id)).size !== this.state.sources.length ||
      new Set(this.state.installed.map((item) => item.id)).size !== this.state.installed.length ||
      new Set(this.state.subscriptions.map((item) => item.pluginId)).size !== this.state.subscriptions.length ||
      this.state.subscriptions.some((item) =>
        !this.state.installed.some((installed) => installed.id === item.pluginId)) ||
      new Set(this.state.schedules.map((item) => item.pluginId)).size !== this.state.schedules.length ||
      this.state.schedules.some((item) =>
        !this.state.installed.some((installed) => installed.id === item.pluginId)) ||
      new Set(this.state.deliveries.map((item) => item.id)).size !== this.state.deliveries.length ||
      Object.keys(this.state.observed).length > 20000
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
      subscriptions: this.state.subscriptions,
      schedules: this.state.schedules,
      deliveries: this.state.deliveries.slice(-40).reverse(),
      eventError: this.eventError,
    };
  }

  setEventSource(source: () => Promise<WebhookEvent[]>, schedule = true,
    blocked: () => boolean = () => false, mutation: (delta: number) => void = () => {}) {
    if (this.closed) throw new AppError('插件市场正在关闭', 503);
    this.source = source;
    this.blocked = blocked;
    this.mutation = mutation;
    if (this.timer) clearInterval(this.timer);
    if (schedule) {
      this.timer = setInterval(() => void this.tick(), 5000);
      this.timer.unref();
      void this.tick();
    }
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
        next.subscriptions = next.subscriptions.filter((item) => item.pluginId !== input.pluginId);
        next.schedules = next.schedules.filter((item) => item.pluginId !== input.pluginId);
        for (const item of next.deliveries)
          if (item.pluginId === input.pluginId && item.status === 'pending') {
            item.status = 'failed';
            item.processedAt = this.now();
            item.error = '插件已卸载';
          }
        await this.save(next);
        delete this.problems[input.pluginId];
        await Promise.all([...(this.running.get(input.pluginId) || [])].map((worker) => worker.terminate()));
        await rm(this.wasmFile(old), { force: true });
        return this.view();
      } else if (input.operation === 'subscribe') {
        if (!next.installed.some((item) => item.id === input.pluginId))
          throw new AppError('请先安装插件', 404);
        const current = next.subscriptions.findIndex((item) => item.pluginId === input.pluginId);
        if (current < 0 && next.subscriptions.length >= 64)
          throw new AppError('事件订阅数量已达上限', 409);
        const value = { pluginId: input.pluginId, types: input.types, enabled: input.enabled,
          activeSince: this.now(), updatedAt: this.now() };
        if (current < 0) next.subscriptions.push(value);
        else next.subscriptions[current] = value;
      } else if (input.operation === 'unsubscribe') {
        if (!next.subscriptions.some((item) => item.pluginId === input.pluginId))
          throw new AppError('插件尚未订阅事件', 404);
        next.subscriptions = next.subscriptions.filter((item) => item.pluginId !== input.pluginId);
        for (const item of next.deliveries)
          if (item.pluginId === input.pluginId && item.status === 'pending') {
            item.status = 'failed';
            item.processedAt = this.now();
            item.error = '事件订阅已移除';
          }
      } else if (input.operation === 'schedule') {
        if (!next.installed.some((item) => item.id === input.pluginId))
          throw new AppError('请先安装插件', 404);
        const current = next.schedules.findIndex((item) => item.pluginId === input.pluginId);
        if (current < 0 && next.schedules.length >= 64)
          throw new AppError('定时触发数量已达上限', 409);
        const value = { pluginId: input.pluginId, intervalMinutes: input.intervalMinutes,
          enabled: input.enabled, nextRunAt: this.now() + input.intervalMinutes * 60000,
          updatedAt: this.now() };
        if (current < 0) next.schedules.push(value);
        else next.schedules[current] = value;
        if (!input.enabled)
          for (const item of next.deliveries)
            if (item.pluginId === input.pluginId && item.event.type === 'plugin.timer' &&
                item.status === 'pending') {
              item.status = 'failed';
              item.processedAt = this.now();
              item.error = '定时触发已暂停';
            }
      } else if (input.operation === 'unschedule') {
        if (!next.schedules.some((item) => item.pluginId === input.pluginId))
          throw new AppError('插件尚无定时触发', 404);
        next.schedules = next.schedules.filter((item) => item.pluginId !== input.pluginId);
        for (const item of next.deliveries)
          if (item.pluginId === input.pluginId && item.event.type === 'plugin.timer' &&
              item.status === 'pending') {
            item.status = 'failed';
            item.processedAt = this.now();
            item.error = '定时触发已移除';
          }
      }
      await this.save(next);
      return this.view();
    });
  }

  async invokeRoute(rawPluginId: string, rawRouteId: string, body: unknown) {
    const id = pluginId.parse(rawPluginId);
    const routeId = extensionId.parse(rawRouteId);
    const item = this.state.installed.find((candidate) => candidate.id === id);
    if (!item?.extensions?.routes.some((route) => route.id === routeId))
      throw new AppError('签名插件未声明此 HTTP 操作', 404);
    return this.run(id, { kind: 'http', routeId, body });
  }

  async tick() {
    if (this.closed || !this.source || this.blocked()) return;
    if (this.pending) return this.pending;
    this.mutation(1);
    const task = this.deliverEvents().then(
      (sourceError) => { this.eventError = sourceError; },
      (error) => { this.eventError = String((error as Error).message || error).slice(0, 300); },
    ).finally(() => {
      if (this.pending === task) this.pending = undefined;
      this.mutation(-1);
    });
    this.pending = task;
    return task;
  }

  private async deliverEvents() {
    let fetched: WebhookEvent[] = [];
    let sourceError: string | undefined;
    try { fetched = await this.source!(); }
    catch (error) { sourceError = String((error as Error).message || error).slice(0, 300); }
    const events = fetched.slice(-500)
      .flatMap((item) => {
        const parsed = eventSchema.safeParse(item);
        return parsed.success && parsed.data.type !== 'test' ? [parsed.data] : [];
      }).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    const tasks = await this.serial(async () => {
      const next = structuredClone(this.state);
      const now = this.now();
      for (const [key, at] of Object.entries(next.observed))
        if (at < now - 48 * 3600000) delete next.observed[key];
      const pending = next.deliveries.filter((item) => item.status === 'pending');
      const historyRoom = Math.max(0, 192 - pending.length);
      next.deliveries = [
        ...(historyRoom ? next.deliveries.filter((item) => item.status !== 'pending')
          .slice(-historyRoom) : []),
        ...pending,
      ];
      const selected = pending.slice(0, 8);
      for (const schedule of next.schedules) {
        if (selected.length >= 8 || next.deliveries.length >= 200) break;
        if (!schedule.enabled || schedule.nextRunAt > now) continue;
        const scheduledAt = schedule.nextRunAt;
        const id = sha256(Buffer.from(`${schedule.pluginId}:timer:${scheduledAt}`));
        schedule.nextRunAt = now + schedule.intervalMinutes * 60000;
        if (next.observed[id]) continue;
        if (Object.keys(next.observed).length >= 20000)
          throw new AppError('插件事件去重窗口已满，请稍后重试', 409);
        const event = { id, type: 'plugin.timer' as const,
          occurredAt: new Date(scheduledAt).toISOString(), tags: [] as [] };
        const item = { id, pluginId: schedule.pluginId, event, status: 'pending' as const };
        next.observed[id] = now;
        next.deliveries.push(item);
        selected.push(item);
      }
      for (const event of events) {
        if (event.type === 'test') continue;
        if (selected.length >= 8 || next.deliveries.length >= 200) break;
        for (const subscription of next.subscriptions) {
          if (selected.length >= 8 || next.deliveries.length >= 200) break;
          if (!subscription.enabled || !subscription.types.includes(event.type) ||
              Date.parse(event.occurredAt) <= subscription.activeSince ||
              Date.parse(event.occurredAt) < now - 24 * 3600000 ||
              Date.parse(event.occurredAt) > now + 5 * 60000) continue;
          const id = sha256(Buffer.from(`${subscription.pluginId}:${event.id}`));
          if (next.observed[id]) continue;
          if (Object.keys(next.observed).length >= 20000)
            throw new AppError('插件事件去重窗口已满，请稍后重试', 409);
          const item = { id, pluginId: subscription.pluginId, event, status: 'pending' as const };
          next.observed[id] = now;
          next.deliveries.push(item);
          selected.push(item);
        }
      }
      if (JSON.stringify(next) !== JSON.stringify(this.state)) await this.save(next);
      return selected;
    });
    for (const task of tasks) {
      if (this.closed) return;
      let status: 'done' | 'failed' = 'done';
      let resultPreview: string | undefined, error: string | undefined;
      try {
        const output = await this.run(task.pluginId, task.event.type === 'plugin.timer'
          ? { kind: 'schedule', scheduledAt: task.event.occurredAt }
          : { kind: 'event', event: task.event });
        resultPreview = JSON.stringify(output.result).slice(0, 8192);
      } catch (failure) {
        status = 'failed';
        error = String((failure as Error).message || failure).slice(0, 300);
      }
      await this.serial(async () => {
        const next = structuredClone(this.state);
        const record = next.deliveries.find((item) => item.id === task.id);
        if (!record || record.status !== 'pending') return;
        record.status = status;
        record.processedAt = this.now();
        if (error) record.error = error;
        if (resultPreview) record.resultPreview = resultPreview;
        await this.save(next);
      });
    }
    return sourceError;
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
    if (this.timer) clearInterval(this.timer);
    await this.pending;
    await this.writes;
    await Promise.all(
      [...this.running.values()].flatMap((set) => [...set]).map((worker) => worker.terminate()),
    );
    this.running.clear();
  }
}
