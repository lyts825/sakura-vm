/**
 * 模块职责：管理磁盘快照及对应身份记录，恢复和编辑前校验快照归属与数量限制。
 */
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VMRecord, VMView } from '../../shared/contracts/vm.ts';
import { AppError } from '../../shared/errors.ts';
import { checkedId } from '../../shared/paths.ts';
import { encryptedImageOptions, qemuSecretObject } from '../disk-encryption.ts';
import { vmDir } from '../paths.ts';
import { qmp, qmpSnapshotJob } from '../qmp.ts';
import type { VmEnginePort, VmLockPort, VmSnapshotStatePort, VmStoragePort } from '../vm-ports.ts';
import { writeIdentityFile } from '../vm-storage.ts';

export type DiskIdentity = { key: string; seed: Buffer; pending?: string };
export type VmSnapshotStorePorts = Pick<VmLockPort, 'locked' | 'requireStopped'> &
  Pick<VmStoragePort, 'withDiskSecret'> & {
    get(id: string): VMRecord;
    engine(): VmEnginePort['engine'];
    trustedBoot(): VmSnapshotStatePort | undefined;
    save(): Promise<void>;
    view(id: string): Promise<VMView>;
    changed(): void;
  };

/** Owns disk snapshot metadata and controller identity; VM transitions stay with the host. */
export class VmSnapshots {
  constructor(private readonly ports: VmSnapshotStorePorts) {}
  private snapshotIdentityFile(id: string, snapshotId: string) {
    return join(vmDir(id), `.snapshot-${checkedId(snapshotId)}.json`);
  }
  async identity(id: string, snapshotId?: string): Promise<DiskIdentity> {
    const vm = this.ports.get(id);
    if (snapshotId) {
      if (!vm.snapshots.some((shot) => shot.id === snapshotId)) throw new AppError('快照不存在', 404);
      try {
        const identity = JSON.parse(await readFile(this.snapshotIdentityFile(id, snapshotId), 'utf8'));
        if (
          typeof identity.key !== 'string' ||
          typeof identity.seed !== 'string' ||
          (identity.pending !== undefined && typeof identity.pending !== 'string')
        )
          throw new AppError('快照身份数据损坏');
        return { key: identity.key, seed: Buffer.from(identity.seed, 'base64'), pending: identity.pending };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        // Older snapshots predate identity metadata and retain their current key.
      }
    }
    const dir = vmDir(id);
    const [key, seed, pending] = await Promise.all([
      readFile(join(dir, 'id_rsa'), 'utf8'),
      readFile(join(dir, 'seed.iso')),
      readFile(join(dir, 'identity.json'), 'utf8').catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      }),
    ]);
    return { key, seed, pending };
  }
  async snapshotIdentity(id: string, snapshotId?: string): Promise<{ key: string; seed: Buffer }> {
    const { key, seed } = await this.identity(id, snapshotId);
    return { key, seed };
  }
  async capture(vm: VMRecord, name: string, onlinePort?: number,
    stateFingerprint?: string) {
    const shot = {
      id: randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      diskGiB: vm.diskGiB,
      pendingResize: !!vm.pendingResize,
      consistency: stateFingerprint ? 'vmstate' as const :
        onlinePort === undefined ? 'offline' as const : 'filesystem' as const,
      ...(stateFingerprint ? { stateFingerprint } : {}),
    };
    const identity = await this.identity(vm.id);
    const file = this.snapshotIdentityFile(vm.id, shot.id);
    await writeFile(file, JSON.stringify({ ...identity, seed: identity.seed.toString('base64') }), {
      flag: 'wx',
      mode: 0o600,
    });
    try {
      if (onlinePort === undefined)
        await this.ports.trustedBoot()?.capture(vm.id, shot.id);
      else await this.ports.trustedBoot()?.ensureOnlineAllowed(vm.id);
      if (onlinePort === undefined) {
        if (vm.diskEncryption)
          await this.ports.withDiskSecret(vm, (secret) => this.ports.engine().run('sakura-img', [
            'snapshot', '--object', qemuSecretObject(secret), '--image-opts',
            '-c', shot.id, encryptedImageOptions(join(vmDir(vm.id), 'disk.qcow2')),
          ]));
        else await this.ports.engine().run('sakura-img',
          ['snapshot', '-c', shot.id, join(vmDir(vm.id), 'disk.qcow2')]);
      }
      else if (stateFingerprint)
        await qmpSnapshotJob(onlinePort, 'snapshot-save', shot.id);
      else
        await qmp(onlinePort, 'blockdev-snapshot-internal-sync',
          { device: 'sakura-disk', name: shot.id }, 30000);
    } catch (error) {
      await rm(file, { force: true });
      await this.ports.trustedBoot()?.remove(vm.id, shot.id);
      throw error;
    }
    vm.snapshots.push(shot);
    await this.ports.save();
    return shot;
  }
  async snapshot(id: string, name: string) {
    return this.ports.locked(id, async () => {
      const vm = this.ports.get(id);
      this.ports.requireStopped(id);
      if (vm.snapshots.length >= 20) throw new AppError('最多保留 20 个磁盘快照');
      return this.capture(vm, name);
    });
  }
  async restore(id: string, snapshotId: string, backup = false) {
    return this.ports.locked(id, async () => {
      const vm = this.ports.get(id);
      this.ports.requireStopped(id);
      const selected = vm.snapshots.find((s) => s.id === snapshotId);
      if (!selected) throw new AppError('快照不存在', 404);
      if (selected.consistency === 'vmstate')
        throw new AppError('此快照包含 RAM 状态，请启动实例并使用整机状态恢复', 409);
      const identity = await this.identity(id, snapshotId);
      const restoreTrusted = await this.ports.trustedBoot()?.prepareRestore(id, snapshotId);
      if (backup) {
        if (vm.snapshots.length >= 20) throw new AppError('请先删除一个旧快照，为恢复前备份留出位置');
        await this.capture(vm, '恢复前自动备份');
      }
      if (vm.diskEncryption)
        await this.ports.withDiskSecret(vm, (secret) => this.ports.engine().run('sakura-img', [
          'snapshot', '--object', qemuSecretObject(secret), '--image-opts',
          '-a', snapshotId, encryptedImageOptions(join(vmDir(id), 'disk.qcow2')),
        ]));
      else await this.ports.engine().run('sakura-img',
        ['snapshot', '-a', snapshotId, join(vmDir(id), 'disk.qcow2')]);
      const restored = vm.snapshots.find((s) => s.id === snapshotId)!;
      if (restored.diskGiB) vm.diskGiB = restored.diskGiB;
      vm.pendingResize = !!restored.pendingResize;
      const dir = vmDir(id);
      await writeIdentityFile(join(dir, 'id_rsa'), identity.key);
      await writeIdentityFile(join(dir, 'seed.iso'), identity.seed);
      if (identity.pending !== undefined)
        await writeIdentityFile(join(dir, 'identity.json'), identity.pending);
      else await rm(join(dir, 'identity.json'), { force: true });
      await restoreTrusted?.();
      delete vm.lastError;
      await this.ports.save();
      return this.ports.view(id);
    });
  }
  async editSnapshot(id: string, snapshotId: string, patch: { name: string; note: string } | null) {
    return this.ports.locked(id, async () => {
      this.ports.requireStopped(id);
      const vm = this.ports.get(id);
      const shot = vm.snapshots.find((s) => s.id === snapshotId);
      if (!shot) throw new AppError('快照不存在', 404);
      if (patch) Object.assign(shot, patch);
      else {
        if (vm.diskEncryption)
          await this.ports.withDiskSecret(vm, (secret) => this.ports.engine().run('sakura-img', [
            'snapshot', '--object', qemuSecretObject(secret), '--image-opts',
            '-d', shot.id, encryptedImageOptions(join(vmDir(id), 'disk.qcow2')),
          ]));
        else await this.ports.engine().run('sakura-img',
          ['snapshot', '-d', shot.id, join(vmDir(id), 'disk.qcow2')]);
        vm.snapshots = vm.snapshots.filter((s) => s !== shot);
        await rm(this.snapshotIdentityFile(id, shot.id), { force: true });
        await this.ports.trustedBoot()?.remove(id, shot.id);
      }
      await this.ports.save();
      this.ports.changed();
      return this.ports.view(id);
    });
  }
}
