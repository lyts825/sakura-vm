/**
 * 模块职责：声明宿主服务解析器接口及无服务默认值，限制领域可依赖的宿主能力。
 * Module purpose: Declares the host resolver and absent-service default, restricting optional domain dependencies to named contracts.
 */
import type { BrowserIdeV1, CapabilityChecksV1, ColdMigrationsV1, CommunityPluginsV1, DisasterRecoveryDrillV1, HaHostFailoverV1, HaLocalFailoversV1, HostMountsV1, HostPeersV1, MediaDevicesV1, NotebookEnvironmentsV1, ProcessInteropV1, ProjectTerminalsV1, SnapshotReplicationsV1, TrustedBootServiceV1, VirtioFsSharesV1 } from './service-contracts/v1.ts';
export interface HostServiceContracts {
  assistant: import('./service-contracts/v1.ts').LocalAssistantV1;
  retention: import('./service-contracts/v1.ts').LogRetentionV1;
  communityPlugins: CommunityPluginsV1;
  mediaDevices: MediaDevicesV1; hostMounts: HostMountsV1; virtioFsShares: VirtioFsSharesV1;
  processInterop: ProcessInteropV1; hostPeers: HostPeersV1; notebookEnvironments: NotebookEnvironmentsV1;
  browserIde: BrowserIdeV1; coldMigrations: ColdMigrationsV1; snapshotReplications: SnapshotReplicationsV1;
  haHostFailover: HaHostFailoverV1; haLocalFailovers: HaLocalFailoversV1; disasterRecovery: DisasterRecoveryDrillV1;
  trustedBoot: TrustedBootServiceV1; projectTerminals: ProjectTerminalsV1;
  capabilityChecks: CapabilityChecksV1;
}
export type HostServiceResolver = {
/**
 * 签名 / Signature: HostServiceResolver.optional.
 * 功能：为声明宿主服务解析器接口及无服务默认值声明 optional 的输入与结果契约，所属容器为 HostServiceResolver。
 * Purpose: Declares the input/result contract for optional in HostServiceResolver. Module responsibility: Declares the host resolver and absent-service default, restricting optional domain dependencies to named contracts.
 * 输入 / Inputs: id: K
 * 输出 / Returns: HostServiceContracts[K] | undefined.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
optional<K extends keyof HostServiceContracts>(id: K): HostServiceContracts[K] | undefined };
export const noHostServices: HostServiceResolver = Object.freeze({
/**
 * 入口 / Entry: optional.
 * 功能：从当前输入或状态计算 `undefined`，供调用方后续验证或使用。
 * Purpose: Computes `undefined` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `undefined`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
optional: () => undefined });
