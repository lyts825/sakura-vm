/**
 * 模块职责：登记并绑定宿主存储池，拒绝路径重叠并维护失败清理的原池资源记录。
 * Module purpose: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
 */
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, rm, rmdir, stat, statfs, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import type { VmStoragePoolOwnerPort } from './vm-ports.ts';
import { AppError } from '../shared/errors.ts';
import { DATA, VM_ROOT, setVmStorageRoot, vmDir } from './paths.ts';
import { checkedId } from '../shared/paths.ts';
import { readStore, regularDirectory, within } from './local-store.ts';
import { MetadataStore } from './metadata-store.ts';

const idSchema = z.string().regex(/^(default|[a-f0-9]{16})$/);
export const storagePoolInput = z
  .object({
    mode: z.enum(['list', 'create', 'remove', 'move', 'cleanup']).default('list'),
    name: z.string().trim().max(60).default(''),
    path: z.string().max(4096).default(''),
    poolId: idSchema.default('default'),
    vmId: z.uuid().optional(),
  })
  .strict();
const poolSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{16}$/),
    name: z.string().min(1).max(60),
    root: z.string().min(1).max(4096),
    createdAt: z.iso.datetime(),
  })
  .strict();
type Pool = z.infer<typeof poolSchema>;
const orphanSchema = z
  .object({
    vmId: z.uuid(),
    sourcePoolId: idSchema,
    targetPoolId: idSchema,
    addedAt: z.iso.datetime(),
  })
  .strict();
const storeSchema = z
  .object({
    version: z.literal(1),
    pools: z.array(poolSchema).max(8),
    pendingCleanup: z.array(orphanSchema).max(128).default([]),
  })
  .strict();
