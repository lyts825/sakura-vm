/** 本体装配端口；插件不能实现、取出或替换此端口。
 * Core assembly port; plugins cannot supply, extract, or replace this authority. */
import type { OwnedImageVm } from '../shared/contracts/image-assets.ts';
import type {
  DrillIdentity,
  DrillParameters,
  DrillPreparation,
} from '../shared/contracts/drill-supervision.ts';
export type DrillGuestAction =
  'prepare' | 'arm' | 'inject' | 'observe' | 'withdraw' | 'probe' | 'restart' | 'cleanup';
export interface DrillMachinePort {
  /** 必须读取 ImageAssets 原持久账本，不能只解析调用方对象。 Read the original ImageAssets ownership ledger. */
  assertOwnership(receipt: OwnedImageVm, consumerIdentity: string): Promise<void>;
  prepare(input: DrillPreparation): Promise<DrillIdentity>;
  assertIdentity(identity: DrillIdentity): Promise<void>;
  /** 固定客户机资产动作；实现须拒绝任意脚本及非本包项目。 Execute only the fixed guest asset. */
  guest(
    identity: DrillIdentity,
    action: DrillGuestAction,
    input: { runId: string; parameters?: DrillParameters; faultDeadline?: string; requestId?: string },
  ): Promise<unknown>;
  /** 原 VM、项目和资产域共同准入；人工急停可抢占。 Shared VM/project admission, preemptible by emergency stop. */
  reserve(identity: DrillIdentity, runId: string): Promise<void>;
  release(identity: DrillIdentity, runId: string): Promise<void>;
  /** 仅核验原 PID 与创建时刻是否已退出；查询失败不得当作停止。 */
  confirmStopped?(identity: DrillIdentity): Promise<boolean>;
  consumer(pluginId: string): { identity: string; generation: string };
  caller(): { identity: string; generation: string };
}
export type DrillWatchdogHandle = {
  receipt: string;
  contain(): Promise<void>;
  withdrawn(): Promise<void>;
  alive(): Promise<boolean>;
  read(): Promise<DrillWatchdogEvent[]>;
};
export type DrillWatchdogEvent = {
  kind: 'ready' | 'withdrawn' | 'stopping' | 'stopped' | 'unknown';
  reason: string;
  at: number;
  pid: number;
  created: string;
  watchdogPid: number;
  watchdogCreated: string;
  faultDeadline: number;
  runDeadline: number;
};
export interface DrillWatchdogPort {
  /** 就绪只代表资产可运行；本机实测凭据另由 capabilities 核对。 Readiness does not replace machine validation evidence. */
  verified(): Promise<{ host: boolean; guest: boolean; gaps: string[] }>;
  start(
    identity: DrillIdentity,
    runId: string,
    faultDeadline: string,
    runDeadline: string,
  ): Promise<DrillWatchdogHandle>;
  reconnect(runId: string): Promise<DrillWatchdogHandle>;
}
