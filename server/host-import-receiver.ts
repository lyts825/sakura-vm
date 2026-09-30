import type { Machines } from './machines.ts';
import type { Bundles } from './bundles.ts';
import type { HostPeers } from './host-peers.ts';
import { AppError } from './model.ts';

type Receiver = Parameters<HostPeers['setImportReceiver']>[0];
type Activation = Parameters<NonNullable<Receiver['activate']>>[0];
type ReplicaActivation = Parameters<NonNullable<Receiver['activateReplica']>>[0];

/** The production receiver is also used by multi-process guest integration checks. */
export function createHostImportReceiver(machines: Machines, services: {
  bundles: () => Bundles | undefined;
  requireSessionUnlocked: () => void;
  migrationBlocked: () => boolean;
}): Receiver {
  const bundles = () => {
    const service = services.bundles();
    if (!service) throw new AppError('请先启用快照与实例包插件', 503);
    return service;
  };
  const requireAvailable = () => {
    if (services.migrationBlocked()) throw new AppError('数据目录迁移维护中', 409);
    return bundles();
  };
  const imported = (requesterId: string, transferId: string) =>
    [...machines.records.values()].find((vm) =>
      vm.migrationOrigin?.sourceHostId === requesterId &&
      vm.migrationOrigin.transferId === transferId);
  const inspectImported = ({ requesterId, transferId, remoteVmId, sha256 }: Activation) => {
    services.requireSessionUnlocked();
    requireAvailable();
    const vm = machines.get(remoteVmId);
    if (vm.migrationOrigin?.sourceHostId !== requesterId ||
        vm.migrationOrigin.transferId !== transferId ||
        vm.migrationOrigin.diskSha256 !== sha256)
      throw new AppError('目标实例身份或校验值与导入记录不一致', 409);
    if (vm.migrationOrigin.sourceVmId || vm.migrationOrigin.snapshotId)
      throw new AppError('快照复制副本不能通过冷迁移目标启动接口启动', 409);
    machines.requireUnlocked(remoteVmId);
    const status = machines.state(remoteVmId);
    if (status !== 'stopped' && status !== 'starting' && status !== 'running')
      throw new AppError(`目标实例当前为 ${status}，需要人工复核`, 409);
    return { id: remoteVmId, status };
  };
  const inspectReplica = ({ requesterId, transferId, remoteVmId, sha256,
    sourceVmId, snapshotId }: ReplicaActivation) => {
    requireAvailable();
    const vm = machines.get(remoteVmId);
    if (vm.migrationOrigin?.sourceHostId !== requesterId ||
        vm.migrationOrigin.transferId !== transferId ||
        vm.migrationOrigin.diskSha256 !== sha256 ||
        vm.migrationOrigin.sourceVmId !== sourceVmId ||
        vm.migrationOrigin.snapshotId !== snapshotId)
      throw new AppError('故障副本身份或快照校验值与导入记录不一致', 409);
    machines.requireUnlocked(remoteVmId);
    if (vm.haRetirement) throw new AppError('故障副本已退出接管', 409);
    const status = machines.state(remoteVmId);
    if (status !== 'stopped' && status !== 'starting' && status !== 'running')
      throw new AppError(`故障副本当前为 ${status}，需要人工复核`, 409);
    return { id: remoteVmId, status };
  };
  const replicaIdentity = (input: ReplicaActivation) => ({
    sourceHostId: input.requesterId, transferId: input.transferId,
    sourceVmId: input.sourceVmId, snapshotId: input.snapshotId, sha256: input.sha256,
  });
  return {
    status: async ({ requesterId, transferId }) => {
      bundles();
      const vm = imported(requesterId, transferId), origin = vm?.migrationOrigin;
      return vm && origin ? { id: vm.id, name: origin.targetName,
        ...(origin.diskSha256 ? { sha256: origin.diskSha256 } : {}),
        ...(origin.sourceVmId ? { sourceVmId: origin.sourceVmId } : {}),
        ...(origin.snapshotId ? { snapshotId: origin.snapshotId } : {}) } : null;
    },
    receive: async ({ requesterId, transferId, name, sourceVmId, snapshotId, source, signal }) => {
      services.requireSessionUnlocked();
      const service = requireAvailable();
      const vm = await service.import(name, source, signal, () => {
        services.requireSessionUnlocked(); requireAvailable();
      }, { sourceHostId: requesterId, transferId, targetName: name,
        ...(sourceVmId ? { sourceVmId } : {}), ...(snapshotId ? { snapshotId } : {}) });
      return { id: vm.id, name,
        ...(vm.migrationOrigin?.diskSha256 ? { sha256: vm.migrationOrigin.diskSha256 } : {}),
        ...(sourceVmId ? { sourceVmId } : {}), ...(snapshotId ? { snapshotId } : {}) };
    },
    inspectActivation: async (input) => inspectImported(input),
    inspectReplicaActivation: async (input) => inspectReplica(input),
    retireReplica: async (input) => {
      requireAvailable();
      machines.requireUnlocked(input.remoteVmId);
      await machines.retireHaReplica(input.remoteVmId, replicaIdentity(input));
      return { id: input.remoteVmId, retired: true };
    },
    activateReplica: async (input) => {
      const current = inspectReplica(input);
      if (current.status === 'stopped')
        await machines.startHaReplica(input.remoteVmId, replicaIdentity(input));
      const status = machines.state(input.remoteVmId);
      if (status !== 'starting' && status !== 'running')
        throw new AppError(`故障副本启动未保持运行状态：${status}`, 502);
      return { id: input.remoteVmId, status };
    },
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
