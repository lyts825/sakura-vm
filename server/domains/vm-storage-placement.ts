/**
 * 模块职责：迁移实例存储池并校验受控路径；旧副本未清理时阻止再次迁移。
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
  hasPendingCleanup(id: string): boolean;
  ensure(poolId?: string): Promise<string>;
  directory(id: string, poolId?: string): string;
  bind(id: string, poolId?: string): void;
  registerCleanup(vmId: string, sourcePoolId: string, targetPoolId: string): Promise<void>;
  clearCleanup(vmId: string, sourcePoolId: string, targetPoolId: string): Promise<void>;
  retainCleanup(vmId: string, sourcePoolId: string, targetPoolId: string, lease: StorageLease, error: unknown): void;
};
export type VmStoragePlacementPorts = Pick<VmLockPort, 'locked' | 'requireStopped'> & {
  get(id: string): VMRecord;
  pools(): VmStoragePlacementPools;
  requireMutableConfig(vm: VMRecord): void;
  save(): Promise<void>;
  view(id: string): Promise<VMView>;
  changed(): void;
};

/** Owns verified storage placement and rollback while preserving the original storage lease. */
export class VmStoragePlacement {
  constructor(private readonly ports: VmStoragePlacementPorts) {}
  async moveStoragePool(id: string, targetPoolId: string, signal?: AbortSignal,
    log: (text: string) => void = () => {}) {
    return this.ports.locked('storage-pools', () => this.ports.locked(id, async () => {
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
