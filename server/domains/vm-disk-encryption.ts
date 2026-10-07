/**
 * 模块职责：管理磁盘加密事务与恢复，核对配置中的口令引用和实际磁盘格式是否一致。
 * Module purpose: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
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
  /**
   * 签名 / Signature: DiskEncryptionPorts.engine.
   * 功能：为管理磁盘加密事务与恢复声明 engine 的输入与结果契约，所属容器为 DiskEncryptionPorts。
   * Purpose: Declares the input/result contract for engine in DiskEncryptionPorts. Module responsibility: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Pick<Engine, 'run'>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  engine(): Pick<Engine, 'run'>;
  /**
   * 签名 / Signature: DiskEncryptionPorts.get.
   * 功能：为管理磁盘加密事务与恢复声明 get 的输入与结果契约，所属容器为 DiskEncryptionPorts。
   * Purpose: Declares the input/result contract for get in DiskEncryptionPorts. Module responsibility: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
   * 输入 / Inputs: id: string
   * 输出 / Returns: VMRecord.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  get(id: string): VMRecord;
  /**
   * 签名 / Signature: DiskEncryptionPorts.running.
   * 功能：为管理磁盘加密事务与恢复声明 running 的输入与结果契约，所属容器为 DiskEncryptionPorts。
   * Purpose: Declares the input/result contract for running in DiskEncryptionPorts. Module responsibility: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
   * 输入 / Inputs: id: string
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  running(id: string): boolean;
  /**
   * 签名 / Signature: DiskEncryptionPorts.requireStopped.
   * 功能：为管理磁盘加密事务与恢复声明 requireStopped 的输入与结果契约，所属容器为 DiskEncryptionPorts。
   * Purpose: Declares the input/result contract for requireStopped in DiskEncryptionPorts. Module responsibility: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
   * 输入 / Inputs: id: string
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  requireStopped(id: string): void;
  /**
   * 签名 / Signature: DiskEncryptionPorts.locked.
   * 功能：为管理磁盘加密事务与恢复声明 locked 的输入与结果契约，所属容器为 DiskEncryptionPorts。
   * Purpose: Declares the input/result contract for locked in DiskEncryptionPorts. Module responsibility: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
   * 输入 / Inputs: id: string; work: () => Promise<T>
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  locked<T>(id: string, work:
  /**
   * 中文功能：将 DiskEncryptionPorts.locked.work 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
   * English: Supplies work to the original context owned by DiskEncryptionPorts.locked.work, returning the declared business result or asynchronous rejection.
   * 所属 / Owner: DiskEncryptionPorts.locked.work.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `Promise<T>`.
   */
  () => Promise<T>): Promise<T>;
  /**
   * 签名 / Signature: DiskEncryptionPorts.save.
   * 功能：为管理磁盘加密事务与恢复声明 save 的输入与结果契约，所属容器为 DiskEncryptionPorts。
   * Purpose: Declares the input/result contract for save in DiskEncryptionPorts. Module responsibility: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  save(): Promise<void>;
  /**
   * 签名 / Signature: DiskEncryptionPorts.changed.
   * 功能：为管理磁盘加密事务与恢复声明 changed 的输入与结果契约，所属容器为 DiskEncryptionPorts。
   * Purpose: Declares the input/result contract for changed in DiskEncryptionPorts. Module responsibility: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  changed(): void;
  /**
   * 签名 / Signature: DiskEncryptionPorts.openSecret.
   * 功能：为管理磁盘加密事务与恢复声明 openSecret 的输入与结果契约，所属容器为 DiskEncryptionPorts。
   * Purpose: Declares the input/result contract for openSecret in DiskEncryptionPorts. Module responsibility: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
   * 输入 / Inputs: id: string; name: string
   * 输出 / Returns: Promise<{ file: string; close(): Promise<void> }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  openSecret(id: string, name: string): Promise<{ file: string;
  /**
   * 签名 / Signature: DiskEncryptionPorts.close.
   * 功能：为管理磁盘加密事务与恢复声明 close 的输入与结果契约，所属容器为 DiskEncryptionPorts。
   * Purpose: Declares the input/result contract for close in DiskEncryptionPorts. Module responsibility: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  close(): Promise<void> }>;
  /**
   * 签名 / Signature: DiskEncryptionPorts.secretNames.
   * 功能：为管理磁盘加密事务与恢复声明 secretNames 的输入与结果契约，所属容器为 DiskEncryptionPorts。
   * Purpose: Declares the input/result contract for secretNames in DiskEncryptionPorts. Module responsibility: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<readonly { name: string }[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  secretNames(id: string): Promise<readonly { name: string }[]>;
};

/** Owns conversion publication and crash recovery; lifecycle coordination stays with the host. */
export class VmDiskEncryption {
  /**
   * 入口 / Entry: VmDiskEncryption.constructor.
   * 功能：建立 VmDiskEncryption 的管理磁盘加密事务与恢复上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the VmDiskEncryption context for this module's responsibility: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: ports: DiskEncryptionPorts
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private readonly ports: DiskEncryptionPorts) {}
  /**
   * 入口 / Entry: VmDiskEncryption.diskEncryptionPaths.
   * 功能：在管理磁盘加密事务与恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ disk: join(dir, 'disk.qcow2'), staged: join(dir, '.disk.encrypting.qcow2'), backup: join(dir, '.disk.before-encrypt.qcow2')…` 供上层消费（`VmDiskEncryption`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VmDiskEncryption`; this entry produces `{ disk: join(dir, 'disk.qcow2'), staged: join(dir, '.disk.encrypting.qcow2'), backup: join(dir, '.disk.before-encrypt.qcow2')…` for its caller. Module context: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
   * 处理：通过 `vmDir`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `vmDir`, `join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ disk: join(dir, 'disk.qcow2'), staged: join(dir, '.disk.encrypting.qcow2'), backup: join(dir, '.disk.before-encrypt.qcow2')…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private diskEncryptionPaths(id: string) {
    const dir = vmDir(id);
    return {
      disk: join(dir, 'disk.qcow2'),
      staged: join(dir, '.disk.encrypting.qcow2'),
      backup: join(dir, '.disk.before-encrypt.qcow2'),
      pending: join(dir, '.disk-encryption.pending.json'),
    };
  }
  /**
   * 入口 / Entry: VmDiskEncryption.info.
   * 功能：在管理磁盘加密事务与恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `JSON.parse(output) as { format?: string; encrypted?: boolean; 'backing-filename'?: string }` 供上层消费（`VmDiskEncryption`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VmDiskEncryption`; this entry produces `JSON.parse(output) as { format?: string; encrypted?: boolean; 'backing-filename'?: string }` for its caller. Module context: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
   * 处理：通过 `this.ports.engine().run`, `this.ports.engine`, `this.diskEncryptionPaths` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ports.engine().run`, `this.ports.engine`, `this.diskEncryptionPaths`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `JSON.parse(output) as { format?: string; encrypted?: boolean; 'backing-filename'?: string }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async info(id: string) {
    const output = await this.ports.engine().run('sakura-img',
      ['info', '-f', 'qcow2', '--output=json', this.diskEncryptionPaths(id).disk]);
    return JSON.parse(output) as { format?: string; encrypted?: boolean; 'backing-filename'?: string };
  }
  /**
   * 入口 / Entry: VmDiskEncryption.recover.
   * 功能：在管理磁盘加密事务与恢复中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`VmDiskEncryption`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VmDiskEncryption`; this entry produces `void` for its caller. Module context: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
   * 处理：通过 `this.diskEncryptionPaths`, `readFile().catch`, `readFile`, `this.info` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.diskEncryptionPaths`, `readFile().catch`, `readFile`, `this.info`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!pending && !vm.diskEncryption`.
   * 输入 / Inputs: vm: VMRecord
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.ports.save`; `rm`; 更新 / updates `vm.diskEncryption`.
   * 拒绝 / Refusals: 条件 / conditions `pending`; `info.encrypted`; `vm.diskEncryption && vm.diskEncryption.secretName !== config.secretName`; 异常 / errors `new AppError(`实例 ${vm.name} 的磁盘口令引用与待恢复事务不一致`, 409)`; `new AppError(`实例 ${vm.name} 的加密标记与明文磁盘不一致，请先恢复磁盘`, 409)`.
   */
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
  /**
   * 入口 / Entry: VmDiskEncryption.status.
   * 功能：在管理磁盘加密事务与恢复中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ enabled: !!vm.diskEncryption, encrypted: !!info.encrypted, format: vm.diskEncryption?.format, secretName: vm.diskEncryption…` 供上层消费（`VmDiskEncryption`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `VmDiskEncryption`; this entry produces `{ enabled: !!vm.diskEncryption, encrypted: !!info.encrypted, format: vm.diskEncryption?.format, secretName: vm.diskEncryption…` for its caller. Module context: Owns disk encryption transactions and recovery, checking that configured secret references match physical disk format.
   * 处理：通过 `this.ports.get`, `this.ports.running`, `this.info`, `inline.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ports.get`, `this.ports.running`, `this.info`, `inline.some`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ enabled: !!vm.diskEncryption, encrypted: !!info.encrypted, format: vm.diskEncryption?.format, secretName: vm.diskEncryption…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
  /**
   * 入口 / Entry: VmDiskEncryption.encrypt.
   * 功能：把本层请求转交 `this.ports.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.ports.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; secretName: string; signal: AbortSignal optional
   * 输出 / Returns: `this.ports.locked(id, async () => { const vm = this.ports.get(id); this.ports.requireStopped(id); if (vm.diskEncryption) thro…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async encrypt(id: string, secretName: string, signal?: AbortSignal) {
    /**
     * 入口 / Entry: VmDiskEncryption.encrypt.callback@81.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.ports.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.ports.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.status(id)`.
     * 副作用 / Effects: `writeFile`; `handle.close`; `rename`; `this.ports.save`; `rm`; 更新 / updates `published`, `vm.diskEncryption`.
     * 拒绝 / Refusals: 条件 / conditions `vm.diskEncryption`; `vm.branchOrigin`; `vm.sandbox || vm.rescueOf`; 异常 / errors `new AppError('实例磁盘已经加密', 409)`; `new AppError('快照分支保留明文合并基线，不能加密；请先合并或删除分支', 409)`.
     * 收尾：退出 try 区域时始终执行 `await secret.close();`; `if (!published) { await rm(paths.staged, { force: true }); await rm(paths.backup, { force: true }); await rm(paths.pending, {…`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `await secret.close();`; `if (!published) { await rm(paths.staged, { force: true }); await rm(paths.backup, { force: true }); await rm(paths.pending, {…`; these steps also apply to exceptional exits.
     */
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
