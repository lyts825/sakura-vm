/**
 * 模块职责：迁移实例存储池并校验受控路径；旧副本未清理时阻止再次迁移。
 * Module purpose: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move.
 */
import { randomUUID } from 'node:crypto';
import { lstat, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { VMRecord, VMView } from '../../shared/contracts/vm.ts';
import { AppError } from '../../shared/errors.ts';
import { checkedId } from '../../shared/paths.ts';
import { regularDirectory, within } from '../local-store.ts';
import { vmDir } from '../paths.ts';
import { storageRuntime, type StorageLease } from '../storage-runtime.ts';
import type { VmLockPort } from '../vm-ports.ts';
import { copyDirectoryVerified } from '../vm-storage.ts';

export type VmStoragePlacementPools = {
  /**
   * 签名 / Signature: VmStoragePlacementPools.hasPendingCleanup.
   * 功能：为迁移实例存储池并校验受控路径声明 hasPendingCleanup 的输入与结果契约，所属容器为 VmStoragePlacementPools。
   * Purpose: Declares the input/result contract for hasPendingCleanup in VmStoragePlacementPools. Module responsibility: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move.
   * 输入 / Inputs: id: string
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  hasPendingCleanup(id: string): boolean;
  /**
   * 签名 / Signature: VmStoragePlacementPools.ensure.
   * 功能：为迁移实例存储池并校验受控路径声明 ensure 的输入与结果契约，所属容器为 VmStoragePlacementPools。
   * Purpose: Declares the input/result contract for ensure in VmStoragePlacementPools. Module responsibility: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move.
   * 输入 / Inputs: poolId: string optional
   * 输出 / Returns: Promise<string>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  ensure(poolId?: string): Promise<string>;
  /**
   * 签名 / Signature: VmStoragePlacementPools.directory.
   * 功能：为迁移实例存储池并校验受控路径声明 directory 的输入与结果契约，所属容器为 VmStoragePlacementPools。
   * Purpose: Declares the input/result contract for directory in VmStoragePlacementPools. Module responsibility: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move.
   * 输入 / Inputs: id: string; poolId: string optional
   * 输出 / Returns: string.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  directory(id: string, poolId?: string): string;
  /**
   * 签名 / Signature: VmStoragePlacementPools.bind.
   * 功能：为迁移实例存储池并校验受控路径声明 bind 的输入与结果契约，所属容器为 VmStoragePlacementPools。
   * Purpose: Declares the input/result contract for bind in VmStoragePlacementPools. Module responsibility: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move.
   * 输入 / Inputs: id: string; poolId: string optional
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  bind(id: string, poolId?: string): void;
  /**
   * 签名 / Signature: VmStoragePlacementPools.registerCleanup.
   * 功能：为迁移实例存储池并校验受控路径声明 registerCleanup 的输入与结果契约，所属容器为 VmStoragePlacementPools。
   * Purpose: Declares the input/result contract for registerCleanup in VmStoragePlacementPools. Module responsibility: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move.
   * 输入 / Inputs: vmId: string; sourcePoolId: string; targetPoolId: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  registerCleanup(vmId: string, sourcePoolId: string, targetPoolId: string): Promise<void>;
  /**
   * 签名 / Signature: VmStoragePlacementPools.clearCleanup.
   * 功能：为迁移实例存储池并校验受控路径声明 clearCleanup 的输入与结果契约，所属容器为 VmStoragePlacementPools。
   * Purpose: Declares the input/result contract for clearCleanup in VmStoragePlacementPools. Module responsibility: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move.
   * 输入 / Inputs: vmId: string; sourcePoolId: string; targetPoolId: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  clearCleanup(vmId: string, sourcePoolId: string, targetPoolId: string): Promise<void>;
  /**
   * 签名 / Signature: VmStoragePlacementPools.retainCleanup.
   * 功能：为迁移实例存储池并校验受控路径声明 retainCleanup 的输入与结果契约，所属容器为 VmStoragePlacementPools。
   * Purpose: Declares the input/result contract for retainCleanup in VmStoragePlacementPools. Module responsibility: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move.
   * 输入 / Inputs: vmId: string; sourcePoolId: string; targetPoolId: string; lease: StorageLease; error: unknown
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  retainCleanup(vmId: string, sourcePoolId: string, targetPoolId: string, lease: StorageLease, error: unknown): void;
};
export type VmStoragePlacementPorts = Pick<VmLockPort, 'locked' | 'requireStopped'> & {
  /**
   * 签名 / Signature: VmStoragePlacementPorts.get.
   * 功能：为迁移实例存储池并校验受控路径声明 get 的输入与结果契约，所属容器为 VmStoragePlacementPorts。
   * Purpose: Declares the input/result contract for get in VmStoragePlacementPorts. Module responsibility: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move.
   * 输入 / Inputs: id: string
   * 输出 / Returns: VMRecord.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  get(id: string): VMRecord;
  /**
   * 签名 / Signature: VmStoragePlacementPorts.pools.
   * 功能：为迁移实例存储池并校验受控路径声明 pools 的输入与结果契约，所属容器为 VmStoragePlacementPorts。
   * Purpose: Declares the input/result contract for pools in VmStoragePlacementPorts. Module responsibility: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: VmStoragePlacementPools.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  pools(): VmStoragePlacementPools;
  /**
   * 签名 / Signature: VmStoragePlacementPorts.requireMutableConfig.
   * 功能：为迁移实例存储池并校验受控路径声明 requireMutableConfig 的输入与结果契约，所属容器为 VmStoragePlacementPorts。
   * Purpose: Declares the input/result contract for requireMutableConfig in VmStoragePlacementPorts. Module responsibility: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move.
   * 输入 / Inputs: vm: VMRecord
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  requireMutableConfig(vm: VMRecord): void;
  /**
   * 签名 / Signature: VmStoragePlacementPorts.save.
   * 功能：为迁移实例存储池并校验受控路径声明 save 的输入与结果契约，所属容器为 VmStoragePlacementPorts。
   * Purpose: Declares the input/result contract for save in VmStoragePlacementPorts. Module responsibility: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  save(): Promise<void>;
  /**
   * 签名 / Signature: VmStoragePlacementPorts.view.
   * 功能：为迁移实例存储池并校验受控路径声明 view 的输入与结果契约，所属容器为 VmStoragePlacementPorts。
   * Purpose: Declares the input/result contract for view in VmStoragePlacementPorts. Module responsibility: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  view(id: string): Promise<VMView>;
  /**
   * 签名 / Signature: VmStoragePlacementPorts.changed.
   * 功能：为迁移实例存储池并校验受控路径声明 changed 的输入与结果契约，所属容器为 VmStoragePlacementPorts。
   * Purpose: Declares the input/result contract for changed in VmStoragePlacementPorts. Module responsibility: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  changed(): void;
};

/** Owns verified storage placement and rollback while preserving the original storage lease. */
export class VmStoragePlacement {
  /**
   * 入口 / Entry: VmStoragePlacement.constructor.
   * 功能：建立 VmStoragePlacement 的迁移实例存储池并校验受控路径上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the VmStoragePlacement context for this module's responsibility: Moves VM storage across pools after path validation; pending old-copy cleanup prevents another move. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: ports: VmStoragePlacementPorts
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private readonly ports: VmStoragePlacementPorts) {}
  /**
   * 入口 / Entry: VmStoragePlacement.moveStoragePool.
   * 功能：把本层请求转交 `this.ports.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.ports.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; targetPoolId: string; signal: AbortSignal optional; log: (text: string) => void default=() => {}
   * 输出 / Returns: `this.ports.locked('storage-pools', () => this.ports.locked(id, async () => { const vm = this.ports.get(id); this.ports.requir…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async moveStoragePool(id: string, targetPoolId: string, signal?: AbortSignal,
    log: (text: string) => void = () => {}) {
    /**
     * 入口 / Entry: VmStoragePlacement.moveStoragePool.callback@39.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.ports.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.ports.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ moved: false, from: sourcePoolId, to: targetPoolId, cleanupPending: false, vm: await this.ports.view(id) }`; `storageRuntime.run({ owner: 'core:storage-pool-move', taskId: 'pool-move:' + id, label: 'Copy and verify VM storage', mode: '…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.ports.pools().hasPendingCleanup(id)`; `!within(sourceRoot, source) || !within(targetRoot, target) || !within(targetRoot, stage)`; `existing`; 异常 / errors `new AppError('请先清理此前存储池迁移的旧副本', 409)`; `new AppError('存储池迁移路径超出受控目录', 409)`.
     */
    return this.ports.locked('storage-pools', () => this.ports.locked(id,
    /**
     * 中文功能：在实例停止且配置可变时复制校验存储目录，发布目标、保存新池绑定并清理源，返回迁移与待清理状态。
     * English: Copies/verifies storage for a stopped mutable VM, publishes the destination, saves its new pool binding and cleans the source, returning migration/pending-cleanup state.
     * 所属 / Owner: VmStoragePlacement.moveStoragePool.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 设计：保存前失败撤销目标和绑定；保存后源删除失败保留明确 cleanup 记录，不能把旧副本失去追踪。
     * Design: Failures before save roll back destination/binding; source-deletion failures after save retain explicit cleanup records so old copies remain tracked.
     */
    async () => {
      const vm = this.ports.get(id);
      this.ports.requireStopped(id);
      this.ports.requireMutableConfig(vm);
      signal?.throwIfAborted();
      const sourcePoolId = vm.storagePoolId || 'default';
      if (this.ports.pools().hasPendingCleanup(id))
        throw new AppError('请先清理此前存储池迁移的旧副本', 409);
      if (sourcePoolId === targetPoolId)
        return { moved: false, from: sourcePoolId, to: targetPoolId, cleanupPending: false, vm: await this.ports.view(id) };
      const sourceRoot = await this.ports.pools().ensure(sourcePoolId);
      const targetRoot = await this.ports.pools().ensure(targetPoolId);
      const source = await regularDirectory(vmDir(id));
      const target = this.ports.pools().directory(id, targetPoolId);
      const stage = join(targetRoot, `.move-${checkedId(id)}-${randomUUID()}`);
      if (!within(sourceRoot, source) || !within(targetRoot, target) ||
          !within(targetRoot, stage))
        throw new AppError('存储池迁移路径超出受控目录', 409);
      const existing = await lstat(target).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (existing) throw new AppError('目标存储池中已有同标识目录，请先检查', 409);
      /**
       * 入口 / Entry: VmStoragePlacement.moveStoragePool.callback@64.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（storageRuntime.run）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (storageRuntime.run).
       * 输入 / Inputs: lease
       * 输出 / Returns: `{ moved: true, from: sourcePoolId, to: targetPoolId, cleanupPending, vm: await this.ports.view(id) }`.
       * 副作用 / Effects: `rename`; `rm`; `this.ports.pools().registerCleanup`; `this.ports.save`; `this.ports.pools().clearCleanup`; 更新 / updates `vm.storagePoolId`, `cleanupPending`.
       * 拒绝 / Refusals: 异常 / errors `cleanup`; `error`.
       * 失败处理：catch 分支执行 `await regularDirectory(stage);`; `try { await rm(stage, { recursive: true, force: true }); } catch (cleanup) { lease.cleanupPending(cleanup); throw cleanup; }`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `await regularDirectory(stage);`; `try { await rm(stage, { recursive: true, force: true }); } catch (cleanup) { lease.cleanupPending(cleanup); throw cleanup; }`; these statements determine whether a failure is absorbed or rejected again.
       */
      return storageRuntime.run({ owner: 'core:storage-pool-move', taskId: 'pool-move:' + id,
        label: 'Copy and verify VM storage', mode: 'write', paths: [source, targetRoot],
        dynamicTemporary: [targetRoot], buffers: 1024 ** 2, files: 6, signal }, async (lease) => {
      log('正在复制并校验实例目录…\n');
      try {
        await copyDirectoryVerified(source, stage, signal, log, lease);
        signal?.throwIfAborted();
        await rename(stage, target);
      } catch (error) {
        await regularDirectory(stage);
        try { await rm(stage, { recursive: true, force: true }); }
        catch (cleanup) { lease.cleanupPending(cleanup); throw cleanup; }
        throw error;
      }
      try {
        await this.ports.pools().registerCleanup(id, sourcePoolId, targetPoolId);
      } catch (error) {
        await regularDirectory(target);
        try { await rm(target, { recursive: true, force: true }); }
        catch (cleanup) { lease.cleanupPending(cleanup); throw cleanup; }
        throw error;
      }
      vm.storagePoolId = targetPoolId === 'default' ? undefined : targetPoolId;
      this.ports.pools().bind(id, targetPoolId);
      try {
        await this.ports.save();
      } catch (error) {
        vm.storagePoolId = sourcePoolId === 'default' ? undefined : sourcePoolId;
        this.ports.pools().bind(id, sourcePoolId);
        await regularDirectory(target);
        try { await rm(target, { recursive: true, force: true }); }
        catch (cleanup) { lease.cleanupPending(cleanup); throw cleanup; }
        await this.ports.pools().clearCleanup(id, sourcePoolId, targetPoolId);
        throw error;
      }
      let cleanupPending = false;
      try {
        await regularDirectory(source);
        await rm(source, { recursive: true, force: true });
        await this.ports.pools().clearCleanup(id, sourcePoolId, targetPoolId);
      } catch (error) {
        cleanupPending = true;
        this.ports.pools().retainCleanup(id, sourcePoolId, targetPoolId, lease, error);
        log(`旧存储池目录待清理：${String((error as Error).message || error)}\n`);
      }
      this.ports.changed();
      return { moved: true, from: sourcePoolId, to: targetPoolId, cleanupPending,
        vm: await this.ports.view(id) };
      });
    }));
  }
}
