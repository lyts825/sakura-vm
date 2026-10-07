/**
 * 模块职责：管理移动伴侣配对和状态页面，统一处理设备授权、请求与撤销生命周期。
 * Module purpose: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation.
 */
import type { AccessControlV1 } from './service-contracts/v1.ts';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { z } from 'zod';
import { readJsonBody } from './http.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';

import type { AlertEvent } from './feature-suite.ts';

const kinds = ['cpu', 'memory', 'disk', 'service', 'backup', 'task', 'secret'] as const;
const policy = z.object({ enabled: z.boolean(), vmIds: z.array(z.uuid()).min(1).max(32)
  .refine((ids) => new Set(ids).size === ids.length),
  kinds: z.array(z.enum(kinds)).min(1).max(kinds.length)
    .refine((items) => new Set(items).size === items.length) }).strict();
const device = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(64),
  ownerId: z.uuid(), tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  policy, createdAt: z.number().int().positive(), expiresAt: z.number().int().positive(),
  lastSeenAt: z.number().int().positive().optional() }).strict();
const stateSchema = z.object({ version: z.literal(1), devices: z.array(device).max(16) }).strict();
const connectInput = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{12}$/),
  name: device.shape.name }).strict();
export const mobileAction = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('pair'), policy }).strict(),
  z.object({ operation: z.literal('policy'), id: z.uuid(), policy }).strict(),
  z.object({ operation: z.literal('revoke'), id: z.uuid() }).strict(),
]);
type Policy = z.infer<typeof policy>;
type Device = z.infer<typeof device>;
/**
 * 签名 / Signature: FeedSource.FeedSource.
 * 功能：为管理移动伴侣配对和状态页面声明 FeedSource 的输入与结果契约，所属容器为 FeedSource。
 * Purpose: Declares the input/result contract for FeedSource in FeedSource. Module responsibility: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Promise<{ vms: Array<{ id: string; name: string; status: string }>; alerts: AlertEvent[] }>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
type FeedSource = () => Promise<{ vms: Array<{ id: string; name: string; status: string }>;
  alerts: AlertEvent[] }>;
/**
 * 入口 / Entry: hash.
 * 功能：在管理移动伴侣配对和状态页面中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(text).digest('hex')` 供上层消费（`mobile-companion.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `mobile-companion.ts`; this entry produces `createHash('sha256').update(text).digest('hex')` for its caller. Module context: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: text: string
 * 输出 / Returns: `createHash('sha256').update(text).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
/**
 * 入口 / Entry: sameHash.
 * 功能：把本层请求转交 `timingSafeEqual`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `timingSafeEqual` and propagates the provider result or rejection.
 * 输入 / Inputs: left: string; right: string
 * 输出 / Returns: `timingSafeEqual( Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const sameHash = (left: string, right: string) => timingSafeEqual(
  Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
/**
 * 入口 / Entry: defaults.
 * 功能：从当前输入或状态计算 `({ version: 1 as const, devices: [] as Device[] })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: 1 as const, devices: [] as Device[] })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `({ version: 1 as const, devices: [] as Device[] })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const defaults = () => ({ version: 1 as const, devices: [] as Device[] });
const cookieName = '__Host-sakura-mobile';

const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#21182d"><title>Sakura 移动伴侣</title>
<link rel="stylesheet" href="/mobile/style.css"></head><body>
<main><header><span class="mark">✿</span><div><h1>Sakura</h1><p>移动伴侣 · 只读状态</p></div></header>
<section id="pair"><h2>连接这台 Sakura</h2><p>在电脑端生成五分钟配对码，然后在此输入。手机只会看到管理员授权的实例与告警类型。</p>
<form id="pair-form"><label>设备名称<input id="name" required maxlength="64" autocomplete="off"></label>
<label>配对码<input id="code" required minlength="12" maxlength="12" autocomplete="one-time-code"></label>
<button>连接</button></form></section>
<section id="dashboard" hidden><div class="toolbar"><h2>实例状态</h2><button id="refresh" type="button">刷新</button></div>
<p id="checked"></p><div id="vms" class="cards"></div><h2>只读告警</h2><div id="alerts" class="cards"></div>
<button id="forget" class="quiet" type="button">断开此设备</button></section>
<p id="notice" role="status"></p></main><script type="module" src="/mobile/app.js"></script></body></html>`;
const style = `:root{font-family:system-ui,-apple-system,sans-serif;color:#f5effb;background:#171120}*{box-sizing:border-box}body{margin:0}main{max-width:680px;margin:auto;padding:24px 18px 50px}header{display:flex;align-items:center;gap:16px;margin-bottom:28px}.mark{font-size:42px;color:#eab8f3}h1{font-size:26px;margin:0}h2{font-size:20px;margin:0 0 16px}p{color:#d2c7db;line-height:1.5}header p{margin:2px 0}section{background:#241b30;border:1px solid #564463;border-radius:18px;padding:20px;margin-bottom:20px}label{display:grid;gap:6px;margin:14px 0;color:#e4d6ee}input{width:100%;font:inherit;padding:12px;border-radius:10px;border:1px solid #9275a4;background:#171120;color:#fff}button{font:inherit;font-weight:650;background:#e6b7f0;color:#24152e;border:0;border-radius:10px;padding:11px 16px;min-height:44px}.quiet{background:#3a2d46;color:#eee1f5;margin-top:20px}.toolbar{display:flex;justify-content:space-between;align-items:center}.toolbar h2{margin:0}.cards{display:grid;gap:10px;margin:16px 0}.card{padding:14px;border-radius:12px;background:#34283f;border:1px solid #624e70}.card strong{display:block}.card small{color:#cbbbd4}#notice:not(:empty){padding:12px;border-radius:10px;background:#3a2d46}[hidden]{display:none!important}`;
const script = `const $=id=>document.getElementById(id);const notice=text=>{$('notice').textContent=text};
const card=(title,detail,stamp)=>{const article=document.createElement('article');article.className='card';const strong=document.createElement('strong');strong.textContent=title;const p=document.createElement('p');p.textContent=detail;article.append(strong,p);if(stamp){const small=document.createElement('small');small.textContent=stamp;article.append(small)}return article};
async function json(path,method='GET',body){const response=await fetch(path,{method,credentials:'same-origin',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw Error(data.error||'请求失败');return data}
async function refresh(){try{const feed=await json('/mobile/feed');$('pair').hidden=true;$('dashboard').hidden=false;$('vms').replaceChildren(...feed.vms.map(vm=>card(vm.name,vm.status)));$('alerts').replaceChildren(...feed.alerts.map(alert=>card(alert.vmName,alert.kind,new Date(alert.createdAt).toLocaleString())));if(!feed.vms.length)$('vms').append(card('没有授权实例','请在电脑端修改设备策略'));if(!feed.alerts.length)$('alerts').append(card('暂无告警','仅显示授权类型的最近告警'));$('checked').textContent='检查时间：'+new Date(feed.checkedAt).toLocaleString();notice('')}catch(error){$('pair').hidden=false;$('dashboard').hidden=true;notice(error.message)}}
$('pair-form').addEventListener('submit',async event=>{event.preventDefault();try{await json('/mobile/connect','POST',{name:$('name').value,code:$('code').value});$('code').value='';await refresh()}catch(error){notice(error.message)}});
$('refresh').addEventListener('click',refresh);$('forget').addEventListener('click',async()=>{try{await json('/mobile/disconnect','POST',{});$('pair').hidden=false;$('dashboard').hidden=true;notice('已断开此设备')}catch(error){notice(error.message)}});void refresh();setInterval(()=>{if(!$('dashboard').hidden)void refresh()},30000);`;

/** Owner-paired, read-only mobile web view served only through the separate HTTPS listener. */
export class MobileCompanion {
  private devices: Device[] = [];
  private pairing?: { codeHash: string; ownerId: string; policy: Policy; expiresAt: number };
  private failures = new Map<string, { count: number; blockedUntil: number }>();
  private writes = Promise.resolve();
  private closed = false;

