/**
 * 模块职责：声明虚拟机目录、锁、执行和文件等领域端口，限制领域对核心管理实现的依赖。
 */
import type { BaseAgent, Client, SFTPWrapper } from 'ssh2';
import type {
  HaPromotion, HaRetirement, HaWitnessEnrollment, LiveMigrationFence,
  MigrationFingerprint, VMConfig, VMRecord, VMStatus, VMView,
} from '../shared/contracts/vm.ts';
import type { SandboxPolicy } from '../shared/sandbox.ts';
import type { qmp } from './qmp.ts';
import type { Engine } from './runtime.ts';
import type { StorageLease } from './storage-runtime.ts';
import type { VmLive } from './vm-reference.ts';
import type { LiveMigrationProjects } from './live-migration-projects.ts';

/** Capabilities are declared independently of the Machines implementation. */
export interface VmRecordPort {
  get(id: string): VMRecord;
  readonly records: ReadonlyMap<string, VMRecord>;
}
export interface VmLockPort {
  isBusy(id: string): boolean;
  requireStopped(id: string): void;
  requireUnlocked(id: string): void;
  incidentLocked(id: string): boolean;
  locked<T>(id: string, action: () => Promise<T>, allowIncident?: boolean, allowFailedExecutions?: boolean): Promise<T>;
}
export interface VmEventPort {
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  off(event: string | symbol, listener: (...args: any[]) => void): this;
  emit(event: string | symbol, ...args: any[]): boolean;
}
export interface VmCatalogPort extends VmRecordPort {
  readonly closing: boolean;
  readonly live: ReadonlyMap<string, VmLive>;
  readonly logs: ReadonlyMap<string, string>;
  state(id: string): VMStatus;
  list(): Promise<VMView[]>;
  view(id: string): Promise<VMView>;
  commandline(id: string): {
    name: string; machine: string; architecture: 'x86_64' | 'aarch64'; memoryMiB: number;
    cpus: number; hardware: VMConfig['hardware']; resourceArguments: string[];
    deviceArguments: string[]; audioArguments: string[]; display: string; diskOptions: string;
    diskEncryption: { format: string; secretName: string } | undefined;
    diskPersistence: 'persistent' | 'discard-on-stop'; accelerator: VMConfig['accelerator'];
    disk: string; forwards: VMConfig['forwards'];
  };
  boot?(id: string): string | undefined;
}
export interface VmLifecyclePort {
  create(input: unknown, sandbox?: SandboxPolicy): Promise<VMView>;
  update(id: string, input: unknown | ((current: VMRecord) => unknown), guard?: (current: VMRecord) => void): Promise<VMView>;
  delete(id: string, expected?: MigrationFingerprint): Promise<void>;
  start(id: string): Promise<VMView>;
  stop(id: string, force?: boolean): Promise<VMView>;
  suspend(id: string): Promise<VMView>;
  resume(id: string): Promise<VMView>;
  terminateSandbox(id: string): Promise<void>;
  enterMaintenance(): () => void;
  setIncidentLockdown(id: string, locked: boolean): Promise<{ locked: boolean; stopped: boolean }>;
  organize(id: string, input: unknown): Promise<VMView>;
  bootGuard(id: string, reset?: boolean): Promise<{
    attempts: number[]; failures: number; limit: number; windowSeconds: number;
    blocked: boolean; retryAt: string | null;
  }>;
}
export type VmExecutionResult = { stdout: string; stderr: string; code: number };
export interface VmTransportPort {
  connect(id: string, timeout?: number, signal?: AbortSignal, agentPath?: string | BaseAgent): Promise<Client>;
  exec(id: string, command: string, timeout?: number, signal?: AbortSignal,
    output?: (data: string) => void, agentPath?: string | BaseAgent): Promise<VmExecutionResult>;
  execInput(id: string, command: string, input: Buffer, timeout?: number, signal?: AbortSignal,
    output?: (data: string) => void, agentPath?: string | BaseAgent): Promise<VmExecutionResult>;
  sftp<T>(id: string, work: (sftp: SFTPWrapper, transportSignal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>;
}
export interface VmGuestFilesPort {
  files(id: string, path: string): Promise<unknown>;
  readGuestFile(id: string, path: string): Promise<string>;
  writeGuestFile(id: string, path: string, content: string, overwrite?: boolean, expectedVersion?: string): Promise<void>;
  beforeFileReplace(callback: (id: string, path: string, ftp: SFTPWrapper, signal?: AbortSignal) => Promise<void>): () => void;
  fileReplacing(id: string, path: string, ftp: SFTPWrapper, signal?: AbortSignal): Promise<void>;
}
export interface VmRescuePort {
  withRescue<T>(sourceId: string, signal: AbortSignal, phase: (text: string) => void,
    work: (rescueId: string, signal: AbortSignal) => Promise<T>, diagnostic?: (text: string) => void,
    readOnlyDisk?: string, comparisonDisk?: string, targetDisk?: { file: string; writable: boolean }): Promise<T>;
}
export type CreatedVmSnapshot = {
  id: `${string}-${string}-${string}-${string}-${string}`; name: string; createdAt: string;
  diskGiB: number; pendingResize: boolean; consistency: 'vmstate' | 'offline' | 'filesystem';
  stateFingerprint?: string;
};
export interface VmSnapshotPort {
  snapshotIdentity(id: string, snapshotId?: string): Promise<{ key: string; seed: Buffer }>;
  snapshot(id: string, name: string): Promise<CreatedVmSnapshot>;
  onlineSnapshot(id: string, name: string): Promise<CreatedVmSnapshot>;
  memorySnapshot(id: string, name: string): Promise<CreatedVmSnapshot>;
  restore(id: string, snapshotId: string, backup?: boolean): Promise<VMView>;
  restoreMemory(id: string, snapshotId: string, backup?: boolean): Promise<VMView>;
  editSnapshot(id: string, snapshotId: string, patch: { name: string; note: string } | null): Promise<VMView>;
  recordMerge(id: string, origin: NonNullable<VMRecord['mergeOrigin']>): Promise<VMView>;
}
export interface VmSnapshotStatePort {
  capture(id: string, snapshotId: string): Promise<void>;
  prepareRestore(id: string, snapshotId: string): Promise<() => Promise<void>>;
  remove(id: string, snapshotId: string): Promise<void>;
  ensureOnlineAllowed(id: string): Promise<void>;
}
export type VmDiskEncryptionStatus = {
  enabled: boolean; encrypted: boolean; format: 'luks' | undefined; secretName: string | undefined;
  keyAvailable: boolean; stopped: boolean; snapshots: number;
};
export type VmStorageMove = { moved: boolean; from: string; to: string; cleanupPending: boolean; vm: VMView };
export interface VmStoragePort {
  withDiskSecret<T>(vm: VMRecord, action: (file: string) => Promise<T>): Promise<T>;
  diskEncryptionStatus(id: string): Promise<VmDiskEncryptionStatus>;
  encryptDisk(id: string, secretName: string, signal?: AbortSignal): Promise<VmDiskEncryptionStatus>;
  resize(id: string, diskGiB: number, signal?: AbortSignal): Promise<VMView>;
  completeResize(id: string): Promise<void>;
  moveStoragePool(id: string, targetPoolId: string, signal?: AbortSignal, log?: (text: string) => void): Promise<VmStorageMove>;
  importDisk(input: unknown, disk: string, options?: { signal?: AbortSignal; pendingResize?: boolean; storage?: StorageLease }): Promise<VMView>;
  adopt(input: unknown, disk: string, key: string, seed: Buffer, project?: unknown, pendingResize?: boolean,
    projects?: { active: string; projects: { id: string; name: string }[]; configs: Record<string, unknown> },
    migrationOrigin?: VMRecord['migrationOrigin'], diskEncryption?: VMRecord['diskEncryption'],
    branchOrigin?: VMRecord['branchOrigin'], storage?: StorageLease, signal?: AbortSignal): Promise<VMView>;
}
export type VmHotplugResult =
  | { kind: 'cpu'; current: number; maximum: number;
      slots: { type: string; props: Record<string, number>; 'qom-path'?: string; 'vcpus-count': number }[];
      canAdd: boolean; accelerator: 'tcg' | 'whpx'; guestPossible: number; devices?: undefined }
  | { kind: 'cpu'; code: number; ready: boolean; current: number; maximum: number;
      guestOnline: number | null; guestCode: number; warning?: string; slots?: undefined;
      canAdd?: undefined; accelerator?: undefined; guestPossible?: undefined; devices?: undefined }
  | { kind: 'memory'; current: number; maximum: number;
      devices: { type: string; data: { slot?: number; size?: number; id?: string } }[];
      canAdd: boolean; accelerator: 'tcg' | 'whpx'; slots?: undefined; guestPossible?: undefined }
  | { kind: 'memory'; code: number; ready: boolean; current: number; maximum: number;
      devices: unknown; guestMemoryKiB: number | null; warning?: string; slots?: undefined;
      canAdd?: undefined; accelerator?: undefined; guestPossible?: undefined };
export interface VmHardwarePort {
  configureHardware(id: string, input: unknown, expected?: { hardware: unknown; memoryMiB: number; architecture?: string }): Promise<VMView>;
  hotplug(id: string, kind: 'cpu' | 'memory', target?: number, signal?: AbortSignal): Promise<VmHotplugResult>;
  setForwards(id: string, input: unknown, expected?: VMConfig['forwards']): Promise<VMView>;
  setMemoryTarget(id: string, memoryMiB: number): Promise<VMView>;
  reserveHostPorts(owner: string, ports: Iterable<number>): void;
}
export interface VmMigrationPort {
  migrationFingerprint(id: string): Promise<MigrationFingerprint>;
  createIncomingTarget(input: unknown, identity: { key: string; seed: Buffer },
    source: { sourceHostId: string; sourceVmId: string; transferId: string; completionProtocol?: 1 },
    projects?: LiveMigrationProjects, organization?: VMRecord['organization']): Promise<VMRecord>;
  startIncoming(id: string): Promise<VMView>;
  completeIncoming(id: string, query?: typeof qmp, sessionId?: string): Promise<VMView>;
  fenceForLiveMigration(id: string, raw: unknown, query?: typeof qmp): Promise<LiveMigrationFence>;
}
export interface VmHaPort {
  beforeHaStart(guard: (id: string) => Promise<void>): () => void;
  enrollHaWitness(id: string, targetHostId: string, failureThreshold: number): Promise<HaWitnessEnrollment>;
  releaseHaWitness(id: string, targetHostId: string): Promise<void>;
  fenceForHa(id: string, raw: HaPromotion, guard?: () => Promise<void> | void): Promise<HaPromotion>;
  updateHaPromotion(id: string, transferId: string, patch: Pick<HaPromotion, 'status'> & { error?: string }): Promise<HaPromotion>;
  releaseHaPromotion(id: string, transferId: string): Promise<{ released: boolean }>;
  retireHaReplica(id: string, raw: unknown): Promise<HaRetirement>;
  startHaReplica(id: string, identity: { sourceHostId: string; transferId: string; sourceVmId: string; snapshotId: string; sha256: string }): Promise<VMView>;
}
export interface VmEnginePort {
  readonly engine: Pick<Engine, 'run' | 'runStatus' | 'version' | 'aarch64Available' | 'whpxAvailable'>;
}
export type VmStoragePoolView = {
  currentPoolId: string | null;
  pendingCleanup: { vmId: string; sourcePoolId: string; targetPoolId: string; addedAt: string }[];
  pools: { id: string; name: string; root: string; createdAt: string; available: boolean;
    totalBytes: number | null; freeBytes: number | null; allocatedBytes: number;
    vms: { id: string; name: string; diskBytes: number }[] }[];
};
export type VmStoragePoolRunResult = VmStoragePoolView & { ready: boolean; executed: boolean } & (
  | { created?: undefined; removed?: undefined; cleanup?: undefined; moved?: undefined }
  | { created: { id: string; name: string; root: string; createdAt: string };
      removed?: undefined; cleanup?: undefined; moved?: undefined }
  | { removed: string; created?: undefined; cleanup?: undefined; moved?: undefined }
  | { cleanup: { completed: string[]; errors: { vmId: string; message: string }[] };
      created?: undefined; removed?: undefined; moved?: undefined }
  | { moved: VmStorageMove; created?: undefined; removed?: undefined; cleanup?: undefined }
);
export interface VmStoragePoolsPort {
  view(id?: string): Promise<VmStoragePoolView>;
  directory(id: string, poolId?: string): string;
  conflictsWithDataTarget(target: string): boolean;
  run(id: string | undefined, input: unknown, action: 'check' | 'run', signal?: AbortSignal, log?: (text: string) => void): Promise<VmStoragePoolRunResult>;
  hasPendingCleanup(id: string): boolean;
  ensure(poolId?: string): Promise<string>;
}

/** Consumer ports intentionally expose only each domain's actual VM capabilities. */
export type VmSnapshotInspectionPort = Pick<VmRecordPort, 'get'> &
  Pick<VmLockPort, 'isBusy' | 'requireStopped' | 'requireUnlocked' | 'locked'> &
  Pick<VmEventPort, 'on' | 'off'> & VmEnginePort & VmRescuePort & Pick<VmTransportPort, 'exec'>;
export type VmSnapshotMergePort = Omit<VmSnapshotInspectionPort, 'on' | 'off'> &
  Pick<VmRecordPort, 'records'> & Pick<VmSnapshotPort, 'recordMerge'> & Pick<VmLifecyclePort, 'delete'>;
export type VmSnapshotReplicationPort = Pick<VmRecordPort, 'get'> &
  Pick<VmLockPort, 'locked' | 'requireStopped'> & Pick<VmSnapshotPort, 'snapshotIdentity'>;
export type VmStoragePoolOwnerPort = VmRecordPort & Pick<VmLockPort, 'locked'> & Pick<VmStoragePort, 'moveStoragePool'>;
