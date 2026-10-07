/**
 * 模块职责：管理 TPM 与安全启动资源及快照状态，缺少配套身份文件时拒绝恢复或导出。
 * Module purpose: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processSupervisor, type ManagedHelper } from './process-supervisor.ts';
import { z } from 'zod';
import type { BootAttachment } from './machines.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { DATA, vmDir } from './paths.ts';
import { type VMRecord } from '../shared/contracts/vm.ts';
import { readStore, regularDirectory, writeStore } from './local-store.ts';
import { inspectTrustedBoot, probeTrustedBootHost, trustedBootPaths } from './trusted-boot.ts';
import {
  MAX_TRUSTED_BOOT_FILE,
  MAX_TRUSTED_BOOT_TOTAL,
  decodeTrustedBootArchive,
  encodeTrustedBootArchive,
  validateTrustedBootFiles,
  type TrustedBootFiles,
} from './trusted-boot-archive.ts';

const policySchema = z.object({ enabled: z.boolean() }).strict();
type Policy = z.infer<typeof policySchema>;
export const trustedBootRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('configure'), policy: policySchema }).strict(),
  z.object({ operation: z.literal('check') }).strict(),
]);
type Active = { boot: object;
/**
 * 签名 / Signature: Active.close.
 * 功能：为管理 TPM 与安全启动资源及快照状态声明 close 的输入与结果契约，所属容器为 Active。
 * Purpose: Declares the input/result contract for close in Active. Module responsibility: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
close: () => Promise<void> };

/**
 * 入口 / Entry: trustedBootArguments.
 * 功能：从当前输入或状态计算 `[ '-global', 'driver=cfi.pflash01,property=secure,value=on', '-chardev', `socket,id=sakura-tpm,path=${path}`, '-tpmdev', 'emu…`，供调用方后续验证或使用。
 * Purpose: Computes `[ '-global', 'driver=cfi.pflash01,property=secure,value=on', '-chardev', `socket,id=sakura-tpm,path=${path}`, '-tpmdev', 'emu…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: socket: string
 * 输出 / Returns: `[ '-global', 'driver=cfi.pflash01,property=secure,value=on', '-chardev', `socket,id=sakura-tpm,path=${path}`, '-tpmdev', 'emu…`.
 * 副作用 / Effects: `socket.replaceAll`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function trustedBootArguments(socket: string) {
  const path = socket.replaceAll(',', ',,');
  return [
    '-global',
    'driver=cfi.pflash01,property=secure,value=on',
    '-chardev',
    `socket,id=sakura-tpm,path=${path}`,
    '-tpmdev',
    'emulator,id=sakura-tpmdev,chardev=sakura-tpm',
    '-device',
    'tpm-tis,tpmdev=sakura-tpmdev',
  ];
}

export class TrustedBootService {
  /**
   * 签名 / Signature: TrustedBootService.unregisterBoot.
   * 功能：为管理 TPM 与安全启动资源及快照状态声明 unregisterBoot 的输入与结果契约，所属容器为 TrustedBootService。
   * Purpose: Declares the input/result contract for unregisterBoot in TrustedBootService. Module responsibility: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private unregisterBoot?: () => void;
  private lifetime = new AbortController();
  private starting = new Set<Promise<BootAttachment | undefined>>();
  private policies: Record<string, Policy> = {};
  private active = new Map<string, Active>();
  private writes = Promise.resolve();
  private closed = false;
  /**
   * 入口 / Entry: TrustedBootService.constructor.
   * 功能：建立 TrustedBootService 的管理 TPM 与安全启动资源及快照状态上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the TrustedBootService context for this module's responsibility: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; blocked: () => boolean default=() => false; mutation: (delta: number) => void default=() => {}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
  ) {}

  /**
   * 入口 / Entry: TrustedBootService.init.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，初始化并核对当前领域状态；处理结果记录到 `this.policies`, `this.unregisterBoot`（`TrustedBootService`）。
   * Purpose: Initializes and verifies current domain state in `TrustedBootService`; the outcome is recorded in `this.policies`, `this.unregisterBoot`. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `z.record().parse`, `z.record`, `z.uuid`, `readStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.record().parse`, `z.record`, `z.uuid`, `readStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `registerVmBootProvider`; 更新 / updates `this.policies`, `this.unregisterBoot`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    this.policies = z
      .record(z.uuid(), policySchema)
      .parse(await readStore(join(DATA, 'trusted-boot.json'), () => ({})));
    this.unregisterBoot = registerVmBootProvider(this.machines, 'trusted-boot', { allowInitialReset: true,
    /**
     * 入口 / Entry: TrustedBootService.init.firmware.
     * 功能：在管理 TPM 与安全启动资源及快照状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `undefined` / `this.firmware(vm.id)` 供上层消费（`TrustedBootService`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `TrustedBootService`; this entry produces `undefined` / `this.firmware(vm.id)` for its caller. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
     * 处理：通过 `this.blocked`, `this.requireSupported`, `this.firmware` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.blocked`, `this.requireSupported`, `this.firmware`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `!this.policies[vm.id]?.enabled`.
     * 输入 / Inputs: vm
     * 输出 / Returns: `undefined`; `this.firmware(vm.id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.closed || this.blocked()`; 异常 / errors `new AppError('TPM 与安全启动暂不可启动', 409)`.
     */
    firmware: async (vm) => {
      if (!this.policies[vm.id]?.enabled) return undefined;
      if (this.closed || this.blocked()) throw new AppError('TPM 与安全启动暂不可启动', 409);
      await this.requireSupported(vm);
      return this.firmware(vm.id);
    },
    /**
     * 入口 / Entry: TrustedBootService.init.prepare.
     * 功能：在管理 TPM 与安全启动资源及快照状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`TrustedBootService`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `TrustedBootService`; this entry produces `task` for its caller. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
     * 处理：通过 `this.prepare`, `this.starting.add`, `task.finally().catch`, `task.finally` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.prepare`, `this.starting.add`, `task.finally().catch`, `task.finally`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: vm; onExit
     * 输出 / Returns: `task`.
     * 副作用 / Effects: `this.starting.add`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    prepare: (vm, onExit) => {
      const task = this.prepare(vm, onExit);
      this.starting.add(task);
      void task.finally(() => this.starting.delete(task)).catch(() => {});
      return task;
    },
    /**
     * 入口 / Entry: TrustedBootService.init.stateFingerprint.
     * 功能：把本层请求转交 `this.fingerprint`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.fingerprint` and propagates the provider result or rejection.
     * 输入 / Inputs: id
     * 输出 / Returns: `this.fingerprint(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    stateFingerprint: (id) => this.fingerprint(id), snapshot: {
      /**
       * 入口 / Entry: TrustedBootService.init.capture.
       * 功能：把本层请求转交 `this.saveSnapshot`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.saveSnapshot` and propagates the provider result or rejection.
       * 输入 / Inputs: id; snapshotId
       * 输出 / Returns: `this.saveSnapshot(id, snapshotId)`.
       * 副作用 / Effects: `this.saveSnapshot`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      capture: (id, snapshotId) => this.saveSnapshot(id, snapshotId),
      /**
       * 入口 / Entry: TrustedBootService.init.prepareRestore.
       * 功能：把本层请求转交 `this.prepareSnapshotRestore`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.prepareSnapshotRestore` and propagates the provider result or rejection.
       * 输入 / Inputs: id; snapshotId
       * 输出 / Returns: `this.prepareSnapshotRestore(id, snapshotId)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      prepareRestore: (id, snapshotId) => this.prepareSnapshotRestore(id, snapshotId),
      /**
       * 入口 / Entry: TrustedBootService.init.remove.
       * 功能：把本层请求转交 `this.removeSnapshot`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.removeSnapshot` and propagates the provider result or rejection.
       * 输入 / Inputs: id; snapshotId
       * 输出 / Returns: `this.removeSnapshot(id, snapshotId)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      remove: (id, snapshotId) => this.removeSnapshot(id, snapshotId),
      /**
       * 入口 / Entry: TrustedBootService.init.ensureOnlineAllowed.
       * 功能：把本层请求转交 `this.ensureOnlineSnapshotAllowed`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.ensureOnlineSnapshotAllowed` and propagates the provider result or rejection.
       * 输入 / Inputs: id
       * 输出 / Returns: `this.ensureOnlineSnapshotAllowed(id)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      ensureOnlineAllowed: (id) => this.ensureOnlineSnapshotAllowed(id),
    } });
  }

  /**
   * 入口 / Entry: TrustedBootService.save.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，校验并提交领域状态变更；处理结果记录到 `this.writes`（`TrustedBootService`）。
   * Purpose: Validates and commits a domain state change in `TrustedBootService`; the outcome is recorded in `this.writes`. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; policy: Policy
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(id: string, policy: Policy) {
    const operation = this.writes
      .catch(() => {})
      .then(async () => {
        const next = { ...this.policies, [id]: policy };
        await writeStore(join(DATA, 'trusted-boot.json'), next);
        this.policies = next;
      });
    this.writes = operation;
    await operation;
  }

  /**
   * 入口 / Entry: TrustedBootService.snapshotFile.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `join(vmDir(id), `.snapshot-${z.uuid().parse(snapshotId)}.trusted-boot.json`)` 供上层消费（`TrustedBootService`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `TrustedBootService`; this entry produces `join(vmDir(id), `.snapshot-${z.uuid().parse(snapshotId)}.trusted-boot.json`)` for its caller. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `join`, `vmDir`, `z.uuid().parse`, `z.uuid` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `vmDir`, `z.uuid().parse`, `z.uuid`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; snapshotId: string
   * 输出 / Returns: `join(vmDir(id), `.snapshot-${z.uuid().parse(snapshotId)}.trusted-boot.json`)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private snapshotFile(id: string, snapshotId: string) {
    return join(vmDir(id), `.snapshot-${z.uuid().parse(snapshotId)}.trusted-boot.json`);
  }

  /**
   * 入口 / Entry: TrustedBootService.saveSnapshot.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，校验并提交领域状态变更；完成下述调用及状态处理（`TrustedBootService`）。
   * Purpose: Validates and commits a domain state change in `TrustedBootService`; the calls and state transitions below complete the operation. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `this.capture`, `writeFile`, `this.snapshotFile`, `encodeTrustedBootArchive` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.capture`, `writeFile`, `this.snapshotFile`, `encodeTrustedBootArchive`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; snapshotId: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeFile`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async saveSnapshot(id: string, snapshotId: string) {
    const state = (await this.capture(id)) || { enabled: false, files: [] };
    await writeFile(this.snapshotFile(id, snapshotId), JSON.stringify(encodeTrustedBootArchive(state)), {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });
  }

  /**
   * 入口 / Entry: TrustedBootService.readSnapshot.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `undefined` / `state` 供上层消费（`TrustedBootService`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `TrustedBootService`; this entry produces `undefined` / `state` for its caller. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `this.snapshotFile`, `lstat().catch`, `lstat`, `this.capture` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.snapshotFile`, `lstat().catch`, `lstat`, `this.capture`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; snapshotId: string
   * 输出 / Returns: Promise<TrustedBootFiles | undefined>；结果来自 / values from `undefined`; `state`.
   * 副作用 / Effects: 更新 / updates `state`.
   * 拒绝 / Refusals: 条件 / conditions `!info`; `await this.capture(id)`; `!info.isFile() || info.isSymbolicLink() || info.size > 48 * 1024 ** 2`; 异常 / errors `new AppError('此历史快照没有对应的 TPM/NVRAM 状态，拒绝恢复或导出', 409)`; `new AppError('快照 TPM 状态文件类型或大小无效', 409)`.
   * 失败处理：catch 分支执行 `throw new AppError('快照 TPM 状态编码或校验失败', 409);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('快照 TPM 状态编码或校验失败', 409);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async readSnapshot(id: string, snapshotId: string): Promise<TrustedBootFiles | undefined> {
    const file = this.snapshotFile(id, snapshotId);
    const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!info) {
      if (await this.capture(id))
        throw new AppError('此历史快照没有对应的 TPM/NVRAM 状态，拒绝恢复或导出', 409);
      return undefined;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size > 48 * 1024 ** 2)
      throw new AppError('快照 TPM 状态文件类型或大小无效', 409);
    let state: TrustedBootFiles;
    try {
      state = decodeTrustedBootArchive(JSON.parse(await readFile(file, 'utf8')));
    } catch {
      throw new AppError('快照 TPM 状态编码或校验失败', 409);
    }
    const vm = this.machines.get(id);
    if (
      state.enabled &&
      (vm.firmware !== 'uefi' || vm.architecture === 'aarch64' || !vm.distro || vm.distro === 'alpine')
    )
      throw new AppError('历史 TPM 快照与当前实例固件或发行版不兼容', 409);
    return state;
  }

  /**
   * 入口 / Entry: TrustedBootService.prepareSnapshotRestore.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `async () => { if (state) await this.replaceCurrent(id, state); }` 供上层消费（`TrustedBootService`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TrustedBootService`; this entry produces `async () => { if (state) await this.replaceCurrent(id, state); }` for its caller. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `this.readSnapshot`, `this.capture` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.readSnapshot`, `this.capture`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; snapshotId: string
   * 输出 / Returns: `async () => { if (state) await this.replaceCurrent(id, state); }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async prepareSnapshotRestore(id: string, snapshotId: string) {
    const state = await this.readSnapshot(id, snapshotId);
    await this.capture(id); // Validate the current state before qemu-img changes the disk.
    return async () => {
      if (state) await this.replaceCurrent(id, state);
    };
  }

  /**
   * 入口 / Entry: TrustedBootService.removeSnapshot.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`TrustedBootService`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `TrustedBootService`; the calls and state transitions below complete the operation. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `rm`, `this.snapshotFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `rm`, `this.snapshotFile`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; snapshotId: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `rm`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async removeSnapshot(id: string, snapshotId: string) {
    await rm(this.snapshotFile(id, snapshotId), { force: true });
  }

  /**
   * 入口 / Entry: TrustedBootService.ensureOnlineSnapshotAllowed.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`TrustedBootService`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TrustedBootService`; the calls and state transitions below complete the operation. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `this.capture` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.capture`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `await this.capture(id)`; 异常 / errors `new AppError('TPM/NVRAM 状态需要停机快照；在线磁盘快照不能与其保持一致', 409)`.
   */
  private async ensureOnlineSnapshotAllowed(id: string) {
    if (await this.capture(id))
      throw new AppError('TPM/NVRAM 状态需要停机快照；在线磁盘快照不能与其保持一致', 409);
  }

  /**
   * 入口 / Entry: TrustedBootService.replaceCurrent.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，校验并提交领域状态变更；完成下述调用及状态处理（`TrustedBootService`）。
   * Purpose: Validates and commits a domain state change in `TrustedBootService`; the calls and state transitions below complete the operation. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `validateTrustedBootFiles`, `this.machines.requireStopped`, `regularDirectory`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `validateTrustedBootFiles`, `this.machines.requireStopped`, `regularDirectory`, `vmDir`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `file.name === 'uefi-secure-vars.fd'`; `await exists(vars)`; `await exists(tpm)`.
   * 输入 / Inputs: id: string; state: TrustedBootFiles
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeFile`; `mkdir`; `rename`; `this.save`; `rm`; 更新 / updates `movedVars`, `movedTpm`, `installedVars`, `installedTpm`.
   * 拒绝 / Refusals: 异常 / errors `new AppError(`TPM 状态恢复和回滚均失败：${String(error)}；${String(rollbackError)}`, 500)`; `error`.
   * 收尾：退出 try 区域时始终执行 `if (!preserveStage) await rm(stage, { recursive: true, force: true });`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (!preserveStage) await rm(stage, { recursive: true, force: true });`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `try { if (installedVars) await rm(vars, { force: true }); if (installedTpm) await rm(tpm, { recursive: true, force: true }); …`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `try { if (installedVars) await rm(vars, { force: true }); if (installedTpm) await rm(tpm, { recursive: true, force: true }); …`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async replaceCurrent(id: string, state: TrustedBootFiles) {
    validateTrustedBootFiles(state);
    this.machines.requireStopped(id);
    const directory = await regularDirectory(vmDir(id));
    await this.capture(id); // Reject links and unexpected current state before changing any file.
    const stage = await mkdtemp(join(directory, '.trusted-restore-'));
    const vars = join(directory, 'uefi-secure-vars.fd');
    const tpm = join(directory, 'tpm2');
    const oldVars = join(stage, 'previous-vars');
    const oldTpm = join(stage, 'previous-tpm');
    const newVars = join(stage, 'new-vars');
    const newTpm = join(stage, 'new-tpm');
    /**
     * 入口 / Entry: TrustedBootService.replaceCurrent.exists.
     * 功能：在管理 TPM 与安全启动资源及快照状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; })` 供上层消费（`TrustedBootService`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `TrustedBootService`; this entry produces `lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; })` for its caller. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
     * 处理：通过 `lstat().catch`, `lstat` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `lstat().catch`, `lstat`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: path: string
     * 输出 / Returns: `lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; })`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const exists = async (path: string) =>
      lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    let movedVars = false,
      movedTpm = false,
      installedVars = false,
      installedTpm = false;
    let preserveStage = false;
    try {
      for (const file of state.files) {
        if (file.name === 'uefi-secure-vars.fd')
          await writeFile(newVars, file.data, { flag: 'wx', mode: 0o600, flush: true });
        else {
          await mkdir(newTpm, { recursive: true, mode: 0o700 });
          await writeFile(join(newTpm, file.name.slice(5)), file.data, {
            flag: 'wx',
            mode: 0o600,
            flush: true,
          });
        }
      }
      if (await exists(vars)) {
        await rename(vars, oldVars);
        movedVars = true;
      }
      if (await exists(tpm)) {
        await rename(tpm, oldTpm);
        movedTpm = true;
      }
      if (await exists(newVars)) {
        await rename(newVars, vars);
        installedVars = true;
      }
      if (await exists(newTpm)) {
        await rename(newTpm, tpm);
        installedTpm = true;
      }
      await this.save(id, { enabled: state.enabled });
    } catch (error) {
      try {
        if (installedVars) await rm(vars, { force: true });
        if (installedTpm) await rm(tpm, { recursive: true, force: true });
        if (movedVars) await rename(oldVars, vars);
        if (movedTpm) await rename(oldTpm, tpm);
      } catch (rollbackError) {
        preserveStage = true;
        throw new AppError(`TPM 状态恢复和回滚均失败：${String(error)}；${String(rollbackError)}`, 500);
      }
      throw error;
    } finally {
      if (!preserveStage) await rm(stage, { recursive: true, force: true });
    }
  }

  /** Called while the machine lock is held, so state cannot change during export. */
  /**
   * 入口 / Entry: TrustedBootService.capture.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `state && (state.enabled || state.files.length) ? state : undefined` / `undefined` 供上层消费（`TrustedBootService`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TrustedBootService`; this entry produces `state && (state.enabled || state.files.length) ? state : undefined` / `undefined` for its caller. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `this.machines.get`, `this.machines.get().snapshots.some`, `this.readSnapshot`, `regularDirectory` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.get().snapshots.some`, `this.readSnapshot`, `regularDirectory`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `name === '.lock'`; `!enabled && !files.length`.
   * 输入 / Inputs: id: string; snapshotId: string optional
   * 输出 / Returns: Promise<TrustedBootFiles | undefined>；结果来自 / values from `state && (state.enabled || state.files.length) ? state : undefined`; `undefined`; `snapshot`.
   * 副作用 / Effects: `add`.
   * 拒绝 / Refusals: 条件 / conditions `snapshotId`; `!this.machines.get(id).snapshots.some((shot) => shot.id === snapshotId)`; `varsInfo`; 异常 / errors `new AppError('快照不存在', 404)`; `new AppError('实例安全启动 NVRAM 文件无效', 409)`.
   */
  async capture(id: string, snapshotId?: string): Promise<TrustedBootFiles | undefined> {
    this.machines.get(id);
    if (snapshotId) {
      if (!this.machines.get(id).snapshots.some((shot) => shot.id === snapshotId))
        throw new AppError('快照不存在', 404);
      const state = await this.readSnapshot(id, snapshotId);
      return state && (state.enabled || state.files.length) ? state : undefined;
    }
    const directory = await regularDirectory(vmDir(id));
    const files: TrustedBootFiles['files'] = [];
    let total = 0;
    /**
     * 入口 / Entry: TrustedBootService.capture.add.
     * 功能：在管理 TPM 与安全启动资源及快照状态中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`TrustedBootService`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `TrustedBootService`; the calls and state transitions below complete the operation. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
     * 处理：通过 `readFile`, `files.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `readFile`, `files.push`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: name: string; path: string; size: number
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `files.push`; 更新 / updates `total`.
     * 拒绝 / Refusals: 条件 / conditions `size > MAX_TRUSTED_BOOT_FILE || total + size > MAX_TRUSTED_BOOT_TOTAL || files.length >= 16`; `data.length > MAX_TRUSTED_BOOT_FILE || total > MAX_TRUSTED_BOOT_TOTAL`; 异常 / errors `new AppError('实例 TPM 状态文件数量或大小超限', 409)`.
     */
    const add = async (name: string, path: string, size: number) => {
      if (size > MAX_TRUSTED_BOOT_FILE || total + size > MAX_TRUSTED_BOOT_TOTAL || files.length >= 16)
        throw new AppError('实例 TPM 状态文件数量或大小超限', 409);
      const data = await readFile(path);
      files.push({ name, data });
      total += data.length;
      if (data.length > MAX_TRUSTED_BOOT_FILE || total > MAX_TRUSTED_BOOT_TOTAL)
        throw new AppError('实例 TPM 状态文件数量或大小超限', 409);
    };
    const vars = join(directory, 'uefi-secure-vars.fd');
    const varsInfo = await lstat(vars).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (varsInfo) {
      if (!varsInfo.isFile() || varsInfo.isSymbolicLink())
        throw new AppError('实例安全启动 NVRAM 文件无效', 409);
      await add('uefi-secure-vars.fd', vars, varsInfo.size);
    }
    const stateDir = join(directory, 'tpm2');
    const stateInfo = await lstat(stateDir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stateInfo) {
      if (!stateInfo.isDirectory() || stateInfo.isSymbolicLink())
        throw new AppError('实例 TPM 状态目录无效', 409);
      for (const name of (await readdir(stateDir)).sort()) {
        // swtpm recreates this advisory lock; it is not TPM identity state.
        if (name === '.lock') continue;
        if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/.test(name))
          throw new AppError('实例 TPM 状态文件名无效', 409);
        const path = join(stateDir, name);
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) throw new AppError('实例 TPM 状态文件无效', 409);
        await add(`tpm2/${name}`, path, info.size);
      }
    }
    const enabled = !!this.policies[id]?.enabled;
    if (!enabled && !files.length) return undefined;
    const snapshot = { enabled, files };
    validateTrustedBootFiles(snapshot);
    return snapshot;
  }

  /**
   * 入口 / Entry: TrustedBootService.restore.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`TrustedBootService`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TrustedBootService`; the calls and state transitions below complete the operation. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `validateTrustedBootFiles`, `this.machines.get`, `this.machines.requireStopped`, `regularDirectory` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `validateTrustedBootFiles`, `this.machines.get`, `this.machines.requireStopped`, `regularDirectory`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `folder`.
   * 输入 / Inputs: id: string; snapshot: TrustedBootFiles
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `name.startsWith`; `mkdir`; `writeFile`; `this.save`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async restore(id: string, snapshot: TrustedBootFiles) {
    validateTrustedBootFiles(snapshot);
    this.machines.get(id);
    this.machines.requireStopped(id);
    const directory = await regularDirectory(vmDir(id));
    for (const { name, data } of snapshot.files) {
      const [folder, file] = name.startsWith('tpm2/') ? ['tpm2', name.slice(5)] : ['', name];
      const targetDir = folder ? join(directory, folder) : directory;
      if (folder) {
        await mkdir(targetDir, { recursive: true, mode: 0o700 });
        await regularDirectory(targetDir);
      }
      await writeFile(join(targetDir, file), data, { flag: 'wx', mode: 0o600 });
    }
    await this.save(id, { enabled: snapshot.enabled });
  }

  /**
   * 入口 / Entry: TrustedBootService.fingerprint.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `hash.digest('hex')` 供上层消费（`TrustedBootService`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TrustedBootService`; this entry produces `hash.digest('hex')` for its caller. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `this.capture`, `createHash().update`, `createHash`, `hash.update().update().update` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.capture`, `createHash().update`, `createHash`, `hash.update().update().update`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `hash.digest('hex')`.
   * 副作用 / Effects: `createHash().update`; `createHash`; `hash.update().update().update`; `hash.update().update`; `hash.update`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async fingerprint(id: string) {
    const state = await this.capture(id);
    const hash = createHash('sha256').update(String(!!state?.enabled));
    for (const file of state?.files || [])
      hash.update(file.name).update(String(file.data.length)).update(file.data);
    return hash.digest('hex');
  }

  /**
   * 入口 / Entry: TrustedBootService.requireSupported.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`TrustedBootService`）。
   * Purpose: Checks admission, input or resource ownership in `TrustedBootService`; the calls and state transitions below complete the operation. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `probeTrustedBootHost` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `probeTrustedBootHost`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vm: VMRecord
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `process.platform !== 'linux' || vm.architecture === 'aarch64'`; `vm.firmware !== 'uefi'`; `!vm.distro || vm.distro === 'alpine'`; 异常 / errors `new AppError('TPM 与安全启动目前需要 Linux x86_64 宿主和客户机', 503)`; `new AppError('启用安全启动前，请先把实例固件设为 UEFI', 409)`.
   */
  private async requireSupported(vm: VMRecord) {
    if (process.platform !== 'linux' || vm.architecture === 'aarch64')
      throw new AppError('TPM 与安全启动目前需要 Linux x86_64 宿主和客户机', 503);
    if (vm.firmware !== 'uefi') throw new AppError('启用安全启动前，请先把实例固件设为 UEFI', 409);
    if (!vm.distro || vm.distro === 'alpine')
      throw new AppError('当前安全启动链仅支持 Debian 和 Ubuntu 镜像', 409);
    const host = await probeTrustedBootHost();
    if (
      !host.secureFirmware ||
      !host.varsTemplate ||
      !host.smm ||
      !host.tpmBackend ||
      !host.swtpm ||
      !host.rebootAction
    )
      throw new AppError('宿主缺少预登记安全启动固件、QEMU 6.0+ TPM/SMM 后端或 swtpm', 503);
  }

  /**
   * 入口 / Entry: TrustedBootService.firmware.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ code: paths.secureFirmware, vars }` 供上层消费（`TrustedBootService`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TrustedBootService`; this entry produces `{ code: paths.secureFirmware, vars }` for its caller. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `trustedBootPaths`, `vmDir`, `regularDirectory`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `trustedBootPaths`, `vmDir`, `regularDirectory`, `join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ code: paths.secureFirmware, vars }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `(error as NodeJS.ErrnoException).code !== 'EEXIST'`; `!target.isFile() || target.isSymbolicLink() || target.size !== source.size`; 异常 / errors `error`; `new AppError('实例安全启动 NVRAM 文件类型或容量无效', 409)`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async firmware(id: string) {
    const paths = trustedBootPaths();
    const directory = vmDir(id);
    await regularDirectory(directory);
    const vars = join(directory, 'uefi-secure-vars.fd');
    try {
      await copyFile(paths.varsTemplate, vars, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const [source, target] = await Promise.all([stat(paths.varsTemplate), lstat(vars)]);
    if (!target.isFile() || target.isSymbolicLink() || target.size !== source.size)
      throw new AppError('实例安全启动 NVRAM 文件类型或容量无效', 409);
    await chmod(vars, 0o600);
    return { code: paths.secureFirmware, vars };
  }

  /**
   * 入口 / Entry: TrustedBootService.prepare.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `undefined` / `{ args: trustedBootArguments(socket), machine: 'q35,smm=on', close: async () => { await close(); if (this.active.get(vm.id) =…` 供上层消费（`TrustedBootService`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TrustedBootService`; this entry produces `undefined` / `{ args: trustedBootArguments(socket), machine: 'q35,smm=on', close: async () => { await close(); if (this.active.get(vm.id) =…` for its caller. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `this.blocked`, `this.requireSupported`, `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.requireSupported`, `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.policies[vm.id]?.enabled`.
   * 输入 / Inputs: vm: VMRecord; onExit: (error: string) => void
   * 输出 / Returns: Promise<BootAttachment | undefined>；结果来自 / values from `undefined`; `{ args: trustedBootArguments(socket), machine: 'q35,smm=on', close: async () => { await close(); if (this.active.get(vm.id) =…`.
   * 副作用 / Effects: `mkdir`; `AbortSignal.any`; `this.active.set`; `close`; 更新 / updates `daemon`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed || this.blocked()`; `this.closed || this.machines.live.get(vm.id) !== boot`; 异常 / errors `new AppError('TPM 与安全启动暂不可启动', 409)`; `new AppError('实例启动已取消', 409)`.
   * 失败处理：catch 分支执行 `try { await close(); } catch (cleanupError) { this.active.set(vm.id, { boot: boot!, close }); throw cleanupError; }`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `try { await close(); } catch (cleanupError) { this.active.set(vm.id, { boot: boot!, close }); throw cleanupError; }`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async prepare(vm: VMRecord, onExit: (error: string) => void): Promise<BootAttachment | undefined> {
    if (!this.policies[vm.id]?.enabled) return undefined;
    if (this.closed || this.blocked()) throw new AppError('TPM 与安全启动暂不可启动', 409);
    await this.requireSupported(vm);
    const stateDir = join(vmDir(vm.id), 'tpm2');
    await regularDirectory(stateDir);
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await chmod(stateDir, 0o700);
    const dir = await mkdtemp(join(tmpdir(), 'sakura-tpm-'));
    const socket = join(dir, 'tpm.sock');
    const boot = this.machines.live.get(vm.id);
    let daemon: ManagedHelper | undefined, cleanup: Promise<void> | undefined;
    /**
     * 入口 / Entry: TrustedBootService.prepare.close.
     * 功能：在管理 TPM 与安全启动资源及快照状态中，结束、撤销或清理本次拥有的领域资源；本入口产生 `(cleanup ||= (async () => { await daemon?.close(); await rm(dir, { recursive: true, force: true }); })().catch((error) => { c…` 供上层消费（`TrustedBootService`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `TrustedBootService`; this entry produces `(cleanup ||= (async () => { await daemon?.close(); await rm(dir, { recursive: true, force: true }); })().catch((error) => { c…` for its caller. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
     * 处理：通过 `inline().catch`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `inline().catch`, `inline`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `(cleanup ||= (async () => { await daemon?.close(); await rm(dir, { recursive: true, force: true }); })().catch((error) => { c…`.
     * 副作用 / Effects: 更新 / updates `cleanup`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const close = () =>
      (cleanup ||= (async () => {
        await daemon?.close();
        await rm(dir, { recursive: true, force: true });
      })().catch((error) => {
        cleanup = undefined;
        throw error;
      }));
    try {
      daemon = await processSupervisor.helper({
        owner: `vm:${vm.id}`,
        helper: 'swtpm',
        label: 'TPM',
        file: trustedBootPaths().swtpm,
        args: [
          'socket',
          '--tpm2',
          '--tpmstate',
          `dir=${stateDir},mode=0600`,
          '--ctrl',
          `type=unixio,path=${socket},mode=0600`,
          '--terminate',
        ],
        signal: AbortSignal.any([this.lifetime.signal, ...(boot?.abort ? [boot.abort.signal] : [])]),
        /**
         * 入口 / Entry: TrustedBootService.prepare.onExit.
         * 功能：在管理 TPM 与安全启动资源及快照状态中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`TrustedBootService`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `TrustedBootService`; the calls and state transitions below complete the operation. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
         * 处理：通过 `onExit` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `onExit`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `code !== 0 || signal || failure`.
         * 输入 / Inputs: { code, signal, failure }
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        onExit: ({ code, signal, failure }) => {
          // --terminate permits a clean exit when QEMU closes its control socket.
          if (code !== 0 || signal || failure) onExit(failure || `exit=${code}, signal=${signal}`);
        },
      });
      await daemon.ready(async () => !!(await lstat(socket).catch(() => null))?.isSocket());
      if (this.closed || this.machines.live.get(vm.id) !== boot) throw new AppError('实例启动已取消', 409);
      const active: Active = { boot: boot!, close };
      this.active.set(vm.id, active);
      return {
        args: trustedBootArguments(socket),
        machine: 'q35,smm=on',
        /**
         * 入口 / Entry: TrustedBootService.prepare.close.
         * 功能：在管理 TPM 与安全启动资源及快照状态中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`TrustedBootService`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `TrustedBootService`; the calls and state transitions below complete the operation. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
         * 处理：通过 `close`, `this.active.get`, `this.active.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `close`, `this.active.get`, `this.active.delete`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `this.active.get(vm.id) === active`.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `close`; `this.active.delete`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        close: async () => {
          await close();
          if (this.active.get(vm.id) === active) this.active.delete(vm.id);
        },
      };
    } catch (error) {
      try {
        await close();
      } catch (cleanupError) {
        this.active.set(vm.id, { boot: boot!, close });
        throw cleanupError;
      }
      throw error;
    }
  }

  /**
   * 入口 / Entry: TrustedBootService.view.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ policy: this.policies[id] || { enabled: false }, stopped: this.machines.state(id) === 'stopped', attached: !!active && acti…` 供上层消费（`TrustedBootService`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `TrustedBootService`; this entry produces `{ policy: this.policies[id] || { enabled: false }, stopped: this.machines.state(id) === 'stopped', attached: !!active && acti…` for its caller. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `this.machines.get`, `this.active.get`, `this.machines.state`, `this.machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.active.get`, `this.machines.state`, `this.machines.live.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ policy: this.policies[id] || { enabled: false }, stopped: this.machines.state(id) === 'stopped', attached: !!active && acti…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string) {
    this.machines.get(id);
    const active = this.active.get(id);
    return {
      policy: this.policies[id] || { enabled: false },
      stopped: this.machines.state(id) === 'stopped',
      attached:
        !!active && active.boot === this.machines.live.get(id) && this.machines.state(id) === 'running',
    };
  }

  /**
   * 入口 / Entry: TrustedBootService.action.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...(await inspectTrustedBoot(this.machines, id)), policy: this.policies[id] || { enabled: false }, }` / `this.view(id)` 供上层消费（`TrustedBootService`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TrustedBootService`; this entry produces `{ ...(await inspectTrustedBoot(this.machines, id)), policy: this.policies[id] || { enabled: false }, }` / `this.view(id)` for its caller. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `trustedBootRequest.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.blocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `trustedBootRequest.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.blocked`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `input.operation === 'check'`.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: `{ ...(await inspectTrustedBoot(this.machines, id)), policy: this.policies[id] || { enabled: false }, }`; `this.view(id)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.mutation(-1);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.mutation(-1);`; these steps also apply to exceptional exits.
   */
  async action(id: string, raw: unknown) {
    const input = trustedBootRequest.parse(raw);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const vm = this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    if (input.operation === 'check')
      return {
        ...(await inspectTrustedBoot(this.machines, id)),
        policy: this.policies[id] || { enabled: false },
      };
    this.mutation(1);
    try {
      await this.machines.locked(id, async () => {
        this.machines.requireStopped(id);
        if (input.policy.enabled) await this.requireSupported(vm);
        await this.save(id, input.policy);
      });
      return this.view(id);
    } finally {
      this.mutation(-1);
    }
  }

  /**
   * 入口 / Entry: TrustedBootService.close.
   * 功能：在管理 TPM 与安全启动资源及快照状态中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`TrustedBootService`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `TrustedBootService`; the outcome is recorded in `this.closed`. Module context: Owns TPM/secure-boot resources and snapshots, refusing restore/export without corresponding identity files.
   * 处理：通过 `this.lifetime.abort`, `Promise.allSettled`, `inline.map`, `cleanup.flatMap` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.lifetime.abort`, `Promise.allSettled`, `inline.map`, `cleanup.flatMap`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.lifetime.abort`; 更新 / updates `this.closed`.
   * 拒绝 / Refusals: 条件 / conditions `failed.length`; 异常 / errors `new AggregateError(failed, 'TPM 进程清理尚未确认')`.
   */
  async close() {
    this.closed = true;
    this.lifetime.abort();
    await this.writes;
    await Promise.allSettled([...this.starting]);
    const cleanup = await Promise.allSettled(
      [...this.active].map(async ([id, entry]) => {
        await entry.close();
        if (this.active.get(id) === entry) this.active.delete(id);
      }),
    );
    const failed = cleanup.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
    if (failed.length) throw new AggregateError(failed, 'TPM 进程清理尚未确认');
    this.unregisterBoot?.();
  }
}
import { registerVmBootProvider } from './vm-lifetime.ts';