  /**
   * 入口 / Entry: MobileCompanion.constructor.
   * 功能：建立 MobileCompanion 的管理移动伴侣配对和状态页面上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the MobileCompanion context for this module's responsibility: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: access: AccessControlV1; feedSource: FeedSource; allowed: () => void default=() => {}; file: default=join(DATA, 'mobile-companion.json'); now: default=Date.now; mutation: (delta: number) => void default=() => {}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private access: AccessControlV1, private feedSource: FeedSource,
    private allowed: () => void = () => {},
    private file = join(DATA, 'mobile-companion.json'), private now = Date.now,
    private mutation: (delta: number) => void = () => {}) {}

  /**
   * 入口 / Entry: MobileCompanion.init.
   * 功能：在管理移动伴侣配对和状态页面中，初始化并核对当前领域状态；处理结果记录到 `this.devices`（`MobileCompanion`）。
   * Purpose: Initializes and verifies current domain state in `MobileCompanion`; the outcome is recorded in `this.devices`. Module context: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation.
   * 处理：通过 `stat().catch`, `stat`, `info.isFile`, `stateSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stat().catch`, `stat`, `info.isFile`, `stateSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.devices`.
   * 拒绝 / Refusals: 条件 / conditions `info && (!info.isFile() || info.size > 1024 * 1024)`; `new Set(this.devices.map((item) => item.id)).size !== this.devices.length || new Set(this.devices.map((item) => item.tokenHas…`; 异常 / errors `new AppError('移动伴侣存储类型或大小无效', 503)`; `new AppError('移动伴侣记录重复', 503)`.
   */
  async init() {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 1024 * 1024))
      throw new AppError('移动伴侣存储类型或大小无效', 503);
    this.devices = stateSchema.parse(await readStore(this.file, defaults)).devices;
    if (new Set(this.devices.map((item) => item.id)).size !== this.devices.length ||
        new Set(this.devices.map((item) => item.tokenHash)).size !== this.devices.length)
      throw new AppError('移动伴侣记录重复', 503);
  }

  /**
   * 入口 / Entry: MobileCompanion.serial.
   * 功能：在管理移动伴侣配对和状态页面中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`MobileCompanion`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MobileCompanion`; this entry produces `task` for its caller. Module context: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch`, `task.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`, `task.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `task`.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>) {
    /**
     * 入口 / Entry: MobileCompanion.serial.callback@92.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.writes.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.writes.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `await work()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.closed`; 异常 / errors `new AppError('移动伴侣服务正在关闭', 503)`.
     * 收尾：退出 try 区域时始终执行 `this.mutation(-1);`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `this.mutation(-1);`; these steps also apply to exceptional exits.
     */
    const task = this.writes.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('移动伴侣服务正在关闭', 503);
      this.allowed();
      this.mutation(1);
      try { return await work(); }
      finally { this.mutation(-1); }
    });
    this.writes = task.then(() => {}, () => {});
    return task;
  }

  /**
   * 入口 / Entry: MobileCompanion.save.
   * 功能：在管理移动伴侣配对和状态页面中，校验并提交领域状态变更；处理结果记录到 `this.devices`（`MobileCompanion`）。
   * Purpose: Validates and commits a domain state change in `MobileCompanion`; the outcome is recorded in `this.devices`. Module context: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation.
   * 处理：通过 `writeStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `writeStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: devices: Device[]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.devices`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(devices: Device[]) {
    await writeStore(this.file, { version: 1, devices });
    this.devices = devices;
  }

  /**
   * 入口 / Entry: MobileCompanion.liveOwner.
   * 功能：在管理移动伴侣配对和状态页面中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`MobileCompanion`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MobileCompanion`; the calls and state transitions below complete the operation. Module context: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation.
   * 处理：通过 `this.access.users().some`, `this.access.users` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.access.users().some`, `this.access.users`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.access.enabled || !this.access.users().some((item) => item.id === id && item.role === 'owner')`; 异常 / errors `new AppError('管理员账户已失效', 403)`.
   */
  private liveOwner(id: string) {
    if (!this.access.enabled || !this.access.users().some((item) =>
      item.id === id && item.role === 'owner'))
      throw new AppError('管理员账户已失效', 403);
  }

  /**
   * 入口 / Entry: MobileCompanion.view.
   * 功能：在管理移动伴侣配对和状态页面中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ devices: this.devices.filter((item) => item.ownerId === ownerId) .map(({ tokenHash: _, ...item }) => ({ ...item, expired: i…` 供上层消费（`MobileCompanion`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `MobileCompanion`; this entry produces `{ devices: this.devices.filter((item) => item.ownerId === ownerId) .map(({ tokenHash: _, ...item }) => ({ ...item, expired: i…` for its caller. Module context: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation.
   * 处理：通过 `this.liveOwner`, `this.devices.filter().map`, `this.devices.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.liveOwner`, `this.devices.filter().map`, `this.devices.filter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: ownerId: string
   * 输出 / Returns: `{ devices: this.devices.filter((item) => item.ownerId === ownerId) .map(({ tokenHash: _, ...item }) => ({ ...item, expired: i…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(ownerId: string) {
    this.liveOwner(ownerId);
    return { devices: this.devices.filter((item) => item.ownerId === ownerId)
      .map(({ tokenHash: _, ...item }) => ({ ...item,
        expired: item.expiresAt <= this.now(), connected: !!item.lastSeenAt &&
          item.lastSeenAt > this.now() - 120_000 })) };
  }

  /**
   * 入口 / Entry: MobileCompanion.action.
   * 功能：在管理移动伴侣配对和状态页面中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { this.liveOwner(ownerId); if (value.operation !== 'revoke') { const available = new Set((await this.…` 供上层消费（`MobileCompanion`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MobileCompanion`; this entry produces `this.serial(async () => { this.liveOwner(ownerId); if (value.operation !== 'revoke') { const available = new Set((await this.…` for its caller. Module context: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation.
   * 处理：通过 `mobileAction.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `mobileAction.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: ownerId: string; input: unknown
   * 输出 / Returns: `this.serial(async () => { this.liveOwner(ownerId); if (value.operation !== 'revoke') { const available = new Set((await this.…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async action(ownerId: string, input: unknown) {
    const value = mobileAction.parse(input);
    /**
     * 入口 / Entry: MobileCompanion.action.callback@124.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ code, expiresAt: this.pairing.expiresAt }`; `this.view(ownerId)`.
     * 副作用 / Effects: `this.save`; 更新 / updates `this.pairing`.
     * 拒绝 / Refusals: 条件 / conditions `value.operation !== 'revoke'`; `value.policy.vmIds.some((id) => !available.has(id))`; `!item`; 异常 / errors `new AppError('只读策略包含不存在的实例', 400)`; `new AppError('移动设备不存在', 404)`.
     */
    return this.serial(async () => {
      this.liveOwner(ownerId);
      if (value.operation !== 'revoke') {
        const available = new Set((await this.feedSource()).vms.map((vm) => vm.id));
        if (value.policy.vmIds.some((id) => !available.has(id)))
          throw new AppError('只读策略包含不存在的实例', 400);
      }
      if (value.operation === 'pair') {
        const code = randomBytes(9).toString('base64url');
        this.pairing = { codeHash: hash(code), ownerId,
          policy: value.policy, expiresAt: this.now() + 5 * 60_000 };
        return { code, expiresAt: this.pairing.expiresAt };
      }
      const item = this.devices.find((entry) => entry.id === value.id &&
        entry.ownerId === ownerId);
      if (!item) throw new AppError('移动设备不存在', 404);
      if (value.operation === 'revoke') await this.save(this.devices.filter((entry) => entry.id !== item.id));
      else await this.save(this.devices.map((entry) => entry.id === item.id
        ? { ...entry, policy: value.policy } : entry));
      return this.view(ownerId);
    });
  }

  /**
   * 入口 / Entry: MobileCompanion.tokenFrom.
   * 功能：在管理移动伴侣配对和状态页面中，执行此领域的具体处理步骤并返回其结果；本入口产生 `item` 供上层消费（`MobileCompanion`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MobileCompanion`; this entry produces `item` for its caller. Module context: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation.
   * 处理：通过 `cookie.slice`, `inline.test`, `hash`, `this.devices.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `cookie.slice`, `inline.test`, `hash`, `this.devices.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: request: IncomingMessage
   * 输出 / Returns: `item`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!token || !/^[a-f0-9]{64}$/.test(token)`; `!item || item.expiresAt <= this.now()`; 异常 / errors `new AppError('设备尚未配对', 401)`; `new AppError('设备配对已过期或撤销', 401)`.
   */
  private tokenFrom(request: IncomingMessage) {
    const cookie = String(request.headers.cookie || '').split(';').map((part) => part.trim())
      .find((part) => part.startsWith(cookieName + '='));
    const token = cookie?.slice(cookieName.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new AppError('设备尚未配对', 401);
    const digest = hash(token);
    const item = this.devices.find((entry) => sameHash(entry.tokenHash, digest));
    if (!item || item.expiresAt <= this.now()) throw new AppError('设备配对已过期或撤销', 401);
    this.liveOwner(item.ownerId);
    return item;
  }

  /**
   * 入口 / Entry: MobileCompanion.checkOrigin.
   * 功能：在管理移动伴侣配对和状态页面中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`MobileCompanion`）。
   * Purpose: Checks admission, input or resource ownership in `MobileCompanion`; this entry produces `void` for its caller. Module context: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation.
   * 分支 / Branches: `origin.protocol === 'https:' && origin.host === request.headers.host && origin.pathname === '/' && !…`.
   * 输入 / Inputs: request: IncomingMessage
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `new AppError('只接受当前页面发起的请求', 403)`.
   * 失败处理：catch 分支执行 ，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute ; these statements determine whether a failure is absorbed or rejected again.
   */
  private checkOrigin(request: IncomingMessage) {
    try {
      const origin = new URL(String(request.headers.origin || ''));
      if (origin.protocol === 'https:' && origin.host === request.headers.host &&
          origin.pathname === '/' && !origin.search && !origin.hash) return;
    } catch { /* invalid Origin */ }
    throw new AppError('只接受当前页面发起的请求', 403);
  }

  /**
   * 入口 / Entry: MobileCompanion.send.
   * 功能：在管理移动伴侣配对和状态页面中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`MobileCompanion`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MobileCompanion`; the calls and state transitions below complete the operation. Module context: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation.
   * 处理：通过 `response.writeHead`, `response.end` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `response.writeHead`, `response.end`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: response: ServerResponse; data: unknown; status: default=200
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `response.writeHead`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private send(response: ServerResponse, data: unknown, status = 200) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(JSON.stringify(data));
  }

  /**
   * 入口 / Entry: MobileCompanion.handle.
   * 功能：处理移动配对页面、连接和状态请求，检查来源、限流和设备凭证。
   * Purpose: Handles mobile pairing/connection/status requests with origin, rate and device credential checks.
   * 设计：正文和失败次数有界，授权撤销后原设备请求失效；页面输出只包含该入口允许的状态。
   * Design: Bodies/attempts are bounded, revocation invalidates original device requests and pages expose only permitted state.
   * 输入 / Inputs: request: IncomingMessage; response: ServerResponse
   * 输出 / Returns: `void`; `await this.serial(async () => { const pairing = this.pairing; const valid = pairing && pairing.expiresAt > this.now() && same…`; `this.send(response, { connected: false })`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `response.writeHead`; `this.failures.delete`; `connectInput.parse`; `response.setHeader`; `this.send`; 更新 / updates `item`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `request.method === 'POST' && path === '/mobile/connect'`; `!attempt && this.failures.size >= 1024`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('配对尝试容量已满', 429)`.
   * 失败处理：catch 分支执行 `const status = error instanceof AppError ? error.status : 400;`; `if (!response.destroyed && !response.headersSent) this.send(response, { error: status >= 500 ? '移动伴侣请求失败' : (error as Error).…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `const status = error instanceof AppError ? error.status : 400;`; `if (!response.destroyed && !response.headersSent) this.send(response, { error: status >= 500 ? '移动伴侣请求失败' : (error as Error).…`; these statements determine whether a failure is absorbed or rejected again.
   */
  async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      if (this.closed) throw new AppError('服务正在关闭', 503);
      const path = new URL(request.url || '/', 'https://mobile.invalid').pathname;
      if (request.method === 'GET' && ['/mobile', '/mobile/'].includes(path)) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" });
        response.end(page); return;
      }
      if (request.method === 'GET' && (path === '/mobile/app.js' || path === '/mobile/style.css')) {
        response.writeHead(200, { 'content-type': path.endsWith('.js')
          ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        response.end(path.endsWith('.js') ? script : style); return;
      }
      this.allowed();
      if (request.method === 'POST') this.checkOrigin(request);
      if (request.method === 'POST' && path === '/mobile/connect') {
        const address = request.socket.remoteAddress || 'unknown';
        const attempt = this.failures.get(address);
        if (!attempt && this.failures.size >= 1024)
          for (const [key, value] of this.failures)
            if (value.blockedUntil <= this.now()) this.failures.delete(key);
        if (!attempt && this.failures.size >= 1024)
          throw new AppError('配对尝试容量已满', 429);
        if (attempt && attempt.blockedUntil > this.now() && attempt.count >= 5)
          throw new AppError('配对尝试过多，请稍后重试', 429);
        const input = connectInput.parse(await readJsonBody(request, 4096));
        /**
         * 入口 / Entry: MobileCompanion.handle.callback@203.
         * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
         * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `this.send(response, { connected: true, expiresAt: item.expiresAt }, 201)`.
         * 副作用 / Effects: `this.failures.set`; `this.save`; `this.failures.delete`; `response.setHeader`; `this.send`; 更新 / updates `this.pairing`.
         * 拒绝 / Refusals: 条件 / conditions `!valid`; `this.devices.filter((item) => item.expiresAt > this.now()).length >= 16`; 异常 / errors `new AppError('配对码无效或已过期', 403)`; `new AppError('最多配对 16 台移动设备', 409)`.
         */
        return await this.serial(async () => {
          const pairing = this.pairing;
          const valid = pairing && pairing.expiresAt > this.now() &&
            sameHash(hash(input.code), pairing.codeHash);
          if (!valid) {
            const count = (attempt?.blockedUntil && attempt.blockedUntil <= this.now()
              ? 0 : attempt?.count || 0) + 1;
            this.failures.set(address, { count: Math.min(5, count),
              blockedUntil: count >= 5 ? this.now() + 60_000 : 0 });
            throw new AppError('配对码无效或已过期', 403);
          }
          this.liveOwner(pairing.ownerId);
          if (this.devices.filter((item) => item.expiresAt > this.now()).length >= 16)
            throw new AppError('最多配对 16 台移动设备', 409);
          const token = randomBytes(32).toString('hex');
          const item: Device = { id: randomUUID(), name: input.name,
            ownerId: pairing.ownerId, tokenHash: hash(token), policy: pairing.policy,
            createdAt: this.now(), expiresAt: this.now() + 30 * 86_400_000 };
          await this.save([...this.devices.filter((entry) => entry.expiresAt > this.now()), item]);
          this.pairing = undefined;
          this.failures.delete(address);
          response.setHeader('set-cookie', `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${30 * 86400}`);
          return this.send(response, { connected: true, expiresAt: item.expiresAt }, 201);
        });
      }
      if (request.method === 'POST' && path === '/mobile/disconnect') {
        z.object({}).strict().parse(await readJsonBody(request, 1024));
        let item: Device | undefined;
        try { item = this.tokenFrom(request); } catch { /* clear a stale cookie too */ }
        if (item) await this.serial(async () => this.save(this.devices.filter((entry) =>
          entry.id !== item!.id)));
        response.setHeader('set-cookie', `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
        return this.send(response, { connected: false });
      }
      if (request.method === 'GET' && path === '/mobile/feed') {
        const item = this.tokenFrom(request);
        const source = await this.feedSource();
        this.allowed();
        const selected = new Set(item.policy.vmIds);
        const vms = item.policy.enabled ? source.vms.filter((vm) => selected.has(vm.id)) : [];
        const names = new Map(vms.map((vm) => [vm.id, vm.name]));
        const alerts = item.policy.enabled ? source.alerts.filter((event) =>
          selected.has(event.vmId) && item.policy.kinds.includes(event.kind))
          .slice(-40).reverse().map((event) => ({ id: event.id, kind: event.kind,
            vmName: names.get(event.vmId) || '实例', createdAt: event.createdAt,
            acknowledged: event.acknowledged })) : [];
        if (!item.lastSeenAt || item.lastSeenAt <= this.now() - 60_000) {
          const at = this.now();
          void this.serial(async () => {
            await this.save(this.devices.map((entry) => entry.id === item.id
              ? { ...entry, lastSeenAt: at } : entry));
          }).catch(() => {});
        }
        return this.send(response, { checkedAt: new Date(this.now()).toISOString(),
          expiresAt: item.expiresAt, vms, alerts });
      }
      throw new AppError('移动伴侣接口不存在', 404);
    } catch (error) {
      const status = error instanceof AppError ? error.status : 400;
      if (!response.destroyed && !response.headersSent)
        this.send(response, { error: status >= 500 ? '移动伴侣请求失败' : (error as Error).message }, status);
    }
  }

  /**
   * 入口 / Entry: MobileCompanion.revokeAll.
   * 功能：在管理移动伴侣配对和状态页面中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`MobileCompanion`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MobileCompanion`; the calls and state transitions below complete the operation. Module context: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation.
   * 处理：通过 `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async revokeAll() {
    await this.serial(async () => { await this.save([]); this.pairing = undefined; });
  }

  /**
   * 入口 / Entry: MobileCompanion.close.
   * 功能：在管理移动伴侣配对和状态页面中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`MobileCompanion`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `MobileCompanion`; the outcome is recorded in `this.closed`. Module context: Owns mobile pairing and status pages, coordinating device authorization, request handling and revocation.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   */
  async close() { this.closed = true; await this.writes; }
}
