/**
 * 模块职责：校验、安装并执行社区 WASM 扩展，管理签名、路由及可恢复的原资源清理。
 * Module purpose: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
 */
import { networkFor } from './network/index.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
import { createHash, createPublicKey, randomUUID, verify, type KeyObject } from 'node:crypto';
import { readFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';

import { join } from 'node:path';
import { computeRuntime } from './compute-runtime.ts';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { PluginDirectory } from './plugin-directory.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { withPluginAuthority } from './plugin-authority.ts';
import { readStore, writeStore } from './local-store.ts';
import { eventSchema } from './webhooks.ts';
import { webhookTypes, type WebhookEvent } from '../shared/webhooks.ts';

const { httpsGet } = networkFor('core:community-plugins');

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
const extensionField = z
  .object({ key: extensionId, label, type: z.enum(['text', 'number', 'boolean']), required: z.boolean() })
  .strict();
const extensionPanel = z
  .object({
    id: extensionId,
    title: label,
    description: z.string().max(200),
    routeId: extensionId,
    fields: z.array(extensionField).max(8),
  })
  .strict();
/**
 * 入口 / Entry: callback@56.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.object().strict().superRefine）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.object().strict().superRefine).
 * 输入 / Inputs: value; context
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `context.addIssue`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const extensions = z
  .object({ routes: z.array(extensionRoute).max(8), panels: z.array(extensionPanel).max(4) })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.routes.map((item) => item.id)).size !== value.routes.length)
      context.addIssue({ code: 'custom', path: ['routes'], message: '扩展路由不能重复' });
    if (new Set(value.panels.map((item) => item.id)).size !== value.panels.length)
      context.addIssue({ code: 'custom', path: ['panels'], message: '扩展面板不能重复' });
    for (const [index, panel] of value.panels.entries()) {
      if (!value.routes.some((route) => route.id === panel.routeId))
        context.addIssue({
          code: 'custom',
          path: ['panels', index, 'routeId'],
          message: '扩展面板必须引用已声明的路由',
        });
      if (new Set(panel.fields.map((field) => field.key)).size !== panel.fields.length)
        context.addIssue({
          code: 'custom',
          path: ['panels', index, 'fields'],
          message: '扩展表单字段不能重复',
        });
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
  .extend({
    sourceId: z.uuid(),
    installedAt: z.number().int().positive(),
    phase: z.enum(['running', 'draining', 'cleanup-pending']).optional(),
    generation: z.uuid().optional(),
  })
  .strict();
const subscribedTypes = z
  .array(z.enum(webhookTypes))
  .min(1)
  .max(2)
  .refine((values) => new Set(values).size === values.length, '事件类型不能重复');
const subscription = z
  .object({
    pluginId,
    types: subscribedTypes,
    enabled: z.boolean(),
    activeSince: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
const schedule = z
  .object({
    pluginId,
    intervalMinutes: z.number().int().min(1).max(1440),
    enabled: z.boolean(),
    nextRunAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
const timerEvent = z
  .object({ id: digest, type: z.literal('plugin.timer'), occurredAt: z.iso.datetime(), tags: z.tuple([]) })
  .strict();
const delivery = z
  .object({
    id: digest,
    pluginId,
    event: z.union([eventSchema, timerEvent]),
    status: z.enum(['pending', 'done', 'failed']),
    processedAt: z.number().int().nonnegative().optional(),
    error: z.string().max(300).optional(),
    resultPreview: z.string().max(8192).optional(),
  })
  .strict();
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
/**
 * 入口 / Entry: defaults.
 * 功能：从当前输入或状态计算 `({ schemaVersion: 1, publishers: [], sources: [], installed: [], catalogs: {}, subscriptions: [], schedules: [], deliveries: …`，供调用方后续验证或使用。
 * Purpose: Computes `({ schemaVersion: 1, publishers: [], sources: [], installed: [], catalogs: {}, subscriptions: [], schedules: [], deliveries: …` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: State；结果来自 / values from `({ schemaVersion: 1, publishers: [], sources: [], installed: [], catalogs: {}, subscriptions: [], schedules: [], deliveries: …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
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
/**
 * 入口 / Entry: sha256.
 * 功能：在校验、安装并执行社区 WASM 扩展中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(bytes).digest('hex')` 供上层消费（`community-plugins.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `community-plugins.ts`; this entry produces `createHash('sha256').update(bytes).digest('hex')` for its caller. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: bytes: Uint8Array
 * 输出 / Returns: `createHash('sha256').update(bytes).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/**
 * 入口 / Entry: confirmComputations.
 * 功能：在校验、安装并执行社区 WASM 扩展中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`community-plugins.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `community-plugins.ts`; the calls and state transitions below complete the operation. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
 * 处理：通过 `Promise.allSettled` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `Promise.allSettled`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: tasks: Promise<unknown>[]
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `result.status === 'rejected' && result.reason instanceof AppError && result.reason.code === 'COMPUTE_CLEANUP_PENDING'`; 异常 / errors `result.reason`.
 */
async function confirmComputations(tasks: Promise<unknown>[]) {
  const results = await Promise.allSettled(tasks);
  for (const result of results)
    if (
      result.status === 'rejected' &&
      result.reason instanceof AppError &&
      result.reason.code === 'COMPUTE_CLEANUP_PENDING'
    )
      throw result.reason;
}

export const communityPluginRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('trust'), name: label, publicKey: z.string().min(100).max(1000) }).strict(),
  z.object({ operation: z.literal('untrust'), fingerprint: digest }).strict(),
  z.object({ operation: z.literal('add-source'), name: label, url: z.url().max(1024) }).strict(),
  z.object({ operation: z.literal('remove-source'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('refresh'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('install'), sourceId: z.uuid(), pluginId }).strict(),
  z.object({ operation: z.literal('uninstall'), pluginId }).strict(),
  z.object({ operation: z.literal('run'), pluginId, input: z.unknown() }).strict(),
  z
    .object({ operation: z.literal('subscribe'), pluginId, types: subscribedTypes, enabled: z.boolean() })
    .strict(),
  z.object({ operation: z.literal('unsubscribe'), pluginId }).strict(),
  z
    .object({
      operation: z.literal('schedule'),
      pluginId,
      intervalMinutes: z.number().int().min(1).max(1440),
      enabled: z.boolean(),
    })
    .strict(),
  z.object({ operation: z.literal('unschedule'), pluginId }).strict(),
]);

