/**
 * 模块职责：管理实例黄金模板及索引，拒绝链接和特殊文件进入模板内容。
 * Module purpose: Owns golden VM templates and their index, refusing links and special files in template contents.
 */
import type { BundlesV1, JobsV1 } from './service-contracts/v1.ts';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, lstat, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  goldenActionSchema,
  goldenEntrySchema,
  goldenLimits,
  type GoldenAction,
  type GoldenEntry,
  type GoldenResult,
} from '../shared/golden-images.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { checkedId } from '../shared/paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { MAX_BUNDLE_MANIFEST } from './bundles.ts';
import { storageRuntime } from './storage-runtime.ts';
import { Jobs } from './jobs.ts';
import { fileHash, regularDirectory, writeStore } from './local-store.ts';

export class GoldenImages {
  readonly jobs: JobsV1;
  /**
   * 入口 / Entry: GoldenImages.constructor.
   * 功能：建立 GoldenImages 的管理实例黄金模板及索引上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the GoldenImages context for this module's responsibility: Owns golden VM templates and their index, refusing links and special files in template contents. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; bundles: BundlesV1; root: default=join(DATA, 'golden-images'); jobs: default=new Jobs('golden-images')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.jobs`.
   */
  constructor(
    private machines: Machines,
    private bundles: BundlesV1,
    private root = join(DATA, 'golden-images'),
    jobs = new Jobs('golden-images'),
  ) {
    this.jobs = jobs;
  }
  /**
   * 入口 / Entry: GoldenImages.directory.
   * 功能：在管理实例黄金模板及索引中，执行此领域的具体处理步骤并返回其结果；本入口产生 `path` 供上层消费（`GoldenImages`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GoldenImages`; this entry produces `path` for its caller. Module context: Owns golden VM templates and their index, refusing links and special files in template contents.
   * 处理：通过 `join`, `checkedId`, `regularDirectory` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `checkedId`, `regularDirectory`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string optional
   * 输出 / Returns: `path`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async directory(id?: string) {
    const path = id ? join(this.root, checkedId(id)) : this.root;
    await regularDirectory(path);
    return path;
  }
  /**
   * 入口 / Entry: GoldenImages.regular.
   * 功能：在管理实例黄金模板及索引中，执行此领域的具体处理步骤并返回其结果；本入口产生 `info` 供上层消费（`GoldenImages`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GoldenImages`; this entry produces `info` for its caller. Module context: Owns golden VM templates and their index, refusing links and special files in template contents.
   * 处理：通过 `lstat`, `info.isFile`, `info.isSymbolicLink` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `lstat`, `info.isFile`, `info.isSymbolicLink`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: file: string
   * 输出 / Returns: `info`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!info.isFile() || info.isSymbolicLink() || info.nlink !== 1`; 异常 / errors `new AppError('模板不能包含链接或特殊文件', 409)`.
   */
  private async regular(file: string) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
      throw new AppError('模板不能包含链接或特殊文件', 409);
    return info;
  }
  /**
   * 入口 / Entry: GoldenImages.entry.
   * 功能：在管理实例黄金模板及索引中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ entry, bundle }` 供上层消费（`GoldenImages`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GoldenImages`; this entry produces `{ entry, bundle }` for its caller. Module context: Owns golden VM templates and their index, refusing links and special files in template contents.
   * 处理：通过 `this.directory`, `join`, `this.regular`, `goldenEntrySchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.directory`, `join`, `this.regular`, `goldenEntrySchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ entry, bundle }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `info.size > 16384`; `entry.id !== id`; `(await this.regular(bundle)).size !== entry.bytes`; 异常 / errors `new AppError('模板索引过大', 409)`; `new AppError('模板标识不一致', 409)`.
   */
  private async entry(id: string) {
    const directory = await this.directory(id),
      file = join(directory, 'manifest.json');
    const info = await this.regular(file);
    if (info.size > 16384) throw new AppError('模板索引过大', 409);
    const entry = goldenEntrySchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (entry.id !== id) throw new AppError('模板标识不一致', 409);
    const bundle = join(directory, 'template.sakura');
    if ((await this.regular(bundle)).size !== entry.bytes) throw new AppError('模板文件大小不一致', 409);
    return { entry, bundle };
  }
  /**
   * 入口 / Entry: GoldenImages.view.
   * 功能：在管理实例黄金模板及索引中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ templates: templates.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), issues, limits: goldenLimits, job: this.jobs.v…` 供上层消费（`GoldenImages`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `GoldenImages`; this entry produces `{ templates: templates.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), issues, limits: goldenLimits, job: this.jobs.v…` for its caller. Module context: Owns golden VM templates and their index, refusing links and special files in template contents.
   * 处理：通过 `this.directory`, `readdir().catch`, `readdir`, `goldenEntrySchema.shape.id.safeParse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.directory`, `readdir().catch`, `readdir`, `goldenEntrySchema.shape.id.safeParse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!goldenEntrySchema.shape.id.safeParse(folder.name).success`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ templates: templates.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), issues, limits: goldenLimits, job: this.jobs.v…`.
   * 副作用 / Effects: `templates.push`; `issues.push`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `issues.push({ id: folder.name, error: '模板未完成、索引损坏或文件不可用；可检查本机文件后移除。' });`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `issues.push({ id: folder.name, error: '模板未完成、索引损坏或文件不可用；可检查本机文件后移除。' });`; these statements determine whether a failure is absorbed or rejected again.
   */
  async view() {
    const root = await this.directory();
    const folders = await readdir(root, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const templates: GoldenEntry[] = [],
      issues: { id: string; error: string }[] = [];
    for (const folder of folders) {
      if (!goldenEntrySchema.shape.id.safeParse(folder.name).success) continue;
      try {
        templates.push((await this.entry(folder.name)).entry);
      } catch {
        issues.push({ id: folder.name, error: '模板未完成、索引损坏或文件不可用；可检查本机文件后移除。' });
      }
    }
    return {
      templates: templates.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      issues,
      limits: goldenLimits,
      job: this.jobs.view('library'),
      persistenceError: this.jobs.persistenceError,
    };
  }
  /**
   * 入口 / Entry: GoldenImages.sourceAllowed.
   * 功能：在管理实例黄金模板及索引中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`GoldenImages`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GoldenImages`; the calls and state transitions below complete the operation. Module context: Owns golden VM templates and their index, refusing links and special files in template contents.
   * 处理：通过 `this.machines.requireUnlocked`, `this.machines.records.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.requireUnlocked`, `this.machines.records.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `source?.sandbox`; 异常 / errors `new AppError('沙箱实例不能固化为黄金镜像', 409)`.
   */
  private sourceAllowed(id: string) {
    this.machines.requireUnlocked(id);
    const source = this.machines.records.get(id);
    if (source?.sandbox) throw new AppError('沙箱实例不能固化为黄金镜像', 409);
  }
  /**
   * 入口 / Entry: GoldenImages.remove.
   * 功能：在管理实例黄金模板及索引中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`GoldenImages`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `GoldenImages`; the calls and state transitions below complete the operation. Module context: Owns golden VM templates and their index, refusing links and special files in template contents.
   * 处理：通过 `this.directory`, `readdir`, `inline.includes`, `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.directory`, `readdir`, `inline.includes`, `inline.test`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `rm`; `rmdir`.
   * 拒绝 / Refusals: 条件 / conditions `!['template.sakura', 'template.sakura.part', 'manifest.json'].includes(name) && !/^manifest\.json\.[a-f0-9-]{36}\.tmp$/.test(…`; 异常 / errors `new AppError('模板目录包含其他文件，请先在本机检查', 409)`.
   */
  private async remove(id: string) {
    const directory = await this.directory(id);
    // Delete only files this service owns; never recursively traverse a replaced directory.
    const files = await readdir(directory);
    for (const name of files) {
      if (
        !['template.sakura', 'template.sakura.part', 'manifest.json'].includes(name) &&
        !/^manifest\.json\.[a-f0-9-]{36}\.tmp$/.test(name)
      )
        throw new AppError('模板目录包含其他文件，请先在本机检查', 409);
      await this.regular(join(directory, name));
    }
    for (const name of files.sort((a, b) => Number(a === 'manifest.json') - Number(b === 'manifest.json')))
      await rm(join(directory, name));
    await rmdir(directory);
  }
  /**
   * 入口 / Entry: GoldenImages.create.
   * 功能：从实例或配置创建可重复使用的黄金模板并更新经过校验的模板索引。
   * Purpose: Creates reusable golden templates from VM/configuration data and updates the verified template index.
   * 设计：模板成员只允许受支持普通内容，生成暂存和最终索引分阶段发布，失败不覆盖已有有效模板。
   * Design: Only supported regular contents enter templates; staging/index publication is phased and failure preserves existing valid templates.
   * 输入 / Inputs: input: Extract<GoldenAction, { action: 'create' }>; signal: AbortSignal; log: (text: string) => void
   * 输出 / Returns: `this.bundles.withExportBudget(input.vmId, signal, (diskBytes, exportFile) => storageRuntime.run( { owner: 'core:golden-image'…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `view.issues.length`; `view.templates.length >= goldenLimits.count`; 异常 / errors `new AppError('请先处理未完成或损坏的模板', 409)`; `new AppError('最多保留 16 个黄金镜像', 409)`.
   */
  private async create(
    input: Extract<GoldenAction, { action: 'create' }>,
    signal: AbortSignal,
    log: (text: string) => void,
  ) {
    this.sourceAllowed(input.vmId);
    this.machines.requireStopped(input.vmId);
    let source = { ...this.machines.get(input.vmId) };
    const view = await this.view();
    if (view.issues.length) throw new AppError('请先处理未完成或损坏的模板', 409);
    if (view.templates.length >= goldenLimits.count) throw new AppError('最多保留 16 个黄金镜像', 409);
    const root = await this.directory();
    signal.throwIfAborted();
    const id = randomUUID(),
      directory = await this.directory(id);
    /**
     * 入口 / Entry: GoldenImages.create.callback@136.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（storageRuntime.run）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (storageRuntime.run).
     * 输入 / Inputs: lease
     * 输出 / Returns: `{ kind: 'template', id } as const`.
     * 副作用 / Effects: `mkdir`; `createWriteStream`; `target.destroy`; `rename`; `writeStore`; 更新 / updates `published`.
     * 拒绝 / Refusals: 条件 / conditions `view.templates.reduce((sum, row) => sum + row.bytes, 0) + bytes > goldenLimits.bytes`; `!published`; 异常 / errors `new AppError('黄金镜像库总容量不能超过 128 GiB', 409)`; `error`.
     * 收尾：退出 try 区域时始终执行 `if (!published) try { await this.remove(id); } catch (error) { lease.cleanupPending(error); throw error; }`; `target.destroy();`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `if (!published) try { await this.remove(id); } catch (error) { lease.cleanupPending(error); throw error; }`; `target.destroy();`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `lease.cleanupPending(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `lease.cleanupPending(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.bundles.withExportBudget(input.vmId, signal, (diskBytes, exportFile) =>
      storageRuntime.run(
        {
          owner: 'core:golden-image',
          taskId: 'golden:' + id,
          label: 'Publish golden image',
          mode: 'write',
          paths: [root, DATA],
          buffers: 20 * 1024 ** 2,
          files: 8,
          signal,
          temporary: [
            { path: DATA, bytes: diskBytes },
            { path: root, bytes: diskBytes + MAX_BUNDLE_MANIFEST + 12 },
          ],
        },
        /**
         * 中文功能：将停止实例导出到独占私有 part 文件，校验容量和摘要后重命名并保存 manifest，未发布则移除目录。
         * English: Exports a stopped VM to an exclusive private part file, checks capacity/hash, renames and saves the manifest, removing the directory if publication fails.
         * 所属 / Owner: GoldenImages.create.
         * 输入 / Inputs: lease.
         */
        async (lease) => {
          await mkdir(root, { recursive: true, mode: 0o700 });
          await mkdir(directory, { mode: 0o700 });
          let published = false;
          try {
            const part = join(directory, 'template.sakura.part');
            const target = createWriteStream(part, { flags: 'wx', mode: 0o600 });
            // Conversion precedes pipeline setup; observe a file-open error immediately.
            const drained = finished(target).catch(() => {});
            try {
              await once(target, 'open');
              log('正在固化停止后的磁盘与项目配置…\n');
              await exportFile(
                target,
                () => {
                  source = { ...this.machines.get(input.vmId) };
                },
                0,
                (error) => lease.cleanupPending(error),
              );
            } finally {
              target.destroy();
              await drained;
            }

            const bytes = (await this.regular(part)).size;
            if (view.templates.reduce((sum, row) => sum + row.bytes, 0) + bytes > goldenLimits.bytes)
              throw new AppError('黄金镜像库总容量不能超过 128 GiB', 409);
            log('正在校验独立实例包…\n');
            const sha256 = await fileHash(part, signal);
            const entry = goldenEntrySchema.parse({
              version: 1,
              id,
              name: input.name,
              note: input.note,
              createdAt: new Date().toISOString(),
              sourceId: source.id,
              sourceName: source.name,
              distro: source.distro || 'alpine',
              architecture: source.architecture,
              diskGiB: source.diskGiB,
              bytes,
              sha256,
            });
            signal.throwIfAborted();

            await rename(part, join(directory, 'template.sakura'));
            await writeStore(join(directory, 'manifest.json'), entry);
            published = true;
            log('黄金镜像已保存，可独立于源实例重复创建新实例。\n');
            return { kind: 'template', id } as const;
          } finally {
            if (!published)
              try {
                await this.remove(id);
              } catch (error) {
                lease.cleanupPending(error);
                throw error;
              }
          }
        },
      ),
    );
  }
  /**
   * 入口 / Entry: GoldenImages.action.
   * 功能：在管理实例黄金模板及索引中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.jobs.track( 'library', async (log, abort) => { abort.throwIfAborted(); if (input.action === 'create') return this.create…` 供上层消费（`GoldenImages`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GoldenImages`; this entry produces `this.jobs.track( 'library', async (log, abort) => { abort.throwIfAborted(); if (input.action === 'create') return this.create…` for its caller. Module context: Owns golden VM templates and their index, refusing links and special files in template contents.
   * 处理：通过 `goldenActionSchema.parse`, `this.jobs.track` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `goldenActionSchema.parse`, `this.jobs.track`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: raw: unknown; signal: AbortSignal optional
   * 输出 / Returns: Promise<GoldenResult>；结果来自 / values from `this.jobs.track( 'library', async (log, abort) => { abort.throwIfAborted(); if (input.action === 'create') return this.create…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async action(raw: unknown, signal?: AbortSignal): Promise<GoldenResult> {
    const input = goldenActionSchema.parse(raw);
    /**
     * 入口 / Entry: GoldenImages.action.callback@204.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.track / library）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.track / library).
     * 输入 / Inputs: log; abort
     * 输出 / Returns: `this.create(input, abort, log)`; `{ kind: 'deleted', id: input.id }`; `{ kind: 'verified', id: input.id }`；另有分支返回 / additional branch-specific returns.
     * 副作用 / Effects: `abort.throwIfAborted`; `this.create`.
     * 拒绝 / Refusals: 条件 / conditions `checksum !== entry.sha256`; 异常 / errors `new AppError('模板 SHA-256 校验失败', 409)`.
     */
    return this.jobs.track(
      'library',
      async (log, abort) => {
        abort.throwIfAborted();
        if (input.action === 'create') return this.create(input, abort, log);
        if (input.action === 'delete') {
          await this.remove(input.id);
          log('模板已移除；已创建的实例保留。\n');
          return { kind: 'deleted', id: input.id };
        }
        const { entry, bundle } = await this.entry(input.id);
        this.sourceAllowed(entry.sourceId);
        log('正在检查模板 SHA-256…\n');
        const checksum = await storageRuntime.run(
          {
            owner: 'core:golden-verify',
            taskId: 'golden-verify:' + entry.id,
            label: 'Verify golden image',
            mode: 'read',
            paths: [bundle],
            buffers: 256 * 1024,
            files: 1,
            signal: abort,
          },
          () => fileHash(bundle, abort),
        );
        if (checksum !== entry.sha256) throw new AppError('模板 SHA-256 校验失败', 409);
        this.sourceAllowed(entry.sourceId);
        if (input.action === 'verify') {
          log('模板文件校验通过。\n');
          return { kind: 'verified', id: input.id };
        }
        log('正在创建独立实例…\n');
        /**
         * 入口 / Entry: GoldenImages.action.callback@247.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（storageRuntime.run）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (storageRuntime.run).
         * 输入 / Inputs: lease
         * 输出 / Returns: `await this.bundles.import( input.name, source, abort, () => this.sourceAllowed(entry.sourceId), undefined, lease.cleanupPendi…`.
         * 副作用 / Effects: `createReadStream`; `source.destroy`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         * 收尾：退出 try 区域时始终执行 `source.destroy();`; `await finished(source).catch(() => {});`；这些步骤也适用于异常退出。
         * Finalization: Leaving the try region always executes `source.destroy();`; `await finished(source).catch(() => {});`; these steps also apply to exceptional exits.
         */
        const vm = await storageRuntime.run(
          {
            owner: 'core:golden-import',
            taskId: 'golden-import:' + entry.id,
            label: 'Instantiate golden image',
            mode: 'write',
            paths: [bundle, DATA],
            dynamicTemporary: [DATA],
            buffers: 20 * 1024 ** 2,
            files: 8,
            signal: abort,
          },
          async (lease) => {
            const source = createReadStream(bundle, { signal: abort });
            try {
              return await this.bundles.import(
                input.name,
                source,
                abort,
                () => this.sourceAllowed(entry.sourceId),
                undefined,
                lease.cleanupPending,
                lease,
              );
            } finally {
              source.destroy();
              await finished(source).catch(() => {});
            }
          },
        );
        log(`已创建 ${vm.name}；首次启动将更新控制连接身份。\n`);
        return { kind: 'vm', id: vm.id };
      },
      {
        title: '黄金镜像库',
        action: 'golden:' + input.action,
        ...(input.action === 'create' ? { vmId: input.vmId } : {}),
      },
      signal,
    );
  }
  /**
   * 入口 / Entry: GoldenImages.close.
   * 功能：把本层请求转交 `this.jobs.close`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.jobs.close` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.jobs.close()`.
   * 副作用 / Effects: `this.jobs.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() {
    return this.jobs.close();
  }
}
