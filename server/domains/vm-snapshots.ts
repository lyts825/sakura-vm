/**
 * 模块职责：管理磁盘快照及对应身份记录，恢复和编辑前校验快照归属与数量限制。
 * Module purpose: Owns disk snapshots and identity records, validating ownership and count limits before restore or edit.
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
    /**
     * 签名 / Signature: VmSnapshotStorePorts.get.
     * 功能：为管理磁盘快照及对应身份记录声明 get 的输入与结果契约，所属容器为 VmSnapshotStorePorts。
     * Purpose: Declares the input/result contract for get in VmSnapshotStorePorts. Module responsibility: Owns disk snapshots and identity records, validating ownership and count limits before restore or edit.
     * 输入 / Inputs: id: string
     * 输出 / Returns: VMRecord.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    get(id: string): VMRecord;
    /**
     * 签名 / Signature: VmSnapshotStorePorts.engine.
     * 功能：为管理磁盘快照及对应身份记录声明 engine 的输入与结果契约，所属容器为 VmSnapshotStorePorts。
     * Purpose: Declares the input/result contract for engine in VmSnapshotStorePorts. Module responsibility: Owns disk snapshots and identity records, validating ownership and count limits before restore or edit.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: VmEnginePort['engine'].
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    engine(): VmEnginePort['engine'];
    /**
     * 签名 / Signature: VmSnapshotStorePorts.trustedBoot.
     * 功能：为管理磁盘快照及对应身份记录声明 trustedBoot 的输入与结果契约，所属容器为 VmSnapshotStorePorts。
     * Purpose: Declares the input/result contract for trustedBoot in VmSnapshotStorePorts. Module responsibility: Owns disk snapshots and identity records, validating ownership and count limits before restore or edit.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: VmSnapshotStatePort | undefined.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    trustedBoot(): VmSnapshotStatePort | undefined;
    /**
     * 签名 / Signature: VmSnapshotStorePorts.save.
     * 功能：为管理磁盘快照及对应身份记录声明 save 的输入与结果契约，所属容器为 VmSnapshotStorePorts。
     * Purpose: Declares the input/result contract for save in VmSnapshotStorePorts. Module responsibility: Owns disk snapshots and identity records, validating ownership and count limits before restore or edit.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    save(): Promise<void>;
    /**
     * 签名 / Signature: VmSnapshotStorePorts.view.
     * 功能：为管理磁盘快照及对应身份记录声明 view 的输入与结果契约，所属容器为 VmSnapshotStorePorts。
     * Purpose: Declares the input/result contract for view in VmSnapshotStorePorts. Module responsibility: Owns disk snapshots and identity records, validating ownership and count limits before restore or edit.
     * 输入 / Inputs: id: string
     * 输出 / Returns: Promise<VMView>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    view(id: string): Promise<VMView>;
    /**
     * 签名 / Signature: VmSnapshotStorePorts.changed.
     * 功能：为管理磁盘快照及对应身份记录声明 changed 的输入与结果契约，所属容器为 VmSnapshotStorePorts。
     * Purpose: Declares the input/result contract for changed in VmSnapshotStorePorts. Module responsibility: Owns disk snapshots and identity records, validating ownership and count limits before restore or edit.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    changed(): void;
  };

/** Owns disk snapshot metadata and controller identity; VM transitions stay with the host. */
export class VmSnapshots {
  /**
   * 入口 / Entry: VmSnapshots.constructor.
   * 功能：建立 VmSnapshots 的管理磁盘快照及对应身份记录上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the VmSnapshots context for this module's responsibility: Owns disk snapshots and identity records, validating ownership and count limits before restore or edit. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: ports: VmSnapshotStorePorts
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private readonly ports: VmSnapshotStorePorts) {}
  /**
   * 入口 / Entry: VmSnapshots.snapshotIdentityFile.
   * 功能：在管理磁盘快照及对应身份记录中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `join(vmDir(id), `.snapshot-${checkedId(snapshotId)}.json`)` 供上层消费（`VmSnapshots`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `VmSnapshots`; this entry produces `join(vmDir(id), `.snapshot-${checkedId(snapshotId)}.json`)` for its caller. Module context: Owns disk snapshots and identity records, validating ownership and count limits before restore or edit.
   * 处理：通过 `join`, `vmDir`, `checkedId` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `vmDir`, `checkedId`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; snapshotId: string
   * 输出 / Returns: `join(vmDir(id), `.snapshot-${checkedId(snapshotId)}.json`)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private snapshotIdentityFile(id: string, snapshotId: string) {
    return join(vmDir(id), `.snapshot-${checkedId(snapshotId)}.json`);
  }
  /**
   * 入口 / Entry: VmSnapshots.identity.
   * 功能：在管理磁盘快照及对应身份记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ key: identity.key, seed: Buffer.from(identity.seed, 'base64'), pending: identity.pending }` / `{ key, seed, pending }` 供上层消费（`VmSnapshots`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VmSnapshots`; this entry produces `{ key: identity.key, seed: Buffer.from(identity.seed, 'base64'), pending: identity.pending }` / `{ key, seed, pending }` for its caller. Module context: Owns disk snapshots and identity records, validating ownership and count limits before restore or edit.
   * 处理：通过 `this.ports.get`, `vm.snapshots.some`, `readFile`, `this.snapshotIdentityFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ports.get`, `vm.snapshots.some`, `readFile`, `this.snapshotIdentityFile`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; snapshotId: string optional
   * 输出 / Returns: Promise<DiskIdentity>；结果来自 / values from `{ key: identity.key, seed: Buffer.from(identity.seed, 'base64'), pending: identity.pending }`; `{ key, seed, pending }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `snapshotId`; `!vm.snapshots.some((shot) => shot.id === snapshotId)`; `typeof identity.key !== 'string' || typeof identity.seed !== 'string' || (identity.pending !== undefined && typeof identity.p…`; 异常 / errors `new AppError('快照不存在', 404)`; `new AppError('快照身份数据损坏')`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
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
  /**
   * 入口 / Entry: VmSnapshots.snapshotIdentity.
   * 功能：从当前输入或状态计算 `{ key, seed }`，供调用方后续验证或使用。
   * Purpose: Computes `{ key, seed }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string; snapshotId: string optional
   * 输出 / Returns: Promise<{ key: string; seed: Buffer }>；结果来自 / values from `{ key, seed }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async snapshotIdentity(id: string, snapshotId?: string): Promise<{ key: string; seed: Buffer }> {
    const { key, seed } = await this.identity(id, snapshotId);
    return { key, seed };
  }
  /**
   * 入口 / Entry: VmSnapshots.capture.
   * 功能：在管理磁盘快照及对应身份记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `shot` 供上层消费（`VmSnapshots`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VmSnapshots`; this entry produces `shot` for its caller. Module context: Owns disk snapshots and identity records, validating ownership and count limits before restore or edit.
   * 处理：通过 `randomUUID`, `this.identity`, `this.snapshotIdentityFile`, `writeFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `randomUUID`, `this.identity`, `this.snapshotIdentityFile`, `writeFile`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `onlinePort === undefined`; `vm.diskEncryption`; `stateFingerprint`.
   * 输入 / Inputs: vm: VMRecord; name: string; onlinePort: number optional; stateFingerprint: string optional
   * 输出 / Returns: `shot`.
   * 副作用 / Effects: `writeFile`; `rm`; `vm.snapshots.push`; `this.ports.save`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `await rm(file, { force: true });`; `await this.ports.trustedBoot()?.remove(vm.id, shot.id);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await rm(file, { force: true });`; `await this.ports.trustedBoot()?.remove(vm.id, shot.id);`; these statements determine whether a failure is absorbed or rejected again.
   */
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
  /**
   * 入口 / Entry: VmSnapshots.snapshot.
   * 功能：把本层请求转交 `this.ports.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.ports.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; name: string
   * 输出 / Returns: `this.ports.locked(id, async () => { const vm = this.ports.get(id); this.ports.requireStopped(id); if (vm.snapshots.length >= …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async snapshot(id: string, name: string) {
    /**
     * 入口 / Entry: VmSnapshots.snapshot.callback@112.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.ports.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.ports.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.capture(vm, name)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `vm.snapshots.length >= 20`; 异常 / errors `new AppError('最多保留 20 个磁盘快照')`.
     */
    return this.ports.locked(id, async () => {
      const vm = this.ports.get(id);
      this.ports.requireStopped(id);
      if (vm.snapshots.length >= 20) throw new AppError('最多保留 20 个磁盘快照');
      return this.capture(vm, name);
    });
  }
  /**
   * 入口 / Entry: VmSnapshots.restore.
   * 功能：把本层请求转交 `this.ports.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.ports.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; snapshotId: string; backup: default=false
   * 输出 / Returns: `this.ports.locked(id, async () => { const vm = this.ports.get(id); this.ports.requireStopped(id); const selected = vm.snapsho…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async restore(id: string, snapshotId: string, backup = false) {
    /**
     * 入口 / Entry: VmSnapshots.restore.callback@120.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.ports.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.ports.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.ports.view(id)`.
     * 副作用 / Effects: `writeIdentityFile`; `rm`; `this.ports.save`; 更新 / updates `vm.diskGiB`, `vm.pendingResize`.
     * 拒绝 / Refusals: 条件 / conditions `!selected`; `selected.consistency === 'vmstate'`; `backup`; 异常 / errors `new AppError('快照不存在', 404)`; `new AppError('此快照包含 RAM 状态，请启动实例并使用整机状态恢复', 409)`.
     */
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
  /**
   * 入口 / Entry: VmSnapshots.editSnapshot.
   * 功能：把本层请求转交 `this.ports.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.ports.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; snapshotId: string; patch: { name: string; note: string } | null
   * 输出 / Returns: `this.ports.locked(id, async () => { this.ports.requireStopped(id); const vm = this.ports.get(id); const shot = vm.snapshots.f…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async editSnapshot(id: string, snapshotId: string, patch: { name: string; note: string } | null) {
    /**
     * 入口 / Entry: VmSnapshots.editSnapshot.callback@156.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.ports.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.ports.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.ports.view(id)`.
     * 副作用 / Effects: `rm`; `this.ports.save`; 更新 / updates `vm.snapshots`.
     * 拒绝 / Refusals: 条件 / conditions `!shot`; 异常 / errors `new AppError('快照不存在', 404)`.
     */
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
