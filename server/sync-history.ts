/**
 * 模块职责：保存双端同步检查点及回滚版本，限定恢复内容数量和大小以保护历史完整性。
 * Module purpose: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute, sep, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { writeStore, fileHash } from './local-store.ts';
import { storageGrowth, type StorageLease } from './storage-runtime.ts';
import { recoveryOriginSchema } from '../shared/contracts/domain-recovery.ts';
import { captureRecoveryOrigin } from './recovery-origin.ts';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const path = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) =>
    value.split('/').every((part) => part && part !== '.' && part !== '..' && !/[\\\x00-\x1f]/.test(part)),
  );
const meta = z
  .object({
    sha,
    mode: z.number().int().nonnegative(),
    uid: z.number().int().nonnegative().optional(),
    gid: z.number().int().nonnegative().optional(),
  })
  .strict();
const entrySchema = z
  .object({ side: z.enum(['host', 'guest']), path, before: meta.nullable(), after: sha.nullable() })
  .strict();
export const syncCheckpointSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    host: z.string(),
    guest: z.string(),
    status: z.enum(['pending', 'done', 'failed', 'rolled-back']),
    bytes: z.number().nonnegative(),
    entries: z.array(entrySchema).max(40000),
    error: z.string().optional(),
    state: sha.nullable(),
    base: sha.nullable(),
    afterState: sha.nullable().optional(),
    afterBase: sha.nullable().optional(),
    origin: recoveryOriginSchema.optional(),
  })
  .strict();
export type SyncCheckpoint = z.infer<typeof syncCheckpointSchema>;
export type SyncHistoryView = Pick<SyncCheckpoint, 'id' | 'createdAt' | 'status' | 'bytes' | 'error'> & {
  changes: number;
};
export type SyncSide = 'host' | 'guest';
export type SyncFileVersion = z.infer<typeof meta>;
export type SyncRestoreEntry = z.infer<typeof entrySchema>;
type Source = { stream: Readable; mode: number; uid?: number; gid?: number };
/**
 * 入口 / Entry: digest.
 * 功能：在保存双端同步检查点及回滚版本中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(bytes).digest('hex')` 供上层消费（`sync-history.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `sync-history.ts`; this entry produces `createHash('sha256').update(bytes).digest('hex')` for its caller. Module context: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: bytes: Buffer
 * 输出 / Returns: `createHash('sha256').update(bytes).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/**
 * 入口 / Entry: optionalFile.
 * 功能：在保存双端同步检查点及回滚版本中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await readFile(file)` / `null` 供上层消费（`sync-history.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `sync-history.ts`; this entry produces `await readFile(file)` / `null` for its caller. Module context: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
 * 处理：通过 `lstat`, `readFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `lstat`, `readFile`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `(error as NodeJS.ErrnoException).code === 'ENOENT'`.
 * 输入 / Inputs: file: string
 * 输出 / Returns: `await readFile(file)`; `null`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `(await lstat(file)).size > 32 * 1024 ** 2`; 异常 / errors `new AppError('同步基线超过回滚限制')`; `error`.
 * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
async function optionalFile(file: string) {
  try {
    if ((await lstat(file)).size > 32 * 1024 ** 2) throw new AppError('同步基线超过回滚限制');
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Local recovery points contain verified original bytes and a write-ahead list of
 * intended hashes. Recovery accepts only an original or an intended version. */
