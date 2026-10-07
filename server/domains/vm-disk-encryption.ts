/**
 * 模块职责：管理磁盘加密事务与恢复，核对配置中的口令引用和实际磁盘格式是否一致。
 */
import { existsSync } from 'node:fs';
import { link, lstat, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VMRecord } from '../../shared/contracts/vm.ts';
import { AppError } from '../../shared/errors.ts';
import { diskEncryptionSchema, encryptedImageOptions, plainImageOptions, qemuSecretObject } from '../disk-encryption.ts';
import { vmDir } from '../paths.ts';
import type { Engine } from '../runtime.ts';

/** The disk owner receives only record publication, locking, QEMU and secret capabilities. */
export type DiskEncryptionPorts = {
  engine(): Pick<Engine, 'run'>;
  get(id: string): VMRecord;
  running(id: string): boolean;
  requireStopped(id: string): void;
  locked<T>(id: string, work: () => Promise<T>): Promise<T>;
  save(): Promise<void>;
  changed(): void;
  openSecret(id: string, name: string): Promise<{ file: string; close(): Promise<void> }>;
  secretNames(id: string): Promise<readonly { name: string }[]>;
};

/** Owns conversion publication and crash recovery; lifecycle coordination stays with the host. */
export class VmDiskEncryption {
  constructor(private readonly ports: DiskEncryptionPorts) {}
  private diskEncryptionPaths(id: string) {
    const dir = vmDir(id);
    return {
      disk: join(dir, 'disk.qcow2'),
      staged: join(dir, '.disk.encrypting.qcow2'),
      backup: join(dir, '.disk.before-encrypt.qcow2'),
      pending: join(dir, '.disk-encryption.pending.json'),
    };
  }
  async info(id: string) {
    const output = await this.ports.engine().run('sakura-img',
      ['info', '-f', 'qcow2', '--output=json', this.diskEncryptionPaths(id).disk]);
    return JSON.parse(output) as { format?: string; encrypted?: boolean; 'backing-filename'?: string };
  }
  async recover(vm: VMRecord) {
    const paths = this.diskEncryptionPaths(vm.id);
    const pending = await readFile(paths.pending, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!pending && !vm.diskEncryption) return;
    const info = await this.info(vm.id);
    if (pending) {
      const config = diskEncryptionSchema.parse(JSON.parse(pending));
      if (info.encrypted) {
        if (vm.diskEncryption && vm.diskEncryption.secretName !== config.secretName)
          throw new AppError(`实例 ${vm.name} 的磁盘口令引用与待恢复事务不一致`, 409);
        vm.diskEncryption = config;
        await this.ports.save();
      } else if (vm.diskEncryption) {
        throw new AppError(`实例 ${vm.name} 的加密标记与明文磁盘不一致，请先恢复磁盘`, 409);
      }
      // After a crash, only an encrypted current disk justifies deleting the plaintext hard link.
      await rm(paths.staged, { force: true });
      await rm(paths.backup, { force: true });
      await rm(paths.pending, { force: true });
    }
    if (vm.diskEncryption && !info.encrypted)
      throw new AppError(`实例 ${vm.name} 的加密标记与磁盘格式不一致`, 409);
  }
  async status(id: string) {
    const vm = this.ports.get(id);
    // QEMU owns the image while running; startup already verified its format.
    const info = this.ports.running(id) ? { encrypted: !!vm.diskEncryption } : await this.info(id);
    const keyAvailable = vm.diskEncryption
      ? (await this.ports.secretNames(id)).some((item) => item.name === vm.diskEncryption!.secretName)
      : false;
    return { enabled: !!vm.diskEncryption, encrypted: !!info.encrypted,
      format: vm.diskEncryption?.format, secretName: vm.diskEncryption?.secretName,
      keyAvailable, stopped: !this.ports.running(id), snapshots: vm.snapshots.length };
  }
  async encrypt(id: string, secretName: string, signal?: AbortSignal) {
    return this.ports.locked(id, async () => {
      const vm = this.ports.get(id);
      this.ports.requireStopped(id);
      if (vm.diskEncryption) throw new AppError('实例磁盘已经加密', 409);
      if (vm.branchOrigin)
        throw new AppError('快照分支保留明文合并基线，不能加密；请先合并或删除分支', 409);
      if (vm.sandbox || vm.rescueOf) throw new AppError('临时实例不能加密磁盘', 409);
      if (vm.snapshots.length) throw new AppError('请先删除或导出内部快照，再加密实例磁盘', 409);
      const config = diskEncryptionSchema.parse({ format: 'luks', secretName });
      const paths = this.diskEncryptionPaths(id);
      for (const path of [paths.staged, paths.backup, paths.pending])
        if (existsSync(path)) throw new AppError('存在未完成的磁盘加密文件，请先重启服务执行恢复', 409);
      if ((await this.info(id)).encrypted) throw new AppError('磁盘已加密但缺少加密配置', 409);
      const original = await lstat(paths.disk);
      if (!original.isFile()) throw new AppError('实例磁盘必须是普通文件', 409);
      const secret = await this.ports.openSecret(id, config.secretName);
      let published = false;
      try {
        await writeFile(paths.pending, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
        signal?.throwIfAborted();
        const object = ['--object', qemuSecretObject(secret.file)];
        await this.ports.engine().run('sakura-img', [
          'convert', ...object, '-f', 'qcow2', '-O', 'qcow2',
          '-o', 'encrypt.format=luks,encrypt.key-secret=sakura-disk-key',
          paths.disk, paths.staged,
        ], { signal, timeoutMs: 1800000 });
        const stagedInfo = JSON.parse(await this.ports.engine().run('sakura-img',
          ['info', '-f', 'qcow2', '--output=json', paths.staged]));
        if (stagedInfo.format !== 'qcow2' || stagedInfo.encrypted !== true ||
            stagedInfo['backing-filename'])
          throw new AppError('加密转换结果无效，原磁盘未修改', 409);
        await this.ports.engine().run('sakura-img', ['check', ...object, '--image-opts',
          encryptedImageOptions(paths.staged)], { signal, timeoutMs: 1800000 });
        await this.ports.engine().run('sakura-img', ['compare', ...object, '--image-opts',
          plainImageOptions(paths.disk), encryptedImageOptions(paths.staged)],
        { signal, timeoutMs: 1800000 });
        const handle = await open(paths.staged, 'r+');
        try { await handle.sync(); } finally { await handle.close(); }
        signal?.throwIfAborted();
        await link(paths.disk, paths.backup);
        await rename(paths.staged, paths.disk);
        published = true;
        vm.diskEncryption = config;
        await this.ports.save();
        await rm(paths.backup, { force: true });
        await rm(paths.pending, { force: true });
        this.ports.changed();
        return this.status(id);
      } finally {
        await secret.close();
        if (!published) {
          await rm(paths.staged, { force: true });
          await rm(paths.backup, { force: true });
          await rm(paths.pending, { force: true });
        }
      }
    });
  }
}