/**
 * 入口 / Entry: publicKey.
 * 功能：在校验、安装并执行社区 WASM 扩展中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ key, fingerprint: sha256(key.export({ type: 'spki', format: 'der' })) }` 供上层消费（`community-plugins.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `community-plugins.ts`; this entry produces `{ key, fingerprint: sha256(key.export({ type: 'spki', format: 'der' })) }` for its caller. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
 * 处理：通过 `inline.test`, `createPublicKey`, `sha256`, `key.export` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`, `createPublicKey`, `sha256`, `key.export`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: string
 * 输出 / Returns: { key: KeyObject; fingerprint: string }；结果来自 / values from `{ key, fingerprint: sha256(key.export({ type: 'spki', format: 'der' })) }`.
 * 副作用 / Effects: `createPublicKey`; 更新 / updates `key`.
 * 拒绝 / Refusals: 条件 / conditions `!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(value)`; `key.asymmetricKeyType !== 'ed25519'`; 异常 / errors `new AppError('只接受 Ed25519 公钥 PEM，不能上传私钥')`; `new AppError('发布者公钥无效')`.
 * 失败处理：catch 分支执行 `throw new AppError('发布者公钥无效');`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `throw new AppError('发布者公钥无效');`; these statements determine whether a failure is absorbed or rejected again.
 */
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

/**
 * 入口 / Entry: signedPluginPayload.
 * 功能：从当前输入或状态计算 `Buffer.from( JSON.stringify({ schemaVersion: value.schemaVersion, id: value.id, name: value.name, description: value.descript…`，供调用方后续验证或使用。
 * Purpose: Computes `Buffer.from( JSON.stringify({ schemaVersion: value.schemaVersion, id: value.id, name: value.name, description: value.descript…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: Pick< Entry, 'schemaVersion' | 'id' | 'name' | 'description' | 'version' | 'sha256' |…
 * 输出 / Returns: `Buffer.from( JSON.stringify({ schemaVersion: value.schemaVersion, id: value.id, name: value.name, description: value.descript…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function signedPluginPayload(
  value: Pick<
    Entry,
    'schemaVersion' | 'id' | 'name' | 'description' | 'version' | 'sha256' | 'publisher' | 'extensions'
  >,
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

/**
 * 入口 / Entry: validateSource.
 * 功能：在校验、安装并执行社区 WASM 扩展中，核对调用资格、输入或资源归属；本入口产生 `url.href` 供上层消费（`community-plugins.ts`）。
 * Purpose: Checks admission, input or resource ownership in `community-plugins.ts`; this entry produces `url.href` for its caller. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `url.href`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash`; 异常 / errors `new AppError('目录源必须是无凭据的 HTTPS 地址')`.
 */
function validateSource(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash)
    throw new AppError('目录源必须是无凭据的 HTTPS 地址');
  return url.href;
}

/**
 * 入口 / Entry: artifactUrl.
 * 功能：在校验、安装并执行社区 WASM 扩展中，执行此领域的具体处理步骤并返回其结果；本入口产生 `url.href` 供上层消费（`community-plugins.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `community-plugins.ts`; this entry produces `url.href` for its caller. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
 * 输入 / Inputs: sourceUrl: string; target: string
 * 输出 / Returns: `url.href`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `url.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password || url.hash`; 异常 / errors `new AppError('插件文件必须位于目录源的 HTTPS 主机')`.
 */
function artifactUrl(sourceUrl: string, target: string) {
  const base = new URL(sourceUrl),
    url = new URL(target, base);
  if (url.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password || url.hash)
    throw new AppError('插件文件必须位于目录源的 HTTPS 主机');
  return url.href;
}