/**
 * 入口 / Entry: poolFolder.
 * 功能：把本层请求转交 `join`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `join` and propagates the provider result or rejection.
 * 输入 / Inputs: root: string
 * 输出 / Returns: `join(root, 'sakura-machines')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const poolFolder = (root: string) => join(root, 'sakura-machines');
/**
 * 入口 / Entry: marker.
 * 功能：在登记并绑定宿主存储池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(poolFolder(root), '.sakura-pool.json')` 供上层消费（`storage-pools.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `storage-pools.ts`; this entry produces `join(poolFolder(root), '.sakura-pool.json')` for its caller. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
 * 处理：通过 `join`, `poolFolder` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `join`, `poolFolder`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: root: string
 * 输出 / Returns: `join(poolFolder(root), '.sakura-pool.json')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const marker = (root: string) => join(poolFolder(root), '.sakura-pool.json');

import { storageRuntime, type StorageLease } from './storage-runtime.ts';

export class StoragePools {
  private cleanupLeases = new Map<string, StorageLease>();
  /**
   * 入口 / Entry: StoragePools.retainCleanup.
   * 功能：在登记并绑定宿主存储池中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`StoragePools`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StoragePools`; the calls and state transitions below complete the operation. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `lease.cleanupPending`, `this.cleanupLeases.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `lease.cleanupPending`, `this.cleanupLeases.set`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; sourcePoolId: string; targetPoolId: string; lease: StorageLease; error: unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.cleanupLeases.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  retainCleanup(
    vmId: string,
    sourcePoolId: string,
    targetPoolId: string,
    lease: StorageLease,
    error: unknown,
  ) {
    lease.cleanupPending(error);
    this.cleanupLeases.set(`${vmId}:${sourcePoolId}:${targetPoolId}`, lease);
  }
  private state?: z.infer<typeof storeSchema>;
  private metadata: MetadataStore<z.infer<typeof storeSchema>>;
  /**
   * 入口 / Entry: StoragePools.constructor.
   * 功能：建立 StoragePools 的登记并绑定宿主存储池上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the StoragePools context for this module's responsibility: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: VmStoragePoolOwnerPort; file: default=join(DATA, 'storage-pools.json')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.metadata`.
   */
  constructor(
    private machines: VmStoragePoolOwnerPort,
    private file = join(DATA, 'storage-pools.json'),
  ) {
    this.metadata = new MetadataStore(file, {
      /**
       * 入口 / Entry: StoragePools.constructor.fallback.
       * 功能：从当前输入或状态计算 `({ version: 1, pools: [], pendingCleanup: [] })`，供调用方后续验证或使用。
       * Purpose: Computes `({ version: 1, pools: [], pendingCleanup: [] })` from current inputs/state for the caller to validate or consume.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `({ version: 1, pools: [], pendingCleanup: [] })`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      fallback: () => ({ version: 1, pools: [], pendingCleanup: [] }),
      /**
       * 入口 / Entry: StoragePools.constructor.parse.
       * 功能：把本层请求转交 `storeSchema.parse`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `storeSchema.parse` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `storeSchema.parse(value)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      parse: (value) => storeSchema.parse(value),
    });
  }

  /**
   * 入口 / Entry: StoragePools.init.
   * 功能：在登记并绑定宿主存储池中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`StoragePools`）。
   * Purpose: Initializes and verifies current domain state in `StoragePools`; the outcome is recorded in `this.state`. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `this.metadata.read`, `this.state.pools.map`, `isAbsolute`, `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.metadata.read`, `this.state.pools.map`, `isAbsolute`, `inline.test`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.state`.
   * 拒绝 / Refusals: 条件 / conditions `!isAbsolute(root) || /[\x00-\x1f]/.test(root)`; `within(paths[i], paths[j]) || within(paths[j], paths[i])`; 异常 / errors `new AppError('存储池目录无效，无法加载实例', 503)`; `new AppError('存储池目录重叠，无法加载实例', 503)`.
   */
  async init() {
    this.state = (await this.metadata.read()).value;
    const paths = [DATA, ...this.state.pools.map((pool) => pool.root)];
    for (const root of paths) {
      if (!isAbsolute(root) || /[\x00-\x1f]/.test(root))
        throw new AppError('存储池目录无效，无法加载实例', 503);
    }
    for (let i = 1; i < paths.length; i++)
      for (let j = 0; j < i; j++)
        if (within(paths[i], paths[j]) || within(paths[j], paths[i]))
          throw new AppError('存储池目录重叠，无法加载实例', 503);
  }

  /**
   * 入口 / Entry: StoragePools.change.
   * 功能：在登记并绑定宿主存储池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `committed.result` 供上层消费（`StoragePools`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StoragePools`; this entry produces `committed.result` for its caller. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `this.metadata.update` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.metadata.update`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: edit: (state: z.infer<typeof storeSchema>) => T
   * 输出 / Returns: `committed.result`.
   * 副作用 / Effects: `this.metadata.update`; 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async change<T>(edit: (state: z.infer<typeof storeSchema>) => T) {
    const committed = await this.metadata.update(edit);
    this.state = committed.value;
    return committed.result;
  }

  /**
   * 入口 / Entry: StoragePools.pool.
   * 功能：在登记并绑定宿主存储池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `null` / `pool` 供上层消费（`StoragePools`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StoragePools`; this entry produces `null` / `pool` for its caller. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `inline.pools.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.pools.find`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `id === 'default'`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Pool | null；结果来自 / values from `null`; `pool`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!pool`; 异常 / errors `new AppError('存储池不存在', 404)`.
   */
  private pool(id: string): Pool | null {
    if (id === 'default') return null;
    const pool = this.state!.pools.find((item) => item.id === id);
    if (!pool) throw new AppError('存储池不存在', 404);
    return pool;
  }

  /**
   * 入口 / Entry: StoragePools.directory.
   * 功能：在登记并绑定宿主存储池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(pool ? poolFolder(pool.root) : VM_ROOT, checkedId(id))` 供上层消费（`StoragePools`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StoragePools`; this entry produces `join(pool ? poolFolder(pool.root) : VM_ROOT, checkedId(id))` for its caller. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `this.pool`, `idSchema.parse`, `join`, `poolFolder` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pool`, `idSchema.parse`, `join`, `poolFolder`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; poolId: default='default'
   * 输出 / Returns: `join(pool ? poolFolder(pool.root) : VM_ROOT, checkedId(id))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  directory(id: string, poolId = 'default') {
    const pool = this.pool(idSchema.parse(poolId));
    return join(pool ? poolFolder(pool.root) : VM_ROOT, checkedId(id));
  }

  /**
   * 入口 / Entry: StoragePools.bind.
   * 功能：在登记并绑定宿主存储池中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`StoragePools`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StoragePools`; the calls and state transitions below complete the operation. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `this.pool`, `idSchema.parse`, `setVmStorageRoot`, `poolFolder` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pool`, `idSchema.parse`, `setVmStorageRoot`, `poolFolder`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; poolId: default='default'
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `setVmStorageRoot`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  bind(id: string, poolId = 'default') {
    const pool = this.pool(idSchema.parse(poolId));
    setVmStorageRoot(id, pool ? poolFolder(pool.root) : undefined);
  }

  /**
   * 入口 / Entry: StoragePools.unbind.
   * 功能：在登记并绑定宿主存储池中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`StoragePools`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StoragePools`; the calls and state transitions below complete the operation. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `setVmStorageRoot` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `setVmStorageRoot`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `setVmStorageRoot`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  unbind(id: string) {
    setVmStorageRoot(id);
  }

  /**
   * 入口 / Entry: StoragePools.conflictsWithDataTarget.
   * 功能：从当前输入或状态计算 `this.state?.pools.some((pool) => within(pool.root, target) || within(target, pool.root)) || false`，供调用方后续验证或使用。
   * Purpose: Computes `this.state?.pools.some((pool) => within(pool.root, target) || within(target, pool.root)) || false` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: target: string
   * 输出 / Returns: `this.state?.pools.some((pool) => within(pool.root, target) || within(target, pool.root)) || false`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  conflictsWithDataTarget(target: string) {
    return this.state?.pools.some((pool) => within(pool.root, target) || within(target, pool.root)) || false;
  }

  /**
   * 入口 / Entry: StoragePools.ensure.
   * 功能：在登记并绑定宿主存储池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `regularDirectory(VM_ROOT)` / `folder` 供上层消费（`StoragePools`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StoragePools`; this entry produces `regularDirectory(VM_ROOT)` / `folder` for its caller. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `this.pool`, `idSchema.parse`, `mkdir`, `regularDirectory` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pool`, `idSchema.parse`, `mkdir`, `regularDirectory`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!pool`.
   * 输入 / Inputs: poolId: default='default'
   * 输出 / Returns: `regularDirectory(VM_ROOT)`; `folder`.
   * 副作用 / Effects: `mkdir`.
   * 拒绝 / Refusals: 条件 / conditions `!info?.isDirectory()`; `!markerInfo?.isFile() || markerInfo.isSymbolicLink()`; `saved?.id !== pool.id`; 异常 / errors `new AppError('存储池目录不可用', 503)`; `new AppError('存储池所有权标记无效', 409)`.
   */
  async ensure(poolId = 'default') {
    const pool = this.pool(idSchema.parse(poolId));
    if (!pool) {
      await mkdir(VM_ROOT, { recursive: true });
      return regularDirectory(VM_ROOT);
    }
    const root = await regularDirectory(pool.root);
    const folder = await regularDirectory(poolFolder(root));
    const info = await stat(folder).catch(() => null);
    if (!info?.isDirectory()) throw new AppError('存储池目录不可用', 503);
    const markerInfo = await lstat(marker(root)).catch(() => null);
    if (!markerInfo?.isFile() || markerInfo.isSymbolicLink()) throw new AppError('存储池所有权标记无效', 409);
    const saved = await readStore<{ id: string } | null>(marker(root), () => null);
    if (saved?.id !== pool.id) throw new AppError('存储池所有权标记不匹配', 409);
    return folder;
  }

  /**
   * 入口 / Entry: StoragePools.view.
   * 功能：在登记并绑定宿主存储池中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ currentPoolId: id ? this.machines.get(id).storagePoolId || 'default' : null, pendingCleanup: this.state!.pendingCleanup, po…` 供上层消费（`StoragePools`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `StoragePools`; this entry produces `{ currentPoolId: id ? this.machines.get(id).storagePoolId || 'default' : null, pendingCleanup: this.state!.pendingCleanup, po…` for its caller. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `this.machines.records.values`, `this.machines.get`, `Promise.all`, `pools.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.records.values`, `this.machines.get`, `Promise.all`, `pools.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string optional
   * 输出 / Returns: `{ currentPoolId: id ? this.machines.get(id).storagePoolId || 'default' : null, pendingCleanup: this.state!.pendingCleanup, po…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id?: string) {
    const records = [...this.machines.records.values()];
    const pools = [
      { id: 'default', name: '默认数据目录', root: VM_ROOT, createdAt: '' },
      ...this.state!.pools,
    ];
    /**
     * 入口 / Entry: StoragePools.view.callback@149.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（pools.map）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (pools.map).
     * 输入 / Inputs: pool
     * 输出 / Returns: `{ id: pool.id, name: pool.name, root, createdAt: pool.createdAt, available: !!capacity, totalBytes: capacity ? capacity.block…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return {
      currentPoolId: id ? this.machines.get(id).storagePoolId || 'default' : null,
      pendingCleanup: this.state!.pendingCleanup,
      pools: await Promise.all(
        pools.map(async (pool) => {
          const members = records.filter((vm) => (vm.storagePoolId || 'default') === pool.id);
          const root = pool.id === 'default' ? VM_ROOT : pool.root;
          const accessible = await this.ensure(pool.id).catch(() => null);
          const capacity = accessible ? await statfs(root).catch(() => null) : null;
          const bytes = await Promise.all(
            members.map(
              async (vm) => (await stat(join(vmDir(vm.id), 'disk.qcow2')).catch(() => null))?.size || 0,
            ),
          );
          return {
            id: pool.id,
            name: pool.name,
            root,
            createdAt: pool.createdAt,
            available: !!capacity,
            totalBytes: capacity ? capacity.blocks * capacity.bsize : null,
            freeBytes: capacity ? capacity.bavail * capacity.bsize : null,
            allocatedBytes: bytes.reduce((sum, value) => sum + value, 0),
            vms: members.map((vm, index) => ({ id: vm.id, name: vm.name, diskBytes: bytes[index] })),
          };
        }),
      ),
    };
  }

  /**
   * 入口 / Entry: StoragePools.create.
   * 功能：在登记并绑定宿主存储池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `pool` 供上层消费（`StoragePools`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StoragePools`; this entry produces `pool` for its caller. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `z.string().trim().min().max().parse`, `z.string().trim().min().max`, `z.string().trim().min`, `z.string().trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.string().trim().min().max().parse`, `z.string().trim().min().max`, `z.string().trim().min`, `z.string().trim`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: name: string; path: string
   * 输出 / Returns: `pool`.
   * 副作用 / Effects: `mkdir`; `writeFile`; `rmdir().catch`; `rmdir`; `rm`.
   * 拒绝 / Refusals: 条件 / conditions `this.state!.pools.length >= 8`; `!info?.isDirectory()`; `within(DATA, root) || within(root, DATA)`; 异常 / errors `new AppError('最多创建 8 个外部存储池', 409)`; `new AppError('请选择已存在的本机目录', 400)`.
   * 失败处理：catch 分支执行 `await rmdir(folder).catch(() => {});`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await rmdir(folder).catch(() => {});`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async create(name: string, path: string) {
    const label = z.string().trim().min(1).max(60).parse(name);
    if (this.state!.pools.length >= 8) throw new AppError('最多创建 8 个外部存储池', 409);
    const root = await regularDirectory(path);
    const info = await stat(root).catch(() => null);
    if (!info?.isDirectory()) throw new AppError('请选择已存在的本机目录', 400);
    if (within(DATA, root) || within(root, DATA)) throw new AppError('存储池不能与 Sakura 数据目录重叠', 409);
    for (const pool of this.state!.pools)
      if (within(pool.root, root) || within(root, pool.root))
        throw new AppError('存储池目录不能相互重叠', 409);
    if (this.state!.pools.some((pool) => pool.name === label)) throw new AppError('存储池名称已存在', 409);
    const folder = poolFolder(root);
    await regularDirectory(folder);
    const existing = await lstat(folder).catch(() => null);
    if (existing && (!existing.isDirectory() || (await readdir(folder)).length))
      throw new AppError('此路径已有 Sakura 存储池数据', 409);
    const pool: Pool = {
      id: randomBytes(8).toString('hex'),
      name: label,
      root,
      createdAt: new Date().toISOString(),
    };
    await mkdir(folder, { recursive: true });
    try {
      await writeFile(marker(root), JSON.stringify({ id: pool.id }), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      await rmdir(folder).catch(() => {});
      throw error;
    }
    try {
      await this.change((state) => {
        state.pools.push(pool);
      });
    } catch (error) {
      await rm(marker(root), { force: true });
      await rmdir(folder).catch(() => {});
      throw error;
    }
    return pool;
  }

  /**
   * 入口 / Entry: StoragePools.remove.
   * 功能：在登记并绑定宿主存储池中，结束、撤销或清理本次拥有的领域资源；本入口产生 `{ removed: pool.id }` 供上层消费（`StoragePools`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `StoragePools`; this entry produces `{ removed: pool.id }` for its caller. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `this.pool`, `idSchema.parse`, `inline.some`, `this.machines.records.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pool`, `idSchema.parse`, `inline.some`, `this.machines.records.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: poolId: string
   * 输出 / Returns: `{ removed: pool.id }`.
   * 副作用 / Effects: `rm`; `rmdir`; `writeFile`; `mkdir`.
   * 拒绝 / Refusals: 条件 / conditions `!pool`; `[...this.machines.records.values()].some((vm) => vm.storagePoolId === pool.id)`; `this.state!.pendingCleanup.some( (item) => item.sourcePoolId === pool.id || item.targetPoolId === pool.id, )`; 异常 / errors `new AppError('默认存储池不能删除', 409)`; `new AppError('存储池仍有实例，请先迁出', 409)`.
   * 失败处理：catch 分支执行 `await writeFile(marker(pool.root), JSON.stringify({ id: pool.id }), { mode: 0o600 });`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await writeFile(marker(pool.root), JSON.stringify({ id: pool.id }), { mode: 0o600 });`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async remove(poolId: string) {
    const pool = this.pool(idSchema.parse(poolId));
    if (!pool) throw new AppError('默认存储池不能删除', 409);
    if ([...this.machines.records.values()].some((vm) => vm.storagePoolId === pool.id))
      throw new AppError('存储池仍有实例，请先迁出', 409);
    if (
      this.state!.pendingCleanup.some(
        (item) => item.sourcePoolId === pool.id || item.targetPoolId === pool.id,
      )
    )
      throw new AppError('存储池仍有待清理的迁移数据', 409);
    await this.ensure(pool.id);
    const entries = await readdir(poolFolder(pool.root));
    if (entries.some((entry) => entry !== '.sakura-pool.json'))
      throw new AppError('存储池中仍有未登记数据，请先检查', 409);
    await rm(marker(pool.root));
    try {
      await rmdir(poolFolder(pool.root));
    } catch (error) {
      await writeFile(marker(pool.root), JSON.stringify({ id: pool.id }), { mode: 0o600 });
      throw error;
    }
    try {
      await this.change((state) => {
        state.pools = state.pools.filter((item) => item.id !== pool.id);
      });
    } catch (error) {
      await mkdir(poolFolder(pool.root));
      await writeFile(marker(pool.root), JSON.stringify({ id: pool.id }), { mode: 0o600 });
      throw error;
    }
    return { removed: pool.id };
  }

  /**
   * 入口 / Entry: StoragePools.hasPendingCleanup.
   * 功能：从当前输入或状态计算 `this.state?.pendingCleanup.some((item) => item.vmId === vmId) || false`，供调用方后续验证或使用。
   * Purpose: Computes `this.state?.pendingCleanup.some((item) => item.vmId === vmId) || false` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: vmId: string
   * 输出 / Returns: `this.state?.pendingCleanup.some((item) => item.vmId === vmId) || false`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  hasPendingCleanup(vmId: string) {
    return this.state?.pendingCleanup.some((item) => item.vmId === vmId) || false;
  }

  /**
   * 入口 / Entry: StoragePools.registerCleanup.
   * 功能：在登记并绑定宿主存储池中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`StoragePools`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StoragePools`; the calls and state transitions below complete the operation. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `this.change` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.change`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; sourcePoolId: string; targetPoolId: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async registerCleanup(vmId: string, sourcePoolId: string, targetPoolId: string) {
    await this.change((state) => {
      if (state.pendingCleanup.some((item) => item.vmId === vmId))
        throw new AppError('此实例仍有待清理的存储池迁移', 409);
      state.pendingCleanup.push({ vmId, sourcePoolId, targetPoolId, addedAt: new Date().toISOString() });
    });
  }

  /**
   * 入口 / Entry: StoragePools.clearCleanup.
   * 功能：在登记并绑定宿主存储池中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`StoragePools`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StoragePools`; the calls and state transitions below complete the operation. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `this.change`, `this.cleanupLeases.get().release`, `this.cleanupLeases.get`, `this.cleanupLeases.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.change`, `this.cleanupLeases.get().release`, `this.cleanupLeases.get`, `this.cleanupLeases.delete`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; sourcePoolId: string; targetPoolId: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.cleanupLeases.get().release`; `this.cleanupLeases.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async clearCleanup(vmId: string, sourcePoolId: string, targetPoolId: string) {
    await this.change((state) => {
      state.pendingCleanup = state.pendingCleanup.filter(
        (item) =>
          !(item.vmId === vmId && item.sourcePoolId === sourcePoolId && item.targetPoolId === targetPoolId),
      );
    });
    const key = `${vmId}:${sourcePoolId}:${targetPoolId}`;
    this.cleanupLeases.get(key)?.release();
    this.cleanupLeases.delete(key);
  }

  /**
   * 入口 / Entry: StoragePools.cleanup.
   * 功能：在登记并绑定宿主存储池中，结束、撤销或清理本次拥有的领域资源；本入口产生 `{ completed, errors }` 供上层消费（`StoragePools`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `StoragePools`; this entry produces `{ completed, errors }` for its caller. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `this.machines.records.get`, `this.ensure`, `this.directory`, `within` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.records.get`, `this.ensure`, `this.directory`, `within`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `retained`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ completed, errors }`.
   * 副作用 / Effects: `completed.push`; `errors.push`.
   * 拒绝 / Refusals: 条件 / conditions `!vm`; `!obsolete`; `!within(root, dir)`; 异常 / errors `new AppError('实例记录不存在，需要人工检查两份数据', 409)`; `new AppError('实例存储池已再次变化，需要人工检查', 409)`.
   * 失败处理：catch 分支执行 `errors.push({ vmId: item.vmId, message: String((error as Error).message || error) });`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `errors.push({ vmId: item.vmId, message: String((error as Error).message || error) });`; these statements determine whether a failure is absorbed or rejected again.
   */
  async cleanup() {
    const completed: string[] = [];
    const errors: { vmId: string; message: string }[] = [];
    for (const item of this.state!.pendingCleanup) {
      try {
        const vm = this.machines.records.get(item.vmId);
        if (!vm) throw new AppError('实例记录不存在，需要人工检查两份数据', 409);
        const current = vm.storagePoolId || 'default';
        const obsolete =
          current === item.sourcePoolId
            ? item.targetPoolId
            : current === item.targetPoolId
              ? item.sourcePoolId
              : null;
        if (!obsolete) throw new AppError('实例存储池已再次变化，需要人工检查', 409);
        const root = await this.ensure(obsolete);
        const dir = this.directory(item.vmId, obsolete);
        if (!within(root, dir)) throw new AppError('待清理目录超出存储池', 409);
        const retained = this.cleanupLeases.get(`${item.vmId}:${item.sourcePoolId}:${item.targetPoolId}`);
        /**
         * 入口 / Entry: StoragePools.cleanup.remove.
         * 功能：在登记并绑定宿主存储池中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`StoragePools`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `StoragePools`; the calls and state transitions below complete the operation. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
         * 处理：通过 `regularDirectory`, `rm`, `this.clearCleanup` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `regularDirectory`, `rm`, `this.clearCleanup`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `rm`; `this.clearCleanup`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const remove = async () => {
          await regularDirectory(dir);
          await rm(dir, { recursive: true, force: true });
          await this.clearCleanup(item.vmId, item.sourcePoolId, item.targetPoolId);
        };
        if (retained)
          await remove(); // The original cleanup-pending lease still covers these exact paths.
        else
          await storageRuntime.run(
            {
              owner: 'core:storage-pool-cleanup',
              taskId: 'pool-cleanup:' + item.vmId,
              label: 'Reconcile storage pool copy',
              mode: 'write',
              paths: [dir],
              buffers: 65536,
              files: 2,
            },
            async (lease) => {
              try {
                await remove();
              } catch (error) {
                this.retainCleanup(item.vmId, item.sourcePoolId, item.targetPoolId, lease, error);
                throw error;
              }
            },
          );
        completed.push(item.vmId);
      } catch (error) {
        errors.push({ vmId: item.vmId, message: String((error as Error).message || error) });
      }
    }
    return { completed, errors };
  }

  /**
   * 入口 / Entry: StoragePools.run.
   * 功能：在登记并绑定宿主存储池中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...(await this.view(vmId)), ready: true, executed: false }` / `{ ...(await this.view(vmId)), ready: true, executed: true, created: pool }` 供上层消费（`StoragePools`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StoragePools`; this entry produces `{ ...(await this.view(vmId)), ready: true, executed: false }` / `{ ...(await this.view(vmId)), ready: true, executed: true, created: pool }` for its caller. Module context: Registers/binds host pools, rejecting overlaps and retaining original pool resources after cleanup failure.
   * 处理：通过 `storagePoolInput.parse`, `this.machines.get`, `this.view`, `this.machines.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `storagePoolInput.parse`, `this.machines.get`, `this.view`, `this.machines.locked`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `vmId`; `action === 'check' || value.mode === 'list'`; `value.mode === 'create'`.
   * 输入 / Inputs: id: string | undefined; input: unknown; action: 'check' | 'run'; signal: AbortSignal optional; log: (text: string) => void default=() => {}
   * 输出 / Returns: `{ ...(await this.view(vmId)), ready: true, executed: false }`; `{ ...(await this.view(vmId)), ready: true, executed: true, created: pool }`; `{ ...(await this.view(vmId)), ready: true, executed: true, ...removed }`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `id && value.vmId && value.vmId !== id`; `!vmId`; 异常 / errors `new AppError('当前实例与参数中的实例不一致', 409)`; `new AppError('移动实例时需要 vmId')`.
   */
  async run(
    id: string | undefined,
    input: unknown,
    action: 'check' | 'run',
    signal?: AbortSignal,
    log: (text: string) => void = () => {},
  ) {
    const value = storagePoolInput.parse(input);
    if (id && value.vmId && value.vmId !== id) throw new AppError('当前实例与参数中的实例不一致', 409);
    const vmId = id || value.vmId;
    if (vmId) this.machines.get(vmId);
    if (action === 'check' || value.mode === 'list')
      return { ...(await this.view(vmId)), ready: true, executed: false };
    if (value.mode === 'create') {
      const pool = await this.machines.locked('storage-pools', () => this.create(value.name, value.path));
      return { ...(await this.view(vmId)), ready: true, executed: true, created: pool };
    }
    if (value.mode === 'remove') {
      const removed = await this.machines.locked('storage-pools', () => this.remove(value.poolId));
      return { ...(await this.view(vmId)), ready: true, executed: true, ...removed };
    }
    if (value.mode === 'cleanup') {
      const cleanup = await this.machines.locked('storage-pools', () => this.cleanup());
      return { ...(await this.view(vmId)), ready: true, executed: true, cleanup };
    }
    if (!vmId) throw new AppError('移动实例时需要 vmId');
    const moved = await this.machines.moveStoragePool(vmId, value.poolId, signal, log);
    return { ...(await this.view(vmId)), ready: true, executed: true, moved };
  }
}