export class SyncHistory {
  /**
   * 入口 / Entry: SyncHistory.constructor.
   * 功能：建立 SyncHistory 的保存双端同步检查点及回滚版本上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SyncHistory context for this module's responsibility: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: root: string; stateFile: string; baseFile: string
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private root: string,
    private stateFile: string,
    private baseFile: string,
  ) {}
  /**
   * 入口 / Entry: SyncHistory.directory.
   * 功能：在保存双端同步检查点及回滚版本中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(this.root, z.uuid().parse(id))` 供上层消费（`SyncHistory`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyncHistory`; this entry produces `join(this.root, z.uuid().parse(id))` for its caller. Module context: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
   * 处理：通过 `join`, `z.uuid().parse`, `z.uuid` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `z.uuid().parse`, `z.uuid`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `join(this.root, z.uuid().parse(id))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private directory(id: string) {
    return join(this.root, z.uuid().parse(id));
  }
  /**
   * 入口 / Entry: SyncHistory.read.
   * 功能：在保存双端同步检查点及回滚版本中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `point` 供上层消费（`SyncHistory`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `SyncHistory`; this entry produces `point` for its caller. Module context: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
   * 处理：通过 `join`, `this.directory`, `lstat`, `syncCheckpointSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `this.directory`, `lstat`, `syncCheckpointSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `point`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `(await lstat(file)).size > 32 * 1024 ** 2`; `point.id !== id`; 异常 / errors `new AppError('同步回滚记录超过限制')`; `new AppError('同步回滚标识不匹配')`.
   */
  async read(id: string) {
    const file = join(this.directory(id), 'checkpoint.json');
    if ((await lstat(file)).size > 32 * 1024 ** 2) throw new AppError('同步回滚记录超过限制');
    const point = syncCheckpointSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (point.id !== id) throw new AppError('同步回滚标识不匹配');
    return point;
  }
  /**
   * 入口 / Entry: SyncHistory.list.
   * 功能：在保存双端同步检查点及回滚版本中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `[]` / `points.sort((a, b) => b.createdAt.localeCompare(a.createdAt))` 供上层消费（`SyncHistory`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `SyncHistory`; this entry produces `[]` / `points.sort((a, b) => b.createdAt.localeCompare(a.createdAt))` for its caller. Module context: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
   * 处理：通过 `readdir`, `z.uuid().safeParse`, `z.uuid`, `this.read` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readdir`, `z.uuid().safeParse`, `z.uuid`, `this.read`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `(error as NodeJS.ErrnoException).code === 'ENOENT'`; `!z.uuid().safeParse(name).success`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<SyncHistoryView[]>；结果来自 / values from `[]`; `points.sort((a, b) => b.createdAt.localeCompare(a.createdAt))`.
   * 副作用 / Effects: `points.push`; 更新 / updates `names`.
   * 拒绝 / Refusals: 条件 / conditions `(error as NodeJS.ErrnoException).code !== 'ENOENT'`; 异常 / errors `error`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async list(): Promise<SyncHistoryView[]> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const points: SyncHistoryView[] = [];
    for (const name of names) {
      if (!z.uuid().safeParse(name).success) continue;
      try {
        const point = await this.read(name);
        points.push({
          id: point.id,
          createdAt: point.createdAt,
          status: point.status,
          bytes: point.bytes,
          changes: point.entries.length,
          error: point.error,
        });
      } catch (error) {
        // An interrupted initial capture has no published checkpoint and changed no files.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return points.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /**
   * 入口 / Entry: SyncHistory.remove.
   * 功能：在保存双端同步检查点及回滚版本中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`SyncHistory`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SyncHistory`; the calls and state transitions below complete the operation. Module context: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
   * 处理：通过 `resolve`, `this.directory`, `relative`, `isAbsolute` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `resolve`, `this.directory`, `relative`, `isAbsolute`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `rel.startsWith`; `rm`.
   * 拒绝 / Refusals: 条件 / conditions `!rel || isAbsolute(rel) || rel.startsWith('..' + sep) || rel === '..' || dirnameIsSymlink(await lstat(directory))`; 异常 / errors `new AppError('同步回滚目录不安全')`.
   */
  private async remove(id: string) {
    const directory = resolve(this.directory(id)),
      root = resolve(this.root),
      rel = relative(root, directory);
    if (
      !rel ||
      isAbsolute(rel) ||
      rel.startsWith('..' + sep) ||
      rel === '..' ||
      dirnameIsSymlink(await lstat(directory))
    )
      throw new AppError('同步回滚目录不安全');
    await rm(directory, { recursive: true, force: true });
  }
  /**
   * 入口 / Entry: SyncHistory.begin.
   * 功能：保存双端同步前的文件版本与基线，创建可回滚的 pending 检查点。
   * Purpose: Saves two-sided pre-sync file versions/baselines into a rollback-capable pending checkpoint.
   * 设计：数量和字节受限，只清理已完成旧检查点；失败与待确认记录保留，外部写入前先固定原版本。
   * Design: Counts/bytes are bounded and only completed old points prune; failed/pending evidence remains and original versions precede external writes.
   * 输入 / Inputs: roots: { host: string; guest: string }; files: { host: Map<string, string>; guest: Map<string, string> }; source: (side: SyncSide, name: string) => Promise<Source>; signal: AbortSignal; lease: StorageLease optional
   * 输出 / Returns: `{ prepare: async (entries: { side: SyncSide; path: string; after: string | null }[]) => { for (const entry of entries) { cons…`.
   * 副作用 / Effects: `mkdir`; `writeFile`; `originals.set`; `createHash`; `createWriteStream`; 更新 / updates `point[kind]`, `point.bytes`.
   * 拒绝 / Refusals: 条件 / conditions `prior.filter((point) => point.status === 'failed' || point.status === 'pending').length >= 10`; `bytes`; `bytes.length > 32 * 1024 ** 2`; 异常 / errors `new AppError('存在 10 个未解决的同步回滚点，请先恢复最近的变更')`; `new AppError('同步基线超过回滚限制')`.
   * 失败处理：catch 分支执行 `try { await this.remove(point.id); } catch (cleanup) { lease?.cleanupPending(cleanup); throw cleanup; }`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `try { await this.remove(point.id); } catch (cleanup) { lease?.cleanupPending(cleanup); throw cleanup; }`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async begin(
    roots: { host: string; guest: string },
    files: { host: Map<string, string>; guest: Map<string, string> },
    source: (side: SyncSide, name: string) => Promise<Source>,
    signal: AbortSignal,
    lease?: StorageLease,
  ) {
    const prior = await this.list();
    // Retain unresolved recovery points. Completed points are capped at ten.
    for (const point of prior
      .filter((point) => point.status === 'done' || point.status === 'rolled-back')
      .slice(9))
      await this.remove(point.id);
    if (prior.filter((point) => point.status === 'failed' || point.status === 'pending').length >= 10)
      throw new AppError('存在 10 个未解决的同步回滚点，请先恢复最近的变更');
    const point: SyncCheckpoint = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      host: roots.host,
      guest: roots.guest,
      status: 'pending',
      bytes: 0,
      entries: [],
      state: null,
      base: null,
      origin: captureRecoveryOrigin(lease ? [lease.id] : []),
    };
    const directory = this.directory(point.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const originals = new Map<string, SyncFileVersion>();
    const blobs = new Set<string>();
    try {
      for (const kind of ['state', 'base'] as const) {
        const bytes = await optionalFile(kind === 'state' ? this.stateFile : this.baseFile);
        if (bytes) {
          if (bytes.length > 32 * 1024 ** 2) throw new AppError('同步基线超过回滚限制');
          point[kind] = digest(bytes);
          await lease?.reserveTemporary(join(directory, kind + '.json'), bytes.length);
          await writeFile(join(directory, kind + '.json'), bytes, { flag: 'wx', mode: 0o600 });
        }
      }
      for (const side of ['host', 'guest'] as const)
        for (const [name, expected] of files[side]) {
          signal.throwIfAborted();
          path.parse(name);
          const input = await source(side, name);
          originals.set(side + ':' + name, {
            sha: expected,
            mode: input.mode,
            uid: input.uid,
            gid: input.gid,
          });
          const hash = createHash('sha256');
          let bytes = 0;
          const check = new Transform({
            /**
             * 入口 / Entry: SyncHistory.begin.transform.
             * 功能：在保存双端同步检查点及回滚版本中，执行此领域的具体处理步骤并返回其结果；本入口产生 `callback(new AppError('回滚点最多保存 512 MiB 文件，请缩小同步范围或关闭回滚点'))` 供上层消费（`SyncHistory`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyncHistory`; this entry produces `callback(new AppError('回滚点最多保存 512 MiB 文件，请缩小同步范围或关闭回滚点'))` for its caller. Module context: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
             * 处理：通过 `blobs.has`, `callback`, `hash.update` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `blobs.has`, `callback`, `hash.update`; the branches below determine continuation, return or refusal.
             * 分支 / Branches: `bytes > 256 * 1024 ** 2 || (!blobs.has(expected) && point.bytes + bytes > 512 * 1024 ** 2)`.
             * 输入 / Inputs: chunk: Buffer; _encoding; callback
             * 输出 / Returns: `callback(new AppError('回滚点最多保存 512 MiB 文件，请缩小同步范围或关闭回滚点'))`.
             * 副作用 / Effects: `hash.update`; 更新 / updates `bytes`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            transform(chunk: Buffer, _encoding, callback) {
              bytes += chunk.length;
              if (bytes > 256 * 1024 ** 2 || (!blobs.has(expected) && point.bytes + bytes > 512 * 1024 ** 2))
                return callback(new AppError('回滚点最多保存 512 MiB 文件，请缩小同步范围或关闭回滚点'));
              hash.update(chunk);
              callback(null, chunk);
            },
          });
          if (!blobs.has(expected)) {
            await pipeline(
              input.stream,
              check,
              ...(lease ? [storageGrowth(lease, join(directory, expected), 256 * 1024 ** 2)] : []),
              createWriteStream(join(directory, expected), { flags: 'wx', mode: 0o600 }),
              { signal },
            );
            if (hash.digest('hex') !== expected)
              throw new AppError('保存回滚点期间文件已变化，请重新预览', 409);
            point.bytes += bytes;
            blobs.add(expected);
          } else {
            // Even a duplicate must be read: the scan may have become stale.
            const sink = new Transform({
              /**
               * 入口 / Entry: SyncHistory.begin.transform.
               * 功能：在保存双端同步检查点及回滚版本中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`SyncHistory`）。
               * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyncHistory`; the calls and state transitions below complete the operation. Module context: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
               * 处理：通过 `callback` 协调依赖；下列分支决定是否继续、返回或拒绝。
               * Processing: Coordinates its dependencies through `callback`; the branches below determine continuation, return or refusal.
               * 输入 / Inputs: _chunk; _encoding; callback
               * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
               * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              transform(_chunk, _encoding, callback) {
                callback();
              },
            });
            sink.resume();
            await pipeline(input.stream, check, sink, { signal });
            if (hash.digest('hex') !== expected)
              throw new AppError('保存回滚点期间文件已变化，请重新预览', 409);
          }
        }
      await this.save(point);
    } catch (error) {
      try {
        await this.remove(point.id);
      } catch (cleanup) {
        lease?.cleanupPending(cleanup);
        throw cleanup;
      }
      throw error;
    }
    if (lease)
      for (const name of [...blobs, 'state.json', 'base.json'])
        await lease.releaseTemporary(join(directory, name));
    return {
      /**
       * 入口 / Entry: SyncHistory.begin.prepare.
       * 功能：在保存双端同步检查点及回滚版本中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `existing.after`（`SyncHistory`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyncHistory`; the outcome is recorded in `existing.after`. Module context: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
       * 处理：通过 `point.entries.find`, `point.entries.push`, `originals.get`, `this.save` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `point.entries.find`, `point.entries.push`, `originals.get`, `this.save`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `existing`.
       * 输入 / Inputs: entries: { side: SyncSide; path: string; after: string | null }[]
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `point.entries.push`; `this.save`; 更新 / updates `existing.after`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      prepare: async (entries: { side: SyncSide; path: string; after: string | null }[]) => {
        for (const entry of entries) {
          const existing = point.entries.find((item) => item.side === entry.side && item.path === entry.path);
          if (existing) existing.after = entry.after;
          else point.entries.push({ ...entry, before: originals.get(entry.side + ':' + entry.path) || null });
        }
        await this.save(point);
      },
      /**
       * 入口 / Entry: SyncHistory.begin.finish.
       * 功能：在保存双端同步检查点及回滚版本中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `point.status`, `point.error`, `point.afterState`（`SyncHistory`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyncHistory`; the outcome is recorded in `point.status`, `point.error`, `point.afterState`. Module context: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
       * 处理：通过 `optionalHash`, `this.save` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `optionalHash`, `this.save`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `error`.
       * 输入 / Inputs: error: unknown optional
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.save`; 更新 / updates `point.status`, `point.error`, `point.afterState`, `point.afterBase`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      finish: async (error?: unknown) => {
        point.status = error ? 'failed' : 'done';
        if (error) point.error = String((error as Error)?.message || error).slice(0, 1000);
        point.afterState = await optionalHash(this.stateFile);
        point.afterBase = await optionalHash(this.baseFile);
        await this.save(point);
      },
    };
  }
  /**
   * 入口 / Entry: SyncHistory.save.
   * 功能：在保存双端同步检查点及回滚版本中，校验并提交领域状态变更；本入口产生 `writeStore(join(this.directory(point.id), 'checkpoint.json'), syncCheckpointSchema.parse(point))` 供上层消费（`SyncHistory`）。
   * Purpose: Validates and commits a domain state change in `SyncHistory`; this entry produces `writeStore(join(this.directory(point.id), 'checkpoint.json'), syncCheckpointSchema.parse(point))` for its caller. Module context: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
   * 处理：通过 `writeStore`, `join`, `this.directory`, `syncCheckpointSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `writeStore`, `join`, `this.directory`, `syncCheckpointSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: point: SyncCheckpoint
   * 输出 / Returns: `writeStore(join(this.directory(point.id), 'checkpoint.json'), syncCheckpointSchema.parse(point))`.
   * 副作用 / Effects: `writeStore`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private save(point: SyncCheckpoint) {
    return writeStore(join(this.directory(point.id), 'checkpoint.json'), syncCheckpointSchema.parse(point));
  }
  /**
   * 入口 / Entry: SyncHistory.restore.
   * 功能：在保存双端同步检查点及回滚版本中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ restored: point.entries.length, id: point.id }` 供上层消费（`SyncHistory`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyncHistory`; this entry produces `{ restored: point.entries.length, id: point.id }` for its caller. Module context: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
   * 处理：通过 `inline.find`, `this.list`, `this.read`, `this.directory` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.find`, `this.list`, `this.read`, `this.directory`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value !== (entry.before?.sha || null)`.
   * 输入 / Inputs: id: string; roots: { host: string; guest: string }; current: (side: SyncSide, path: string) => Promise<string | null>; apply: (entry: SyncRestoreEntry, blob: string | null, expected: string | null) => Promise<vo…; signal: AbortSignal
   * 输出 / Returns: `{ restored: point.entries.length, id: point.id }`.
   * 副作用 / Effects: `expected.set`; `createHash`; `createReadStream`; `hash.update`; `verified.add`; 更新 / updates `baseline[kind]`, `point.status`.
   * 拒绝 / Refusals: 条件 / conditions `latest?.id !== id`; `point.host !== roots.host || point.guest !== roots.guest`; `actualHash !== point[kind] && actualHash !== after`; 异常 / errors `new AppError('请从最近一次同步开始回滚', 409)`; `new AppError('同步目录已改变，无法应用此回滚点', 409)`.
   */
  async restore(
    id: string,
    roots: { host: string; guest: string },
    current: (side: SyncSide, path: string) => Promise<string | null>,
    apply: (entry: SyncRestoreEntry, blob: string | null, expected: string | null) => Promise<void>,
    signal: AbortSignal,
  ) {
    const latest = (await this.list()).find((point) => point.status !== 'rolled-back');
    if (latest?.id !== id) throw new AppError('请从最近一次同步开始回滚', 409);
    const point = await this.read(id),
      directory = this.directory(id);
    if (point.host !== roots.host || point.guest !== roots.guest)
      throw new AppError('同步目录已改变，无法应用此回滚点', 409);
    const baseline: Record<string, string | null> = {};
    for (const kind of ['state', 'base'] as const) {
      const file = kind === 'state' ? this.stateFile : this.baseFile;
      const actualHash = await optionalHash(file);
      const after = kind === 'state' ? point.afterState : point.afterBase;
      if (actualHash !== point[kind] && actualHash !== after)
        throw new AppError('同步基线已改变，请先回滚后续操作', 409);
      baseline[kind] = point[kind] ? join(directory, kind + '.json') : null;
      if (baseline[kind] && (await fileHash(baseline[kind]!, signal)) !== point[kind])
        throw new AppError('回滚基线校验失败');
    }
    const verified = new Set<string>(),
      expected = new Map<string, string | null>();
    for (const entry of point.entries) {
      signal.throwIfAborted();
      const actual = await current(entry.side, entry.path);
      if (actual !== (entry.before?.sha || null) && actual !== entry.after)
        throw new AppError('同步后文件已被修改，保留现有内容：' + entry.path, 409);
      expected.set(entry.side + ':' + entry.path, actual);
      if (entry.before && !verified.has(entry.before.sha)) {
        const file = join(directory, entry.before.sha),
          info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024 ** 2)
          throw new AppError('回滚文件不安全');
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
        if (hash.digest('hex') !== entry.before.sha) throw new AppError('回滚文件校验失败：' + entry.path);
        verified.add(entry.before.sha);
      }
    }
    // Complete validation precedes the first restoration; each write checks again.
    for (const entry of [...point.entries].reverse()) {
      signal.throwIfAborted();
      const value = expected.get(entry.side + ':' + entry.path)!;
      if (value !== (entry.before?.sha || null))
        await apply(entry, entry.before ? join(directory, entry.before.sha) : null, value);
    }
    for (const kind of ['state', 'base'] as const) {
      const file = kind === 'state' ? this.stateFile : this.baseFile;
      if (baseline[kind]) {
        const bytes = await readFile(baseline[kind]!);
        if (bytes.length > 32 * 1024 ** 2 || digest(bytes) !== point[kind])
          throw new AppError('回滚基线校验失败');
        await writeStore(file, JSON.parse(bytes.toString('utf8')));
      } else await rm(file, { force: true });
    }
    point.status = 'rolled-back';
    delete point.error;
    await this.save(point);
    return { restored: point.entries.length, id: point.id };
  }
}
/**
 * 入口 / Entry: dirnameIsSymlink.
 * 功能：在保存双端同步检查点及回滚版本中，执行此领域的具体处理步骤并返回其结果；本入口产生 `info.isSymbolicLink() || !info.isDirectory()` 供上层消费（`sync-history.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `sync-history.ts`; this entry produces `info.isSymbolicLink() || !info.isDirectory()` for its caller. Module context: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
 * 处理：通过 `info.isSymbolicLink`, `info.isDirectory` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `info.isSymbolicLink`, `info.isDirectory`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: info: Awaited<ReturnType<typeof lstat>>
 * 输出 / Returns: `info.isSymbolicLink() || !info.isDirectory()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function dirnameIsSymlink(info: Awaited<ReturnType<typeof lstat>>) {
  return info.isSymbolicLink() || !info.isDirectory();
}
/**
 * 入口 / Entry: optionalHash.
 * 功能：在保存双端同步检查点及回滚版本中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await fileHash(file)` / `null` 供上层消费（`sync-history.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `sync-history.ts`; this entry produces `await fileHash(file)` / `null` for its caller. Module context: Persists two-sided sync checkpoints/rollback versions with count and size limits for recoverable history.
 * 处理：通过 `fileHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `fileHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: string
 * 输出 / Returns: `await fileHash(file)`; `null`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `(error as NodeJS.ErrnoException).code !== 'ENOENT'`; 异常 / errors `error`.
 * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `return null;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `return null;`; these statements determine whether a failure is absorbed or rejected again.
 */
async function optionalHash(file: string) {
  try {
    return await fileHash(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return null;
  }
}