/**
 * 入口 / Entry: download.
 * 功能：从当前输入或状态计算 `new Promise((resolve, reject) => { const request = httpsGet( urlText, { timeout: 10_000, headers: { accept: 'application/json…`，供调用方后续验证或使用。
 * Purpose: Computes `new Promise((resolve, reject) => { const request = httpsGet( urlText, { timeout: 10_000, headers: { accept: 'application/json…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: urlText: string; limit: number
 * 输出 / Returns: Promise<Buffer>；结果来自 / values from `new Promise((resolve, reject) => { const request = httpsGet( urlText, { timeout: 10_000, headers: { accept: 'application/json…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
async function download(urlText: string, limit: number): Promise<Buffer> {
  /**
   * 入口 / Entry: download.callback@249.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: resolve; reject
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `request.on`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  return new Promise((resolve, reject) => {
    /**
     * 入口 / Entry: download.callback@253.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（httpsGet）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (httpsGet).
     * 输入 / Inputs: response
     * 输出 / Returns: `void`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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

/**
 * 入口 / Entry: readU32.
 * 功能：在校验、安装并执行社区 WASM 扩展中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `result >>> 0` 供上层消费（`community-plugins.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `community-plugins.ts`; this entry produces `result >>> 0` for its caller. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
 * 分支 / Branches: `!(byte & 128)`.
 * 输入 / Inputs: bytes: Uint8Array; cursor: { at: number }; end: number
 * 输出 / Returns: `result >>> 0`.
 * 副作用 / Effects: 更新 / updates `shift`, `result`.
 * 拒绝 / Refusals: 条件 / conditions `cursor.at >= end`; `shift === 28 && byte > 15`; 异常 / errors `new AppError('WebAssembly 段长度无效')`; `new AppError('WebAssembly 整数溢出')`.
 */
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
/**
 * 入口 / Entry: validatePluginWasm.
 * 功能：在校验、安装并执行社区 WASM 扩展中，核对调用资格、输入或资源归属；处理结果记录到 `cursor.at`（`community-plugins.ts`）。
 * Purpose: Checks admission, input or resource ownership in `community-plugins.ts`; the outcome is recorded in `cursor.at`. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
 * 处理：通过 `bytes.subarray`, `readU32`, `copy.set`, `WebAssembly.compile` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `bytes.subarray`, `readU32`, `copy.set`, `WebAssembly.compile`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: bytes: Uint8Array
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `copy.set`; 更新 / updates `memories`, `cursor.at`, `module`.
 * 拒绝 / Refusals: 条件 / conditions `bytes.length < 8 || bytes.length > 512 * 1024 || Buffer.from(bytes.subarray(0, 8)).toString('hex') !== '0061736d01000000'`; `end > bytes.length`; `section === 4 && readU32(bytes, cursor, end) > 0`; 异常 / errors `new AppError('需要不超过 512 KiB 的 WebAssembly v1 模块')`; `new AppError('WebAssembly 段长度无效')`.
 * 失败处理：catch 分支执行 `throw new AppError('WebAssembly 模块无法编译');`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `throw new AppError('WebAssembly 模块无法编译');`; these statements determine whether a failure is absorbed or rejected again.
 */
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
  private running = new Map<string, Set<{ abort: AbortController; done: Promise<unknown> }>>();
  private problems: Record<string, string> = {};
  private inFlight = 0;
  /**
   * 入口 / Entry: CommunityPlugins.source.
   * 功能：向调用者提供 `this.dependencies.events` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.dependencies.events` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.dependencies.events`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private get source() {
    return this.dependencies.events;
  }
  private timer?: ScheduleHandle;
  private pending?: Promise<void>;
  private eventError?: string;
  /**
   * 入口 / Entry: CommunityPlugins.blocked.
   * 功能：从当前输入或状态计算 `this.dependencies.blocked?.() || false`，供调用方后续验证或使用。
   * Purpose: Computes `this.dependencies.blocked?.() || false` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.dependencies.blocked?.() || false`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private blocked = () => this.dependencies.blocked?.() || false;
  /**
   * 入口 / Entry: CommunityPlugins.mutation.
   * 功能：把本层请求转交 `this.dependencies.mutation`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.dependencies.mutation` and propagates the provider result or rejection.
   * 输入 / Inputs: delta: number
   * 输出 / Returns: `this.dependencies.mutation?.(delta)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private mutation = (delta: number) => this.dependencies.mutation?.(delta);
  private closed = false;
  /**
   * 入口 / Entry: CommunityPlugins.constructor.
   * 功能：建立 CommunityPlugins 的校验、安装并执行社区 WASM 扩展上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the CommunityPlugins context for this module's responsibility: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: file: default=join(DATA, 'community-plugins.json'); directory: default=join(DATA, 'community-plugins'); fetchBytes: default=download; now: default=Date.now; pluginDirectory: default=new PluginDirectory(); dependencies: { events?: () => Promise<WebhookEvent[]>; schedule?: boolean; blocked?: () => boolean… default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private file = join(DATA, 'community-plugins.json'),
    private directory = join(DATA, 'community-plugins'),
    private fetchBytes = download,
    private now = Date.now,
    readonly pluginDirectory = new PluginDirectory(),
    private dependencies: {
      /**
       * 签名 / Signature: CommunityPlugins.constructor.events.
       * 功能：为校验、安装并执行社区 WASM 扩展声明 events 的输入与结果契约，所属容器为 CommunityPlugins.constructor。
       * Purpose: Declares the input/result contract for events in CommunityPlugins.constructor. Module responsibility: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: Promise<WebhookEvent[]>.
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      events?: () => Promise<WebhookEvent[]>;
      schedule?: boolean;
      /**
       * 签名 / Signature: CommunityPlugins.constructor.blocked.
       * 功能：为校验、安装并执行社区 WASM 扩展声明 blocked 的输入与结果契约，所属容器为 CommunityPlugins.constructor。
       * Purpose: Declares the input/result contract for blocked in CommunityPlugins.constructor. Module responsibility: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: boolean.
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      blocked?: () => boolean;
      /**
       * 签名 / Signature: CommunityPlugins.constructor.mutation.
       * 功能：为校验、安装并执行社区 WASM 扩展声明 mutation 的输入与结果契约，所属容器为 CommunityPlugins.constructor。
       * Purpose: Declares the input/result contract for mutation in CommunityPlugins.constructor. Module responsibility: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
       * 输入 / Inputs: delta: number
       * 输出 / Returns: void.
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      mutation?: (delta: number) => void;
    } = {},
  ) {}

  /**
   * 入口 / Entry: CommunityPlugins.init.
   * 功能：在校验、安装并执行社区 WASM 扩展中，初始化并核对当前领域状态；处理结果记录到 `this.state`, `instance.phase`, `this.problems[item.id]`（`CommunityPlugins`）。
   * Purpose: Initializes and verifies current domain state in `CommunityPlugins`; the outcome is recorded in `this.state`, `instance.phase`, `this.problems[item.id]`. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
   * 处理：通过 `stat().catch`, `stat`, `info.isFile`, `stateSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stat().catch`, `stat`, `info.isFile`, `stateSchema.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `item.phase && item.phase !== 'running'`; `!bytes || sha256(bytes) !== item.sha256`; `!signer || !verify( null, signedPluginPayload(item), publicKey(signer.publicKey).key, Buffer.from(it…`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.state.publishers.map`; `this.state.installed.map`; `this.state.publishers.find`; `this.publish`; `this.pluginDirectory.setDesired`; 更新 / updates `this.state`, `instance.phase`, `this.problems[item.id]`, `instance.error`.
   * 拒绝 / Refusals: 条件 / conditions `info && (!info.isFile() || info.size > 8 * 1024 ** 2)`; `new Set(this.state.publishers.map((item) => item.fingerprint)).size !== this.state.publishers.length || new Set(this.state.so…`; `publicKey(trusted.publicKey).fingerprint !== trusted.fingerprint`; 异常 / errors `new AppError('第三方插件记录类型或大小无效', 503)`; `new AppError('第三方插件目录包含重复记录', 503)`.
   */
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
      new Set(this.state.subscriptions.map((item) => item.pluginId)).size !==
        this.state.subscriptions.length ||
      this.state.subscriptions.some(
        (item) => !this.state.installed.some((installed) => installed.id === item.pluginId),
      ) ||
      new Set(this.state.schedules.map((item) => item.pluginId)).size !== this.state.schedules.length ||
      this.state.schedules.some(
        (item) => !this.state.installed.some((installed) => installed.id === item.pluginId),
      ) ||
      new Set(this.state.deliveries.map((item) => item.id)).size !== this.state.deliveries.length ||
      Object.keys(this.state.observed).length > 20000
    )
      throw new AppError('第三方插件目录包含重复记录', 503);
    for (const trusted of this.state.publishers)
      if (publicKey(trusted.publicKey).fingerprint !== trusted.fingerprint)
        throw new AppError('第三方插件发布者指纹无效', 503);
    for (const item of this.state.installed) {
      const instance = this.pluginDirectory.begin(
        'community',
        item.id,
        item.version,
        item.sha256,
        ['compute'],
        item.phase && item.phase !== 'running' ? item.generation : undefined,
      );
      if (item.phase && item.phase !== 'running') instance.phase = 'cleanup-pending';
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
      if (this.problems[item.id]) {
        instance.error = this.problems[item.id];
        if (instance.phase !== 'cleanup-pending') {
          await instance.scope.dispose();
          instance.phase = 'failed';
        }
      } else if (instance.phase !== 'cleanup-pending') this.publish(instance, item);
    }
    this.pluginDirectory.setDesired(
      'community',
      this.state.installed.map((item) => item.id),
    );
    if (this.source && this.dependencies.schedule !== false) this.startEvents();
  }

  /**
   * 入口 / Entry: CommunityPlugins.wasmFile.
   * 功能：把本层请求转交 `join`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `join` and propagates the provider result or rejection.
   * 输入 / Inputs: item: Pick<Entry, 'id' | 'version' | 'sha256'>
   * 输出 / Returns: `join(this.directory, `${item.id}-${item.version}-${item.sha256}.wasm`)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private wasmFile(item: Pick<Entry, 'id' | 'version' | 'sha256'>) {
    return join(this.directory, `${item.id}-${item.version}-${item.sha256}.wasm`);
  }
  /**
   * 入口 / Entry: CommunityPlugins.publish.
   * 功能：在校验、安装并执行社区 WASM 扩展中，校验并提交领域状态变更；完成下述调用及状态处理（`CommunityPlugins`）。
   * Purpose: Validates and commits a domain state change in `CommunityPlugins`; the calls and state transitions below complete the operation. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
   * 处理：通过 `instance.contribute`, `this.pluginDirectory.publish` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `instance.contribute`, `this.pluginDirectory.publish`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: instance: PluginInstance; item: Pick<Entry, 'id' | 'extensions'>
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.pluginDirectory.publish`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private publish(instance: PluginInstance, item: Pick<Entry, 'id' | 'extensions'>) {
    for (const panel of item.extensions?.panels || []) instance.contribute('panel', panel.id);
    for (const route of item.extensions?.routes || [])
      instance.contribute('http', `/api/community-plugins/extensions/${item.id}/${route.id}`);
    instance.contribute('event', item.id);
    instance.contribute('schedule', item.id);
    this.pluginDirectory.publish(instance);
  }
  /**
   * 入口 / Entry: CommunityPlugins.removeArtifact.
   * 功能：在校验、安装并执行社区 WASM 扩展中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`CommunityPlugins`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `CommunityPlugins`; the calls and state transitions below complete the operation. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
   * 处理：通过 `this.wasmFile`, `readFile().catch`, `readFile`, `rm` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.wasmFile`, `readFile().catch`, `readFile`, `rm`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: item: Pick<Entry, 'id' | 'version' | 'sha256'>; commit: () => Promise<void>
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `rm`; `writeFile`.
   * 拒绝 / Refusals: 条件 / conditions `original`; `(restore as NodeJS.ErrnoException).code !== 'EEXIST'`; 异常 / errors `new AggregateError([error, restore], '原插件产物恢复未完成')`; `error`.
   * 失败处理：catch 分支执行 `if (original) try { await writeFile(file, original, { flag: 'wx', mode: 0o600 }); } catch (restore) { if ((restore as NodeJS.…`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (original) try { await writeFile(file, original, { flag: 'wx', mode: 0o600 }); } catch (restore) { if ((restore as NodeJS.…`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async removeArtifact(item: Pick<Entry, 'id' | 'version' | 'sha256'>, commit: () => Promise<void>) {
    const file = this.wasmFile(item);
    const original = await readFile(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    try {
      await rm(file, { force: true });
      await commit();
    } catch (error) {
      if (original)
        try {
          await writeFile(file, original, { flag: 'wx', mode: 0o600 });
        } catch (restore) {
          if ((restore as NodeJS.ErrnoException).code !== 'EEXIST')
            throw new AggregateError([error, restore], '原插件产物恢复未完成');
        }
      throw error;
    }
  }
  /**
   * 入口 / Entry: CommunityPlugins.retire.
   * 功能：在校验、安装并执行社区 WASM 扩展中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `retiring.installed.find((current) => current.id === item.id)!.phase`, `retiring.installed.find((current) => current.id === item.id)!.generation`, `instance.phase`（`CommunityPlugins`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `CommunityPlugins`; the outcome is recorded in `retiring.installed.find((current) => current.id === item.id)!.phase`, `retiring.installed.find((current) => current.id === item.id)!.generation`, `instance.phase`. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
   * 处理：通过 `this.pluginDirectory.get`, `instance.revoke`, `this.pluginDirectory.changed`, `structuredClone` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pluginDirectory.get`, `instance.revoke`, `this.pluginDirectory.changed`, `structuredClone`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: item: State['installed'][number]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `retiring.installed.find`; `this.save`; `task.abort.abort`; `failed.installed.find`; `this.save().catch`; 更新 / updates `retiring.installed.find((current) => current.id === item.id)!.phase`, `retiring.installed.find((current) => current.id === item.id)!.generation`, `instance.phase`, `instance.error`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `instance.phase = 'cleanup-pending';`; `instance.error = String(error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `instance.phase = 'cleanup-pending';`; `instance.error = String(error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async retire(item: State['installed'][number]) {
    const instance = this.pluginDirectory.get('community', item.id)!;
    instance.revoke();
    this.pluginDirectory.changed();
    const retiring = structuredClone(this.state);
    retiring.installed.find((current) => current.id === item.id)!.phase = 'draining';
    retiring.installed.find((current) => current.id === item.id)!.generation = instance.generation;
    try {
      await this.save(retiring);
      const active = [...(this.running.get(item.id) || [])];
      for (const task of active) task.abort.abort(new DOMException('插件退出中', 'AbortError'));
      await confirmComputations(active.map((task) => task.done));
      await computeRuntime.recover(instance);
      await instance.scope.dispose();
      instance.phase = 'inactive';
      this.pluginDirectory.changed();
    } catch (error) {
      instance.phase = 'cleanup-pending';
      instance.error = String(error);
      instance.scope.cleanupPending(error);
      this.pluginDirectory.changed();
      const failed = structuredClone(this.state);
      failed.installed.find((current) => current.id === item.id)!.phase = 'cleanup-pending';
      await this.save(failed).catch(() => {});
      throw error;
    }
  }
  /**
   * 入口 / Entry: CommunityPlugins.pendingCleanup.
   * 功能：在校验、安装并执行社区 WASM 扩展中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `instance.phase`, `instance.error`, `item.phase`（`CommunityPlugins`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `CommunityPlugins`; the outcome is recorded in `instance.phase`, `instance.error`, `item.phase`. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
   * 处理：通过 `this.pluginDirectory.get`, `this.pluginDirectory.changed`, `structuredClone`, `next.installed.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pluginDirectory.get`, `this.pluginDirectory.changed`, `structuredClone`, `next.installed.find`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `item`.
   * 输入 / Inputs: id: string; error: unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `next.installed.find`; `this.save().catch`; `this.save`; 更新 / updates `instance.phase`, `instance.error`, `item.phase`, `item.generation`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async pendingCleanup(id: string, error: unknown) {
    const instance = this.pluginDirectory.get('community', id)!;
    instance.phase = 'cleanup-pending';
    instance.error = String(error);
    this.pluginDirectory.changed();
    const next = structuredClone(this.state),
      item = next.installed.find((item) => item.id === id);
    if (item) {
      item.phase = 'cleanup-pending';
      item.generation = instance.generation;
    }
    await this.save(next).catch(() => {
      this.state = next;
    });
  }
  /**
   * 入口 / Entry: CommunityPlugins.serial.
   * 功能：在校验、安装并执行社区 WASM 扩展中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`CommunityPlugins`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `CommunityPlugins`; this entry produces `task` for its caller. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch`, `task.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`, `task.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `task`.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
  /**
   * 入口 / Entry: CommunityPlugins.save.
   * 功能：在校验、安装并执行社区 WASM 扩展中，校验并提交领域状态变更；处理结果记录到 `this.state`（`CommunityPlugins`）。
   * Purpose: Validates and commits a domain state change in `CommunityPlugins`; the outcome is recorded in `this.state`. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
   * 处理：通过 `writeStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `writeStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: next: State
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(next: State) {
    await writeStore(this.file, next);
    this.state = next;
  }
  /**
   * 入口 / Entry: CommunityPlugins.view.
   * 功能：在校验、安装并执行社区 WASM 扩展中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ publishers: this.state.publishers.map(({ publicKey: _, ...item }) => item), sources: this.state.sources, installed: this.st…` 供上层消费（`CommunityPlugins`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `CommunityPlugins`; this entry produces `{ publishers: this.state.publishers.map(({ publicKey: _, ...item }) => item), sources: this.state.sources, installed: this.st…` for its caller. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
   * 处理：通过 `this.state.publishers.map`, `this.state.deliveries.slice().reverse`, `this.state.deliveries.slice`, `this.pluginDirectory.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.state.publishers.map`, `this.state.deliveries.slice().reverse`, `this.state.deliveries.slice`, `this.pluginDirectory.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ publishers: this.state.publishers.map(({ publicKey: _, ...item }) => item), sources: this.state.sources, installed: this.st…`.
   * 副作用 / Effects: `this.state.publishers.map`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
      runtime: this.pluginDirectory.view(),
    };
  }

  /**
   * 入口 / Entry: CommunityPlugins.startEvents.
   * 功能：在校验、安装并执行社区 WASM 扩展中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.timer`（`CommunityPlugins`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `CommunityPlugins`; the outcome is recorded in `this.timer`. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
   * 处理：通过 `scheduler.register` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `scheduler.register`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private startEvents() {
    this.timer = scheduler.register({
      owner: 'core:community-plugins',
      label: '社区插件事件与计划任务',
      intervalMs: 5000,
      immediate: true,
      overlap: 'skip',
      backoff: { initialMs: 5000, maxMs: 60000 },
      /**
       * 入口 / Entry: CommunityPlugins.startEvents.run.
       * 功能：在校验、安装并执行社区 WASM 扩展中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`CommunityPlugins`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `CommunityPlugins`; the calls and state transitions below complete the operation. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
       * 处理：通过 `this.tick` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.tick`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `this.eventError`; 异常 / errors `new AppError(this.eventError, 503)`.
       */
      run: async () => {
        await this.tick();
        if (this.eventError) throw new AppError(this.eventError, 503);
      },
    });
  }

  /**
   * 入口 / Entry: CommunityPlugins.recoverCleanup.
   * 功能：在校验、安装并执行社区 WASM 扩展中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`CommunityPlugins`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `CommunityPlugins`; the calls and state transitions below complete the operation. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
   * 处理：通过 `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; generation: string
   * 输出 / Returns: Promise<void>.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async recoverCleanup(id: string, generation: string): Promise<void> {
    /**
     * 入口 / Entry: CommunityPlugins.recoverCleanup.callback@572.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.state.installed.find`; `next.installed.find`; `this.save`.
     * 拒绝 / Refusals: 条件 / conditions `!instance || !item || instance.generation !== generation || instance.phase !== 'cleanup-pending'`; 异常 / errors `new AppError('原社区插件恢复票据已变化', 409, 'RECOVERY_STALE')`.
     */
    await this.serial(async () => {
      const instance = this.pluginDirectory.get('community', id);
      const item = this.state.installed.find(entry => entry.id === id);
      if (!instance || !item || instance.generation !== generation || instance.phase !== 'cleanup-pending')
        throw new AppError('原社区插件恢复票据已变化', 409, 'RECOVERY_STALE');
      await this.retire(item);
      const next = structuredClone(this.state);
      const saved = next.installed.find(entry => entry.id === id)!;
      delete saved.phase;
      delete saved.generation;
      await this.save(next);
    });
  }

  /**
   * 入口 / Entry: CommunityPlugins.action.
   * 功能：执行扩展的安装、授权、启停、撤销或移除，验证签名和 WASM 运行边界。
   * Purpose: Installs/grants/enables/revokes/removes community extensions under signature and WASM runtime boundaries.
   * 设计：持久声明与受管运行分开提交；原实例清理未确认时保留票据，避免覆盖旧资源或扩大扩展权限。
   * Design: Durable declarations and managed runtime publication are separate; pending original cleanup retains tickets instead of replacing resources or widening grants.
   * 输入 / Inputs: raw: unknown
   * 输出 / Returns: `this.run(input.pluginId, input.input)`; `this.serial(async () => { const next = structuredClone(this.state); if (input.operation === 'trust') { const { fingerprint } …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async action(raw: unknown) {
    const input = communityPluginRequest.parse(raw);
    if (input.operation === 'run') return this.run(input.pluginId, input.input);
    /**
     * 入口 / Entry: CommunityPlugins.action.callback@589.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view()`.
     * 副作用 / Effects: `next.publishers.some`; `next.publishers.push`; `next.installed.some`; `next.publishers.filter`; `next.sources.push`; 更新 / updates `next.publishers`, `next.sources`, `parsed`, `next.catalogs[source.id]`.
     * 拒绝 / Refusals: 条件 / conditions `input.operation === 'trust'`; `next.publishers.some((item) => item.fingerprint === fingerprint)`; `next.publishers.length >= 32`; 异常 / errors `new AppError('此发布者已经受信任', 409)`; `new AppError('发布者数量已达上限', 409)`.
     * 失败处理：catch 分支执行 `throw new AppError('插件目录不是有效 JSON', 502);`; `if (old) await this.pendingCleanup(old.id, error);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `throw new AppError('插件目录不是有效 JSON', 502);`; `if (old) await this.pendingCleanup(old.id, error);`; these statements determine whether a failure is absorbed or rejected again.
     */
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
        const previous = next.installed.find((current) => current.id === item.id);
        if (
          previous &&
          ((previous.phase && previous.phase !== 'running') ||
            this.pluginDirectory.get('community', item.id)?.phase !== 'running')
        )
          throw new AppError('原插件清理尚未完成，请先重试卸载', 409, 'PLUGIN_CLEANUP_PENDING');
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
        if (old) await this.retire(old);
        const { wasmUrl: _, ...signed } = item;
        next.installed = [
          ...next.installed.filter((installed) => installed.id !== item.id),
          { ...signed, sourceId: source.id, installedAt: this.now() },
        ];
        if (next.installed.length > 64) throw new AppError('已安装插件数量已达上限', 409);
        try {
          if (old && this.wasmFile(old) !== target) await this.removeArtifact(old, () => this.save(next));
          else await this.save(next);
        } catch (error) {
          if (old) await this.pendingCleanup(old.id, error);
          throw error;
        }
        delete this.problems[item.id];
        const instance = this.pluginDirectory.begin('community', item.id, item.version, item.sha256, [
          'compute',
        ]);
        this.pluginDirectory.setDesired(
          'community',
          next.installed.map((current) => current.id),
        );
        this.publish(instance, item);
        return this.view();
      } else if (input.operation === 'uninstall') {
        const old = next.installed.find((item) => item.id === input.pluginId);
        if (!old) throw new AppError('插件未安装', 404);
        await this.retire(old);
        next.installed = next.installed.filter((item) => item.id !== input.pluginId);
        next.subscriptions = next.subscriptions.filter((item) => item.pluginId !== input.pluginId);
        next.schedules = next.schedules.filter((item) => item.pluginId !== input.pluginId);
        for (const item of next.deliveries)
          if (item.pluginId === input.pluginId && item.status === 'pending') {
            item.status = 'failed';
            item.processedAt = this.now();
            item.error = '插件已卸载';
          }
        try {
          await this.removeArtifact(old, () => this.save(next));
        } catch (error) {
          await this.pendingCleanup(old.id, error);
          throw error;
        }
        delete this.problems[input.pluginId];
        this.pluginDirectory.setDesired(
          'community',
          next.installed.map((current) => current.id),
        );
        return this.view();
      } else if (input.operation === 'subscribe') {
        if (!next.installed.some((item) => item.id === input.pluginId))
          throw new AppError('请先安装插件', 404);
        const current = next.subscriptions.findIndex((item) => item.pluginId === input.pluginId);
        if (current < 0 && next.subscriptions.length >= 64) throw new AppError('事件订阅数量已达上限', 409);
        const value = {
          pluginId: input.pluginId,
          types: input.types,
          enabled: input.enabled,
          activeSince: this.now(),
          updatedAt: this.now(),
        };
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
        if (current < 0 && next.schedules.length >= 64) throw new AppError('定时触发数量已达上限', 409);
        const value = {
          pluginId: input.pluginId,
          intervalMinutes: input.intervalMinutes,
          enabled: input.enabled,
          nextRunAt: this.now() + input.intervalMinutes * 60000,
          updatedAt: this.now(),
        };
        if (current < 0) next.schedules.push(value);
        else next.schedules[current] = value;
        if (!input.enabled)
          for (const item of next.deliveries)
            if (
              item.pluginId === input.pluginId &&
              item.event.type === 'plugin.timer' &&
              item.status === 'pending'
            ) {
              item.status = 'failed';
              item.processedAt = this.now();
              item.error = '定时触发已暂停';
            }
      } else if (input.operation === 'unschedule') {
        if (!next.schedules.some((item) => item.pluginId === input.pluginId))
          throw new AppError('插件尚无定时触发', 404);
        next.schedules = next.schedules.filter((item) => item.pluginId !== input.pluginId);
        for (const item of next.deliveries)
          if (
            item.pluginId === input.pluginId &&
            item.event.type === 'plugin.timer' &&
            item.status === 'pending'
          ) {
            item.status = 'failed';
            item.processedAt = this.now();
            item.error = '定时触发已移除';
          }
      }
      await this.save(next);
      return this.view();
    });
  }

  /**
   * 入口 / Entry: CommunityPlugins.invokeRoute.
   * 功能：在校验、安装并执行社区 WASM 扩展中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.run(id, { kind: 'http', routeId, body })` 供上层消费（`CommunityPlugins`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `CommunityPlugins`; this entry produces `this.run(id, { kind: 'http', routeId, body })` for its caller. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
   * 处理：通过 `pluginId.parse`, `extensionId.parse`, `this.state.installed.find`, `item.extensions.routes.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `pluginId.parse`, `extensionId.parse`, `this.state.installed.find`, `item.extensions.routes.some`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: rawPluginId: string; rawRouteId: string; body: unknown
   * 输出 / Returns: `this.run(id, { kind: 'http', routeId, body })`.
   * 副作用 / Effects: `this.state.installed.find`.
   * 拒绝 / Refusals: 条件 / conditions `!item?.extensions?.routes.some((route) => route.id === routeId)`; 异常 / errors `new AppError('签名插件未声明此 HTTP 操作', 404)`.
   */
  async invokeRoute(rawPluginId: string, rawRouteId: string, body: unknown) {
    const id = pluginId.parse(rawPluginId);
    const routeId = extensionId.parse(rawRouteId);
    const item = this.state.installed.find((candidate) => candidate.id === id);
    if (!item?.extensions?.routes.some((route) => route.id === routeId))
      throw new AppError('签名插件未声明此 HTTP 操作', 404);
    return this.run(id, { kind: 'http', routeId, body });
  }

  /**
   * 入口 / Entry: CommunityPlugins.tick.
   * 功能：在校验、安装并执行社区 WASM 扩展中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` / `this.pending` 供上层消费（`CommunityPlugins`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `CommunityPlugins`; this entry produces `void` / `this.pending` for its caller. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
   * 处理：通过 `this.blocked`, `this.mutation`, `this.deliverEvents().then().finally`, `this.deliverEvents().then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.mutation`, `this.deliverEvents().then().finally`, `this.deliverEvents().then`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || !this.source || this.blocked()`; `this.pending`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`; `this.pending`; `task`.
   * 副作用 / Effects: 更新 / updates `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async tick() {
    if (this.closed || !this.source || this.blocked()) return;
    if (this.pending) return this.pending;
    this.mutation(1);
    const task = this.deliverEvents()
      .then(
        (sourceError) => {
          this.eventError = sourceError;
        },
        (error) => {
          this.eventError = String((error as Error).message || error).slice(0, 300);
        },
      )
      .finally(() => {
        if (this.pending === task) this.pending = undefined;
        this.mutation(-1);
      });
    this.pending = task;
    return task;
  }

  /**
   * 入口 / Entry: CommunityPlugins.deliverEvents.
   * 功能：筛选并向允许接收事件的运行扩展投递有界事件，记录执行结果。
   * Purpose: Filters and delivers bounded events to eligible running extensions and records outcomes.
   * 设计：投递遵循当前授权、去重与超时，扩展失败只更新自身记录，不把未确认执行伪报成功。
   * Design: Delivery follows current grants, deduplication and deadlines; extension failure updates its own evidence without claiming unconfirmed success.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`; `sourceError`.
   * 副作用 / Effects: `fetched.slice().flatMap().sort`; `fetched.slice().flatMap`; `fetched.slice`; 更新 / updates `fetched`, `sourceError`, `resultPreview`, `status`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `sourceError = String((error as Error).message || error).slice(0, 300);`; `status = 'failed';`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `sourceError = String((error as Error).message || error).slice(0, 300);`; `status = 'failed';`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async deliverEvents() {
    let fetched: WebhookEvent[] = [];
    let sourceError: string | undefined;
    try {
      fetched = await this.source!();
    } catch (error) {
      sourceError = String((error as Error).message || error).slice(0, 300);
    }
    const events = fetched
      .slice(-500)
      .flatMap((item) => {
        const parsed = eventSchema.safeParse(item);
        return parsed.success && parsed.data.type !== 'test' ? [parsed.data] : [];
      })
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    /**
     * 入口 / Entry: CommunityPlugins.deliverEvents.callback@825.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `selected`.
     * 副作用 / Effects: `next.deliveries.push`; `selected.push`; `this.save`; 更新 / updates `next.deliveries`, `schedule.nextRunAt`, `next.observed[id]`.
     * 拒绝 / Refusals: 条件 / conditions `Object.keys(next.observed).length >= 20000`; 异常 / errors `new AppError('插件事件去重窗口已满，请稍后重试', 409)`.
     */
    const tasks = await this.serial(async () => {
      const next = structuredClone(this.state);
      const now = this.now();
      for (const [key, at] of Object.entries(next.observed))
        if (at < now - 48 * 3600000) delete next.observed[key];
      const pending = next.deliveries.filter((item) => item.status === 'pending');
      const historyRoom = Math.max(0, 192 - pending.length);
      next.deliveries = [
        ...(historyRoom
          ? next.deliveries.filter((item) => item.status !== 'pending').slice(-historyRoom)
          : []),
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
        const event = {
          id,
          type: 'plugin.timer' as const,
          occurredAt: new Date(scheduledAt).toISOString(),
          tags: [] as [],
        };
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
          if (
            !subscription.enabled ||
            !subscription.types.includes(event.type) ||
            Date.parse(event.occurredAt) <= subscription.activeSince ||
            Date.parse(event.occurredAt) < now - 24 * 3600000 ||
            Date.parse(event.occurredAt) > now + 5 * 60000
          )
            continue;
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
        const output = await this.run(
          task.pluginId,
          task.event.type === 'plugin.timer'
            ? { kind: 'schedule', scheduledAt: task.event.occurredAt }
            : { kind: 'event', event: task.event },
        );
        resultPreview = JSON.stringify(output.result).slice(0, 8192);
      } catch (failure) {
        status = 'failed';
        error = String((failure as Error).message || failure).slice(0, 300);
      }
      /**
       * 入口 / Entry: CommunityPlugins.deliverEvents.callback@901.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `this.save`; 更新 / updates `record.status`, `record.processedAt`, `record.error`, `record.resultPreview`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
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

  /**
   * 入口 / Entry: CommunityPlugins.run.
   * 功能：在校验、安装并执行社区 WASM 扩展中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ pluginId: id, version: item.version, result: await done }` 供上层消费（`CommunityPlugins`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `CommunityPlugins`; this entry produces `{ pluginId: id, version: item.version, result: await done }` for its caller. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
   * 处理：通过 `this.state.installed.find`, `this.pluginDirectory.get`, `instance.check`, `withPluginAuthority` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.state.installed.find`, `this.pluginDirectory.get`, `instance.check`, `withPluginAuthority`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!active.size`.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `{ pluginId: id, version: item.version, result: await done }`.
   * 副作用 / Effects: `this.state.installed.find`; `active.add`; `this.running.set`; `active.delete`; `this.running.delete`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.inFlight >= 4`; `!item`; 异常 / errors `new AppError('插件市场正在关闭', 503)`; `new AppError('隔离插件执行队列已满', 429)`.
   * 收尾：退出 try 区域时始终执行 `this.inFlight--;`; `active.delete(task);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.inFlight--;`; `active.delete(task);`; these steps also apply to exceptional exits.
   */
  private async run(id: string, input: unknown) {
    if (this.closed) throw new AppError('插件市场正在关闭', 503);
    if (this.inFlight >= 4) throw new AppError('隔离插件执行队列已满', 429);
    this.inFlight++;
    try {
      const item = this.state.installed.find((value) => value.id === id);
      if (!item) throw new AppError('插件未安装', 404);
      const instance = this.pluginDirectory.get('community', id)!;
      instance.check('compute');
      const payload = JSON.stringify(input);
      if (payload === undefined || Buffer.byteLength(payload) > 32 * 1024)
        throw new AppError('插件输入必须是小于 32 KiB 的 JSON', 400);
      const abort = new AbortController();
      /**
       * 入口 / Entry: CommunityPlugins.run.callback@938.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（computeRuntime.run）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (computeRuntime.run).
       * 输入 / Inputs: signal
       * 输出 / Returns: `{ source: workerSource, options: { eval: true, workerData: { wasm: bytes, input: JSON.parse(payload) }, resourceLimits: { max…`.
       * 副作用 / Effects: `this.state.publishers.find`; `this.state.publishers.some`; `this.state.installed.some`.
       * 拒绝 / Refusals: 条件 / conditions `sha256(bytes) !== item.sha256`; `!signer || !verify( null, signedPluginPayload(item), publicKey(signer.publicKey).key, Buffer.from(item.signature, 'base64'), …`; `this.closed`; 异常 / errors `new AppError('插件文件 SHA-256 不匹配', 409)`; `new AppError('插件签名或发布者信任无效', 409)`.
       */
      const done = withPluginAuthority(instance, () =>
        computeRuntime.run<unknown>(
          {
            owner: instance.owner,
            label: '隔离插件计算',
            memoryBytes: 48 * 1024 ** 2,
            timeoutMs: 1000,
            signal: abort.signal,
            partition: { key: `community:${id}`, limit: 2 },
          },
          /**
           * 中文功能：读取 WASM 并验证 SHA-256、可信发布者签名和模块格式，再复核未关闭、信任未撤销且安装版本未变化，返回受限 worker 配置。
           * English: Reads WASM, checks SHA-256, trusted-publisher signature and module format, rechecks closure/trust/installed-version state and returns resource-limited worker configuration.
           * 所属 / Owner: CommunityPlugins.run.done.
           * 输入 / Inputs: signal.
           */
          async (signal) => {
            const bytes = await readFile(this.wasmFile(item), { signal });
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
              !this.state.publishers.some(
                (trusted) =>
                  trusted.fingerprint === signer.fingerprint && trusted.publicKey === signer.publicKey,
              )
            )
              throw new AppError('插件发布者信任已撤销', 409);
            if (
              !this.state.installed.some(
                (current) =>
                  current.id === id && current.version === item.version && current.sha256 === item.sha256,
              )
            )
              throw new AppError('插件在执行前已被卸载或更新', 409);
            return {
              source: workerSource,
              options: {
                eval: true,
                workerData: { wasm: bytes, input: JSON.parse(payload) },
                resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 1 },
              },
            };
          },
        ),
      );
      const active = this.running.get(id) || new Set<{ abort: AbortController; done: Promise<unknown> }>();
      const task = { abort, done };
      active.add(task);
      this.running.set(id, active);
      try {
        return { pluginId: id, version: item.version, result: await done };
      } finally {
        active.delete(task);
        if (!active.size) this.running.delete(id);
      }
    } finally {
      this.inFlight--;
    }
  }

  /**
   * 入口 / Entry: CommunityPlugins.close.
   * 功能：在校验、安装并执行社区 WASM 扩展中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`, `instance.phase`（`CommunityPlugins`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `CommunityPlugins`; the outcome is recorded in `this.closed`, `instance.phase`. Module context: Validates, installs and executes signed community WASM extensions, managing routes and recoverable cleanup ownership.
   * 处理：通过 `work`, `failures.push`, `inline.flatMap`, `this.running.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `work`, `failures.push`, `inline.flatMap`, `this.running.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `failures.push`; `task.abort.abort`; 更新 / updates `this.closed`, `instance.phase`.
   * 拒绝 / Refusals: 条件 / conditions `failures.length`; 异常 / errors `new AggregateError(failures, '社区插件清理未完成')`.
   * 失败处理：catch 分支执行 `failures.push(error);`; `await this.pendingCleanup(instance.pluginId, error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `failures.push(error);`; `await this.pendingCleanup(instance.pluginId, error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async close() {
    this.closed = true;
    const failures: unknown[] = [];
    for (const work of [() => this.timer?.close(), () => this.pending, () => this.writes]) {
      try {
        await work();
      } catch (error) {
        failures.push(error);
      }
    }
    const active = [...this.running.values()].flatMap((set) => [...set]);
    for (const task of active) task.abort.abort(new AppError('插件市场正在关闭', 503));
    for (const instance of this.pluginDirectory.all().filter((item) => item.source === 'community'))
      instance.revoke();
    try {
      await confirmComputations(active.map((task) => task.done));
    } catch (error) {
      failures.push(error);
    }
    for (const instance of this.pluginDirectory.all().filter((item) => item.source === 'community')) {
      try {
        await computeRuntime.recover(instance);
        await instance.scope.dispose();
        instance.phase = 'inactive';
      } catch (error) {
        await this.pendingCleanup(instance.pluginId, error);
        failures.push(error);
      }
    }
    this.pluginDirectory.changed();
    if (failures.length) throw new AggregateError(failures, '社区插件清理未完成');
  }
}
