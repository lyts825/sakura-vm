/**
 * 模块职责：保存文件历史与回收站内容，支持查看、恢复和清理受限制的历史版本。
 * Module purpose: Owns bounded file history and trash, supporting inspection, restoration and purging of retained versions.
 */
import type { FilesV1 } from './service-contracts/v1.ts';
import { randomUUID, createHash } from 'node:crypto';
import { join, posix } from 'node:path';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { SFTPWrapper } from 'ssh2';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { vmDir } from './paths.ts';
import { guestPath } from '../shared/paths.ts';
import { Files, ftpStat, mutablePath, MAX_TEXT_BYTES } from './files.ts';
import { readStore, writeStore } from './local-store.ts';

const entrySchema = z.object({
  id: z.uuid(),
  path: z.string().refine((p) => {
    try {
      return mutablePath(p) === p;
    } catch {
      return false;
    }
  }),
  kind: z.enum(['version', 'trash']),
  createdAt: z.string(),
  bytes: z.number().nonnegative(),
  version: z.string().optional(),
  ready: z.boolean().default(true),
});
export type HistoryEntry = z.infer<typeof entrySchema>;
export class FileHistory {
  /**
   * 入口 / Entry: FileHistory.constructor.
   * 功能：建立 FileHistory 的保存文件历史与回收站内容上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the FileHistory context for this module's responsibility: Owns bounded file history and trash, supporting inspection, restoration and purging of retained versions. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; files: FilesV1
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private files: FilesV1,
  ) {}
  /**
   * 入口 / Entry: FileHistory.root.
   * 功能：在保存文件历史与回收站内容中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(vmDir(id), 'file-history')` 供上层消费（`FileHistory`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FileHistory`; this entry produces `join(vmDir(id), 'file-history')` for its caller. Module context: Owns bounded file history and trash, supporting inspection, restoration and purging of retained versions.
   * 处理：通过 `this.machines.get`, `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `join(vmDir(id), 'file-history')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private root(id: string) {
    this.machines.get(id);
    return join(vmDir(id), 'file-history');
  }
  /**
   * 入口 / Entry: FileHistory.list.
   * 功能：在保存文件历史与回收站内容中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `values.filter((v) => !path || v.path === guestPath(path))` 供上层消费（`FileHistory`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `FileHistory`; this entry produces `values.filter((v) => !path || v.path === guestPath(path))` for its caller. Module context: Owns bounded file history and trash, supporting inspection, restoration and purging of retained versions.
   * 处理：通过 `z.array().parse`, `z.array`, `readStore`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.array().parse`, `z.array`, `readStore`, `join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; path: string optional
   * 输出 / Returns: `values.filter((v) => !path || v.path === guestPath(path))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async list(id: string, path?: string) {
    const values = z.array(entrySchema).parse(await readStore(join(this.root(id), 'index.json'), () => []));
    return values.filter((v) => !path || v.path === guestPath(path));
  }
  /**
   * 入口 / Entry: FileHistory.record.
   * 功能：在保存文件历史与回收站内容中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`FileHistory`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FileHistory`; the calls and state transitions below complete the operation. Module context: Owns bounded file history and trash, supporting inspection, restoration and purging of retained versions.
   * 处理：通过 `inline.filter`, `this.list`, `values.push`, `values.filter().slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.filter`, `this.list`, `values.push`, `values.filter().slice`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `item.kind === 'version' && (total > 128 * 1024 ** 2 || remaining.filter((v) => v.kind === 'version')…`.
   * 输入 / Inputs: id: string; entry: HistoryEntry
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `values.push`; `remaining.splice`; `old.push`; `writeStore`; `rm`; 更新 / updates `total`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async record(id: string, entry: HistoryEntry) {
    const values = (await this.list(id)).filter((v) => v.id !== entry.id);
    values.push(entry);
    const old = values.filter((v) => v.kind === 'version' && v.path === entry.path).slice(0, -20);
    const remaining = values.filter((v) => !old.includes(v));
    let total = remaining.filter((v) => v.kind === 'version').reduce((n, v) => n + v.bytes, 0);
    for (const item of [...remaining])
      if (
        item.kind === 'version' &&
        (total > 128 * 1024 ** 2 || remaining.filter((v) => v.kind === 'version').length > 500)
      ) {
        remaining.splice(remaining.indexOf(item), 1);
        old.push(item);
        total -= item.bytes;
      }
    await writeStore(join(this.root(id), 'index.json'), remaining);
    for (const item of old) await rm(join(this.root(id), `${item.id}.txt`), { force: true });
  }
  /**
   * 入口 / Entry: FileHistory.capture.
   * 功能：在保存文件历史与回收站内容中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`FileHistory`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FileHistory`; this entry produces `void` for its caller. Module context: Owns bounded file history and trash, supporting inspection, restoration and purging of retained versions.
   * 处理：通过 `ftpStat`, `attrs.isFile`, `pipeline`, `ftp.createReadStream` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `ftpStat`, `attrs.isFile`, `pipeline`, `ftp.createReadStream`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!attrs?.isFile() || attrs.size > MAX_TEXT_BYTES`; `data.includes(0)`.
   * 输入 / Inputs: id: string; path: string; ftp: SFTPWrapper; signal: AbortSignal optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `ftp.createReadStream`; `createHash().update().digest`; `createHash().update`; `createHash`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async capture(id: string, path: string, ftp: SFTPWrapper, signal?: AbortSignal) {
    const attrs = await ftpStat(ftp, path);
    if (!attrs?.isFile() || attrs.size > MAX_TEXT_BYTES) return;
    const chunks: Buffer[] = [];
    let bytes = 0;
    await pipeline(
      ftp.createReadStream(path),
      new Writable({
        /**
         * 入口 / Entry: FileHistory.capture.write.
         * 功能：在保存文件历史与回收站内容中，校验并提交领域状态变更；本入口产生 `done(new AppError('历史版本超过文本上限'))` 供上层消费（`FileHistory`）。
         * Purpose: Validates and commits a domain state change in `FileHistory`; this entry produces `done(new AppError('历史版本超过文本上限'))` for its caller. Module context: Owns bounded file history and trash, supporting inspection, restoration and purging of retained versions.
         * 处理：通过 `done`, `chunks.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `done`, `chunks.push`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `bytes > MAX_TEXT_BYTES`.
         * 输入 / Inputs: chunk: Buffer; _encoding; done
         * 输出 / Returns: `done(new AppError('历史版本超过文本上限'))`.
         * 副作用 / Effects: `chunks.push`; 更新 / updates `bytes`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        write(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          if (bytes > MAX_TEXT_BYTES) return done(new AppError('历史版本超过文本上限'));
          chunks.push(chunk);
          done();
        },
      }),
      { signal },
    );
    const data = Buffer.concat(chunks);
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      return;
    }
    if (data.includes(0)) return;
    const version = createHash('sha256').update(data).digest('hex');
    /**
     * 入口 / Entry: FileHistory.capture.callback@91.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `mkdir`; `writeFile`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    await this.machines.locked(`history:${id}`, async () => {
      if ((await this.list(id, path)).findLast((v) => v.kind === 'version')?.version === version) return;
      const entry: HistoryEntry = {
        id: randomUUID(),
        path,
        kind: 'version',
        createdAt: new Date().toISOString(),
        bytes: data.length,
        version,
        ready: true,
      };
      await mkdir(this.root(id), { recursive: true });
      await writeFile(join(this.root(id), `${entry.id}.txt`), data, { mode: 0o600, flag: 'wx' });
      await this.record(id, entry);
    });
  }
  /**
   * 入口 / Entry: FileHistory.trash.
   * 功能：在保存文件历史与回收站内容中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.locked(`history:${id}`, () => this.machines.sftp(id, async (ftp) => { const attrs = await ftpStat(ftp, path); i…` 供上层消费（`FileHistory`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FileHistory`; this entry produces `this.machines.locked(`history:${id}`, () => this.machines.sftp(id, async (ftp) => { const attrs = await ftpStat(ftp, path); i…` for its caller. Module context: Owns bounded file history and trash, supporting inspection, restoration and purging of retained versions.
   * 处理：通过 `mutablePath`, `path.split().some`, `path.split`, `this.machines.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `mutablePath`, `path.split().some`, `path.split`, `this.machines.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; path: string; recursive: default=false
   * 输出 / Returns: `this.machines.locked(`history:${id}`, () => this.machines.sftp(id, async (ftp) => { const attrs = await ftpStat(ftp, path); i…`.
   * 副作用 / Effects: 更新 / updates `path`.
   * 拒绝 / Refusals: 条件 / conditions `path.split('/').some((p) => p.startsWith('.sakura-trash-'))`; 异常 / errors `new AppError('请在回收站管理已删除内容')`.
   */
  async trash(id: string, path: string, recursive = false) {
    path = mutablePath(path);
    if (path.split('/').some((p) => p.startsWith('.sakura-trash-')))
      throw new AppError('请在回收站管理已删除内容');
    /**
     * 入口 / Entry: FileHistory.trash.callback@112.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.sftp）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.sftp).
     * 输入 / Inputs: ftp
     * 输出 / Returns: `{ ok: true, historyId: entry.id }`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!attrs`; `attrs.isDirectory() && !recursive`; `(await this.list(id)).filter((v) => v.kind === 'trash').length >= 200`; 异常 / errors `new AppError('文件不存在', 404)`; `new AppError('目录删除需要确认', 409)`.
     */
    return this.machines.locked(`history:${id}`, () =>
      this.machines.sftp(id,
      /**
       * 中文功能：检查存在性、目录删除确认和回收站容量，先保存未就绪记录，再重命名原文件并发布 ready 记录。
       * English: Checks existence, directory-deletion confirmation and trash capacity, saves a not-ready record, renames the original file and then publishes ready state.
       * 所属 / Owner: FileHistory.trash.
       * 输入 / Inputs: ftp.
       */
      async (ftp) => {
        const attrs = await ftpStat(ftp, path);
        if (!attrs) throw new AppError('文件不存在', 404);
        if (attrs.isDirectory() && !recursive) throw new AppError('目录删除需要确认', 409);
        if ((await this.list(id)).filter((v) => v.kind === 'trash').length >= 200)
          throw new AppError('回收站已达 200 项，请先恢复或清理');
        const entry: HistoryEntry = {
          id: randomUUID(),
          path,
          kind: 'trash',
          createdAt: new Date().toISOString(),
          bytes: attrs.size,
          ready: false,
        };
        await this.record(id, entry);
        await new Promise<void>((resolve, reject) =>
          ftp.rename(path, this.trashPath(entry), (e) => (e ? reject(e) : resolve())),
        );
        await this.record(id, { ...entry, ready: true });
        return { ok: true, historyId: entry.id };
      }),
    );
  }
  /**
   * 入口 / Entry: FileHistory.trashPath.
   * 功能：在保存文件历史与回收站内容中，执行此领域的具体处理步骤并返回其结果；本入口产生 `posix.join(posix.dirname(entry.path), `.sakura-trash-${entry.id}`)` 供上层消费（`FileHistory`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FileHistory`; this entry produces `posix.join(posix.dirname(entry.path), `.sakura-trash-${entry.id}`)` for its caller. Module context: Owns bounded file history and trash, supporting inspection, restoration and purging of retained versions.
   * 处理：通过 `posix.join`, `posix.dirname` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `posix.join`, `posix.dirname`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: entry: HistoryEntry
   * 输出 / Returns: `posix.join(posix.dirname(entry.path), `.sakura-trash-${entry.id}`)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private trashPath(entry: HistoryEntry) {
    return posix.join(posix.dirname(entry.path), `.sakura-trash-${entry.id}`);
  }
  /**
   * 入口 / Entry: FileHistory.find.
   * 功能：在保存文件历史与回收站内容中，执行此领域的具体处理步骤并返回其结果；本入口产生 `item` 供上层消费（`FileHistory`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FileHistory`; this entry produces `item` for its caller. Module context: Owns bounded file history and trash, supporting inspection, restoration and purging of retained versions.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `inline.find`, `this.list` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `inline.find`, `this.list`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; key: string
   * 输出 / Returns: `item`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!item`; 异常 / errors `new AppError('历史记录不存在', 404)`.
   */
  private async find(id: string, key: string) {
    z.uuid().parse(key);
    const item = (await this.list(id)).find((v) => v.id === key);
    if (!item) throw new AppError('历史记录不存在', 404);
    return item;
  }
  /**
   * 入口 / Entry: FileHistory.content.
   * 功能：在保存文件历史与回收站内容中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ entry, content }` 供上层消费（`FileHistory`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FileHistory`; this entry produces `{ entry, content }` for its caller. Module context: Owns bounded file history and trash, supporting inspection, restoration and purging of retained versions.
   * 处理：通过 `this.find`, `readFile`, `join`, `this.root` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.find`, `readFile`, `join`, `this.root`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; key: string
   * 输出 / Returns: `{ entry, content }`.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
   * 拒绝 / Refusals: 条件 / conditions `entry.kind !== 'version'`; `createHash('sha256').update(content).digest('hex') !== entry.version`; 异常 / errors `new AppError('请选择文本历史版本')`; `new AppError('历史版本校验失败')`.
   */
  async content(id: string, key: string) {
    const entry = await this.find(id, key);
    if (entry.kind !== 'version') throw new AppError('请选择文本历史版本');
    const content = await readFile(join(this.root(id), `${entry.id}.txt`), 'utf8');
    if (createHash('sha256').update(content).digest('hex') !== entry.version)
      throw new AppError('历史版本校验失败');
    return { entry, content };
  }
  /**
   * 入口 / Entry: FileHistory.restore.
   * 功能：在保存文件历史与回收站内容中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ok: true, path: entry.path }` 供上层消费（`FileHistory`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FileHistory`; this entry produces `{ ok: true, path: entry.path }` for its caller. Module context: Owns bounded file history and trash, supporting inspection, restoration and purging of retained versions.
   * 处理：通过 `this.find`, `this.content`, `this.files.upload`, `Readable.from` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.find`, `this.content`, `this.files.upload`, `Readable.from`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `entry.kind === 'version'`.
   * 输入 / Inputs: id: string; key: string; expectedVersion: string optional
   * 输出 / Returns: `{ ok: true, path: entry.path }`.
   * 副作用 / Effects: `this.files.upload`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async restore(id: string, key: string, expectedVersion?: string) {
    const entry = await this.find(id, key);
    if (entry.kind === 'version') {
      const { content } = await this.content(id, key);
      await this.files.upload(
        id,
        entry.path,
        Readable.from([content]),
        !!expectedVersion,
        undefined,
        expectedVersion,
      );
    } else
      /**
       * 入口 / Entry: FileHistory.restore.callback@165.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `writeStore`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      await this.machines.locked(`history:${id}`, async () => {
        await this.machines.sftp(id, async (ftp) => {
          if (await ftpStat(ftp, entry.path)) throw new AppError('原路径已有文件，请先改名或移动', 409);
          await new Promise<void>((resolve, reject) =>
            ftp.rename(this.trashPath(entry), entry.path, (e) => (e ? reject(e) : resolve())),
          );
        });
        await writeStore(
          join(this.root(id), 'index.json'),
          (await this.list(id)).filter((v) => v.id !== key),
        );
      });
    return { ok: true, path: entry.path };
  }
  /**
   * 入口 / Entry: FileHistory.purge.
   * 功能：把本层请求转交 `this.machines.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; key: string
   * 输出 / Returns: `this.machines.locked(`history:${id}`, async () => { const entry = await this.find(id, key); if (entry.kind === 'trash') { try…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async purge(id: string, key: string) {
    /**
     * 入口 / Entry: FileHistory.purge.callback@180.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ ok: true }`.
     * 副作用 / Effects: `rm`; `writeStore`.
     * 拒绝 / Refusals: 条件 / conditions `entry.kind === 'trash'`; `!(error instanceof AppError && error.status === 404)`; 异常 / errors `error`.
     * 失败处理：catch 分支执行 `if (!(error instanceof AppError && error.status === 404)) throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (!(error instanceof AppError && error.status === 404)) throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.machines.locked(`history:${id}`, async () => {
      const entry = await this.find(id, key);
      if (entry.kind === 'trash') {
        try {
          await new Files(this.machines).operation(id, 'delete', this.trashPath(entry), undefined, true);
        } catch (error) {
          // A refused rename or an interrupted previous purge can leave only
          // the durable receipt. Confirmed absence permits retiring that receipt.
          if (!(error instanceof AppError && error.status === 404)) throw error;
        }
      } else await rm(join(this.root(id), `${entry.id}.txt`), { force: true });
      await writeStore(
        join(this.root(id), 'index.json'),
        (await this.list(id)).filter((v) => v.id !== key),
      );
      return { ok: true };
    });
  }
}
