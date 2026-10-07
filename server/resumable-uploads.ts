/**
 * 模块职责：管理分块上传、校验与最终提交，限制分块数量并串行处理同一上传的变更。
 * Module purpose: Owns upload chunks, verification and commit, checking part counts and serializing each upload's mutations.
 */
import type { FilesV1 } from './service-contracts/v1.ts';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { checkedId, guestPath } from '../shared/paths.ts';
import { readStore, regularDirectory, writeStore } from './local-store.ts';

export const UPLOAD_CHUNK_BYTES = 1024 ** 2;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const requestSchema = z
  .object({
    path: z.string().refine((value) => {
      try {
        return guestPath(value) !== '/';
      } catch {
        return false;
      }
    }),
    size: z
      .number()
      .int()
      .min(0)
      .max(2 * 1024 ** 3),
    chunks: z.array(digest).max(2048),
    overwrite: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) => value.chunks.length === Math.ceil(value.size / UPLOAD_CHUNK_BYTES),
    '分块数量与文件大小不一致',
  );
type Session = z.infer<typeof requestSchema> & {
  id: string;
  vmId: string;
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
  completed?: { bytes: number; sha256: string };
  committing?: { bytes: number; sha256: string };
};

export class ResumableUploads {
  private active = new Set<string>();
  /**
   * 入口 / Entry: ResumableUploads.constructor.
   * 功能：建立 ResumableUploads 的管理分块上传、校验与最终提交上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ResumableUploads context for this module's responsibility: Owns upload chunks, verification and commit, checking part counts and serializing each upload's mutations. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: files: FilesV1; root: default=join(DATA, 'uploads')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private files: FilesV1,
    private root = join(DATA, 'uploads'),
  ) {}
  /**
   * 入口 / Entry: ResumableUploads.folder.
   * 功能：在管理分块上传、校验与最终提交中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(this.root, checkedId(vmId), z.uuid().parse(id))` 供上层消费（`ResumableUploads`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ResumableUploads`; this entry produces `join(this.root, checkedId(vmId), z.uuid().parse(id))` for its caller. Module context: Owns upload chunks, verification and commit, checking part counts and serializing each upload's mutations.
   * 处理：通过 `join`, `checkedId`, `z.uuid().parse`, `z.uuid` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `checkedId`, `z.uuid().parse`, `z.uuid`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: `join(this.root, checkedId(vmId), z.uuid().parse(id))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private folder(vmId: string, id: string) {
    return join(this.root, checkedId(vmId), z.uuid().parse(id));
  }
  /**
   * 入口 / Entry: ResumableUploads.exclusive.
   * 功能：在管理分块上传、校验与最终提交中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await action()` 供上层消费（`ResumableUploads`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ResumableUploads`; this entry produces `await action()` for its caller. Module context: Owns upload chunks, verification and commit, checking part counts and serializing each upload's mutations.
   * 处理：通过 `this.active.has`, `this.active.add`, `action`, `this.active.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.active.has`, `this.active.add`, `action`, `this.active.delete`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: key: string; action: () => Promise<T>
   * 输出 / Returns: `await action()`.
   * 副作用 / Effects: `this.active.add`; `this.active.delete`.
   * 拒绝 / Refusals: 条件 / conditions `this.active.has(key)`; 异常 / errors `new AppError('此上传正在处理其他请求', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.active.delete(key);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.active.delete(key);`; these steps also apply to exceptional exits.
   */
  private async exclusive<T>(key: string, action: () => Promise<T>) {
    if (this.active.has(key)) throw new AppError('此上传正在处理其他请求', 409);
    this.active.add(key);
    try {
      return await action();
    } finally {
      this.active.delete(key);
    }
  }
  /**
   * 入口 / Entry: ResumableUploads.session.
   * 功能：在管理分块上传、校验与最终提交中，执行此领域的具体处理步骤并返回其结果；本入口产生 `record` 供上层消费（`ResumableUploads`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ResumableUploads`; this entry produces `record` for its caller. Module context: Owns upload chunks, verification and commit, checking part counts and serializing each upload's mutations.
   * 处理：通过 `regularDirectory`, `this.folder`, `readStore`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `regularDirectory`, `this.folder`, `readStore`, `join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: `record`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!record || record.id !== id || record.vmId !== vmId`; `Date.parse(record.expiresAt) <= Date.now()`; 异常 / errors `new AppError('上传会话不存在', 404)`; `new AppError('上传会话已过期，请重新开始', 410)`.
   */
  private async session(vmId: string, id: string) {
    const folder = await regularDirectory(this.folder(vmId, id));
    const record = await readStore<Session | null>(join(folder, 'session.json'), () => null);
    if (!record || record.id !== id || record.vmId !== vmId) throw new AppError('上传会话不存在', 404);
    if (Date.parse(record.expiresAt) <= Date.now()) throw new AppError('上传会话已过期，请重新开始', 410);
    return record;
  }
  /**
   * 入口 / Entry: ResumableUploads.matchesTarget.
   * 功能：在管理分块上传、校验与最终提交中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `digest.digest('hex') === expected.sha256` 供上层消费（`ResumableUploads`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ResumableUploads`; this entry produces `false` / `digest.digest('hex') === expected.sha256` for its caller. Module context: Owns upload chunks, verification and commit, checking part counts and serializing each upload's mutations.
   * 处理：通过 `this.files.info`, `createHash`, `this.files.download`, `digest.digest` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.files.info`, `createHash`, `this.files.download`, `digest.digest`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `(await this.files.info(session.vmId, session.path)).size !== expected.bytes`.
   * 输入 / Inputs: session: Session; expected: { bytes: number; sha256: string }; signal: AbortSignal optional
   * 输出 / Returns: `false`; `digest.digest('hex') === expected.sha256`.
   * 副作用 / Effects: `createHash`; `this.files.download`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `signal?.throwIfAborted();`; `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `signal?.throwIfAborted();`; `return false;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async matchesTarget(
    session: Session,
    expected: { bytes: number; sha256: string },
    signal?: AbortSignal,
  ) {
    try {
      if ((await this.files.info(session.vmId, session.path)).size !== expected.bytes) return false;
      const digest = createHash('sha256');
      await this.files.download(
        session.vmId,
        session.path,
        new Writable({
          /**
           * 入口 / Entry: ResumableUploads.matchesTarget.write.
           * 功能：在管理分块上传、校验与最终提交中，校验并提交领域状态变更；完成下述调用及状态处理（`ResumableUploads`）。
           * Purpose: Validates and commits a domain state change in `ResumableUploads`; the calls and state transitions below complete the operation. Module context: Owns upload chunks, verification and commit, checking part counts and serializing each upload's mutations.
           * 处理：通过 `digest.update`, `done` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `digest.update`, `done`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: chunk; _encoding; done
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: `digest.update`.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          write(chunk, _encoding, done) {
            digest.update(chunk);
            done();
          },
        }),
        () => {},
        signal,
      );
      return digest.digest('hex') === expected.sha256;
    } catch {
      signal?.throwIfAborted();
      return false;
    }
  }
  /**
   * 入口 / Entry: ResumableUploads.create.
   * 功能：在管理分块上传、校验与最终提交中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.exclusive(vmId, async () => { await regularDirectory(folder); await mkdir(folder, { recursive: true, mode: 0o700 }); con…` 供上层消费（`ResumableUploads`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ResumableUploads`; this entry produces `this.exclusive(vmId, async () => { await regularDirectory(folder); await mkdir(folder, { recursive: true, mode: 0o700 }); con…` for its caller. Module context: Owns upload chunks, verification and commit, checking part counts and serializing each upload's mutations.
   * 处理：通过 `requestSchema.parse`, `join`, `checkedId`, `this.exclusive` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `requestSchema.parse`, `join`, `checkedId`, `this.exclusive`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; input: unknown
   * 输出 / Returns: `this.exclusive(vmId, async () => { await regularDirectory(folder); await mkdir(folder, { recursive: true, mode: 0o700 }); con…`.
   * 副作用 / Effects: `requestSchema.parse`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async create(vmId: string, input: unknown) {
    const value = requestSchema.parse(input),
      folder = join(this.root, checkedId(vmId));
    /**
     * 入口 / Entry: ResumableUploads.create.callback@105.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.exclusive）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.exclusive).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(vmId, previous.id)`; `{ ...session, received: [] as number[], chunkBytes: UPLOAD_CHUNK_BYTES }`.
     * 副作用 / Effects: `mkdir`; `createHash().update().digest`; `createHash().update`; `createHash`; `rm`.
     * 拒绝 / Refusals: 条件 / conditions `count >= 16`; `capacity.bavail * capacity.bsize < value.size + 64 * 1024 ** 2`; 异常 / errors `new AppError('最多保留 16 个上传会话，请删除不需要的会话', 409)`; `new AppError('宿主磁盘空间不足', 507)`.
     */
    return this.exclusive(vmId, async () => {
      await regularDirectory(folder);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const fingerprint = createHash('sha256').update(JSON.stringify(value)).digest('hex');
      let count = 0;
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (!entry.isDirectory() || !z.uuid().safeParse(entry.name).success) continue;
        const directory = this.folder(vmId, entry.name);
        const previous = await readStore<Session | null>(join(directory, 'session.json'), () => null);
        if (previous && Date.parse(previous.expiresAt) > Date.now()) {
          count++;
          if (
            previous.fingerprint === fingerprint &&
            (!previous.completed || (await this.matchesTarget(previous, previous.completed)))
          )
            return this.view(vmId, previous.id);
        } else if (![...this.active].some((key) => key.startsWith(vmId + ':' + entry.name))) {
          await rm(directory, { recursive: true, force: true });
        }
      }
      if (count >= 16) throw new AppError('最多保留 16 个上传会话，请删除不需要的会话', 409);
      const capacity = await statfs(folder);
      if (capacity.bavail * capacity.bsize < value.size + 64 * 1024 ** 2)
        throw new AppError('宿主磁盘空间不足', 507);
      const id = randomUUID(),
        session: Session = {
          ...value,
          id,
          vmId,
          fingerprint,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(),
        };
      await mkdir(this.folder(vmId, id), { mode: 0o700 });
      await writeStore(join(this.folder(vmId, id), 'session.json'), session);
      return { ...session, received: [] as number[], chunkBytes: UPLOAD_CHUNK_BYTES };
    });
  }
  /**
   * 入口 / Entry: ResumableUploads.view.
   * 功能：在管理分块上传、校验与最终提交中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ ...record, received: received.sort((a, b) => a - b), chunkBytes: UPLOAD_CHUNK_BYTES }` 供上层消费（`ResumableUploads`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ResumableUploads`; this entry produces `{ ...record, received: received.sort((a, b) => a - b), chunkBytes: UPLOAD_CHUNK_BYTES }` for its caller. Module context: Owns upload chunks, verification and commit, checking part counts and serializing each upload's mutations.
   * 处理：通过 `this.session`, `readdir`, `this.folder`, `entry.match` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.session`, `readdir`, `this.folder`, `entry.match`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `match && Number(match[1]) < record.chunks.length`.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: `{ ...record, received: received.sort((a, b) => a - b), chunkBytes: UPLOAD_CHUNK_BYTES }`.
   * 副作用 / Effects: `received.push`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(vmId: string, id: string) {
    const record = await this.session(vmId, id),
      received: number[] = [];
    for (const entry of await readdir(this.folder(vmId, id))) {
      const match = entry.match(/^(\d+)\.chunk$/);
      if (match && Number(match[1]) < record.chunks.length) received.push(Number(match[1]));
    }
    return { ...record, received: received.sort((a, b) => a - b), chunkBytes: UPLOAD_CHUNK_BYTES };
  }
  /**
   * 入口 / Entry: ResumableUploads.chunk.
   * 功能：把本层请求转交 `this.exclusive`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.exclusive` and propagates the provider result or rejection.
   * 输入 / Inputs: vmId: string; id: string; index: number; input: Readable; signal: AbortSignal
   * 输出 / Returns: `this.exclusive(vmId + ':' + id, async () => { const session = await this.session(vmId, id); if (session.completed) throw new …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async chunk(vmId: string, id: string, index: number, input: Readable, signal: AbortSignal) {
    /**
     * 入口 / Entry: ResumableUploads.chunk.callback@153.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.exclusive）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.exclusive).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ index, bytes }`.
     * 副作用 / Effects: `createHash`; `createWriteStream`; `rename`; `rm`.
     * 拒绝 / Refusals: 条件 / conditions `session.completed`; `!Number.isInteger(index) || index < 0 || index >= session.chunks.length`; `bytes !== size || hash.digest('hex') !== session.chunks[index]`; 异常 / errors `new AppError('上传已完成', 409)`; `new AppError('分块索引无效')`.
     * 收尾：退出 try 区域时始终执行 `await rm(temporary, { force: true });`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `await rm(temporary, { force: true });`; these steps also apply to exceptional exits.
     */
    return this.exclusive(vmId + ':' + id, async () => {
      const session = await this.session(vmId, id);
      if (session.completed) throw new AppError('上传已完成', 409);
      if (!Number.isInteger(index) || index < 0 || index >= session.chunks.length)
        throw new AppError('分块索引无效');
      const size = Math.min(UPLOAD_CHUNK_BYTES, session.size - index * UPLOAD_CHUNK_BYTES);
      const temporary = join(this.folder(vmId, id), randomUUID() + '.tmp');
      const hash = createHash('sha256');
      let bytes = 0;
      try {
        await pipeline(
          input,
          new Transform({
            /**
             * 入口 / Entry: ResumableUploads.chunk.transform.
             * 功能：在管理分块上传、校验与最终提交中，执行此领域的具体处理步骤并返回其结果；本入口产生 `done(new AppError('分块长度超出声明', 413))` 供上层消费（`ResumableUploads`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `ResumableUploads`; this entry produces `done(new AppError('分块长度超出声明', 413))` for its caller. Module context: Owns upload chunks, verification and commit, checking part counts and serializing each upload's mutations.
             * 处理：通过 `done`, `hash.update` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `done`, `hash.update`; the branches below determine continuation, return or refusal.
             * 分支 / Branches: `bytes > size`.
             * 输入 / Inputs: chunk; _encoding; done
             * 输出 / Returns: `done(new AppError('分块长度超出声明', 413))`.
             * 副作用 / Effects: `hash.update`; 更新 / updates `bytes`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            transform(chunk, _encoding, done) {
              bytes += chunk.length;
              if (bytes > size) return done(new AppError('分块长度超出声明', 413));
              hash.update(chunk);
              done(null, chunk);
            },
          }),
          createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
          { signal },
        );
        if (bytes !== size || hash.digest('hex') !== session.chunks[index])
          throw new AppError('分块长度或 SHA-256 校验失败', 409);
        signal.throwIfAborted();
        await rename(temporary, join(this.folder(vmId, id), index + '.chunk'));
        return { index, bytes };
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }
  /**
   * 入口 / Entry: ResumableUploads.commit.
   * 功能：把本层请求转交 `this.exclusive`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.exclusive` and propagates the provider result or rejection.
   * 输入 / Inputs: vmId: string; id: string; signal: AbortSignal
   * 输出 / Returns: `this.exclusive(vmId + ':' + id, async () => { const session = await this.session(vmId, id); if (session.completed) { if (!(aw…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async commit(vmId: string, id: string, signal: AbortSignal) {
    /**
     * 入口 / Entry: ResumableUploads.commit.callback@187.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.exclusive）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.exclusive).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `session.completed`.
     * 副作用 / Effects: `writeStore`; `rm`; `createHash`; `createHash().update().digest`; `createHash().update`; 更新 / updates `session.completed`, `session.committing`.
     * 拒绝 / Refusals: 条件 / conditions `session.completed`; `!(await this.matchesTarget(session, session.completed, signal))`; `(await stat(file).catch(() => null))?.size !== Math.min(UPLOAD_CHUNK_BYTES, session.size - index * UPLOAD_CHUNK_BYTES)`; 异常 / errors `new AppError('已上传的目标文件发生变化，请开始新上传', 409)`; `new AppError('上传分块不完整：' + index, 409)`.
     */
    return this.exclusive(vmId + ':' + id, async () => {
      const session = await this.session(vmId, id);
      if (session.completed) {
        if (!(await this.matchesTarget(session, session.completed, signal)))
          throw new AppError('已上传的目标文件发生变化，请开始新上传', 409);
        return session.completed;
      }
      if (session.committing && (await this.matchesTarget(session, session.committing, signal))) {
        session.completed = session.committing;
        await writeStore(join(this.folder(vmId, id), 'session.json'), session);
        for (let index = 0; index < session.chunks.length; index++)
          await rm(join(this.folder(vmId, id), index + '.chunk'), { force: true });
        return session.completed;
      }
      const folder = this.folder(vmId, id),
        whole = createHash('sha256');
      for (let index = 0; index < session.chunks.length; index++) {
        const file = join(folder, index + '.chunk');
        if (
          (await stat(file).catch(() => null))?.size !==
          Math.min(UPLOAD_CHUNK_BYTES, session.size - index * UPLOAD_CHUNK_BYTES)
        )
          throw new AppError('上传分块不完整：' + index, 409);
        const chunk = await readFile(file);
        if (createHash('sha256').update(chunk).digest('hex') !== session.chunks[index])
          throw new AppError('已保存分块校验失败：' + index, 409);
        whole.update(chunk);
      }
      session.committing = { bytes: session.size, sha256: whole.digest('hex') };
      await writeStore(join(folder, 'session.json'), session);
      const source = Readable.from(
        (async function* () {
          for (let index = 0; index < session.chunks.length; index++) {
            signal.throwIfAborted();
            const chunk = await readFile(join(folder, index + '.chunk'));
            if (createHash('sha256').update(chunk).digest('hex') !== session.chunks[index])
              throw new AppError('已保存分块校验失败：' + index, 409);
            yield chunk;
          }
        })(),
      );
      const result = await this.files.upload(vmId, session.path, source, session.overwrite, signal);
      if (result.bytes !== session.size) throw new AppError('保存后的文件长度不一致', 409);
      session.completed = session.committing;
      await writeStore(join(folder, 'session.json'), session);
      for (let index = 0; index < session.chunks.length; index++)
        await rm(join(folder, index + '.chunk'), { force: true });
      return session.completed;
    });
  }
  /**
   * 入口 / Entry: ResumableUploads.remove.
   * 功能：把本层请求转交 `this.exclusive`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.exclusive` and propagates the provider result or rejection.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: `this.exclusive(vmId + ':' + id, async () => { await regularDirectory(this.folder(vmId, id)); await rm(this.folder(vmId, id), …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async remove(vmId: string, id: string) {
    return this.exclusive(vmId + ':' + id, async () => {
      await regularDirectory(this.folder(vmId, id));
      await rm(this.folder(vmId, id), { recursive: true, force: true });
      return { removed: true };
    });
  }
}
