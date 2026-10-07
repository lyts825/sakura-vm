/**
 * 模块职责：规划并复制数据目录，保留可取消的切换意图；拒绝目录重叠与链接等不受控成员。
 * Module purpose: Plans and copies data-directory migrations with cancellable activation intent, refusing overlap, links and unsupported members.
 */
import type { JobsV1 } from './service-contracts/v1.ts';
import { mkdir, readdir, lstat, statfs, copyFile, rename, rm, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative, dirname, resolve, basename, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DATA } from './paths.ts';
import { storageRuntime } from './storage-runtime.ts';
import { DataDirectoryOwner } from './data-directory-owner.ts';
import { AppError } from '../shared/errors.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { Jobs } from './jobs.ts';
import { fileHash, regularDirectory, within, readStore, writeStore } from './local-store.ts';
import { encryptedImageOptions, qemuSecretObject } from './disk-encryption.ts';

type MigrationFile = { path: string; bytes: number; modified: number };
export class DataMigration {
  /**
   * 签名 / Signature: DataMigration.releaseMaintenance.
   * 功能：为规划并复制数据目录声明 releaseMaintenance 的输入与结果契约，所属容器为 DataMigration。
   * Purpose: Declares the input/result contract for releaseMaintenance in DataMigration. Module responsibility: Plans and copies data-directory migrations with cancellable activation intent, refusing overlap, links and unsupported members.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private releaseMaintenance?: () => void;
  jobs = new Jobs('migration');
  private target?: string;
  private copyPublished = false;
  private retainedOwner?: DataDirectoryOwner;
  blocked = false;
  /**
   * 入口 / Entry: DataMigration.constructor.
   * 功能：建立 DataMigration 的规划并复制数据目录上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the DataMigration context for this module's responsibility: Plans and copies data-directory migrations with cancellable activation intent, refusing overlap, links and unsupported members. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; stores: () => ReadonlyArray<Pick<JobsV1, 'list' | 'flush'>>; source: default=DATA
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private stores: () => ReadonlyArray<Pick<JobsV1, 'list' | 'flush'>>,
    private source = DATA,
  ) {}
  /**
   * 入口 / Entry: DataMigration.view.
   * 功能：在规划并复制数据目录中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ source: this.source, target: this.target, restartRequired: this.copyPublished, blocked: this.blocked, job: this.jobs.view('…` 供上层消费（`DataMigration`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `DataMigration`; this entry produces `{ source: this.source, target: this.target, restartRequired: this.copyPublished, blocked: this.blocked, job: this.jobs.view('…` for its caller. Module context: Plans and copies data-directory migrations with cancellable activation intent, refusing overlap, links and unsupported members.
   * 处理：通过 `this.jobs.view`, `readStore`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.jobs.view`, `readStore`, `join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ source: this.source, target: this.target, restartRequired: this.copyPublished, blocked: this.blocked, job: this.jobs.view('…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view() {
    return {
      source: this.source,
      target: this.target,
      restartRequired: this.copyPublished,
      blocked: this.blocked,
      job: this.jobs.view('data'),
      previous: await readStore(join(this.source, '.sakura-migration.json'), () => null),
    };
  }
  /**
   * 入口 / Entry: DataMigration.files.
   * 功能：在规划并复制数据目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `items.sort((a, b) => a.path.localeCompare(b.path))` 供上层消费（`DataMigration`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DataMigration`; this entry produces `items.sort((a, b) => a.path.localeCompare(b.path))` for its caller. Module context: Plans and copies data-directory migrations with cancellable activation intent, refusing overlap, links and unsupported members.
   * 处理：通过 `scan`, `items.sort` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `scan`, `items.sort`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `items.sort((a, b) => a.path.localeCompare(b.path))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async files() {
    const items: MigrationFile[] = [];
    /**
     * 入口 / Entry: DataMigration.files.scan.
     * 功能：在规划并复制数据目录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`DataMigration`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `DataMigration`; the calls and state transitions below complete the operation. Module context: Plans and copies data-directory migrations with cancellable activation intent, refusing overlap, links and unsupported members.
     * 处理：通过 `readdir`, `join`, `inline.includes`, `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `readdir`, `join`, `inline.includes`, `inline.test`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `!folder && (['posixloom', '.sakura-redirect.json', '.sakura-migration.json'].includes(item.name) || …`; `path === join('jobs', 'migration.json') || item.name.endsWith('.tmp') || item.name.endsWith('.part')`; `info.isDirectory()`.
     * 输入 / Inputs: folder: string
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `items.push`.
     * 拒绝 / Refusals: 条件 / conditions `info.isSymbolicLink()`; 异常 / errors `new AppError(`迁移目录含符号链接或联接，请先处理：${path}`)`; `new AppError(`不支持迁移的文件类型：${path}`)`.
     */
    const scan = async (folder: string) => {
      for (const item of await readdir(join(this.source, folder), { withFileTypes: true })) {
        const path = join(folder, item.name);
        if (
          !folder &&
          (['posixloom', '.sakura-redirect.json', '.sakura-migration.json'].includes(item.name) ||
            /^\.(decrypt|encrypted-import)-/.test(item.name))
        )
          continue;
        if (
          path === join('jobs', 'migration.json') ||
          item.name.endsWith('.tmp') ||
          item.name.endsWith('.part')
        )
          continue;
        const info = await lstat(join(this.source, path));
        if (info.isSymbolicLink()) throw new AppError(`迁移目录含符号链接或联接，请先处理：${path}`);
        if (info.isDirectory()) await scan(path);
        else if (info.isFile()) items.push({ path, bytes: info.size, modified: info.mtimeMs });
        else throw new AppError(`不支持迁移的文件类型：${path}`);
      }
    };
    await scan('');
    return items.sort((a, b) => a.path.localeCompare(b.path));
  }
  /**
   * 入口 / Entry: DataMigration.plan.
   * 功能：在规划并复制数据目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ source, target, bytes, available, count: files.length, token, files }` 供上层消费（`DataMigration`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DataMigration`; this entry produces `{ source, target, bytes, available, count: files.length, token, files }` for its caller. Module context: Plans and copies data-directory migrations with cancellable activation intent, refusing overlap, links and unsupported members.
   * 处理：通过 `isAbsolute`, `regularDirectory`, `realpath`, `within` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `isAbsolute`, `regularDirectory`, `realpath`, `within`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: string
   * 输出 / Returns: `{ source, target, bytes, available, count: files.length, token, files }`.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`; 更新 / updates `parent`.
   * 拒绝 / Refusals: 条件 / conditions `typeof input !== 'string' || !isAbsolute(input)`; `within(source, target) || within(target, source)`; `this.machines.storagePools.conflictsWithDataTarget(target)`; 异常 / errors `new AppError('请输入目标磁盘上的新目录绝对路径')`; `new AppError('目标目录不能与当前数据目录相同或相互包含')`.
   */
  async plan(input: string) {
    if (typeof input !== 'string' || !isAbsolute(input))
      throw new AppError('请输入目标磁盘上的新目录绝对路径');
    const target = await regularDirectory(input);
    const source = await realpath(await regularDirectory(this.source));
    if (within(source, target) || within(target, source))
      throw new AppError('目标目录不能与当前数据目录相同或相互包含');
    if (this.machines.storagePools.conflictsWithDataTarget(target))
      throw new AppError('目标目录不能与已注册存储池相互包含', 409);
    if ([...this.machines.records.values()].some((vm) => vm.storagePoolId && vm.storagePoolId !== 'default'))
      throw new AppError('请先将外部存储池的实例迁回默认池，再迁移数据目录', 409);
    const exists = await lstat(target).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (exists) throw new AppError('目标目录必须尚未存在，迁移会为你创建');
    await Promise.all(this.stores().map((store) => store.flush()));
    const files = await this.files(),
      bytes = files.reduce((total, item) => total + item.bytes, 0);
    let parent = dirname(target);
    while (!(await lstat(parent).catch(() => null))) parent = dirname(parent);
    const volume = await statfs(parent),
      available = volume.bavail * volume.bsize;
    if (available < bytes + 64 * 1024 ** 2) throw new AppError('目标磁盘空间不足，需额外保留 64 MiB');
    const token = createHash('sha256').update(JSON.stringify({ source, target, files })).digest('hex');
    return { source, target, bytes, available, count: files.length, token, files };
  }
  /**
   * 入口 / Entry: DataMigration.start.
   * 功能：复核预览 token 后进入维护并复制数据到目标目录，提交待激活的目录切换记录。
   * Purpose: Rechecks the preview token, enters maintenance, copies data and publishes a pending directory activation record.
   * 设计：先排空任务并取得目标归属，按文件类型和摘要验证复制；切换意图可恢复，失败释放维护但保留明确恢复证据。
   * Design: Jobs drain and target ownership is acquired before copying; type/hash checks precede recoverable activation intent and failure retains evidence.
   * 输入 / Inputs: input: string; token: string
   * 输出 / Returns: `job`.
   * 副作用 / Effects: `this.jobs.start`; `this.releaseMaintenance`; 更新 / updates `this.releaseMaintenance`, `this.blocked`, `this.target`.
   * 拒绝 / Refusals: 条件 / conditions `this.blocked`; `this.stores().some((store) => store.list().some((job) => job.status === 'running'))`; `plan.token !== token`; 异常 / errors `new AppError('另一项迁移正在进行或等待重启', 409)`; `new AppError('请等待全部后台任务结束', 409)`.
   * 失败处理：catch 分支执行 `this.blocked = false;`; `this.releaseMaintenance?.();`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.blocked = false;`; `this.releaseMaintenance?.();`; these statements determine whether a failure is absorbed or rejected again.
   */
  async start(input: string, token: string) {
    if (this.blocked) throw new AppError('另一项迁移正在进行或等待重启', 409);
    if (this.stores().some((store) => store.list().some((job) => job.status === 'running')))
      throw new AppError('请等待全部后台任务结束', 409);
    this.releaseMaintenance = this.machines.enterMaintenance();
    this.blocked = true;
    try {
      await Promise.all(this.stores().map((store) => store.flush()));
      const plan = await this.plan(input);
      if (plan.token !== token) throw new AppError('数据已变化，请重新预览迁移', 409);
      this.target = plan.target;
      const id = randomUUID(),
        stage = join(dirname(plan.target), `.sakura-migrate-${id}`);
      /**
       * 入口 / Entry: DataMigration.start.callback@110.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start / data）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start / data).
       * 输入 / Inputs: log; signal; update
       * 输出 / Returns: `await storageRuntime.run( { owner: 'core:data-migration', taskId: 'data-migration:' + id, label: 'Copy and verify data direct…`.
       * 副作用 / Effects: `DataDirectoryOwner.acquire`; `owner.close`; 更新 / updates `this.retainedOwner`.
       * 拒绝 / Refusals: 条件 / conditions `await lstat(plan.target).catch((error) => { if (error.code === 'ENOENT') return null; throw error; })`; 异常 / errors `new AppError('迁移目标已被其他操作创建，请重新预览', 409)`.
       * 收尾：退出 try 区域时始终执行 `if (unsafeCleanup) this.retainedOwner = owner; else await owner.close();`；这些步骤也适用于异常退出。
       * Finalization: Leaving the try region always executes `if (unsafeCleanup) this.retainedOwner = owner; else await owner.close();`; these steps also apply to exceptional exits.
       */
      const job = this.jobs.start(
        'data',
        async (log, signal, update) => {
          const owner = await DataDirectoryOwner.acquire(plan.target, { create: false });
          let unsafeCleanup = false;
          try {
            if (
              await lstat(plan.target).catch((error) => {
                if (error.code === 'ENOENT') return null;
                throw error;
              })
            )
              throw new AppError('迁移目标已被其他操作创建，请重新预览', 409);
            /**
             * 入口 / Entry: DataMigration.start.callback@133.
             * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（storageRuntime.run）。
             * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (storageRuntime.run).
             * 输入 / Inputs: lease
             * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
             * 副作用 / Effects: `mkdir`; `update`; `writeStore`; `rm`; `rename`; 更新 / updates `staged`, `copied`, `entry.directory`, `changed`.
             * 拒绝 / Refusals: 条件 / conditions `!within(stage, destination)`; `before !== after || info.size !== file.bytes || info.mtimeMs !== file.modified`; `staged && dirname(stage) === dirname(plan.target) && basename(stage) === `.sakura-migrate-${id}``; 异常 / errors `new AppError('迁移路径越界')`; `new AppError(`源文件发生变化或校验失败：${file.path}`)`.
             * 收尾：退出 try 区域时始终执行 `if ( staged && dirname(stage) === dirname(plan.target) && basename(stage) === `.sakura-migrate-${id}` ) try { await rm(stage,…`；这些步骤也适用于异常退出。
             * Finalization: Leaving the try region always executes `if ( staged && dirname(stage) === dirname(plan.target) && basename(stage) === `.sakura-migrate-${id}` ) try { await rm(stage,…`; these steps also apply to exceptional exits.
             * 失败处理：catch 分支执行 `this.blocked = false;`; `this.releaseMaintenance?.();`，是否吞掉错误或重新拒绝由这些语句决定。
             * Failure handling: Catch paths execute `this.blocked = false;`; `this.releaseMaintenance?.();`; these statements determine whether a failure is absorbed or rejected again.
             */
            return await storageRuntime.run(
              {
                owner: 'core:data-migration',
                taskId: 'data-migration:' + id,
                label: 'Copy and verify data directory',
                mode: 'write',
                paths: [this.source, plan.target],
                temporary: [{ path: plan.target, bytes: plan.bytes + 64 * 1024 ** 2 }],
                buffers: 1024 ** 2,
                files: 8,
                signal,
              },
              async (lease) => {
                let staged = false;
                try {
                  await mkdir(dirname(stage), { recursive: true });
                  await mkdir(stage, { mode: 0o700 });
                  staged = true;
                  let copied = 0;
                  for (const file of plan.files) {
                    signal.throwIfAborted();
                    const sourceFile = join(this.source, file.path),
                      destination = join(stage, file.path);
                    if (!within(stage, destination)) throw new AppError('迁移路径越界');
                    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
                    update(`复制与校验 ${file.path}`, plan.bytes ? (copied / plan.bytes) * 75 : 0);
                    await copyFile(sourceFile, destination, constants.COPYFILE_EXCL);
                    const [before, after] = await Promise.all([
                      fileHash(sourceFile, signal),
                      fileHash(destination, signal),
                    ]);
                    const info = await lstat(sourceFile);
                    if (before !== after || info.size !== file.bytes || info.mtimeMs !== file.modified)
                      throw new AppError(`源文件发生变化或校验失败：${file.path}`);
                    copied += file.bytes;
                  }
                  for (const vm of this.machines.records.values()) {
                    signal.throwIfAborted();
                    const disk = join(stage, 'machines', vm.id, 'disk.qcow2');
                    const info = JSON.parse(
                      await this.machines.engine.run(
                        'sakura-img',
                        ['info', '--output=json', '-f', 'qcow2', disk],
                        {
                          signal,
                        },
                      ),
                    );
                    const backing: string | undefined =
                      info['full-backing-filename'] || info['backing-filename'];
                    if (backing && within(this.source, resolve(backing))) {
                      const next = join(plan.target, relative(this.source, resolve(backing)));
                      await this.machines.engine.run(
                        'sakura-img',
                        ['rebase', '-u', '-f', 'qcow2', '-F', 'qcow2', '-b', next, disk],
                        { signal },
                      );
                      log(`已修复 ${vm.name} 的基础镜像路径。\n`);
                    }
                  }
                  for (const file of plan.files.filter((item) =>
                    /^backups[\\/][^\\/]+[\\/]index\.json$/.test(item.path),
                  )) {
                    const backup = await readStore<{
                      policy: { directory?: string };
                      items: { directory?: string }[];
                    }>(join(stage, file.path), () => ({ policy: {}, items: [] }));
                    let changed = false;
                    for (const entry of [backup.policy, ...backup.items])
                      if (entry.directory && within(this.source, entry.directory)) {
                        entry.directory = join(plan.target, relative(this.source, entry.directory));
                        changed = true;
                      }
                    if (changed) await writeStore(join(stage, file.path), backup);
                  }
                  // Managed SSH entries are regenerated after restart, before using any VM.
                  await rm(join(stage, 'ssh', 'config'), { force: true });
                  signal.throwIfAborted();
                  await rename(stage, plan.target);
                  staged = false;
                  update('核对迁移后的虚拟磁盘', 85);
                  for (const vm of this.machines.records.values()) {
                    signal.throwIfAborted();
                    const sourceDisk = join(this.source, 'machines', vm.id, 'disk.qcow2');
                    const targetDisk = join(plan.target, 'machines', vm.id, 'disk.qcow2');
                    if (vm.diskEncryption)
                      await this.machines.withDiskSecret(vm, (secret) =>
                        this.machines.engine.run(
                          'sakura-img',
                          [
                            'compare',
                            '--object',
                            qemuSecretObject(secret),
                            '--image-opts',
                            encryptedImageOptions(sourceDisk),
                            encryptedImageOptions(targetDisk),
                          ],
                          { signal },
                        ),
                      );
                    else
                      await this.machines.engine.run(
                        'sakura-img',
                        ['compare', '-f', 'qcow2', '-F', 'qcow2', sourceDisk, targetDisk],
                        { signal },
                      );
                  }
                  const marker = {
                    id,
                    source: resolve(this.source),
                    target: plan.target,
                    completedAt: new Date().toISOString(),
                    bytes: plan.bytes,
                    files: plan.count,
                  };
                  await writeStore(join(plan.target, '.sakura-migration.json'), marker);
                  signal.throwIfAborted();
                  await writeStore(join(this.source, '.sakura-redirect.json'), {
                    version: 1,
                    target: plan.target,
                    id,
                  });
                  this.copyPublished = true;
                  log('复制、校验和路径修复已完成。重启服务后使用新目录；原目录仍保留。\n');
                } catch (error) {
                  this.blocked = false;
                  this.releaseMaintenance?.();
                  throw error;
                } finally {
                  if (
                    staged &&
                    dirname(stage) === dirname(plan.target) &&
                    basename(stage) === `.sakura-migrate-${id}`
                  )
                    try {
                      await rm(stage, { recursive: true, force: true });
                    } catch (error) {
                      unsafeCleanup = true;
                      lease.cleanupPending(error);
                      throw error;
                    }
                }
              },
            );
          } finally {
            if (unsafeCleanup) this.retainedOwner = owner;
            else await owner.close();
          }
        },
        { title: '数据目录迁移' },
      );
      void this.jobs.wait('data').then(() => {
        if (!this.copyPublished) {
          this.blocked = false;
          this.releaseMaintenance?.();
        }
      });
      return job;
    } catch (error) {
      this.blocked = false;
      this.releaseMaintenance?.();
      throw error;
    }
  }
  /**
   * 入口 / Entry: DataMigration.cancelActivation.
   * 功能：在规划并复制数据目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.view()` 供上层消费（`DataMigration`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DataMigration`; this entry produces `this.view()` for its caller. Module context: Plans and copies data-directory migrations with cancellable activation intent, refusing overlap, links and unsupported members.
   * 处理：通过 `this.jobs.view`, `rm`, `join`, `this.releaseMaintenance` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.jobs.view`, `rm`, `join`, `this.releaseMaintenance`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.view()`.
   * 副作用 / Effects: `rm`; `this.releaseMaintenance`; 更新 / updates `this.copyPublished`, `this.blocked`.
   * 拒绝 / Refusals: 条件 / conditions `!this.copyPublished || this.jobs.view('data')?.status === 'running'`; 异常 / errors `new AppError('迁移尚未完成')`.
   */
  async cancelActivation() {
    if (!this.copyPublished || this.jobs.view('data')?.status === 'running')
      throw new AppError('迁移尚未完成');
    await rm(join(this.source, '.sakura-redirect.json'));
    this.copyPublished = false;
    this.blocked = false;
    this.releaseMaintenance?.();
    return this.view();
  }
  /**
   * 入口 / Entry: DataMigration.close.
   * 功能：在规划并复制数据目录中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`DataMigration`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `DataMigration`; the calls and state transitions below complete the operation. Module context: Plans and copies data-directory migrations with cancellable activation intent, refusing overlap, links and unsupported members.
   * 处理：通过 `this.jobs.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.jobs.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.jobs.close`.
   * 拒绝 / Refusals: 条件 / conditions `this.retainedOwner`; 异常 / errors `new AppError('迁移目录清理尚未确认，保留目标归属', 503, 'STORAGE_CLEANUP_PENDING')`.
   */
  async close() {
    await this.jobs.close();
    if (this.retainedOwner)
      throw new AppError('迁移目录清理尚未确认，保留目标归属', 503, 'STORAGE_CLEANUP_PENDING');
  }
}
