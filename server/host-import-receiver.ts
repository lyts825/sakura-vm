/**
 * 模块职责：建立同伴实例包接收入口，受插件就绪、维护状态和导入回执约束。
 * Module purpose: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
 */
import type { BundlesV1 } from './service-contracts/v1.ts';
import type { VmAccess as Machines } from './vm-access.ts';

import type { HostPeerDependencies } from './host-peers.ts';
import { AppError } from '../shared/errors.ts';
import { haWitnessReplicaInventorySchema } from './ha-witness-core.ts';

type Receiver = NonNullable<HostPeerDependencies['importReceiver']>;
type Activation = Parameters<NonNullable<Receiver['activate']>>[0];
type ReplicaActivation = Parameters<NonNullable<Receiver['activateReplica']>>[0];

/** The production receiver is also used by multi-process guest integration checks. */
/**
 * 入口 / Entry: createHostImportReceiver.
 * 功能：创建配对主机实例包接收服务和状态/激活处理器。
 * Purpose: Creates paired-host bundle reception plus status/activation handlers.
 * 设计：检查配对和插件就绪后才接收，限制正文和存储暂存；持久回执用于重复查询与激活核对。
 * Design: Pairing/readiness precede bounded reception/staging; durable receipts support repeated queries and activation verification.
 * 输入 / Inputs: machines: Machines; services: { bundles: () => BundlesV1 | undefined; requireSessionUnlocked: () => void; migration…
 * 输出 / Returns: Receiver；结果来自 / values from `{ inspectReplicas: async ({ requesterId, sourceVmId, targetHostId }) => { requireAvailable(); if ( [...machines.records.value…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function createHostImportReceiver(
  machines: Machines,
  services: {
    /**
     * 签名 / Signature: createHostImportReceiver.bundles.
     * 功能：为建立同伴实例包接收入口声明 bundles 的输入与结果契约，所属容器为 createHostImportReceiver。
     * Purpose: Declares the input/result contract for bundles in createHostImportReceiver. Module responsibility: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: BundlesV1 | undefined.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    bundles: () => BundlesV1 | undefined;
    /**
     * 签名 / Signature: createHostImportReceiver.requireSessionUnlocked.
     * 功能：为建立同伴实例包接收入口声明 requireSessionUnlocked 的输入与结果契约，所属容器为 createHostImportReceiver。
     * Purpose: Declares the input/result contract for requireSessionUnlocked in createHostImportReceiver. Module responsibility: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    requireSessionUnlocked: () => void;
    /**
     * 签名 / Signature: createHostImportReceiver.migrationBlocked.
     * 功能：为建立同伴实例包接收入口声明 migrationBlocked 的输入与结果契约，所属容器为 createHostImportReceiver。
     * Purpose: Declares the input/result contract for migrationBlocked in createHostImportReceiver. Module responsibility: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: boolean.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    migrationBlocked: () => boolean;
  },
): Receiver {
  /**
   * 入口 / Entry: createHostImportReceiver.bundles.
   * 功能：在建立同伴实例包接收入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `service` 供上层消费（`host-import-receiver.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-import-receiver.ts`; this entry produces `service` for its caller. Module context: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
   * 处理：通过 `services.bundles` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.bundles`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `service`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!service`; 异常 / errors `new AppError('请先启用快照与实例包插件', 503)`.
   */
  const bundles = () => {
    const service = services.bundles();
    if (!service) throw new AppError('请先启用快照与实例包插件', 503);
    return service;
  };
  /**
   * 入口 / Entry: createHostImportReceiver.requireAvailable.
   * 功能：在建立同伴实例包接收入口中，核对调用资格、输入或资源归属；本入口产生 `bundles()` 供上层消费（`host-import-receiver.ts`）。
   * Purpose: Checks admission, input or resource ownership in `host-import-receiver.ts`; this entry produces `bundles()` for its caller. Module context: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
   * 处理：通过 `services.migrationBlocked`, `bundles` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.migrationBlocked`, `bundles`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `bundles()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `services.migrationBlocked()`; 异常 / errors `new AppError('数据目录迁移维护中', 409)`.
   */
  const requireAvailable = () => {
    if (services.migrationBlocked()) throw new AppError('数据目录迁移维护中', 409);
    return bundles();
  };
  /**
   * 入口 / Entry: createHostImportReceiver.imported.
   * 功能：在建立同伴实例包接收入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[...machines.records.values()].find( (vm) => vm.migrationOrigin?.sourceHostId === requesterId && vm.migrationOrigin.transferI…` 供上层消费（`host-import-receiver.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-import-receiver.ts`; this entry produces `[...machines.records.values()].find( (vm) => vm.migrationOrigin?.sourceHostId === requesterId && vm.migrationOrigin.transferI…` for its caller. Module context: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
   * 处理：通过 `inline.find`, `machines.records.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.find`, `machines.records.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: requesterId: string; transferId: string
   * 输出 / Returns: `[...machines.records.values()].find( (vm) => vm.migrationOrigin?.sourceHostId === requesterId && vm.migrationOrigin.transferI…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const imported = (requesterId: string, transferId: string) =>
    [...machines.records.values()].find(
      (vm) =>
        vm.migrationOrigin?.sourceHostId === requesterId && vm.migrationOrigin.transferId === transferId,
    );
  /**
   * 入口 / Entry: createHostImportReceiver.inspectImported.
   * 功能：在建立同伴实例包接收入口中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ id: remoteVmId, status }` 供上层消费（`host-import-receiver.ts`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `host-import-receiver.ts`; this entry produces `{ id: remoteVmId, status }` for its caller. Module context: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
   * 处理：通过 `services.requireSessionUnlocked`, `requireAvailable`, `machines.get`, `machines.requireUnlocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireSessionUnlocked`, `requireAvailable`, `machines.get`, `machines.requireUnlocked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: { requesterId, transferId, remoteVmId, sha256 }: Activation
   * 输出 / Returns: `{ id: remoteVmId, status }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `vm.migrationOrigin?.sourceHostId !== requesterId || vm.migrationOrigin.transferId !== transferId || vm.migrationOrigin.diskSh…`; `vm.migrationOrigin.sourceVmId || vm.migrationOrigin.snapshotId`; `status !== 'stopped' && status !== 'starting' && status !== 'running'`; 异常 / errors `new AppError('目标实例身份或校验值与导入记录不一致', 409)`; `new AppError('快照复制副本不能通过冷迁移目标启动接口启动', 409)`.
   */
  const inspectImported = ({ requesterId, transferId, remoteVmId, sha256 }: Activation) => {
    services.requireSessionUnlocked();
    requireAvailable();
    const vm = machines.get(remoteVmId);
    if (
      vm.migrationOrigin?.sourceHostId !== requesterId ||
      vm.migrationOrigin.transferId !== transferId ||
      vm.migrationOrigin.diskSha256 !== sha256
    )
      throw new AppError('目标实例身份或校验值与导入记录不一致', 409);
    if (vm.migrationOrigin.sourceVmId || vm.migrationOrigin.snapshotId)
      throw new AppError('快照复制副本不能通过冷迁移目标启动接口启动', 409);
    machines.requireUnlocked(remoteVmId);
    const status = machines.state(remoteVmId);
    if (status !== 'stopped' && status !== 'starting' && status !== 'running')
      throw new AppError(`目标实例当前为 ${status}，需要人工复核`, 409);
    return { id: remoteVmId, status };
  };
  /**
   * 入口 / Entry: createHostImportReceiver.inspectReplica.
   * 功能：在建立同伴实例包接收入口中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ id: remoteVmId, status }` 供上层消费（`host-import-receiver.ts`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `host-import-receiver.ts`; this entry produces `{ id: remoteVmId, status }` for its caller. Module context: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
   * 处理：通过 `requireAvailable`, `machines.get`, `machines.requireUnlocked`, `machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `requireAvailable`, `machines.get`, `machines.requireUnlocked`, `machines.state`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: { requesterId, transferId, remoteVmId, sha256, sourceVmId, snapshotId, }: ReplicaActivation
   * 输出 / Returns: `{ id: remoteVmId, status }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `vm.migrationOrigin?.sourceHostId !== requesterId || vm.migrationOrigin.transferId !== transferId || vm.migrationOrigin.diskSh…`; `vm.haRetirement`; `status !== 'stopped' && status !== 'starting' && status !== 'running'`; 异常 / errors `new AppError('故障副本身份或快照校验值与导入记录不一致', 409)`; `new AppError('故障副本已退出接管', 409)`.
   */
  const inspectReplica = ({
    requesterId,
    transferId,
    remoteVmId,
    sha256,
    sourceVmId,
    snapshotId,
  }: ReplicaActivation) => {
    requireAvailable();
    const vm = machines.get(remoteVmId);
    if (
      vm.migrationOrigin?.sourceHostId !== requesterId ||
      vm.migrationOrigin.transferId !== transferId ||
      vm.migrationOrigin.diskSha256 !== sha256 ||
      vm.migrationOrigin.sourceVmId !== sourceVmId ||
      vm.migrationOrigin.snapshotId !== snapshotId
    )
      throw new AppError('故障副本身份或快照校验值与导入记录不一致', 409);
    machines.requireUnlocked(remoteVmId);
    if (vm.haRetirement) throw new AppError('故障副本已退出接管', 409);
    const status = machines.state(remoteVmId);
    if (status !== 'stopped' && status !== 'starting' && status !== 'running')
      throw new AppError(`故障副本当前为 ${status}，需要人工复核`, 409);
    return { id: remoteVmId, status };
  };
  /**
   * 入口 / Entry: createHostImportReceiver.replicaIdentity.
   * 功能：从当前输入或状态计算 `({ sourceHostId: input.requesterId, transferId: input.transferId, sourceVmId: input.sourceVmId, snapshotId: input.snapshotId,…`，供调用方后续验证或使用。
   * Purpose: Computes `({ sourceHostId: input.requesterId, transferId: input.transferId, sourceVmId: input.sourceVmId, snapshotId: input.snapshotId,…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: input: ReplicaActivation
   * 输出 / Returns: `({ sourceHostId: input.requesterId, transferId: input.transferId, sourceVmId: input.sourceVmId, snapshotId: input.snapshotId,…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  const replicaIdentity = (input: ReplicaActivation) => ({
    sourceHostId: input.requesterId,
    transferId: input.transferId,
    sourceVmId: input.sourceVmId,
    snapshotId: input.snapshotId,
    sha256: input.sha256,
  });
  return {
    /**
     * 入口 / Entry: createHostImportReceiver.inspectReplicas.
     * 功能：在建立同伴实例包接收入口中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `haWitnessReplicaInventorySchema.parse({ version: 1, complete: true, hostId: targetHostId, sourceHostId: requesterId, sourceVm…` 供上层消费（`host-import-receiver.ts`）。
     * Purpose: Reads/verifies domain state and constructs a caller-facing result in `host-import-receiver.ts`; this entry produces `haWitnessReplicaInventorySchema.parse({ version: 1, complete: true, hostId: targetHostId, sourceHostId: requesterId, sourceVm…` for its caller. Module context: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
     * 处理：通过 `requireAvailable`, `inline.some`, `machines.records.values`, `inline.filter().map` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `requireAvailable`, `inline.some`, `machines.records.values`, `inline.filter().map`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: { requesterId, sourceVmId, targetHostId }
     * 输出 / Returns: `haWitnessReplicaInventorySchema.parse({ version: 1, complete: true, hostId: targetHostId, sourceHostId: requesterId, sourceVm…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `[...machines.records.values()].some( (vm) => vm.migrationOrigin?.sourceHostId === requesterId && ((vm.migrationOrigin.snapsho…`; 异常 / errors `new AppError('来源宿主存在归属不完整的历史副本，不能声明清单完整', 409)`.
     */
    inspectReplicas: async ({ requesterId, sourceVmId, targetHostId }) => {
      requireAvailable();
      if (
        [...machines.records.values()].some(
          (vm) =>
            vm.migrationOrigin?.sourceHostId === requesterId &&
            ((vm.migrationOrigin.snapshotId && !vm.migrationOrigin.sourceVmId) ||
              (vm.migrationOrigin.sourceVmId && !vm.migrationOrigin.snapshotId)),
        )
      )
        throw new AppError('来源宿主存在归属不完整的历史副本，不能声明清单完整', 409);
      /**
       * 入口 / Entry: createHostImportReceiver.callback@107.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline.filter().map）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline.filter().map).
       * 输入 / Inputs: vm
       * 输出 / Returns: `{ identity, status: machines.state(vm.id), retirement: vm.haRetirement ? { ...identity, retiredAt: vm.haRetirement.retiredAt …`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `!origin || origin.sourceHostId !== requesterId || origin.sourceVmId !== sourceVmId || !origin.snapshotId || !origin.diskSha25…`; `vm.haRetirement && ['sourceHostId', 'sourceVmId', 'transferId', 'snapshotId', 'sha256'].some( (key) => vm.haRetirement![key a…`; 异常 / errors `new AppError('历史故障副本登记损坏，不能声明清单完整', 409)`; `new AppError('历史故障副本退役证据与导入记录不一致', 409)`.
       */
      const replicas = [...machines.records.values()]
        .filter(
          (vm) =>
            (vm.migrationOrigin?.sourceHostId === requesterId &&
              vm.migrationOrigin.sourceVmId === sourceVmId) ||
            (vm.haRetirement?.sourceHostId === requesterId && vm.haRetirement.sourceVmId === sourceVmId),
        )
        .map((vm) => {
          const origin = vm.migrationOrigin;
          if (
            !origin ||
            origin.sourceHostId !== requesterId ||
            origin.sourceVmId !== sourceVmId ||
            !origin.snapshotId ||
            !origin.diskSha256
          )
            throw new AppError('历史故障副本登记损坏，不能声明清单完整', 409);
          const identity = {
            sourceHostId: requesterId,
            sourceVmId,
            targetHostId,
            transferId: origin.transferId,
            remoteVmId: vm.id,
            snapshotId: origin.snapshotId,
            sha256: origin.diskSha256,
          };
          if (
            vm.haRetirement &&
            ['sourceHostId', 'sourceVmId', 'transferId', 'snapshotId', 'sha256'].some(
              (key) =>
                vm.haRetirement![key as keyof typeof vm.haRetirement] !==
                identity[key as keyof typeof identity],
            )
          )
            throw new AppError('历史故障副本退役证据与导入记录不一致', 409);
          return {
            identity,
            status: machines.state(vm.id),
            retirement: vm.haRetirement ? { ...identity, retiredAt: vm.haRetirement.retiredAt } : null,
          };
        });
      return haWitnessReplicaInventorySchema.parse({
        version: 1,
        complete: true,
        hostId: targetHostId,
        sourceHostId: requesterId,
        sourceVmId,
        replicas,
      });
    },
    /**
     * 入口 / Entry: createHostImportReceiver.status.
     * 功能：在建立同伴实例包接收入口中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `vm && origin ? { id: vm.id, name: origin.targetName, ...(origin.diskSha256 ? { sha256: origin.diskSha256 } : {}), ...(origin.…` 供上层消费（`host-import-receiver.ts`）。
     * Purpose: Reads/verifies domain state and constructs a caller-facing result in `host-import-receiver.ts`; this entry produces `vm && origin ? { id: vm.id, name: origin.targetName, ...(origin.diskSha256 ? { sha256: origin.diskSha256 } : {}), ...(origin.…` for its caller. Module context: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
     * 处理：通过 `bundles`, `imported` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `bundles`, `imported`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: { requesterId, transferId }
     * 输出 / Returns: `vm && origin ? { id: vm.id, name: origin.targetName, ...(origin.diskSha256 ? { sha256: origin.diskSha256 } : {}), ...(origin.…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    status: async ({ requesterId, transferId }) => {
      bundles();
      const vm = imported(requesterId, transferId),
        origin = vm?.migrationOrigin;
      return vm && origin
        ? {
            id: vm.id,
            name: origin.targetName,
            ...(origin.diskSha256 ? { sha256: origin.diskSha256 } : {}),
            ...(origin.sourceVmId ? { sourceVmId: origin.sourceVmId } : {}),
            ...(origin.snapshotId ? { snapshotId: origin.snapshotId } : {}),
          }
        : null;
    },
    /**
     * 入口 / Entry: createHostImportReceiver.receive.
     * 功能：在建立同伴实例包接收入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ id: vm.id, name, ...(vm.migrationOrigin?.diskSha256 ? { sha256: vm.migrationOrigin.diskSha256 } : {}), ...(sourceVmId ? { s…` 供上层消费（`host-import-receiver.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-import-receiver.ts`; this entry produces `{ id: vm.id, name, ...(vm.migrationOrigin?.diskSha256 ? { sha256: vm.migrationOrigin.diskSha256 } : {}), ...(sourceVmId ? { s…` for its caller. Module context: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
     * 处理：通过 `services.requireSessionUnlocked`, `requireAvailable`, `service.import` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `services.requireSessionUnlocked`, `requireAvailable`, `service.import`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: { requesterId, transferId, name, sourceVmId, snapshotId, source, signal }
     * 输出 / Returns: `{ id: vm.id, name, ...(vm.migrationOrigin?.diskSha256 ? { sha256: vm.migrationOrigin.diskSha256 } : {}), ...(sourceVmId ? { s…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    receive: async ({ requesterId, transferId, name, sourceVmId, snapshotId, source, signal }) => {
      services.requireSessionUnlocked();
      const service = requireAvailable();
      const vm = await service.import(
        name,
        source,
        signal,
        () => {
          services.requireSessionUnlocked();
          requireAvailable();
        },
        {
          sourceHostId: requesterId,
          transferId,
          targetName: name,
          ...(sourceVmId ? { sourceVmId } : {}),
          ...(snapshotId ? { snapshotId } : {}),
        },
      );
      return {
        id: vm.id,
        name,
        ...(vm.migrationOrigin?.diskSha256 ? { sha256: vm.migrationOrigin.diskSha256 } : {}),
        ...(sourceVmId ? { sourceVmId } : {}),
        ...(snapshotId ? { snapshotId } : {}),
      };
    },
    /**
     * 入口 / Entry: createHostImportReceiver.inspectActivation.
     * 功能：把本层请求转交 `inspectImported`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `inspectImported` and propagates the provider result or rejection.
     * 输入 / Inputs: input
     * 输出 / Returns: `inspectImported(input)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    inspectActivation: async (input) => inspectImported(input),
    /**
     * 入口 / Entry: createHostImportReceiver.inspectReplicaActivation.
     * 功能：把本层请求转交 `inspectReplica`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `inspectReplica` and propagates the provider result or rejection.
     * 输入 / Inputs: input
     * 输出 / Returns: `inspectReplica(input)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    inspectReplicaActivation: async (input) => inspectReplica(input),
    /**
     * 入口 / Entry: createHostImportReceiver.retireReplica.
     * 功能：在建立同伴实例包接收入口中，结束、撤销或清理本次拥有的领域资源；本入口产生 `{ id: input.remoteVmId, retired: true }` 供上层消费（`host-import-receiver.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `host-import-receiver.ts`; this entry produces `{ id: input.remoteVmId, retired: true }` for its caller. Module context: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
     * 处理：通过 `requireAvailable`, `machines.requireUnlocked`, `machines.retireHaReplica`, `replicaIdentity` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `requireAvailable`, `machines.requireUnlocked`, `machines.retireHaReplica`, `replicaIdentity`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: input
     * 输出 / Returns: `{ id: input.remoteVmId, retired: true }`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    retireReplica: async (input) => {
      requireAvailable();
      machines.requireUnlocked(input.remoteVmId);
      await machines.retireHaReplica(input.remoteVmId, replicaIdentity(input));
      return { id: input.remoteVmId, retired: true };
    },
    /**
     * 入口 / Entry: createHostImportReceiver.activateReplica.
     * 功能：在建立同伴实例包接收入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ id: input.remoteVmId, status }` 供上层消费（`host-import-receiver.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-import-receiver.ts`; this entry produces `{ id: input.remoteVmId, status }` for its caller. Module context: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
     * 处理：通过 `inspectReplica`, `machines.startHaReplica`, `replicaIdentity`, `machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `inspectReplica`, `machines.startHaReplica`, `replicaIdentity`, `machines.state`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `current.status === 'stopped'`.
     * 输入 / Inputs: input
     * 输出 / Returns: `{ id: input.remoteVmId, status }`.
     * 副作用 / Effects: `machines.startHaReplica`.
     * 拒绝 / Refusals: 条件 / conditions `status !== 'starting' && status !== 'running'`; 异常 / errors `new AppError(`故障副本启动未保持运行状态：${status}`, 502)`.
     */
    activateReplica: async (input) => {
      const current = inspectReplica(input);
      if (current.status === 'stopped')
        await machines.startHaReplica(input.remoteVmId, replicaIdentity(input));
      const status = machines.state(input.remoteVmId);
      if (status !== 'starting' && status !== 'running')
        throw new AppError(`故障副本启动未保持运行状态：${status}`, 502);
      return { id: input.remoteVmId, status };
    },
    /**
     * 入口 / Entry: createHostImportReceiver.activate.
     * 功能：在建立同伴实例包接收入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ id: input.remoteVmId, status }` 供上层消费（`host-import-receiver.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-import-receiver.ts`; this entry produces `{ id: input.remoteVmId, status }` for its caller. Module context: Creates peer bundle reception entry points under plugin readiness, maintenance and import receipt constraints.
     * 处理：通过 `inspectImported`, `machines.start`, `machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `inspectImported`, `machines.start`, `machines.state`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `current.status === 'stopped'`.
     * 输入 / Inputs: input
     * 输出 / Returns: `{ id: input.remoteVmId, status }`.
     * 副作用 / Effects: `machines.start`.
     * 拒绝 / Refusals: 条件 / conditions `status !== 'starting' && status !== 'running'`; 异常 / errors `new AppError(`目标实例启动未保持运行状态：${status}`, 502)`.
     */
    activate: async (input) => {
      const current = inspectImported(input);
      if (current.status === 'stopped') await machines.start(input.remoteVmId);
      const status = machines.state(input.remoteVmId);
      if (status !== 'starting' && status !== 'running')
        throw new AppError(`目标实例启动未保持运行状态：${status}`, 502);
      return { id: input.remoteVmId, status };
    },
  };
}
