/**
 * 模块职责：管理虚拟机目录、运行生命周期与领域端口，协调启动、停止、快照、迁移和资源清理。
 * Module purpose: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
 */
import { VmDiskEncryption } from './domains/vm-disk-encryption.ts';
import { VmSnapshots } from './domains/vm-snapshots.ts';
import { VmStoragePlacement } from './domains/vm-storage-placement.ts';
import { SandboxLifetimes } from './domains/sandbox-lifetimes.ts';
import { VmHaAuthority } from './domains/vm-ha-authority.ts';
import { networkFor, networkRuntime, type NetworkRuntime } from './network/index.ts';
import { isUtf8 } from 'node:buffer';
import { createHash, createPrivateKey, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';

import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { type SFTPWrapper } from 'ssh2';
import { z } from 'zod';
import {
  createSchema,
  haPromotionSchema,
  haRetirementSchema,
  haWitnessEnrollmentSchema,
  liveMigrationFenceSchema,
  liveMigrationFenceIdentitySchema,
  liveMigrationOriginSchema,
  organizationSchema,
  BOOT_TIMEOUT_MS,
  type HaPromotion,
  type LiveMigrationFence,
  type MigrationFingerprint,
  type VMConfig,
  type VMRecord,
  type VMStatus,
  type VMView,
} from '../shared/contracts/vm.ts';
import { AppError } from '../shared/errors.ts';
import { liveMigrationPrepareReceiptSchema, liveMigrationTargetStatusSchema, type LiveMigrationTargetStatus } from '../shared/contracts/live-migration.ts';
import { captureRecoveryOrigin } from './recovery-origin.ts';
import { captureOperationCheck } from './operation-context.ts';
import { pluginAuthority } from './plugin-authority.ts';
import { migrationDigest, migrationFenceIdentity } from './live-migration-proof.ts';
import {
  audioArguments,
  deviceArguments,
  diskOptions,
  hardwareArguments,
  hardwareSchema,
  qemuCpuModel,
} from '../shared/hardware.ts';
import { checkedId, guestPath } from '../shared/paths.ts';
import { sandboxExpired, sandboxPolicySchema, type SandboxPolicy } from '../shared/sandbox.ts';
import { bootGuardStatus, recordBootAttempt, resetBootGuard } from './boot-guard.ts';
import {
  diskEncryptionSchema,
  encryptedDriveOption,
  encryptedImageOptions,
  openDiskSecret,
  qemuSecretObject,
  withDiskSecret,
} from './disk-encryption.ts';
import { Files, MAX_TEXT_BYTES } from './files.ts';
import { ensureUefiFirmware, requireUefiSupport } from './firmware.ts';
import { cpuSetSize } from './guest-hardware.ts';
import { distroInfo } from './images.ts';
import { liveMigrationProjectsSchema, type LiveMigrationProjects } from './live-migration-projects.ts';
import { readStore, regularDirectory, within, writeStore } from './local-store.ts';
import { DATA, IMAGE, VM_ROOT, vmDir } from './paths.ts';
import { GuestAgent, freePort, qmp, qmpSnapshotJob } from './qmp.ts';
import { resourcePolicy, validateAdmission } from './resource-policies.ts';
import type { Engine } from './runtime.ts';
import { Secrets } from './secrets.ts';
import { bootSetup, cloudNetwork, cloudUserData, createSshKey, metaData, seedIso, userData } from './seed.ts';
import { StoragePools } from './storage-pools.ts';
import { writeIdentityFile } from './vm-storage.ts';
import { storageRuntime, withStorageLease, type StorageLease } from './storage-runtime.ts';
import { MachineTransport } from './vm-transport.ts';

export { BOOT_TIMEOUT_MS, type MigrationFingerprint } from '../shared/contracts/vm.ts';

import type { Live } from './vm-state.ts';
import { VmLifetime, vmLifetime, vmBootProviders } from './vm-lifetime.ts';
import { ExecutionScope } from './execution-scope.ts';
import { ManagedHooks } from './managed-hooks.ts';
import { withResourceContext } from './host-runtime/index.ts';

const { connectLocal: createConnection } = networkFor('core:machines');
export type BootAttachment = { args: string[];
/**
 * 签名 / Signature: BootAttachment.close.
 * 功能：为管理虚拟机目录、运行生命周期与领域端口声明 close 的输入与结果契约，所属容器为 BootAttachment。
 * Purpose: Declares the input/result contract for close in BootAttachment. Module responsibility: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
close: () => Promise<void>; machine?: string };
export class Machines extends EventEmitter {
  storagePools: StoragePools = new StoragePools(this);
  /**
   * 入口 / Entry: Machines.trustedBootStateFingerprint.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `vmBootProviders(this).find(([name]) => name === 'trusted-boot')?.[1].stateFingerprint` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `vmBootProviders(this).find(([name]) => name === 'trusted-boot')?.[1].stateFingerprint` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `vmBootProviders().find`, `vmBootProviders` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `vmBootProviders().find`, `vmBootProviders`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `vmBootProviders(this).find(([name]) => name === 'trusted-boot')?.[1].stateFingerprint`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private get trustedBootStateFingerprint() { return vmBootProviders(this).find(([name]) => name === 'trusted-boot')?.[1].stateFingerprint; }
  /**
   * 入口 / Entry: Machines.trustedBootSnapshot.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `vmBootProviders(this).find(([name]) => name === 'trusted-boot')?.[1].snapshot` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `vmBootProviders(this).find(([name]) => name === 'trusted-boot')?.[1].snapshot` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `vmBootProviders().find`, `vmBootProviders` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `vmBootProviders().find`, `vmBootProviders`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `vmBootProviders(this).find(([name]) => name === 'trusted-boot')?.[1].snapshot`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private get trustedBootSnapshot() { return vmBootProviders(this).find(([name]) => name === 'trusted-boot')?.[1].snapshot; }
  private fileInterceptors = new ManagedHooks<[string, string, SFTPWrapper, AbortSignal | undefined]>();
  /**
   * 入口 / Entry: Machines.beforeFileReplace.
   * 功能：把本层请求转交 `this.fileInterceptors.register`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.fileInterceptors.register` and propagates the provider result or rejection.
   * 输入 / Inputs: callback: (id: string, path: string, ftp: SFTPWrapper, signal?: AbortSignal) => Promise<void>
   * 输出 / Returns: `this.fileInterceptors.register(callback)`.
   * 副作用 / Effects: `this.fileInterceptors.register`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  beforeFileReplace(callback: (id: string, path: string, ftp: SFTPWrapper, signal?: AbortSignal) => Promise<void>) {
    return this.fileInterceptors.register(callback);
  }
  /**
   * 入口 / Entry: Machines.fileReplacing.
   * 功能：把本层请求转交 `this.fileInterceptors.dispatch`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.fileInterceptors.dispatch` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; path: string; ftp: SFTPWrapper; signal: AbortSignal optional
   * 输出 / Returns: `this.fileInterceptors.dispatch(id, path, ftp, signal)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  fileReplacing(id: string, path: string, ftp: SFTPWrapper, signal?: AbortSignal) {
    return this.fileInterceptors.dispatch(id, path, ftp, signal);
  }
  records = new Map<string, VMRecord>();
  live = new Map<string, Live>();
  logs = new Map<string, string>();
  private locks = new Set<string>();
  private operations = new Set<Promise<void>>();
  private closeTask?: Promise<void>;
  closing = false;
  maintenance = false;
  private incidentLocks = new Set<string>();
  private incidentWrites = Promise.resolve();
  private rescueControllers = new Set<AbortController>();
  private hostPortReservations = new Map<string, Set<number>>();
  private haStartGuards = new ManagedHooks<[string]>();
  private migrationRuns = new Map<string, { identity: string; processId: string; live?: Live; stoppedAt?: string }>();
  private migrationCompletions = new Map<string, string>();
  /**
   * 入口 / Entry: Machines.beforeHaStart.
   * 功能：把本层请求转交 `this.haStartGuards.register`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.haStartGuards.register` and propagates the provider result or rejection.
   * 输入 / Inputs: guard: (id: string) => Promise<void>
   * 输出 / Returns: `this.haStartGuards.register(guard)`.
   * 副作用 / Effects: `this.haStartGuards.register`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  beforeHaStart(guard: (id: string) => Promise<void>) { return this.haStartGuards.register(guard); }
  /**
   * 入口 / Entry: Machines.reserveHostPorts.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `inline.some`, `this.records.values`, `values.has`, `this.hostPortReservations.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.some`, `this.records.values`, `values.has`, `this.hostPortReservations.set`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `next.size`.
   * 输入 / Inputs: owner: string; ports: Iterable<number>
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.hostPortReservations.set`; `this.hostPortReservations.delete`.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isInteger(port) || port < 1024 || port > 65535`; `[...this.records.values()].some((vm) => vm.forwards.some((forward) => forward.host === port))`; `key !== owner && values.has(port)`; 异常 / errors `new AppError('保留的主机端口无效')`; `new AppError(`端口 ${port} 已被实例转发使用`, 409)`.
   */
  reserveHostPorts(owner: string, ports: Iterable<number>) {
    const next = new Set(ports);
    for (const port of next) {
      if (!Number.isInteger(port) || port < 1024 || port > 65535)
        throw new AppError('保留的主机端口无效');
      if ([...this.records.values()].some((vm) => vm.forwards.some((forward) => forward.host === port)))
        throw new AppError(`端口 ${port} 已被实例转发使用`, 409);
      for (const [key, values] of this.hostPortReservations)
        if (key !== owner && values.has(port)) throw new AppError(`端口 ${port} 已被其他服务保留`, 409);
    }
    if (next.size) this.hostPortReservations.set(owner, next);
    else this.hostPortReservations.delete(owner);
  }
  /**
   * 入口 / Entry: Machines.requireUnreservedPorts.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`Machines`）。
   * Purpose: Checks admission, input or resource ownership in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.hostPortReservations.values`, `values.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.hostPortReservations.values`, `values.has`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: forwards: VMConfig['forwards']
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `values.has(forward.host)`; 异常 / errors `new AppError(`端口 ${forward.host} 已被宿主服务保留`, 409)`.
   */
  private requireUnreservedPorts(forwards: VMConfig['forwards']) {
    for (const forward of forwards)
      for (const values of this.hostPortReservations.values())
        if (values.has(forward.host))
          throw new AppError(`端口 ${forward.host} 已被宿主服务保留`, 409);
  }
  /**
   * 入口 / Entry: Machines.incidentLocked.
   * 功能：从当前输入或状态计算 `this.incidentLocks.has(id)`，供调用方后续验证或使用。
   * Purpose: Computes `this.incidentLocks.has(id)` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.incidentLocks.has(id)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  incidentLocked(id: string) {
    return this.incidentLocks.has(id);
  }
  /**
   * 入口 / Entry: Machines.requireUnlocked.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`Machines`）。
   * Purpose: Checks admission, input or resource ownership in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.incidentLocked`, `this.records.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.incidentLocked`, `this.records.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.incidentLocked(id) || (this.records.get(id)?.rescueOf && this.incidentLocked(this.records.get(id)!.rescueOf!))`; 异常 / errors `new AppError('实例处于应急锁定；请先显式解除锁定', 423, 'INCIDENT_LOCKED')`.
   */
  requireUnlocked(id: string) {
    if (
      this.incidentLocked(id) ||
      (this.records.get(id)?.rescueOf && this.incidentLocked(this.records.get(id)!.rescueOf!))
    )
      throw new AppError('实例处于应急锁定；请先显式解除锁定', 423, 'INCIDENT_LOCKED');
  }
  /**
   * 入口 / Entry: Machines.setIncidentLockdown.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ locked: this.incidentLocked(id), stopped: !this.live.has(id) }` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `{ locked: this.incidentLocked(id), stopped: !this.live.has(id) }` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.get`, `this.incidentWrites.catch().then`, `this.incidentWrites.catch`, `this.incidentLocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.get`, `this.incidentWrites.catch().then`, `this.incidentWrites.catch`, `this.incidentLocked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; locked: boolean
   * 输出 / Returns: `{ locked: this.incidentLocked(id), stopped: !this.live.has(id) }`.
   * 副作用 / Effects: 更新 / updates `this.incidentWrites`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async setIncidentLockdown(id: string, locked: boolean) {
    this.get(id);
    /**
     * 入口 / Entry: Machines.setIncidentLockdown.callback@160.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.incidentWrites.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.incidentWrites.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.incidentLocks.add`; `this.incidentLocks.delete`; `writeStore`; `this.emit`; `client.destroy`.
     * 拒绝 / Refusals: 异常 / errors `error`.
     * 失败处理：catch 分支执行 `if (previous) this.incidentLocks.add(id); else this.incidentLocks.delete(id);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (previous) this.incidentLocks.add(id); else this.incidentLocks.delete(id);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    const write = this.incidentWrites
      .catch(() => {})
      .then(async () => {
        const previous = this.incidentLocked(id);
        if (locked) this.incidentLocks.add(id);
        else this.incidentLocks.delete(id);
        try {
          await writeStore(join(DATA, 'incident-lockdown.json'), [...this.incidentLocks]);
        } catch (error) {
          if (previous) this.incidentLocks.add(id);
          else this.incidentLocks.delete(id);
          throw error;
        }
        if (locked) {
          this.emit('incident-lockdown', id);
          for (const client of this.live.get(id)?.clients || []) client.destroy();
          await this.stopInternal(id, false);
        }
        this.emit('change');
      });
    this.incidentWrites = write;
    await write;
    return { locked: this.incidentLocked(id), stopped: !this.live.has(id) };
  }
  /**
   * 入口 / Entry: Machines.enterMaintenance.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `() => { if (!released) { released = true; this.maintenance = false; } }` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `() => { if (!released) { released = true; this.maintenance = false; } }` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `() => { if (!released) { released = true; this.maintenance = false; } }`.
   * 副作用 / Effects: 更新 / updates `this.maintenance`.
   * 拒绝 / Refusals: 条件 / conditions `this.closing || this.maintenance || this.operations.size || this.live.size`; 异常 / errors `new AppError('请停止全部实例并等待正在执行的操作完成', 409)`.
   */
  enterMaintenance() {
    if (this.closing || this.maintenance || this.operations.size || this.live.size)
      throw new AppError('请停止全部实例并等待正在执行的操作完成', 409);
    this.maintenance = true;
    let released = false;
    return () => { if (!released) { released = true; this.maintenance = false; } };
  }
  /**
   * 入口 / Entry: Machines.constructor.
   * 功能：建立 Machines 的管理虚拟机目录、运行生命周期与领域端口上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Machines context for this module's responsibility: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: engine: Engine; network: Pick<NetworkRuntime, 'attachVm'> default=networkRuntime
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(public engine: Engine, readonly network: Pick<NetworkRuntime, 'attachVm'> = networkRuntime) {
    super();
  }
  /**
   * 入口 / Entry: Machines.init.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，初始化并核对当前领域状态；处理结果记录到 `this.incidentLocks`, `r.sandbox`, `r.diskEncryption`（`Machines`）。
   * Purpose: Initializes and verifies current domain state in `Machines`; the outcome is recorded in `this.incidentLocks`, `r.sandbox`, `r.diskEncryption`. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `mkdir`, `this.storagePools.init`, `readStore`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `mkdir`, `this.storagePools.init`, `readStore`, `join`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `r.diskEncryption !== undefined`; `r.haPromotion !== undefined`; `r.haRetirement !== undefined`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `mkdir`; `createSchema.parse`; `this.records.set`; `this.migrationCompletions.set`; 更新 / updates `this.incidentLocks`, `r.sandbox`, `r.diskEncryption`, `r.haPromotion`.
   * 拒绝 / Refusals: 条件 / conditions `!Array.isArray(locks) || locks.some((id) => typeof id !== 'string')`; `r.sandbox !== undefined`; `r.forwards.length`; 异常 / errors `new Error('应急锁定状态损坏')`; `new Error('沙箱不允许额外端口转发')`.
   * 失败处理：catch 分支执行 `if (e.code !== 'ENOENT') throw e;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (e.code !== 'ENOENT') throw e;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async init() {
    await mkdir(VM_ROOT, { recursive: true });
    await this.storagePools.init();
    const locks = await readStore<string[]>(join(DATA, 'incident-lockdown.json'), () => []);
    if (!Array.isArray(locks) || locks.some((id) => typeof id !== 'string'))
      throw new Error('应急锁定状态损坏');
    this.incidentLocks = new Set(locks);
    try {
      const records = JSON.parse(await readFile(join(DATA, 'machines.json'), 'utf8')) as VMRecord[];
      for (const r of records) {
        vmDir(r.id);
        createSchema.parse({
          name: r.name,
          memoryMiB: r.memoryMiB,
          cpus: r.cpus,
          diskGiB: r.diskGiB,
          storagePoolId: r.storagePoolId,
          accelerator: r.accelerator,
          forwards: r.forwards,
          distro: r.distro,
          architecture: r.architecture,
          firmware: r.firmware,
          template: r.template,
          hardware: r.hardware,
        });
        if (r.managedNetwork !== undefined) r.managedNetwork = z.enum(['isolated', 'nat']).parse(r.managedNetwork);
        if (r.sandbox !== undefined) {
          r.sandbox = sandboxPolicySchema.parse(r.sandbox);
          if (r.forwards.length) throw new Error('沙箱不允许额外端口转发');
        }
        if (r.diskEncryption !== undefined)
          r.diskEncryption = diskEncryptionSchema.parse(r.diskEncryption);
        if (r.haPromotion !== undefined)
          r.haPromotion = haPromotionSchema.parse(r.haPromotion);
        if (r.haRetirement !== undefined)
          r.haRetirement = haRetirementSchema.parse(r.haRetirement);
        if (r.haWitnessEnrollment !== undefined)
          r.haWitnessEnrollment = haWitnessEnrollmentSchema.parse(r.haWitnessEnrollment);
        if (r.liveMigrationFence !== undefined) {
          r.liveMigrationFence = liveMigrationFenceSchema.parse(r.liveMigrationFence);
          if (r.liveMigrationFence.completion && r.liveMigrationFence.completion.sourceVmId !== r.id)
            throw new Error('在线迁移完成证明不属于此来源实例');
        }
        if (r.liveMigrationOrigin !== undefined) {
          r.liveMigrationOrigin = liveMigrationOriginSchema.parse(r.liveMigrationOrigin);
          if (r.liveMigrationOrigin.prepareReceipt && r.liveMigrationOrigin.prepareReceipt.targetVmId !== r.id)
            throw new Error('在线迁移准备回执不属于此目标实例');
        }
        if (r.rescueOf !== undefined) {
          checkedId(r.rescueOf);
          if (
            !r.sandbox ||
            r.sandbox.network !== 'isolated' ||
            r.sandbox.storage !== 'discard-on-stop' ||
            r.sandbox.onExpire !== 'delete'
          )
            throw new Error('救援实例策略损坏');
          // A host restart never resumes a disk attachment or an old rescue command.
          r.sandbox.expiresAt = new Date(0).toISOString();
        }
        this.storagePools.bind(r.id, r.storagePoolId);
        this.records.set(r.id, r);
        if (r.liveMigrationFence?.completion)
          this.migrationCompletions.set(r.id, migrationDigest(r.liveMigrationFence));
      }
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
    for (const vm of this.records.values()) await this.disks.recover(vm);
    if ([...this.records.values()].some((vm) => vm.sandbox)) {
      await this.expireSandboxes();
      this.watchSandboxes();
    }
  }
  private readonly snapshots: VmSnapshots = new VmSnapshots({
    /**
     * 入口 / Entry: Machines.get.
     * 功能：把本层请求转交 `this.get`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.get` and propagates the provider result or rejection.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.get(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    get: (id) => this.get(id),
    /**
     * 入口 / Entry: Machines.locked.
     * 功能：把本层请求转交 `this.locked`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.locked` and propagates the provider result or rejection.
     * 输入 / Inputs: id; action
     * 输出 / Returns: `this.locked(id, action)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    locked: (id, action) => this.locked(id, action),
    /**
     * 入口 / Entry: Machines.requireStopped.
     * 功能：把本层请求转交 `this.requireStopped`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.requireStopped` and propagates the provider result or rejection.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.requireStopped(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    requireStopped: (id) => this.requireStopped(id),
    /**
     * 入口 / Entry: Machines.withDiskSecret.
     * 功能：把本层请求转交 `this.withDiskSecret`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.withDiskSecret` and propagates the provider result or rejection.
     * 输入 / Inputs: vm; action
     * 输出 / Returns: `this.withDiskSecret(vm, action)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    withDiskSecret: (vm, action) => this.withDiskSecret(vm, action),
    /**
     * 入口 / Entry: Machines.engine.
     * 功能：从当前输入或状态计算 `this.engine`，供调用方后续验证或使用。
     * Purpose: Computes `this.engine` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.engine`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    engine: () => this.engine,
    /**
     * 入口 / Entry: Machines.trustedBoot.
     * 功能：从当前输入或状态计算 `this.trustedBootSnapshot`，供调用方后续验证或使用。
     * Purpose: Computes `this.trustedBootSnapshot` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.trustedBootSnapshot`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    trustedBoot: () => this.trustedBootSnapshot,
    /**
     * 入口 / Entry: Machines.save.
     * 功能：把本层请求转交 `this.save`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.save` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.save()`.
     * 副作用 / Effects: `this.save`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    save: () => this.save(),
    /**
     * 入口 / Entry: Machines.view.
     * 功能：把本层请求转交 `this.view`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.view` and propagates the provider result or rejection.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.view(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    view: (id) => this.view(id),
    /**
     * 入口 / Entry: Machines.changed.
     * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Machines`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
     * 处理：通过 `this.emit` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.emit`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.emit`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    changed: () => { this.emit('change'); },
  });
  private readonly storagePlacement: VmStoragePlacement = new VmStoragePlacement({
    /**
     * 入口 / Entry: Machines.get.
     * 功能：把本层请求转交 `this.get`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.get` and propagates the provider result or rejection.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.get(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    get: (id) => this.get(id),
    /**
     * 入口 / Entry: Machines.locked.
     * 功能：把本层请求转交 `this.locked`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.locked` and propagates the provider result or rejection.
     * 输入 / Inputs: id; action
     * 输出 / Returns: `this.locked(id, action)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    locked: (id, action) => this.locked(id, action),
    /**
     * 入口 / Entry: Machines.requireStopped.
     * 功能：把本层请求转交 `this.requireStopped`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.requireStopped` and propagates the provider result or rejection.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.requireStopped(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    requireStopped: (id) => this.requireStopped(id),
    /**
     * 入口 / Entry: Machines.requireMutableConfig.
     * 功能：把本层请求转交 `this.requireMutableConfig`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.requireMutableConfig` and propagates the provider result or rejection.
     * 输入 / Inputs: vm
     * 输出 / Returns: `this.requireMutableConfig(vm)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    requireMutableConfig: (vm) => this.requireMutableConfig(vm),
    /**
     * 入口 / Entry: Machines.pools.
     * 功能：从当前输入或状态计算 `this.storagePools`，供调用方后续验证或使用。
     * Purpose: Computes `this.storagePools` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.storagePools`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    pools: () => this.storagePools,
    /**
     * 入口 / Entry: Machines.save.
     * 功能：把本层请求转交 `this.save`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.save` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.save()`.
     * 副作用 / Effects: `this.save`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    save: () => this.save(),
    /**
     * 入口 / Entry: Machines.view.
     * 功能：把本层请求转交 `this.view`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.view` and propagates the provider result or rejection.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.view(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    view: (id) => this.view(id),
    /**
     * 入口 / Entry: Machines.changed.
     * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Machines`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
     * 处理：通过 `this.emit` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.emit`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.emit`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    changed: () => { this.emit('change'); },
  });
  private readonly disks: VmDiskEncryption = new VmDiskEncryption({
    /**
     * 入口 / Entry: Machines.engine.
     * 功能：从当前输入或状态计算 `this.engine`，供调用方后续验证或使用。
     * Purpose: Computes `this.engine` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.engine`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    engine: () => this.engine,
    /**
     * 入口 / Entry: Machines.get.
     * 功能：把本层请求转交 `this.get`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.get` and propagates the provider result or rejection.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.get(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    get: id => this.get(id),
    /**
     * 入口 / Entry: Machines.running.
     * 功能：从当前输入或状态计算 `this.live.has(id)`，供调用方后续验证或使用。
     * Purpose: Computes `this.live.has(id)` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.live.has(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    running: id => this.live.has(id),
    /**
     * 入口 / Entry: Machines.requireStopped.
     * 功能：把本层请求转交 `this.requireStopped`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.requireStopped` and propagates the provider result or rejection.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.requireStopped(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    requireStopped: id => this.requireStopped(id),
    /**
     * 入口 / Entry: Machines.locked.
     * 功能：把本层请求转交 `this.locked`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.locked` and propagates the provider result or rejection.
     * 输入 / Inputs: id; work
     * 输出 / Returns: `this.locked(id, work)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    locked: (id, work) => this.locked(id, work),
    /**
     * 入口 / Entry: Machines.save.
     * 功能：把本层请求转交 `this.save`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.save` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.save()`.
     * 副作用 / Effects: `this.save`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    save: () => this.save(),
    /**
     * 入口 / Entry: Machines.changed.
     * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Machines`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
     * 处理：通过 `this.emit` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.emit`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.emit`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    changed: () => { this.emit('change'); },
    /**
     * 入口 / Entry: Machines.openSecret.
     * 功能：把本层请求转交 `openDiskSecret`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `openDiskSecret` and propagates the provider result or rejection.
     * 输入 / Inputs: id; name
     * 输出 / Returns: `openDiskSecret(this, id, name)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    openSecret: (id, name) => openDiskSecret(this, id, name),
    /**
     * 入口 / Entry: Machines.secretNames.
     * 功能：把本层请求转交 `Secrets.list`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `Secrets.list` and propagates the provider result or rejection.
     * 输入 / Inputs: id
     * 输出 / Returns: `new Secrets(this).list(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    secretNames: id => new Secrets(this).list(id),
  });
  /**
   * 入口 / Entry: Machines.diskInfo.
   * 功能：把本层请求转交 `this.disks.info`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.disks.info` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.disks.info(id)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private diskInfo(id: string) { return this.disks.info(id); }
  /**
   * 入口 / Entry: Machines.withDiskSecret.
   * 功能：把本层请求转交 `withDiskSecret`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `withDiskSecret` and propagates the provider result or rejection.
   * 输入 / Inputs: vm: VMRecord; action: (file: string) => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `withDiskSecret(this, vm, action)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async withDiskSecret<T>(vm: VMRecord, action: (file: string) => Promise<T>): Promise<T> {
    return withDiskSecret(this, vm, action);
  }
  /**
   * 入口 / Entry: Machines.diskEncryptionStatus.
   * 功能：把本层请求转交 `this.disks.status`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.disks.status` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.disks.status(id)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async diskEncryptionStatus(id: string) { return this.disks.status(id); }
  /**
   * 入口 / Entry: Machines.encryptDisk.
   * 功能：把本层请求转交 `this.disks.encrypt`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.disks.encrypt` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; secretName: string; signal: AbortSignal optional
   * 输出 / Returns: `this.disks.encrypt(id, secretName, signal)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async encryptDisk(id: string, secretName: string, signal?: AbortSignal) {
    return this.disks.encrypt(id, secretName, signal);
  }
  private readonly sandboxes = new SandboxLifetimes({
    /**
     * 入口 / Entry: Machines.records.
     * 功能：把本层请求转交 `this.records.values`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.records.values` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.records.values()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    records: () => this.records.values(),
    /**
     * 入口 / Entry: Machines.get.
     * 功能：把本层请求转交 `this.get`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.get` and propagates the provider result or rejection.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.get(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    get: id => this.get(id),
    /**
     * 入口 / Entry: Machines.live.
     * 功能：把本层请求转交 `this.live.get`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.live.get` and propagates the provider result or rejection.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.live.get(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    live: id => this.live.get(id),
    /**
     * 入口 / Entry: Machines.closing.
     * 功能：从当前输入或状态计算 `this.closing`，供调用方后续验证或使用。
     * Purpose: Computes `this.closing` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.closing`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    closing: () => this.closing,
    /**
     * 入口 / Entry: Machines.maintenance.
     * 功能：从当前输入或状态计算 `this.maintenance`，供调用方后续验证或使用。
     * Purpose: Computes `this.maintenance` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.maintenance`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    maintenance: () => this.maintenance,
    /**
     * 入口 / Entry: Machines.busy.
     * 功能：从当前输入或状态计算 `this.locks.has(id)`，供调用方后续验证或使用。
     * Purpose: Computes `this.locks.has(id)` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.locks.has(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    busy: id => this.locks.has(id),
    /**
     * 入口 / Entry: Machines.remove.
     * 功能：把本层请求转交 `this.deleteInternal`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.deleteInternal` and propagates the provider result or rejection.
     * 输入 / Inputs: id; allowIncident
     * 输出 / Returns: `this.deleteInternal(id, allowIncident)`.
     * 副作用 / Effects: `this.deleteInternal`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    remove: (id, allowIncident) => this.deleteInternal(id, allowIncident),
    /**
     * 入口 / Entry: Machines.log.
     * 功能：把本层请求转交 `this.log`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.log` and propagates the provider result or rejection.
     * 输入 / Inputs: id; data
     * 输出 / Returns: `this.log(id, data)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    log: (id, data) => this.log(id, data),
  });
  /**
   * 入口 / Entry: Machines.watchSandboxes.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.sandboxes.watch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sandboxes.watch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private watchSandboxes() { this.sandboxes.watch(); }
  /**
   * 入口 / Entry: Machines.expireSandboxes.
   * 功能：把本层请求转交 `this.sandboxes.expire`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.sandboxes.expire` and propagates the provider result or rejection.
   * 输入 / Inputs: now: default=Date.now()
   * 输出 / Returns: Promise<void>；结果来自 / values from `this.sandboxes.expire(now)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  expireSandboxes(now = Date.now()): Promise<void> { return this.sandboxes.expire(now); }
  /**
   * 入口 / Entry: Machines.terminateSandbox.
   * 功能：把本层请求转交 `this.sandboxes.terminate`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.sandboxes.terminate` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.sandboxes.terminate(id)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async terminateSandbox(id: string) { return this.sandboxes.terminate(id); }
  /**
   * 入口 / Entry: Machines.requireSandboxLifetime.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`Machines`）。
   * Purpose: Checks admission, input or resource ownership in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.sandboxes.requireLifetime` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sandboxes.requireLifetime`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vm: VMRecord
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private requireSandboxLifetime(vm: VMRecord) { this.sandboxes.requireLifetime(vm); }
  /**
   * 入口 / Entry: Machines.requireMutableConfig.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`Machines`）。
   * Purpose: Checks admission, input or resource ownership in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.sandboxes.requireMutable` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sandboxes.requireMutable`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vm: VMRecord
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private requireMutableConfig(vm: VMRecord) { this.sandboxes.requireMutable(vm); }
  private saveQueue = Promise.resolve();
  /**
   * 入口 / Entry: Machines.save.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，校验并提交领域状态变更；处理结果记录到 `this.saveQueue`（`Machines`）。
   * Purpose: Validates and commits a domain state change in `Machines`; the outcome is recorded in `this.saveQueue`. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.records.values`, `this.saveQueue.catch().then`, `this.saveQueue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.records.values`, `this.saveQueue.catch().then`, `this.saveQueue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.saveQueue.catch().then`; `this.saveQueue.catch`; 更新 / updates `this.saveQueue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save() {
    // Capture nested record values when the save is admitted, before waiting
    // for an earlier publication. Later mutations belong to a later snapshot.
    const snapshot = JSON.parse(JSON.stringify([...this.records.values()])) as VMRecord[];
    const operation = this.saveQueue
      .catch(() => {})
      .then(async () => {
        const file = join(DATA, 'machines.json');
        await writeStore(file, snapshot);
      });
    this.saveQueue = operation;
    await operation;
  }
  /**
   * 入口 / Entry: Machines.isBusy.
   * 功能：从当前输入或状态计算 `this.locks.has(id)`，供调用方后续验证或使用。
   * Purpose: Computes `this.locks.has(id)` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.locks.has(id)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  isBusy(id: string) {
    return this.locks.has(id);
  }
  /**
   * 入口 / Entry: Machines.locked.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await (live ? vmLifetime(id, live).exclusive(action, allowFailedExecutions) : action())` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `await (live ? vmLifetime(id, live).exclusive(action, allowFailedExecutions) : action())` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `id.split`, `this.requireUnlocked`, `this.locks.has`, `this.locks.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `id.split`, `this.requireUnlocked`, `this.locks.has`, `this.locks.add`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!allowIncident`.
   * 输入 / Inputs: id: string; action: () => Promise<T>; allowIncident: default=false; allowFailedExecutions: default=false
   * 输出 / Returns: Promise<T>；结果来自 / values from `await (live ? vmLifetime(id, live).exclusive(action, allowFailedExecutions) : action())`.
   * 副作用 / Effects: `this.locks.add`; `this.operations.add`; `this.locks.delete`; `this.operations.delete`.
   * 拒绝 / Refusals: 条件 / conditions `this.closing`; `this.maintenance`; `this.locks.has(id)`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中，请等待完成并重启服务', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.locks.delete(id);`; `this.operations.delete(operation);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.locks.delete(id);`; `this.operations.delete(operation);`; these steps also apply to exceptional exits.
   */
  async locked<T>(id: string, action: () => Promise<T>, allowIncident = false, allowFailedExecutions = false): Promise<T> {
    if (this.closing) throw new AppError('服务正在关闭', 503);
    if (!allowIncident) for (const part of id.split(':')) this.requireUnlocked(part);
    if (this.maintenance) throw new AppError('数据目录迁移维护中，请等待完成并重启服务', 409);
    if (this.locks.has(id)) throw new AppError('该实例的另一项操作正在进行', 409);
    this.locks.add(id);
    let complete!:
    /**
     * 中文功能：完成 Machines.locked.complete 所属异步等待或资源阶段；结果按本声明参数交付。
     * English: Completes the asynchronous wait/resource phase owned by Machines.locked.complete using the declared result parameters.
     * 所属 / Owner: Machines.locked.complete.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void;
    const operation = new Promise<void>((resolve) => {
      complete = resolve;
    });
    this.operations.add(operation);
    try {
      const live = this.live.get(id);
      return await (live ? vmLifetime(id, live).exclusive(action, allowFailedExecutions) : action());
    } finally {
      this.locks.delete(id);
      this.operations.delete(operation);
      complete();
    }
  }
  /** Lock order: close VM execution admission -> await native cleanup -> VM lock -> domain/I/O locks.
   * Never hold the VM lock while waiting for an execution that needs control cleanup in this guest. */
  /**
   * 入口 / Entry: Machines.transition.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.locked(id, action, allowIncident, force)` / `vmLifetime(id, live).barrier(() => this.locked(id, action, allowIncident, force), true, force)` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `this.locked(id, action, allowIncident, force)` / `vmLifetime(id, live).barrier(() => this.locked(id, action, allowIncident, force), true, force)` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.live.get`, `this.locked`, `ExecutionScope.current`, `vmLifetime().barrier` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.live.get`, `this.locked`, `ExecutionScope.current`, `vmLifetime().barrier`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!live`.
   * 输入 / Inputs: id: string; action: () => Promise<T>; allowIncident: default=false; force: default=false
   * 输出 / Returns: `this.locked(id, action, allowIncident, force)`; `vmLifetime(id, live).barrier(() => this.locked(id, action, allowIncident, force), true, force)`.
   * 副作用 / Effects: `ExecutionScope.current`.
   * 拒绝 / Refusals: 条件 / conditions `ExecutionScope.current()?.identity.vmId === id`; 异常 / errors `new AppError('项目执行不能等待自身退出后切换实例状态', 409, 'VM_EXECUTION_REENTRANT')`.
   */
  private transition<T>(id: string, action: () => Promise<T>, allowIncident = false, force = false) {
    const live = this.live.get(id);
    if (!live) return this.locked(id, action, allowIncident, force);
    if (ExecutionScope.current()?.identity.vmId === id)
      throw new AppError('项目执行不能等待自身退出后切换实例状态', 409, 'VM_EXECUTION_REENTRANT');
    return vmLifetime(id, live).barrier(() => this.locked(id, action, allowIncident, force), true, force);
  }
  /**
   * 入口 / Entry: Machines.get.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `vm` 供上层消费（`Machines`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Machines`; this entry produces `vm` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.records.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.records.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `vm`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!vm`; 异常 / errors `new AppError('发行版不存在', 404)`.
   */
  get(id: string) {
    const vm = this.records.get(id);
    if (!vm) throw new AppError('发行版不存在', 404);
    return vm;
  }
  /**
   * 入口 / Entry: Machines.state.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.live.get(id)?.status || (this.get(id).lastError ? 'error' : 'stopped')` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `this.live.get(id)?.status || (this.get(id).lastError ? 'error' : 'stopped')` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.live.get`, `this.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.live.get`, `this.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: VMStatus；结果来自 / values from `this.live.get(id)?.status || (this.get(id).lastError ? 'error' : 'stopped')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  state(id: string): VMStatus {
    return this.live.get(id)?.status || (this.get(id).lastError ? 'error' : 'stopped');
  }
  /**
   * 入口 / Entry: Machines.view.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ ...vm, lastError: this.live.get(id)?.error || vm.lastError, status: this.state(id), poweredOn: this.live.has(id), startedAt…` 供上层消费（`Machines`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Machines`; this entry produces `{ ...vm, lastError: this.live.get(id)?.error || vm.lastError, status: this.state(id), poweredOn: this.live.has(id), startedAt…` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.get`, `stat().catch`, `stat`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.get`, `stat().catch`, `stat`, `join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<VMView>；结果来自 / values from `{ ...vm, lastError: this.live.get(id)?.error || vm.lastError, status: this.state(id), poweredOn: this.live.has(id), startedAt…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string): Promise<VMView> {
    const vm = this.get(id);
    const disk = await stat(join(vmDir(id), 'disk.qcow2')).catch(() => null);
    return {
      ...vm,
      lastError: this.live.get(id)?.error || vm.lastError,
      status: this.state(id),
      poweredOn: this.live.has(id),
      startedAt: this.live.get(id)?.startedAt,
      activeAccelerator: this.live.get(id)?.accelerator,
      memoryTargetMiB: this.live.get(id)?.memoryTargetMiB,
      diskBytes: disk?.size || 0,
    };
  }
  /**
   * 入口 / Entry: Machines.commandline.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ name: `sakura-${vm.name}`, machine: vm.architecture === 'aarch64' ? 'virt' : 'q35', architecture: vm.architecture || 'x86_6…` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `{ name: `sakura-${vm.name}`, machine: vm.architecture === 'aarch64' ? 'virt' : 'q35', architecture: vm.architecture || 'x86_6…` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.get`, `hardwareArguments`, `deviceArguments`, `audioArguments` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.get`, `hardwareArguments`, `deviceArguments`, `audioArguments`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ name: `sakura-${vm.name}`, machine: vm.architecture === 'aarch64' ? 'virt' : 'q35', architecture: vm.architecture || 'x86_6…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  commandline(id: string) {
    const vm = this.get(id);
    return {
      name: `sakura-${vm.name}`,
      machine: vm.architecture === 'aarch64' ? 'virt' : 'q35',
      architecture: vm.architecture || 'x86_64',
      memoryMiB: vm.memoryMiB,
      cpus: vm.cpus,
      hardware: vm.hardware,
      resourceArguments: hardwareArguments(vm),
      deviceArguments: deviceArguments(vm),
      audioArguments: audioArguments(vm),
      display: vm.hardware?.devices?.graphics === 'virgl' ? 'egl-headless' : 'none',
      diskOptions: diskOptions(vm) + (vm.sandbox?.storage === 'discard-on-stop' ? ',snapshot=on' : ''),
      diskEncryption: vm.diskEncryption ? { format: 'luks', secretName: vm.diskEncryption.secretName } : undefined,
      diskPersistence: vm.sandbox?.storage || 'persistent',
      accelerator: vm.accelerator,
      disk: join(vmDir(id), 'disk.qcow2'),
      forwards: vm.forwards,
    };
  }
  /**
   * 入口 / Entry: Machines.list.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `Promise.all([...this.records.keys()].map((id) => this.view(id)))` 供上层消费（`Machines`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Machines`; this entry produces `Promise.all([...this.records.keys()].map((id) => this.view(id)))` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `Promise.all`, `inline.map`, `this.records.keys` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.all`, `inline.map`, `this.records.keys`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `Promise.all([...this.records.keys()].map((id) => this.view(id)))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async list() {
    return Promise.all([...this.records.keys()].map((id) => this.view(id)));
  }
  /**
   * 入口 / Entry: Machines.log.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `live.serialTail`, `live.serialReady`, `live.error`（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; the outcome is recorded in `live.serialTail`, `live.serialReady`, `live.error`. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `data.toString`, `this.logs.get`, `this.logs.set`, `inline.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `data.toString`, `this.logs.get`, `this.logs.set`, `inline.slice`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `live?.status === 'starting' && live.bootstrapKnown === false && !live.serialReady`; `live.serialTail.includes('SAKURA_READY')`; `live?.status === 'starting' && recent.includes('Kernel panic - not syncing:')`.
   * 输入 / Inputs: id: string; data: Buffer | string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.logs.set`; `this.emit`; `live.bootAbort.abort`; 更新 / updates `live.serialTail`, `live.serialReady`, `live.error`, `live.status`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  log(id: string, data: Buffer | string) {
    const text = data.toString();
    const previous = this.logs.get(id) || '';
    this.logs.set(id, (previous + text).slice(-128 * 1024));
    this.emit(`log:${id}`, text);
    const live = this.live.get(id);
    if (live?.status === 'starting' && live.bootstrapKnown === false && !live.serialReady) {
      live.serialTail = ((live.serialTail || '') + text).slice(-128);
      if (live.serialTail.includes('SAKURA_READY')) live.serialReady = true;
    }
    const recent = previous.slice(-128) + text;
    if (live?.status === 'starting' && recent.includes('Kernel panic - not syncing:')) {
      live.error = 'Linux 内核启动失败（Kernel panic）；请查看启动日志，然后停止并重试。';
      live.status = 'error';
      live.bootAbort.abort();
      this.emit('change');
    }
  }
  /**
   * 入口 / Entry: Machines.create.
   * 功能：把本层请求转交 `this.createInternal`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.createInternal` and propagates the provider result or rejection.
   * 输入 / Inputs: input: unknown; sandbox: SandboxPolicy optional
   * 输出 / Returns: `this.createInternal(input, sandbox)`.
   * 副作用 / Effects: `this.createInternal`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async create(input: unknown, sandbox?: SandboxPolicy) {
    return this.createInternal(input, sandbox);
  }
  /**
   * 入口 / Entry: Machines.createIncomingTarget.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `existing` / `this.createInternal(config, undefined, undefined, { ...identity, origin: { ...sourceIds, status: 'prepared', createdAt: now, …` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `existing` / `this.createInternal(config, undefined, undefined, { ...identity, origin: { ...sourceIds, status: 'prepared', createdAt: now, …` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `identity.seed.toString`, `createPrivateKey`, `z.object().strict().parse`, `z.object().strict` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `identity.seed.toString`, `createPrivateKey`, `z.object().strict().parse`, `z.object().strict`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown; identity: { key: string; seed: Buffer }; source: { sourceHostId: string; sourceVmId: string; transferId: string; completionProtocol?: …; projects: LiveMigrationProjects optional; organization: VMRecord['organization'] optional
   * 输出 / Returns: `existing`; `this.createInternal(config, undefined, undefined, { ...identity, origin: { ...sourceIds, status: 'prepared', createdAt: now, …`.
   * 副作用 / Effects: `createPrivateKey`; `createSchema.parse`; `this.createInternal`.
   * 拒绝 / Refusals: 条件 / conditions `typeof identity.key !== 'string' || identity.key.length < 100 || identity.key.length > 16_000 || !Buffer.isBuffer(identity.se…`; `config.firmware === 'uefi' || config.architecture === 'aarch64' || config.hardware?.devices?.graphics === 'virgl'`; `existing`; 异常 / errors `new AppError('在线迁移客户机身份数据无效')`; `new AppError('在线迁移控制密钥无效')`.
   * 失败处理：catch 分支执行 `throw new AppError('在线迁移控制密钥无效');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('在线迁移控制密钥无效');`; these statements determine whether a failure is absorbed or rejected again.
   */
  async createIncomingTarget(input: unknown, identity: { key: string; seed: Buffer },
    source: { sourceHostId: string; sourceVmId: string; transferId: string; completionProtocol?: 1 },
    projects?: LiveMigrationProjects, organization?: VMRecord['organization']) {
    if (typeof identity.key !== 'string' || identity.key.length < 100 ||
        identity.key.length > 16_000 || !Buffer.isBuffer(identity.seed) ||
        identity.seed.length < 40 * 1024 || identity.seed.length > 1024 * 1024 ||
        identity.seed.toString('ascii', 32769, 32774) !== 'CD001')
      throw new AppError('在线迁移客户机身份数据无效');
    try { createPrivateKey(identity.key); }
    catch { throw new AppError('在线迁移控制密钥无效'); }
    const sourceIds = z.object({ sourceHostId: z.uuid(), sourceVmId: z.uuid(),
      transferId: z.uuid(), completionProtocol: z.literal(1).optional() }).strict().parse(source);
    const config = createSchema.parse(input);
    if (config.firmware === 'uefi' || config.architecture === 'aarch64' ||
        config.hardware?.devices?.graphics === 'virgl')
      throw new AppError('此硬件配置尚不能安全在线迁移', 409);
    const prepareDigest = migrationDigest({ config, source: sourceIds,
      key: identity.key, seed: identity.seed.toString('base64'), projects: projects || null,
      organization: organization || null });
    const existing = [...this.records.values()].find((vm) =>
      vm.liveMigrationOrigin?.sourceHostId === sourceIds.sourceHostId &&
      vm.liveMigrationOrigin.transferId === sourceIds.transferId);
    if (existing) {
      if (existing.liveMigrationOrigin?.prepareDigest !== prepareDigest)
        throw new AppError('此在线迁移任务已创建目标实例，但原准备请求身份不匹配', 409);
      return existing;
    }
    const now = new Date().toISOString();
    return this.createInternal(config, undefined, undefined, { ...identity,
      origin: { ...sourceIds, status: 'prepared', createdAt: now, updatedAt: now, prepareDigest,
        projectsDigest: migrationDigest(projects ? liveMigrationProjectsSchema.parse(projects) : null) },
      ...(projects ? { projects: liveMigrationProjectsSchema.parse(projects) } : {}),
      ...(organization ? { organization: organizationSchema.parse(organization) } : {}),
    });
  }
  /**
   * 入口 / Entry: Machines.prepareVmDirectory.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `dir` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `dir` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.storagePools.ensure`, `this.storagePools.bind`, `vmDir`, `within` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.storagePools.ensure`, `this.storagePools.bind`, `vmDir`, `within`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vm: VMRecord
   * 输出 / Returns: `dir`.
   * 副作用 / Effects: `mkdir`.
   * 拒绝 / Refusals: 条件 / conditions `!within(root, dir)`; 异常 / errors `new AppError('实例目录超出存储池', 409)`; `error`.
   * 失败处理：catch 分支执行 `this.storagePools.unbind(vm.id);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.storagePools.unbind(vm.id);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async prepareVmDirectory(vm: VMRecord) {
    const root = await this.storagePools.ensure(vm.storagePoolId);
    this.storagePools.bind(vm.id, vm.storagePoolId);
    const dir = vmDir(vm.id);
    if (!within(root, dir)) throw new AppError('实例目录超出存储池', 409);
    try { await mkdir(dir); }
    catch (error) {
      this.storagePools.unbind(vm.id);
      throw error;
    }
    return dir;
  }
  /**
   * 入口 / Entry: Machines.removeVmDirectory.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`Machines`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.storagePools.ensure`, `this.storagePools.directory`, `within`, `regularDirectory` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.storagePools.ensure`, `this.storagePools.directory`, `within`, `regularDirectory`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vm: VMRecord
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `rm`.
   * 拒绝 / Refusals: 条件 / conditions `!within(root, dir) || dir === root`; 异常 / errors `new AppError('实例目录超出存储池', 409)`.
   */
  private async removeVmDirectory(vm: VMRecord) {
    const root = await this.storagePools.ensure(vm.storagePoolId);
    const dir = this.storagePools.directory(vm.id, vm.storagePoolId);
    if (!within(root, dir) || dir === root)
      throw new AppError('实例目录超出存储池', 409);
    await regularDirectory(dir);
    await rm(dir, { recursive: true, force: true });
  }
  /**
   * 入口 / Entry: Machines.createInternal.
   * 功能：在受控存储池中创建实例目录、身份、种子与磁盘，并持久登记新实例。
   * Purpose: Creates VM directories/identity/seed/disk within a controlled pool and durably registers the VM.
   * 设计：端口、架构、固件和沙箱期限先验证；固定镜像偏移补丁先核验原字节，失败移除未完成目标但不动来源镜像。
   * Design: Ports/architecture/firmware/expiry are checked first; fixed-offset patches verify bytes and rollback removes only incomplete targets.
   * 输入 / Inputs: input: unknown; sandbox: SandboxPolicy optional; rescueOf: string optional; incoming: { key: string; seed: Buffer; origin: NonNullable<VMRecord['liveMigrationOrigin']>; pr… optional
   * 输出 / Returns: `this.locked('storage-pools', () => this.locked('create', async () => { const config = createSchema.parse(input); this.require…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async createInternal(input: unknown, sandbox?: SandboxPolicy, rescueOf?: string,
    incoming?: { key: string; seed: Buffer; origin: NonNullable<VMRecord['liveMigrationOrigin']>;
      projects?: LiveMigrationProjects; organization?: VMRecord['organization'] }) {
    /**
     * 入口 / Entry: Machines.createInternal.callback@486.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked / create）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked / create).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(vm.id)`.
     * 副作用 / Effects: `createSchema.parse`; `createSshKey`; `writeFile`; `qemuIoArgs.push`; `this.records.set`; 更新 / updates `sandbox`, `stockImage`.
     * 拒绝 / Refusals: 条件 / conditions `config.architecture === 'aarch64' && !this.engine.aarch64Available`; `sandbox !== undefined`; `sandboxExpired(sandbox)`; 异常 / errors `new AppError('缺少 ARM64 QEMU，请运行 npm run setup', 503)`; `new AppError('沙箱期限必须晚于当前时间')`.
     * 失败处理：catch 分支执行 `this.records.delete(vm.id);`; `await this.removeVmDirectory(vm);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `this.records.delete(vm.id);`; `await this.removeVmDirectory(vm);`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.locked('storage-pools', () => this.locked('create',
    /**
     * 中文功能：在创建锁内校验配置与存储资源，准备实例目录、密钥、seed 和磁盘，持久登记新实例并回收失败产物。
     * English: Validates configuration/storage under the creation lock, prepares VM directory/keys/seed/disk, persists the new VM and reclaims failed artifacts.
     * 所属 / Owner: Machines.createInternal.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     */
    async () => {
      const config = createSchema.parse(input);
      this.requireUnreservedPorts(config.forwards);
      if (config.architecture === 'aarch64' && !this.engine.aarch64Available)
        throw new AppError('缺少 ARM64 QEMU，请运行 npm run setup', 503);
      if (config.firmware === 'uefi') await requireUefiSupport(config.architecture);
      if (sandbox !== undefined) {
        sandbox = sandboxPolicySchema.parse(sandbox);
        if (sandboxExpired(sandbox)) throw new AppError('沙箱期限必须晚于当前时间');
        if (config.forwards.length || (config.template && config.template !== 'none'))
          throw new AppError('沙箱不允许额外端口转发或自动安装模板');
      }
      if ([...this.records.values()].some((v) => v.name === config.name))
        throw new AppError('该名称已存在', 409);
      if (incoming && [...this.records.values()].some((vm) =>
        vm.liveMigrationOrigin?.sourceHostId === incoming.origin.sourceHostId &&
        vm.liveMigrationOrigin.transferId === incoming.origin.transferId))
        throw new AppError('此在线迁移任务已创建目标实例', 409);
      const image = distroInfo(config.distro, config.architecture);
      if (!existsSync(image.file)) throw new AppError('镜像尚未准备好，请先下载对应发行版镜像', 503);
      if (config.memoryMiB < image.minimumMemory || config.diskGiB < image.minimumDisk)
        throw new AppError(
          `${image.name} 至少需要 ${image.minimumMemory} MiB 内存、${image.minimumDisk} GiB 磁盘`,
        );
      if (this.records.size >= 32) throw new AppError('最多保留 32 个发行版');
      const vm: VMRecord = {
        ...config,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        snapshots: [],
        bootstrapped: !!incoming,
        ...(incoming ? { liveMigrationOrigin: incoming.origin } : {}),
        ...(incoming?.organization ? { organization: incoming.organization } : {}),
        ...(sandbox ? { sandbox } : {}),
        ...(rescueOf ? { rescueOf } : {}),
      };
      const dir = await this.prepareVmDirectory(vm);
      try {
        const key = incoming ? null : createSshKey();
        await writeFile(join(dir, 'id_rsa'), incoming?.key || key!.privateText, { mode: 0o600 });
        await writeFile(
          join(dir, 'seed.iso'),
          incoming?.seed || seedIso({
            'meta-data': metaData(vm.id, vm.name, key!.publicText),
            'user-data':
              vm.distro && vm.distro !== 'alpine'
                ? cloudUserData(vm.name, key!.publicText,
                  vm.architecture === 'aarch64' ? '/dev/ttyAMA0' : '/dev/ttyS0')
                : userData(vm.name, key!.publicText),
            ...(vm.distro && vm.distro !== 'alpine' ? { 'network-config': cloudNetwork } : {}),
          }),
        );
        if (incoming?.projects) {
          await writeFile(join(dir, 'projects.json'),
            JSON.stringify({ active: incoming.projects.active,
              projects: incoming.projects.projects }, null, 2));
          for (const [projectId, project] of Object.entries(incoming.projects.configs))
            await writeFile(join(dir, projectId === 'default'
              ? 'project.json' : `project-${projectId}.json`),
            JSON.stringify(project, null, 2));
        }
        await this.engine.run('sakura-img', [
          'create',
          '-f',
          'qcow2',
          '-F',
          'qcow2',
          '-b',
          image.file,
          join(dir, 'disk.qcow2'),
          `${vm.diskGiB}G`,
        ]);
        // The stock Alpine image keeps a ten-second boot menu and makes
        // chronyd wait for its first fork. Patch those fixed, vendor-owned
        // defaults in the new overlay before the first boot. The guest still
        // runs Tiny Cloud normally, so this only removes idle host-side time;
        // custom images and engines without qemu-io retain the old path.
        if (
          this.engine.qemuIoAvailable &&
          (!vm.distro || vm.distro === 'alpine') &&
          image.file === IMAGE &&
          process.env.SAKURA_SKIP_ALPINE_BOOT_PATCH !== '1'
        ) {
          const patches = [
            [102481713, Buffer.from('timeout=10'), Buffer.from('timeout=01')],
            [102484169, Buffer.from('TIMEOUT 100'), Buffer.from('TIMEOUT 010')],
            [12077294, Buffer.from('FAST_STARTUP=no\n'), Buffer.from('FAST_STARTUP=yes\n')],
          ] as const;
          const verifyArgs = ['-f', 'qcow2'];
          for (const [offset, expected] of patches)
            expected.forEach((byte, index) => verifyArgs.push('-c', `read -P ${byte} ${offset + index} 1`));
          let stockImage = true;
          try {
            await this.engine.run('sakura-io', [...verifyArgs, image.file]);
          } catch {
            stockImage = false;
          }
          // A user may have replaced the pinned image or already applied a
          // local customization. Never write fixed offsets into that disk.
          if (stockImage) {
            const qemuIoArgs = ['-f', 'qcow2'];
            for (const [offset, _expected, contents] of patches)
              contents.forEach((byte, index) =>
                qemuIoArgs.push('-c', `write -P ${byte} ${offset + index} 1`),
              );
            qemuIoArgs.push(join(dir, 'disk.qcow2'));
            await this.engine.run('sakura-io', qemuIoArgs);
          }
        }
        this.requireUnreservedPorts(vm.forwards);
        this.records.set(vm.id, vm);
        await this.save();
        if (vm.sandbox) this.watchSandboxes();
        return this.view(vm.id);
      } catch (e) {
        this.records.delete(vm.id);
        await this.removeVmDirectory(vm);
        this.storagePools.unbind(vm.id);
        throw e;
      }
    }));
  }
  /**
   * 入口 / Entry: Machines.start.
   * 功能：把本层请求转交 `this.startInternal`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.startInternal` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.startInternal(id)`.
   * 副作用 / Effects: `this.startInternal`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async start(id: string) {
    return this.startInternal(id);
  }
  /**
   * 入口 / Entry: Machines.startHaReplica.
   * 功能：把本层请求转交 `this.startInternal`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.startInternal` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; identity: { sourceHostId: string; transferId: string; sourceVmId: string; snapshotId: string; s…
   * 输出 / Returns: `this.startInternal(id, undefined, false, identity)`.
   * 副作用 / Effects: `this.startInternal`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async startHaReplica(id: string, identity: { sourceHostId: string;
    transferId: string; sourceVmId: string; snapshotId: string; sha256: string }) {
    return this.startInternal(id, undefined, false, identity);
  }
  private readonly haAuthority = new VmHaAuthority({
    /**
     * 入口 / Entry: Machines.get.
     * 功能：把本层请求转交 `this.get`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.get` and propagates the provider result or rejection.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.get(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    get: id => this.get(id),
    /**
     * 入口 / Entry: Machines.requireStopped.
     * 功能：把本层请求转交 `this.requireStopped`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.requireStopped` and propagates the provider result or rejection.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.requireStopped(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    requireStopped: id => this.requireStopped(id),
    /**
     * 入口 / Entry: Machines.locked.
     * 功能：把本层请求转交 `this.locked`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.locked` and propagates the provider result or rejection.
     * 输入 / Inputs: id; work
     * 输出 / Returns: `this.locked(id, work)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    locked: (id, work) => this.locked(id, work),
    /**
     * 入口 / Entry: Machines.save.
     * 功能：把本层请求转交 `this.save`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.save` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.save()`.
     * 副作用 / Effects: `this.save`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    save: () => this.save(),
    /**
     * 入口 / Entry: Machines.changed.
     * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Machines`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
     * 处理：通过 `this.emit` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.emit`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.emit`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    changed: () => { this.emit('change'); },
  });
  /**
   * 入口 / Entry: Machines.enrollHaWitness.
   * 功能：把本层请求转交 `this.haAuthority.enrollHaWitness`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.haAuthority.enrollHaWitness` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; targetHostId: string; failureThreshold: number
   * 输出 / Returns: `this.haAuthority.enrollHaWitness(id, targetHostId, failureThreshold)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async enrollHaWitness(id: string, targetHostId: string, failureThreshold: number) {
    return this.haAuthority.enrollHaWitness(id, targetHostId, failureThreshold);
  }
  /**
   * 入口 / Entry: Machines.releaseHaWitness.
   * 功能：把本层请求转交 `this.haAuthority.releaseHaWitness`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.haAuthority.releaseHaWitness` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; targetHostId: string
   * 输出 / Returns: `this.haAuthority.releaseHaWitness(id, targetHostId)`.
   * 副作用 / Effects: `this.haAuthority.releaseHaWitness`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async releaseHaWitness(id: string, targetHostId: string) { return this.haAuthority.releaseHaWitness(id, targetHostId); }
  /**
   * 入口 / Entry: Machines.startIncoming.
   * 功能：把本层请求转交 `this.startInternal`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.startInternal` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.startInternal(id, undefined, true)`.
   * 副作用 / Effects: `this.startInternal`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async startIncoming(id: string) {
    return this.startInternal(id, undefined, true);
  }
  /**
   * 入口 / Entry: Machines.bindIncomingSession.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.locked(id, async () => { await check(); const vm = this.get(id), previous = vm.liveMigrationOrigin; if (!previous || pre…` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `this.locked(id, async () => { await check(); const vm = this.get(id), previous = vm.liveMigrationOrigin; if (!previous || pre…` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `liveMigrationPrepareReceiptSchema.parse`, `captureOperationCheck`, `this.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `liveMigrationPrepareReceiptSchema.parse`, `captureOperationCheck`, `this.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: `this.locked(id, async () => { await check(); const vm = this.get(id), previous = vm.liveMigrationOrigin; if (!previous || pre…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async bindIncomingSession(id: string, raw: unknown) {
    const receipt = liveMigrationPrepareReceiptSchema.parse(raw);
    const check = captureOperationCheck();
    /**
     * 入口 / Entry: Machines.bindIncomingSession.callback@630.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `receipt`.
     * 副作用 / Effects: `this.save`; 更新 / updates `vm.liveMigrationOrigin`.
     * 拒绝 / Refusals: 条件 / conditions `!previous || previous.status !== 'prepared' || receipt.targetVmId !== id`; 异常 / errors `new AppError('目标实例没有原迁移准备记录', 409)`; `error`.
     * 失败处理：catch 分支执行 `vm.liveMigrationOrigin = previous;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `vm.liveMigrationOrigin = previous;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.locked(id, async () => {
      await check();
      const vm = this.get(id), previous = vm.liveMigrationOrigin;
      if (!previous || previous.status !== 'prepared' || receipt.targetVmId !== id)
        throw new AppError('目标实例没有原迁移准备记录', 409);
      vm.liveMigrationOrigin = liveMigrationOriginSchema.parse({ ...previous,
        sessionId: receipt.sessionId, prepareReceipt: receipt, updatedAt: new Date().toISOString() });
      try { await this.save(); }
      catch (error) { vm.liveMigrationOrigin = previous; throw error; }
      return receipt;
    });
  }
  /** The authenticated original coordinator has durably stopped its source before requesting this recovery. */
  /**
   * 入口 / Entry: Machines.recoverIncoming.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.start(id)` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `this.start(id)` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `captureOperationCheck`, `this.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `captureOperationCheck`, `this.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.live.has(id)`.
   * 输入 / Inputs: id: string; sessionId: string
   * 输出 / Returns: `this.start(id)`.
   * 副作用 / Effects: `this.stop`; `this.start`.
   * 拒绝 / Refusals: 条件 / conditions `!original?.sessionId || original.sessionId !== sessionId || original.prepareReceipt?.sessionId !== sessionId`; 异常 / errors `new AppError('目标缺少原持久迁移会话', 409)`.
   */
  async recoverIncoming(id: string, sessionId: string) {
    z.uuid().parse(sessionId);
    const check = captureOperationCheck();
    const original = this.get(id).liveMigrationOrigin;
    if (!original?.sessionId || original.sessionId !== sessionId ||
        original.prepareReceipt?.sessionId !== sessionId)
      throw new AppError('目标缺少原持久迁移会话', 409);
    if (this.live.has(id)) await this.stop(id, true);
    /**
     * 入口 / Entry: Machines.recoverIncoming.callback@651.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.save`; 更新 / updates `vm.liveMigrationOrigin`.
     * 拒绝 / Refusals: 条件 / conditions `!previous?.sessionId || previous.sessionId !== sessionId || previous.prepareReceipt?.sessionId !== sessionId`; `this.live.has(id)`; `previous.status === 'prepared'`; 异常 / errors `new AppError('目标缺少原持久迁移会话', 409)`; `new AppError('目标原迁移进程仍存在，不能冷启动恢复', 409)`.
     * 失败处理：catch 分支执行 `vm.liveMigrationOrigin = previous;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `vm.liveMigrationOrigin = previous;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    await this.locked(id, async () => {
      await check();
      const vm = this.get(id), previous = vm.liveMigrationOrigin;
      if (!previous?.sessionId || previous.sessionId !== sessionId ||
          previous.prepareReceipt?.sessionId !== sessionId)
        throw new AppError('目标缺少原持久迁移会话', 409);
      if (this.live.has(id)) throw new AppError('目标原迁移进程仍存在，不能冷启动恢复', 409);
      if (previous.status === 'prepared') {
        vm.liveMigrationOrigin = liveMigrationOriginSchema.parse({ ...previous,
          status: 'received', updatedAt: new Date().toISOString() });
        try { await this.save(); }
        catch (error) { vm.liveMigrationOrigin = previous; throw error; }
      }
    });
    await check();
    return this.start(id);
  }
  /**
   * 入口 / Entry: Machines.completeIncoming.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.locked(id, async () => { await check(); const live = this.live.get(id); if (!live?.incoming || live.status !== 'paused')…` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `this.locked(id, async () => { await check(); const live = this.live.get(id); if (!live?.incoming || live.status !== 'paused')…` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `pluginAuthority`, `z.uuid().parse`, `z.uuid`, `captureOperationCheck` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `pluginAuthority`, `z.uuid().parse`, `z.uuid`, `captureOperationCheck`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `sessionId !== undefined`.
   * 输入 / Inputs: id: string; query: typeof qmp default=qmp; sessionId: string optional
   * 输出 / Returns: `this.locked(id, async () => { await check(); const live = this.live.get(id); if (!live?.incoming || live.status !== 'paused')…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `pluginAuthority() && query !== qmp`; 异常 / errors `new AppError('迁移目标核验查询仅允许系统装配', 403, 'LIVE_MIGRATION_SYSTEM_ONLY')`.
   */
  async completeIncoming(id: string, query: typeof qmp = qmp, sessionId?: string) {
    if (pluginAuthority() && query !== qmp)
      throw new AppError('迁移目标核验查询仅允许系统装配', 403, 'LIVE_MIGRATION_SYSTEM_ONLY');
    if (sessionId !== undefined) z.uuid().parse(sessionId);
    const check = captureOperationCheck();
    /**
     * 入口 / Entry: Machines.completeIncoming.callback@673.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(id)`.
     * 副作用 / Effects: `this.save`; `this.emit`; 更新 / updates `vm.liveMigrationOrigin`, `live.incoming`, `live.status`, `live.bootDone`.
     * 拒绝 / Refusals: 条件 / conditions `!live?.incoming || live.status !== 'paused'`; `!previous || previous.status !== 'prepared'`; `state.running !== true || state.status !== 'running'`; 异常 / errors `new AppError('目标实例不在迁移接收状态', 409)`; `new AppError('目标实例没有待完成的在线迁移记录', 409)`.
     * 失败处理：catch 分支执行 `vm.liveMigrationOrigin = previous;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `vm.liveMigrationOrigin = previous;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.locked(id, async () => {
      await check();
      const live = this.live.get(id);
      if (!live?.incoming || live.status !== 'paused')
        throw new AppError('目标实例不在迁移接收状态', 409);
      const vm = this.get(id), previous = vm.liveMigrationOrigin;
      if (!previous || previous.status !== 'prepared')
        throw new AppError('目标实例没有待完成的在线迁移记录', 409);
      const state = await query(live.qmpPort, 'query-status') as
        { status?: string; running?: boolean };
      if (state.running !== true || state.status !== 'running')
        throw new AppError('目标 QEMU 尚未完成迁移并运行', 409);
      await check();
      vm.liveMigrationOrigin = liveMigrationOriginSchema.parse({ ...previous,
        ...(sessionId ? { sessionId } : {}),
        status: 'received', updatedAt: new Date().toISOString() });
      try { await this.save(); }
      catch (error) { vm.liveMigrationOrigin = previous; throw error; }
      live.incoming = false;
      live.status = 'starting';
      live.bootDone = this.watchBoot(id, live).catch((error) => {
        if (!live.bootAbort.signal.aborted) this.log(id, String(error));
      });
      this.emit('change');
      return this.view(id);
    });
  }
  /**
   * 入口 / Entry: Machines.fenceForLiveMigration.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.locked(id, async () => { await check(); const vm = this.get(id); if (vm.liveMigrationFence) { if (vm.liveMigrationFence.…` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `this.locked(id, async () => { await check(); const vm = this.get(id); if (vm.liveMigrationFence) { if (vm.liveMigrationFence.…` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `pluginAuthority`, `liveMigrationFenceIdentitySchema.omit().parse`, `liveMigrationFenceIdentitySchema.omit`, `captureRecoveryOrigin` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `pluginAuthority`, `liveMigrationFenceIdentitySchema.omit().parse`, `liveMigrationFenceIdentitySchema.omit`, `captureRecoveryOrigin`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; raw: unknown; query: typeof qmp default=qmp
   * 输出 / Returns: `this.locked(id, async () => { await check(); const vm = this.get(id); if (vm.liveMigrationFence) { if (vm.liveMigrationFence.…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `pluginAuthority() && query !== qmp`; 异常 / errors `new AppError('迁移栅栏核验查询仅允许系统装配', 403, 'LIVE_MIGRATION_SYSTEM_ONLY')`.
   */
  async fenceForLiveMigration(id: string, raw: unknown,
    query: typeof qmp = qmp) {
    if (pluginAuthority() && query !== qmp)
      throw new AppError('迁移栅栏核验查询仅允许系统装配', 403, 'LIVE_MIGRATION_SYSTEM_ONLY');
    const identity = liveMigrationFenceIdentitySchema.omit({ fencedAt: true, sourceProcessId: true, origin: true }).parse(raw);
    const origin = captureRecoveryOrigin();
    const check = captureOperationCheck();
    /**
     * 入口 / Entry: Machines.fenceForLiveMigration.callback@707.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `vm.liveMigrationFence`; `fence`.
     * 副作用 / Effects: `this.save`; `this.migrationRuns.set`; `this.emit`; 更新 / updates `vm.liveMigrationFence`.
     * 拒绝 / Refusals: 条件 / conditions `vm.liveMigrationFence`; `vm.liveMigrationFence.transferId !== identity.transferId || vm.liveMigrationFence.targetHostId !== identity.targetHostId || v…`; `vm.haPromotion || vm.haRetirement`; 异常 / errors `new AppError('来源实例已有其他在线迁移栅栏', 409)`; `new AppError('故障接管实例不能同时进行在线迁移', 409)`.
     * 失败处理：catch 分支执行 `delete vm.liveMigrationFence;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `delete vm.liveMigrationFence;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.locked(id, async () => {
      await check();
      const vm = this.get(id);
      if (vm.liveMigrationFence) {
        if (vm.liveMigrationFence.transferId !== identity.transferId ||
            vm.liveMigrationFence.targetHostId !== identity.targetHostId ||
            vm.liveMigrationFence.targetVmId !== identity.targetVmId ||
            ['peerId', 'sourceHostId', 'sessionId', 'projectsDigest'].some(key =>
              vm.liveMigrationFence![key as keyof LiveMigrationFence] !== identity[key as keyof typeof identity]))
          throw new AppError('来源实例已有其他在线迁移栅栏', 409);
        return vm.liveMigrationFence;
      }
      if (vm.haPromotion || vm.haRetirement)
        throw new AppError('故障接管实例不能同时进行在线迁移', 409);
      const live = this.live.get(id);
      if (!live || live.status !== 'running')
        throw new AppError('来源实例没有运行', 409);
      const [state, migration] = await Promise.all([
        query(live.qmpPort, 'query-status'), query(live.qmpPort, 'query-migrate'),
      ]) as [{ running?: boolean }, { status?: string }];
      if (state.running !== false || migration.status !== 'pre-switchover')
        throw new AppError('来源 QEMU 尚未在迁移切换点暂停', 409);
      await check();
      if (this.live.get(id) !== live) throw new AppError('来源原进程已变化', 409);
      const fence = liveMigrationFenceSchema.parse({ ...identity,
        ...(identity.sessionId ? { sourceProcessId: vmLifetime(id, live).vmProcessId } : {}),
        ...(origin ? { origin } : {}),
        fencedAt: new Date().toISOString() });
      vm.liveMigrationFence = fence;
      try { await this.save(); }
      catch (error) { delete vm.liveMigrationFence; throw error; }
      if (fence.sourceProcessId) this.migrationRuns.set(id, {
        identity: migrationFenceIdentity(fence), processId: fence.sourceProcessId, live,
      });
      this.emit('change');
      return fence;
    });
  }
  /** Publish native exit evidence for this exact fenced process; a missing live entry is not evidence. */
  /**
   * 入口 / Entry: Machines.stopLiveMigrationSource.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，结束、撤销或清理本次拥有的领域资源；本入口产生 `original` / `this.locked(id, async () => { await check(); const current = this.get(id).liveMigrationFence; if (!current || migrationFenceI…` 供上层消费（`Machines`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Machines`; this entry produces `original` / `this.locked(id, async () => { await check(); const current = this.get(id).liveMigrationFence; if (!current || migrationFenceI…` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `liveMigrationFenceSchema.parse`, `migrationFenceIdentity`, `captureOperationCheck`, `check` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `liveMigrationFenceSchema.parse`, `migrationFenceIdentity`, `captureOperationCheck`, `check`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; expected: LiveMigrationFence
   * 输出 / Returns: `original`; `this.locked(id, async () => { await check(); const current = this.get(id).liveMigrationFence; if (!current || migrationFenceI…`.
   * 副作用 / Effects: `this.save`; `this.stop`; `this.migrationRuns.delete`; 更新 / updates `run.stoppedAt`.
   * 拒绝 / Refusals: 条件 / conditions `!vm.liveMigrationFence || migrationDigest(vm.liveMigrationFence) !== migrationDigest(original)`; `original.sourceStopped`; `this.live.has(id)`; 异常 / errors `new AppError('原在线迁移栅栏已变化', 409, 'LIVE_MIGRATION_FENCE_CHANGED')`; `new AppError('来源原进程尚未确认停止', 409)`.
   * 失败处理：catch 分支执行 `this.migrationRuns.delete(id);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.migrationRuns.delete(id);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async stopLiveMigrationSource(id: string, expected: LiveMigrationFence) {
    const original = liveMigrationFenceSchema.parse(expected), identity = migrationFenceIdentity(original);
    const check = captureOperationCheck();
    await check();
    const vm = this.get(id), run = this.migrationRuns.get(id);
    if (!vm.liveMigrationFence || migrationDigest(vm.liveMigrationFence) !== migrationDigest(original))
      throw new AppError('原在线迁移栅栏已变化', 409, 'LIVE_MIGRATION_FENCE_CHANGED');
    if (original.sourceStopped) {
      if (this.live.has(id)) throw new AppError('来源原进程尚未确认停止', 409);
      await this.save();
      return original;
    }
    if (!run || run.identity !== identity || run.processId !== original.sourceProcessId ||
      (this.live.has(id) && this.live.get(id) !== run.live))
      throw new AppError('原来源进程退出回执不可用，保持栅栏等待核验', 409, 'LIVE_MIGRATION_SOURCE_UNCONFIRMED');
    if (!run.stoppedAt) {
      if (!run.live) throw new AppError('来源原进程退出回执不可用', 409);
      const originalLive = run.live;
      try {
        await this.stop(id, true);
        await originalLive.done;
      } catch (error) { this.migrationRuns.delete(id); throw error; }
      if (this.live.has(id)) throw new AppError('来源原进程仍未退出', 409);
      run.stoppedAt = new Date().toISOString();
      delete run.live;
    }
    /**
     * 入口 / Entry: Machines.stopLiveMigrationSource.callback@772.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `structuredClone(current)`; `structuredClone(next)`.
     * 副作用 / Effects: `this.save`; `this.emit`; 更新 / updates `this.get(id).liveMigrationFence`.
     * 拒绝 / Refusals: 条件 / conditions `!current || migrationFenceIdentity(current) !== identity || this.live.has(id)`; 异常 / errors `new AppError('原在线迁移栅栏或来源进程已变化', 409, 'LIVE_MIGRATION_FENCE_CHANGED')`; `error`.
     * 失败处理：catch 分支执行 `this.get(id).liveMigrationFence = current;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `this.get(id).liveMigrationFence = current;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.locked(id, async () => {
      await check();
      const current = this.get(id).liveMigrationFence;
      if (!current || migrationFenceIdentity(current) !== identity || this.live.has(id))
        throw new AppError('原在线迁移栅栏或来源进程已变化', 409, 'LIVE_MIGRATION_FENCE_CHANGED');
      if (current.sourceStopped) {
        await this.save();
        return structuredClone(current);
      }
      const next = liveMigrationFenceSchema.parse({ ...current,
        sourceStopped: { sourceProcessId: run.processId, stoppedAt: run.stoppedAt } });
      this.get(id).liveMigrationFence = next;
      try { await this.save(); }
      catch (error) { this.get(id).liveMigrationFence = current; throw error; }
      this.emit('change');
      return structuredClone(next);
    });
  }
  /** The domain supplies an authenticated target query; this owner validates and atomically publishes its evidence. */
  /**
   * 入口 / Entry: Machines.canConfirmLiveMigrationCompletion.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `!!current.sourceStopped && !this.live.has(id) || !!run && run.identity === migrationFenceIdentity(expected) && run.processId …` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `false` / `!!current.sourceStopped && !this.live.has(id) || !!run && run.identity === migrationFenceIdentity(expected) && run.processId …` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.records.get`, `this.migrationRuns.get`, `migrationDigest`, `this.live.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.records.get`, `this.migrationRuns.get`, `migrationDigest`, `this.live.has`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!current || migrationDigest(current) !== migrationDigest(expected)`.
   * 输入 / Inputs: id: string; expected: LiveMigrationFence
   * 输出 / Returns: `false`; `!!current.sourceStopped && !this.live.has(id) || !!run && run.identity === migrationFenceIdentity(expected) && run.processId …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  canConfirmLiveMigrationCompletion(id: string, expected: LiveMigrationFence) {
    const current = this.records.get(id)?.liveMigrationFence, run = this.migrationRuns.get(id);
    if (!current || migrationDigest(current) !== migrationDigest(expected)) return false;
    return !!current.sourceStopped && !this.live.has(id) || !!run &&
      run.identity === migrationFenceIdentity(expected) && run.processId === expected.sourceProcessId &&
      (!!run.stoppedAt && !this.live.has(id) || !!run.live && this.live.get(id) === run.live);
  }
  /**
   * 入口 / Entry: Machines.isLiveMigrationCompletionDurable.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `!!current?.completion && !this.live.has(id) && migrationDigest(current) === migrationDigest(expected) && this.migrationComple…` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `!!current?.completion && !this.live.has(id) && migrationDigest(current) === migrationDigest(expected) && this.migrationComple…` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.records.get`, `this.live.has`, `migrationDigest`, `this.migrationCompletions.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.records.get`, `this.live.has`, `migrationDigest`, `this.migrationCompletions.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; expected: LiveMigrationFence
   * 输出 / Returns: `!!current?.completion && !this.live.has(id) && migrationDigest(current) === migrationDigest(expected) && this.migrationComple…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  isLiveMigrationCompletionDurable(id: string, expected: LiveMigrationFence) {
    const current = this.records.get(id)?.liveMigrationFence;
    return !!current?.completion && !this.live.has(id) &&
      migrationDigest(current) === migrationDigest(expected) &&
      this.migrationCompletions.get(id) === migrationDigest(expected);
  }
  /**
   * 入口 / Entry: Machines.confirmLiveMigrationCompletion.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.locked(id, async () => { await check(); const vm = this.get(id), current = vm.liveMigrationFence; if (!current || migrat…` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `this.locked(id, async () => { await check(); const vm = this.get(id), current = vm.liveMigrationFence; if (!current || migrat…` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `liveMigrationFenceSchema.parse`, `migrationDigest`, `captureOperationCheck`, `this.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `liveMigrationFenceSchema.parse`, `migrationDigest`, `captureOperationCheck`, `this.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; expected: LiveMigrationFence; inspect: () => Promise<LiveMigrationTargetStatus>
   * 输出 / Returns: `this.locked(id, async () => { await check(); const vm = this.get(id), current = vm.liveMigrationFence; if (!current || migrat…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async confirmLiveMigrationCompletion(id: string, expected: LiveMigrationFence,
    inspect: () => Promise<LiveMigrationTargetStatus>) {
    const original = liveMigrationFenceSchema.parse(expected), revision = migrationDigest(original);
    const check = captureOperationCheck();
    /**
     * 入口 / Entry: Machines.confirmLiveMigrationCompletion.callback@808.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `structuredClone(current)`; `structuredClone(next)`.
     * 副作用 / Effects: `this.save`; `this.migrationCompletions.set`; `this.migrationRuns.delete`; `this.emit`; 更新 / updates `vm.liveMigrationFence`.
     * 拒绝 / Refusals: 条件 / conditions `!current || migrationDigest(current) !== revision`; `!current.sourceStopped || !current.sourceHostId || !current.sessionId || !current.projectsDigest || !current.peerId`; `this.live.has(id)`; 异常 / errors `new AppError('原在线迁移栅栏已变化', 409, 'LIVE_MIGRATION_FENCE_CHANGED')`; `new AppError('原迁移缺少来源退出或会话证明，保持栅栏等待核验', 409, 'LIVE_MIGRATION_SOURCE_UNCONFIRMED')`.
     * 失败处理：catch 分支执行 `vm.liveMigrationFence = current;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `vm.liveMigrationFence = current;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.locked(id, async () => {
      await check();
      const vm = this.get(id), current = vm.liveMigrationFence;
      if (!current || migrationDigest(current) !== revision)
        throw new AppError('原在线迁移栅栏已变化', 409, 'LIVE_MIGRATION_FENCE_CHANGED');
      if (current.completion) return structuredClone(current);
      if (!current.sourceStopped || !current.sourceHostId || !current.sessionId || !current.projectsDigest || !current.peerId)
        throw new AppError('原迁移缺少来源退出或会话证明，保持栅栏等待核验', 409, 'LIVE_MIGRATION_SOURCE_UNCONFIRMED');
      if (this.live.has(id)) throw new AppError('来源原进程尚未确认停止', 409);
      const target = liveMigrationTargetStatusSchema.parse(await inspect());
      await check();
      if (vm.liveMigrationFence !== current || this.live.has(id))
        throw new AppError('原在线迁移栅栏或来源进程已变化', 409, 'LIVE_MIGRATION_FENCE_CHANGED');
      if (target.status !== 'running' || target.originStatus !== 'ready' || !target.targetVerifiedAt ||
        target.targetVmId !== current.targetVmId || target.sourceVmId !== id ||
        target.sourceHostId !== current.sourceHostId || target.transferId !== current.transferId ||
        target.sessionId !== current.sessionId || target.projectsDigest !== current.projectsDigest)
        throw new AppError('目标未以原迁移会话与项目身份确认运行', 409, 'LIVE_MIGRATION_TARGET_UNCONFIRMED');
      const next = liveMigrationFenceSchema.parse({ ...current, completion: {
        version: 1, sourceVmId: id, sourceHostId: current.sourceHostId, sourceProcessId: current.sourceProcessId,
        targetHostId: current.targetHostId, targetVmId: current.targetVmId, transferId: current.transferId,
        sessionId: current.sessionId, projectsDigest: current.projectsDigest,
        sourceStoppedAt: current.sourceStopped.stoppedAt, targetVerifiedAt: target.targetVerifiedAt,
        confirmedAt: new Date().toISOString(),
      } });
      vm.liveMigrationFence = next;
      try { await this.save(); }
      catch (error) { vm.liveMigrationFence = current; throw error; }
      this.migrationCompletions.set(id, migrationDigest(next));
      this.migrationRuns.delete(id);
      this.emit('change');
      return structuredClone(next);
    });
  }
  /**
   * 入口 / Entry: Machines.fenceForHa.
   * 功能：把本层请求转交 `this.haAuthority.fenceForHa`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.haAuthority.fenceForHa` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; raw: HaPromotion; guard: () => Promise<void> | void optional
   * 输出 / Returns: `this.haAuthority.fenceForHa(id, raw, guard)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async fenceForHa(id: string, raw: HaPromotion, guard?: () => Promise<void> | void) {
    return this.haAuthority.fenceForHa(id, raw, guard);
  }
  /**
   * 入口 / Entry: Machines.updateHaPromotion.
   * 功能：把本层请求转交 `this.haAuthority.updateHaPromotion`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.haAuthority.updateHaPromotion` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; transferId: string; patch: Pick<HaPromotion, 'status'> & { error?: string }
   * 输出 / Returns: `this.haAuthority.updateHaPromotion(id, transferId, patch)`.
   * 副作用 / Effects: `this.haAuthority.updateHaPromotion`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async updateHaPromotion(id: string, transferId: string, patch: Pick<HaPromotion, 'status'> & { error?: string }) {
    return this.haAuthority.updateHaPromotion(id, transferId, patch);
  }
  /**
   * 入口 / Entry: Machines.releaseHaPromotion.
   * 功能：把本层请求转交 `this.haAuthority.releaseHaPromotion`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.haAuthority.releaseHaPromotion` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; transferId: string
   * 输出 / Returns: `this.haAuthority.releaseHaPromotion(id, transferId)`.
   * 副作用 / Effects: `this.haAuthority.releaseHaPromotion`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async releaseHaPromotion(id: string, transferId: string) { return this.haAuthority.releaseHaPromotion(id, transferId); }
  /**
   * 入口 / Entry: Machines.retireHaReplica.
   * 功能：把本层请求转交 `this.haAuthority.retireHaReplica`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.haAuthority.retireHaReplica` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: `this.haAuthority.retireHaReplica(id, raw)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async retireHaReplica(id: string, raw: unknown) { return this.haAuthority.retireHaReplica(id, raw); }
  /**
   * 入口 / Entry: Machines.startInternal.
   * 功能：持锁检查实例准入、可信启动与网络资源，创建受管 QEMU 并观察启动完成。
   * Purpose: Checks VM admission/trusted boot/network under locks, starts managed QEMU and observes boot readiness.
   * 设计：启动资源即时登记，原运行、HA 栅栏或未确认清理阻止重启；失败按原 Live 身份关闭所有附属资源。
   * Design: Resources are immediately owned; live runs/fences/pending cleanup block restart and failure closes attachments against the original Live identity.
   * 输入 / Inputs: id: string; rescueOf: string optional; incoming: default=false; haActivation: { sourceHostId: string; transferId: string; sourceVmId: string; snapshotId: string; s… optional
   * 输出 / Returns: `this.locked('launch', () => this.locked(id, async () => { const vm = this.get(id); if (vm.haPromotion) throw new AppError('来源…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async startInternal(id: string, rescueOf?: string, incoming = false,
    haActivation?: { sourceHostId: string; transferId: string;
      sourceVmId: string; snapshotId: string; sha256: string }) {
    /**
     * 入口 / Entry: Machines.startInternal.callback@854.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(id)`.
     * 副作用 / Effects: `this.live.set`; `this.logs.set`; `this.save`; `this.live.delete`; `lifetime.close`; 更新 / updates `firmware`, `live.lifetime`, `vm.lastUsedAt`, `vm.lastError`.
     * 拒绝 / Refusals: 条件 / conditions `vm.haPromotion`; `vm.haRetirement`; `vm.migrationOrigin?.snapshotId`; 异常 / errors `new AppError('来源实例已为故障接管设置栅栏；请先确认目标已停止并解除栅栏', 409, 'HA_SOURCE_FENCED')`; `new AppError('故障副本已退出接管并被持久封锁，不能重新启动', 409, 'HA_REPLICA_RETIRED')`.
     * 失败处理：catch 分支执行 `this.live.delete(id);`; `await lifetime.close();`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `this.live.delete(id);`; `await lifetime.close();`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.locked('launch', () =>
      this.locked(id,
      /**
       * 中文功能：在原实例锁内校验启动准入、可信启动、磁盘和网络，建立 QEMU 及运行资源并等待启动观察结果。
       * English: Checks start admission, trusted boot, disk and networking under the original VM lock, establishes QEMU/run resources and awaits startup observations.
       * 所属 / Owner: Machines.startInternal.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       */
      async () => {
        const vm = this.get(id);
        if (vm.haPromotion)
          throw new AppError('来源实例已为故障接管设置栅栏；请先确认目标已停止并解除栅栏',
            409, 'HA_SOURCE_FENCED');
        if (vm.haRetirement)
          throw new AppError('故障副本已退出接管并被持久封锁，不能重新启动',
            409, 'HA_REPLICA_RETIRED');
        if (vm.migrationOrigin?.snapshotId) {
          if (!haActivation ||
              vm.migrationOrigin.sourceHostId !== haActivation.sourceHostId ||
              vm.migrationOrigin.transferId !== haActivation.transferId ||
              vm.migrationOrigin.sourceVmId !== haActivation.sourceVmId ||
              vm.migrationOrigin.snapshotId !== haActivation.snapshotId ||
              vm.migrationOrigin.diskSha256 !== haActivation.sha256)
            throw new AppError('故障副本只能通过已认证的接管流程启动',
              409, 'HA_REPLICA_STANDBY');
        } else if (haActivation)
          throw new AppError('目标实例不是已校验的故障副本', 409);
        if (vm.liveMigrationFence)
          throw new AppError('来源实例已为在线迁移设置栅栏，不能在原主机重新启动',
            409, 'LIVE_MIGRATION_SOURCE_FENCED');
        if (incoming && vm.liveMigrationOrigin?.status !== 'prepared')
          throw new AppError('目标实例没有待接收的在线迁移记录', 409);
        if (!incoming && vm.liveMigrationOrigin?.status === 'prepared')
          throw new AppError('在线迁移目标尚未接收客户机状态，不能普通启动', 409);
        if (vm.rescueOf && (vm.rescueOf !== rescueOf || !this.locks.has(rescueOf)))
          throw new AppError('临时救援实例只能由救援任务启动，请重新提交救援任务', 409);
        this.requireSandboxLifetime(vm);
        if (incoming && this.live.has(id))
          throw new AppError('迁移目标实例必须处于停止状态', 409);
        if (this.live.has(id)) return this.view(id);
        if (vm.haWitnessEnrollment) {
          if (!this.haStartGuards.size)
            throw new AppError('见证启动校验不可用，拒绝启动已登记实例',
              503, 'HA_WITNESS_UNAVAILABLE');
          await this.haStartGuards.dispatch(id);
        }
        validateAdmission(
          await resourcePolicy(),
          vm,
          [...this.live.keys()].map((key) => this.get(key)),
        );
        if (this.live.size >= 4) throw new AppError('轻量模式最多同时运行 4 个发行版', 409);
        for (const otherId of this.live.keys())
          for (const p of this.get(otherId).forwards)
            if (vm.forwards.some((n) => n.host === p.host))
              throw new AppError(`端口 ${p.host} 已被另一实例使用`, 409);
        this.requireUnreservedPorts(vm.forwards);
        if (vm.architecture === 'aarch64' && !this.engine.aarch64Available)
          throw new AppError('缺少 ARM64 QEMU，请运行 npm run setup', 503);
        if (vm.diskEncryption && !(await this.diskInfo(id)).encrypted)
          throw new AppError('加密配置与实际磁盘不一致，拒绝启动', 409);
        if (vm.diskEncryption && !(await new Secrets(this).list(id)).some(
          (item) => item.name === vm.diskEncryption!.secretName))
          throw new AppError(`缺少私密配置：${vm.diskEncryption.secretName}`, 409);
        const providers = vmBootProviders(this);
        let firmware: { code: string; vars: string } | null = null;
        if (vm.firmware === 'uefi') {
          for (const [, provider] of providers) {
            const selected = await provider.firmware?.(vm);
            if (selected && firmware) throw new AppError('实例固件提供者冲突', 409);
            if (selected) firmware = selected;
          }
          firmware ||= await ensureUefiFirmware(id, vm.architecture);
        }
        const [sshPort, qmpPort, serialPort, agentPort] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
        await recordBootAttempt(id);
        const accelerator = vm.architecture === 'aarch64' ? 'tcg'
          : vm.accelerator === 'auto' ? (this.engine.whpxAvailable ? 'whpx' : 'tcg') : vm.accelerator;
        const live: Live = {
          status: incoming ? 'paused' : 'starting',
          incoming,
          accelerator,
          startedAt: new Date().toISOString(),
          sshPort,
          qmpPort,
          agentPort,
          serialPort,
          abort: new AbortController(),
          bootAbort: new AbortController(),
          bootstrapKnown: incoming || vm.bootstrapped !== false,
          serialConnected: false,
          serialReady: false,
          serialTail: '',
          done: Promise.resolve(),
          clients: new Set(),
        };
        const lifetime = new VmLifetime(id, live.abort);
        live.lifetime = lifetime;
        this.live.set(id, live);
        const previousError = vm.lastError;
        const previousUsedAt = vm.lastUsedAt;
        vm.lastUsedAt = live.startedAt;
        delete vm.lastError;
        this.logs.set(id, '');
        try {
          await this.save();
        } catch (error) {
          this.live.delete(id);
          await lifetime.close();
          vm.lastUsedAt = previousUsedAt;
          if (previousError !== undefined) vm.lastError = previousError;
          throw error;
        }
        const dir = vmDir(id);
        // The deadline can pass while reserving ports or persisting startup state.
        if (vm.sandbox && sandboxExpired(vm.sandbox)) {
          this.live.delete(id);
          await lifetime.close();
          this.requireSandboxLifetime(vm);
        }
        let diskSecret: Awaited<ReturnType<typeof openDiskSecret>> | undefined;
        const attachments: BootAttachment[] = [];
        try {
          live.network = await this.network.attachVm({
            vmId: id, generation: randomUUID(), isolated: vm.managedNetwork === 'isolated' || vm.sandbox?.network === 'isolated',
            ipv6: vm.hardware?.ipv6, sshPort, forwards: vm.forwards,
            managementPorts: { qmp: qmpPort, serial: serialPort, agent: agentPort },
            /**
             * 入口 / Entry: Machines.startInternal.onFailure.
             * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`Machines`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `void` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
             * 处理：通过 `this.live.get`, `this.log`, `live.bootAbort.abort`, `live.abort.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `this.live.get`, `this.log`, `live.bootAbort.abort`, `live.abort.abort`; the branches below determine continuation, return or refusal.
             * 分支 / Branches: `this.live.get(id)?.abort !== live.abort || live.abort.signal.aborted`.
             * 输入 / Inputs: error
             * 输出 / Returns: `void`.
             * 副作用 / Effects: `live.bootAbort.abort`; `live.abort.abort`; `this.emit`; 更新 / updates `live.error`, `this.live.get(id)!.error`, `vm.lastError`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            onFailure: (error) => {
              if (this.live.get(id)?.abort !== live.abort || live.abort.signal.aborted) return;
              live.error = `统一网络工作进程退出：${error.message}`;
              this.live.get(id)!.error = live.error;
              vm.lastError = live.error;
              this.log(id, `\r\n${live.error}\r\n`);
              live.bootAbort.abort(); live.abort.abort(); this.emit('change');
            },
          });
          await lifetime.setNetwork(live.network);
          if (vm.diskEncryption)
            diskSecret = await lifetime.own('disk-secret', await openDiskSecret(this, id, vm.diskEncryption.secretName), 10);
          for (const [name, provider] of providers) {
            /**
             * 入口 / Entry: Machines.startInternal.callback@986.
             * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（provider.prepare）。
             * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (provider.prepare).
             * 输入 / Inputs: error
             * 输出 / Returns: `void`.
             * 副作用 / Effects: `this.emit`; `live.abort.abort`; 更新 / updates `live.error`, `this.live.get(id)!.error`, `vm.lastError`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            const attachment = await provider.prepare(vm, (error) => {
              if (this.live.get(id)?.abort !== live.abort || live.abort.signal.aborted ||
                  this.live.get(id)?.status === 'stopping') return;
              live.error = `${name} 守护程序退出：${error.slice(-1024)}`;
              this.live.get(id)!.error = live.error;
              vm.lastError = live.error;
              this.log(id, `\r\n${live.error}\r\n`);
              this.emit('change');
              live.abort.abort();
            });
            if (attachment) {
              attachments.push(await lifetime.own(`attachment:${name}`, attachment, 30));
              if (provider.allowInitialReset) live.allowInitialReset = true;
            }
          }
          if (attachments.filter(value => value.machine).length > 1)
            throw new AppError('实例机器类型提供者冲突', 409);
        } catch (error) {
          this.live.delete(id);
          vm.lastError = (error as Error).message;
          this.emit('change');
          try { await lifetime.close(); }
          catch (cleanup) { throw new AppError(`实例启动资源清理尚未确认：${String(cleanup)}`, 503, 'VM_CLEANUP_PENDING'); }
          throw error;
        }
        /**
         * 入口 / Entry: Machines.startInternal.escape.
         * 功能：把本层请求转交 `s.replaceAll`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `s.replaceAll` and propagates the provider result or rejection.
         * 输入 / Inputs: s: string
         * 输出 / Returns: `s.replaceAll(',', ',,')`.
         * 副作用 / Effects: `s.replaceAll`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const escape = (s: string) => s.replaceAll(',', ',,');
        // QEMU writes this unique run receipt. Supervisors bind the recorded PID to its creation time.
        live.processRecordFile = join(dir, `run-${lifetime.capture().vmProcessId}.pid`);
        const args = [
          '-pidfile',
          live.processRecordFile,
          '-name',
          `sakura-${vm.name}`,
          '-machine',
          attachments.find(value => value.machine)?.machine || (vm.architecture === 'aarch64' ? 'virt' : 'q35'),
          '-nodefaults',
          ...(vm.sandbox ? ['-no-user-config'] : []),
          '-boot',
          'order=c,menu=off',
          ...(!vm.distro || vm.distro === 'alpine' ? ['-smbios', 'type=1,serial=ds=nocloud'] : []),
          '-accel',
          // Use an instruction-based clock on Windows TCG: host scheduling can
          // otherwise make Alpine's early PIT/IO-APIC timer check panic. icount
          // requires single-threaded TCG; other hosts keep multi-threading.
          accelerator === 'whpx' ? 'whpx' : `tcg,thread=${process.platform === 'win32' ? 'single' : 'multi'}`,
          '-cpu', qemuCpuModel(vm.architecture),
          ...(process.platform === 'win32' && accelerator === 'tcg' && vm.architecture !== 'aarch64'
            ? ['-icount', 'shift=auto,sleep=on']
            : []),
          ...hardwareArguments(vm),
          ...attachments.flatMap(value => value.args),
          ...(vm.rescueOf
            ? [
                '-device',
                'pcie-root-port,id=sakura-rescue-port,slot=1,chassis=1',
                '-device',
                'pcie-root-port,id=sakura-rescue-compare-port,slot=2,chassis=2',
                '-device',
                'pcie-root-port,id=sakura-rescue-target-port,slot=3,chassis=3',
              ]
            : []),
          '-display',
          vm.hardware?.devices?.graphics === 'virgl' ? 'egl-headless' : 'none',
          '-monitor',
          'none',
          // Some signed UEFI fallback loaders register a boot entry and reset
          // once before the first Linux boot. Keep that reset inside QEMU.
          ...(live.allowInitialReset ? [] : ['-no-reboot']),
          ...(firmware
            ? [
                '-drive',
                `if=pflash,unit=0,format=raw,readonly=on,file=${escape(firmware.code)}`,
                '-drive',
                `if=pflash,unit=1,format=raw,file=${escape(firmware.vars)}`,
              ]
            : []),
          ...(diskSecret ? ['-object', qemuSecretObject(diskSecret.file)] : []),
          '-drive',
          `file=${escape(join(dir, 'disk.qcow2'))},if=virtio,id=sakura-disk,format=qcow2,${diskOptions(vm)}${diskSecret ? ',' + encryptedDriveOption() : ''}${vm.sandbox?.storage === 'discard-on-stop' ? ',snapshot=on' : ''}`,
          '-drive',
          `file=${escape(join(dir, 'seed.iso'))},${vm.distro && vm.distro !== 'alpine' ? 'if=virtio,format=raw' : 'media=cdrom'},readonly=on`,
          '-netdev',
          live.network.netdev,
          ...audioArguments(vm),
          ...deviceArguments(vm),
          ...(vm.architecture === 'aarch64' ? [] : ['-device', 'qemu-xhci,id=sakura-usb']),
          '-chardev',
          `socket,id=sakura-agent,host=127.0.0.1,port=${agentPort},server=on,wait=off`,
          '-device',
          'virtio-serial-pci',
          '-device',
          'virtserialport,chardev=sakura-agent,name=org.qemu.guest_agent.0',
          '-qmp',
          `tcp:127.0.0.1:${qmpPort},server=on,wait=off`,
          '-serial',
          `tcp:127.0.0.1:${serialPort},server=on,wait=off`,
          ...(incoming ? ['-incoming', 'defer'] : []),
        ];
        live.processArguments = Object.freeze([...args]);
        let nativeExited = false;
        /**
         * 入口 / Entry: Machines.startInternal.callback@1100.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（withResourceContext().then().finally）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (withResourceContext().then().finally).
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `live.abort.abort`; `live.bootAbort.abort`; `lifetime.close().catch`; `lifetime.close`; `live.serial.destroy`; 更新 / updates `run.stoppedAt`, `vm.liveMigrationFence`, `vm.lastUsedAt`.
         * 拒绝 / Refusals: 条件 / conditions `cleanupFailure`; 异常 / errors `new AppError('实例资源清理尚未确认', 503, 'VM_CLEANUP_PENDING')`.
         */
        /**
         * 入口 / Entry: Machines.startInternal.callback@1091.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（withResourceContext().then）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (withResourceContext().then).
         * 输入 / Inputs: error
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 更新 / updates `live.error`, `this.live.get(id)!.error`, `vm.lastError`, `nativeExited`.
         * 拒绝 / Refusals: 条件 / conditions `error instanceof AppError && error.status === 503`; 异常 / errors `error`.
         */
        live.done = withResourceContext({ ...lifetime.capture(), owner: `vm:${id}` }, () => this.engine
          .run(vm.architecture === 'aarch64' ? 'sakura-qemu-aarch64' : 'sakura-qemu', args, {
            owner: `vm:${id}`,
            processKind: 'vm',
            signal: live.abort.signal,
            timeoutMs: 2147483647,
            /**
             * 入口 / Entry: Machines.startInternal.output.
             * 功能：把本层请求转交 `this.log`，沿用该实现的结果与失败路径。
             * Purpose: Delegates this request to `this.log` and propagates the provider result or rejection.
             * 输入 / Inputs: b
             * 输出 / Returns: `this.log(id, b)`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            output: (b) => this.log(id, b),
          }))
          .then(
            () => { nativeExited = true; },
            async (error) => {
              live.error = String(error.message || error);
              if (this.live.get(id)?.abort === live.abort) this.live.get(id)!.error = live.error;
              vm.lastError = live.error;
              this.log(id, `\r\n${live.error}\r\n`);
              if (error instanceof AppError && error.status === 503) throw error;
              nativeExited = true;
            },
          )
          .finally(async () => {
            // Mark this process lifetime ended before awaiting any generation cleanup.
            live.abort.abort();
            live.bootAbort.abort();
            const active = this.live.get(id);
            let cleanupFailure: unknown;
            await lifetime.close().catch(error => {
              cleanupFailure = error;
              this.log(id, `\r\n清理实例资源失败：${String(error)}\r\n`);
            });
            live.bootAbort.abort();
            live.serial?.destroy();
            if (active?.abort === live.abort) active.serial?.destroy();
            for (const client of live.clients) client.end();
            await live.bootDone;
            if (nativeExited && live.processRecordFile) {
              await unlink(live.processRecordFile).catch(error => {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                  cleanupFailure ||= error;
                  this.log(id, `\r\n运行进程回执清理失败：${String(error)}\r\n`);
                }
              });
            }
            if (this.live.get(id)?.abort === live.abort) this.live.delete(id);
            const run = this.migrationRuns.get(id), fence = vm.liveMigrationFence;
            if (nativeExited && run?.live === live && fence &&
                run.identity === migrationFenceIdentity(fence) && run.processId === fence.sourceProcessId) {
              run.stoppedAt = new Date().toISOString();
              delete run.live;
              // Persist native exit while the host is still alive, including ordinary service shutdown.
              vm.liveMigrationFence = liveMigrationFenceSchema.parse({ ...fence,
                sourceStopped: { sourceProcessId: run.processId, stoppedAt: run.stoppedAt } });
            }
            vm.lastUsedAt = new Date().toISOString();
            await this.save().catch((error) => this.log(id, `\r\n保存实例状态失败：${String(error)}\r\n`));
            this.emit('change');
            if (cleanupFailure) throw new AppError('实例资源清理尚未确认', 503, 'VM_CLEANUP_PENDING');
          });
        void live.done.catch(() => {});
        if (diskSecret) {
          const secret = diskSecret;
          void (async () => {
            while (this.live.get(id) === live && !live.abort.signal.aborted) {
              try {
                await qmp(qmpPort, 'query-status', undefined, 2000);
                await secret.close();
                return;
              } catch {
                await delay(100);
              }
            }
          })().catch((error) => this.log(id, `\r\n清理磁盘临时口令失败：${String(error)}\r\n`));
        }
        if (!incoming) live.bootDone = this.watchBoot(id, live).catch((e) => {
          if (!live.bootAbort.signal.aborted) this.log(id, String(e));
        });
        this.emit('change');
        return this.view(id);
      }),
    );
  }
  /**
   * 入口 / Entry: Machines.connectSerial.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `live.serial`（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; the outcome is recorded in `live.serial`. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `createConnection`, `socket.on` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `createConnection`, `socket.on`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; live: Live
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `createConnection`; 更新 / updates `live.serial`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private connectSerial(id: string, live: Live) {
    const socket = createConnection({ host: '127.0.0.1', port: live.serialPort });
    socket.on('error', () => {});
    socket.on('connect', () => { live.serialConnected = true; });
    socket.on('close', () => { live.serialConnected = false; });
    socket.on('data', (data) => this.log(id, data));
    live.serial = socket;
  }
  /**
   * 入口 / Entry: Machines.watchBoot.
   * 功能：观察串口与客户机连通性，运行固定初始化并确认当前 VM 已启动。
   * Purpose: Observes serial/guest connectivity, performs fixed initialization and confirms VM boot readiness.
   * 设计：有期限重试保留原 Live 引用；状态或取消改变时退出，实际 boot 读取推进执行身份而不凭 SSH 名称推断。
   * Design: Deadline retries retain the original Live reference; transitions/cancellation stop observation and actual boot reads establish execution identity.
   * 输入 / Inputs: id: string; live: Live
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.connectSerial`; `this.exec`; `writeIdentityFile`; `rm`; `this.save`; 更新 / updates `vm.liveMigrationOrigin`, `live.error`, `live.status`, `this.get(id).bootstrapped`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; `existsSync(identityFile)`; `prepared.code !== 0`; 异常 / errors `new Error('Linux initialization is not finished')`; `new Error(prepared.stderr)`.
   * 失败处理：catch 分支执行 `if (signal.aborted) return;`; `await delay(Math.min(250, Math.max(0, deadline - performance.now())), undefined, { signal });`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (signal.aborted) return;`; `await delay(Math.min(250, Math.max(0, deadline - performance.now())), undefined, { signal });`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async watchBoot(id: string, live: Live) {
    const deadline = performance.now() + BOOT_TIMEOUT_MS;
    const { signal } = live.bootAbort;
    while (
      performance.now() < deadline &&
      this.live.get(id) === live &&
      live.status === 'starting' &&
      !signal.aborted
    ) {
      if (!live.serial || live.serial.destroyed) {
        this.connectSerial(id, live);
      }
      // A newly created disk emits SAKURA_READY only after its one-time cloud
      // provisioning has completed. Once the serial channel is connected,
      // wait for that marker instead of repeatedly creating SSH sessions that
      // can only fail while Tiny Cloud is still running. If the serial channel
      // is unavailable, retain the SSH probe fallback for older images.
      if (!live.bootstrapKnown && live.serialConnected && !live.serialReady) {
        await delay(100, undefined, { signal });
        continue;
      }
      try {
        // The first SSH daemon is reachable before user-data restarts it. Do not
        // expose terminals until Tiny Cloud has finished provisioning the guest.
        const result = await this.exec(
          id,
          this.get(id).distro && this.get(id).distro !== 'alpine'
            ? 'test -f /var/lib/cloud/instance/boot-finished && test -d /workspace && /bin/sync'
            : `set -e\ntest -f /var/lib/cloud/.bootstrap-complete\n${bootSetup()}\n/bin/sync`,
          Math.max(1, Math.min(1800, deadline - performance.now())),
          signal,
        );
        if (result.code !== 0) throw new Error('Linux initialization is not finished');
        signal.throwIfAborted();
        const identityFile = join(vmDir(id), 'identity.json');
        if (existsSync(identityFile)) {
          const identity = JSON.parse(await readFile(identityFile, 'utf8')) as ReturnType<
            typeof createSshKey
          >;
          // Keep the existing key usable until the new host key is durable.
          // Power loss between these steps can then be retried with either key.
          const prepared = await this.exec(
            id,
            `set -e\ngrep -qxF '${identity.publicText}' /root/.ssh/authorized_keys || printf '\\n%s\\n' '${identity.publicText}' >> /root/.ssh/authorized_keys\nchmod 600 /root/.ssh/authorized_keys\nsync\n`,
            10000,
            signal,
          );
          if (prepared.code !== 0) throw new Error(prepared.stderr);
          await writeIdentityFile(join(vmDir(id), 'id_rsa'), identity.privateText);
          const changed = await this.exec(
            id,
            `set -e\nprintf '%s\\n' '${identity.publicText}' > /root/.ssh/authorized_keys.sakura-tmp\nchmod 600 /root/.ssh/authorized_keys.sakura-tmp\nmv /root/.ssh/authorized_keys.sakura-tmp /root/.ssh/authorized_keys\nhostname '${this.get(id).name}'\nprintf '%s\\n' '${this.get(id).name}' > /etc/hostname\n/bin/sync\n`,
            10000,
            signal,
          );
          if (changed.code !== 0) throw new Error(changed.stderr);
          await rm(identityFile);
        }
        if (this.live.get(id) === live && live.status === 'starting') {
          // Secure UEFI may reset once to register its signed boot loader. Once
          // Linux is ready, restore the usual stop-on-guest-reboot behavior.
          if (live.allowInitialReset)
            await qmp(live.qmpPort, 'set-action', { reboot: 'shutdown' });
          const vm = this.get(id), origin = vm.liveMigrationOrigin;
          if (origin?.status === 'received') {
            vm.liveMigrationOrigin = liveMigrationOriginSchema.parse({ ...origin,
              status: 'ready', updatedAt: new Date().toISOString() });
            try { await this.save(); }
            catch (error) {
              vm.liveMigrationOrigin = origin;
              live.error = `迁移目标就绪记录保存失败：${String(error)}`;
              live.status = 'error';
              this.emit('change');
              return;
            }
          }
          live.status = 'running';
          this.get(id).bootstrapped = true;
          await resetBootGuard(id);
          this.emit('change');
        }
        return;
      } catch {
        if (signal.aborted) return;
        await delay(Math.min(250, Math.max(0, deadline - performance.now())), undefined, { signal });
      }
    }
    if (this.live.get(id) === live && live.status === 'starting') {
      live.error = 'Linux 启动超时；请查看启动日志，然后停止并重试。';
      live.status = 'error';
      this.emit('change');
    }
  }
  /**
   * 入口 / Entry: Machines.transport.
   * 功能：向调用者提供 `new MachineTransport(this)` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `new MachineTransport(this)` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `new MachineTransport(this)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private get transport() { return new MachineTransport(this); }
  /**
   * 入口 / Entry: Machines.connect.
   * 功能：把本层请求转交 `this.transport.connect`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.transport.connect` and propagates the provider result or rejection.
   * 输入 / Inputs: args: Parameters<MachineTransport['connect']>
   * 输出 / Returns: `this.transport.connect(...args)`.
   * 副作用 / Effects: `this.transport.connect`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  connect(...args: Parameters<MachineTransport['connect']>) {
    return this.transport.connect(...args);
  }
  /**
   * 入口 / Entry: Machines.exec.
   * 功能：从当前输入或状态计算 `this.transport.exec(...args)`，供调用方后续验证或使用。
   * Purpose: Computes `this.transport.exec(...args)` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: args: Parameters<MachineTransport['exec']>
   * 输出 / Returns: `this.transport.exec(...args)`.
   * 副作用 / Effects: `this.transport.exec`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  exec(...args: Parameters<MachineTransport['exec']>) {
    return this.transport.exec(...args);
  }
  /**
   * 入口 / Entry: Machines.execInput.
   * 功能：把本层请求转交 `this.transport.execInput`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.transport.execInput` and propagates the provider result or rejection.
   * 输入 / Inputs: args: Parameters<MachineTransport['execInput']>
   * 输出 / Returns: `this.transport.execInput(...args)`.
   * 副作用 / Effects: `this.transport.execInput`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  execInput(...args: Parameters<MachineTransport['execInput']>) {
    return this.transport.execInput(...args);
  }
  /**
   * 入口 / Entry: Machines.openGuestTcpStream.
   * 功能：把本层请求转交 `this.transport.openGuestTcpStream`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.transport.openGuestTcpStream` and propagates the provider result or rejection.
   * 输入 / Inputs: args: Parameters<MachineTransport['openGuestTcpStream']>
   * 输出 / Returns: `this.transport.openGuestTcpStream(...args)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  openGuestTcpStream(...args: Parameters<MachineTransport['openGuestTcpStream']>) {
    return this.transport.openGuestTcpStream(...args);
  }
  /**
   * 入口 / Entry: Machines.connectOnce.
   * 功能：把本层请求转交 `this.transport.connectOnce`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.transport.connectOnce` and propagates the provider result or rejection.
   * 输入 / Inputs: args: Parameters<MachineTransport['connectOnce']>
   * 输出 / Returns: `this.transport.connectOnce(...args)`.
   * 副作用 / Effects: `this.transport.connectOnce`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private connectOnce(...args: Parameters<MachineTransport['connectOnce']>) {
    return this.transport.connectOnce(...args);
  }
  /**
   * 入口 / Entry: Machines.sftp.
   * 功能：把本层请求转交 `this.transport.sftp`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.transport.sftp` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; work: (sftp: SFTPWrapper, transportSignal?: AbortSignal) => Promise<T>; signal: AbortSignal optional
   * 输出 / Returns: `this.transport.sftp(id, work, signal)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  sftp<T>(id: string, work: (sftp: SFTPWrapper, transportSignal?: AbortSignal) => Promise<T>, signal?: AbortSignal) {
    return this.transport.sftp(id, work, signal);
  }
  /**
   * 入口 / Entry: Machines.files.
   * 功能：把本层请求转交 `this.sftp`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.sftp` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; path: string
   * 输出 / Returns: `this.sftp( id, (ftp) => new Promise((res, rej) => ftp.readdir(guestPath(path), (err, entries) => err ? rej(err) : res( entrie…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async files(id: string, path: string) {
    return this.sftp(
      id,
      (ftp) =>
        new Promise((res, rej) =>
          ftp.readdir(guestPath(path), (err, entries) =>
            err
              ? rej(err)
              : res(
                  entries
                    .map((e) => ({
                      name: e.filename,
                      size: e.attrs.size,
                      directory: e.attrs.isDirectory(),
                      symlink: e.attrs.isSymbolicLink(),
                      modified: e.attrs.mtime,
                    }))
                    .sort(
                      (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
                    ),
                ),
          ),
        ),
    );
  }
  /**
   * 入口 / Entry: Machines.readGuestFile.
   * 功能：把本层请求转交 `this.sftp`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.sftp` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; path: string
   * 输出 / Returns: `this.sftp(id, async (ftp) => { const bytes = await new Promise<Buffer>((resolve, reject) => { const chunks: Buffer[] = []; le…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async readGuestFile(id: string, path: string) {
    /**
     * 入口 / Entry: Machines.readGuestFile.callback@1299.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.sftp）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.sftp).
     * 输入 / Inputs: ftp
     * 输出 / Returns: `bytes.toString('utf8')`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!isUtf8(bytes)`; 异常 / errors `new AppError('文件不是有效的 UTF-8 文本，请下载原文件处理')`.
     */
    return this.sftp(id, async (ftp) => {
      /**
       * 入口 / Entry: Machines.readGuestFile.callback@1300.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.sftp）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.sftp).
       * 输入 / Inputs: resolve; reject
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `ftp.createReadStream`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const bytes = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let ended = false;
        const stream = ftp.createReadStream(guestPath(path));
        stream.on('data', (data: Buffer) => {
          size += data.length;
          if (size > MAX_TEXT_BYTES) stream.destroy(new AppError('仅支持预览 1 MiB 以内的文本文件'));
          else if (data.includes(0)) stream.destroy(new AppError('二进制文件不能作为文本编辑'));
          else chunks.push(data);
        });
        stream.on('error', reject);
        stream.on('end', () => {
          ended = true;
        });
        // SFTP closes its remote handle after EOF; keep SSH alive until that completes.
        stream.on('close', () =>
          ended ? resolve(Buffer.concat(chunks)) : reject(new AppError('文件读取未完成')),
        );
      });
      if (!isUtf8(bytes)) throw new AppError('文件不是有效的 UTF-8 文本，请下载原文件处理');
      return bytes.toString('utf8');
    });
  }
  /**
   * 入口 / Entry: Machines.writeGuestFile.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，校验并提交领域状态变更；完成下述调用及状态处理（`Machines`）。
   * Purpose: Validates and commits a domain state change in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; path: string; content: string; overwrite: default=true; expectedVersion: string optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `bytes.length > MAX_TEXT_BYTES`; 异常 / errors `new AppError('仅支持保存 1 MiB 以内的文本文件', 413)`.
   */
  async writeGuestFile(
    id: string,
    path: string,
    content: string,
    overwrite = true,
    expectedVersion?: string,
  ) {
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > MAX_TEXT_BYTES) throw new AppError('仅支持保存 1 MiB 以内的文本文件', 413);
    await this.locked(`text:${id}:${path}`, () => {
      const files = new Files(this);
      return files.upload(id, path, Readable.from(bytes), overwrite, undefined, expectedVersion);
    });
  }
  /**
   * 入口 / Entry: Machines.stop.
   * 功能：把本层请求转交 `this.transition`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.transition` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; force: default=false
   * 输出 / Returns: `this.transition(id, async () => this.stopInternal(id, force), true, force)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async stop(id: string, force = false) {
    return this.transition(id, async () => this.stopInternal(id, force), true, force);
  }
  /**
   * 入口 / Entry: Machines.bootGuard.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `bootGuardStatus(id)` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `bootGuardStatus(id)` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.get`, `this.locked`, `bootGuardStatus` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.get`, `this.locked`, `bootGuardStatus`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `reset`.
   * 输入 / Inputs: id: string; reset: default=false
   * 输出 / Returns: `bootGuardStatus(id)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async bootGuard(id: string, reset = false) {
    this.get(id);
    if (reset)
      await this.locked(id, async () => {
        this.requireStopped(id);
        await resetBootGuard(id);
      });
    return bootGuardStatus(id);
  }
  /**
   * 入口 / Entry: Machines.suspend.
   * 功能：把本层请求转交 `this.transition`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.transition` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.transition(id, async () => { this.requireMigrationRunAllowed(id); const live = this.live.get(id); if (!live || live.stat…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async suspend(id: string) {
    /**
     * 入口 / Entry: Machines.suspend.callback@1351.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.transition）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.transition).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(id)`.
     * 副作用 / Effects: `this.emit`; 更新 / updates `live.status`.
     * 拒绝 / Refusals: 条件 / conditions `!live || live.status !== 'running'`; 异常 / errors `new AppError('只有运行中的发行版可以暂停', 409)`.
     */
    return this.transition(id, async () => {
      this.requireMigrationRunAllowed(id);
      const live = this.live.get(id);
      if (!live || live.status !== 'running') throw new AppError('只有运行中的发行版可以暂停', 409);
      await qmp(live.qmpPort, 'stop');
      live.status = 'paused';
      this.emit('change');
      return this.view(id);
    });
  }
  /**
   * 入口 / Entry: Machines.resume.
   * 功能：把本层请求转交 `this.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.locked(id, async () => { this.requireMigrationRunAllowed(id); this.requireSandboxLifetime(this.get(id)); const live = th…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async resume(id: string) {
    /**
     * 入口 / Entry: Machines.resume.callback@1362.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(id)`.
     * 副作用 / Effects: `this.emit`; 更新 / updates `live.status`.
     * 拒绝 / Refusals: 条件 / conditions `!live || live.status !== 'paused'`; `live.incoming`; 异常 / errors `new AppError('只有已暂停的发行版可以恢复', 409)`; `new AppError('迁移接收中的目标实例不能手动恢复', 409)`.
     */
    return this.locked(id, async () => {
      this.requireMigrationRunAllowed(id);
      this.requireSandboxLifetime(this.get(id));
      const live = this.live.get(id);
      if (!live || live.status !== 'paused') throw new AppError('只有已暂停的发行版可以恢复', 409);
      if (live.incoming) throw new AppError('迁移接收中的目标实例不能手动恢复', 409);
      await qmp(live.qmpPort, 'cont');
      live.status = 'running';
      this.emit('change');
      return this.view(id);
    });
  }
  /**
   * 入口 / Entry: Machines.stopInternal.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.view(id)` 供上层消费（`Machines`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Machines`; this entry produces `this.view(id)` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.get`, `this.live.get`, `this.view`, `this.emit` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.get`, `this.live.get`, `this.view`, `this.emit`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!live`; `live.incoming || vm.liveMigrationFence`; `!force && live.status === 'paused'`.
   * 输入 / Inputs: id: string; force: boolean
   * 输出 / Returns: `this.view(id)`.
   * 副作用 / Effects: `this.emit`; `live.bootAbort.abort`; `this.exec().catch`; `this.exec`; `live.abort.abort`; 更新 / updates `force`, `live.status`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async stopInternal(id: string, force: boolean) {
    const vm = this.get(id);
    const live = this.live.get(id);
    if (!live) return this.view(id);
    if (live.incoming || vm.liveMigrationFence) force = true;
    // Guest poweroff can finish before status reaches "stopping". Notify
    // lifecycle observers before sending the graceful shutdown command.
    this.emit('stop-requested', id);
    live.bootAbort.abort();
    if (!force && live.status === 'paused') {
      await qmp(live.qmpPort, 'cont').catch(() => {});
      live.status = 'running';
    }
    if (!force && live.status === 'running') await this.exec(id, 'sync; poweroff', 5000).catch(() => {});
    if (this.live.get(id) !== live) return this.view(id);
    live.status = 'stopping';
    this.emit('change');
    if (!force) {
      await qmp(live.qmpPort, 'system_powerdown').catch(() => {});
      await Promise.race([live.done, delay(15000, undefined, { ref: false })]);
    }
    if (this.live.has(id)) live.abort.abort();
    await live.done;
    return this.view(id);
  }
  /**
   * 入口 / Entry: Machines.requireMigrationRunAllowed.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`Machines`）。
   * Purpose: Checks admission, input or resource ownership in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `vm.liveMigrationFence`; `vm.liveMigrationOrigin?.status === 'prepared'`; 异常 / errors `new AppError('来源实例已为在线迁移设置栅栏，不能改变客户机运行状态', 409, 'LIVE_MIGRATION_SOURCE_FENCED')`; `new AppError('迁移接收中的目标实例仍在等待客户机状态，不能改变客户机运行状态', 409)`.
   */
  private requireMigrationRunAllowed(id: string) {
    const vm = this.get(id);
    if (vm.liveMigrationFence)
      throw new AppError('来源实例已为在线迁移设置栅栏，不能改变客户机运行状态',
        409, 'LIVE_MIGRATION_SOURCE_FENCED');
    if (vm.liveMigrationOrigin?.status === 'prepared')
      throw new AppError('迁移接收中的目标实例仍在等待客户机状态，不能改变客户机运行状态', 409);
  }
  /**
   * 入口 / Entry: Machines.update.
   * 功能：把本层请求转交 `this.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; input: unknown | ((current: VMRecord) => unknown); guard: (current: VMRecord) => void optional
   * 输出 / Returns: `this.locked(id, async () => { const vm = this.get(id); this.requireMutableConfig(vm); this.requireStopped(id); guard?.(vm); c…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async update(id: string, input: unknown | ((current: VMRecord) => unknown),
    guard?: (current: VMRecord) => void) {
    /**
     * 入口 / Entry: Machines.update.callback@1409.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(id)`.
     * 副作用 / Effects: `createSchema.parse`; `this.save`; `this.emit`; 更新 / updates `config.architecture`, `config.firmware`.
     * 拒绝 / Refusals: 条件 / conditions `config.name !== vm.name`; `config.diskGiB !== vm.diskGiB`; `config.storagePoolId !== undefined && config.storagePoolId !== (vm.storagePoolId || 'default')`; 异常 / errors `new AppError('实例名称创建后不可修改')`; `new AppError('磁盘大小创建后不可修改')`.
     * 失败处理：catch 分支执行 `for (const key of Object.keys(config) as Array<keyof typeof config>) if (!Object.hasOwn(before, key)) delete (vm as any)[key]…`; `Object.assign(vm, before);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `for (const key of Object.keys(config) as Array<keyof typeof config>) if (!Object.hasOwn(before, key)) delete (vm as any)[key]…`; `Object.assign(vm, before);`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireMutableConfig(vm);
      this.requireStopped(id);
      guard?.(vm);
      const config = createSchema.parse(typeof input === 'function' ? input(vm) : input);
      if (config.architecture === undefined && vm.architecture)
        config.architecture = vm.architecture;
      if (config.firmware === undefined && vm.architecture === 'aarch64')
        config.firmware = vm.firmware;
      this.requireUnreservedPorts(config.forwards);
      if (config.firmware === 'uefi') await requireUefiSupport(config.architecture ?? vm.architecture);
      if (config.name !== vm.name) throw new AppError('实例名称创建后不可修改');
      if (config.diskGiB !== vm.diskGiB) throw new AppError('磁盘大小创建后不可修改');
      if (config.storagePoolId !== undefined &&
          config.storagePoolId !== (vm.storagePoolId || 'default'))
        throw new AppError('请使用存储池迁移操作移动已有实例', 409);
      if ((config.distro || 'alpine') !== (vm.distro || 'alpine'))
        throw new AppError('不能更改已有磁盘的发行版');
      if (config.architecture !== undefined && config.architecture !== (vm.architecture || 'x86_64'))
        throw new AppError('不能更改已有磁盘的架构');
      const before = { ...vm };
      if (config.memoryMiB < distroInfo(vm.distro, vm.architecture).minimumMemory)
        throw new AppError('内存低于发行版最低要求');
      createSchema.parse({ ...config, architecture: vm.architecture,
        firmware: config.firmware ?? vm.firmware, hardware: config.hardware ?? vm.hardware });
      this.requireUnreservedPorts(config.forwards);
      Object.assign(vm, config);
      try {
        await this.save();
      } catch (error) {
        for (const key of Object.keys(config) as Array<keyof typeof config>)
          if (!Object.hasOwn(before, key)) delete (vm as any)[key];
        Object.assign(vm, before);
        throw error;
      }
      this.emit('change');
      return this.view(id);
    });
  }
  /**
   * 入口 / Entry: Machines.configureHardware.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，校验并提交领域状态变更；本入口产生 `this.update(id, (vm: VMRecord) => ({ name: vm.name, memoryMiB: vm.memoryMiB, cpus: vm.cpus, diskGiB: vm.diskGiB, accelerator:…` 供上层消费（`Machines`）。
   * Purpose: Validates and commits a domain state change in `Machines`; this entry produces `this.update(id, (vm: VMRecord) => ({ name: vm.name, memoryMiB: vm.memoryMiB, cpus: vm.cpus, diskGiB: vm.diskGiB, accelerator:…` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `hardwareSchema.parse`, `this.update` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `hardwareSchema.parse`, `this.update`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown; expected: { hardware: unknown; memoryMiB: number; architecture?: string } optional
   * 输出 / Returns: `this.update(id, (vm: VMRecord) => ({ name: vm.name, memoryMiB: vm.memoryMiB, cpus: vm.cpus, diskGiB: vm.diskGiB, accelerator:…`.
   * 副作用 / Effects: `this.update`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async configureHardware(id: string, input: unknown,
    expected?: { hardware: unknown; memoryMiB: number; architecture?: string }) {
    const hardware = hardwareSchema.parse(input);
    return this.update(id, (vm: VMRecord) => ({
      name: vm.name, memoryMiB: vm.memoryMiB, cpus: vm.cpus, diskGiB: vm.diskGiB,
      accelerator: vm.accelerator, distro: vm.distro, architecture: vm.architecture,
      template: vm.template, firmware: vm.firmware, forwards: vm.forwards, hardware,
    }), (vm) => {
      if (expected && (JSON.stringify(vm.hardware || {}) !== JSON.stringify(expected.hardware) ||
          vm.memoryMiB !== expected.memoryMiB || vm.architecture !== expected.architecture))
        throw new AppError('实例配置已变化，请重新预览 GPU 档案', 409);
    });
  }
  /**
   * 入口 / Entry: Machines.hotplug.
   * 功能：读取可用 CPU/内存插槽并按目标在线添加资源，核对 QEMU 和客户机上线结果。
   * Purpose: Reads CPU/RAM slots and adds requested resources online, checking both QEMU state and guest activation.
   * 设计：目标必须符合预留、发行版和宿主资源限制；每次实际添加后保存状态，部分成功不伪装成完整客户机上线。
   * Design: Targets obey reservations/distribution/host limits; successful additions persist state and partial success does not imply full guest activation.
   * 输入 / Inputs: id: string; kind: 'cpu' | 'memory'; target: number optional; signal: AbortSignal optional
   * 输出 / Returns: `this.locked('launch', () => this.locked(id, async () => { const vm = this.get(id), live = this.live.get(id); this.requireMuta…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async hotplug(id: string, kind: 'cpu' | 'memory', target?: number, signal?: AbortSignal) {
    /**
     * 入口 / Entry: Machines.hotplug.callback@1464.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ kind, current, maximum, slots, canAdd: live.accelerator !== 'whpx' && guestPossible > current, accelerator: live.accelerato…`; `{ kind, code: guest.code, ready: guest.code === 0, current: vm.cpus, maximum, guestOnline: Number(guest.stdout.trim()) || nul…`; `{ kind, current, maximum, devices, canAdd: live.accelerator !== 'whpx', accelerator: live.accelerator, }`；另有分支返回 / additional branch-specific returns.
     * 副作用 / Effects: `this.exec`; `additions.push`; `this.save`; `this.emit`; 更新 / updates `current`, `vm.cpus`, `vm.memoryMiB`.
     * 拒绝 / Refusals: 条件 / conditions `!live || live.status !== 'running'`; `target !== undefined && live.accelerator === 'whpx'`; `kind === 'cpu'`; 异常 / errors `new AppError('请先启动发行版', 409)`; `new AppError( '当前 Windows QEMU 的 WHPX 热插拔不可靠，请停止后切换到 TCG 兼容模式或离线调整资源', 409, 'HOTPLUG_ACCELERATOR_UNSUPPORTED', )`.
     * 失败处理：catch 分支执行 `await qmp(live.qmpPort, 'object-del', { id: objectId }).catch(() => {});`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `await qmp(live.qmpPort, 'object-del', { id: objectId }).catch(() => {});`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.locked('launch', () =>
      this.locked(id,
      /**
       * 中文功能：核对在线实例和热插拔目标，在可用 CPU/内存插槽中提交 QEMU 更新并观察客户机上线结果。
       * English: Checks the live VM/hotplug target, applies QEMU updates through available CPU/memory slots and observes guest online results.
       * 所属 / Owner: Machines.hotplug.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       */
      async () => {
        const vm = this.get(id),
          live = this.live.get(id);
        this.requireMutableConfig(vm);
        if (!live || live.status !== 'running') throw new AppError('请先启动发行版', 409);
        signal?.throwIfAborted();
        if (target !== undefined && live.accelerator === 'whpx')
          throw new AppError(
            '当前 Windows QEMU 的 WHPX 热插拔不可靠，请停止后切换到 TCG 兼容模式或离线调整资源',
            409,
            'HOTPLUG_ACCELERATOR_UNSUPPORTED',
          );
        if (kind === 'cpu') {
          const slots = (await qmp(live.qmpPort, 'query-hotpluggable-cpus')) as Array<{
            type: string;
            props: Record<string, number>;
            'qom-path'?: string;
            'vcpus-count': number;
          }>;
          let current = slots
            .filter((slot) => slot['qom-path'])
            .reduce((sum, slot) => sum + slot['vcpus-count'], 0);
          const maximum = slots.reduce((sum, slot) => sum + slot['vcpus-count'], 0);
          const possible = await this.exec(id, 'cat /sys/devices/system/cpu/possible', 10000, signal);
          const guestPossible = possible.code === 0 ? cpuSetSize(possible.stdout) : 0;
          if (target === undefined)
            return {
              kind,
              current,
              maximum,
              slots,
              canAdd: live.accelerator !== 'whpx' && guestPossible > current,
              accelerator: live.accelerator,
              guestPossible,
            };
          if (!Number.isInteger(target) || target <= current || target > maximum || target > 8)
            throw new AppError('仅支持在线增加到预留的 CPU 插槽数量');
          if (guestPossible < target)
            throw new AppError(
              '当前客户机内核没有识别 QEMU 预留的 CPU；请离线调整 CPU 数量，或使用支持当前加速器热插拔的内核',
              409,
              'GUEST_CPU_SLOTS',
            );
          validateAdmission(
            await resourcePolicy(),
            { ...vm, cpus: target },
            [...this.live.keys()].map((key) => this.get(key)),
          );
          const additions = [];
          for (const slot of slots
            .filter((slot) => !slot['qom-path'])
            .sort(
              (a, b) =>
                (a.props['socket-id'] || 0) - (b.props['socket-id'] || 0) ||
                (a.props['core-id'] || 0) - (b.props['core-id'] || 0) ||
                (a.props['thread-id'] || 0) - (b.props['thread-id'] || 0),
            )) {
            if (current === target) break;
            if (current + slot['vcpus-count'] > target) continue;
            additions.push(slot);
            current += slot['vcpus-count'];
          }
          if (current !== target) throw new AppError('目标数量无法匹配可用 CPU 插槽');
          for (const slot of additions) {
            signal?.throwIfAborted();
            await qmp(live.qmpPort, 'device_add', {
              ...slot.props,
              driver: slot.type,
              id: 'sakura-cpu-' + randomUUID(),
            });
            const present = (await qmp(live.qmpPort, 'query-cpus-fast')) as unknown[];
            vm.cpus = present.length;
            await this.save();
          }
          const guest = await this.exec(
            id,
            `set -e; i=0; while [ "$i" -lt 40 ]; do for cpu in /sys/devices/system/cpu/cpu[0-9]*/online; do [ ! -f "$cpu" ] || echo 1 > "$cpu"; done; n=$(grep -c '^processor' /proc/cpuinfo); [ "$n" -lt ${target} ] || { echo "$n"; exit 0; }; i=$((i+1)); sleep 0.25; done; echo "$n"; exit 1`,
            30000,
            signal,
          );
          this.emit('change');
          return {
            kind,
            code: guest.code,
            ready: guest.code === 0,
            current: vm.cpus,
            maximum,
            guestOnline: Number(guest.stdout.trim()) || null,
            guestCode: guest.code,
            ...(guest.code ? { warning: 'CPU 已添加；客户机未确认全部上线：' + guest.stderr } : {}),
          };
        }
        const size = (await qmp(live.qmpPort, 'query-memory-size-summary')) as {
          'base-memory': number;
          'plugged-memory'?: number;
        };
        const devices = (await qmp(live.qmpPort, 'query-memory-devices')) as Array<{
          type: string;
          data: { slot?: number; size?: number; id?: string };
        }>;
        const current = (size['base-memory'] + (size['plugged-memory'] || 0)) / 1024 ** 2;
        const maximum = vm.hardware?.memory?.maxMiB || current;
        if (target === undefined)
          return {
            kind,
            current,
            maximum,
            devices,
            canAdd: live.accelerator !== 'whpx',
            accelerator: live.accelerator,
          };
        if (
          !vm.hardware?.memory ||
          !Number.isInteger(target) ||
          target % 128 ||
          target <= current ||
          target > maximum
        )
          throw new AppError('请先在停止状态预留内存插槽；目标需要按 128 MiB 对齐并大于当前内存');
        validateAdmission(
          await resourcePolicy(),
          { ...vm, memoryMiB: target },
          [...this.live.keys()].map((key) => this.get(key)),
        );
        const used = new Set(devices.map((device) => device.data.slot));
        const slot = Array.from({ length: vm.hardware.memory.slots }, (_, index) => index).find(
          (value) => !used.has(value),
        );
        if (slot === undefined) throw new AppError('没有空闲内存插槽，请停止后调整配置');
        const online = await this.exec(
          id,
          "test -w /sys/devices/system/memory/auto_online_blocks && echo online > /sys/devices/system/memory/auto_online_blocks && awk '/MemTotal:/ { print $2 }' /proc/meminfo",
          15000,
          signal,
        );
        if (online.code) throw new AppError('客户机内核未提供自动上线内存支持');
        const beforeKiB = Number(online.stdout.trim());
        if (!Number.isSafeInteger(beforeKiB) || beforeKiB <= 0) throw new AppError('无法确认客户机当前内存');
        signal?.throwIfAborted();
        const objectId = 'sakura-ram-' + randomUUID();
        await qmp(live.qmpPort, 'object-add', {
          'qom-type': 'memory-backend-ram',
          id: objectId,
          size: (target - current) * 1024 ** 2,
        });
        try {
          await qmp(live.qmpPort, 'device_add', {
            driver: 'pc-dimm',
            id: 'sakura-dimm-' + slot,
            memdev: objectId,
            slot,
          });
        } catch (error) {
          await qmp(live.qmpPort, 'object-del', { id: objectId }).catch(() => {});
          throw error;
        }
        const actual = (await qmp(live.qmpPort, 'query-memory-size-summary')) as typeof size;
        vm.memoryMiB = (actual['base-memory'] + (actual['plugged-memory'] || 0)) / 1024 ** 2;
        await this.save();
        this.emit('change');
        const expectedKiB = Math.floor(beforeKiB + (target - current) * 1024 * 0.95);
        const guest = await this.exec(
          id,
          `i=0; while [ "$i" -lt 40 ]; do n=$(awk '/MemTotal:/ { print $2 }' /proc/meminfo); [ "$n" -lt ${expectedKiB} ] || { echo "$n"; exit 0; }; i=$((i+1)); sleep 0.25; done; echo "$n"; exit 1`,
          30000,
          signal,
        );
        return {
          kind,
          code: guest.code,
          ready: guest.code === 0,
          guestMemoryKiB: Number(guest.stdout.trim()) || null,
          ...(guest.code
            ? { warning: '内存设备已添加；客户机未确认新内存上线，离线重启后使用新增容量。' }
            : {}),
          current: vm.memoryMiB,
          maximum,
          devices: await qmp(live.qmpPort, 'query-memory-devices'),
        };
      }),
    );
  }
  /**
   * 入口 / Entry: Machines.organize.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.locked(id, async () => { const vm = this.get(id), before = vm.organization; vm.organization = organization; try { await …` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `this.locked(id, async () => { const vm = this.get(id), before = vm.organization; vm.organization = organization; try { await …` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `organizationSchema.parse`, `this.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `organizationSchema.parse`, `this.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `this.locked(id, async () => { const vm = this.get(id), before = vm.organization; vm.organization = organization; try { await …`.
   * 副作用 / Effects: 更新 / updates `organization.tags`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async organize(id: string, input: unknown) {
    const organization = organizationSchema.parse(input);
    organization.tags = [...new Set(organization.tags)];
    /**
     * 入口 / Entry: Machines.organize.callback@1649.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(id)`.
     * 副作用 / Effects: `this.save`; `this.emit`; 更新 / updates `vm.organization`.
     * 拒绝 / Refusals: 异常 / errors `error`.
     * 失败处理：catch 分支执行 `vm.organization = before;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `vm.organization = before;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.locked(id, async () => {
      const vm = this.get(id),
        before = vm.organization;
      vm.organization = organization;
      try {
        await this.save();
      } catch (error) {
        vm.organization = before;
        throw error;
      }
      this.emit('change');
      return this.view(id);
    });
  }
  /**
   * 入口 / Entry: Machines.resize.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.locked(id, async () => { const vm = this.get(id); this.requireMutableConfig(vm); this.requireStopped(id); if (diskGiB <=…` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `this.locked(id, async () => { const vm = this.get(id); this.requireMutableConfig(vm); this.requireStopped(id); if (diskGiB <=…` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; diskGiB: number; signal: AbortSignal optional
   * 输出 / Returns: `this.locked(id, async () => { const vm = this.get(id); this.requireMutableConfig(vm); this.requireStopped(id); if (diskGiB <=…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isInteger(diskGiB) || diskGiB > 128`; 异常 / errors `new AppError('磁盘容量必须是 2–128 GiB 的整数')`.
   */
  async resize(id: string, diskGiB: number, signal?: AbortSignal) {
    if (!Number.isInteger(diskGiB) || diskGiB > 128) throw new AppError('磁盘容量必须是 2–128 GiB 的整数');
    /**
     * 入口 / Entry: Machines.resize.callback@1665.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(id)`.
     * 副作用 / Effects: `this.createSnapshot`; `this.save`; `this.emit`; 更新 / updates `shot.diskGiB`, `vm.diskGiB`, `vm.pendingResize`.
     * 拒绝 / Refusals: 条件 / conditions `diskGiB <= vm.diskGiB`; `vm.snapshots.length >= 20`; 异常 / errors `new AppError('仅支持扩容，目标容量必须大于当前容量')`; `new AppError('请先删除一个快照，为扩容前备份留出位置')`.
     */
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireMutableConfig(vm);
      this.requireStopped(id);
      if (diskGiB <= vm.diskGiB) throw new AppError('仅支持扩容，目标容量必须大于当前容量');
      if (vm.snapshots.length >= 20) throw new AppError('请先删除一个快照，为扩容前备份留出位置');
      signal?.throwIfAborted();
      // Before disk growth was supported, all snapshots shared the VM's capacity.
      // Record that size before the first expansion so legacy restores stay accurate.
      for (const shot of vm.snapshots) shot.diskGiB ??= vm.diskGiB;
      await this.createSnapshot(vm, '扩容前自动备份');
      // QEMU metadata updates are allowed to finish even if the request leaves.
      if (vm.diskEncryption)
        await this.withDiskSecret(vm, (file) => this.engine.run('sakura-img', [
          'resize', '--object', qemuSecretObject(file), '--image-opts',
          encryptedImageOptions(join(vmDir(id), 'disk.qcow2')), `${diskGiB}G`,
        ]));
      else await this.engine.run('sakura-img', [
        'resize', '-f', 'qcow2', join(vmDir(id), 'disk.qcow2'), `${diskGiB}G`,
      ]);
      vm.diskGiB = diskGiB;
      vm.pendingResize = true;
      await this.save();
      this.emit('change');
      return this.view(id);
    });
  }
  /**
   * 入口 / Entry: Machines.completeResize.
   * 功能：把本层请求转交 `this.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.locked(id, async () => { const vm = this.get(id); vm.pendingResize = false; await this.save(); this.emit('change'); })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async completeResize(id: string) {
    /**
     * 入口 / Entry: Machines.completeResize.callback@1693.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.save`; `this.emit`; 更新 / updates `vm.pendingResize`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.locked(id, async () => {
      const vm = this.get(id);
      vm.pendingResize = false;
      await this.save();
      this.emit('change');
    });
  }
  /**
   * 入口 / Entry: Machines.requireStopped.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`Machines`）。
   * Purpose: Checks admission, input or resource ownership in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `this.live.has`, `this.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.live.has`, `this.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.live.has(id)`; `this.get(id).liveMigrationFence`; 异常 / errors `new AppError('请先停止发行版，再进行此操作', 409)`; `new AppError('在线迁移来源已设置栅栏，请先完成目标验证与安全回退', 409, 'LIVE_MIGRATION_SOURCE_FENCED')`.
   */
  requireStopped(id: string) {
    if (this.live.has(id)) throw new AppError('请先停止发行版，再进行此操作', 409);
    if (this.get(id).liveMigrationFence)
      throw new AppError('在线迁移来源已设置栅栏，请先完成目标验证与安全回退',
        409, 'LIVE_MIGRATION_SOURCE_FENCED');
  }
  /** Holds the source lock until the read-only attachment's QEMU process has exited. */
  /**
   * 入口 / Entry: Machines.withRescue.
   * 功能：在原停止实例锁内创建有界救援附件，把原磁盘以指定模式交付给救援工作。
   * Purpose: Creates bounded rescue attachments under the stopped source VM lock and exposes its disk in the requested mode.
   * 设计：原磁盘锁一直保持到救援 QEMU 物理退出；截止、锁定和取消共同触发收尾，不能早于退出交还磁盘。
   * Design: The source disk lock remains until rescue QEMU physically exits; deadline/lockdown/cancellation cannot release it prematurely.
   * 输入 / Inputs: sourceId: string; signal: AbortSignal; phase: (text: string) => void; work: (rescueId: string, signal: AbortSignal) => Promise<T>; diagnostic: (text: string) => void default=() => {}; readOnlyDisk: default=join(vmDir(sourceId), 'disk.qcow2'); comparisonDisk: string optional; targetDisk: { file: string; writable: boolean } optional
   * 输出 / Returns: `await this.locked(sourceId, async () => { const source = this.get(sourceId); this.requireStopped(sourceId); if (source.sandbo…`.
   * 副作用 / Effects: `AbortSignal.any`; `AbortSignal.timeout`; `this.rescueControllers.add`; `this.rescueControllers.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `this.off('incident-lockdown', lockdown);`; `this.rescueControllers.delete(controller);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.off('incident-lockdown', lockdown);`; `this.rescueControllers.delete(controller);`; these steps also apply to exceptional exits.
   */
  async withRescue<T>(
    sourceId: string,
    signal: AbortSignal,
    phase: (text: string) => void,
    work: (rescueId: string, signal: AbortSignal) => Promise<T>,
    diagnostic: (text: string) => void = () => {},
    readOnlyDisk = join(vmDir(sourceId), 'disk.qcow2'),
    comparisonDisk?: string,
    targetDisk?: { file: string; writable: boolean },
  ) {
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(35 * 60_000)]);
    this.rescueControllers.add(controller);
    let rescueId: string | undefined;
    /**
     * 入口 / Entry: Machines.withRescue.lockdown.
     * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Machines`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
     * 处理：通过 `controller.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `controller.abort`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `id === sourceId || id === rescueId`.
     * 输入 / Inputs: id: string
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `controller.abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const lockdown = (id: string) => {
      if (id === sourceId || id === rescueId) controller.abort();
    };
    this.on('incident-lockdown', lockdown);
    try {
      /**
       * 入口 / Entry: Machines.withRescue.callback@1726.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `await work(rescueId, combined)`.
       * 副作用 / Effects: `this.createInternal`; `this.startInternal`; `this.deleteInternal`; 更新 / updates `rescueId`.
       * 拒绝 / Refusals: 条件 / conditions `source.sandbox`; `source.diskEncryption`; `this.state(rescueId) !== 'starting' || Date.now() >= deadline`; 异常 / errors `new AppError('救援目标必须是普通实例', 409)`; `new AppError('加密实例的只读救援尚不支持密钥挂载', 409)`.
       * 收尾：退出 try 区域时始终执行 `if (rescueId && this.records.has(rescueId)) { phase('停止并清理临时救援系统'); await this.terminateSandbox(rescueId); // During host clo…`；这些步骤也适用于异常退出。
       * Finalization: Leaving the try region always executes `if (rescueId && this.records.has(rescueId)) { phase('停止并清理临时救援系统'); await this.terminateSandbox(rescueId); // During host clo…`; these steps also apply to exceptional exits.
       */
      return await this.locked(sourceId, async () => {
        const source = this.get(sourceId);
        this.requireStopped(sourceId);
        if (source.sandbox) throw new AppError('救援目标必须是普通实例', 409);
        if (source.diskEncryption)
          throw new AppError('加密实例的只读救援尚不支持密钥挂载', 409);
        combined.throwIfAborted();
        try {
          phase('创建临时救援系统');
          const rescue = await this.createInternal(
            {
              name: 'rescue-' + randomUUID().slice(0, 12),
              distro: 'alpine',
              memoryMiB: 512,
              cpus: 1,
              diskGiB: 4,
              accelerator: source.accelerator,
              forwards: [],
              template: 'none',
            },
            {
              network: 'isolated',
              storage: 'discard-on-stop',
              onExpire: 'delete',
              expiresAt: new Date(Date.now() + 40 * 60_000).toISOString(),
            },
            sourceId,
          );
          rescueId = rescue.id;
          combined.throwIfAborted();
          phase('启动临时救援系统');
          await this.startInternal(rescueId, sourceId);
          const deadline = Date.now() + BOOT_TIMEOUT_MS;
          while (this.state(rescueId) !== 'running') {
            combined.throwIfAborted();
            if (this.state(rescueId) !== 'starting' || Date.now() >= deadline) {
              diagnostic((this.logs.get(rescueId) || '').slice(-8000));
              throw new AppError('临时救援系统启动失败，启动日志已附在任务记录', 409);
            }
            await delay(100, undefined, { signal: combined });
          }
          combined.throwIfAborted();
          this.requireUnlocked(sourceId);
          this.requireStopped(sourceId);
          phase('只读连接源磁盘');
          const port = this.live.get(rescueId)!.qmpPort;
          // Attach only after boot: the source may share the rescue image's filesystem UUID.
          /**
           * 入口 / Entry: Machines.withRescue.attach.
           * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Machines`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
           * 处理：通过 `qmp`, `combined.throwIfAborted`, `nodes.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `qmp`, `combined.throwIfAborted`, `nodes.some`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: file: string; role: 'source' | 'compare' | 'target'; writable: default=false
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 拒绝 / Refusals: 条件 / conditions `!Array.isArray(nodes) || !nodes.some((entry) => entry['node-name'] === node && entry.ro === !writable)`; 异常 / errors `new AppError(writable ? '救援磁盘未确认读写，已终止任务' : '救援磁盘未确认只读，已终止任务', 409)`.
           */
          const attach = async (file: string, role: 'source' | 'compare' | 'target', writable = false) => {
            const node = `sakura-rescue-${role}`;
            await qmp(port, 'blockdev-add', {
              driver: 'qcow2',
              'node-name': node,
              'read-only': !writable,
              file: { driver: 'file', filename: file, 'read-only': !writable },
            });
            combined.throwIfAborted();
            await qmp(port, 'device_add', {
              driver: 'virtio-blk-pci',
              drive: node,
              id: `sakura-rescue-${role === 'source' ? 'disk' : role + '-disk'}`,
              bus: role === 'source' ? 'sakura-rescue-port' :
                role === 'compare' ? 'sakura-rescue-compare-port' : 'sakura-rescue-target-port',
              serial: `sakura-${role}`,
            });
            const nodes = (await qmp(port, 'query-named-block-nodes')) as {
              'node-name': string;
              ro: boolean;
            }[];
            if (
              !Array.isArray(nodes) ||
              !nodes.some((entry) => entry['node-name'] === node && entry.ro === !writable)
            )
              throw new AppError(writable ? '救援磁盘未确认读写，已终止任务' :
                '救援磁盘未确认只读，已终止任务', 409);
          };
          await attach(readOnlyDisk, 'source');
          if (comparisonDisk) await attach(comparisonDisk, 'compare');
          if (targetDisk) await attach(targetDisk.file, 'target', targetDisk.writable);
          combined.throwIfAborted();
          return await work(rescueId, combined);
        } finally {
          if (rescueId && this.records.has(rescueId)) {
            phase('停止并清理临时救援系统');
            await this.terminateSandbox(rescueId);
            // During host close, init will clean the expired rescue record next time.
            if (!this.closing) await this.deleteInternal(rescueId, true);
          }
        }
      });
    } finally {
      this.off('incident-lockdown', lockdown);
      this.rescueControllers.delete(controller);
    }
  }
  /**
   * 入口 / Entry: Machines.diskIdentity.
   * 功能：把本层请求转交 `this.snapshots.identity`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.snapshots.identity` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; snapshotId: string optional
   * 输出 / Returns: `this.snapshots.identity(id, snapshotId)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async diskIdentity(id: string, snapshotId?: string) { return this.snapshots.identity(id, snapshotId); }
  /**
   * 入口 / Entry: Machines.snapshotIdentity.
   * 功能：把本层请求转交 `this.snapshots.snapshotIdentity`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.snapshots.snapshotIdentity` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; snapshotId: string optional
   * 输出 / Returns: `this.snapshots.snapshotIdentity(id, snapshotId)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async snapshotIdentity(id: string, snapshotId?: string) { return this.snapshots.snapshotIdentity(id, snapshotId); }
  /**
   * 入口 / Entry: Machines.vmStateFingerprint.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(JSON.stringify({ version, accelerator, architecture: vm.architecture || 'x86_64', networkBackend:…` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `createHash('sha256').update(JSON.stringify({ version, accelerator, architecture: vm.architecture || 'x86_64', networkBackend:…` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `qmp`, `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `qmp`, `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vm: VMRecord; qmpPort: number; accelerator: string
   * 输出 / Returns: `createHash('sha256').update(JSON.stringify({ version, accelerator, architecture: vm.architecture || 'x86_64', networkBackend:…`.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async vmStateFingerprint(vm: VMRecord, qmpPort: number, accelerator: string) {
    // The command-line QMP listener serves one client at a time.
    const version = await qmp(qmpPort, 'query-version');
    const cpuSlots = await qmp(qmpPort, 'query-hotpluggable-cpus');
    const memorySize = await qmp(qmpPort, 'query-memory-size-summary');
    const memoryDevices = await qmp(qmpPort, 'query-memory-devices');
    return createHash('sha256').update(JSON.stringify({
      version, accelerator, architecture: vm.architecture || 'x86_64',
      networkBackend: 'sakura-managed-user-v1',
      ...(vm.architecture === 'aarch64' ? {} : { cpuModel: qemuCpuModel(vm.architecture) }),
      distro: vm.distro || 'alpine', firmware: vm.firmware || 'bios',
      memoryMiB: vm.memoryMiB, cpus: vm.cpus, diskGiB: vm.diskGiB,
      hardware: vm.hardware || null, cpuSlots, memorySize, memoryDevices,
    })).digest('hex');
  }
  /**
   * 入口 / Entry: Machines.createSnapshot.
   * 功能：把本层请求转交 `this.snapshots.capture`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.snapshots.capture` and propagates the provider result or rejection.
   * 输入 / Inputs: vm: VMRecord; name: string; onlinePort: number optional; stateFingerprint: string optional
   * 输出 / Returns: `this.snapshots.capture(vm, name, onlinePort, stateFingerprint)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async createSnapshot(vm: VMRecord, name: string, onlinePort?: number, stateFingerprint?: string) {
    return this.snapshots.capture(vm, name, onlinePort, stateFingerprint);
  }
  /**
   * 入口 / Entry: Machines.snapshot.
   * 功能：把本层请求转交 `this.snapshots.snapshot`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.snapshots.snapshot` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; name: string
   * 输出 / Returns: `this.snapshots.snapshot(id, name)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async snapshot(id: string, name: string) { return this.snapshots.snapshot(id, name); }
  /**
   * 入口 / Entry: Machines.onlineSnapshot.
   * 功能：把本层请求转交 `this.transition`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.transition` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; name: string
   * 输出 / Returns: `this.transition(id, async () => { const vm = this.get(id); const live = this.live.get(id); if (!live || live.status !== 'runn…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async onlineSnapshot(id: string, name: string) {
    /**
     * 入口 / Entry: Machines.onlineSnapshot.callback@1842.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.transition）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.transition).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `result!`.
     * 副作用 / Effects: `GuestAgent.connect`; `agent.execute`; `agent.close`; `this.createSnapshot`; `this.stopInternal().catch`; 更新 / updates `agent`, `freezeAttempted`, `freezeCount`, `result`.
     * 拒绝 / Refusals: 条件 / conditions `!live || live.status !== 'running'`; `vm.sandbox?.storage === 'discard-on-stop'`; `vm.snapshots.length >= 20`; 异常 / errors `new AppError('在线快照要求实例正在运行', 409)`; `new AppError('临时写时复制实例不能保存在线快照', 409)`.
     * 收尾：退出 try 区域时始终执行 `if (freezeAttempted) { try { const thawed = await agent.execute('guest-fsfreeze-thaw', undefined, 30000); if (freezeCount > 0…`; `agent.close();`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `if (freezeAttempted) { try { const thawed = await agent.execute('guest-fsfreeze-thaw', undefined, 30000); if (freezeCount > 0…`; `agent.close();`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `agent?.close();`; `throw new AppError(`客户机代理不可用；请在 Linux 内安装并启动 qemu-guest-agent：${String((error as Error).message || error)}`, 409);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `agent?.close();`; `throw new AppError(`客户机代理不可用；请在 Linux 内安装并启动 qemu-guest-agent：${String((error as Error).message || error)}`, 409);`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.transition(id, async () => {
      const vm = this.get(id);
      const live = this.live.get(id);
      if (!live || live.status !== 'running') throw new AppError('在线快照要求实例正在运行', 409);
      if (vm.sandbox?.storage === 'discard-on-stop')
        throw new AppError('临时写时复制实例不能保存在线快照', 409);
      if (vm.snapshots.length >= 20) throw new AppError('最多保留 20 个磁盘快照');
      await this.trustedBootSnapshot?.ensureOnlineAllowed(id);
      let agent: GuestAgent | undefined;
      try {
        agent = await GuestAgent.connect(live.agentPort);
        await agent.execute('guest-ping', undefined, 5000);
      } catch (error) {
        agent?.close();
        throw new AppError(`客户机代理不可用；请在 Linux 内安装并启动 qemu-guest-agent：${String((error as Error).message || error)}`, 409);
      }
      let freezeAttempted = false;
      let freezeCount = 0;
      let failure: unknown;
      let result: Awaited<ReturnType<typeof this.createSnapshot>> | undefined;
      try {
        freezeAttempted = true;
        const count = await agent.execute('guest-fsfreeze-freeze', undefined, 30000);
        if (typeof count !== 'number' || count < 1)
          throw new AppError('客户机代理未冻结任何文件系统，已取消在线快照', 409);
        freezeCount = count;
        result = await this.createSnapshot(vm, name, live.qmpPort);
      } catch (error) {
        failure = error;
      } finally {
        if (freezeAttempted) {
          try {
            const thawed = await agent.execute('guest-fsfreeze-thaw', undefined, 30000);
            if (freezeCount > 0 && (typeof thawed !== 'number' || thawed < freezeCount))
              throw new Error(`仅解冻 ${String(thawed)} / ${freezeCount} 个文件系统`);
          } catch (error) {
            failure = new AppError(`文件系统解冻失败，实例将停止以解除冻结：${String((error as Error).message || error)}`, 500);
            await this.stopInternal(id, true).catch(() => {});
          }
        }
        agent.close();
      }
      if (failure) throw failure;
      return result!;
    });
  }
  /**
   * 入口 / Entry: Machines.memorySnapshot.
   * 功能：把本层请求转交 `this.transition`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.transition` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; name: string
   * 输出 / Returns: `this.transition(id, async () => { this.requireMigrationRunAllowed(id); const vm = this.get(id); const live = this.live.get(id…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async memorySnapshot(id: string, name: string) {
    /**
     * 入口 / Entry: Machines.memorySnapshot.callback@1889.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.transition）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.transition).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.createSnapshot(vm, name, live.qmpPort, fingerprint)`.
     * 副作用 / Effects: `this.createSnapshot`.
     * 拒绝 / Refusals: 条件 / conditions `!live || live.status !== 'running'`; `vm.rescueOf`; `live.accelerator !== 'tcg'`; 异常 / errors `new AppError('整机状态快照要求实例正在运行', 409)`; `new AppError('临时救援实例不能保存整机状态', 409)`.
     */
    return this.transition(id, async () => {
      this.requireMigrationRunAllowed(id);
      const vm = this.get(id);
      const live = this.live.get(id);
      if (!live || live.status !== 'running')
        throw new AppError('整机状态快照要求实例正在运行', 409);
      if (vm.rescueOf) throw new AppError('临时救援实例不能保存整机状态', 409);
      if (live.accelerator !== 'tcg')
        throw new AppError('当前 WHPX 无法保存 RAM 状态；请停机后将加速器切换为 TCG', 409);
      if (vm.sandbox?.storage === 'discard-on-stop' || vm.diskEncryption ||
          vm.firmware === 'uefi')
        throw new AppError('当前实例的临时磁盘、加密磁盘或 UEFI NVRAM 不支持整机状态快照', 409);
      if (vm.snapshots.length >= 20) throw new AppError('最多保留 20 个快照');
      const fingerprint = await this.vmStateFingerprint(vm, live.qmpPort, live.accelerator);
      return this.createSnapshot(vm, name, live.qmpPort, fingerprint);
    });
  }
  /**
   * 入口 / Entry: Machines.restoreMemory.
   * 功能：把本层请求转交 `this.transition`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.transition` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; snapshotId: string; backup: default=false
   * 输出 / Returns: `this.transition(id, async () => { this.requireMigrationRunAllowed(id); const vm = this.get(id); const shot = vm.snapshots.fin…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async restoreMemory(id: string, snapshotId: string, backup = false) {
    /**
     * 入口 / Entry: Machines.restoreMemory.callback@1907.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.transition）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.transition).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(id)`.
     * 副作用 / Effects: `this.createSnapshot`; `this.emit`; `live.network.setConnected`; `live.network.close`; `lifetime.setNetwork`; 更新 / updates `live.status`, `live.network`, `this.live.get(id)!.status`.
     * 拒绝 / Refusals: 条件 / conditions `!shot || shot.consistency !== 'vmstate' || !shot.stateFingerprint`; `!live || live.status !== 'running'`; `live.accelerator !== 'tcg'`; 异常 / errors `new AppError('整机状态快照不存在', 404)`; `new AppError('请先启动实例，再恢复整机状态', 409)`.
     * 收尾：退出 try 区域时始终执行 `this.emit('change');`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `this.emit('change');`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `if (this.live.get(id)?.abort === live.abort) await this.stopInternal(id, true).catch(() => {});`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (this.live.get(id)?.abort === live.abort) await this.stopInternal(id, true).catch(() => {});`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.transition(id, async () => {
      this.requireMigrationRunAllowed(id);
      const vm = this.get(id);
      const shot = vm.snapshots.find((item) => item.id === snapshotId);
      if (!shot || shot.consistency !== 'vmstate' || !shot.stateFingerprint)
        throw new AppError('整机状态快照不存在', 404);
      const live = this.live.get(id);
      if (!live || live.status !== 'running')
        throw new AppError('请先启动实例，再恢复整机状态', 409);
      if (live.accelerator !== 'tcg')
        throw new AppError('当前 WHPX 无法恢复 RAM 状态；请停机后将加速器切换为 TCG', 409);
      if (vm.sandbox?.storage === 'discard-on-stop' || vm.diskEncryption ||
          vm.firmware === 'uefi')
        throw new AppError('当前实例的临时磁盘、加密磁盘或 UEFI NVRAM 不支持整机状态恢复', 409);
      const fingerprint = await this.vmStateFingerprint(vm, live.qmpPort, live.accelerator);
      if (fingerprint !== shot.stateFingerprint)
        throw new AppError('QEMU 版本或实例硬件已变化，拒绝恢复不兼容的 RAM 状态', 409);
      const [currentIdentity, snapshotIdentity] = await Promise.all([
        this.diskIdentity(id), this.diskIdentity(id, snapshotId),
      ]);
      if (currentIdentity.key !== snapshotIdentity.key ||
          !currentIdentity.seed.equals(snapshotIdentity.seed) ||
          currentIdentity.pending !== snapshotIdentity.pending)
        throw new AppError('实例控制身份或初始化镜像已变化，拒绝加载不匹配的整机状态', 409);
      if (backup) {
        if (vm.snapshots.length >= 20)
          throw new AppError('请先删除一个旧快照，为恢复前备份留出位置', 409);
        await this.createSnapshot(vm, '恢复前整机状态自动备份', live.qmpPort, fingerprint);
      }
      // Block new SSH work while network and RAM move to the restored generation.
      live.status = 'paused';
      const lifetime = vmLifetime(id, live);
      lifetime.advanceExecution();
      this.emit('change');
      try {
        if (live.network) {
          // Isolate Ethernet while changing generations. Let snapshot-load own the
          // CPU pause/resume transition, preserving QEMU's running-state restore path.
          await live.network.setConnected(false);
          live.network = await live.network.renew(randomUUID());
          if (live.abort.signal.aborted || this.live.get(id)?.abort !== live.abort) {
            await live.network.close();
            throw new AppError('实例在恢复网络期间已退出', 409);
          }
          await lifetime.setNetwork(live.network);
        }
        // Keep compatibility checks in callers that pin the Live object, even without a NIC.
        const restored = { ...live, serialConnected: false };
        this.live.set(id, restored);
        live.serial?.destroy();
        if (live.network) this.connectSerial(id, restored);
        for (const client of live.clients) client.destroy();
        await qmpSnapshotJob(live.qmpPort, 'snapshot-load', shot.id);
        const status = await qmp(live.qmpPort, 'query-status');
        if (!status || typeof status !== 'object' ||
            (status as { running?: boolean }).running !== true)
          throw new AppError('整机状态已加载，但客户机尚未恢复运行，请检查实例', 409);
        await live.network?.setConnected(true);
        if (live.abort.signal.aborted || this.live.get(id)?.abort !== live.abort) {
          await live.network?.close();
          throw new AppError('实例在恢复网络期间已退出', 409);
        }
        this.live.get(id)!.status = 'running';
      } catch (error) {
        // A partially restored guest must never regain network access implicitly.
        if (this.live.get(id)?.abort === live.abort)
          await this.stopInternal(id, true).catch(() => {});
        throw error;
      } finally { this.emit('change'); }
      return this.view(id);
    });
  }
  /**
   * 入口 / Entry: Machines.restore.
   * 功能：把本层请求转交 `this.snapshots.restore`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.snapshots.restore` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; snapshotId: string; backup: default=false
   * 输出 / Returns: `this.snapshots.restore(id, snapshotId, backup)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async restore(id: string, snapshotId: string, backup = false) { return this.snapshots.restore(id, snapshotId, backup); }
  /**
   * 入口 / Entry: Machines.fingerprint.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ recordHash: metadata.digest('hex'), diskSize: disk.size, diskMtimeMs: disk.mtimeMs }` 供上层消费（`Machines`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; this entry produces `{ recordHash: metadata.digest('hex'), diskSize: disk.size, diskMtimeMs: disk.mtimeMs }` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `vmDir`, `stat`, `join`, `disk.isFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `vmDir`, `stat`, `join`, `disk.isFile`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.trustedBootStateFingerprint`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<MigrationFingerprint>；结果来自 / values from `{ recordHash: metadata.digest('hex'), diskSize: disk.size, diskMtimeMs: disk.mtimeMs }`.
   * 副作用 / Effects: `createHash().update`; `createHash`; `metadata.update().update().update`; `metadata.update().update`; `metadata.update`.
   * 拒绝 / Refusals: 条件 / conditions `!disk.isFile()`; 异常 / errors `new AppError('实例磁盘文件无效', 409)`.
   */
  private async fingerprint(id: string): Promise<MigrationFingerprint> {
    const dir = vmDir(id);
    const disk = await stat(join(dir, 'disk.qcow2'));
    if (!disk.isFile()) throw new AppError('实例磁盘文件无效', 409);
    const metadata = createHash('sha256').update(JSON.stringify(this.get(id)));
    const names = (await readdir(dir)).filter((name) =>
      ['id_rsa', 'seed.iso', 'project.json', 'projects.json'].includes(name) ||
      /^project-[a-f0-9]{16}\.json$/.test(name)).sort();
    for (const name of names) {
      const contents = await readFile(join(dir, name));
      metadata.update(name).update(String(contents.length)).update(contents);
    }
    if (this.trustedBootStateFingerprint)
      metadata.update(await this.trustedBootStateFingerprint(id));
    return { recordHash: metadata.digest('hex'),
      diskSize: disk.size, diskMtimeMs: disk.mtimeMs };
  }
  /**
   * 入口 / Entry: Machines.migrationFingerprint.
   * 功能：把本层请求转交 `this.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.locked(id, async () => { this.requireStopped(id); return this.fingerprint(id); })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async migrationFingerprint(id: string) {
    return this.locked(id, async () => {
      this.requireStopped(id);
      return this.fingerprint(id);
    });
  }
  /**
   * 入口 / Entry: Machines.moveStoragePool.
   * 功能：把本层请求转交 `this.storagePlacement.moveStoragePool`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.storagePlacement.moveStoragePool` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; targetPoolId: string; signal: AbortSignal optional; log: (text: string) => void default=() => {}
   * 输出 / Returns: `this.storagePlacement.moveStoragePool(id, targetPoolId, signal, log)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async moveStoragePool(id: string, targetPoolId: string, signal?: AbortSignal, log: (text: string) => void = () => {}) {
    return this.storagePlacement.moveStoragePool(id, targetPoolId, signal, log);
  }
  /**
   * 入口 / Entry: Machines.delete.
   * 功能：把本层请求转交 `this.deleteInternal`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.deleteInternal` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; expected: MigrationFingerprint optional
   * 输出 / Returns: `this.deleteInternal(id, false, expected)`.
   * 副作用 / Effects: `this.deleteInternal`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async delete(id: string, expected?: MigrationFingerprint) {
    return this.deleteInternal(id, false, expected);
  }
  /**
   * 入口 / Entry: Machines.deleteInternal.
   * 功能：把本层请求转交 `this.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; allowIncident: default=false; expected: MigrationFingerprint optional
   * 输出 / Returns: `this.locked('storage-pools', () => this.locked( id, async () => { this.get(id); this.requireStopped(id); if (this.storagePool…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async deleteInternal(id: string, allowIncident = false,
    expected?: MigrationFingerprint) {
    /**
     * 入口 / Entry: Machines.deleteInternal.callback@2013.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.records.delete`; `this.logs.delete`; `this.save`; `this.migrationRuns.delete`; `this.migrationCompletions.delete`.
     * 拒绝 / Refusals: 条件 / conditions `this.storagePools.hasPendingCleanup(id)`; `expected`; `current.recordHash !== expected.recordHash || current.diskSize !== expected.diskSize || current.diskMtimeMs !== expected.disk…`; 异常 / errors `new AppError('请先清理存储池迁移的旧副本，再删除实例', 409)`; `new AppError('源实例在迁移后已变化，保留源实例，请重新预览', 409)`.
     */
    return this.locked('storage-pools', () => this.locked(
      id,
      /**
       * 中文功能：要求停止、无旧池清理且迁移指纹未变；见证仍登记时拒绝，删除目录并保存移除后清理运行映射。
       * English: Requires stopped state, no old-pool cleanup and unchanged migration fingerprint; refuses enrolled witnesses, deletes storage/persists removal and clears run mappings.
       * 所属 / Owner: Machines.deleteInternal.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       */
      async () => {
        this.get(id);
        this.requireStopped(id);
        if (this.storagePools.hasPendingCleanup(id))
          throw new AppError('请先清理存储池迁移的旧副本，再删除实例', 409);
        if (expected) {
          const current = await this.fingerprint(id);
          if (current.recordHash !== expected.recordHash ||
              current.diskSize !== expected.diskSize ||
              current.diskMtimeMs !== expected.diskMtimeMs)
            throw new AppError('源实例在迁移后已变化，保留源实例，请重新预览', 409);
        }
        const vm = this.get(id);
        if (vm.haWitnessEnrollment)
          throw new AppError('请先在故障接管策略中撤销见证登记，再删除实例',
            409, 'HA_WITNESS_ENROLLED');
        await this.removeVmDirectory(vm);
        this.records.delete(id);
        this.logs.delete(id);
        await this.save();
        this.storagePools.unbind(id);
        this.migrationRuns.delete(id);
        this.migrationCompletions.delete(id);
      },
      allowIncident,
    ));
  }
  /**
   * 入口 / Entry: Machines.editSnapshot.
   * 功能：把本层请求转交 `this.snapshots.editSnapshot`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.snapshots.editSnapshot` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; snapshotId: string; patch: { name: string; note: string } | null
   * 输出 / Returns: `this.snapshots.editSnapshot(id, snapshotId, patch)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async editSnapshot(id: string, snapshotId: string, patch: { name: string; note: string } | null) {
    return this.snapshots.editSnapshot(id, snapshotId, patch);
  }
  /**
   * 入口 / Entry: Machines.setForwards.
   * 功能：把本层请求转交 `this.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; input: unknown; expected: VMConfig['forwards'] optional
   * 输出 / Returns: `this.locked('launch', () => this.locked(id, async () => { const vm = this.get(id); this.requireMutableConfig(vm); if (expecte…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async networkIsolation(id: string, createdAt: string, startedAt: string, isolated?: boolean, expiresAt?: number) {
    return this.locked(`bounded-network:${id}`, async () => {
      const vm = this.get(id), live = this.live.get(id);
      if (vm.createdAt !== createdAt || !live?.network || live.startedAt !== startedAt || live.abort.signal.aborted)
        throw new AppError('出站策略的实例运行身份已改变', 409);
      if (vm.managedNetwork !== 'isolated' && vm.sandbox?.network !== 'isolated')
        throw new AppError('有限出站策略要求实例默认隔离', 409);
      if (!live.network.setIsolation || !live.network.observeIsolation) throw new AppError('网络后端不支持有限出站策略', 409);
      if (isolated === false && (!Number.isFinite(expiresAt) || expiresAt! <= Date.now() || expiresAt! > Date.now() + 86400000))
        throw new AppError('出站策略必须具有 24 小时以内的绝对期限', 409);
      const state = isolated === undefined ? await live.network.observeIsolation() : await live.network.setIsolation(isolated, expiresAt);
      if (this.live.get(id) !== live) throw new AppError('策略切换期间实例身份变化', 409);
      return state;
    });
  }
  async isolateStopped(id: string, createdAt: string) {
    return this.locked(id, async () => {
      this.requireStopped(id);
      this.requireUnlocked(id);
      const vm = this.get(id);
      if (vm.createdAt !== createdAt) throw new AppError('恢复副本创建身份已改变', 409);
      vm.managedNetwork = 'isolated';
      await this.save();
      return this.view(id);
    });
  }
  async setForwards(id: string, input: unknown, expected?: VMConfig['forwards']) {
    /**
     * 入口 / Entry: Machines.setForwards.callback@2045.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(id)`.
     * 副作用 / Effects: `createSchema.parse`; `taken.push`; `applied.push`; `this.save`; `this.emit`; 更新 / updates `rollback`, `vm.forwards`.
     * 拒绝 / Refusals: 条件 / conditions `expected && JSON.stringify(vm.forwards) !== JSON.stringify(expected)`; `otherId !== id && this.live.has(otherId) && other.forwards.some((p) => parsed.some((n) => n.host === p.host))`; `live && live.status !== 'running'`; 异常 / errors `new AppError('端口映射已变化，请重新预览', 409)`; `new AppError('主机端口已被其他运行中的实例使用', 409)`.
     * 失败处理：catch 分支执行 `await rollback();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `await rollback();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.locked('launch', () =>
      this.locked(id,
      /**
       * 中文功能：校验预期端口与全局冲突，在线逐项增删统一网络映射，保存新配置；请求或保存失败回滚已应用变更。
       * English: Checks expected forwards/global conflicts, changes live unified-network forwards incrementally and saves configuration, rolling back applied changes on request/save failure.
       * 所属 / Owner: Machines.setForwards.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       */
      async () => {
        const vm = this.get(id);
        this.requireMutableConfig(vm);
        if (expected && JSON.stringify(vm.forwards) !== JSON.stringify(expected))
          throw new AppError('端口映射已变化，请重新预览', 409);
        const previous = vm.forwards;
        /**
         * 入口 / Entry: Machines.setForwards.rollback.
         * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Machines`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         */
        let rollback = async () => {};
        const parsed = createSchema.parse({ name: vm.name, forwards: input }).forwards;
        this.requireUnreservedPorts(parsed);
        for (const [otherId, other] of this.records) {
          if (
            otherId !== id &&
            this.live.has(otherId) &&
            other.forwards.some((p) => parsed.some((n) => n.host === p.host))
          )
            throw new AppError('主机端口已被其他运行中的实例使用', 409);
        }
        const live = this.live.get(id);
        if (live && live.status !== 'running') throw new AppError('请等待实例启动或停止完成', 409);
        if (live) {
          const removed = vm.forwards.filter(
            (p) => !parsed.some((n) => n.host === p.host && n.guest === p.guest),
          );
          const added = parsed.filter(
            (p) => !vm.forwards.some((n) => n.host === p.host && n.guest === p.guest),
          );
          const applied: typeof parsed = [],
            taken: typeof parsed = [];
          /**
           * 入口 / Entry: Machines.setForwards.command.
           * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Machines`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
           * 处理：通过 `live.network.forward` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `live.network.forward`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: verb: 'add' | 'remove'; p: (typeof parsed)[number]
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 拒绝 / Refusals: 条件 / conditions `!live.network`; 异常 / errors `new AppError('实例缺少统一网络租约', 503)`.
           */
          const command = async (verb: 'add' | 'remove', p: (typeof parsed)[number]) => {
            if (!live.network) throw new AppError('实例缺少统一网络租约', 503);
            await live.network.forward(verb, p);
          };
          /**
           * 入口 / Entry: Machines.setForwards.rollback.
           * 功能：在管理虚拟机目录、运行生命周期与领域端口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Machines`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `Machines`; the calls and state transitions below complete the operation. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
           * 处理：通过 `inline.reverse`, `command().catch`, `command`, `failures.join` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `inline.reverse`, `command().catch`, `command`, `failures.join`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 拒绝 / Refusals: 条件 / conditions `failures.length`; 异常 / errors `new AppError('端口修改失败，回滚未完成：' + failures.join('；'), 409)`.
           */
          rollback = async () => {
            const failures: string[] = [];
            for (const p of [...applied].reverse())
              await command('remove', p).catch((error) => failures.push(String(error)));
            for (const p of taken) await command('add', p).catch((error) => failures.push(String(error)));
            if (failures.length) throw new AppError('端口修改失败，回滚未完成：' + failures.join('；'), 409);
          };
          try {
            for (const p of removed) {
              await command('remove', p);
              taken.push(p);
            }
            for (const p of added) {
              await command('add', p);
              applied.push(p);
            }
          } catch (error) {
            await rollback();
            throw error;
          }
        }
        vm.forwards = parsed;
        try {
          await this.save();
        } catch (error) {
          vm.forwards = previous;
          await rollback();
          throw error;
        }
        this.emit('change');
        return this.view(id);
      }),
    );
  }
  /**
   * 入口 / Entry: Machines.setMemoryTarget.
   * 功能：把本层请求转交 `this.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; memoryMiB: number
   * 输出 / Returns: `this.locked(id, async () => { const vm = this.get(id), live = this.live.get(id); if (!live || live.status !== 'running') thro…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async setMemoryTarget(id: string, memoryMiB: number) {
    /**
     * 入口 / Entry: Machines.setMemoryTarget.callback@2112.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(id)`.
     * 副作用 / Effects: `this.emit`; 更新 / updates `live.memoryTargetMiB`.
     * 拒绝 / Refusals: 条件 / conditions `!live || live.status !== 'running'`; `!Number.isInteger(memoryMiB) || memoryMiB < 256 || memoryMiB > vm.memoryMiB`; 异常 / errors `new AppError('请先启动发行版', 409)`; `new AppError(`动态内存目标必须在 256 MiB 到 ${vm.memoryMiB} MiB 之间`)`.
     */
    return this.locked(id, async () => {
      const vm = this.get(id),
        live = this.live.get(id);
      if (!live || live.status !== 'running') throw new AppError('请先启动发行版', 409);
      if (!Number.isInteger(memoryMiB) || memoryMiB < 256 || memoryMiB > vm.memoryMiB)
        throw new AppError(`动态内存目标必须在 256 MiB 到 ${vm.memoryMiB} MiB 之间`);
      await qmp(live.qmpPort, 'balloon', { value: memoryMiB * 1024 * 1024 });
      live.memoryTargetMiB = memoryMiB;
      this.emit('change');
      return this.view(id);
    });
  }
  // Provision a converted cloud image with a new controller identity on its first boot.
  /**
   * 入口 / Entry: Machines.importDisk.
   * 功能：把本层请求转交 `this.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: input: unknown; disk: string; options: { signal?: AbortSignal; pendingResize?: boolean; storage?: StorageLease } default={}
   * 输出 / Returns: `this.locked('storage-pools', () => this.locked('create', async () => { const { signal, pendingResize } = options; const confi…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async importDisk(
    input: unknown,
    disk: string,
    options: { signal?: AbortSignal; pendingResize?: boolean; storage?: StorageLease; sandbox?: SandboxPolicy; network?: 'isolated' | 'nat'; record?: (vm: Pick<VMRecord, 'id' | 'createdAt'>) => Promise<void> } = {},
  ) {
    /**
     * 入口 / Entry: Machines.importDisk.callback@2130.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked / create）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked / create).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `withStorageLease({ owner: 'core:disk-adoption', taskId: 'disk-adoption:' + vm.id, label: 'Publish imported disk', mode: 'writ…`.
     * 副作用 / Effects: `createSchema.parse`.
     * 拒绝 / Refusals: 条件 / conditions `!config.distro || (config.template && config.template !== 'none')`; `config.memoryMiB < image.minimumMemory || config.diskGiB < image.minimumDisk`; `this.records.size >= 32 || [...this.records.values()].some((vm) => vm.name === config.name)`; 异常 / errors `new AppError('导入镜像需要选择 Linux 发行版，且不能自动安装模板')`; `new AppError( `${image.name} 至少需要 ${image.minimumMemory} MiB 内存、${image.minimumDisk} GiB 磁盘`, )`.
     */
    return this.locked('storage-pools', () => this.locked('create',
    /**
     * 中文功能：校验导入实例配置和容量，创建新的密钥/seed 并复制磁盘，保存后释放临时预算，失败移除记录与目录。
     * English: Validates imported VM configuration/capacity, creates new keys/seed and copies the disk, releasing temporary budget after save and removing records/storage on failure.
     * 所属 / Owner: Machines.importDisk.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     */
    async () => {
      const { signal, pendingResize } = options;
      const sandbox = options.sandbox ? sandboxPolicySchema.parse(options.sandbox) : undefined;
      if (sandbox && sandboxExpired(sandbox)) throw new AppError('镜像实例期限必须晚于当前时间');
      const config = createSchema.parse(input);
      if (config.firmware === 'uefi') await requireUefiSupport(config.architecture);
      if (!config.distro || (config.template && config.template !== 'none'))
        throw new AppError('导入镜像需要选择 Linux 发行版，且不能自动安装模板');
      const image = distroInfo(config.distro, config.architecture);
      if (config.memoryMiB < image.minimumMemory || config.diskGiB < image.minimumDisk)
        throw new AppError(
          `${image.name} 至少需要 ${image.minimumMemory} MiB 内存、${image.minimumDisk} GiB 磁盘`,
        );
      if (this.records.size >= 32 || [...this.records.values()].some((vm) => vm.name === config.name))
        throw new AppError('名称已存在或已达到 32 个实例上限', 409);
      const vm: VMRecord = {
        ...config,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        snapshots: [],
        bootstrapped: false,
        pendingResize: !!pendingResize,
        ...(sandbox ? { sandbox } : {}),
        ...(options.network ? { managedNetwork: z.enum(['isolated', 'nat']).parse(options.network) } : {}),
      };
      if (sandbox && config.forwards.length) throw new AppError('镜像沙箱不允许额外端口转发');
      await options.record?.(vm);
      const destination = this.storagePools.directory(vm.id, vm.storagePoolId || 'default');
      /**
       * 入口 / Entry: Machines.importDisk.callback@2154.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（withStorageLease）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (withStorageLease).
       * 输入 / Inputs: lease
       * 输出 / Returns: `this.view(vm.id)`.
       * 副作用 / Effects: `createSshKey`; `createReadStream`; `createWriteStream`; `writeFile`; `this.records.set`; 更新 / updates `saved`.
       * 拒绝 / Refusals: 异常 / errors `cleanup`; `error`.
       * 失败处理：catch 分支执行 `this.records.delete(vm.id);`; `if (saved) await this.save();`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `this.records.delete(vm.id);`; `if (saved) await this.save();`; these statements determine whether a failure is absorbed or rejected again.
       */
      return withStorageLease({ owner: 'core:disk-adoption', taskId: 'disk-adoption:' + vm.id,
        label: 'Publish imported disk', mode: 'write', paths: [disk, destination],
        dynamicTemporary: [destination], buffers: 1024 ** 2, files: 6, signal }, options.storage, async (lease) => {
      lease.assertActive();
      const dir = await this.prepareVmDirectory(vm);
      const output = join(dir, 'disk.qcow2');
      let saved = false;
      try {
        signal?.throwIfAborted();
        const key = createSshKey();
        const seed = seedIso({
          'meta-data': metaData(vm.id, vm.name, key.publicText),
          'user-data':
            vm.distro === 'alpine'
              ? userData(vm.name, key.publicText)
              : cloudUserData(vm.name, key.publicText,
                vm.architecture === 'aarch64' ? '/dev/ttyAMA0' : '/dev/ttyS0'),
          ...(vm.distro === 'alpine' ? {} : { 'network-config': cloudNetwork }),
        });
        await lease.reserveTemporary(output, (await stat(disk)).size);
        await pipeline(
          createReadStream(disk),
          createWriteStream(join(dir, 'disk.qcow2'), { flags: 'wx', mode: 0o600 }),
          { signal },
        );
        await writeFile(join(dir, 'id_rsa'), key.privateText, { mode: 0o600 });
        await writeFile(join(dir, 'seed.iso'), seed);
        signal?.throwIfAborted();
        this.records.set(vm.id, vm);
        await this.save();
        saved = true;
        signal?.throwIfAborted();
        await lease.releaseTemporary(output);
        this.emit('change');
        return this.view(vm.id);
      } catch (error) {
        this.records.delete(vm.id);
        if (saved) await this.save();
        try { await this.removeVmDirectory(vm); }
        catch (cleanup) { lease.cleanupPending(cleanup); throw cleanup; }
        this.storagePools.unbind(vm.id);
        throw error;
      }
      });
    }));
  }
  // Publish a validated standalone disk and rotate its controller key at first boot.
  /**
   * 入口 / Entry: Machines.adopt.
   * 功能：把本层请求转交 `this.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: input: unknown; disk: string; key: string; seed: Buffer; project: unknown optional; pendingResize: default=false; projects: { active: string; projects: { id: string; name: string }[]; configs: Record<string, u… optional; migrationOrigin: VMRecord['migrationOrigin'] optional; diskEncryption: VMRecord['diskEncryption'] optional; branchOrigin: VMRecord['branchOrigin'] optional; storage: StorageLease optional; signal: AbortSignal optional
   * 输出 / Returns: `this.locked('storage-pools', () => this.locked('create', async () => { const config = createSchema.parse(input); if (migratio…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async adopt(
    input: unknown,
    disk: string,
    key: string,
    seed: Buffer,
    project?: unknown,
    pendingResize = false,
    projects?: { active: string; projects: { id: string; name: string }[]; configs: Record<string, unknown> },
    migrationOrigin?: VMRecord['migrationOrigin'],
    diskEncryption?: VMRecord['diskEncryption'],
    branchOrigin?: VMRecord['branchOrigin'],
    storage?: StorageLease,
    signal?: AbortSignal,
  ) {
    /**
     * 入口 / Entry: Machines.adopt.callback@2213.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked / create）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked / create).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `withStorageLease({ owner: 'core:disk-adoption', taskId: 'disk-adoption:' + vm.id, label: 'Publish imported disk', mode: 'writ…`.
     * 副作用 / Effects: `createSchema.parse`.
     * 拒绝 / Refusals: 条件 / conditions `migrationOrigin && [...this.records.values()].some((vm) => vm.migrationOrigin?.sourceHostId === migrationOrigin.sourceHostId …`; `this.records.size >= 32 || [...this.records.values()].some((v) => v.name === config.name)`; 异常 / errors `new AppError('此迁移任务已经导入', 409)`; `new AppError('名称已存在或已达到 32 个实例上限', 409)`.
     */
    return this.locked('storage-pools', () => this.locked('create',
    /**
     * 中文功能：拒绝重复迁移来源，复制磁盘及可选分支基盘，保存导入的项目/密钥配置并登记已引导实例，失败清理目录。
     * English: Refuses duplicate migration origins, copies disk/optional branch base, saves imported project/key settings and registers the bootstrapped VM, cleaning storage on failure.
     * 所属 / Owner: Machines.adopt.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     */
    async () => {
      const config = createSchema.parse(input);
      if (migrationOrigin && [...this.records.values()].some((vm) =>
        vm.migrationOrigin?.sourceHostId === migrationOrigin.sourceHostId &&
        vm.migrationOrigin.transferId === migrationOrigin.transferId))
        throw new AppError('此迁移任务已经导入', 409);
      if (config.firmware === 'uefi') await requireUefiSupport(config.architecture);
      if (this.records.size >= 32 || [...this.records.values()].some((v) => v.name === config.name))
        throw new AppError('名称已存在或已达到 32 个实例上限', 409);
      const vm: VMRecord = {
        ...config,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        snapshots: [],
        bootstrapped: true,
        pendingResize,
        ...(migrationOrigin ? { migrationOrigin } : {}),
        ...(diskEncryption ? { diskEncryption: diskEncryptionSchema.parse(diskEncryption) } : {}),
        ...(branchOrigin ? { branchOrigin } : {}),
      };
      const destination = this.storagePools.directory(vm.id, vm.storagePoolId || 'default');
      /**
       * 入口 / Entry: Machines.adopt.callback@2236.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（withStorageLease）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (withStorageLease).
       * 输入 / Inputs: lease
       * 输出 / Returns: `this.view(vm.id)`.
       * 副作用 / Effects: `writeFile`; `createSshKey`; `this.records.set`; `this.save`; `lease.releaseTemporary`.
       * 拒绝 / Refusals: 异常 / errors `cleanup`; `error`.
       * 失败处理：catch 分支执行 `this.records.delete(vm.id);`; `try { await this.removeVmDirectory(vm); } catch (cleanup) { lease.cleanupPending(cleanup); throw cleanup; }`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `this.records.delete(vm.id);`; `try { await this.removeVmDirectory(vm); } catch (cleanup) { lease.cleanupPending(cleanup); throw cleanup; }`; these statements determine whether a failure is absorbed or rejected again.
       */
      return withStorageLease({ owner: 'core:disk-adoption', taskId: 'disk-adoption:' + vm.id,
        label: 'Publish imported disk', mode: 'write', paths: [disk, destination],
        dynamicTemporary: [destination], buffers: 1024 ** 2, files: 6, signal }, storage, async (lease) => {
      lease.assertActive();
      const dir = await this.prepareVmDirectory(vm);
      const output = join(dir, 'disk.qcow2');
      try {
        signal?.throwIfAborted();
        await lease.reserveTemporary(output, (await stat(disk)).size);
        if (branchOrigin) await lease.reserveTemporary(join(dir, 'branch-base.qcow2'), (await stat(disk)).size);
        await copyFile(disk, output);
        if (branchOrigin) await copyFile(disk, join(dir, 'branch-base.qcow2'));
        signal?.throwIfAborted();
        await writeFile(join(dir, 'id_rsa'), key, { mode: 0o600 });
        await writeFile(join(dir, 'seed.iso'), seed);
        await writeFile(join(dir, 'identity.json'), JSON.stringify(createSshKey()), { mode: 0o600 });
        if (projects) {
          await writeFile(
            join(dir, 'projects.json'),
            JSON.stringify({ active: projects.active, projects: projects.projects }, null, 2),
          );
          for (const entry of projects.projects)
            if (projects.configs[entry.id])
              await writeFile(
                join(dir, entry.id === 'default' ? 'project.json' : `project-${entry.id}.json`),
                JSON.stringify(projects.configs[entry.id], null, 2),
              );
        } else if (project) await writeFile(join(dir, 'project.json'), JSON.stringify(project, null, 2));
        this.records.set(vm.id, vm);
        await this.save();
        await lease.releaseTemporary(output);
        if (branchOrigin) await lease.releaseTemporary(join(dir, 'branch-base.qcow2'));
        this.emit('change');
        return this.view(vm.id);
      } catch (error) {
        this.records.delete(vm.id);
        try { await this.removeVmDirectory(vm); }
        catch (cleanup) { lease.cleanupPending(cleanup); throw cleanup; }
        this.storagePools.unbind(vm.id);
        throw error;
      }
      });
    }));
  }
  /**
   * 入口 / Entry: Machines.recordMerge.
   * 功能：把本层请求转交 `this.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; origin: NonNullable<VMRecord['mergeOrigin']>
   * 输出 / Returns: `this.locked(id, async () => { const vm = this.get(id); this.requireStopped(id); vm.mergeOrigin = origin; await this.save(); t…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async recordMerge(id: string, origin: NonNullable<VMRecord['mergeOrigin']>) {
    /**
     * 入口 / Entry: Machines.recordMerge.callback@2279.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(id)`.
     * 副作用 / Effects: `this.save`; `this.emit`; 更新 / updates `vm.mergeOrigin`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.locked(id, async () => {
      const vm = this.get(id);
      this.requireStopped(id);
      vm.mergeOrigin = origin;
      await this.save();
      this.emit('change');
      return this.view(id);
    });
  }
  /**
   * 入口 / Entry: Machines.close.
   * 功能：在管理虚拟机目录、运行生命周期与领域端口中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closeTask` 供上层消费（`Machines`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Machines`; this entry produces `this.closeTask` for its caller. Module context: Owns VM catalogues, lifecycles and domain ports, coordinating startup, shutdown, snapshots, migration and cleanup.
   * 处理：通过 `controller.abort`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `controller.abort`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closeTask`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.closeTask`.
   * 副作用 / Effects: `controller.abort`; 更新 / updates `this.closing`, `this.closeTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    if (this.closeTask) return this.closeTask;
    this.closing = true;
    for (const controller of this.rescueControllers) controller.abort();
    /**
     * 入口 / Entry: Machines.close.callback@2292.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.sandboxes.close`; `this.saveQueue.catch`; `this.engine.runtime.close`; `this.migrationRuns.clear`; `this.migrationCompletions.clear`.
     * 拒绝 / Refusals: 条件 / conditions `failures.length`; 异常 / errors `new AppError('实例关闭清理尚未确认', 503, 'VM_CLEANUP_PENDING')`.
     */
    this.closeTask = (async () => {
      await this.sandboxes.close();
      await this.incidentWrites.catch(() => {});
      // Launch and disk operations admitted before shutdown must settle before
      // taking the final live-process snapshot or releasing their runtime.
      await Promise.allSettled([...this.operations]);
      const stopped = await Promise.allSettled([...this.live].map(([id, live]) =>
        vmLifetime(id, live).barrier(() => this.stopInternal(id, false), true, true)));
      await this.saveQueue.catch(() => {});
      await this.engine.runtime.close();
      this.migrationRuns.clear();
      this.migrationCompletions.clear();
      const failures = stopped.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length) throw new AppError('实例关闭清理尚未确认', 503, 'VM_CLEANUP_PENDING');
    })();
    return this.closeTask;
  }
}
