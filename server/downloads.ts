/**
 * 模块职责：签发并消费短期下载票据，统一文件与流式下载生命周期和待下载容量限制。
 * Module purpose: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles.
 */
import type { BundlesV1, FilesV1 } from './service-contracts/v1.ts';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { posix } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { writeResponseHead } from './http-response.ts';
import { guestPath } from '../shared/paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';

import { Jobs } from './jobs.ts';
import { lstat } from 'node:fs/promises';
import type { Writable } from 'node:stream';
import { streamStoredFile } from './storage-streams.ts';

export const downloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file'), path: z.string() }).strict(),
  z.object({ type: z.literal('export') }).strict(),
]);
type StreamDownload = { bytes: number;
/**
 * 签名 / Signature: StreamDownload.write.
 * 功能：为签发并消费短期下载票据声明 write 的输入与结果契约，所属容器为 StreamDownload。
 * Purpose: Declares the input/result contract for write in StreamDownload. Module responsibility: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles.
 * 输入 / Inputs: output: Writable; signal: AbortSignal
 * 输出 / Returns: Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
write: (output: Writable, signal: AbortSignal) => Promise<void> };
type DownloadTarget = (
  z.infer<typeof downloadSchema> | { type: 'local'; path: string } | ({ type: 'stream' } & StreamDownload)
) & {
  id: string;
  name: string;
};

// A ticket grants one download only; it never contains the controller token.
export class DownloadTickets {
  private tickets = new Map<string, { target: DownloadTarget; expiresAt: number }>();
  /**
   * 入口 / Entry: DownloadTickets.constructor.
   * 功能：建立 DownloadTickets 的签发并消费短期下载票据上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the DownloadTickets context for this module's responsibility: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: now: default=Date.now
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private now = Date.now) {}
  /**
   * 入口 / Entry: DownloadTickets.issue.
   * 功能：在签发并消费短期下载票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ url: `/api/downloads/${key}`, expiresAt }` 供上层消费（`DownloadTickets`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DownloadTickets`; this entry produces `{ url: `/api/downloads/${key}`, expiresAt }` for its caller. Module context: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles.
   * 处理：通过 `this.now`, `this.tickets.delete`, `randomBytes().toString`, `randomBytes` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.now`, `this.tickets.delete`, `randomBytes().toString`, `randomBytes`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `ticket.expiresAt <= now`.
   * 输入 / Inputs: target: DownloadTarget
   * 输出 / Returns: `{ url: `/api/downloads/${key}`, expiresAt }`.
   * 副作用 / Effects: `this.tickets.delete`; `this.tickets.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.tickets.size >= 64`; 异常 / errors `new AppError('待下载任务过多，请稍后重试', 429)`.
   */
  issue(target: DownloadTarget) {
    const now = this.now();
    for (const [key, ticket] of this.tickets) if (ticket.expiresAt <= now) this.tickets.delete(key);
    if (this.tickets.size >= 64) throw new AppError('待下载任务过多，请稍后重试', 429);
    const key = randomBytes(32).toString('hex');
    const expiresAt = now + 60000;
    this.tickets.set(key, { target: { ...target }, expiresAt });
    return { url: `/api/downloads/${key}`, expiresAt };
  }
  /**
   * 入口 / Entry: DownloadTickets.take.
   * 功能：在签发并消费短期下载票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `ticket.target` 供上层消费（`DownloadTickets`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DownloadTickets`; this entry produces `ticket.target` for its caller. Module context: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles.
   * 处理：通过 `this.tickets.get`, `this.tickets.delete`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.tickets.get`, `this.tickets.delete`, `this.now`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: key: string
   * 输出 / Returns: `ticket.target`.
   * 副作用 / Effects: `this.tickets.delete`.
   * 拒绝 / Refusals: 条件 / conditions `!ticket || ticket.expiresAt <= this.now()`; 异常 / errors `new AppError('下载链接已失效，请重新点击下载', 410)`.
   */
  take(key: string) {
    const ticket = this.tickets.get(key);
    this.tickets.delete(key);
    if (!ticket || ticket.expiresAt <= this.now()) throw new AppError('下载链接已失效，请重新点击下载', 410);
    return ticket.target;
  }
  /**
   * 入口 / Entry: DownloadTickets.clear.
   * 功能：在签发并消费短期下载票据中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`DownloadTickets`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DownloadTickets`; the calls and state transitions below complete the operation. Module context: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles.
   * 处理：通过 `this.tickets.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.tickets.clear`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.tickets.clear`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  clear() {
    this.tickets.clear();
  }
}

export class Downloads {
  jobs = new Jobs('transfers');
  private tickets = new DownloadTickets();
  private active = new Map<AbortController, Promise<void>>();
  private closed = false;
  /**
   * 入口 / Entry: Downloads.constructor.
   * 功能：建立 Downloads 的签发并消费短期下载票据上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Downloads context for this module's responsibility: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; providers: { files?: FilesV1; bundles?: BundlesV1 }
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private providers: { files?: FilesV1; bundles?: BundlesV1 },
  ) {}
  /**
   * 入口 / Entry: Downloads.files.
   * 功能：向调用者提供 `this.providers.files` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.providers.files` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.providers.files`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.providers.files`; 异常 / errors `new AppError('文件插件未启用', 403)`.
   */
  private get files() {
    if (!this.providers.files) throw new AppError('文件插件未启用', 403);
    return this.providers.files;
  }
  /**
   * 入口 / Entry: Downloads.bundles.
   * 功能：向调用者提供 `this.providers.bundles` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.providers.bundles` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.providers.bundles`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.providers.bundles`; 异常 / errors `new AppError('快照插件未启用', 403)`.
   */
  private get bundles() {
    if (!this.providers.bundles) throw new AppError('快照插件未启用', 403);
    return this.providers.bundles;
  }
  /**
   * 入口 / Entry: Downloads.issue.
   * 功能：在签发并消费短期下载票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.tickets.issue({ id, type: 'file', path, name: posix.basename(path) })` / `this.tickets.issue({ id, type: 'export', name: vm.name + '.sakura' })` 供上层消费（`Downloads`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Downloads`; this entry produces `this.tickets.issue({ id, type: 'file', path, name: posix.basename(path) })` / `this.tickets.issue({ id, type: 'export', name: vm.name + '.sakura' })` for its caller. Module context: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles.
   * 处理：通过 `downloadSchema.parse`, `this.machines.get`, `guestPath`, `this.files.info` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `downloadSchema.parse`, `this.machines.get`, `guestPath`, `this.files.info`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `this.tickets.issue({ id, type: 'file', path, name: posix.basename(path) })`; `this.tickets.issue({ id, type: 'export', name: vm.name + '.sakura' })`.
   * 副作用 / Effects: `downloadSchema.parse`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `value.type === 'file'`; 异常 / errors `new AppError('服务正在关闭', 503)`.
   */
  async issue(id: string, input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const value = downloadSchema.parse(input);
    const vm = this.machines.get(id);
    if (value.type === 'file') {
      const path = guestPath(value.path);
      await this.files.info(id, path);
      if (this.closed) throw new AppError('服务正在关闭', 503);
      return this.tickets.issue({ id, type: 'file', path, name: posix.basename(path) });
    }
    this.machines.requireStopped(id);
    return this.tickets.issue({ id, type: 'export', name: vm.name + '.sakura' });
  }
  /**
   * 入口 / Entry: Downloads.issueLocal.
   * 功能：在签发并消费短期下载票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.tickets.issue({ id, type: 'local', path: file.path, name: file.name })` 供上层消费（`Downloads`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Downloads`; this entry produces `this.tickets.issue({ id, type: 'local', path: file.path, name: file.name })` for its caller. Module context: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles.
   * 处理：通过 `this.machines.get`, `inline.isFile`, `lstat`, `this.tickets.issue` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `inline.isFile`, `lstat`, `this.tickets.issue`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; file: { path: string; name: string }
   * 输出 / Returns: `this.tickets.issue({ id, type: 'local', path: file.path, name: file.name })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `!(await lstat(file.path)).isFile()`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('备份文件不可用')`.
   */
  async issueLocal(id: string, file: { path: string; name: string }) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    this.machines.get(id);
    if (!(await lstat(file.path)).isFile()) throw new AppError('备份文件不可用');
    return this.tickets.issue({ id, type: 'local', path: file.path, name: file.name });
  }
  /**
   * 入口 / Entry: Downloads.issueStream.
   * 功能：在签发并消费短期下载票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.tickets.issue({ id, type: 'stream', name: content.name, bytes: content.bytes, write: content.write, })` 供上层消费（`Downloads`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Downloads`; this entry produces `this.tickets.issue({ id, type: 'stream', name: content.name, bytes: content.bytes, write: content.write, })` for its caller. Module context: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles.
   * 处理：通过 `this.machines.get`, `this.tickets.issue` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.tickets.issue`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; content: StreamDownload & { name: string }
   * 输出 / Returns: `this.tickets.issue({ id, type: 'stream', name: content.name, bytes: content.bytes, write: content.write, })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `!Number.isSafeInteger(content.bytes) || content.bytes < 0`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('下载大小无效')`.
   */
  issueStream(id: string, content: StreamDownload & { name: string }) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    this.machines.get(id);
    if (!Number.isSafeInteger(content.bytes) || content.bytes < 0) throw new AppError('下载大小无效');
    return this.tickets.issue({
      id,
      type: 'stream',
      name: content.name,
      bytes: content.bytes,
      write: content.write,
    });
  }
  /**
   * 入口 / Entry: Downloads.route.
   * 功能：在签发并消费短期下载票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `true` 供上层消费（`Downloads`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Downloads`; this entry produces `false` / `true` for its caller. Module context: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles.
   * 处理：通过 `inline.exec`, `this.send`, `this.tickets.take` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.exec`, `this.send`, `this.tickets.take`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!match`.
   * 输入 / Inputs: req: IncomingMessage; res: ServerResponse; url: URL
   * 输出 / Returns: `false`; `true`.
   * 副作用 / Effects: `inline.exec`; `this.send`.
   * 拒绝 / Refusals: 条件 / conditions `req.method !== 'GET'`; 异常 / errors `new AppError('下载仅支持 GET', 405)`.
   */
  async route(req: IncomingMessage, res: ServerResponse, url: URL) {
    const match = /^\/api\/downloads\/([a-f0-9]{64})$/.exec(url.pathname);
    if (!match) return false;
    if (req.method !== 'GET') throw new AppError('下载仅支持 GET', 405);
    await this.send(this.tickets.take(match[1]), res);
    return true;
  }
  /**
   * 入口 / Entry: Downloads.send.
   * 功能：在签发并消费短期下载票据中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Downloads`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Downloads`; the calls and state transitions below complete the operation. Module context: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles.
   * 处理：通过 `this.machines.get`, `res.once`, `inline`, `this.active.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `res.once`, `inline`, `this.active.set`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: target: DownloadTarget; res: ServerResponse
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.active.set`; `this.active.delete`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; 异常 / errors `new AppError('服务正在关闭', 503)`.
   * 收尾：退出 try 区域时始终执行 `res.off('close', disconnected);`; `this.active.delete(abort);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `res.off('close', disconnected);`; `this.active.delete(abort);`; these steps also apply to exceptional exits.
   */
  async send(target: DownloadTarget, res: ServerResponse) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    this.machines.get(target.id);
    const abort = new AbortController();
    /**
     * 入口 / Entry: Downloads.send.disconnected.
     * 功能：在签发并消费短期下载票据中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Downloads`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `Downloads`; the calls and state transitions below complete the operation. Module context: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles.
     * 处理：通过 `abort.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `abort.abort`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `!res.writableFinished`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `abort.abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const disconnected = () => {
      if (!res.writableFinished) abort.abort();
    };
    res.once('close', disconnected);
    /**
     * 入口 / Entry: Downloads.send.headers.
     * 功能：在签发并消费短期下载票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `writeResponseHead(res, 200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8…` 供上层消费（`Downloads`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `Downloads`; this entry produces `writeResponseHead(res, 200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8…` for its caller. Module context: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles.
     * 处理：通过 `writeResponseHead`, `encodeURIComponent` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `writeResponseHead`, `encodeURIComponent`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: size: number optional
     * 输出 / Returns: `writeResponseHead(res, 200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8…`.
     * 副作用 / Effects: `writeResponseHead`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const headers = (size?: number) =>
      writeResponseHead(res, 200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(target.name)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Accept-Ranges': 'none',
        ...(size === undefined ? {} : { 'Content-Length': size }),
      });
    /**
     * 入口 / Entry: Downloads.send.callback@128.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `abort.abort`; `abort.signal.throwIfAborted`; `target.write`; `this.files.download`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const work = (async () => {
      if (res.destroyed) abort.abort();
      abort.signal.throwIfAborted();
      if (target.type === 'stream') {
        // The producer verifies its whole-file hash before ending the stream.
        // Chunked transfer must remain incomplete if that final check fails.
        headers();
        await target.write(res, abort.signal);
      } else if (target.type === 'local') {
        await streamStoredFile(target.path, res, abort.signal, headers);
      } else if (target.type === 'file')
        await this.files.download(target.id, target.path, res, headers, abort.signal);
      else
        /**
         * 入口 / Entry: Downloads.send.callback@143.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.track）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.track).
         * 输入 / Inputs: log; signal; update
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `update`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        await this.jobs.track(
          target.id,
          async (log, signal, update) => {
            log('正在生成导出包…\n');
            update('生成磁盘与校验清单');
            await this.bundles.export(
              target.id,
              res,
              () => {
                update('传输到浏览器');
                headers();
              },
              signal,
            );
          },
          { title: '导出实例', vmId: target.id, action: 'export' },
          abort.signal,
        );
    })();
    this.active.set(abort, work);
    try {
      await work;
    } finally {
      res.off('close', disconnected);
      this.active.delete(abort);
    }
  }
  /**
   * 入口 / Entry: Downloads.close.
   * 功能：在签发并消费短期下载票据中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`Downloads`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Downloads`; the outcome is recorded in `this.closed`. Module context: Issues and consumes short-lived download tickets, bounding pending downloads and owning file/stream lifecycles.
   * 处理：通过 `this.tickets.clear`, `this.active.keys`, `abort.abort`, `Promise.allSettled` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.tickets.clear`, `this.active.keys`, `abort.abort`, `Promise.allSettled`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.tickets.clear`; `abort.abort`; `this.jobs.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.tickets.clear();
    for (const abort of this.active.keys()) abort.abort();
    await Promise.allSettled(this.active.values());
    await this.jobs.close();
  }
}
