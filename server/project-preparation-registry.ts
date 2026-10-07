/**
 * 模块职责：登记项目准备租约，终端或命令资源未释放时阻止改变目录与网络配置。
 */
import { AppError } from '../shared/errors.ts';
import { vmHostIdentity } from './vm-reference.ts';

export type PreparationLease = {
  vmId: string; projectId: string; task: boolean; terminalId?: string;
  finished: Promise<void>; release: () => void | Promise<void>;
};
const prepared = new WeakMap<object, Set<PreparationLease>>();
export function preparationLeases(host: object) {
  const identity = vmHostIdentity(host);
  let leases = prepared.get(identity); if (!leases) prepared.set(identity, leases = new Set());
  return leases;
}
export function assertProjectPreparationIdle(host: object, vmId: string, projectId: string) {
  if ([...preparationLeases(host)].some(lease => lease.vmId === vmId && lease.projectId === projectId))
    throw new AppError('请先结束此项目的终端或命令，并等待原连接和准备资源释放', 409, 'PROJECT_DIRECTORY_RUNS_MUST_STOP');
}
