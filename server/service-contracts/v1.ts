import type * as IncidentContracts from './incident-desk.ts';
import type * as IncidentReviewContracts from './incident-reviews.ts';
import type * as IncidentExchangeContracts from './incident-exchange.ts';
import type * as IncidentWorkbenchContracts from './incident-workbench.ts';
export interface IncidentCasesV1 extends IncidentContracts.IncidentCasesV1 {}
export interface IncidentEvidenceV1 extends IncidentContracts.IncidentEvidenceV1 {}
export interface IncidentTimelineV1 extends IncidentContracts.IncidentTimelineV1 {}
export interface IncidentHypothesesV1 extends IncidentContracts.IncidentHypothesesV1 {}
export interface IncidentRunbooksV1 extends IncidentContracts.IncidentRunbooksV1 {}
export interface IncidentActionsV1 extends IncidentContracts.IncidentActionsV1 {}
export interface IncidentReviewsV1 extends IncidentReviewContracts.IncidentReviewsV1 {}
export interface IncidentReportsV1 extends IncidentReviewContracts.IncidentReportsV1 {}
export interface IncidentExchangeV1 extends IncidentExchangeContracts.IncidentExchangeV1 {}
export interface IncidentWorkbenchV1 extends IncidentWorkbenchContracts.IncidentWorkbenchV1 {}
import type * as SnapshotContracts from './incident-snapshots.ts';
export interface MetricsSnapshotsV1 extends SnapshotContracts.MetricsSnapshotsV1 {}
export interface HealthSnapshotsV1 extends SnapshotContracts.HealthSnapshotsV1 {}
import type * as DelegatedContracts from './delegated-actions.ts';
export interface DelegatedActionsV1 extends DelegatedContracts.DelegatedActionsV1 {}
export interface MaintenanceActionsV1 extends DelegatedContracts.MaintenanceActionsV1 {}
export interface ResilienceActionsV1 extends DelegatedContracts.ResilienceActionsV1 {}
import type * as LocaleContracts from './locale-studio.ts';
export interface LocaleCatalogsV1 extends LocaleContracts.LocaleCatalogsV1 {}
export interface LocaleContextsV1 extends LocaleContracts.LocaleContextsV1 {}
export interface LocaleTerminologyV1 extends LocaleContracts.LocaleTerminologyV1 {}
export interface LocaleTranslationsV1 extends LocaleContracts.LocaleTranslationsV1 {}
export interface LocaleChecksV1 extends LocaleContracts.LocaleChecksV1 {}
export interface LocalePreviewsV1 extends LocaleContracts.LocalePreviewsV1 {}
export interface LocaleReviewsV1 extends LocaleContracts.LocaleReviewsV1 {}
export interface LocaleReleasesV1 extends LocaleContracts.LocaleReleasesV1 {}
export interface LocaleExchangeV1 extends LocaleContracts.LocaleExchangeV1 {}
export interface LocaleWorkbenchV1 extends LocaleContracts.LocaleWorkbenchV1 {}
import type * as SupplyContracts from './supply-audit.ts';
export interface SupplySourcesV1 extends SupplyContracts.SupplySourcesV1 {}
export interface SupplyInventoryV1 extends SupplyContracts.SupplyInventoryV1 {}
export interface SupplyAdvisoriesV1 extends SupplyContracts.SupplyAdvisoriesV1 {}
export interface SupplyLicensesV1 extends SupplyContracts.SupplyLicensesV1 {}
export interface SupplyProvenanceV1 extends SupplyContracts.SupplyProvenanceV1 {}
export interface SupplyPoliciesV1 extends SupplyContracts.SupplyPoliciesV1 {}
export interface SupplyReviewsV1 extends SupplyContracts.SupplyReviewsV1 {}
export interface SupplyReportsV1 extends SupplyContracts.SupplyReportsV1 {}
export interface SupplyExchangeV1 extends SupplyContracts.SupplyExchangeV1 {}
export interface SupplyWorkbenchV1 extends SupplyContracts.SupplyWorkbenchV1 {}
import type * as IntegrationContracts from './integration-lab.ts';
export interface IntegrationSpecsV1 extends IntegrationContracts.IntegrationSpecsV1 {}
export interface IntegrationEnvironmentsV1 extends IntegrationContracts.IntegrationEnvironmentsV1 {}
export interface IntegrationFixturesV1 extends IntegrationContracts.IntegrationFixturesV1 {}
export interface IntegrationMocksV1 extends IntegrationContracts.IntegrationMocksV1 {}
export interface IntegrationScenariosV1 extends IntegrationContracts.IntegrationScenariosV1 {}
export interface IntegrationAssertionsV1 extends IntegrationContracts.IntegrationAssertionsV1 {}
export interface IntegrationRunnersV1 extends IntegrationContracts.IntegrationRunnersV1 {}
export interface IntegrationLoadV1 extends IntegrationContracts.IntegrationLoadV1 {}
export interface IntegrationReportsV1 extends IntegrationContracts.IntegrationReportsV1 {}
export interface IntegrationExchangeV1 extends IntegrationContracts.IntegrationExchangeV1 {}
export interface IntegrationWorkbenchV1 extends IntegrationContracts.IntegrationWorkbenchV1 {}
import type * as ResilienceContracts from './resilience-lab.ts';
export interface ResilienceTargetsV1 extends ResilienceContracts.ResilienceTargetsV1 {}
export interface ResilienceFixturesV1 extends ResilienceContracts.ResilienceFixturesV1 {}
export interface ResilienceGuardV1 extends ResilienceContracts.ResilienceGuardV1 {}
export interface ResilienceFaultsV1 extends ResilienceContracts.ResilienceFaultsV1 {}
export interface ResilienceProbesV1 extends ResilienceContracts.ResilienceProbesV1 {}
export interface ResilienceRecoveryV1 extends ResilienceContracts.ResilienceRecoveryV1 {}
export interface ResilienceScenariosV1 extends ResilienceContracts.ResilienceScenariosV1 {}
export interface ResilienceRunsV1 extends ResilienceContracts.ResilienceRunsV1 {}
export interface ResilienceReportsV1 extends ResilienceContracts.ResilienceReportsV1 {}
export interface ResilienceWorkbenchV1 extends ResilienceContracts.ResilienceWorkbenchV1 {}
import type * as KnowledgeContracts from './knowledge-studio.ts';
export interface KnowledgeSourcesV1 extends KnowledgeContracts.KnowledgeSourcesV1 {}
export interface KnowledgeExtractV1 extends KnowledgeContracts.KnowledgeExtractV1 {}
export interface KnowledgeIndexV1 extends KnowledgeContracts.KnowledgeIndexV1 {}
export interface KnowledgeEvidenceV1 extends KnowledgeContracts.KnowledgeEvidenceV1 {}
export interface KnowledgeEntriesV1 extends KnowledgeContracts.KnowledgeEntriesV1 {}
export interface KnowledgeDocumentsV1 extends KnowledgeContracts.KnowledgeDocumentsV1 {}
export interface KnowledgeReviewsV1 extends KnowledgeContracts.KnowledgeReviewsV1 {}
export interface KnowledgePublishV1 extends KnowledgeContracts.KnowledgePublishV1 {}
export interface KnowledgeExchangeV1 extends KnowledgeContracts.KnowledgeExchangeV1 {}
export interface KnowledgeWorkbenchV1 extends KnowledgeContracts.KnowledgeWorkbenchV1 {}
import type { FilesV2 as FilesV2Contract } from './files-v2.ts';
export interface FilesV2 extends FilesV2Contract {}
import type { PreparedWorkerSessionsV1 as PreparedWorkerSessionsContract } from './prepared-worker-sessions.ts';
export interface PreparedWorkerSessionsV1 extends PreparedWorkerSessionsContract {}
import type { DrillSupervisionV1 as DrillSupervisionContract } from './drill-supervision.ts';
export interface DrillSupervisionV1 extends DrillSupervisionContract {}

import type * as FoundryContracts from './foundry.ts';
export interface FoundrySourcesV1 extends FoundryContracts.FoundrySourcesV1 {}
export interface FoundryBlueprintsV1 extends FoundryContracts.FoundryBlueprintsV1 {}
export interface FoundryDepotV1 extends FoundryContracts.FoundryDepotV1 {}
export interface FoundryBuildersV1 extends FoundryContracts.FoundryBuildersV1 {}
export interface FoundrySanitizersV1 extends FoundryContracts.FoundrySanitizersV1 {}
export interface FoundryChecksV1 extends FoundryContracts.FoundryChecksV1 {}
export interface FoundryCatalogV1 extends FoundryContracts.FoundryCatalogV1 {}
export interface FoundryExchangeV1 extends FoundryContracts.FoundryExchangeV1 {}
export interface FoundryWorkbenchV1 extends FoundryContracts.FoundryWorkbenchV1 {}
import type * as AppContracts from './app-runtime.ts';
export interface AppTargetsV1 extends AppContracts.AppTargetsV1 {}
export interface AppPackagesV1 extends AppContracts.AppPackagesV1 {}
export interface AppConfigV1 extends AppContracts.AppConfigV1 {}
export interface AppDataV1 extends AppContracts.AppDataV1 {}
export interface AppObserveV1 extends AppContracts.AppObserveV1 {}
export interface AppRoutesV1 extends AppContracts.AppRoutesV1 {}
export interface AppRecoveryV1 extends AppContracts.AppRecoveryV1 {}
export interface AppDeployV1 extends AppContracts.AppDeployV1 {}
export interface AppWorkbenchV1 extends AppContracts.AppWorkbenchV1 {}
import type * as DataContracts from './data-lab.ts';
export interface DataRuntimeV1 extends DataContracts.DataRuntimeV1 {}
export interface DataSourcesV1 extends DataContracts.DataSourcesV1 {}
export interface DataDatasetsV1 extends DataContracts.DataDatasetsV1 {}
export interface DataTransformsV1 extends DataContracts.DataTransformsV1 {}
export interface DataQualityV1 extends DataContracts.DataQualityV1 {}
export interface DataNotebooksV1 extends DataContracts.DataNotebooksV1 {}
export interface DataExperimentsV1 extends DataContracts.DataExperimentsV1 {}
export interface DataLineageV1 extends DataContracts.DataLineageV1 {}
export interface DataExchangeV1 extends DataContracts.DataExchangeV1 {}
export interface DataWorkbenchV1 extends DataContracts.DataWorkbenchV1 {}
import type * as ImageContracts from './image-assets.ts';
export interface ImageAssetsV1 extends ImageContracts.ImageAssetsV1 {}
import type * as EgressContracts from './egress-rules.ts';
export interface EgressRulesV1 extends EgressContracts.EgressRulesV1 {}
import type * as NotebookV2Contracts from './data-notebook-sessions.ts';
export interface NotebookEnvironmentsV2 extends NotebookV2Contracts.NotebookEnvironmentsV2 {}

/**
 * 模块职责：维护独立于实现的 V1 公共服务接口；成员变化属于显式契约修订，初始化仍由提供者负责。
 * Module purpose: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
 */
import type WebSocket from 'ws';
import type { DomainRecoveryTicket } from '../../shared/contracts/domain-recovery.ts';
import type { RecoveryView, RecoveryDiagnostics, RecoveryCatalogView } from '../../shared/contracts/recovery.ts';
import type { TrustedUpdateView } from '../../shared/contracts/trusted-update.ts';
import type { RepairSession } from '../../shared/contracts/repair-session.ts';
import type { DeliveryArtifactsV1 as DeliveryArtifactsContract } from './delivery-storage.ts';
import type { DeliveryInputsV1 as DeliveryInputsContract } from './delivery-storage.ts';
import type { DeliveryRunnersV1 as DeliveryRunnersContract } from './delivery-execution.ts';
import type { DeliveryPreviewsV1 as DeliveryPreviewsContract } from './delivery-execution.ts';
import type { DeliveryReportsV1 as DeliveryReportsContract } from './delivery-quality.ts';
import type { DeliveryGatesV1 as DeliveryGatesContract } from './delivery-quality.ts';
import type { DeliveryReleasesV1 as DeliveryReleasesContract } from './delivery-quality.ts';
import type { DeliveryWorkbenchV1 as DeliveryWorkbenchContract } from './delivery-workbench.ts';

export interface DeliveryArtifactsV1 extends DeliveryArtifactsContract {}
export interface DeliveryInputsV1 extends DeliveryInputsContract {}
export interface DeliveryRunnersV1 extends DeliveryRunnersContract {}
export interface DeliveryPreviewsV1 extends DeliveryPreviewsContract {}
export interface DeliveryReportsV1 extends DeliveryReportsContract {}
export interface DeliveryGatesV1 extends DeliveryGatesContract {}
export interface DeliveryReleasesV1 extends DeliveryReleasesContract {}
export interface DeliveryWorkbenchV1 extends DeliveryWorkbenchContract {}

/** 可选修复插件的单文件会话契约；模型发送、验证和应用分别确认。
 * Single-file repair sessions separate model transmission, validation and application. */
export interface RepairSessionsV1 {
  /** 读取属于实例项目的快照。Read the VM/project-owned snapshot. */
  view(id: string, sessionId: string): RepairSession;
  /** 选择文件并预览脱敏内容。Select files and preview redacted content. */
  preview(id: string, input: unknown, signal?: AbortSignal): Promise<RepairSession>;
  /** 确认发送后生成补丁。Generate a patch after transmission confirmation. */
  generate(id: string, sessionId: string, signal?: AbortSignal): Promise<RepairSession>;
  /** 执行受控隔离验证。Perform controlled isolated validation. */
  validate(id: string, input: unknown, signal?: AbortSignal): Promise<RepairSession>;
  /** 复核并应用已验证的补丁。Recheck and apply a validated patch. */
  apply(id: string, sessionId: string, signal?: AbortSignal): Promise<RepairSession>;
  /** 取消会话并等待资源清理。Cancel the session and await resource cleanup. */
  cancel(id: string, sessionId: string): Promise<{ ok: true }>;
}

/** 本体更新中心只公开状态和经过信任校验的管理动作；安装根和进程能力留在服务内部。
 * The core update service exposes state and trust-checked actions; installation roots and process authority stay private. */
export interface TrustedUpdatesV1 {
  /** 读取信任策略及活动/候选版本。Read trust policy and active/candidate releases. */
  view(): Promise<TrustedUpdateView>;
  /** 校验输入及当前权限后执行动作，可取消等待。Validate input and current authority before an abortable action. */
  action(input: unknown, signal?: AbortSignal): Promise<TrustedUpdateView>;
  /** 取消并等待本服务任务。Cancel and await owned operations. */
  close(): Promise<void>;
}

/** JSON Schema data published by the operation catalog; Zod's builder and metadata stay private. */
export type OperationJsonSchemaV1 = {
  [keyword: string]: unknown;
  $schema?: string; $id?: string; $ref?: string; $anchor?: string; $comment?: string;
  $defs?: Record<string, OperationJsonSchemaV1>;
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null' |
    Array<'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'>;
  properties?: Record<string, OperationJsonSchemaV1 | boolean>;
  patternProperties?: Record<string, OperationJsonSchemaV1 | boolean>;
  additionalProperties?: OperationJsonSchemaV1 | boolean;
  required?: string[];
  items?: OperationJsonSchemaV1 | boolean | Array<OperationJsonSchemaV1 | boolean>;
  prefixItems?: Array<OperationJsonSchemaV1 | boolean>;
  allOf?: OperationJsonSchemaV1[]; anyOf?: OperationJsonSchemaV1[]; oneOf?: OperationJsonSchemaV1[];
  not?: OperationJsonSchemaV1 | boolean;
  enum?: unknown[]; const?: unknown; default?: unknown;
  minimum?: number; maximum?: number; exclusiveMinimum?: number | boolean; exclusiveMaximum?: number | boolean;
  multipleOf?: number; minLength?: number; maxLength?: number; pattern?: string; format?: string;
  minItems?: number; maxItems?: number; uniqueItems?: boolean;
  minProperties?: number; maxProperties?: number;
  title?: string; description?: string; examples?: unknown[];
  deprecated?: boolean; readOnly?: boolean; writeOnly?: boolean;
};

/** Version 1 public service contracts. Owned independently of service implementations.
 * Changes to these declarations are intentional contract revisions. Initialization stays with providers. */

export interface FeatureSuiteV1 {
  readonly "jobs": JobsV1;
  readonly "packageWorkbench": PackageWorkbenchV1;
  /**
   * 签名 / Signature: FeatureSuiteV1.enableBackground.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 enableBackground 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for enableBackground in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: () => void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "enableBackground": () => () => void;
  /**
   * 签名 / Signature: FeatureSuiteV1.catalog.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 catalog 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for catalog in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ features: import("../../shared/catalogs/automation.ts").FeatureCatalogItem[]; capabilities: import("../../shared/capability-actions.ts").CapabilityActionView[]; pres….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "catalog": () => Promise<{
    features: import("../../shared/catalogs/automation.ts").FeatureCatalogItem[];
    capabilities: import("../../shared/capability-actions.ts").CapabilityActionView[];
    presets: {
        readonly light: {
            readonly name: "轻量命令行";
            readonly memoryMiB: 512;
            readonly cpus: 1;
        };
        readonly development: {
            readonly name: "日常开发";
            readonly memoryMiB: 2048;
            readonly cpus: 2;
        };
        readonly build: {
            readonly name: "编译构建";
            readonly memoryMiB: 4096;
            readonly cpus: 4;
        };
        readonly desktop: {
            readonly name: "图形桌面";
            readonly memoryMiB: 2048;
            readonly cpus: 2;
        };
    };
    generatedAt: string;
}>;
  /**
   * 签名 / Signature: FeatureSuiteV1.alertEvents.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 alertEvents 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for alertEvents in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<AlertEventV1[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "alertEvents": () => Promise<AlertEventV1[]>;
  /**
   * 签名 / Signature: FeatureSuiteV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for view in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; limit: number optional
   * 输出 / Returns: Promise<{ projectId: string; settings: { schedule: { enabled: boolean; idleMinutes: number; idleAction: "stop"; startAt?: string | undefined; stopAt?: string | undefined; }; a….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string, limit?: number) => Promise<{
    projectId: string;
    settings: {
        schedule: {
            enabled: boolean;
            idleMinutes: number;
            idleAction: "stop";
            startAt?: string | undefined;
            stopAt?: string | undefined;
        };
        alerts: {
            enabled: boolean;
            cpuPercent: number;
            memoryPercent: number;
            diskPercent: number;
            cooldownMinutes: number;
            taskFailures: boolean;
            serviceFailures: boolean;
            secretRotation: boolean;
        };
        updatedAt: string;
    };
    history: MetricPointV1[];
    events: AlertEventV1[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    devJob: import("../../shared/contracts/jobs.ts").JobView | null;
    presets: {
        readonly light: {
            readonly name: "轻量命令行";
            readonly memoryMiB: 512;
            readonly cpus: 1;
        };
        readonly development: {
            readonly name: "日常开发";
            readonly memoryMiB: 2048;
            readonly cpus: 2;
        };
        readonly build: {
            readonly name: "编译构建";
            readonly memoryMiB: 4096;
            readonly cpus: 4;
        };
        readonly desktop: {
            readonly name: "图形桌面";
            readonly memoryMiB: 2048;
            readonly cpus: 2;
        };
    };
    features: import("../../shared/catalogs/automation.ts").FeatureCatalogItem[];
    featureRuns: {
        featureId: "image-import" | "golden-images" | "multi-arch" | "power-schedules" | "idle-shutdown" | "dynamic-memory" | "online-snapshots" | "snapshot-diff" | "disk-maintenance" | "resource-presets" | "windows-mount" | "file-drop" | "workspace-search" | "disk-analyzer" | "resumable-transfer" | "three-way-sync" | "directory-history" | "binary-preview" | "language-services" | "debug-adapter" | "test-explorer" | "format-lint" | "git-worktrees" | "merge-editor" | "dependency-report" | "runtime-matrix" | "package-manager" | "reproducible-env" | "dev-container" | "browser-preview" | "database-presets" | "ai-assistant" | "port-discovery" | "reverse-proxy" | "network-profiles" | "vpn-integration" | "network-diagnostics" | "package-cache" | "service-dashboard" | "gpu-acceleration" | "audio-video" | "single-app-windows" | "process-interop" | "native-integration" | "multi-monitor" | "metrics-history" | "alerts" | "security-scan" | "rbac-sharing" | "plugin-api";
        startedAt: string;
        finishedAt: string;
        result: Record<string, unknown>;
    }[];
    capabilities: import("../../shared/capability-actions.ts").CapabilityActionView[];
    capabilityJobs: import("../../shared/contracts/jobs.ts").JobView[];
}>;
  /**
   * 签名 / Signature: FeatureSuiteV1.feature.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 feature 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for feature in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: { featureId: "image-import" | "golden-images" | "multi-arch" | "power-schedules" | "i…; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<Record<string, unknown> | import("../../shared/contracts/jobs.ts").JobView | { message: string; reason?: string | undefined; ready: boolean; executed: boolean; enabled….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "feature": (id: string, input: {
    featureId: "image-import" | "golden-images" | "multi-arch" | "power-schedules" | "idle-shutdown" | "dynamic-memory" | "online-snapshots" | "snapshot-diff" | "disk-maintenance" | "resource-presets" | "windows-mount" | "file-drop" | "workspace-search" | "disk-analyzer" | "resumable-transfer" | "three-way-sync" | "directory-history" | "binary-preview" | "language-services" | "debug-adapter" | "test-explorer" | "format-lint" | "git-worktrees" | "merge-editor" | "dependency-report" | "runtime-matrix" | "package-manager" | "reproducible-env" | "dev-container" | "browser-preview" | "database-presets" | "ai-assistant" | "port-discovery" | "reverse-proxy" | "network-profiles" | "vpn-integration" | "network-diagnostics" | "package-cache" | "service-dashboard" | "gpu-acceleration" | "audio-video" | "single-app-windows" | "process-interop" | "native-integration" | "multi-monitor" | "metrics-history" | "alerts" | "security-scan" | "rbac-sharing" | "plugin-api";
    action: "check" | "run";
    options?: Record<string, unknown> | undefined;
}, signal?: AbortSignal | undefined) => Promise<Record<string, unknown> | import("../../shared/contracts/jobs.ts").JobView | {
    message: string;
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    programs: {
        programId: string;
        executable: string;
        fixedArgs: string[];
        sha256: string;
    }[];
    programId?: undefined;
    sha256?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256: string;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256?: undefined;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    programId?: undefined;
    sha256?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    installed: boolean;
    reason: string | undefined;
    programId?: undefined;
    sha256?: undefined;
    enabled?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    command: string;
    programId?: undefined;
    sha256?: undefined;
    reason?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    featureId: "ipv6" | "resource-presets" | "workspace-search" | "disk-analyzer" | "directory-history" | "format-lint" | "git-worktrees" | "dependency-report" | "runtime-matrix" | "reproducible-env" | "network-diagnostics" | "gpu-acceleration" | "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "syscall-profile" | "ssh-agent-forward" | "gpg-agent-forward" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "project-quota" | "guest-quota" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "network-quota" | "egress-policy" | "nat-hairpin" | "power-aware-schedule" | "host-disk-health" | "availability-report" | "global-dedup" | "audit-log" | "otel-tracing" | "dependency-bot" | "cpu-topology" | "device-profiles" | "resource-reservation" | "vcpu-hotplug" | "memory-hotplug" | "crash-loop-guard" | "maintenance-windows" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "patch-bundle" | "environment-recreate" | "editor-profiles" | "metrics-export" | "event-timeline" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "anomaly-detection" | "log-index" | "test-sharding" | "review-comments" | "command-forms" | "vm-dependency-start" | "environment-parity" | "test-matrix" | "cross-vm-copy" | "network-topology" | "packet-capture" | "reverse-tunnel" | "code-search-index" | "language-server-catalog" | "pii-classification";
    reason: string;
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        egressKbps: number;
        burstKiB: number;
        latencyMs: number;
        maxTcpConnections: number;
        newTcpConnectionsPerSecond: number;
        connectionBurst: number;
    };
    previous: string;
    current: string;
    active: boolean;
    connectionPolicyActive: boolean;
    featureId: "network-quota";
    reason?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        egressKbps: number;
        burstKiB: number;
        latencyMs: number;
        maxTcpConnections: number;
        newTcpConnectionsPerSecond: number;
        connectionBurst: number;
    };
    current: string;
    active: boolean;
    connectionControlsAvailable: boolean;
    connectionPolicyActive: boolean;
    connectionRules: JumpV1[];
    reason?: undefined;
    featureId: "network-quota";
} | {
    active: boolean;
    persistent: boolean;
    fstabEntry: string | null;
    mount: string | null;
    capacityMiB: number | null;
    usedMiB: number | null;
    availableMiB: number | null;
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    limitMiB: number;
    reason?: undefined;
    featureId: "project-quota";
} | {
    reason?: string | undefined;
    active: boolean;
    persistent: boolean;
    fstabEntry: string | null;
    mount: string | null;
    capacityMiB: number | null;
    usedMiB: number | null;
    availableMiB: number | null;
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    limitMiB: number | null;
    phase: string;
    featureId: "project-quota";
} | {
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    uid: number;
    hardMiB: number;
    active: boolean;
    report: string;
    reason: undefined;
    featureId: "guest-quota";
} | {
    ready: boolean;
    active: boolean;
    missing: string[];
    report: string;
    reason: string | undefined;
    executed: boolean;
    projectId: string;
    directory: string;
    uid: number;
    projectLimitMiB: number | null;
    featureId: "guest-quota";
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        allowedDestinations: string[];
        ipv6: string;
    };
    active: boolean;
    removed: number;
    featureId: "egress-policy";
    reason?: undefined;
} | {
    reason?: string | undefined;
    cleanupWarnings?: string[] | undefined;
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        allowedDestinations: string[];
        ipv6: string;
    };
    active: boolean;
    rules: JumpV1[];
    removed?: undefined;
    featureId: "egress-policy";
} | {
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    preview: {
        forwards: {
            name: string | undefined;
            hostPort: number;
            guestPort: number;
            guestAddress: string;
        }[];
        selected: {
            name: string | undefined;
            hostPort: number;
            guestPort: number;
            guestAddress: string;
        } | undefined;
        guestAddress: string;
    };
    exitCode: number;
    checkedAt: string;
    featureId: "nat-hairpin";
}>;
  /**
   * 签名 / Signature: FeatureSuiteV1.update.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 update 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for update in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<{ schedule: { enabled: boolean; idleMinutes: number; idleAction: "stop"; startAt?: string | undefined; stopAt?: string | undefined; }; alerts: { enabled: boolean; cpuP….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "update": (id: string, input: unknown) => Promise<{
    schedule: {
        enabled: boolean;
        idleMinutes: number;
        idleAction: "stop";
        startAt?: string | undefined;
        stopAt?: string | undefined;
    };
    alerts: {
        enabled: boolean;
        cpuPercent: number;
        memoryPercent: number;
        diskPercent: number;
        cooldownMinutes: number;
        taskFailures: boolean;
        serviceFailures: boolean;
        secretRotation: boolean;
    };
    updatedAt: string;
}>;
  /**
   * 签名 / Signature: FeatureSuiteV1.sample.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 sample 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for sample in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ cpuPercent: number; memoryUsed: number; memoryTotal: number; diskUsed: number; diskTotal: number; networkReceivedBytes: number | null; networkTransmittedBytes: numbe….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "sample": (id: string) => Promise<{
    cpuPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    diskUsed: number;
    diskTotal: number;
    networkReceivedBytes: number | null;
    networkTransmittedBytes: number | null;
    networkInterfaces: {
        name: string;
        receivedBytes: number;
        transmittedBytes: number;
    }[];
    networkReceiveBytesPerSecond: number | null;
    networkTransmitBytesPerSecond: number | null;
    processes: {
        name: string;
        memory: number;
    }[];
    uptime: number;
    sampledAt: string;
}>;
  /**
   * 签名 / Signature: FeatureSuiteV1.memoryTarget.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 memoryTarget 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for memoryTarget in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; memoryMiB: number
   * 输出 / Returns: Promise<import("../../shared/contracts/vm.ts").VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "memoryTarget": (id: string, memoryMiB: number) => Promise<import("../../shared/contracts/vm.ts").VMView>;
  /**
   * 签名 / Signature: FeatureSuiteV1.applyPreset.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 applyPreset 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for applyPreset in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; preset: "light" | "development" | "build" | "desktop"
   * 输出 / Returns: Promise<import("../../shared/contracts/vm.ts").VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "applyPreset": (id: string, preset: "light" | "development" | "build" | "desktop") => Promise<import("../../shared/contracts/vm.ts").VMView>;
  /**
   * 签名 / Signature: FeatureSuiteV1.diskAnalysis.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 diskAnalysis 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for diskAnalysis in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: { path?: string | undefined; }; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ path: string; entries: { path: string; bytes: number; }[]; checkedAt: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "diskAnalysis": (id: string, input: {
    path?: string | undefined;
}, signal?: AbortSignal | undefined) => Promise<{
    path: string;
    entries: {
        path: string;
        bytes: number;
    }[];
    checkedAt: string;
}>;
  /**
   * 签名 / Signature: FeatureSuiteV1.dev.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 dev 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for dev in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: Omit<{ action: "dev"; operation: "format" | "lint" | "dependencies" | "test" | "datab…; signal: AbortSignal | undefined optional
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "dev": (id: string, input: Omit<{
    action: "dev";
    operation: "format" | "lint" | "dependencies" | "test" | "database" | "test-discover" | "lock" | "lock-check" | "install-locked" | "prefetch-dependencies" | "install-cached-dependencies" | "worktree-list" | "worktree-add" | "worktree-remove";
    branch?: string | undefined;
    path?: string | undefined;
    database?: "postgres" | "redis" | "mysql" | undefined;
    name?: string | undefined;
    port?: number | undefined;
    password?: string | undefined;
    manager?: "npm" | "pip" | undefined;
}, "action">, signal?: AbortSignal | undefined) => import("../../shared/contracts/jobs.ts").JobView;
  /**
   * 签名 / Signature: FeatureSuiteV1.acknowledge.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 acknowledge 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for acknowledge in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; eventId: string
   * 输出 / Returns: Promise<AlertEventV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "acknowledge": (id: string, eventId: string) => Promise<AlertEventV1>;
  /**
   * 签名 / Signature: FeatureSuiteV1.search.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 search 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for search in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: { query: string; path?: string | undefined; content?: boolean | undefined; }; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ query: string; path: string; content: boolean; matches: string[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "search": (id: string, input: {
    query: string;
    path?: string | undefined;
    content?: boolean | undefined;
}, signal?: AbortSignal | undefined) => Promise<{
    query: string;
    path: string;
    content: boolean;
    matches: string[];
}>;
  /**
   * 签名 / Signature: FeatureSuiteV1.package.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 package 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for package in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: Omit<{ action: "package"; operation: "list" | "update" | "remove" | "install" | "sear…; signal: AbortSignal | undefined optional
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "package": (id: string, input: Omit<{
    action: "package";
    operation: "list" | "update" | "remove" | "install" | "search" | "upgrade" | "upgrade-all" | "cache-list" | "cache-prefetch" | "cache-install" | "cache-clear";
    name?: string | undefined;
}, "action">, signal?: AbortSignal | undefined) => import("../../shared/contracts/jobs.ts").JobView;
  /**
   * 签名 / Signature: FeatureSuiteV1.networkTest.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 networkTest 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for networkTest in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; target: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ target: string; output: string; code: number; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "networkTest": (id: string, target: string, signal?: AbortSignal | undefined) => Promise<{
    target: string;
    output: string;
    code: number;
}>;
  /**
   * 签名 / Signature: FeatureSuiteV1.discoverPorts.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 discoverPorts 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for discoverPorts in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ ports: number[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "discoverPorts": (id: string, signal?: AbortSignal | undefined) => Promise<{
    ports: number[];
}>;
  /**
   * 签名 / Signature: FeatureSuiteV1.securityScan.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 securityScan 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for securityScan in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ checkedAt: string; findings: string[]; output: string; code: number; vulnerabilityScan: VulnerabilityScanV1; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "securityScan": (id: string, signal?: AbortSignal | undefined) => Promise<{
    checkedAt: string;
    findings: string[];
    output: string;
    code: number;
    vulnerabilityScan: VulnerabilityScanV1;
}>;
  /**
   * 签名 / Signature: FeatureSuiteV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for action in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<AlertEventV1 | Record<string, unknown> | import("../../shared/contracts/jobs.ts").JobView | { message: string; reason?: string | undefined; ready: boolean; executed: b….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, input: unknown, signal?: AbortSignal | undefined) => Promise<AlertEventV1 | Record<string, unknown> | import("../../shared/contracts/jobs.ts").JobView | {
    message: string;
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    programs: {
        programId: string;
        executable: string;
        fixedArgs: string[];
        sha256: string;
    }[];
    programId?: undefined;
    sha256?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256: string;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256?: undefined;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    programId?: undefined;
    sha256?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    installed: boolean;
    reason: string | undefined;
    programId?: undefined;
    sha256?: undefined;
    enabled?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    command: string;
    programId?: undefined;
    sha256?: undefined;
    reason?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    featureId: "ipv6" | "resource-presets" | "workspace-search" | "disk-analyzer" | "directory-history" | "format-lint" | "git-worktrees" | "dependency-report" | "runtime-matrix" | "reproducible-env" | "network-diagnostics" | "gpu-acceleration" | "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "syscall-profile" | "ssh-agent-forward" | "gpg-agent-forward" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "project-quota" | "guest-quota" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "network-quota" | "egress-policy" | "nat-hairpin" | "power-aware-schedule" | "host-disk-health" | "availability-report" | "global-dedup" | "audit-log" | "otel-tracing" | "dependency-bot" | "cpu-topology" | "device-profiles" | "resource-reservation" | "vcpu-hotplug" | "memory-hotplug" | "crash-loop-guard" | "maintenance-windows" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "patch-bundle" | "environment-recreate" | "editor-profiles" | "metrics-export" | "event-timeline" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "anomaly-detection" | "log-index" | "test-sharding" | "review-comments" | "command-forms" | "vm-dependency-start" | "environment-parity" | "test-matrix" | "cross-vm-copy" | "network-topology" | "packet-capture" | "reverse-tunnel" | "code-search-index" | "language-server-catalog" | "pii-classification";
    reason: string;
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        egressKbps: number;
        burstKiB: number;
        latencyMs: number;
        maxTcpConnections: number;
        newTcpConnectionsPerSecond: number;
        connectionBurst: number;
    };
    previous: string;
    current: string;
    active: boolean;
    connectionPolicyActive: boolean;
    featureId: "network-quota";
    reason?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        egressKbps: number;
        burstKiB: number;
        latencyMs: number;
        maxTcpConnections: number;
        newTcpConnectionsPerSecond: number;
        connectionBurst: number;
    };
    current: string;
    active: boolean;
    connectionControlsAvailable: boolean;
    connectionPolicyActive: boolean;
    connectionRules: JumpV1[];
    reason?: undefined;
    featureId: "network-quota";
} | {
    active: boolean;
    persistent: boolean;
    fstabEntry: string | null;
    mount: string | null;
    capacityMiB: number | null;
    usedMiB: number | null;
    availableMiB: number | null;
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    limitMiB: number;
    reason?: undefined;
    featureId: "project-quota";
} | {
    reason?: string | undefined;
    active: boolean;
    persistent: boolean;
    fstabEntry: string | null;
    mount: string | null;
    capacityMiB: number | null;
    usedMiB: number | null;
    availableMiB: number | null;
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    limitMiB: number | null;
    phase: string;
    featureId: "project-quota";
} | {
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    uid: number;
    hardMiB: number;
    active: boolean;
    report: string;
    reason: undefined;
    featureId: "guest-quota";
} | {
    ready: boolean;
    active: boolean;
    missing: string[];
    report: string;
    reason: string | undefined;
    executed: boolean;
    projectId: string;
    directory: string;
    uid: number;
    projectLimitMiB: number | null;
    featureId: "guest-quota";
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        allowedDestinations: string[];
        ipv6: string;
    };
    active: boolean;
    removed: number;
    featureId: "egress-policy";
    reason?: undefined;
} | {
    reason?: string | undefined;
    cleanupWarnings?: string[] | undefined;
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        allowedDestinations: string[];
        ipv6: string;
    };
    active: boolean;
    rules: JumpV1[];
    removed?: undefined;
    featureId: "egress-policy";
} | {
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    preview: {
        forwards: {
            name: string | undefined;
            hostPort: number;
            guestPort: number;
            guestAddress: string;
        }[];
        selected: {
            name: string | undefined;
            hostPort: number;
            guestPort: number;
            guestAddress: string;
        } | undefined;
        guestAddress: string;
    };
    exitCode: number;
    checkedAt: string;
    featureId: "nat-hairpin";
} | {
    cpuPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    diskUsed: number;
    diskTotal: number;
    networkReceivedBytes: number | null;
    networkTransmittedBytes: number | null;
    networkInterfaces: {
        name: string;
        receivedBytes: number;
        transmittedBytes: number;
    }[];
    networkReceiveBytesPerSecond: number | null;
    networkTransmitBytesPerSecond: number | null;
    processes: {
        name: string;
        memory: number;
    }[];
    uptime: number;
    sampledAt: string;
} | import("../../shared/contracts/vm.ts").VMView | {
    path: string;
    entries: {
        path: string;
        bytes: number;
    }[];
    checkedAt: string;
} | {
    query: string;
    path: string;
    content: boolean;
    matches: string[];
} | {
    target: string;
    output: string;
    code: number;
} | {
    ports: number[];
} | {
    checkedAt: string;
    findings: string[];
    output: string;
    code: number;
    vulnerabilityScan: VulnerabilityScanV1;
}>;
  /**
   * 签名 / Signature: FeatureSuiteV1.tick.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 tick 的输入与结果契约，所属容器为 FeatureSuiteV1。
   * Purpose: Declares the input/result contract for tick in FeatureSuiteV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "tick": () => Promise<void>;
}

export interface FeatureSchedulerV1 {

}

export interface BackupsV1 {
  /**
   * 签名 / Signature: BackupsV1.recoveryTickets.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 recoveryTickets 的输入与结果契约，所属容器为 BackupsV1。
   * Purpose: Declares the input/result contract for recoveryTickets in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<DomainRecoveryTicket[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "recoveryTickets": () => Promise<DomainRecoveryTicket[]>;
  /**
   * 签名 / Signature: BackupsV1.recoverTicket.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 recoverTicket 的输入与结果契约，所属容器为 BackupsV1。
   * Purpose: Declares the input/result contract for recoverTicket in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: ticket: DomainRecoveryTicket
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "recoverTicket": (ticket: DomainRecoveryTicket) => Promise<void>;
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: BackupsV1.downloadable.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 downloadable 的输入与结果契约，所属容器为 BackupsV1。
   * Purpose: Declares the input/result contract for downloadable in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; backupId: string
   * 输出 / Returns: Promise<BackupDownloadV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "downloadable": (id: string, backupId: string) => Promise<BackupDownloadV1>;
  /**
   * 签名 / Signature: BackupsV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 BackupsV1。
   * Purpose: Declares the input/result contract for view in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ bytes: number; job: import("../../shared/contracts/jobs.ts").JobView | null; waitingForShutdown: boolean; maintenance: boolean; policy: { enabled: boolean; intervalH….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => Promise<{
    bytes: number;
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    waitingForShutdown: boolean;
    maintenance: boolean;
    policy: {
        enabled: boolean;
        intervalHours: number;
        keep: number;
        maxGiB: number;
        lockDays?: number | undefined;
        deduplicate?: boolean | undefined;
        bandwidthMiBps?: number | undefined;
        directory?: string | undefined;
        passwordSecret?: string | undefined;
    };
    items: BackupRecordV1[];
    lastSuccess?: string | undefined;
}>;
  /**
   * 签名 / Signature: BackupsV1.policy.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 policy 的输入与结果契约，所属容器为 BackupsV1。
   * Purpose: Declares the input/result contract for policy in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; value: unknown
   * 输出 / Returns: Promise<BackupStateV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "policy": (id: string, value: unknown) => Promise<BackupStateV1>;
  /**
   * 签名 / Signature: BackupsV1.tick.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 tick 的输入与结果契约，所属容器为 BackupsV1。
   * Purpose: Declares the input/result contract for tick in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: now: number optional; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "tick": (now?: number, signal?: AbortSignal | undefined) => Promise<void>;
  /**
   * 签名 / Signature: BackupsV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 BackupsV1。
   * Purpose: Declares the input/result contract for run in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; password: string | undefined optional
   * 输出 / Returns: Promise<import("../../shared/contracts/jobs.ts").JobView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, password?: string | undefined) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
  /**
   * 签名 / Signature: BackupsV1.operate.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 operate 的输入与结果契约，所属容器为 BackupsV1。
   * Purpose: Declares the input/result contract for operate in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; backupId: string; action: "delete" | "restore" | "verify"; name: string | undefined optional; password: string | undefined optional
   * 输出 / Returns: Promise<import("../../shared/contracts/jobs.ts").JobView | { ok: boolean; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "operate": (id: string, backupId: string, action: "delete" | "restore" | "verify", name?: string | undefined, password?: string | undefined) => Promise<import("../../shared/contracts/jobs.ts").JobView | {
    ok: boolean;
}>;
  /**
   * 签名 / Signature: BackupsV1.withVerifiedFile.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 withVerifiedFile 的输入与结果契约，所属容器为 BackupsV1。
   * Purpose: Declares the input/result contract for withVerifiedFile in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; backupId: string; password: string | undefined; signal: AbortSignal; work: (file: string, lease: { id: string; release: () => void; assertActive: (checkSignal?:…; options: { extraBuffers?: number | undefined; writes?: boolean | undefined; writePaths?: reado… optional
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "withVerifiedFile": <T>(id: string, backupId: string, password: string | undefined, signal: AbortSignal, work: (file: string, lease: {
    id: string;
    /**
     * 签名 / Signature: BackupsV1.release.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 release 的输入与结果契约，所属容器为 BackupsV1。
     * Purpose: Declares the input/result contract for release in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    release: () => void;
    /**
     * 签名 / Signature: BackupsV1.assertActive.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 assertActive 的输入与结果契约，所属容器为 BackupsV1。
     * Purpose: Declares the input/result contract for assertActive in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: checkSignal: boolean optional
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    assertActive: (checkSignal?: boolean) => void;
    /**
     * 签名 / Signature: BackupsV1.reserveTemporary.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 reserveTemporary 的输入与结果契约，所属容器为 BackupsV1。
     * Purpose: Declares the input/result contract for reserveTemporary in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: path: string; bytes: number
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    reserveTemporary: (path: string, bytes: number) => Promise<void>;
    /**
     * 签名 / Signature: BackupsV1.releaseTemporary.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 releaseTemporary 的输入与结果契约，所属容器为 BackupsV1。
     * Purpose: Declares the input/result contract for releaseTemporary in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: path: string
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    releaseTemporary: (path: string) => Promise<void>;
    /**
     * 签名 / Signature: BackupsV1.cleanupPending.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 cleanupPending 的输入与结果契约，所属容器为 BackupsV1。
     * Purpose: Declares the input/result contract for cleanupPending in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: error: unknown
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    cleanupPending: (error: unknown) => void;
    readonly pendingCleanup: boolean;
    /**
     * 签名 / Signature: BackupsV1.transfer.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 transfer 的输入与结果契约，所属容器为 BackupsV1。
     * Purpose: Declares the input/result contract for transfer in BackupsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: owner: string
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    transfer: (owner: string) => void;
}, sourceFile: string) => Promise<T>, options?: {
    extraBuffers?: number | undefined;
    writes?: boolean | undefined;
    writePaths?: readonly string[] | undefined;
}) => Promise<T>;
}

export interface BackupRecoveryV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: BackupRecoveryV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 BackupRecoveryV1。
   * Purpose: Declares the input/result contract for view in BackupRecoveryV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: { runs: import("../../shared/contracts/jobs.ts").JobView[]; persistenceError: string | undefined; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => {
    runs: import("../../shared/contracts/jobs.ts").JobView[];
    persistenceError: string | undefined;
};
  /**
   * 签名 / Signature: BackupRecoveryV1.artifact.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 artifact 的输入与结果契约，所属容器为 BackupRecoveryV1。
   * Purpose: Declares the input/result contract for artifact in BackupRecoveryV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; run: string; artifact: string
   * 输出 / Returns: Promise<{ base64: string; id: string; name: string; path: string; bytes: number; sha256: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "artifact": (id: string, run: string, artifact: string) => Promise<{
    base64: string;
    id: string;
    name: string;
    path: string;
    bytes: number;
    sha256: string;
}>;
  /**
   * 签名 / Signature: BackupRecoveryV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 BackupRecoveryV1。
   * Purpose: Declares the input/result contract for run in BackupRecoveryV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, input: unknown) => import("../../shared/contracts/jobs.ts").JobView;
}

export interface CodeIntelligenceV1 {
  /**
   * 签名 / Signature: CodeIntelligenceV1.diagnose.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 diagnose 的输入与结果契约，所属容器为 CodeIntelligenceV1。
   * Purpose: Declares the input/result contract for diagnose in CodeIntelligenceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; path: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ path: string; diagnostics: DiagnosticV1[]; supported: boolean; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "diagnose": (id: string, path: string, signal?: AbortSignal | undefined) => Promise<{
    path: string;
    diagnostics: DiagnosticV1[];
    supported: boolean;
}>;
}

export interface LanguageServicesV1 {
  /**
   * 签名 / Signature: LanguageServicesV1.status.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 status 的输入与结果契约，所属容器为 LanguageServicesV1。
   * Purpose: Declares the input/result contract for status in LanguageServicesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; path: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ language: string; installed: boolean; supported: boolean; pending: { token: string; phase: "active" | "review" | "intent" | "closed"; needsReview: boolean; }[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "status": (id: string, path: string, signal?: AbortSignal | undefined) => Promise<{
    language: string;
    installed: boolean;
    supported: boolean;
    pending: {
        token: string;
        phase: "active" | "review" | "intent" | "closed";
        needsReview: boolean;
    }[];
}>;
  /**
   * 签名 / Signature: LanguageServicesV1.install.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 install 的输入与结果契约，所属容器为 LanguageServicesV1。
   * Purpose: Declares the input/result contract for install in LanguageServicesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ installed: boolean; languages: string[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "install": (id: string, signal?: AbortSignal | undefined) => Promise<{
    installed: boolean;
    languages: string[];
}>;
  readonly "execute": {
    /**
     * 中文功能：接收实例、文件内容和位置，异步返回带插入文本及范围的补全项。
     * English: Accepts VM, file content and position and asynchronously returns completion items with insertion text/ranges.
     * 所属 / Owner: LanguageServicesV1."execute".
     * 输入 / Inputs: id: string; input: { action: "completion"; path: string; content: string; position: import("../../shared/language-service.ts").LspPosition; }; signal?: AbortSignal | undefined.
     * 结果 / Result: `Promise<{ path: string; items: { label: string; detail: string; insertText: string; range: import("../../shared/language-service.ts").LspRange | null; }[]; }>`.
     */
    (id: string, input: {
        action: "completion";
        path: string;
        content: string;
        position: import("../../shared/language-service.ts").LspPosition;
    }, signal?: AbortSignal | undefined): Promise<{
        path: string;
        items: {
            label: string;
            detail: string;
            insertText: string;
            range: import("../../shared/language-service.ts").LspRange | null;
        }[];
    }>;
    /**
     * 中文功能：接收实例、文件内容和位置，异步返回定义的文件/行列位置。
     * English: Accepts VM, content and position and asynchronously returns definition file/line/column locations.
     * 所属 / Owner: LanguageServicesV1."execute".
     * 输入 / Inputs: id: string; input: { action: "definition"; path: string; content: string; position: import("../../shared/language-service.ts").LspPosition; }; signal?: AbortSignal | undefined.
     * 结果 / Result: `Promise<{ path: string; locations: { path: string; line: number; column: number; }[]; }>`.
     */
    (id: string, input: {
        action: "definition";
        path: string;
        content: string;
        position: import("../../shared/language-service.ts").LspPosition;
    }, signal?: AbortSignal | undefined): Promise<{
        path: string;
        locations: {
            path: string;
            line: number;
            column: number;
        }[];
    }>;
    /**
     * 中文功能：接收实例及文件内容，异步返回诊断是否收到及严重度/消息/行列。
     * English: Accepts VM/file content and asynchronously returns receipt status and diagnostic severity/message/positions.
     * 所属 / Owner: LanguageServicesV1."execute".
     * 输入 / Inputs: id: string; input: { action: "diagnostics"; path: string; content: string; }; signal?: AbortSignal | undefined.
     * 结果 / Result: `Promise<{ path: string; received: boolean; diagnostics: { severity: string; message: string; line: number; column: number; }[]; }>`.
     */
    (id: string, input: {
        action: "diagnostics";
        path: string;
        content: string;
    }, signal?: AbortSignal | undefined): Promise<{
        path: string;
        received: boolean;
        diagnostics: {
            severity: string;
            message: string;
            line: number;
            column: number;
        }[];
    }>;
    /**
     * 中文功能：接收实例、内容、位置、新名称和版本，异步返回变更 token 与文件前后文本。
     * English: Accepts VM, content, position, new name/version and returns a change token with before/after file text.
     * 所属 / Owner: LanguageServicesV1."execute".
     * 输入 / Inputs: id: string; input: { action: "rename"; path: string; content: string; position: import("../../shared/language-service.ts").LspPosition; newName: string; version: string; }; signal?: AbortSignal | undefined.
     * 结果 / Result: `Promise<{ token: string; files: { path: string; before: string; after: string; }[]; }>`.
     */
    (id: string, input: {
        action: "rename";
        path: string;
        content: string;
        position: import("../../shared/language-service.ts").LspPosition;
        newName: string;
        version: string;
    }, signal?: AbortSignal | undefined): Promise<{
        token: string;
        files: {
            path: string;
            before: string;
            after: string;
        }[];
    }>;
    /**
     * 中文功能：声明 diagnostics、completion、definition、rename 联合输入的兼容调用签名，异步返回对应动作结果。
     * English: Declares the compatibility call signature for diagnostics, completion, definition and rename union inputs, returning the corresponding action result asynchronously.
     * 所属 / Owner: LanguageServicesV1."execute".
     * 输入 / Inputs: id: string; input: { action: "diagnostics" | "completion" | "definition" | "rename"; path: string; content: string; position?: import("../../shared/language-service.ts").LspPosition | undefined; newName?: string | undefined; version?: string | undefined; }; signal?: AbortSignal | undefined.
     * 结果 / Result: `Promise<any>`；具体形状由上方各动作重载定义 / the action overloads above define each result shape.
     */
    (id: string, input: {
        action: "diagnostics" | "completion" | "definition" | "rename";
        path: string;
        content: string;
        position?: import("../../shared/language-service.ts").LspPosition | undefined;
        newName?: string | undefined;
        version?: string | undefined;
    }, signal?: AbortSignal | undefined): Promise<any>;
};
  /**
   * 签名 / Signature: LanguageServicesV1.apply.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 apply 的输入与结果契约，所属容器为 LanguageServicesV1。
   * Purpose: Declares the input/result contract for apply in LanguageServicesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; token: string; lockToken: string | undefined optional
   * 输出 / Returns: Promise<{ files: { path: string; content: string; version: string; }[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "apply": (id: string, token: string, lockToken?: string | undefined) => Promise<{
    files: {
        path: string;
        content: string;
        version: string;
    }[];
}>;
  /**
   * 签名 / Signature: LanguageServicesV1.stop.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 stop 的输入与结果契约，所属容器为 LanguageServicesV1。
   * Purpose: Declares the input/result contract for stop in LanguageServicesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; token: string
   * 输出 / Returns: Promise<{ stopped: boolean; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "stop": (id: string, token: string) => Promise<{
    stopped: boolean;
}>;
}

export interface DebugAdapterV1 {
  /**
   * 签名 / Signature: DebugAdapterV1.status.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 status 的输入与结果契约，所属容器为 DebugAdapterV1。
   * Purpose: Declares the input/result contract for status in DebugAdapterV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ active: boolean; needsReview: boolean; error: string; token: string; state: "error" | "running" | "stopped" | "starting" | "terminated"; path: string; directory: str….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "status": (id: string, signal?: AbortSignal | undefined) => Promise<{
    active: boolean;
    needsReview: boolean;
    error: string;
    token: string;
    state: "error" | "running" | "stopped" | "starting" | "terminated";
    path: string;
    directory: string;
    reason: string;
    threadId: number;
    selectedFrame: number;
    output: string;
    breakpoints: {
        line: number;
        verified: boolean;
        message?: string | undefined;
    }[];
    frames: FrameV1[];
    variables: VariableV1[];
    startedAt: string;
    installed: boolean;
    pending?: undefined;
} | {
    installed: boolean;
    active: boolean;
    token: string;
    state: "error";
    needsReview: boolean;
    error: string;
    pending: {
        token: string;
        projectId: string;
        phase: "active" | "review" | "intent" | "closed";
    }[];
} | {
    installed: boolean;
    active: boolean;
    token?: undefined;
    state?: undefined;
    needsReview?: undefined;
    error?: undefined;
    pending?: undefined;
}>;
  /**
   * 签名 / Signature: DebugAdapterV1.install.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 install 的输入与结果契约，所属容器为 DebugAdapterV1。
   * Purpose: Declares the input/result contract for install in DebugAdapterV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ installed: boolean; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "install": (id: string, signal?: AbortSignal | undefined) => Promise<{
    installed: boolean;
}>;
  /**
   * 签名 / Signature: DebugAdapterV1.start.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 start 的输入与结果契约，所属容器为 DebugAdapterV1。
   * Purpose: Declares the input/result contract for start in DebugAdapterV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: { path: string; breakpoints: number[]; stopOnEntry?: boolean | undefined; args?: stri…; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ active: boolean; token: string; state: "error" | "running" | "stopped" | "starting" | "terminated"; path: string; directory: string; reason: string; threadId: number….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "start": (id: string, input: {
    path: string;
    breakpoints: number[];
    stopOnEntry?: boolean | undefined;
    args?: string[] | undefined;
}, signal?: AbortSignal | undefined) => Promise<{
    active: boolean;
    token: string;
    state: "error" | "running" | "stopped" | "starting" | "terminated";
    path: string;
    directory: string;
    reason: string;
    threadId: number;
    selectedFrame: number;
    output: string;
    breakpoints: {
        line: number;
        verified: boolean;
        message?: string | undefined;
    }[];
    frames: FrameV1[];
    variables: VariableV1[];
    error: string;
    startedAt: string;
    needsReview: boolean;
}>;
  /**
   * 签名 / Signature: DebugAdapterV1.command.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 command 的输入与结果契约，所属容器为 DebugAdapterV1。
   * Purpose: Declares the input/result contract for command in DebugAdapterV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; token: string; action: "next" | "continue" | "stepIn" | "stepOut" | "pause"; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ active: boolean; token: string; state: "error" | "running" | "stopped" | "starting" | "terminated"; path: string; directory: string; reason: string; threadId: number….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "command": (id: string, token: string, action: "next" | "continue" | "stepIn" | "stepOut" | "pause", signal?: AbortSignal | undefined) => Promise<{
    active: boolean;
    token: string;
    state: "error" | "running" | "stopped" | "starting" | "terminated";
    path: string;
    directory: string;
    reason: string;
    threadId: number;
    selectedFrame: number;
    output: string;
    breakpoints: {
        line: number;
        verified: boolean;
        message?: string | undefined;
    }[];
    frames: FrameV1[];
    variables: VariableV1[];
    error: string;
    startedAt: string;
    needsReview: boolean;
}>;
  /**
   * 签名 / Signature: DebugAdapterV1.setBreakpoints.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 setBreakpoints 的输入与结果契约，所属容器为 DebugAdapterV1。
   * Purpose: Declares the input/result contract for setBreakpoints in DebugAdapterV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; token: string; input: number[]
   * 输出 / Returns: Promise<{ active: boolean; token: string; state: "error" | "running" | "stopped" | "starting" | "terminated"; path: string; directory: string; reason: string; threadId: number….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "setBreakpoints": (id: string, token: string, input: number[]) => Promise<{
    active: boolean;
    token: string;
    state: "error" | "running" | "stopped" | "starting" | "terminated";
    path: string;
    directory: string;
    reason: string;
    threadId: number;
    selectedFrame: number;
    output: string;
    breakpoints: {
        line: number;
        verified: boolean;
        message?: string | undefined;
    }[];
    frames: FrameV1[];
    variables: VariableV1[];
    error: string;
    startedAt: string;
    needsReview: boolean;
}>;
  /**
   * 签名 / Signature: DebugAdapterV1.inspect.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 inspect 的输入与结果契约，所属容器为 DebugAdapterV1。
   * Purpose: Declares the input/result contract for inspect in DebugAdapterV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; token: string; frameId: number
   * 输出 / Returns: Promise<{ active: boolean; token: string; state: "error" | "running" | "stopped" | "starting" | "terminated"; path: string; directory: string; reason: string; threadId: number….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "inspect": (id: string, token: string, frameId: number) => Promise<{
    active: boolean;
    token: string;
    state: "error" | "running" | "stopped" | "starting" | "terminated";
    path: string;
    directory: string;
    reason: string;
    threadId: number;
    selectedFrame: number;
    output: string;
    breakpoints: {
        line: number;
        verified: boolean;
        message?: string | undefined;
    }[];
    frames: FrameV1[];
    variables: VariableV1[];
    error: string;
    startedAt: string;
    needsReview: boolean;
}>;
  /**
   * 签名 / Signature: DebugAdapterV1.expand.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 expand 的输入与结果契约，所属容器为 DebugAdapterV1。
   * Purpose: Declares the input/result contract for expand in DebugAdapterV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; token: string; reference: number
   * 输出 / Returns: Promise<{ variables: any; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "expand": (id: string, token: string, reference: number) => Promise<{
    variables: any;
}>;
  /**
   * 签名 / Signature: DebugAdapterV1.stop.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 stop 的输入与结果契约，所属容器为 DebugAdapterV1。
   * Purpose: Declares the input/result contract for stop in DebugAdapterV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; token: string
   * 输出 / Returns: Promise<{ active: boolean; stopped: boolean; output: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "stop": (id: string, token: string) => Promise<{
    active: boolean;
    stopped: boolean;
    output: string;
}>;
}

export interface CommandPresetsV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: CommandPresetsV1.list.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 list 的输入与结果契约，所属容器为 CommandPresetsV1。
   * Purpose: Declares the input/result contract for list in CommandPresetsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ name: string; command: string; parameters: { name: string; value: string; }[]; id: string; }[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "list": (id: string) => Promise<{
    name: string;
    command: string;
    parameters: {
        name: string;
        value: string;
    }[];
    id: string;
}[]>;
  /**
   * 签名 / Signature: CommandPresetsV1.save.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 save 的输入与结果契约，所属容器为 CommandPresetsV1。
   * Purpose: Declares the input/result contract for save in CommandPresetsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<{ name: string; command: string; parameters: { name: string; value: string; }[]; id: string; }[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "save": (id: string, input: unknown) => Promise<{
    name: string;
    command: string;
    parameters: {
        name: string;
        value: string;
    }[];
    id: string;
}[]>;
  /**
   * 签名 / Signature: CommandPresetsV1.remove.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 remove 的输入与结果契约，所属容器为 CommandPresetsV1。
   * Purpose: Declares the input/result contract for remove in CommandPresetsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; presetId: string
   * 输出 / Returns: Promise<{ name: string; command: string; parameters: { name: string; value: string; }[]; id: string; }[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "remove": (id: string, presetId: string) => Promise<{
    name: string;
    command: string;
    parameters: {
        name: string;
        value: string;
    }[];
    id: string;
}[]>;
  /**
   * 签名 / Signature: CommandPresetsV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 CommandPresetsV1。
   * Purpose: Declares the input/result contract for run in CommandPresetsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; presetId: string; input: unknown
   * 输出 / Returns: Promise<import("../../shared/contracts/jobs.ts").JobView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, presetId: string, input: unknown) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
}

export interface ContainersV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: ContainersV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 ContainersV1。
   * Purpose: Declares the input/result contract for view in ContainersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ supported: boolean; installed: boolean; containers: never[]; images: never[]; volumes: never[]; files: never[]; job: import("../../shared/contracts/jobs.ts").JobView….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string, signal?: AbortSignal | undefined) => Promise<{
    supported: boolean;
    installed: boolean;
    containers: never[];
    images: never[];
    volumes: never[];
    files: never[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    available?: undefined;
    privateNetwork?: undefined;
    error?: undefined;
    runtime?: undefined;
    devcontainer?: undefined;
    templates?: undefined;
    version?: undefined;
    compose?: undefined;
} | {
    supported: boolean;
    installed: boolean;
    available: boolean;
    privateNetwork: boolean;
    containers: never[];
    images: never[];
    volumes: never[];
    files: never[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    error: string;
    runtime?: undefined;
    devcontainer?: undefined;
    templates?: undefined;
    version?: undefined;
    compose?: undefined;
} | {
    supported: boolean;
    installed: boolean;
    available: boolean;
    runtime: {
        present: boolean;
        running: boolean;
        valid: boolean;
        reason: string | null;
        runId: string | null;
        containers: number;
    };
    privateNetwork: boolean;
    error: string | undefined;
    containers: never[];
    images: never[];
    volumes: never[];
    files: never[];
    devcontainer: {
        cliInstalled: boolean;
        files: never[];
        error: string;
        version?: undefined;
    } | {
        cliInstalled: boolean;
        version: string | undefined;
        files: string[];
        error?: undefined;
    };
    templates: readonly [{
        readonly id: "debian";
        readonly name: "Debian";
        readonly description: "通用 Debian 开发环境";
    }, {
        readonly id: "javascript-node";
        readonly name: "Node.js";
        readonly description: "Node.js 与 JavaScript";
    }, {
        readonly id: "python";
        readonly name: "Python";
        readonly description: "Python 3 开发环境";
    }, {
        readonly id: "go";
        readonly name: "Go";
        readonly description: "Go 开发环境";
    }, {
        readonly id: "rust";
        readonly name: "Rust";
        readonly description: "Rust 开发环境";
    }];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    version?: undefined;
    compose?: undefined;
} | {
    supported: boolean;
    installed: boolean;
    available: boolean;
    error: string;
    containers: never[];
    images: never[];
    volumes: never[];
    files: never[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    privateNetwork?: undefined;
    runtime?: undefined;
    devcontainer?: undefined;
    templates?: undefined;
    version?: undefined;
    compose?: undefined;
} | {
    supported: boolean;
    installed: boolean;
    available: boolean;
    privateNetwork: boolean;
    runtime: {
        present: boolean;
        running: boolean;
        valid: boolean;
        reason: string | null;
        runId: string | null;
        containers: number;
    } | undefined;
    version: string;
    compose: string;
    containers: any[];
    images: any[];
    volumes: any[];
    files: string[];
    devcontainer: {
        cliInstalled: boolean;
        files: never[];
        error: string;
        version?: undefined;
    } | {
        cliInstalled: boolean;
        version: string | undefined;
        files: string[];
        error?: undefined;
    };
    templates: readonly [{
        readonly id: "debian";
        readonly name: "Debian";
        readonly description: "通用 Debian 开发环境";
    }, {
        readonly id: "javascript-node";
        readonly name: "Node.js";
        readonly description: "Node.js 与 JavaScript";
    }, {
        readonly id: "python";
        readonly name: "Python";
        readonly description: "Python 3 开发环境";
    }, {
        readonly id: "go";
        readonly name: "Go";
        readonly description: "Go 开发环境";
    }, {
        readonly id: "rust";
        readonly name: "Rust";
        readonly description: "Rust 开发环境";
    }];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    error?: undefined;
}>;
  /**
   * 签名 / Signature: ContainersV1.templateMetadata.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 templateMetadata 的输入与结果契约，所属容器为 ContainersV1。
   * Purpose: Declares the input/result contract for templateMetadata in ContainersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: string; version: string | undefined optional; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ id: string; version: string; name: string; description: string; documentationURL: string; reference: string; sourceMatched: boolean; imageVariant: { default: string;….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "templateMetadata": (id: string, input: string, version?: string | undefined, signal?: AbortSignal | undefined) => Promise<{
    id: string;
    version: string;
    name: string;
    description: string;
    documentationURL: string;
    reference: string;
    sourceMatched: boolean;
    imageVariant: {
        default: string;
        choices: string[];
    } | undefined;
    optionalPaths: string[];
    files: string[];
}>;
  /**
   * 签名 / Signature: ContainersV1.logs.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 logs 的输入与结果契约，所属容器为 ContainersV1。
   * Purpose: Declares the input/result contract for logs in ContainersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; target: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ log: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "logs": (id: string, target: string, signal?: AbortSignal | undefined) => Promise<{
    log: string;
}>;
  /**
   * 签名 / Signature: ContainersV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 ContainersV1。
   * Purpose: Declares the input/result contract for run in ContainersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<import("../../shared/contracts/jobs.ts").JobView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, input: unknown) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
  /**
   * 签名 / Signature: ContainersV1.privateDatabase.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 privateDatabase 的输入与结果契约，所属容器为 ContainersV1。
   * Purpose: Declares the input/result contract for privateDatabase in ContainersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: { database: "postgres" | "redis" | "mysql"; password: string; name?: string | undefin…; signal: AbortSignal; log: (text: string) => void
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "privateDatabase": (id: string, input: {
    database: "postgres" | "redis" | "mysql";
    password: string;
    name?: string | undefined;
    port?: number | undefined;
}, signal: AbortSignal, log: (text: string) => void) => Promise<void>;
}

export interface DesktopsV1 {
  readonly "apps": SingleAppWindowsV1;
  readonly "clipboard": X11ClipboardV1;
  readonly "waylandClipboard": WaylandClipboardV1;
  /**
   * 签名 / Signature: DesktopsV1.stop.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 stop 的输入与结果契约，所属容器为 DesktopsV1。
   * Purpose: Declares the input/result contract for stop in DesktopsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ stopped: boolean; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "stop": (id: string) => Promise<{
    stopped: boolean;
}>;
  /**
   * 签名 / Signature: DesktopsV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 DesktopsV1。
   * Purpose: Declares the input/result contract for view in DesktopsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; bound: boolean optional
   * 输出 / Returns: Promise<import("../../shared/contracts/vm.ts").DesktopView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string, bound?: boolean) => Promise<import("../../shared/contracts/vm.ts").DesktopView>;
  /**
   * 签名 / Signature: DesktopsV1.start.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 start 的输入与结果契约，所属容器为 DesktopsV1。
   * Purpose: Declares the input/result contract for start in DesktopsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; action: "start" | "install" | "configure"; input: Partial<{ sessionType: "auto" | "x11" | "wayland"; resolution: "1280x800" | "1440x900… optional
   * 输出 / Returns: import("../../shared/contracts/vm.ts").DesktopView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "start": (id: string, action: "start" | "install" | "configure", input?: Partial<{
    sessionType: "auto" | "x11" | "wayland";
    resolution: "1280x800" | "1440x900" | "1600x1000" | "1920x1080";
    monitorLayout: "single" | "dual-horizontal" | "dual-vertical";
    scale: number;
    theme: "sakura" | "midnight" | "paper" | "lavender";
    wallpaper: "sakura" | "midnight" | "paper" | "plain";
    accent: string;
    panel: "bottom" | "top" | "floating";
    autoHidePanel: boolean;
    animations: boolean;
}> | undefined) => import("../../shared/contracts/vm.ts").DesktopView;
  /**
   * 签名 / Signature: DesktopsV1.installIme.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 installIme 的输入与结果契约，所属容器为 DesktopsV1。
   * Purpose: Declares the input/result contract for installIme in DesktopsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal; log: (line: string) => void
   * 输出 / Returns: Promise<{ stdout: string; stderr: string; code: number; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "installIme": (id: string, signal: AbortSignal, log: (line: string) => void) => Promise<{
    stdout: string;
    stderr: string;
    code: number;
}>;
  /**
   * 签名 / Signature: DesktopsV1.attach.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 attach 的输入与结果契约，所属容器为 DesktopsV1。
   * Purpose: Declares the input/result contract for attach in DesktopsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; socket: WebSocket; readOnly: boolean optional; port: number optional; appSession: string | undefined optional; projectId: string | null | undefined optional
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "attach": (id: string, socket: WebSocket, readOnly?: boolean, port?: number, appSession?: string | undefined, projectId?: string | null | undefined) => Promise<void>;
}

export interface JobsV1 {
  readonly "persistenceError"?: string | undefined;
  /**
   * 签名 / Signature: JobsV1.flush.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 flush 的输入与结果契约，所属容器为 JobsV1。
   * Purpose: Declares the input/result contract for flush in JobsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "flush": () => Promise<void>;
  /**
   * 签名 / Signature: JobsV1.list.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 list 的输入与结果契约，所属容器为 JobsV1。
   * Purpose: Declares the input/result contract for list in JobsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView[].
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "list": () => import("../../shared/contracts/jobs.ts").JobView[];
  /**
   * 签名 / Signature: JobsV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 JobsV1。
   * Purpose: Declares the input/result contract for view in JobsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: key: string
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView | null.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (key: string) => import("../../shared/contracts/jobs.ts").JobView | null;
  /**
   * 签名 / Signature: JobsV1.get.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 get 的输入与结果契约，所属容器为 JobsV1。
   * Purpose: Declares the input/result contract for get in JobsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView | undefined.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "get": (id: string) => import("../../shared/contracts/jobs.ts").JobView | undefined;
  /**
   * 签名 / Signature: JobsV1.resolveCleanup.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 resolveCleanup 的输入与结果契约，所属容器为 JobsV1。
   * Purpose: Declares the input/result contract for resolveCleanup in JobsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "resolveCleanup": (id: string) => Promise<void>;
  /**
   * 签名 / Signature: JobsV1.clearCompletedLogs.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 clearCompletedLogs 的输入与结果契约，所属容器为 JobsV1。
   * Purpose: Declares the input/result contract for clearCompletedLogs in JobsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: entries: { id: string; signature: string; }[]; at: string
   * 输出 / Returns: Promise<{ removedLogs: number; removedBytes: number; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "clearCompletedLogs": (entries: {
    id: string;
    signature: string;
}[], at: string) => Promise<{
    removedLogs: number;
    removedBytes: number;
}>;
  /**
   * 签名 / Signature: JobsV1.result.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 result 的输入与结果契约，所属容器为 JobsV1。
   * Purpose: Declares the input/result contract for result in JobsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<any>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "result": (id: string) => Promise<any>;
  /**
   * 签名 / Signature: JobsV1.start.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 start 的输入与结果契约，所属容器为 JobsV1。
   * Purpose: Declares the input/result contract for start in JobsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: key: string; work: WorkV1; meta: import("../../shared/contracts/jobs.ts").JobMeta optional
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "start": (key: string, work: WorkV1, meta?: import("../../shared/contracts/jobs.ts").JobMeta) => import("../../shared/contracts/jobs.ts").JobView;
  /**
   * 签名 / Signature: JobsV1.track.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 track 的输入与结果契约，所属容器为 JobsV1。
   * Purpose: Declares the input/result contract for track in JobsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: key: string; work: (log: (s: string) => void, signal: AbortSignal, update: import("../../shared/contract…; meta: import("../../shared/contracts/jobs.ts").JobMeta optional; external: AbortSignal | undefined optional
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "track": <T>(key: string, work: (log: (s: string) => void, signal: AbortSignal, update: import("../../shared/contracts/jobs.ts").JobUpdate) => Promise<T>, meta?: import("../../shared/contracts/jobs.ts").JobMeta, external?: AbortSignal | undefined) => Promise<T>;
  /**
   * 签名 / Signature: JobsV1.cancel.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 cancel 的输入与结果契约，所属容器为 JobsV1。
   * Purpose: Declares the input/result contract for cancel in JobsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: key: string; reason: unknown optional
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "cancel": (key: string, reason?: unknown) => void;
  /**
   * 签名 / Signature: JobsV1.wait.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 wait 的输入与结果契约，所属容器为 JobsV1。
   * Purpose: Declares the input/result contract for wait in JobsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: key: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "wait": (key: string) => Promise<void>;
  /**
   * 签名 / Signature: JobsV1.close.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 close 的输入与结果契约，所属容器为 JobsV1。
   * Purpose: Declares the input/result contract for close in JobsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "close": () => Promise<void>;
}

export interface X11ClipboardV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: X11ClipboardV1.retireDesktop.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 retireDesktop 的输入与结果契约，所属容器为 X11ClipboardV1。
   * Purpose: Declares the input/result contract for retireDesktop in X11ClipboardV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; proof: { version: 1; identity: { version: 1; phase: "active" | "intent"; registryId: string;…
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "retireDesktop": (id: string, proof: {
    version: 1;
    identity: {
        version: 1;
        phase: "active" | "intent";
        registryId: string;
        projectId: string;
        identityId: string;
        revision: number;
        account: string;
        uid: number;
        gid: number;
        home: string;
        directory: string;
        directoryDevice: string;
        directoryInode: string;
        homeDevice: string;
        homeInode: string;
        networkIsolation: "host" | "private";
    };
    run: {
        version: 1;
        phase: "active" | "closed";
        mode: "independent" | "inherit-current";
        registryId: string;
        identityId: string;
        projectId: string;
        runId: string;
        revision: number;
        bootId: string;
        build: string;
        networkDevice: string;
        networkInode: string;
        cgroupDevice: string;
        cgroupInode: string;
        cgroupName: string;
        namespace: string;
    } | null;
    record: {
        name: "desktop";
        session: string;
        version: 1;
        projectId: string;
        runId: string;
        bootId: string;
        scopeName: string;
        inode: string | null;
        binding: string;
        phase: "running" | "prepared" | "stopped" | "intent";
        sessionId: string | null;
        paneId: string | null;
        panePid: number | null;
        paneStartTicks: string | null;
    };
    sha256: string;
    runtime: string;
    endpoint: {
        plasmaPid: number;
        plasmaCreated: string;
        vncPid: number;
        vncCreated: string;
        runtimeDevice: string;
        runtimeInode: string;
        xauthDevice: string;
        xauthInode: string;
        xauthSha256: string;
        readyDevice: string;
        readyInode: string;
        nestedX11?: {
            display: string;
            xauthPath: string;
            xauthDevice: string;
            xauthInode: string;
            xauthSha256: string;
            socketPath: string;
            socketDevice: string;
            socketInode: string;
            kernelInode: string;
            peerPid: number;
            peerCreated: string;
            peerImage: "/usr/bin/Xwayland" | "/usr/bin/kwin_wayland" | "/usr/bin/kwin_wayland_wrapper";
        } | undefined;
    } | null;
    build: string;
}) => Promise<void>;
  /**
   * 签名 / Signature: X11ClipboardV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 X11ClipboardV1。
   * Purpose: Declares the input/result contract for view in X11ClipboardV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<import("../../shared/x11-clipboard.ts").X11ClipboardView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string, signal?: AbortSignal | undefined) => Promise<import("../../shared/x11-clipboard.ts").X11ClipboardView>;
  /**
   * 签名 / Signature: X11ClipboardV1.install.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 install 的输入与结果契约，所属容器为 X11ClipboardV1。
   * Purpose: Declares the input/result contract for install in X11ClipboardV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "install": (id: string) => import("../../shared/contracts/jobs.ts").JobView;
  /**
   * 签名 / Signature: X11ClipboardV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 X11ClipboardV1。
   * Purpose: Declares the input/result contract for action in X11ClipboardV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; raw: unknown; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<unknown>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, raw: unknown, signal?: AbortSignal | undefined) => Promise<unknown>;
}

export interface WaylandClipboardV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: WaylandClipboardV1.retireDesktop.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 retireDesktop 的输入与结果契约，所属容器为 WaylandClipboardV1。
   * Purpose: Declares the input/result contract for retireDesktop in WaylandClipboardV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; proof: { version: 1; identity: { version: 1; phase: "active" | "intent"; registryId: string;…
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "retireDesktop": (id: string, proof: {
    version: 1;
    identity: {
        version: 1;
        phase: "active" | "intent";
        registryId: string;
        projectId: string;
        identityId: string;
        revision: number;
        account: string;
        uid: number;
        gid: number;
        home: string;
        directory: string;
        directoryDevice: string;
        directoryInode: string;
        homeDevice: string;
        homeInode: string;
        networkIsolation: "host" | "private";
    };
    run: {
        version: 1;
        phase: "active" | "closed";
        mode: "independent" | "inherit-current";
        registryId: string;
        identityId: string;
        projectId: string;
        runId: string;
        revision: number;
        bootId: string;
        build: string;
        networkDevice: string;
        networkInode: string;
        cgroupDevice: string;
        cgroupInode: string;
        cgroupName: string;
        namespace: string;
    } | null;
    record: {
        name: "desktop";
        session: string;
        version: 1;
        projectId: string;
        runId: string;
        bootId: string;
        scopeName: string;
        inode: string | null;
        binding: string;
        phase: "running" | "prepared" | "stopped" | "intent";
        sessionId: string | null;
        paneId: string | null;
        panePid: number | null;
        paneStartTicks: string | null;
    };
    sha256: string;
    runtime: string;
    endpoint: {
        plasmaPid: number;
        plasmaCreated: string;
        vncPid: number;
        vncCreated: string;
        runtimeDevice: string;
        runtimeInode: string;
        xauthDevice: string;
        xauthInode: string;
        xauthSha256: string;
        readyDevice: string;
        readyInode: string;
        nestedX11?: {
            display: string;
            xauthPath: string;
            xauthDevice: string;
            xauthInode: string;
            xauthSha256: string;
            socketPath: string;
            socketDevice: string;
            socketInode: string;
            kernelInode: string;
            peerPid: number;
            peerCreated: string;
            peerImage: "/usr/bin/Xwayland" | "/usr/bin/kwin_wayland" | "/usr/bin/kwin_wayland_wrapper";
        } | undefined;
    } | null;
    build: string;
}) => Promise<void>;
  /**
   * 签名 / Signature: WaylandClipboardV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 WaylandClipboardV1。
   * Purpose: Declares the input/result contract for view in WaylandClipboardV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<import("../../shared/x11-clipboard.ts").X11ClipboardView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string, signal?: AbortSignal | undefined) => Promise<import("../../shared/x11-clipboard.ts").X11ClipboardView>;
  /**
   * 签名 / Signature: WaylandClipboardV1.install.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 install 的输入与结果契约，所属容器为 WaylandClipboardV1。
   * Purpose: Declares the input/result contract for install in WaylandClipboardV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "install": (id: string) => import("../../shared/contracts/jobs.ts").JobView;
  /**
   * 签名 / Signature: WaylandClipboardV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 WaylandClipboardV1。
   * Purpose: Declares the input/result contract for action in WaylandClipboardV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; raw: unknown; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<unknown>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, raw: unknown, signal?: AbortSignal | undefined) => Promise<unknown>;
}

export interface ExtendedFeaturesV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: ExtendedFeaturesV1.catalog.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 catalog 的输入与结果契约，所属容器为 ExtendedFeaturesV1。
   * Purpose: Declares the input/result contract for catalog in ExtendedFeaturesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ features: import("../../shared/catalogs/engineering.ts").ExtendedFeature[]; operations: { id: string; name: string; feature: string; example: Record<string, unknown>….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "catalog": () => Promise<{
    features: import("../../shared/catalogs/engineering.ts").ExtendedFeature[];
    operations: {
        id: string;
        name: string;
        feature: string;
        example: Record<string, unknown>;
        note: string;
        writes: boolean;
        schema: OperationJsonSchemaV1;
    }[];
    capabilities: import("../../shared/capability-actions.ts").CapabilityActionView[];
    count: number;
    generatedAt: string;
}>;
  /**
   * 签名 / Signature: ExtendedFeaturesV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 ExtendedFeaturesV1。
   * Purpose: Declares the input/result contract for view in ExtendedFeaturesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ projectId: string; features: import("../../shared/catalogs/engineering.ts").ExtendedFeature[]; operations: { id: string; name: string; feature: string; example: Reco….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => Promise<{
    projectId: string;
    features: import("../../shared/catalogs/engineering.ts").ExtendedFeature[];
    operations: {
        id: string;
        name: string;
        feature: string;
        example: Record<string, unknown>;
        note: string;
        writes: boolean;
        schema: OperationJsonSchemaV1;
    }[];
    capabilities: import("../../shared/capability-actions.ts").CapabilityActionView[];
    settings: Record<string, FeatureSettingV1>;
    manifest: {
        createdAt: string;
        path: string;
        entries: number;
        checksum: string;
    };
    executions: FeatureExecutionV1[];
    jobs: import("../../shared/contracts/jobs.ts").JobView[];
}>;
  /**
   * 签名 / Signature: ExtendedFeaturesV1.configure.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configure 的输入与结果契约，所属容器为 ExtendedFeaturesV1。
   * Purpose: Declares the input/result contract for configure in ExtendedFeaturesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<FeatureSettingV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configure": (id: string, input: unknown) => Promise<FeatureSettingV1>;
  /**
   * 签名 / Signature: ExtendedFeaturesV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 ExtendedFeaturesV1。
   * Purpose: Declares the input/result contract for action in ExtendedFeaturesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<import("../../shared/contracts/jobs.ts").JobView | FeatureSettingV1 | (Record<string, unknown> & { ready: boolean; })>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, input: unknown, signal?: AbortSignal | undefined) => Promise<import("../../shared/contracts/jobs.ts").JobView | FeatureSettingV1 | (Record<string, unknown> & {
    ready: boolean;
})>;
}

export interface FilesV1 {
  readonly "uploads": ResumableUploadsV1;
  readonly "trash"?: (
  /**
   * 中文功能：声明语言服务动作联合输入的兼容调用签名，异步返回对应动作结果。
   * English: Declares the compatibility call signature for union language-service actions and asynchronously returns the action result.
   * 所属 / Owner: FilesV1."trash".
   * 输入 / Inputs: id: string; path: string; recursive: boolean.
   * 结果 / Result: `Promise<unknown>`.
   */
  (id: string, path: string, recursive: boolean) => Promise<unknown>) | undefined;
  /**
   * 签名 / Signature: FilesV1.info.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 info 的输入与结果契约，所属容器为 FilesV1。
   * Purpose: Declares the input/result contract for info in FilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; path: string
   * 输出 / Returns: Promise<{ size: number; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "info": (id: string, path: string) => Promise<{
    size: number;
}>;
  /**
   * 签名 / Signature: FilesV1.chunk.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 chunk 的输入与结果契约，所属容器为 FilesV1。
   * Purpose: Declares the input/result contract for chunk in FilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; path: string; index: number; signal: AbortSignal
   * 输出 / Returns: Promise<{ index: number; bytes: number; data: string; sha256: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "chunk": (id: string, path: string, index: number, signal: AbortSignal) => Promise<{
    index: number;
    bytes: number;
    data: string;
    sha256: string;
}>;
  /**
   * 签名 / Signature: FilesV1.preview.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 preview 的输入与结果契约，所属容器为 FilesV1。
   * Purpose: Declares the input/result contract for preview in FilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; path: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<PreviewV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "preview": (id: string, path: string, signal?: AbortSignal | undefined) => Promise<PreviewV1>;
  /**
   * 签名 / Signature: FilesV1.upload.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 upload 的输入与结果契约，所属容器为 FilesV1。
   * Purpose: Declares the input/result contract for upload in FilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; path: string; source: import("stream").Readable; overwrite: boolean optional; signal: AbortSignal | undefined optional; expectedVersion: string | undefined optional
   * 输出 / Returns: Promise<{ bytes: number; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "upload": (id: string, path: string, source: import("stream").Readable, overwrite?: boolean, signal?: AbortSignal | undefined, expectedVersion?: string | undefined) => Promise<{
    bytes: number;
}>;
  /**
   * 签名 / Signature: FilesV1.download.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 download 的输入与结果契约，所属容器为 FilesV1。
   * Purpose: Declares the input/result contract for download in FilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; path: string; target: import("stream").Writable; headers: (size: number) => void; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "download": (id: string, path: string, target: import("stream").Writable, headers: (size: number) => void, signal?: AbortSignal | undefined) => Promise<void>;
  /**
   * 签名 / Signature: FilesV1.operation.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 operation 的输入与结果契约，所属容器为 FilesV1。
   * Purpose: Declares the input/result contract for operation in FilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; action: "delete" | "rename" | "mkdir"; path: string; destination: string | undefined optional; recursive: boolean optional
   * 输出 / Returns: Promise<unknown>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "operation": (id: string, action: "delete" | "rename" | "mkdir", path: string, destination?: string | undefined, recursive?: boolean) => Promise<unknown>;
}

export interface FileHistoryV1 {
  /**
   * 签名 / Signature: FileHistoryV1.list.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 list 的输入与结果契约，所属容器为 FileHistoryV1。
   * Purpose: Declares the input/result contract for list in FileHistoryV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; path: string | undefined optional
   * 输出 / Returns: Promise<{ id: string; path: string; kind: "version" | "trash"; createdAt: string; bytes: number; ready: boolean; version?: string | undefined; }[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "list": (id: string, path?: string | undefined) => Promise<{
    id: string;
    path: string;
    kind: "version" | "trash";
    createdAt: string;
    bytes: number;
    ready: boolean;
    version?: string | undefined;
}[]>;
  /**
   * 签名 / Signature: FileHistoryV1.capture.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 capture 的输入与结果契约，所属容器为 FileHistoryV1。
   * Purpose: Declares the input/result contract for capture in FileHistoryV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; path: string; ftp: import("ssh2").SFTPWrapper; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "capture": (id: string, path: string, ftp: import("ssh2").SFTPWrapper, signal?: AbortSignal | undefined) => Promise<void>;
  /**
   * 签名 / Signature: FileHistoryV1.trash.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 trash 的输入与结果契约，所属容器为 FileHistoryV1。
   * Purpose: Declares the input/result contract for trash in FileHistoryV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; path: string; recursive: boolean optional
   * 输出 / Returns: Promise<{ ok: boolean; historyId: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "trash": (id: string, path: string, recursive?: boolean) => Promise<{
    ok: boolean;
    historyId: string;
}>;
  /**
   * 签名 / Signature: FileHistoryV1.content.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 content 的输入与结果契约，所属容器为 FileHistoryV1。
   * Purpose: Declares the input/result contract for content in FileHistoryV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; key: string
   * 输出 / Returns: Promise<{ entry: { id: string; path: string; kind: "version" | "trash"; createdAt: string; bytes: number; ready: boolean; version?: string | undefined; }; content: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "content": (id: string, key: string) => Promise<{
    entry: {
        id: string;
        path: string;
        kind: "version" | "trash";
        createdAt: string;
        bytes: number;
        ready: boolean;
        version?: string | undefined;
    };
    content: string;
}>;
  /**
   * 签名 / Signature: FileHistoryV1.restore.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 restore 的输入与结果契约，所属容器为 FileHistoryV1。
   * Purpose: Declares the input/result contract for restore in FileHistoryV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; key: string; expectedVersion: string | undefined optional
   * 输出 / Returns: Promise<{ ok: boolean; path: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "restore": (id: string, key: string, expectedVersion?: string | undefined) => Promise<{
    ok: boolean;
    path: string;
}>;
  /**
   * 签名 / Signature: FileHistoryV1.purge.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 purge 的输入与结果契约，所属容器为 FileHistoryV1。
   * Purpose: Declares the input/result contract for purge in FileHistoryV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; key: string
   * 输出 / Returns: Promise<{ ok: boolean; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "purge": (id: string, key: string) => Promise<{
    ok: boolean;
}>;
}

export interface FileLocksV1 {
  /**
   * 签名 / Signature: FileLocksV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 FileLocksV1。
   * Purpose: Declares the input/result contract for view in FileLocksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: string
   * 输出 / Returns: { path: string; locked: boolean; expiresAt: string | null; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string, input: string) => {
    path: string;
    locked: boolean;
    expiresAt: string | null;
};
  /**
   * 签名 / Signature: FileLocksV1.acquire.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 acquire 的输入与结果契约，所属容器为 FileLocksV1。
   * Purpose: Declares the input/result contract for acquire in FileLocksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: string
   * 输出 / Returns: Promise<{ path: string; token: `${string}-${string}-${string}-${string}-${string}`; expiresAt: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "acquire": (id: string, input: string) => Promise<{
    path: string;
    token: `${string}-${string}-${string}-${string}-${string}`;
    expiresAt: string;
}>;
  /**
   * 签名 / Signature: FileLocksV1.renew.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 renew 的输入与结果契约，所属容器为 FileLocksV1。
   * Purpose: Declares the input/result contract for renew in FileLocksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: string; token: string
   * 输出 / Returns: Promise<{ path: string; expiresAt: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "renew": (id: string, input: string, token: string) => Promise<{
    path: string;
    expiresAt: string;
}>;
  /**
   * 签名 / Signature: FileLocksV1.release.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 release 的输入与结果契约，所属容器为 FileLocksV1。
   * Purpose: Declares the input/result contract for release in FileLocksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: string; token: string
   * 输出 / Returns: Promise<{ released: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "release": (id: string, input: string, token: string) => Promise<{
    released: string;
}>;
  /**
   * 签名 / Signature: FileLocksV1.withMutation.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 withMutation 的输入与结果契约，所属容器为 FileLocksV1。
   * Purpose: Declares the input/result contract for withMutation in FileLocksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; inputs: string[]; token: string | undefined; action: () => Promise<T>
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "withMutation": <T>(id: string, inputs: string[], token: string | undefined, action: () => Promise<T>) => Promise<T>;
  /**
   * 签名 / Signature: FileLocksV1.clear.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 clear 的输入与结果契约，所属容器为 FileLocksV1。
   * Purpose: Declares the input/result contract for clear in FileLocksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "clear": () => void;
}

export interface GitWorkbenchV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: GitWorkbenchV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 GitWorkbenchV1。
   * Purpose: Declares the input/result contract for view in GitWorkbenchV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ projectId: string; repository: boolean; error: string; changes: never[]; branches: never[]; history: never[]; job: import("../../shared/contracts/jobs.ts").JobView |….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string, signal?: AbortSignal | undefined) => Promise<{
    projectId: string;
    repository: boolean;
    error: string;
    changes: never[];
    branches: never[];
    history: never[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    branch?: undefined;
    detached?: undefined;
    hasCommits?: undefined;
    conflicts?: undefined;
    operation?: undefined;
    upstream?: undefined;
    remotes?: undefined;
    divergence?: undefined;
} | {
    projectId: string;
    repository: boolean;
    branch: string;
    detached: boolean;
    hasCommits: boolean;
    changes: import("../../shared/git.ts").GitChange[];
    conflicts: string[];
    operation: string | null;
    upstream: import("../../shared/git.ts").GitUpstream | null;
    branches: string[];
    history: {
        id: string;
        short: string;
        subject: string;
        author: string;
        date: string;
    }[];
    remotes: {
        name: string;
        url: string;
        kind: string;
    }[];
    divergence: number[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    error?: undefined;
}>;
  /**
   * 签名 / Signature: GitWorkbenchV1.diff.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 diff 的输入与结果契约，所属容器为 GitWorkbenchV1。
   * Purpose: Declares the input/result contract for diff in GitWorkbenchV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; path: string; staged: boolean; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ diff: string; truncated: boolean; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "diff": (id: string, path: string, staged: boolean, signal?: AbortSignal | undefined) => Promise<{
    diff: string;
    truncated: boolean;
}>;
  /**
   * 签名 / Signature: GitWorkbenchV1.mergeInputs.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 mergeInputs 的输入与结果契约，所属容器为 GitWorkbenchV1。
   * Purpose: Declares the input/result contract for mergeInputs in GitWorkbenchV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; path: string; signal: AbortSignal | undefined optional; project: ProjectV1 | undefined optional
   * 输出 / Returns: Promise<{ path: string; base: string; ours: string; theirs: string; expectedVersion: string; expectedIndex: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "mergeInputs": (id: string, path: string, signal?: AbortSignal | undefined, project?: ProjectV1 | undefined) => Promise<{
    path: string;
    base: string;
    ours: string;
    theirs: string;
    expectedVersion: string;
    expectedIndex: string;
}>;
  /**
   * 签名 / Signature: GitWorkbenchV1.conflictChoices.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 conflictChoices 的输入与结果契约，所属容器为 GitWorkbenchV1。
   * Purpose: Declares the input/result contract for conflictChoices in GitWorkbenchV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; path: string; signal: AbortSignal | undefined optional; project: ProjectV1 | undefined optional
   * 输出 / Returns: Promise<{ path: string; base: { mode: string; oid: string; }; ours: { mode: string; oid: string; }; theirs: { mode: string; oid: string; }; worktree: string; expectedIndex: st….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "conflictChoices": (id: string, path: string, signal?: AbortSignal | undefined, project?: ProjectV1 | undefined) => Promise<{
    path: string;
    base: {
        mode: string;
        oid: string;
    };
    ours: {
        mode: string;
        oid: string;
    };
    theirs: {
        mode: string;
        oid: string;
    };
    worktree: string;
    expectedIndex: string;
    expectedWorktree: string;
}>;
  /**
   * 签名 / Signature: GitWorkbenchV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 GitWorkbenchV1。
   * Purpose: Declares the input/result contract for run in GitWorkbenchV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<import("../../shared/contracts/jobs.ts").JobView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, input: unknown) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
}

export interface IdeV1 {
  /**
   * 签名 / Signature: IdeV1.profile.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 profile 的输入与结果契约，所属容器为 IdeV1。
   * Purpose: Declares the input/result contract for profile in IdeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional; client: "jetbrains" | "openssh" optional
   * 输出 / Returns: Promise<{ hostKeyVerification?: "project-and-endpoint" | undefined; alias: string; host: string; port: number; username: string; directory: string; identityFile: string; known….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "profile": (id: string, signal?: AbortSignal | undefined, client?: "jetbrains" | "openssh") => Promise<{
    hostKeyVerification?: "project-and-endpoint" | undefined;
    alias: string;
    host: string;
    port: number;
    username: string;
    directory: string;
    identityFile: string;
    knownHostsFile: string;
    hostKeyAlias: string;
    projectScoped: boolean;
    projectId: string;
    vscodeSupported: boolean;
    networkIsolation: "host" | "private";
    config: string;
}>;
  /**
   * 签名 / Signature: IdeV1.update.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 update 的输入与结果契约，所属容器为 IdeV1。
   * Purpose: Declares the input/result contract for update in IdeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "update": () => Promise<void>;
  /**
   * 签名 / Signature: IdeV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 IdeV1。
   * Purpose: Declares the input/result contract for view in IdeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ supported: boolean; running: boolean; vscodeSupported: boolean; alias: string; config: string; command: string; url: string; projectScoped?: undefined; projectId?: u….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => Promise<{
    supported: boolean;
    running: boolean;
    vscodeSupported: boolean;
    alias: string;
    config: string;
    command: string;
    url: string;
    projectScoped?: undefined;
    projectId?: undefined;
    networkIsolation?: undefined;
    runtime?: undefined;
    sshCommand?: undefined;
} | {
    supported: boolean;
    vscodeSupported: boolean;
    running: boolean;
    projectScoped: boolean;
    projectId: string;
    networkIsolation: "host" | "private";
    runtime: {
        present: boolean;
        running: boolean;
        valid: boolean;
        processes: number;
        reason: string | null;
        daemon?: {
            pid: number;
            startTicks: string;
            bootId: string;
            cgroupName: string;
        } | undefined;
    };
    alias: string;
    config: string;
    command: string;
    sshCommand: string;
    url: string;
}>;
  /**
   * 签名 / Signature: IdeV1.install.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 install 的输入与结果契约，所属容器为 IdeV1。
   * Purpose: Declares the input/result contract for install in IdeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ supported: boolean; running: boolean; vscodeSupported: boolean; alias: string; config: string; command: string; url: string; projectScoped?: undefined; projectId?: u….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "install": (id: string, signal?: AbortSignal | undefined) => Promise<{
    supported: boolean;
    running: boolean;
    vscodeSupported: boolean;
    alias: string;
    config: string;
    command: string;
    url: string;
    projectScoped?: undefined;
    projectId?: undefined;
    networkIsolation?: undefined;
    runtime?: undefined;
    sshCommand?: undefined;
} | {
    supported: boolean;
    vscodeSupported: boolean;
    running: boolean;
    projectScoped: boolean;
    projectId: string;
    networkIsolation: "host" | "private";
    runtime: {
        present: boolean;
        running: boolean;
        valid: boolean;
        processes: number;
        reason: string | null;
        daemon?: {
            pid: number;
            startTicks: string;
            bootId: string;
            cgroupName: string;
        } | undefined;
    };
    alias: string;
    config: string;
    command: string;
    sshCommand: string;
    url: string;
}>;
  /**
   * 签名 / Signature: IdeV1.stop.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 stop 的输入与结果契约，所属容器为 IdeV1。
   * Purpose: Declares the input/result contract for stop in IdeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ supported: boolean; running: boolean; vscodeSupported: boolean; alias: string; config: string; command: string; url: string; projectScoped?: undefined; projectId?: u….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "stop": (id: string) => Promise<{
    supported: boolean;
    running: boolean;
    vscodeSupported: boolean;
    alias: string;
    config: string;
    command: string;
    url: string;
    projectScoped?: undefined;
    projectId?: undefined;
    networkIsolation?: undefined;
    runtime?: undefined;
    sshCommand?: undefined;
} | {
    supported: boolean;
    vscodeSupported: boolean;
    running: boolean;
    projectScoped: boolean;
    projectId: string;
    networkIsolation: "host" | "private";
    runtime: {
        present: boolean;
        running: boolean;
        valid: boolean;
        processes: number;
        reason: string | null;
        daemon?: {
            pid: number;
            startTicks: string;
            bootId: string;
            cgroupName: string;
        } | undefined;
    };
    alias: string;
    config: string;
    command: string;
    sshCommand: string;
    url: string;
}>;
}

export interface ImagesV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: ImagesV1.list.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 list 的输入与结果契约，所属容器为 ImagesV1。
   * Purpose: Declares the input/result contract for list in ImagesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { id: string; name: "Alpine 3.23" | "Debian 12" | "Debian 12 ARM64" | "Ubuntu 24.04 LTS"; ready: boolean; minimumMemory: 256 | 1024; minimumDisk: 2 | 4; job: import("../../sha….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "list": () => {
    id: string;
    name: "Alpine 3.23" | "Debian 12" | "Debian 12 ARM64" | "Ubuntu 24.04 LTS";
    ready: boolean;
    minimumMemory: 256 | 1024;
    minimumDisk: 2 | 4;
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}[];
  /**
   * 签名 / Signature: ImagesV1.prepare.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 prepare 的输入与结果契约，所属容器为 ImagesV1。
   * Purpose: Declares the input/result contract for prepare in ImagesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "prepare": (id: string) => import("../../shared/contracts/jobs.ts").JobView;
}

export interface DiskImportsV1 {
  /**
   * 签名 / Signature: DiskImportsV1.import.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 import 的输入与结果契约，所属容器为 DiskImportsV1。
   * Purpose: Declares the input/result contract for import in DiskImportsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown; source: import("stream").Readable; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ vm: import("../../shared/contracts/vm.ts").VMView; source: { member?: string | undefined; format: "raw" | "vmdk" | "vhdx" | "ova"; bytes: number; sha256: string; vir….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "import": (input: unknown, source: import("stream").Readable, signal?: AbortSignal | undefined) => Promise<{
    vm: import("../../shared/contracts/vm.ts").VMView;
    source: {
        member?: string | undefined;
        format: "raw" | "vmdk" | "vhdx" | "ova";
        bytes: number;
        sha256: string;
        virtualBytes: any;
    };
}>;
}

export interface MaintenanceV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: MaintenanceV1.storage.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 storage 的输入与结果契约，所属容器为 MaintenanceV1。
   * Purpose: Declares the input/result contract for storage in MaintenanceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ total: number; available: number; images: { id: string; name: "Alpine 3.23" | "Debian 12" | "Debian 12 ARM64" | "Ubuntu 24.04 LTS"; bytes: number; }[]; backupBytes: ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "storage": () => Promise<{
    total: number;
    available: number;
    images: {
        id: string;
        name: "Alpine 3.23" | "Debian 12" | "Debian 12 ARM64" | "Ubuntu 24.04 LTS";
        bytes: number;
    }[];
    backupBytes: number;
    deduplicatedBackups: {
        backups: number;
        logicalBytes: number;
        physicalBytes: number;
        referencedBytes: number;
        savedBytes: number;
        orphanBytes: number;
        reclaimedBytes: number;
        chunkCount: number;
        blockSize: number;
    };
    machines: {
        id: string;
        name: string;
        bytes: number;
        capacity: number;
        snapshots: number;
        pendingResize: boolean;
    }[];
    warning: string;
}>;
  /**
   * 签名 / Signature: MaintenanceV1.compact.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 compact 的输入与结果契约，所属容器为 MaintenanceV1。
   * Purpose: Declares the input/result contract for compact in MaintenanceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "compact": (id: string) => import("../../shared/contracts/jobs.ts").JobView;
  /**
   * 签名 / Signature: MaintenanceV1.diskView.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 diskView 的输入与结果契约，所属容器为 MaintenanceV1。
   * Purpose: Declares the input/result contract for diskView in MaintenanceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ job: import("../../shared/contracts/jobs.ts").JobView | null; maintenance: boolean; policy: { enabled: boolean; intervalHours: number; mode: "trim" | "compact" | "bo….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "diskView": (id: string) => Promise<{
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    maintenance: boolean;
    policy: {
        enabled: boolean;
        intervalHours: number;
        mode: "trim" | "compact" | "both";
        compress: boolean;
    };
    attempts: Partial<Record<DiskOperationV1, AttemptV1>>;
    successes: Partial<Record<DiskOperationV1, string>>;
}>;
  /**
   * 签名 / Signature: MaintenanceV1.diskPolicy.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 diskPolicy 的输入与结果契约，所属容器为 MaintenanceV1。
   * Purpose: Declares the input/result contract for diskPolicy in MaintenanceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<DiskMaintenanceStateV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "diskPolicy": (id: string, input: unknown) => Promise<DiskMaintenanceStateV1>;
  /**
   * 签名 / Signature: MaintenanceV1.diskRun.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 diskRun 的输入与结果契约，所属容器为 MaintenanceV1。
   * Purpose: Declares the input/result contract for diskRun in MaintenanceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; operation: DiskOperationV1
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "diskRun": (id: string, operation: DiskOperationV1) => import("../../shared/contracts/jobs.ts").JobView;
  /**
   * 签名 / Signature: MaintenanceV1.tick.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 tick 的输入与结果契约，所属容器为 MaintenanceV1。
   * Purpose: Declares the input/result contract for tick in MaintenanceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: now: number optional
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "tick": (now?: number) => Promise<void>;
  /**
   * 签名 / Signature: MaintenanceV1.report.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 report 的输入与结果契约，所属容器为 MaintenanceV1。
   * Purpose: Declares the input/result contract for report in MaintenanceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: { createdAt: string; checks: DiagnosticCheckV1[]; log: string; } | null.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "report": (id: string) => {
    createdAt: string;
    checks: DiagnosticCheckV1[];
    log: string;
} | null;
  /**
   * 签名 / Signature: MaintenanceV1.diagnose.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 diagnose 的输入与结果契约，所属容器为 MaintenanceV1。
   * Purpose: Declares the input/result contract for diagnose in MaintenanceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "diagnose": (id: string) => import("../../shared/contracts/jobs.ts").JobView;
  /**
   * 签名 / Signature: MaintenanceV1.resize.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 resize 的输入与结果契约，所属容器为 MaintenanceV1。
   * Purpose: Declares the input/result contract for resize in MaintenanceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; size: number
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "resize": (id: string, size: number) => import("../../shared/contracts/jobs.ts").JobView;
  /**
   * 签名 / Signature: MaintenanceV1.finishResize.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 finishResize 的输入与结果契约，所属容器为 MaintenanceV1。
   * Purpose: Declares the input/result contract for finishResize in MaintenanceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView | undefined.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "finishResize": (id: string) => import("../../shared/contracts/jobs.ts").JobView | undefined;
}

export interface MetricsV1 {
  /**
   * 签名 / Signature: MetricsV1.forget.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 forget 的输入与结果契约，所属容器为 MetricsV1。
   * Purpose: Declares the input/result contract for forget in MetricsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "forget": (id: string) => void;
  /**
   * 签名 / Signature: MetricsV1.sample.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 sample 的输入与结果契约，所属容器为 MetricsV1。
   * Purpose: Declares the input/result contract for sample in MetricsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ cpuPercent: number; memoryUsed: number; memoryTotal: number; diskUsed: number; diskTotal: number; networkReceivedBytes: number | null; networkTransmittedBytes: numbe….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "sample": (id: string) => Promise<{
    cpuPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    diskUsed: number;
    diskTotal: number;
    networkReceivedBytes: number | null;
    networkTransmittedBytes: number | null;
    networkInterfaces: {
        name: string;
        receivedBytes: number;
        transmittedBytes: number;
    }[];
    networkReceiveBytesPerSecond: number | null;
    networkTransmitBytesPerSecond: number | null;
    processes: {
        name: string;
        memory: number;
    }[];
    uptime: number;
    sampledAt: string;
}>;
}

export interface DataMigrationV1 {
  readonly "jobs": JobsV1;
  readonly "blocked": boolean;
  /**
   * 签名 / Signature: DataMigrationV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 DataMigrationV1。
   * Purpose: Declares the input/result contract for view in DataMigrationV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ source: string; target: string | undefined; restartRequired: boolean; blocked: boolean; job: import("../../shared/contracts/jobs.ts").JobView | null; previous: null;….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => Promise<{
    source: string;
    target: string | undefined;
    restartRequired: boolean;
    blocked: boolean;
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    previous: null;
}>;
  /**
   * 签名 / Signature: DataMigrationV1.plan.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 plan 的输入与结果契约，所属容器为 DataMigrationV1。
   * Purpose: Declares the input/result contract for plan in DataMigrationV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: string
   * 输出 / Returns: Promise<{ source: string; target: string; bytes: number; available: number; count: number; token: string; files: MigrationFileV1[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "plan": (input: string) => Promise<{
    source: string;
    target: string;
    bytes: number;
    available: number;
    count: number;
    token: string;
    files: MigrationFileV1[];
}>;
  /**
   * 签名 / Signature: DataMigrationV1.start.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 start 的输入与结果契约，所属容器为 DataMigrationV1。
   * Purpose: Declares the input/result contract for start in DataMigrationV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: string; token: string
   * 输出 / Returns: Promise<import("../../shared/contracts/jobs.ts").JobView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "start": (input: string, token: string) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
  /**
   * 签名 / Signature: DataMigrationV1.cancelActivation.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 cancelActivation 的输入与结果契约，所属容器为 DataMigrationV1。
   * Purpose: Declares the input/result contract for cancelActivation in DataMigrationV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ source: string; target: string | undefined; restartRequired: boolean; blocked: boolean; job: import("../../shared/contracts/jobs.ts").JobView | null; previous: null;….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "cancelActivation": () => Promise<{
    source: string;
    target: string | undefined;
    restartRequired: boolean;
    blocked: boolean;
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    previous: null;
}>;
}

export interface NetworkProfilesV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: NetworkProfilesV1.state.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 state 的输入与结果契约，所属容器为 NetworkProfilesV1。
   * Purpose: Declares the input/result contract for state in NetworkProfilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ config: { dnsServers: string[]; dnsDomains: string[]; dnssec: "no" | "yes" | "inherit" | "allow-downgrade"; httpProxy: string; httpsProxy: string; noProxy: string; n….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "state": (id: string) => Promise<{
    config: {
        dnsServers: string[];
        dnsDomains: string[];
        dnssec: "no" | "yes" | "inherit" | "allow-downgrade";
        httpProxy: string;
        httpsProxy: string;
        noProxy: string;
        npmRegistry: string;
        pipIndex: string;
        apkMirror: string;
        aptMirror: string;
        aptSecurityMirror: string;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
        dependencyDownloads?: {
            npm?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            pip?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            git?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
        } | undefined;
    };
    changes: NetworkChangeV1[];
    forwards?: ForwardChangeV1 | undefined;
    dnsBackend?: "resolved" | undefined;
    resolverLink?: {
        before: string;
        after: string;
    } | undefined;
    appliedAt?: string | undefined;
}>;
  /**
   * 签名 / Signature: NetworkProfilesV1.profiles.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 profiles 的输入与结果契约，所属容器为 NetworkProfilesV1。
   * Purpose: Declares the input/result contract for profiles in NetworkProfilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ id: string; name: string; config: { dnsServers: string[]; dnsDomains: string[]; dnssec: "no" | "yes" | "inherit" | "allow-downgrade"; httpProxy: string; httpsProxy: ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "profiles": () => Promise<{
    id: string;
    name: string;
    config: {
        dnsServers: string[];
        dnsDomains: string[];
        dnssec: "no" | "yes" | "inherit" | "allow-downgrade";
        httpProxy: string;
        httpsProxy: string;
        noProxy: string;
        npmRegistry: string;
        pipIndex: string;
        apkMirror: string;
        aptMirror: string;
        aptSecurityMirror: string;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
        dependencyDownloads?: {
            npm?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            pip?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            git?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
        } | undefined;
    };
    updatedAt: string;
}[]>;
  /**
   * 签名 / Signature: NetworkProfilesV1.saveProfile.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 saveProfile 的输入与结果契约，所属容器为 NetworkProfilesV1。
   * Purpose: Declares the input/result contract for saveProfile in NetworkProfilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ id: string; updatedAt: string; name: string; config: { dnsServers: string[]; dnsDomains: string[]; dnssec: "no" | "yes" | "inherit" | "allow-downgrade"; httpProxy: s….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "saveProfile": (input: unknown) => Promise<{
    id: string;
    updatedAt: string;
    name: string;
    config: {
        dnsServers: string[];
        dnsDomains: string[];
        dnssec: "no" | "yes" | "inherit" | "allow-downgrade";
        httpProxy: string;
        httpsProxy: string;
        noProxy: string;
        npmRegistry: string;
        pipIndex: string;
        apkMirror: string;
        aptMirror: string;
        aptSecurityMirror: string;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
        dependencyDownloads?: {
            npm?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            pip?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            git?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
        } | undefined;
    };
}>;
  /**
   * 签名 / Signature: NetworkProfilesV1.removeProfile.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 removeProfile 的输入与结果契约，所属容器为 NetworkProfilesV1。
   * Purpose: Declares the input/result contract for removeProfile in NetworkProfilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ removed: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "removeProfile": (id: string) => Promise<{
    removed: string;
}>;
  /**
   * 签名 / Signature: NetworkProfilesV1.environment.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 environment 的输入与结果契约，所属容器为 NetworkProfilesV1。
   * Purpose: Declares the input/result contract for environment in NetworkProfilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<Record<string, string>>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "environment": (id: string) => Promise<Record<string, string>>;
  /**
   * 签名 / Signature: NetworkProfilesV1.preview.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 preview 的输入与结果契约，所属容器为 NetworkProfilesV1。
   * Purpose: Declares the input/result contract for preview in NetworkProfilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ config: { dnsServers: string[]; dnsDomains: string[]; dnssec: "no" | "yes" | "inherit" | "allow-downgrade"; httpProxy: string; httpsProxy: string; noProxy: string; n….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "preview": (id: string, input: unknown, signal?: AbortSignal | undefined) => Promise<{
    config: {
        dnsServers: string[];
        dnsDomains: string[];
        dnssec: "no" | "yes" | "inherit" | "allow-downgrade";
        httpProxy: string;
        httpsProxy: string;
        noProxy: string;
        npmRegistry: string;
        pipIndex: string;
        apkMirror: string;
        aptMirror: string;
        aptSecurityMirror: string;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
        dependencyDownloads?: {
            npm?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            pip?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            git?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
        } | undefined;
    };
    changes: NetworkChangeV1[];
    forwards: {
        before: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[];
        after: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[];
    } | undefined;
    dnsBackend: "resolved" | undefined;
    resolverLink: {
        before: string;
        after: string;
    } | undefined;
    token: string;
}>;
  /**
   * 签名 / Signature: NetworkProfilesV1.apply.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 apply 的输入与结果契约，所属容器为 NetworkProfilesV1。
   * Purpose: Declares the input/result contract for apply in NetworkProfilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; token: string
   * 输出 / Returns: Promise<NetworkStateV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "apply": (id: string, input: unknown, token: string) => Promise<NetworkStateV1>;
  /**
   * 签名 / Signature: NetworkProfilesV1.restore.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 restore 的输入与结果契约，所属容器为 NetworkProfilesV1。
   * Purpose: Declares the input/result contract for restore in NetworkProfilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ config: { dnsServers: string[]; dnsDomains: string[]; dnssec: "no" | "yes" | "inherit" | "allow-downgrade"; httpProxy: string; httpsProxy: string; noProxy: string; n….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "restore": (id: string) => Promise<{
    config: {
        dnsServers: string[];
        dnsDomains: string[];
        dnssec: "no" | "yes" | "inherit" | "allow-downgrade";
        httpProxy: string;
        httpsProxy: string;
        noProxy: string;
        npmRegistry: string;
        pipIndex: string;
        apkMirror: string;
        aptMirror: string;
        aptSecurityMirror: string;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
        dependencyDownloads?: {
            npm?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            pip?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            git?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
        } | undefined;
    };
    changes: NetworkChangeV1[];
    forwards?: ForwardChangeV1 | undefined;
    dnsBackend?: "resolved" | undefined;
    resolverLink?: {
        before: string;
        after: string;
    } | undefined;
    appliedAt?: string | undefined;
}>;
  /**
   * 签名 / Signature: NetworkProfilesV1.test.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 test 的输入与结果契约，所属容器为 NetworkProfilesV1。
   * Purpose: Declares the input/result contract for test in NetworkProfilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "test": (id: string, input: unknown) => import("../../shared/contracts/jobs.ts").JobView;
}

export interface IngressCertificatesV1 {
  /**
   * 签名 / Signature: IngressCertificatesV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 IngressCertificatesV1。
   * Purpose: Declares the input/result contract for view in IngressCertificatesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { policy: { autoRotate: boolean; renewBeforeDays: number; }; certificate: { pem: string; fingerprint256: string; validFrom: string; validTo: string; generatedAt: string; } | n….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => {
    policy: {
        autoRotate: boolean;
        renewBeforeDays: number;
    };
    certificate: {
        pem: string;
        fingerprint256: string;
        validFrom: string;
        validTo: string;
        generatedAt: string;
    } | null;
    nextRotationAt: string | null;
    rotationError?: string | undefined;
};
  /**
   * 签名 / Signature: IngressCertificatesV1.tlsOptions.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 tlsOptions 的输入与结果契约，所属容器为 IngressCertificatesV1。
   * Purpose: Declares the input/result contract for tlsOptions in IngressCertificatesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { key: string; cert: string; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "tlsOptions": () => {
    key: string;
    cert: string;
};
  /**
   * 签名 / Signature: IngressCertificatesV1.onChange.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 onChange 的输入与结果契约，所属容器为 IngressCertificatesV1。
   * Purpose: Declares the input/result contract for onChange in IngressCertificatesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: listener: (certificate: { key: string; cert: string; generatedAt: string; }) => void
   * 输出 / Returns: () => boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "onChange": (listener: (certificate: {
    key: string;
    cert: string;
    generatedAt: string;
}) => void) => () => boolean;
  /**
   * 签名 / Signature: IngressCertificatesV1.ensure.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 ensure 的输入与结果契约，所属容器为 IngressCertificatesV1。
   * Purpose: Declares the input/result contract for ensure in IngressCertificatesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: domainAliases: boolean optional
   * 输出 / Returns: Promise<{ key: string; cert: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "ensure": (domainAliases?: boolean) => Promise<{
    key: string;
    cert: string;
}>;
  /**
   * 签名 / Signature: IngressCertificatesV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 IngressCertificatesV1。
   * Purpose: Declares the input/result contract for action in IngressCertificatesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ policy: { autoRotate: boolean; renewBeforeDays: number; }; certificate: { pem: string; fingerprint256: string; validFrom: string; validTo: string; generatedAt: strin….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (input: unknown) => Promise<{
    policy: {
        autoRotate: boolean;
        renewBeforeDays: number;
    };
    certificate: {
        pem: string;
        fingerprint256: string;
        validFrom: string;
        validTo: string;
        generatedAt: string;
    } | null;
    nextRotationAt: string | null;
    rotationError?: string | undefined;
}>;
  /**
   * 签名 / Signature: IngressCertificatesV1.rotate.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 rotate 的输入与结果契约，所属容器为 IngressCertificatesV1。
   * Purpose: Declares the input/result contract for rotate in IngressCertificatesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ policy: { autoRotate: boolean; renewBeforeDays: number; }; certificate: { pem: string; fingerprint256: string; validFrom: string; validTo: string; generatedAt: strin….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "rotate": () => Promise<{
    policy: {
        autoRotate: boolean;
        renewBeforeDays: number;
    };
    certificate: {
        pem: string;
        fingerprint256: string;
        validFrom: string;
        validTo: string;
        generatedAt: string;
    } | null;
    nextRotationAt: string | null;
    rotationError?: string | undefined;
}>;
}

export interface HttpIngressV1 {
  /**
   * 签名 / Signature: HttpIngressV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 HttpIngressV1。
   * Purpose: Declares the input/result contract for view in HttpIngressV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { entries: { name: string; protocol: "https" | "http"; domainAlias: boolean; listenPort: number; pathPrefix: string; vmId: string; upstreamPort: number; healthPath: string; st….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => {
    entries: {
        name: string;
        protocol: "https" | "http";
        domainAlias: boolean;
        listenPort: number;
        pathPrefix: string;
        vmId: string;
        upstreamPort: number;
        healthPath: string;
        stripPrefix: boolean;
        clientAuth: {
            currentPem: string;
            currentCaPem?: string | undefined;
            replacementPem?: string | undefined;
            replacementCaPem?: string | undefined;
            rotateAt?: string | undefined;
        } | null;
        id: string;
        createdAt: string;
        updatedAt: string;
        health: {
            status: "stopped" | "healthy" | "unhealthy" | "unconfigured" | "checking";
            checkedAt?: string | undefined;
            httpStatus?: number | undefined;
            error?: string | undefined;
        };
        url: string;
    }[];
    listenerErrors: Record<string, string>;
};
  /**
   * 签名 / Signature: HttpIngressV1.aliasNames.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 aliasNames 的输入与结果契约，所属容器为 HttpIngressV1。
   * Purpose: Declares the input/result contract for aliasNames in HttpIngressV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: string[].
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "aliasNames": () => string[];
  /**
   * 签名 / Signature: HttpIngressV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 HttpIngressV1。
   * Purpose: Declares the input/result contract for action in HttpIngressV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ entries: { name: string; protocol: "https" | "http"; domainAlias: boolean; listenPort: number; pathPrefix: string; vmId: string; upstreamPort: number; healthPath: st….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (input: unknown) => Promise<{
    entries: {
        name: string;
        protocol: "https" | "http";
        domainAlias: boolean;
        listenPort: number;
        pathPrefix: string;
        vmId: string;
        upstreamPort: number;
        healthPath: string;
        stripPrefix: boolean;
        clientAuth: {
            currentPem: string;
            currentCaPem?: string | undefined;
            replacementPem?: string | undefined;
            replacementCaPem?: string | undefined;
            rotateAt?: string | undefined;
        } | null;
        id: string;
        createdAt: string;
        updatedAt: string;
        health: {
            status: "stopped" | "healthy" | "unhealthy" | "unconfigured" | "checking";
            checkedAt?: string | undefined;
            httpStatus?: number | undefined;
            error?: string | undefined;
        };
        url: string;
    }[];
    listenerErrors: Record<string, string>;
}>;
}

export interface LocalAliasesV1 {
  /**
   * 签名 / Signature: LocalAliasesV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 LocalAliasesV1。
   * Purpose: Declares the input/result contract for view in LocalAliasesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ enabled: boolean; supported: boolean; aliases: string[]; installed: string[]; missing: string[]; stale: string[]; error?: string | undefined; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => Promise<{
    enabled: boolean;
    supported: boolean;
    aliases: string[];
    installed: string[];
    missing: string[];
    stale: string[];
    error?: string | undefined;
}>;
  /**
   * 签名 / Signature: LocalAliasesV1.refresh.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 refresh 的输入与结果契约，所属容器为 LocalAliasesV1。
   * Purpose: Declares the input/result contract for refresh in LocalAliasesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "refresh": () => Promise<void>;
  /**
   * 签名 / Signature: LocalAliasesV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 LocalAliasesV1。
   * Purpose: Declares the input/result contract for action in LocalAliasesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ enabled: boolean; supported: boolean; aliases: string[]; installed: string[]; missing: string[]; stale: string[]; error?: string | undefined; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (input: unknown) => Promise<{
    enabled: boolean;
    supported: boolean;
    aliases: string[];
    installed: string[];
    missing: string[];
    stale: string[];
    error?: string | undefined;
}>;
}

export interface PipelinesV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: PipelinesV1.list.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 list 的输入与结果契约，所属容器为 PipelinesV1。
   * Purpose: Declares the input/result contract for list in PipelinesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<PipelineV1[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "list": (id: string) => Promise<PipelineV1[]>;
  /**
   * 签名 / Signature: PipelinesV1.save.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 save 的输入与结果契约，所属容器为 PipelinesV1。
   * Purpose: Declares the input/result contract for save in PipelinesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<{ id: string; name: string; steps: { name: string; command: string; timeout: number; }[]; artifacts: string[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "save": (id: string, input: unknown) => Promise<PipelineV1>;
  /**
   * 签名 / Signature: PipelinesV1.remove.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 remove 的输入与结果契约，所属容器为 PipelinesV1。
   * Purpose: Declares the input/result contract for remove in PipelinesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; key: string
   * 输出 / Returns: Promise<{ ok: boolean; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "remove": (id: string, key: string) => Promise<{
    ok: boolean;
}>;
  /**
   * 签名 / Signature: PipelinesV1.runs.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 runs 的输入与结果契约，所属容器为 PipelinesV1。
   * Purpose: Declares the input/result contract for runs in PipelinesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<PipelineRunV1[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "runs": (id: string) => Promise<PipelineRunV1[]>;
  /**
   * 签名 / Signature: PipelinesV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 PipelinesV1。
   * Purpose: Declares the input/result contract for view in PipelinesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ projectId: string; pipelines: PipelineV1[]; runs: PipelineRunV1[]; job: import("../../shared/contracts/jobs.ts").JobView | null; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => Promise<{
    projectId: string;
    pipelines: PipelineV1[];
    runs: PipelineRunV1[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}>;
  /**
   * 签名 / Signature: PipelinesV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 PipelinesV1。
   * Purpose: Declares the input/result contract for run in PipelinesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; pipelineId: string
   * 输出 / Returns: Promise<import("../../shared/contracts/jobs.ts").JobView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, pipelineId: string, rerun?: { sourceRunId: string; stepIds: string[] }) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
  /**
   * 签名 / Signature: PipelinesV1.artifact.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 artifact 的输入与结果契约，所属容器为 PipelinesV1。
   * Purpose: Declares the input/result contract for artifact in PipelinesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; runId: string; index: number
   * 输出 / Returns: Promise<{ file: string; name: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "artifact": (id: string, runId: string, index: number) => Promise<{
    file: string;
    name: string;
}>;
}

export interface NextFeaturesV1 {
  readonly "jobs": JobsV1;
  readonly "storageTiering": StorageTieringV1;
  readonly "serviceMesh": ServiceMeshV1;
  readonly "vtpmEnrollment": VtpmEnrollmentV1;
  readonly "acmeRenewal": AcmeRenewalV1;
  readonly "teamTemplates": TeamTemplatesV1;
  readonly "haFailureMonitor": HaFailureMonitorV1;
  /**
   * 签名 / Signature: NextFeaturesV1.haPolicies.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 haPolicies 的输入与结果契约，所属容器为 NextFeaturesV1。
   * Purpose: Declares the input/result contract for haPolicies in NextFeaturesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ [k: string]: NextSettingV1; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "haPolicies": () => Promise<{
    [k: string]: NextSettingV1;
}>;
  /**
   * 签名 / Signature: NextFeaturesV1.notebookLink.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 notebookLink 的输入与结果契约，所属容器为 NextFeaturesV1。
   * Purpose: Declares the input/result contract for notebookLink in NextFeaturesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ provider: "jupyter" | "marimo"; url: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "notebookLink": (id: string) => Promise<{
    provider: "jupyter" | "marimo";
    url: string;
}>;
  /**
   * 签名 / Signature: NextFeaturesV1.browserIdeLink.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 browserIdeLink 的输入与结果契约，所属容器为 NextFeaturesV1。
   * Purpose: Declares the input/result contract for browserIdeLink in NextFeaturesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ url: string; password: string; expiresAt: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "browserIdeLink": (id: string) => Promise<{
    url: string;
    password: string;
    expiresAt: string;
}>;
  /**
   * 签名 / Signature: NextFeaturesV1.catalog.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 catalog 的输入与结果契约，所属容器为 NextFeaturesV1。
   * Purpose: Declares the input/result contract for catalog in NextFeaturesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ features: import("../../shared/catalogs/platform.ts").NextFeature[]; capabilities: import("../../shared/capability-actions.ts").CapabilityActionView[]; count: number….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "catalog": () => Promise<{
    features: import("../../shared/catalogs/platform.ts").NextFeature[];
    capabilities: import("../../shared/capability-actions.ts").CapabilityActionView[];
    count: number;
    generatedAt: string;
}>;
  /**
   * 签名 / Signature: NextFeaturesV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 NextFeaturesV1。
   * Purpose: Declares the input/result contract for view in NextFeaturesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ projectId: string; features: import("../../shared/catalogs/platform.ts").NextFeature[]; capabilities: import("../../shared/capability-actions.ts").CapabilityActionVi….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => Promise<{
    projectId: string;
    features: import("../../shared/catalogs/platform.ts").NextFeature[];
    capabilities: import("../../shared/capability-actions.ts").CapabilityActionView[];
    settings: {
        [x: string]: NextSettingV1;
    };
    records: Record<string, unknown>;
    haFailoverMonitor: {
        suspected: boolean;
        sampleIntervalSeconds: number;
        armed: boolean;
        consecutiveFailures: number;
        observedState: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
        observedAt: string;
        policyVersion?: string | undefined;
        lastHealthyAt?: string | undefined;
        suspectedAt?: string | undefined;
    } | null;
    haPromotion: {
        peerId: string;
        targetHostId: string;
        transferId: string;
        remoteVmId: string;
        snapshotId: string;
        sha256: string;
        fencedAt: string;
        status: "fenced" | "accepted";
        updatedAt: string;
        error?: string | undefined;
    } | null;
    haLocalFailover: {
        error: string | null;
    } | null;
    haHostFailover: {
        configured: boolean;
        armed: boolean;
        phase: string | null;
        targetVmId: string | null;
        failback: "pending" | "completed" | null;
        recoveryHeld: boolean;
        statusPending: boolean;
        error: string | null;
    } | null;
    executions: NextExecutionV1[];
    jobs: import("../../shared/contracts/jobs.ts").JobView[];
}>;
  /**
   * 签名 / Signature: NextFeaturesV1.configure.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configure 的输入与结果契约，所属容器为 NextFeaturesV1。
   * Purpose: Declares the input/result contract for configure in NextFeaturesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<NextSettingV1 | { enabled: boolean; options: { intervalHours: number; }; updatedAt: string; policy: { vmId: string; enabled: boolean; intervalHours: number; updatedAt:….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configure": (id: string, input: unknown) => Promise<NextSettingV1 | {
    enabled: boolean;
    options: {
        intervalHours: number;
    };
    updatedAt: string;
    policy: {
        vmId: string;
        enabled: boolean;
        intervalHours: number;
        updatedAt: string;
        nextAttemptAt: number;
        lastAttemptAt?: number | undefined;
    } | null;
}>;
  /**
   * 签名 / Signature: NextFeaturesV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 NextFeaturesV1。
   * Purpose: Declares the input/result contract for action in NextFeaturesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<import("../../shared/contracts/jobs.ts").JobView | { ready: boolean; executed: boolean; featureId: "ipv6" | "resource-presets" | "workspace-search" | "disk-analyzer" |….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, input: unknown, signal?: AbortSignal | undefined) => Promise<import("../../shared/contracts/jobs.ts").JobView | {
    ready: boolean;
    executed: boolean;
    featureId: "ipv6" | "resource-presets" | "workspace-search" | "disk-analyzer" | "directory-history" | "format-lint" | "git-worktrees" | "dependency-report" | "runtime-matrix" | "reproducible-env" | "network-diagnostics" | "gpu-acceleration" | "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "syscall-profile" | "ssh-agent-forward" | "gpg-agent-forward" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "project-quota" | "guest-quota" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "network-quota" | "egress-policy" | "nat-hairpin" | "power-aware-schedule" | "host-disk-health" | "availability-report" | "global-dedup" | "audit-log" | "otel-tracing" | "dependency-bot" | "cpu-topology" | "device-profiles" | "resource-reservation" | "vcpu-hotplug" | "memory-hotplug" | "crash-loop-guard" | "maintenance-windows" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "patch-bundle" | "environment-recreate" | "editor-profiles" | "metrics-export" | "event-timeline" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "anomaly-detection" | "log-index" | "test-sharding" | "review-comments" | "command-forms" | "vm-dependency-start" | "environment-parity" | "test-matrix" | "cross-vm-copy" | "network-topology" | "packet-capture" | "reverse-tunnel" | "code-search-index" | "language-server-catalog" | "pii-classification";
    reason: string;
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        egressKbps: number;
        burstKiB: number;
        latencyMs: number;
        maxTcpConnections: number;
        newTcpConnectionsPerSecond: number;
        connectionBurst: number;
    };
    previous: string;
    current: string;
    active: boolean;
    connectionPolicyActive: boolean;
    featureId: "network-quota";
    reason?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        egressKbps: number;
        burstKiB: number;
        latencyMs: number;
        maxTcpConnections: number;
        newTcpConnectionsPerSecond: number;
        connectionBurst: number;
    };
    current: string;
    active: boolean;
    connectionControlsAvailable: boolean;
    connectionPolicyActive: boolean;
    connectionRules: JumpV1[];
    reason?: undefined;
    featureId: "network-quota";
} | {
    active: boolean;
    persistent: boolean;
    fstabEntry: string | null;
    mount: string | null;
    capacityMiB: number | null;
    usedMiB: number | null;
    availableMiB: number | null;
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    limitMiB: number;
    reason?: undefined;
    featureId: "project-quota";
} | {
    reason?: string | undefined;
    active: boolean;
    persistent: boolean;
    fstabEntry: string | null;
    mount: string | null;
    capacityMiB: number | null;
    usedMiB: number | null;
    availableMiB: number | null;
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    limitMiB: number | null;
    phase: string;
    featureId: "project-quota";
} | {
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    uid: number;
    hardMiB: number;
    active: boolean;
    report: string;
    reason: undefined;
    featureId: "guest-quota";
} | {
    ready: boolean;
    active: boolean;
    missing: string[];
    report: string;
    reason: string | undefined;
    executed: boolean;
    projectId: string;
    directory: string;
    uid: number;
    projectLimitMiB: number | null;
    featureId: "guest-quota";
} | {
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        allowedDestinations: string[];
        ipv6: string;
    };
    active: boolean;
    removed: number;
    featureId: "egress-policy";
    reason?: undefined;
} | {
    reason?: string | undefined;
    cleanupWarnings?: string[] | undefined;
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        allowedDestinations: string[];
        ipv6: string;
    };
    active: boolean;
    rules: JumpV1[];
    removed?: undefined;
    featureId: "egress-policy";
} | {
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    preview: {
        forwards: {
            name: string | undefined;
            hostPort: number;
            guestPort: number;
            guestAddress: string;
        }[];
        selected: {
            name: string | undefined;
            hostPort: number;
            guestPort: number;
            guestAddress: string;
        } | undefined;
        guestAddress: string;
    };
    exitCode: number;
    checkedAt: string;
    featureId: "nat-hairpin";
} | NextSettingV1 | {
    enabled: boolean;
    options: {
        intervalHours: number;
    };
    updatedAt: string;
    policy: {
        vmId: string;
        enabled: boolean;
        intervalHours: number;
        updatedAt: string;
        nextAttemptAt: number;
        lastAttemptAt?: number | undefined;
    } | null;
} | {
    ready: boolean;
    executed: boolean;
    retiredRemoteVmId: string;
    message: string;
} | {
    message: string;
    released?: boolean | undefined;
    retiredRemoteVmId?: string | undefined;
    failback?: "pending" | "completed" | undefined;
    recovered?: boolean | undefined;
    retiredVmIds?: string[] | undefined;
    ready: boolean;
    executed: boolean;
} | {
    ready: boolean;
    executed: boolean;
    projectId: string;
    directory: string;
    configVersion: string;
    networkIsolation: "host" | "private";
    message: string;
    stdout: string;
    stderr: string;
    code: number;
} | {
    code: number;
    stdout: string;
    stderr: string;
    ready: boolean;
    executed: boolean;
    profile: "restricted" | "networkless";
    timedOut: boolean;
    projectId: string;
    directory: string;
    networkIsolation: "host" | "private";
} | {
    ready: boolean;
    executed: boolean;
    reason: string;
    code: number;
} | {
    clipped: boolean;
    download: {
        filename: string;
        mime: string;
        content: string;
    };
    samples: number;
    frameCount: number;
    topFrames: {
        name: string;
        count: number;
    }[];
    durationSeconds: number;
    frequencyHz: number;
    code: number;
    ready: boolean;
    executed: boolean;
} | {
    samples: number;
    stackCount: number;
    clipped: boolean;
    topSymbols: {
        name: string;
        count: number;
        percent: number;
    }[];
    download: {
        filename: string;
        mime: string;
        content: string;
    };
    durationSeconds: number;
    frequencyHz: number;
    code: number;
    ready: boolean;
    executed: boolean;
} | {
    sha256: string;
    bytes: number;
    code: number;
    ready: boolean;
    executed: boolean;
    source: string;
    target: string;
} | {
    ready: boolean;
    executed: boolean;
    code: number;
    error?: string | undefined;
} | {
    code: number;
    ready: boolean;
    executed: boolean;
    policy: {
        enabled: boolean;
        allowBatteryStarts: boolean;
        minimumBatteryPercent: number;
        stopBelowPercent: number;
    };
    sample: PowerSampleV1;
    decision: {
        allowStart: boolean;
        stop: boolean;
        reason: string;
    };
    active?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    results?: undefined;
    order?: undefined;
    started?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    download: {
        filename: string;
        mime: string;
        content: string;
    };
    capacity: {
        freePercent: number | null;
        totalBytes: number;
        availableBytes: number;
    };
    thresholds: {
        minimumFreeGiB: number;
        minimumFreePercent: number;
        maximumTemperatureC: number;
        maximumWearPercent: number;
    };
    findings: {
        severity: "unknown" | "warning" | "critical";
        message: string;
        disk?: number | undefined;
    }[];
    status: string;
    volume: {
        health: string;
        operational: string[];
        filesystem: string;
    } | null;
    volumeError: string | null;
    disks: {
        number: number;
        name: string;
        bus: string;
        health: string;
        operational: string[];
        counters: {
            temperatureC: number | null;
            maximumTemperatureC: number | null;
            wearPercent: number | null;
            powerOnHours: number | null;
            readErrorsUncorrected: number | null;
            writeErrorsUncorrected: number | null;
        } | null;
        countersError: string | null;
    }[];
    checkedAt: string;
    directory: string;
    provider: string;
    code: number;
    ready: boolean;
    executed: boolean;
    policy?: undefined;
    sample?: undefined;
    decision?: undefined;
    active?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    results?: undefined;
    order?: undefined;
    started?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    download: {
        filename: string;
        mime: string;
        content: string;
    };
    from: string;
    to: string;
    availablePercent: number | null;
    coveragePercent: number;
    observedSeconds: number;
    unknownSeconds: number;
    durationsSeconds: {
        [k: string]: number;
    };
    lastObservedAt: string | null;
    lastStatus: "error" | "unknown" | "running" | "stopped" | "starting" | "paused" | "stopping" | "unreachable";
    intervals: {
        start: string;
        end: string;
        status: "error" | "unknown" | "running" | "stopped" | "starting" | "paused" | "stopping" | "unreachable";
        seconds: number;
    }[];
    basis: string;
    code: number;
    ready: boolean;
    executed: boolean;
    policy?: undefined;
    sample?: undefined;
    decision?: undefined;
    active?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    results?: undefined;
    order?: undefined;
    started?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    download: {
        filename: string;
        mime: string;
        content: string;
    };
    valid: true;
    sequence: number;
    hash: string;
    records: {
        sequence: number;
        previous: string;
        event: {
            time: string;
            kind: "job" | "request" | "connection";
            phase: "start" | "end";
            traceId: string;
            spanId: string;
            name: string;
            parentSpanId?: string | undefined;
            vmId?: string | undefined;
            projectId?: string | undefined;
            status?: number | undefined;
            jobId?: string | undefined;
            actorId?: string | undefined;
        };
        hash: string;
    }[];
    bytes: number;
    code: number;
    ready: boolean;
    executed: boolean;
    policy?: undefined;
    sample?: undefined;
    decision?: undefined;
    active?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    results?: undefined;
    order?: undefined;
    started?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    code: number;
    ready: boolean;
    executed: boolean;
    policy: {
        enabled: boolean;
        windows: {
            days: number[];
            start: string;
            end: string;
            timeZone: string;
        }[];
    };
    active: boolean;
    sample?: undefined;
    decision?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    results?: undefined;
    order?: undefined;
    started?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    code: number;
    ready: boolean;
    executed: boolean;
    totalMatches: number;
    truncated: boolean;
    results: Record<string, any>[];
    policy?: undefined;
    sample?: undefined;
    decision?: undefined;
    active?: undefined;
    order?: undefined;
    started?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    code: number;
    ready: boolean;
    executed: boolean;
    order: string[];
    started: string[];
    policy?: undefined;
    sample?: undefined;
    decision?: undefined;
    active?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    results?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    code: number;
    ready: boolean;
    executed: boolean;
    results: Record<string, unknown>[];
    policy?: undefined;
    sample?: undefined;
    decision?: undefined;
    active?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    order?: undefined;
    started?: undefined;
    equal?: undefined;
    differences?: undefined;
} | {
    code: number;
    ready: boolean;
    executed: boolean;
    equal: boolean;
    results: Record<string, unknown>[];
    differences: {
        vmId: unknown;
        projectId: unknown;
        fields: string[];
    }[];
    policy?: undefined;
    sample?: undefined;
    decision?: undefined;
    active?: undefined;
    totalMatches?: undefined;
    truncated?: undefined;
    order?: undefined;
    started?: undefined;
} | {
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    publishers: number;
    sources: number;
    installed: number;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    reason?: string | undefined;
    projectId: string;
    policy: {
        name: string;
        listenPort: number;
        upstreamPort: number;
        updatedAt: string;
    };
    guestRunning: boolean;
    envoyInstalled: boolean;
    tmuxInstalled: boolean;
    pythonInstalled: boolean;
    sidecarRunning: boolean;
    bindingValid: boolean | null;
    bindingError: string | null;
    runId: string | null;
    processes: number[];
    configPresent: boolean;
    directoryPresent: boolean;
    namespacePresent: boolean;
    version: string | null;
    envoyUsable: boolean | null;
    directory: string;
    networkIsolation: "host" | "private";
    sidecarStateKnown: boolean;
    ready: boolean;
    executed: false;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    message: string;
    reason?: string | undefined;
    projectId: string;
    policy: {
        name: string;
        listenPort: number;
        upstreamPort: number;
        updatedAt: string;
    };
    guestRunning: boolean;
    envoyInstalled: boolean;
    tmuxInstalled: boolean;
    pythonInstalled: boolean;
    sidecarRunning: boolean;
    bindingValid: boolean | null;
    bindingError: string | null;
    runId: string | null;
    processes: number[];
    configPresent: boolean;
    directoryPresent: boolean;
    namespacePresent: boolean;
    version: string | null;
    envoyUsable: boolean | null;
    directory: string;
    networkIsolation: "host" | "private";
    sidecarStateKnown: boolean;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    executed: boolean;
    configPath: string;
    reason?: string | undefined;
    projectId: string;
    policy: {
        name: string;
        listenPort: number;
        upstreamPort: number;
        updatedAt: string;
    };
    guestRunning: boolean;
    envoyInstalled: boolean;
    tmuxInstalled: boolean;
    pythonInstalled: boolean;
    sidecarRunning: boolean;
    bindingValid: boolean | null;
    bindingError: string | null;
    runId: string | null;
    processes: number[];
    configPresent: boolean;
    directoryPresent: boolean;
    namespacePresent: boolean;
    version: string | null;
    envoyUsable: boolean | null;
    directory: string;
    networkIsolation: "host" | "private";
    sidecarStateKnown: boolean;
    ready: boolean;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    records: {
        rotateDueAt: string;
        overdue: boolean;
        dueSoon: boolean;
        fingerprint: string;
        label: string;
        enrolledAt: string;
        rotateAfterDays: number;
        updatedAt: string;
    }[];
    overdueCount: number;
    dueSoonCount: number;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    usbController: boolean;
    pciHostSupported: boolean;
    message: string;
    device?: undefined;
    prerequisitesMet?: undefined;
    checks?: undefined;
    nextAction?: undefined;
    reason?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    device: {
        kind: "usb";
        vendorId: number;
        productId: number;
    };
    prerequisitesMet: boolean;
    checks: {
        guestUsbController: boolean;
        hostDevicePresent: null;
        exclusiveAccess: null;
        guestDriver: null;
        linuxHost?: undefined;
        guestArchitecture?: undefined;
        iommuGroup?: undefined;
        groupMembers?: undefined;
    };
    nextAction: string | null;
    reason: string;
    message: string;
    usbController?: undefined;
    pciHostSupported?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    device: {
        kind: "pci";
        address: string;
    };
    prerequisitesMet: boolean;
    checks: {
        linuxHost: boolean;
        guestArchitecture: "x86_64" | "aarch64";
        hostDevicePresent: boolean;
        iommuGroup: string | null;
        groupMembers: {
            address: string;
            driver: string;
        }[];
        guestUsbController?: undefined;
        exclusiveAccess?: undefined;
        guestDriver?: undefined;
    };
    reason: string;
    message: string;
    usbController?: undefined;
    pciHostSupported?: undefined;
    nextAction?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    provider: "auto" | "cuda" | "rocm";
    reason: string;
    cuda?: undefined;
    rocm?: undefined;
    checkedAt?: undefined;
    message?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    provider: "auto" | "cuda" | "rocm";
    cuda: ProbeV1 | null;
    rocm: ProbeV1 | null;
    checkedAt: string;
    message: string;
    reason?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    vmId: string;
    vmName: string;
    status: import("../../shared/contracts/vm.ts").VMStatus;
    audio: "none" | "hda-duplex";
    audioBackend: "none" | "dsound";
    support: Record<"none" | "dsound", AudioBackendSupportV1>;
    guest: {
        audio: string;
        video: string;
        error?: string | undefined;
    } | null;
    usb: {
        ready: boolean;
        hostDevices: string;
        hostError: string;
        rules: {
            id: string;
            vmId: string;
            vendorId: number;
            productId: number;
            createdAt: string;
            mediaKind?: "camera" | "microphone" | "headset" | undefined;
        }[];
        configured: DeviceV1[];
        events: {
            id: string;
            vmId: string;
            operation: "attach" | "detach";
            deviceId: string;
            vendorId: number;
            productId: number;
            source: "rule" | "manual";
            status: "failed" | "configured" | "requested";
            at: string;
            error?: string | undefined;
        }[];
    };
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    reason?: string | undefined;
    message: string;
    branchOrigin?: {
        sourceVmId: string;
        snapshotId: string;
        createdAt: string;
    } | undefined;
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    requirements: {
        cpus: number;
        memoryMiB: number;
    };
    scoredAt: string;
    candidates: {
        id: string;
        name: string;
        source: "local" | "peer";
        eligible: boolean;
        score: number | null;
        components: {
            memory: number;
            cpuLoad: number;
            instanceDensity: number;
        };
        reasons: string[];
        status: {
            version: 1;
            id: string;
            name: string;
            platform: string;
            arch: string;
            cpus: number;
            memoryTotal: number;
            memoryFree: number;
            load: number[];
            vmCount: number;
            runningVms: number;
            checkedAt: string;
        } | null;
        observedAt: number | null;
    }[];
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    sourceVmId: string;
    targetHostId: string;
    targetVmId: string;
    transferId: `${string}-${string}-${string}-${string}-${string}`;
    targetStatus: "running";
    sourceRetained: boolean;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    planned: boolean;
    sourceVmId: string;
    targetHostId: string | null;
    checkedAt: string;
    qemu: unknown;
    migration: unknown;
    candidates: {
        id: string;
        name: string;
        eligible: boolean;
        reasons: string[];
        platform: string | undefined;
        arch: string | undefined;
    }[];
    blockers: string[];
    steps: string[];
    reason: string;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    blockers: string[];
    reason: string;
    monitor: {
        suspected: boolean;
        sampleIntervalSeconds: number;
        armed: boolean;
        consecutiveFailures: number;
        observedState: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
        observedAt: string;
        policyVersion?: string | undefined;
        lastHealthyAt?: string | undefined;
        suspectedAt?: string | undefined;
    } | null;
    promotion: {
        peerId: string;
        targetHostId: string;
        transferId: string;
        remoteVmId: string;
        snapshotId: string;
        sha256: string;
        fencedAt: string;
        status: "fenced" | "accepted";
        updatedAt: string;
        error?: string | undefined;
    } | null;
    localFailover: {
        error: string | null;
    } | null;
    hostFailover: {
        configured: boolean;
        armed: boolean;
        phase: string | null;
        targetVmId: string | null;
        failback: "pending" | "completed" | null;
        recoveryHeld: boolean;
        statusPending: boolean;
        error: string | null;
    } | null;
    witness: {
        phase?: string | undefined;
        armed?: boolean | undefined;
        lastHeartbeatAt?: number | undefined;
        targetVmId?: string | null | undefined;
        targetHostId?: string | undefined;
        failureThreshold?: number | undefined;
        error?: string | null | undefined;
        failback?: {
            phase: "pending" | "completed";
            retiredVmId: string;
            requestedAt: number;
            completedAt: number | null;
        } | null | undefined;
        recoveryHeld?: boolean | undefined;
        recoveredRetiredVmIds?: string[] | undefined;
        configured: boolean;
    } | null;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    executed: boolean;
    checkedAt: string;
    localProcessReady: boolean;
    hostPlanReady: boolean;
    processObservedInSession: boolean;
    failureSuspected: boolean;
    policy: {
        failureThreshold: number;
        maxReplicaAgeMinutes: number;
        autoProcessFailover: boolean;
        autoHostFailover: boolean;
        targetHostId?: string | undefined;
    };
    source: {
        vmId: string;
        state: import("../../shared/contracts/vm.ts").VMStatus;
    };
    target: {
        hostId: string;
        name: string;
        eligible: boolean;
        reasons: string[];
        observedAt: number | null;
    } | null;
    replica: {
        transferId: string;
        peerId: string;
        snapshotId: string;
        remoteVmId: string | undefined;
        sha256: string | undefined;
        replicatedAt: string;
        ageMinutes: number | null;
        receiptVerified: boolean;
        standbyStatus: "error" | "running" | "stopped" | "starting" | "paused" | "stopping" | null;
    } | null;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    locked?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    policy: {
        enabled: boolean;
        hostPath: string;
        readOnly: boolean;
    };
    attached: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    checkedAt: string;
    host: {
        platform: NodeJS.Platform;
        qemuVirtioFs: boolean;
        qemuNineP: boolean;
        sharedMemory: boolean;
        virtiofsd: boolean;
    };
    guest: {
        virtioFsDriver: boolean;
        ninePDriver: boolean;
        mounts: {
            path: string;
            type: string;
            tag: string;
        }[];
    } | null;
    blockers: string[];
    reason: string;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    locked?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    remoteId: string;
    metadata: {
        version: 1;
        sourceVmId: string;
        backupId: string;
        bytes: number;
        sha256: string;
        encrypted: boolean;
        createdAt: string;
        passwordSecret?: string | undefined;
        retainUntil?: string | undefined;
    };
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    remoteId: string;
    metadata: {
        version: 1;
        sourceVmId: string;
        backupId: string;
        bytes: number;
        sha256: string;
        encrypted: boolean;
        createdAt: string;
        passwordSecret?: string | undefined;
        retainUntil?: string | undefined;
    };
    message?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    restoredVmId?: string | undefined;
    restoredName?: string | undefined;
    ready: boolean;
    executed: boolean;
    remoteId: string | undefined;
    verified: boolean;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    target?: {
        bucket: string;
        region: string;
        prefix: string;
        credentialSecret: string;
        autoUpload: boolean;
        endpoint?: string | undefined;
    } | undefined;
    sync?: {
        mirrored: Record<string, string>;
        lastAttemptAt?: string | undefined;
        lastSuccessAt?: string | undefined;
        lastError?: string | undefined;
    } | undefined;
    ready: boolean;
    executed: boolean;
    reason: string;
    entries?: undefined;
    remoteId?: undefined;
    deleted?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        credentialSecret: string;
        autoUpload: boolean;
        endpoint?: string | undefined;
    };
    sync?: undefined;
    entries?: undefined;
    remoteId?: undefined;
    deleted?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        credentialSecret: string;
        autoUpload: boolean;
        endpoint?: string | undefined;
    };
    sync: {
        mirrored: Record<string, string>;
        lastAttemptAt?: string | undefined;
        lastSuccessAt?: string | undefined;
        lastError?: string | undefined;
    };
    entries?: undefined;
    remoteId?: undefined;
    deleted?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        credentialSecret: string;
        autoUpload: boolean;
        endpoint?: string | undefined;
    };
    entries: {
        remoteId: string;
        metadata: {
            version: 1;
            sourceVmId: string;
            backupId: string;
            bytes: number;
            sha256: string;
            encrypted: boolean;
            createdAt: string;
            passwordSecret?: string | undefined;
            retainUntil?: string | undefined;
        };
    }[];
    sync?: undefined;
    remoteId?: undefined;
    deleted?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    remoteId: string;
    deleted: boolean;
    target?: undefined;
    sync?: undefined;
    entries?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    programs: {
        programId: string;
        executable: string;
        fixedArgs: string[];
        sha256: string;
    }[];
    programId?: undefined;
    sha256?: undefined;
    command?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256: string;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256?: undefined;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    programId?: undefined;
    sha256?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    installed: boolean;
    reason: string | undefined;
    programId?: undefined;
    sha256?: undefined;
    enabled?: undefined;
    command?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    command: string;
    programId?: undefined;
    sha256?: undefined;
    reason?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    secret: string | undefined;
    publicKey: string;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    status: {
        active: boolean;
    };
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    config: {
        address: string;
        listenPort: number;
        privateKeySecret: string;
        peers: {
            publicKey: string;
            allowedIPs: string[];
            keepaliveSeconds: number;
            endpoint?: string | undefined;
        }[];
        enabled: boolean;
    };
    status?: undefined;
    lastAutoError?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    unchanged: boolean;
    template: {
        id: string;
        name: string;
        version: number;
        fingerprint: string;
        content: {
            resources: {
                cpus: number;
                memoryMiB: number;
                diskGiB: number;
                accelerator: "auto" | "tcg" | "whpx";
                distro: "alpine" | "debian" | "ubuntu";
                firmware: "bios" | "uefi";
                template: "none" | "node" | "python" | "rust";
                architecture?: "x86_64" | "aarch64" | undefined;
            };
            project: {
                directory: "/workspace";
                template: "none" | "node" | "python" | "rust";
                repository: string;
                previewPort?: number | undefined;
                networkIsolation?: "host" | "private" | undefined;
                runtimes?: {
                    python?: string | undefined;
                    node?: string | undefined;
                } | undefined;
            };
        };
        createdAt: string;
        updatedAt: string;
    };
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    template: {
        content: {
            resources: {
                cpus: number;
                memoryMiB: number;
                diskGiB: number;
                accelerator: "auto" | "tcg" | "whpx";
                distro: "alpine" | "debian" | "ubuntu";
                firmware: "bios" | "uefi";
                template: "none" | "node" | "python" | "rust";
                architecture?: "x86_64" | "aarch64" | undefined;
            };
            project: {
                directory: "/workspace";
                template: "none" | "node" | "python" | "rust";
                repository: string;
                previewPort?: number | undefined;
                networkIsolation?: "host" | "private" | undefined;
                runtimes?: {
                    python?: string | undefined;
                    node?: string | undefined;
                } | undefined;
            };
        };
        fingerprint: string;
        version: number;
        updatedAt: string;
        id: string;
        name: string;
        createdAt: string;
    };
    unchanged?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    deleted: string;
    templateId?: undefined;
    vmId?: undefined;
    vm?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    templateId: string;
    vmId: string;
    vm: import("../../shared/contracts/vm.ts").VMView;
    deleted?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    templates: {
        id: string;
        name: string;
        version: number;
        fingerprint: string;
        createdAt: string;
        updatedAt: string;
    }[];
    name?: undefined;
    fingerprint?: undefined;
    previousFingerprint?: undefined;
    content?: undefined;
    excluded?: undefined;
    template?: undefined;
    message?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    name: string;
    fingerprint: string;
    previousFingerprint: string | undefined;
    content: {
        resources: {
            cpus: number;
            memoryMiB: number;
            diskGiB: number;
            accelerator: "auto" | "tcg" | "whpx";
            distro: "alpine" | "debian" | "ubuntu";
            firmware: "bios" | "uefi";
            template: "none" | "node" | "python" | "rust";
            architecture?: "x86_64" | "aarch64" | undefined;
        };
        project: {
            directory: "/workspace";
            template: "none" | "node" | "python" | "rust";
            repository: string;
            previewPort?: number | undefined;
            networkIsolation?: "host" | "private" | undefined;
            runtimes?: {
                python?: string | undefined;
                node?: string | undefined;
            } | undefined;
        };
    };
    excluded: string[];
    templates?: undefined;
    template?: undefined;
    message?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    template: {
        id: string;
        name: string;
        version: number;
        fingerprint: string;
        content: {
            resources: {
                cpus: number;
                memoryMiB: number;
                diskGiB: number;
                accelerator: "auto" | "tcg" | "whpx";
                distro: "alpine" | "debian" | "ubuntu";
                firmware: "bios" | "uefi";
                template: "none" | "node" | "python" | "rust";
                architecture?: "x86_64" | "aarch64" | undefined;
            };
            project: {
                directory: "/workspace";
                template: "none" | "node" | "python" | "rust";
                repository: string;
                previewPort?: number | undefined;
                networkIsolation?: "host" | "private" | undefined;
                runtimes?: {
                    python?: string | undefined;
                    node?: string | undefined;
                } | undefined;
            };
        };
        createdAt: string;
        updatedAt: string;
    };
    message: string | undefined;
    templates?: undefined;
    name?: undefined;
    fingerprint?: undefined;
    previousFingerprint?: undefined;
    content?: undefined;
    excluded?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    ready: boolean;
    registered: number;
    reason?: string | undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    ready: boolean;
    devices: number;
    reason?: string | undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    ready: boolean;
    configured: boolean;
    anchoredSequence: number;
    reason?: string | undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        enabled: boolean;
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    policy: {
        vmId: string;
        enabled: boolean;
        intervalHours: number;
        updatedAt: string;
        nextAttemptAt: number;
        lastAttemptAt?: number | undefined;
    } | null;
    attempts: {
        vmId: string;
        at: number;
        mode: "dry-run" | "manual" | "scheduled";
        status: "success" | "failed";
        exitCode?: number | undefined;
    }[];
    running: boolean;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    phase: string;
    transferId: string;
    sourceVmId: string;
    remoteVmId: string;
    targetHostId: string;
    sourceRemoved: boolean;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    targetStart?: {
        id: string;
        status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
    } | undefined;
    message?: string | undefined;
    ready: boolean;
    executed: boolean;
    phase: string;
    transferId: string;
    sourceVmId: string;
    remoteVmId: string;
    targetHostId: string;
    sourceRemoved: boolean;
    queuePersisted: boolean;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    reason: string;
    queue: {
        vmId: string;
        transferId: string;
        peerId: string;
        targetName: string;
        fingerprint: {
            recordHash: string;
            diskSize: number;
            diskMtimeMs: number;
        };
        status: "queued" | "review" | "transferring" | "copied" | "moved";
        createdAt: string;
        updatedAt: string;
        remoteVmId?: string | undefined;
        error?: string | undefined;
    }[];
    target?: undefined;
    fingerprint?: undefined;
    sourceRemovalRequested?: undefined;
    targetStartRequested?: undefined;
    message?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    target: {
        id: string;
        name: string;
        hostId: string;
        score: number | null;
    };
    fingerprint: MigrationFingerprintV1;
    sourceRemovalRequested: boolean;
    targetStartRequested: boolean;
    queue: {
        vmId: string;
        transferId: string;
        peerId: string;
        targetName: string;
        fingerprint: {
            recordHash: string;
            diskSize: number;
            diskMtimeMs: number;
        };
        status: "queued" | "review" | "transferring" | "copied" | "moved";
        createdAt: string;
        updatedAt: string;
        remoteVmId?: string | undefined;
        error?: string | undefined;
    }[];
    message: string;
    reason?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    phase: string;
    completed: {
        sourceVmId: string;
        name: string;
        targetName: string;
        remoteVmId: string;
        sourceRemoved: boolean;
    }[];
    remainingSourceVms: number;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    ready: boolean;
    executed: boolean;
    machines: ({
        remoteVmId: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    } | {
        reason: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    })[];
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    reason: string;
    ready: boolean;
    executed: boolean;
    machines: ({
        remoteVmId: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    } | {
        reason: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    })[];
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    transferId: string;
    sourceVmId: string;
    snapshotId: string;
    remoteVmId: string;
    targetHostId: string;
    sha256: string | undefined;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    snapshot: {
        id: string;
        name: string;
        createdAt: string;
    };
    target: {
        id: string;
        hostId: string;
        name: string;
    };
    existingRemoteVmId: string | undefined;
    existingSha256: string | undefined;
    message: string;
    reason?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    message: string;
    installed?: boolean | undefined;
    projectId?: string | undefined;
    provider?: "jupyter" | "marimo" | undefined;
    session?: {
        provider: "jupyter" | "marimo";
        status: string;
        hostPort: number;
        guestPort: number;
        directory?: string | undefined;
        startedAt?: string | undefined;
        needsReview?: boolean | undefined;
    } | null | undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    supported: boolean;
    installed: boolean;
    projectId: string;
    session: {
        directory: string;
        hostPort: number;
        guestPort: number;
        startedAt: string;
        expiresAt: string;
        status: string;
        needsReview: boolean;
    } | null;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    session: {
        status: string;
        hostPort: number;
        guestPort: number;
        expiresAt: string;
    };
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    currentPoolId: string | null;
    pendingCleanup: {
        vmId: string;
        sourcePoolId: string;
        targetPoolId: string;
        addedAt: string;
    }[];
    pools: {
        id: string;
        name: string;
        root: string;
        createdAt: string;
        available: boolean;
        totalBytes: number | null;
        freeBytes: number | null;
        allocatedBytes: number;
        vms: {
            id: string;
            name: string;
            diskBytes: number;
        }[];
    }[];
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    policy: {
        enabled: boolean;
        hotPoolId: string;
        coldPoolId: string;
        idleHours: number;
        intervalHours: number;
    } | null;
    lastRunAt: string | null;
    lastError: string | null;
    history: {
        vmId: string;
        name: string;
        from: string;
        to: string;
        at: string;
        status: "failed" | "moved";
        error?: string | undefined;
    }[];
    current: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    } | null;
    candidates: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    }[];
    pools: {
        id: string;
        name: string;
        available: boolean;
        freeBytes: number | null;
    }[];
    running: boolean;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    backups: {
        id: string;
        createdAt: string;
        bytes: number;
        encrypted: boolean | undefined;
        storage: "blocks" | undefined;
        verifiedAt: string | null;
    }[];
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    cleanupError?: string | undefined;
    error?: string | undefined;
    restoreMs: number | null;
    bootMs: number | null;
    totalMs: number;
    restoredName: string;
    temporaryVmId: string | null;
    temporaryVmRemoved: boolean;
    probeSha256?: string | undefined;
    ready: boolean;
    executed: boolean;
    backupId: string;
    probePath: string;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    checkedAt: string;
    qemuVersion: string;
    host: {
        platform: NodeJS.Platform;
        arch: NodeJS.Architecture;
    };
    probes: {
        devices: boolean;
        accelerators: boolean;
        machines: boolean;
    };
    matrix: {
        devices: RowV1[];
        accelerators: RowV1[];
        machines: RowV1[];
    };
    current: {
        accelerator: "tcg" | "whpx";
        networkCard: "virtio-net-pci" | "e1000";
        graphics: "none" | "virtio-gpu" | "virgl";
        selectedDevices: string[];
        cpuTopology: {
            sockets: number;
            cores: number;
            threads: number;
            numa?: {
                memoryMiB: number;
                cpus: number[];
            }[] | undefined;
        } | null;
        memoryHotplug: {
            maxMiB: number;
            slots: number;
        } | null;
        compatible: boolean;
        issues: string[];
    };
    limitation: string;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    support: {
        available: boolean;
        codeBytes: number | null;
        varsBytes: number | null;
        reason: string | null;
    };
    selected: "bios" | "uefi";
    message: string | null;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    forwards: {
        host: number;
        guest: number;
        name?: string | undefined;
    }[];
    message: string;
    support?: undefined;
    selected?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        delayMs: number;
        jitterMs: number;
        lossPercent: number;
    };
    reason: string;
    current?: undefined;
    netemActive?: undefined;
    previous?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        delayMs: number;
        jitterMs: number;
        lossPercent: number;
    };
    current: string;
    netemActive: boolean;
    reason?: undefined;
    previous?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    preview: {
        interface: string;
        delayMs: number;
        jitterMs: number;
        lossPercent: number;
    };
    previous: string;
    current: string;
    netemActive: boolean;
    reason?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    reason: string;
    exitCode: number;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    message: string;
    source: string;
    nameservers: string[];
    searchDomains: string[];
    routingDomains: string[];
    dnssecTools: string[];
    dnssecState: string | null;
    dnssecValidation: "not-verified";
    ready: boolean;
    executed: boolean;
    checkedAt: string;
    reason?: undefined;
    exitCode?: undefined;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    cpuExtension: string | null;
    kvmDevice: boolean;
    nestedCandidate: boolean;
    kernel: string;
    accelerator: "tcg" | "whpx" | null;
    checkedAt: string;
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    locked: boolean;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: string;
    policy: {
        enabled: boolean;
        hostPath: string;
        readOnly: boolean;
    };
    guestPath: string;
    reason: string;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    plan: {
        rpoMinutes: number;
        rtoMinutes: number;
        retentionDays: number;
        backupGiB: number;
        bandwidthMbps: number;
        backupIntervalMinutes: number;
    };
    message: string;
    support?: undefined;
    selected?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    reason?: undefined;
    record?: undefined;
} | {
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    ready: boolean;
    executed: boolean;
    probePassed: boolean;
    reason: string;
    output?: undefined;
    exitCode?: undefined;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
    record?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    adapter: {
        id: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
        enabled: boolean;
        options: Record<string, unknown>;
        actions: string[];
    };
    record: unknown;
    reason: string;
    support?: undefined;
    selected?: undefined;
    message?: undefined;
    forwards?: undefined;
    cpuExtension?: undefined;
    kvmDevice?: undefined;
    nestedCandidate?: undefined;
    kernel?: undefined;
    accelerator?: undefined;
    checkedAt?: undefined;
    locked?: undefined;
    policy?: undefined;
    guestPath?: undefined;
    plan?: undefined;
}>;
}

export interface ProjectFilesV1 {
  /**
   * 签名 / Signature: ProjectFilesV1.scan.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 scan 的输入与结果契约，所属容器为 ProjectFilesV1。
   * Purpose: Declares the input/result contract for scan in ProjectFilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; query: string optional; content: boolean optional; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ root: string; files: ProjectFileV1[]; matches: SearchMatchV1[]; scanned: number; truncated: boolean; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "scan": (id: string, query?: string, content?: boolean, signal?: AbortSignal | undefined) => Promise<{
    root: string;
    files: ProjectFileV1[];
    matches: SearchMatchV1[];
    scanned: number;
    truncated: boolean;
}>;
}

export interface WorkspacesV1 {
  readonly "jobs": JobsV1;
  readonly "projects": ProjectCatalogV1;
  /**
   * 签名 / Signature: WorkspacesV1.beforeAction.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 beforeAction 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for beforeAction in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: hook: (id: string, action: "start" | "stop", service?: string | undefined) => Promise<(succ…
   * 输出 / Returns: () => void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "beforeAction": (hook: (id: string, action: "start" | "stop", service?: string | undefined) => Promise<(success: boolean) => void>) => () => void;
  /**
   * 签名 / Signature: WorkspacesV1.onConfigChange.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 onConfigChange 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for onConfigChange in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: listener: () => Promise<void>
   * 输出 / Returns: () => void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "onConfigChange": (listener: () => Promise<void>) => () => void;
  /**
   * 签名 / Signature: WorkspacesV1.beforeConfigChange.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 beforeConfigChange 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for beforeConfigChange in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: guard: (id: string, previous: ProjectV1, next: ProjectV1) => Promise<void>
   * 输出 / Returns: () => void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "beforeConfigChange": (guard: (id: string, previous: ProjectV1, next: ProjectV1) => Promise<void>) => () => void;
  /**
   * 签名 / Signature: WorkspacesV1.config.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 config 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for config in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<ProjectV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "config": (id: string) => Promise<ProjectV1>;
  /**
   * 签名 / Signature: WorkspacesV1.readCommittedConfig.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 readCommittedConfig 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for readCommittedConfig in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<ProjectV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "readCommittedConfig": (id: string) => Promise<ProjectV1>;
  /**
   * 签名 / Signature: WorkspacesV1.networkEnvironment.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 networkEnvironment 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for networkEnvironment in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{}>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "networkEnvironment": (id: string) => Promise<{}>;
  /**
   * 签名 / Signature: WorkspacesV1.dependencyDownloadAuthentication.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 dependencyDownloadAuthentication 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for dependencyDownloadAuthentication in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; manager: "npm" | "pip"
   * 输出 / Returns: Promise<ResolvedDependencyAuthenticationV1 | undefined>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "dependencyDownloadAuthentication": (id: string, manager: "npm" | "pip") => Promise<ResolvedDependencyAuthenticationV1 | undefined>;
  /**
   * 签名 / Signature: WorkspacesV1.repositoryDownloadAuthentication.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 repositoryDownloadAuthentication 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for repositoryDownloadAuthentication in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; repository: string
   * 输出 / Returns: Promise<ResolvedDependencyAuthenticationV1 | undefined>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "repositoryDownloadAuthentication": (id: string, repository: string) => Promise<ResolvedDependencyAuthenticationV1 | undefined>;
  /**
   * 签名 / Signature: WorkspacesV1.resolvedConfig.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 resolvedConfig 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for resolvedConfig in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<ProjectV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "resolvedConfig": (id: string) => Promise<ProjectV1>;
  /**
   * 签名 / Signature: WorkspacesV1.resolveProject.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 resolveProject 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for resolveProject in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; project: ProjectV1
   * 输出 / Returns: Promise<ProjectV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "resolveProject": (id: string, project: ProjectV1) => Promise<ProjectV1>;
  /**
   * 签名 / Signature: WorkspacesV1.save.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 save 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for save in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; allowedDirectory: string | undefined optional; expectedVersion: string | undefined optional; commitGuard: (() => void) | undefined optional
   * 输出 / Returns: Promise<{ directory: string; template: "none" | "node" | "python" | "rust"; repository: string; setup: string; command: string; previewPort?: number | undefined; networkIsolat….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "save": (id: string, input: unknown, allowedDirectory?: string | undefined, expectedVersion?: string | undefined, commitGuard?: (() => void) | undefined) => Promise<{
    directory: string;
    template: "none" | "node" | "python" | "rust";
    repository: string;
    setup: string;
    command: string;
    previewPort?: number | undefined;
    networkIsolation?: "host" | "private" | undefined;
    environment?: Record<string, string> | undefined;
    secrets?: Record<string, string> | undefined;
    runtimes?: {
        python?: string | undefined;
        node?: string | undefined;
    } | undefined;
    services?: {
        name: string;
        command: string;
        dependsOn: string[];
        ready: string;
        timeout: number;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        health?: {
            command: string;
            interval: number;
            timeout: number;
            failures: number;
            restart: boolean;
            maxRestarts: number;
            backoff: number;
        } | undefined;
    }[] | undefined;
}>;
  /**
   * 签名 / Signature: WorkspacesV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for view in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ project: ProjectV1; version: string; projectId: string; job: import("../../shared/contracts/jobs.ts").JobView | null; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => Promise<{
    project: ProjectV1;
    version: string;
    projectId: string;
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}>;
  /**
   * 签名 / Signature: WorkspacesV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for run in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; action: "start" | "stop" | "setup" | "terminal"; service: string | undefined optional; automatic: boolean optional
   * 输出 / Returns: Promise<import("../../shared/contracts/jobs.ts").JobView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, action: "start" | "stop" | "setup" | "terminal", service?: string | undefined, automatic?: boolean) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
  /** 启停已准备的 none 模板项目；启动拒绝软件安装、仓库拉取及准备钩子。 */
  "runPrepared": (id: string, action: "start" | "stop") => Promise<import("../../shared/contracts/jobs.ts").JobView>;
  /**
   * 签名 / Signature: WorkspacesV1.runtime.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 runtime 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for runtime in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<ProjectRuntimeV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "runtime": (id: string, signal?: AbortSignal | undefined) => Promise<ProjectRuntimeV1>;
  /**
   * 签名 / Signature: WorkspacesV1.metrics.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 metrics 的输入与结果契约，所属容器为 WorkspacesV1。
   * Purpose: Declares the input/result contract for metrics in WorkspacesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ cpuPercent: number; memoryUsed: number; memoryTotal: number; diskUsed: number; diskTotal: number; networkReceivedBytes: number | null; networkTransmittedBytes: numbe….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "metrics": (id: string) => Promise<{
    cpuPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    diskUsed: number;
    diskTotal: number;
    networkReceivedBytes: number | null;
    networkTransmittedBytes: number | null;
    networkInterfaces: {
        name: string;
        receivedBytes: number;
        transmittedBytes: number;
    }[];
    networkReceiveBytesPerSecond: number | null;
    networkTransmitBytesPerSecond: number | null;
    processes: {
        name: string;
        memory: number;
    }[];
    uptime: number;
    sampledAt: string;
}>;
}

export interface RecipesV1 {
  /** 生成不执行客户机操作的环境差异预览。 Preview differences without guest operations. */
  "preview": (id: string, input: unknown) => Promise<import('../../shared/contracts/recipe-plan.ts').RecipePlan>;
  /** 应用有效预览并核对项目版本。 Apply a valid preview with project version checks. */
  "applyPlan": (id: string, input: unknown) => ReturnType<WorkspacesV1['view']>;
  /**
   * 签名 / Signature: RecipesV1.export.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 export 的输入与结果契约，所属容器为 RecipesV1。
   * Purpose: Declares the input/result contract for export in RecipesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ version: 1; resources: { cpus?: number | undefined; memoryMiB?: number | undefined; diskGiB?: number | undefined; accelerator?: "auto" | "tcg" | "whpx" | undefined; ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "export": (id: string) => Promise<{
    version: 1;
    resources: {
        cpus?: number | undefined;
        memoryMiB?: number | undefined;
        diskGiB?: number | undefined;
        accelerator?: "auto" | "tcg" | "whpx" | undefined;
        distro?: "alpine" | "debian" | "ubuntu" | undefined;
        template?: "none" | "node" | "python" | "rust" | undefined;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
    };
    project: {
        directory: string;
        template: "none" | "node" | "python" | "rust";
        repository: string;
        setup: string;
        command: string;
        previewPort?: number | undefined;
        networkIsolation?: "host" | "private" | undefined;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        runtimes?: {
            python?: string | undefined;
            node?: string | undefined;
        } | undefined;
        services?: {
            name: string;
            command: string;
            dependsOn: string[];
            ready: string;
            timeout: number;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            health?: {
                command: string;
                interval: number;
                timeout: number;
                failures: number;
                restart: boolean;
                maxRestarts: number;
                backoff: number;
            } | undefined;
        }[] | undefined;
    };
}>;
  /**
   * 签名 / Signature: RecipesV1.read.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 read 的输入与结果契约，所属容器为 RecipesV1。
   * Purpose: Declares the input/result contract for read in RecipesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ version: 1; resources: { cpus?: number | undefined; memoryMiB?: number | undefined; diskGiB?: number | undefined; accelerator?: "auto" | "tcg" | "whpx" | undefined; ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "read": (id: string) => Promise<{
    version: 1;
    resources: {
        cpus?: number | undefined;
        memoryMiB?: number | undefined;
        diskGiB?: number | undefined;
        accelerator?: "auto" | "tcg" | "whpx" | undefined;
        distro?: "alpine" | "debian" | "ubuntu" | undefined;
        template?: "none" | "node" | "python" | "rust" | undefined;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
    };
    project: {
        directory: string;
        template: "none" | "node" | "python" | "rust";
        repository: string;
        setup: string;
        command: string;
        previewPort?: number | undefined;
        networkIsolation?: "host" | "private" | undefined;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        runtimes?: {
            python?: string | undefined;
            node?: string | undefined;
        } | undefined;
        services?: {
            name: string;
            command: string;
            dependsOn: string[];
            ready: string;
            timeout: number;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            health?: {
                command: string;
                interval: number;
                timeout: number;
                failures: number;
                restart: boolean;
                maxRestarts: number;
                backoff: number;
            } | undefined;
        }[] | undefined;
    };
}>;
  /**
   * 签名 / Signature: RecipesV1.write.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 write 的输入与结果契约，所属容器为 RecipesV1。
   * Purpose: Declares the input/result contract for write in RecipesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ version: 1; resources: { cpus?: number | undefined; memoryMiB?: number | undefined; diskGiB?: number | undefined; accelerator?: "auto" | "tcg" | "whpx" | undefined; ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "write": (id: string) => Promise<{
    version: 1;
    resources: {
        cpus?: number | undefined;
        memoryMiB?: number | undefined;
        diskGiB?: number | undefined;
        accelerator?: "auto" | "tcg" | "whpx" | undefined;
        distro?: "alpine" | "debian" | "ubuntu" | undefined;
        template?: "none" | "node" | "python" | "rust" | undefined;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
    };
    project: {
        directory: string;
        template: "none" | "node" | "python" | "rust";
        repository: string;
        setup: string;
        command: string;
        previewPort?: number | undefined;
        networkIsolation?: "host" | "private" | undefined;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        runtimes?: {
            python?: string | undefined;
            node?: string | undefined;
        } | undefined;
        services?: {
            name: string;
            command: string;
            dependsOn: string[];
            ready: string;
            timeout: number;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            health?: {
                command: string;
                interval: number;
                timeout: number;
                failures: number;
                restart: boolean;
                maxRestarts: number;
                backoff: number;
            } | undefined;
        }[] | undefined;
    };
}>;
  /**
   * 签名 / Signature: RecipesV1.create.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 create 的输入与结果契约，所属容器为 RecipesV1。
   * Purpose: Declares the input/result contract for create in RecipesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: name: string; value: unknown
   * 输出 / Returns: Promise<import("../../shared/contracts/vm.ts").VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "create": (name: string, value: unknown) => Promise<import("../../shared/contracts/vm.ts").VMView>;
  /**
   * 签名 / Signature: RecipesV1.apply.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 apply 的输入与结果契约，所属容器为 RecipesV1。
   * Purpose: Declares the input/result contract for apply in RecipesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<{ project: ProjectV1; version: string; projectId: string; job: import("../../shared/contracts/jobs.ts").JobView | null; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "apply": (id: string, input: unknown) => Promise<{
    project: ProjectV1;
    version: string;
    projectId: string;
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}>;
}

export interface RuntimeVersionsV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: RuntimeVersionsV1.probe.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 probe 的输入与结果契约，所属容器为 RuntimeVersionsV1。
   * Purpose: Declares the input/result contract for probe in RuntimeVersionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ selected: { python?: string | undefined; node?: string | undefined; }; declared: { node?: string | undefined; python?: string | undefined; }; actual: { node: string;….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "probe": (id: string, signal?: AbortSignal | undefined) => Promise<{
    selected: {
        python?: string | undefined;
        node?: string | undefined;
    };
    declared: {
        node?: string | undefined;
        python?: string | undefined;
    };
    actual: {
        node: string;
        python: string;
    };
    mismatches: ("node" | "python")[];
    probe: {
        errorCode?: string | undefined;
        state: RuntimeProbeStateV1;
        checkedAt: string | null;
        configVersion: string | null;
        bootId: string | null;
    };
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}>;
  /**
   * 签名 / Signature: RuntimeVersionsV1.inspect.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 inspect 的输入与结果契约，所属容器为 RuntimeVersionsV1。
   * Purpose: Declares the input/result contract for inspect in RuntimeVersionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; project: ProjectV1; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ node: string; python: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "inspect": (id: string, project: ProjectV1, signal?: AbortSignal | undefined) => Promise<{
    node: string;
    python: string;
}>;
  /**
   * 签名 / Signature: RuntimeVersionsV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 RuntimeVersionsV1。
   * Purpose: Declares the input/result contract for view in RuntimeVersionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ selected: { python?: string | undefined; node?: string | undefined; }; declared: { node?: string | undefined; python?: string | undefined; }; actual: { node: string;….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string, signal?: AbortSignal | undefined) => Promise<{
    selected: {
        python?: string | undefined;
        node?: string | undefined;
    };
    declared: {
        node?: string | undefined;
        python?: string | undefined;
    };
    actual: {
        node: string;
        python: string;
    };
    mismatches: ("node" | "python")[];
    probe: {
        errorCode?: string | undefined;
        state: RuntimeProbeStateV1;
        checkedAt: string | null;
        configVersion: string | null;
        bootId: string | null;
    };
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}>;
  /**
   * 签名 / Signature: RuntimeVersionsV1.select.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 select 的输入与结果契约，所属容器为 RuntimeVersionsV1。
   * Purpose: Declares the input/result contract for select in RuntimeVersionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ directory: string; template: "none" | "node" | "python" | "rust"; repository: string; setup: string; command: string; previewPort?: number | undefined; networkIsolat….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "select": (id: string, input: unknown, signal?: AbortSignal | undefined) => Promise<{
    directory: string;
    template: "none" | "node" | "python" | "rust";
    repository: string;
    setup: string;
    command: string;
    previewPort?: number | undefined;
    networkIsolation?: "host" | "private" | undefined;
    environment?: Record<string, string> | undefined;
    secrets?: Record<string, string> | undefined;
    runtimes?: {
        python?: string | undefined;
        node?: string | undefined;
    } | undefined;
    services?: {
        name: string;
        command: string;
        dependsOn: string[];
        ready: string;
        timeout: number;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        health?: {
            command: string;
            interval: number;
            timeout: number;
            failures: number;
            restart: boolean;
            maxRestarts: number;
            backoff: number;
        } | undefined;
    }[] | undefined;
}>;
  /**
   * 签名 / Signature: RuntimeVersionsV1.install.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 install 的输入与结果契约，所属容器为 RuntimeVersionsV1。
   * Purpose: Declares the input/result contract for install in RuntimeVersionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<import("../../shared/contracts/jobs.ts").JobView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "install": (id: string, input: unknown) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
}

export interface SandboxesV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: SandboxesV1.artifact.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 artifact 的输入与结果契约，所属容器为 SandboxesV1。
   * Purpose: Declares the input/result contract for artifact in SandboxesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: runId: string; artifactId: string
   * 输出 / Returns: Promise<{ base64: string; id: string; name: string; path: string; bytes: number; sha256: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "artifact": (runId: string, artifactId: string) => Promise<{
    base64: string;
    id: string;
    name: string;
    path: string;
    bytes: number;
    sha256: string;
}>;
  /**
   * 签名 / Signature: SandboxesV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 SandboxesV1。
   * Purpose: Declares the input/result contract for view in SandboxesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<SandboxViewV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => Promise<SandboxViewV1>;
  /**
   * 签名 / Signature: SandboxesV1.list.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 list 的输入与结果契约，所属容器为 SandboxesV1。
   * Purpose: Declares the input/result contract for list in SandboxesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<SandboxOverviewV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "list": () => Promise<SandboxOverviewV1>;
  /**
   * 签名 / Signature: SandboxesV1.create.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 create 的输入与结果契约，所属容器为 SandboxesV1。
   * Purpose: Declares the input/result contract for create in SandboxesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<SandboxViewV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "create": (input: unknown) => Promise<SandboxViewV1>;
  /**
   * 签名 / Signature: SandboxesV1.control.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 control 的输入与结果契约，所属容器为 SandboxesV1。
   * Purpose: Declares the input/result contract for control in SandboxesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; action: "start" | "stop" | "destroy"; expectedCreatedAt?: string（原沙箱创建身份 / original sandbox creation identity）
   * 输出 / Returns: Promise<{ ok: true; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "control": (id: string, action: "start" | "stop" | "destroy", expectedCreatedAt?: string) => Promise<{
    ok: true;
}>;
  /**
   * 签名 / Signature: SandboxesV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 SandboxesV1。
   * Purpose: Declares the input/result contract for run in SandboxesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, input: unknown) => import("../../shared/contracts/jobs.ts").JobView;
}

export interface SecretsV1 {
  /** Inspect opaque versions without decrypting; resolve only the same complete reference set. */
  references(id: string, refs?: Record<string, string>): Promise<Record<string, { name: string; version: string }>>;
  resolveVersioned(id: string, refs: Record<string, string>, versions: Record<string, string>): Promise<Record<string, string>>;
  /**
   * 签名 / Signature: SecretsV1.list.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 list 的输入与结果契约，所属容器为 SecretsV1。
   * Purpose: Declares the input/result contract for list in SecretsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ name: string; updatedAt: string; }[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "list": (id: string) => Promise<{
    name: string;
    updatedAt: string;
}[]>;
  /**
   * 签名 / Signature: SecretsV1.rotation.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 rotation 的输入与结果契约，所属容器为 SecretsV1。
   * Purpose: Declares the input/result contract for rotation in SecretsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<SecretRotationItemV1[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "rotation": (id: string) => Promise<SecretRotationItemV1[]>;
  /**
   * 签名 / Signature: SecretsV1.setRotation.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 setRotation 的输入与结果契约，所属容器为 SecretsV1。
   * Purpose: Declares the input/result contract for setRotation in SecretsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<SecretRotationItemV1[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "setRotation": (id: string, input: unknown) => Promise<SecretRotationItemV1[]>;
  /**
   * 签名 / Signature: SecretsV1.save.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 save 的输入与结果契约，所属容器为 SecretsV1。
   * Purpose: Declares the input/result contract for save in SecretsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<{ name: string; updatedAt: string; }[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "save": (id: string, input: unknown) => Promise<{
    name: string;
    updatedAt: string;
}[]>;
  /**
   * 签名 / Signature: SecretsV1.remove.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 remove 的输入与结果契约，所属容器为 SecretsV1。
   * Purpose: Declares the input/result contract for remove in SecretsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; name: string
   * 输出 / Returns: Promise<{ name: string; updatedAt: string; }[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "remove": (id: string, name: string) => Promise<{
    name: string;
    updatedAt: string;
}[]>;
  /**
   * 签名 / Signature: SecretsV1.value.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 value 的输入与结果契约，所属容器为 SecretsV1。
   * Purpose: Declares the input/result contract for value in SecretsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; name: string
   * 输出 / Returns: Promise<string>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "value": (id: string, name: string) => Promise<string>;
  /**
   * 签名 / Signature: SecretsV1.resolve.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 resolve 的输入与结果契约，所属容器为 SecretsV1。
   * Purpose: Declares the input/result contract for resolve in SecretsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; refs: Record<string, string> optional
   * 输出 / Returns: Promise<any>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "resolve": (id: string, refs?: Record<string, string>) => Promise<any>;
}

export interface ServiceHealthV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: ServiceHealthV1.expect.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 expect 的输入与结果契约，所属容器为 ServiceHealthV1。
   * Purpose: Declares the input/result contract for expect in ServiceHealthV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; action: "start" | "stop"; service: string | undefined optional
   * 输出 / Returns: Promise<(success: boolean) => void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "expect": (id: string, action: "start" | "stop", service?: string | undefined) => Promise<(success: boolean) => void>;
  /**
   * 签名 / Signature: ServiceHealthV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 ServiceHealthV1。
   * Purpose: Declares the input/result contract for view in ServiceHealthV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ services: HealthViewV1[]; job: import("../../shared/contracts/jobs.ts").JobView | null; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => Promise<{
    services: HealthViewV1[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}>;
  /**
   * 签名 / Signature: ServiceHealthV1.observed.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 observed 的输入与结果契约，所属容器为 ServiceHealthV1。
   * Purpose: Declares the input/result contract for observed in ServiceHealthV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: { projectId: string; name: string; desired: boolean; status: "stopped" | "healthy" | "unhealthy" | "waiting" | "restarting" | "exhausted"; failures: number; restarts: number; ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "observed": (id: string) => {
    projectId: string;
    name: string;
    desired: boolean;
    status: "stopped" | "healthy" | "unhealthy" | "waiting" | "restarting" | "exhausted";
    failures: number;
    restarts: number;
    checkedAt?: string | undefined;
    nextCheck: number;
    error?: string | undefined;
}[];
  /**
   * 签名 / Signature: ServiceHealthV1.tick.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 tick 的输入与结果契约，所属容器为 ServiceHealthV1。
   * Purpose: Declares the input/result contract for tick in ServiceHealthV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: now: number optional
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "tick": (now?: number) => Promise<void>;
}

export interface BundlesV1 {
  /**
   * 签名 / Signature: BundlesV1.export.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 export 的输入与结果契约，所属容器为 BundlesV1。
   * Purpose: Declares the input/result contract for export in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; target: import("stream").Writable; headers: () => void; signal: AbortSignal | undefined optional; bytesPerSecond: number optional; snapshotId: string | undefined optional; onCleanupError: ((error: unknown) => void) | undefined optional
   * 输出 / Returns: Promise<string>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "export": (id: string, target: import("stream").Writable, headers: () => void, signal?: AbortSignal | undefined, bytesPerSecond?: number, snapshotId?: string | undefined, onCleanupError?: ((error: unknown) => void) | undefined) => Promise<string>;
  /**
   * 签名 / Signature: BundlesV1.withExportBudget.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 withExportBudget 的输入与结果契约，所属容器为 BundlesV1。
   * Purpose: Declares the input/result contract for withExportBudget in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal; work: (diskBytes: number, exportFile: (target: import("stream").Writable, headers: () => vo…; storage: StorageRuntimeV1 optional; snapshotId: string | undefined optional
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "withExportBudget": <T>(id: string, signal: AbortSignal, work: (diskBytes: number, exportFile: (target: import("stream").Writable, headers: () => void, bytesPerSecond?: number | undefined, onCleanupError?: ((error: unknown) => void) | undefined) => Promise<string>) => Promise<T>, storage?: StorageRuntimeV1, snapshotId?: string | undefined) => Promise<T>;
  /**
   * 签名 / Signature: BundlesV1.import.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 import 的输入与结果契约，所属容器为 BundlesV1。
   * Purpose: Declares the input/result contract for import in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: name: string; source: import("stream").Readable; signal: AbortSignal | undefined optional; beforeAdopt: (() => void) | undefined optional; migrationOrigin: { sourceHostId: string; transferId: string; targetName: string; sourceVmId?: string |… optional; onCleanupError: ((error: unknown) => void) | undefined optional; lease: { id: string; release: () => void; assertActive: (checkSignal?: boolean) => void; res… optional
   * 输出 / Returns: Promise<import("../../shared/contracts/vm.ts").VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "import": (name: string, source: import("stream").Readable, signal?: AbortSignal | undefined, beforeAdopt?: (() => void) | undefined, migrationOrigin?: {
    sourceHostId: string;
    transferId: string;
    targetName: string;
    sourceVmId?: string | undefined;
    snapshotId?: string | undefined;
    diskSha256?: string | undefined;
} | undefined, onCleanupError?: ((error: unknown) => void) | undefined, lease?: {
    id: string;
    /**
     * 签名 / Signature: BundlesV1.release.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 release 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for release in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    release: () => void;
    /**
     * 签名 / Signature: BundlesV1.assertActive.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 assertActive 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for assertActive in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: checkSignal: boolean optional
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    assertActive: (checkSignal?: boolean) => void;
    /**
     * 签名 / Signature: BundlesV1.reserveTemporary.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 reserveTemporary 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for reserveTemporary in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: path: string; bytes: number
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    reserveTemporary: (path: string, bytes: number) => Promise<void>;
    /**
     * 签名 / Signature: BundlesV1.releaseTemporary.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 releaseTemporary 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for releaseTemporary in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: path: string
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    releaseTemporary: (path: string) => Promise<void>;
    /**
     * 签名 / Signature: BundlesV1.cleanupPending.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 cleanupPending 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for cleanupPending in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: error: unknown
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    cleanupPending: (error: unknown) => void;
    readonly pendingCleanup: boolean;
    /**
     * 签名 / Signature: BundlesV1.transfer.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 transfer 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for transfer in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: owner: string
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    transfer: (owner: string) => void;
} | undefined) => Promise<import("../../shared/contracts/vm.ts").VMView>;
  /**
   * 签名 / Signature: BundlesV1.importExternal.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 importExternal 的输入与结果契约，所属容器为 BundlesV1。
   * Purpose: Declares the input/result contract for importExternal in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: name: string; source: import("stream").Readable; signal: AbortSignal | undefined optional; lease: { id: string; release: () => void; assertActive: (checkSignal?: boolean) => void; res… optional
   * 输出 / Returns: Promise<import("../../shared/contracts/vm.ts").VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "importExternal": (name: string, source: import("stream").Readable, signal?: AbortSignal | undefined, lease?: {
    id: string;
    /**
     * 签名 / Signature: BundlesV1.release.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 release 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for release in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    release: () => void;
    /**
     * 签名 / Signature: BundlesV1.assertActive.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 assertActive 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for assertActive in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: checkSignal: boolean optional
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    assertActive: (checkSignal?: boolean) => void;
    /**
     * 签名 / Signature: BundlesV1.reserveTemporary.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 reserveTemporary 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for reserveTemporary in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: path: string; bytes: number
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    reserveTemporary: (path: string, bytes: number) => Promise<void>;
    /**
     * 签名 / Signature: BundlesV1.releaseTemporary.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 releaseTemporary 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for releaseTemporary in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: path: string
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    releaseTemporary: (path: string) => Promise<void>;
    /**
     * 签名 / Signature: BundlesV1.cleanupPending.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 cleanupPending 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for cleanupPending in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: error: unknown
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    cleanupPending: (error: unknown) => void;
    readonly pendingCleanup: boolean;
    /**
     * 签名 / Signature: BundlesV1.transfer.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 transfer 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for transfer in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: owner: string
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    transfer: (owner: string) => void;
} | undefined) => Promise<import("../../shared/contracts/vm.ts").VMView>;
  /**
   * 签名 / Signature: BundlesV1.withDisk.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 withDisk 的输入与结果契约，所属容器为 BundlesV1。
   * Purpose: Declares the input/result contract for withDisk in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: source: import("stream").Readable; signal: AbortSignal; work: (disk: string, diskEncryption?: import("../../shared/contracts/vm.ts").DiskEncryption…; lease: { id: string; release: () => void; assertActive: (checkSignal?: boolean) => void; res… optional
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "withDisk": <T>(source: import("stream").Readable, signal: AbortSignal, work: (disk: string, diskEncryption?: import("../../shared/contracts/vm.ts").DiskEncryptionConfig | undefined) => Promise<T>, lease?: {
    id: string;
    /**
     * 签名 / Signature: BundlesV1.release.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 release 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for release in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    release: () => void;
    /**
     * 签名 / Signature: BundlesV1.assertActive.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 assertActive 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for assertActive in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: checkSignal: boolean optional
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    assertActive: (checkSignal?: boolean) => void;
    /**
     * 签名 / Signature: BundlesV1.reserveTemporary.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 reserveTemporary 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for reserveTemporary in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: path: string; bytes: number
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    reserveTemporary: (path: string, bytes: number) => Promise<void>;
    /**
     * 签名 / Signature: BundlesV1.releaseTemporary.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 releaseTemporary 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for releaseTemporary in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: path: string
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    releaseTemporary: (path: string) => Promise<void>;
    /**
     * 签名 / Signature: BundlesV1.cleanupPending.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 cleanupPending 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for cleanupPending in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: error: unknown
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    cleanupPending: (error: unknown) => void;
    readonly pendingCleanup: boolean;
    /**
     * 签名 / Signature: BundlesV1.transfer.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 transfer 的输入与结果契约，所属容器为 BundlesV1。
     * Purpose: Declares the input/result contract for transfer in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: owner: string
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    transfer: (owner: string) => void;
} | undefined) => Promise<T>;
  /**
   * 签名 / Signature: BundlesV1.clone.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 clone 的输入与结果契约，所属容器为 BundlesV1。
   * Purpose: Declares the input/result contract for clone in BundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; name: string; snapshot: string | undefined optional; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<import("../../shared/contracts/vm.ts").VMView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "clone": (id: string, name: string, snapshot?: string | undefined, signal?: AbortSignal | undefined) => Promise<import("../../shared/contracts/vm.ts").VMView>;
}

export interface SignedBundlesV1 {
  /**
   * 签名 / Signature: SignedBundlesV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 SignedBundlesV1。
   * Purpose: Declares the input/result contract for view in SignedBundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { revision: number; requireTrustedOnImport: boolean; localKey: { name: string; fingerprint: string; publicKey: string; } | null; trustedKeys: { name: string; fingerprint: stri….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => {
    revision: number;
    requireTrustedOnImport: boolean;
    localKey: {
        name: string;
        fingerprint: string;
        publicKey: string;
    } | null;
    trustedKeys: {
        name: string;
        fingerprint: string;
        publicKey: string;
    }[];
};
  /**
   * 签名 / Signature: SignedBundlesV1.signManifest.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 signManifest 的输入与结果契约，所属容器为 SignedBundlesV1。
   * Purpose: Declares the input/result contract for signManifest in SignedBundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: manifest: T
   * 输出 / Returns: T & { signature?: { algorithm: "Ed25519"; publicKey: string; value: string; } | undefined; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "signManifest": <T extends Record<string, unknown>>(manifest: T) => T & {
    signature?: {
        algorithm: "Ed25519";
        publicKey: string;
        value: string;
    } | undefined;
};
  /**
   * 签名 / Signature: SignedBundlesV1.authorizeExternal.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 authorizeExternal 的输入与结果契约，所属容器为 SignedBundlesV1。
   * Purpose: Declares the input/result contract for authorizeExternal in SignedBundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: signature: { algorithm: "Ed25519"; publicKey: string; value: string; } | undefined optional
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "authorizeExternal": (signature?: {
    algorithm: "Ed25519";
    publicKey: string;
    value: string;
} | undefined) => void;
  /**
   * 签名 / Signature: SignedBundlesV1.withAuthorizedExternal.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 withAuthorizedExternal 的输入与结果契约，所属容器为 SignedBundlesV1。
   * Purpose: Declares the input/result contract for withAuthorizedExternal in SignedBundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: signature: { algorithm: "Ed25519"; publicKey: string; value: string; } | undefined; publish: () => Promise<T>
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "withAuthorizedExternal": <T>(signature: {
    algorithm: "Ed25519";
    publicKey: string;
    value: string;
} | undefined, publish: () => Promise<T>) => Promise<T>;
  /**
   * 签名 / Signature: SignedBundlesV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 SignedBundlesV1。
   * Purpose: Declares the input/result contract for action in SignedBundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ revision: number; requireTrustedOnImport: boolean; localKey: { name: string; fingerprint: string; publicKey: string; } | null; trustedKeys: { name: string; fingerpri….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (input: unknown) => Promise<{
    revision: number;
    requireTrustedOnImport: boolean;
    localKey: {
        name: string;
        fingerprint: string;
        publicKey: string;
    } | null;
    trustedKeys: {
        name: string;
        fingerprint: string;
        publicKey: string;
    }[];
}>;
}

export interface GoldenImagesV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: GoldenImagesV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 GoldenImagesV1。
   * Purpose: Declares the input/result contract for view in GoldenImagesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ templates: { version: 1; id: string; name: string; note: string; createdAt: string; sourceId: string; sourceName: string; distro: "alpine" | "debian" | "ubuntu"; dis….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => Promise<{
    templates: {
        version: 1;
        id: string;
        name: string;
        note: string;
        createdAt: string;
        sourceId: string;
        sourceName: string;
        distro: "alpine" | "debian" | "ubuntu";
        diskGiB: number;
        bytes: number;
        sha256: string;
        architecture?: "x86_64" | "aarch64" | undefined;
    }[];
    issues: {
        id: string;
        error: string;
    }[];
    limits: {
        count: number;
        bytes: number;
        imageBytes: number;
    };
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    persistenceError: string | undefined;
}>;
  /**
   * 签名 / Signature: GoldenImagesV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 GoldenImagesV1。
   * Purpose: Declares the input/result contract for action in GoldenImagesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: raw: unknown; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ kind: "template" | "vm" | "verified" | "deleted"; id: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (raw: unknown, signal?: AbortSignal | undefined) => Promise<{
    kind: "template" | "vm" | "verified" | "deleted";
    id: string;
}>;
}

export interface RescueV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: RescueV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 RescueV1。
   * Purpose: Declares the input/result contract for view in RescueV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: { runs: import("../../shared/contracts/jobs.ts").JobView[]; persistenceError: string | undefined; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => {
    runs: import("../../shared/contracts/jobs.ts").JobView[];
    persistenceError: string | undefined;
};
  /**
   * 签名 / Signature: RescueV1.artifact.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 artifact 的输入与结果契约，所属容器为 RescueV1。
   * Purpose: Declares the input/result contract for artifact in RescueV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; run: string; artifact: string
   * 输出 / Returns: Promise<{ base64: string; id: string; name: string; path: string; bytes: number; sha256: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "artifact": (id: string, run: string, artifact: string) => Promise<{
    base64: string;
    id: string;
    name: string;
    path: string;
    bytes: number;
    sha256: string;
}>;
  /**
   * 签名 / Signature: RescueV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 RescueV1。
   * Purpose: Declares the input/result contract for run in RescueV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, input: unknown) => import("../../shared/contracts/jobs.ts").JobView;
}

export interface SnapshotDiffV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: SnapshotDiffV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 SnapshotDiffV1。
   * Purpose: Declares the input/result contract for view in SnapshotDiffV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: { runs: import("../../shared/contracts/jobs.ts").JobView[]; persistenceError: string | undefined; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => {
    runs: import("../../shared/contracts/jobs.ts").JobView[];
    persistenceError: string | undefined;
};
  /**
   * 签名 / Signature: SnapshotDiffV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 SnapshotDiffV1。
   * Purpose: Declares the input/result contract for run in SnapshotDiffV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, raw: unknown) => import("../../shared/contracts/jobs.ts").JobView;
}

export interface SnapshotMergeV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: SnapshotMergeV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 SnapshotMergeV1。
   * Purpose: Declares the input/result contract for view in SnapshotMergeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: { persistenceError?: string | undefined; runs: import("../../shared/contracts/jobs.ts").JobView[]; sourceName?: string | undefined; branchOrigin?: { sourceVmId: string; snapsh….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => {
    persistenceError?: string | undefined;
    runs: import("../../shared/contracts/jobs.ts").JobView[];
    sourceName?: string | undefined;
    branchOrigin?: {
        sourceVmId: string;
        snapshotId: string;
        createdAt: string;
    } | undefined;
};
  /**
   * 签名 / Signature: SnapshotMergeV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 SnapshotMergeV1。
   * Purpose: Declares the input/result contract for run in SnapshotMergeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: import("../../shared/contracts/jobs.ts").JobView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, raw: unknown) => import("../../shared/contracts/jobs.ts").JobView;
}

export interface FolderSyncV1 {
  /**
   * 签名 / Signature: FolderSyncV1.recoveryTickets.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 recoveryTickets 的输入与结果契约，所属容器为 FolderSyncV1。
   * Purpose: Declares the input/result contract for recoveryTickets in FolderSyncV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<DomainRecoveryTicket[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "recoveryTickets": () => Promise<DomainRecoveryTicket[]>;
  /**
   * 签名 / Signature: FolderSyncV1.recoverTicket.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 recoverTicket 的输入与结果契约，所属容器为 FolderSyncV1。
   * Purpose: Declares the input/result contract for recoverTicket in FolderSyncV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: ticket: DomainRecoveryTicket
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "recoverTicket": (ticket: DomainRecoveryTicket) => Promise<void>;
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: FolderSyncV1.config.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 config 的输入与结果契约，所属容器为 FolderSyncV1。
   * Purpose: Declares the input/result contract for config in FolderSyncV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ host: string; guest: string; auto: boolean; mergeText?: boolean | undefined; detectRenames?: boolean | undefined; rollback?: boolean | undefined; watch?: boolean | u….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "config": (id: string) => Promise<{
    host: string;
    guest: string;
    auto: boolean;
    mergeText?: boolean | undefined;
    detectRenames?: boolean | undefined;
    rollback?: boolean | undefined;
    watch?: boolean | undefined;
    policies?: {
        pattern: string;
        direction: "readonly" | "push" | "pull" | "both";
        guestMode?: string | undefined;
    }[] | undefined;
    drivers?: {
        pattern: string;
        mode: "manual" | "keep-both" | "prefer-host" | "prefer-guest" | "merge-text";
    }[] | undefined;
    window?: {
        days: number[];
        start: string;
        end: string;
        timeZone: string;
    } | undefined;
    bandwidthMiBps?: number | undefined;
    ignore?: string[] | undefined;
} | null>;
  /**
   * 签名 / Signature: FolderSyncV1.save.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 save 的输入与结果契约，所属容器为 FolderSyncV1。
   * Purpose: Declares the input/result contract for save in FolderSyncV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<{ host: string; guest: string; auto: boolean; mergeText?: boolean | undefined; detectRenames?: boolean | undefined; rollback?: boolean | undefined; watch?: boolean | u….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "save": (id: string, input: unknown) => Promise<{
    host: string;
    guest: string;
    auto: boolean;
    mergeText?: boolean | undefined;
    detectRenames?: boolean | undefined;
    rollback?: boolean | undefined;
    watch?: boolean | undefined;
    policies?: {
        pattern: string;
        direction: "readonly" | "push" | "pull" | "both";
        guestMode?: string | undefined;
    }[] | undefined;
    drivers?: {
        pattern: string;
        mode: "manual" | "keep-both" | "prefer-host" | "prefer-guest" | "merge-text";
    }[] | undefined;
    window?: {
        days: number[];
        start: string;
        end: string;
        timeZone: string;
    } | undefined;
    bandwidthMiBps?: number | undefined;
    ignore?: string[] | undefined;
}>;
  /**
   * 签名 / Signature: FolderSyncV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 FolderSyncV1。
   * Purpose: Declares the input/result contract for view in FolderSyncV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ projectId: string; config: { host: string; guest: string; auto: boolean; mergeText?: boolean | undefined; detectRenames?: boolean | undefined; rollback?: boolean | u….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => Promise<{
    projectId: string;
    config: {
        host: string;
        guest: string;
        auto: boolean;
        mergeText?: boolean | undefined;
        detectRenames?: boolean | undefined;
        rollback?: boolean | undefined;
        watch?: boolean | undefined;
        policies?: {
            pattern: string;
            direction: "readonly" | "push" | "pull" | "both";
            guestMode?: string | undefined;
        }[] | undefined;
        drivers?: {
            pattern: string;
            mode: "manual" | "keep-both" | "prefer-host" | "prefer-guest" | "merge-text";
        }[] | undefined;
        window?: {
            days: number[];
            start: string;
            end: string;
            timeZone: string;
        } | undefined;
        bandwidthMiBps?: number | undefined;
        ignore?: string[] | undefined;
    } | null;
    job: import("../../shared/contracts/jobs.ts").JobView | null;
    queue: {
        id: string;
        requestedAt: string;
        attempts: number;
        nextAttemptAt: number;
        jobId?: string | undefined;
        lastError?: string | undefined;
    } | null;
    maintenance: boolean;
    history: SyncHistoryViewV1[];
    watching: SyncWatchViewV1 | null;
}>;
  /**
   * 签名 / Signature: FolderSyncV1.queue.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 queue 的输入与结果契约，所属容器为 FolderSyncV1。
   * Purpose: Declares the input/result contract for queue in FolderSyncV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; cancel: boolean optional
   * 输出 / Returns: Promise<{ id: string; requestedAt: string; attempts: number; nextAttemptAt: number; jobId?: string | undefined; lastError?: string | undefined; } | null>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "queue": (id: string, cancel?: boolean) => Promise<{
    id: string;
    requestedAt: string;
    attempts: number;
    nextAttemptAt: number;
    jobId?: string | undefined;
    lastError?: string | undefined;
} | null>;
  /**
   * 签名 / Signature: FolderSyncV1.tick.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 tick 的输入与结果契约，所属容器为 FolderSyncV1。
   * Purpose: Declares the input/result contract for tick in FolderSyncV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: now: number optional; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "tick": (now?: number, signal?: AbortSignal | undefined) => Promise<void>;
  /**
   * 签名 / Signature: FolderSyncV1.preview.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 preview 的输入与结果契约，所属容器为 FolderSyncV1。
   * Purpose: Declares the input/result contract for preview in FolderSyncV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: Promise<SyncPreviewV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "preview": (id: string, signal?: AbortSignal) => Promise<SyncPreviewV1>;
  /**
   * 签名 / Signature: FolderSyncV1.mergePreview.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 mergePreview 的输入与结果契约，所属容器为 FolderSyncV1。
   * Purpose: Declares the input/result contract for mergePreview in FolderSyncV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; inputPath: string; token: string; signal: AbortSignal optional
   * 输出 / Returns: Promise<{ path: string; token: string; base: string; ours: string; theirs: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "mergePreview": (id: string, inputPath: string, token: string, signal?: AbortSignal) => Promise<{
    path: string;
    token: string;
    base: string;
    ours: string;
    theirs: string;
}>;
  /**
   * 签名 / Signature: FolderSyncV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 FolderSyncV1。
   * Purpose: Declares the input/result contract for run in FolderSyncV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; direction: "push" | "pull" | "both"; token: string | undefined optional; decisions: SyncDecisionsV1 optional; merges: SyncManualMergesV1 optional
   * 输出 / Returns: Promise<import("../../shared/contracts/jobs.ts").JobView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, direction: "push" | "pull" | "both", token?: string | undefined, decisions?: SyncDecisionsV1, merges?: SyncManualMergesV1) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
  /**
   * 签名 / Signature: FolderSyncV1.rollback.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 rollback 的输入与结果契约，所属容器为 FolderSyncV1。
   * Purpose: Declares the input/result contract for rollback in FolderSyncV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; checkpoint: string
   * 输出 / Returns: Promise<import("../../shared/contracts/jobs.ts").JobView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "rollback": (id: string, checkpoint: string) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
}

export interface ProjectTerminalsV1 {
  "workspaces": Readonly<Pick<WorkspacesV1, "view" | "jobs" | "projects" | "beforeAction" | "onConfigChange" | "beforeConfigChange" | "config" | "readCommittedConfig" | "networkEnvironment" | "dependencyDownloadAuthentication" | "repositoryDownloadAuthentication" | "resolvedConfig" | "resolveProject" | "save" | "run" | "runPrepared" | "runtime" | "metrics">>;
  "preparation": ProjectPreparationV1;
  /**
   * 签名 / Signature: ProjectTerminalsV1.prepareTask.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 prepareTask 的输入与结果契约，所属容器为 ProjectTerminalsV1。
   * Purpose: Declares the input/result contract for prepareTask in ProjectTerminalsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; projectId: string | null | undefined; signal: AbortSignal | undefined optional; options: { verifyOnly?: boolean | undefined; } optional
   * 输出 / Returns: Promise<PreparedProjectV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "prepareTask": (id: string, projectId: string | null | undefined, signal?: AbortSignal | undefined, options?: {
    verifyOnly?: boolean | undefined;
}) => Promise<PreparedProjectV1>;
  /**
   * 签名 / Signature: ProjectTerminalsV1.prepare.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 prepare 的输入与结果契约，所属容器为 ProjectTerminalsV1。
   * Purpose: Declares the input/result contract for prepare in ProjectTerminalsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; projectId: string | null | undefined; session: string | null | undefined optional; readOnly: boolean optional; signal: AbortSignal | undefined optional; expectedTerminalId: string | undefined optional; options: { mode?: "task" | undefined; verifyOnly?: boolean | undefined; } optional
   * 输出 / Returns: Promise<PreparedProjectV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "prepare": (id: string, projectId: string | null | undefined, session?: string | null | undefined, readOnly?: boolean, signal?: AbortSignal | undefined, expectedTerminalId?: string | undefined, options?: {
    mode?: "task" | undefined;
    verifyOnly?: boolean | undefined;
}) => Promise<PreparedProjectV1>;
  /**
   * 签名 / Signature: ProjectTerminalsV1.validate.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 validate 的输入与结果契约，所属容器为 ProjectTerminalsV1。
   * Purpose: Declares the input/result contract for validate in ProjectTerminalsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; projectId: string | undefined; session: string
   * 输出 / Returns: Promise<{ projectId: string; terminalId: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "validate": (id: string, projectId: string | undefined, session: string) => Promise<{
    projectId: string;
    terminalId: string;
}>;
  /**
   * 签名 / Signature: ProjectTerminalsV1.stop.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 stop 的输入与结果契约，所属容器为 ProjectTerminalsV1。
   * Purpose: Declares the input/result contract for stop in ProjectTerminalsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; projectId: string; session: string | undefined optional; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "stop": (id: string, projectId: string, session?: string | undefined, signal?: AbortSignal | undefined) => Promise<void>;
  /**
   * 签名 / Signature: ProjectTerminalsV1.close.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 close 的输入与结果契约，所属容器为 ProjectTerminalsV1。
   * Purpose: Declares the input/result contract for close in ProjectTerminalsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "close": () => Promise<void>;
}

export interface ToolchainsV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: ToolchainsV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 ToolchainsV1。
   * Purpose: Declares the input/result contract for view in ToolchainsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ tools: { id: string; name: "Go" | "Git" | "Node.js / npm" | "Python / pip" | "Rust / Cargo" | "Java JDK" | "PHP"; installed: boolean; version: string; required: bool….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string, signal?: AbortSignal | undefined) => Promise<{
    tools: {
        id: string;
        name: "Go" | "Git" | "Node.js / npm" | "Python / pip" | "Rust / Cargo" | "Java JDK" | "PHP";
        installed: boolean;
        version: string;
        required: boolean;
    }[];
    job: import("../../shared/contracts/jobs.ts").JobView | null;
}>;
  /**
   * 签名 / Signature: ToolchainsV1.install.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 install 的输入与结果契约，所属容器为 ToolchainsV1。
   * Purpose: Declares the input/result contract for install in ToolchainsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<import("../../shared/contracts/jobs.ts").JobView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "install": (id: string, input: unknown) => Promise<import("../../shared/contracts/jobs.ts").JobView>;
}

export interface DownloadsV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: DownloadsV1.issue.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 issue 的输入与结果契约，所属容器为 DownloadsV1。
   * Purpose: Declares the input/result contract for issue in DownloadsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<{ url: string; expiresAt: number; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "issue": (id: string, input: unknown) => Promise<{
    url: string;
    expiresAt: number;
}>;
  /**
   * 签名 / Signature: DownloadsV1.issueLocal.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 issueLocal 的输入与结果契约，所属容器为 DownloadsV1。
   * Purpose: Declares the input/result contract for issueLocal in DownloadsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; file: { path: string; name: string; }
   * 输出 / Returns: Promise<{ url: string; expiresAt: number; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "issueLocal": (id: string, file: {
    path: string;
    name: string;
}) => Promise<{
    url: string;
    expiresAt: number;
}>;
  /**
   * 签名 / Signature: DownloadsV1.issueStream.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 issueStream 的输入与结果契约，所属容器为 DownloadsV1。
   * Purpose: Declares the input/result contract for issueStream in DownloadsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; content: StreamDownloadV1 & { name: string; }
   * 输出 / Returns: { url: string; expiresAt: number; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "issueStream": (id: string, content: StreamDownloadV1 & {
    name: string;
}) => {
    url: string;
    expiresAt: number;
};
  /**
   * 签名 / Signature: DownloadsV1.route.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 route 的输入与结果契约，所属容器为 DownloadsV1。
   * Purpose: Declares the input/result contract for route in DownloadsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: req: import("http").IncomingMessage; res: import("http").ServerResponse<import("http").IncomingMessage>; url: URL
   * 输出 / Returns: Promise<boolean>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "route": (req: import("http").IncomingMessage, res: import("http").ServerResponse<import("http").IncomingMessage>, url: URL) => Promise<boolean>;
  /**
   * 签名 / Signature: DownloadsV1.send.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 send 的输入与结果契约，所属容器为 DownloadsV1。
   * Purpose: Declares the input/result contract for send in DownloadsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: target: DownloadTargetV1; res: import("http").ServerResponse<import("http").IncomingMessage>
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "send": (target: DownloadTargetV1, res: import("http").ServerResponse<import("http").IncomingMessage>) => Promise<void>;
}

export interface SessionLockV1 {
  /**
   * 签名 / Signature: SessionLockV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 SessionLockV1。
   * Purpose: Declares the input/result contract for view in SessionLockV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: import("../../shared/session-lock.ts").SessionLockView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => import("../../shared/session-lock.ts").SessionLockView;
  /**
   * 签名 / Signature: SessionLockV1.getGeneration.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 getGeneration 的输入与结果契约，所属容器为 SessionLockV1。
   * Purpose: Declares the input/result contract for getGeneration in SessionLockV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: number.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "getGeneration": () => number;
  /**
   * 签名 / Signature: SessionLockV1.requireUnlocked.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 requireUnlocked 的输入与结果契约，所属容器为 SessionLockV1。
   * Purpose: Declares the input/result contract for requireUnlocked in SessionLockV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "requireUnlocked": () => void;
  /**
   * 签名 / Signature: SessionLockV1.activity.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 activity 的输入与结果契约，所属容器为 SessionLockV1。
   * Purpose: Declares the input/result contract for activity in SessionLockV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: import("../../shared/session-lock.ts").SessionLockView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "activity": () => import("../../shared/session-lock.ts").SessionLockView;
  /**
   * 签名 / Signature: SessionLockV1.lock.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 lock 的输入与结果契约，所属容器为 SessionLockV1。
   * Purpose: Declares the input/result contract for lock in SessionLockV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: import("../../shared/session-lock.ts").SessionLockView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "lock": () => import("../../shared/session-lock.ts").SessionLockView;
  /**
   * 签名 / Signature: SessionLockV1.configure.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configure 的输入与结果契约，所属容器为 SessionLockV1。
   * Purpose: Declares the input/result contract for configure in SessionLockV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<import("../../shared/session-lock.ts").SessionLockView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configure": (input: unknown) => Promise<import("../../shared/session-lock.ts").SessionLockView>;
  /**
   * 签名 / Signature: SessionLockV1.unlock.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 unlock 的输入与结果契约，所属容器为 SessionLockV1。
   * Purpose: Declares the input/result contract for unlock in SessionLockV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<import("../../shared/session-lock.ts").SessionLockView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "unlock": (input: unknown) => Promise<import("../../shared/session-lock.ts").SessionLockView>;
  /**
   * 签名 / Signature: SessionLockV1.unlockWithPasskey.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 unlockWithPasskey 的输入与结果契约，所属容器为 SessionLockV1。
   * Purpose: Declares the input/result contract for unlockWithPasskey in SessionLockV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: expectedGeneration: number
   * 输出 / Returns: Promise<import("../../shared/session-lock.ts").SessionLockView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "unlockWithPasskey": (expectedGeneration: number) => Promise<import("../../shared/session-lock.ts").SessionLockView>;
}

export interface AccessControlV1 {
  readonly "enabled": boolean;
  /**
   * 签名 / Signature: AccessControlV1.status.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 status 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for status in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { enabled: boolean; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "status": () => {
    enabled: boolean;
};
  /**
   * 签名 / Signature: AccessControlV1.users.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 users 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for users in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { id: string; username: string; role: "member" | "owner" | "viewer"; vmIds: string[]; expiresAt: number | null; createdAt: string; }[].
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "users": () => {
    id: string;
    username: string;
    role: "member" | "owner" | "viewer";
    vmIds: string[];
    expiresAt: number | null;
    createdAt: string;
}[];
  /**
   * 签名 / Signature: AccessControlV1.passkeysFor.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 passkeysFor 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for passkeysFor in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: accountId: string
   * 输出 / Returns: { id: string; name: string; createdAt: string; lastUsedAt?: string | undefined; }[].
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "passkeysFor": (accountId: string) => {
    id: string;
    name: string;
    createdAt: string;
    lastUsedAt?: string | undefined;
}[];
  /**
   * 签名 / Signature: AccessControlV1.registeredPasskeysFor.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 registeredPasskeysFor 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for registeredPasskeysFor in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: accountId: string
   * 输出 / Returns: { id: string; publicKey: string; counter: number; transports: string[]; name: string; createdAt: string; lastUsedAt?: string | undefined; }[].
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "registeredPasskeysFor": (accountId: string) => {
    id: string;
    publicKey: string;
    counter: number;
    transports: string[];
    name: string;
    createdAt: string;
    lastUsedAt?: string | undefined;
}[];
  /**
   * 签名 / Signature: AccessControlV1.getPasskey.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 getPasskey 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for getPasskey in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: { user: { id: string; username: string; role: "member" | "owner" | "viewer"; credential: { salt: string; hash: string; }; vmIds: string[]; expiresAt: number | null; createdAt:….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "getPasskey": (id: string) => {
    user: {
        id: string;
        username: string;
        role: "member" | "owner" | "viewer";
        credential: {
            salt: string;
            hash: string;
        };
        vmIds: string[];
        expiresAt: number | null;
        createdAt: string;
        passkeys: {
            id: string;
            publicKey: string;
            counter: number;
            transports: string[];
            name: string;
            createdAt: string;
            lastUsedAt?: string | undefined;
        }[];
    };
    key: {
        id: string;
        publicKey: string;
        counter: number;
        transports: string[];
        name: string;
        createdAt: string;
        lastUsedAt?: string | undefined;
    };
} | null;
  /**
   * 签名 / Signature: AccessControlV1.enable.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 enable 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for enable in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ enabled: boolean; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "enable": (input: unknown) => Promise<{
    enabled: boolean;
}>;
  /**
   * 签名 / Signature: AccessControlV1.login.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 login 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for login in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ token: string; principal: PrincipalV1; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "login": (input: unknown) => Promise<{
    token: string;
    principal: PrincipalV1;
}>;
  /**
   * 签名 / Signature: AccessControlV1.completeFederatedLogin.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 completeFederatedLogin 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for completeFederatedLogin in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: accountId: string; credentialId: string
   * 输出 / Returns: Promise<{ token: string; principal: PrincipalV1; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "completeFederatedLogin": (accountId: string, credentialId: string) => Promise<{
    token: string;
    principal: PrincipalV1;
}>;
  /**
   * 签名 / Signature: AccessControlV1.revokeFederatedCredential.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 revokeFederatedCredential 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for revokeFederatedCredential in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: credentialId: string
   * 输出 / Returns: number.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "revokeFederatedCredential": (credentialId: string) => number;
  /**
   * 签名 / Signature: AccessControlV1.authorize.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 authorize 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for authorize in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: PrincipalV1.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "authorize": (value: unknown) => PrincipalV1;
  /**
   * 签名 / Signature: AccessControlV1.logout.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 logout 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for logout in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: { ok: boolean; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "logout": (value: unknown) => {
    ok: boolean;
};
  /**
   * 签名 / Signature: AccessControlV1.revokeAll.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 revokeAll 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for revokeAll in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "revokeAll": () => void;
  /**
   * 签名 / Signature: AccessControlV1.createHandoff.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 createHandoff 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for createHandoff in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: sourceToken: unknown
   * 输出 / Returns: Promise<{ code: string; expiresAt: number; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "createHandoff": (sourceToken: unknown) => Promise<{
    code: string;
    expiresAt: number;
}>;
  /**
   * 签名 / Signature: AccessControlV1.cancelHandoff.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 cancelHandoff 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for cancelHandoff in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: sourceToken: unknown
   * 输出 / Returns: { cancelled: boolean; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "cancelHandoff": (sourceToken: unknown) => {
    cancelled: boolean;
};
  /**
   * 签名 / Signature: AccessControlV1.redeemHandoff.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 redeemHandoff 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for redeemHandoff in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ sourceToken: string; token: string; principal: PrincipalV1; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "redeemHandoff": (input: unknown) => Promise<{
    sourceToken: string;
    token: string;
    principal: PrincipalV1;
}>;
  /**
   * 签名 / Signature: AccessControlV1.createViewer.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 createViewer 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for createViewer in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ id: string; username: string; role: "member" | "owner" | "viewer"; vmIds: string[]; expiresAt: number | null; createdAt: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "createViewer": (input: unknown) => Promise<{
    id: string;
    username: string;
    role: "member" | "owner" | "viewer";
    vmIds: string[];
    expiresAt: number | null;
    createdAt: string;
}>;
  /**
   * 签名 / Signature: AccessControlV1.createMember.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 createMember 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for createMember in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ id: string; username: string; role: "member" | "owner" | "viewer"; vmIds: string[]; expiresAt: number | null; createdAt: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "createMember": (input: unknown) => Promise<{
    id: string;
    username: string;
    role: "member" | "owner" | "viewer";
    vmIds: string[];
    expiresAt: number | null;
    createdAt: string;
}>;
  /**
   * 签名 / Signature: AccessControlV1.removeViewer.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 removeViewer 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for removeViewer in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ removed: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "removeViewer": (id: string) => Promise<{
    removed: string;
}>;
  /**
   * 签名 / Signature: AccessControlV1.removeMember.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 removeMember 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for removeMember in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ removed: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "removeMember": (id: string) => Promise<{
    removed: string;
}>;
  /**
   * 签名 / Signature: AccessControlV1.addPasskey.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 addPasskey 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for addPasskey in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: accountId: string; input: unknown
   * 输出 / Returns: Promise<{ id: string; name: string; createdAt: string; lastUsedAt?: string | undefined; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "addPasskey": (accountId: string, input: unknown) => Promise<{
    id: string;
    name: string;
    createdAt: string;
    lastUsedAt?: string | undefined;
}>;
  /**
   * 签名 / Signature: AccessControlV1.removePasskey.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 removePasskey 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for removePasskey in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: accountId: string; id: string
   * 输出 / Returns: Promise<{ removed: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "removePasskey": (accountId: string, id: string) => Promise<{
    removed: string;
}>;
  /**
   * 签名 / Signature: AccessControlV1.completePasskeyLogin.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 completePasskeyLogin 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for completePasskeyLogin in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: accountId: string; id: string; previousCounter: number; newCounter: number
   * 输出 / Returns: Promise<{ token: string; principal: PrincipalV1; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "completePasskeyLogin": (accountId: string, id: string, previousCounter: number, newCounter: number) => Promise<{
    token: string;
    principal: PrincipalV1;
}>;
  /**
   * 签名 / Signature: AccessControlV1.changeOwnerPassword.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 changeOwnerPassword 的输入与结果契约，所属容器为 AccessControlV1。
   * Purpose: Declares the input/result contract for changeOwnerPassword in AccessControlV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ changed: boolean; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "changeOwnerPassword": (input: unknown) => Promise<{
    changed: boolean;
}>;
}

export interface PasskeysV1 {
  /**
   * 签名 / Signature: PasskeysV1.beginRegistration.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 beginRegistration 的输入与结果契约，所属容器为 PasskeysV1。
   * Purpose: Declares the input/result contract for beginRegistration in PasskeysV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: principal: PrincipalV1; input: unknown
   * 输出 / Returns: Promise<{ ceremonyId: string; options: import("@simplewebauthn/server").PublicKeyCredentialCreationOptionsJSON; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "beginRegistration": (principal: PrincipalV1, input: unknown) => Promise<{
    ceremonyId: string;
    options: import("@simplewebauthn/server").PublicKeyCredentialCreationOptionsJSON;
}>;
  /**
   * 签名 / Signature: PasskeysV1.finishRegistration.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 finishRegistration 的输入与结果契约，所属容器为 PasskeysV1。
   * Purpose: Declares the input/result contract for finishRegistration in PasskeysV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: principal: PrincipalV1; input: unknown
   * 输出 / Returns: Promise<{ id: string; name: string; createdAt: string; lastUsedAt?: string | undefined; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "finishRegistration": (principal: PrincipalV1, input: unknown) => Promise<{
    id: string;
    name: string;
    createdAt: string;
    lastUsedAt?: string | undefined;
}>;
  /**
   * 签名 / Signature: PasskeysV1.beginAuthentication.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 beginAuthentication 的输入与结果契约，所属容器为 PasskeysV1。
   * Purpose: Declares the input/result contract for beginAuthentication in PasskeysV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ ceremonyId: string; options: import("@simplewebauthn/server").PublicKeyCredentialRequestOptionsJSON; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "beginAuthentication": () => Promise<{
    ceremonyId: string;
    options: import("@simplewebauthn/server").PublicKeyCredentialRequestOptionsJSON;
}>;
  /**
   * 签名 / Signature: PasskeysV1.beginUnlock.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 beginUnlock 的输入与结果契约，所属容器为 PasskeysV1。
   * Purpose: Declares the input/result contract for beginUnlock in PasskeysV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: lockGeneration: number
   * 输出 / Returns: Promise<{ ceremonyId: string; options: import("@simplewebauthn/server").PublicKeyCredentialRequestOptionsJSON; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "beginUnlock": (lockGeneration: number) => Promise<{
    ceremonyId: string;
    options: import("@simplewebauthn/server").PublicKeyCredentialRequestOptionsJSON;
}>;
  /**
   * 签名 / Signature: PasskeysV1.finishAuthentication.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 finishAuthentication 的输入与结果契约，所属容器为 PasskeysV1。
   * Purpose: Declares the input/result contract for finishAuthentication in PasskeysV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ token: string; principal: PrincipalV1; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "finishAuthentication": (input: unknown) => Promise<{
    token: string;
    principal: PrincipalV1;
}>;
  /**
   * 签名 / Signature: PasskeysV1.finishUnlock.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 finishUnlock 的输入与结果契约，所属容器为 PasskeysV1。
   * Purpose: Declares the input/result contract for finishUnlock in PasskeysV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ login: { token: string; principal: PrincipalV1; }; lockGeneration: number | undefined; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "finishUnlock": (input: unknown) => Promise<{
    login: {
        token: string;
        principal: PrincipalV1;
    };
    lockGeneration: number | undefined;
}>;
}

export interface SingleSignOnV1 {
  /**
   * 签名 / Signature: SingleSignOnV1.cancelPending.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 cancelPending 的输入与结果契约，所属容器为 SingleSignOnV1。
   * Purpose: Declares the input/result contract for cancelPending in SingleSignOnV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "cancelPending": () => void;
  /**
   * 签名 / Signature: SingleSignOnV1.pendingOrigin.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 pendingOrigin 的输入与结果契约，所属容器为 SingleSignOnV1。
   * Purpose: Declares the input/result contract for pendingOrigin in SingleSignOnV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: providerId: "oidc" | "saml"; state: string
   * 输出 / Returns: string | null.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "pendingOrigin": (providerId: "oidc" | "saml", state: string) => string | null;
  /**
   * 签名 / Signature: SingleSignOnV1.providers.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 providers 的输入与结果契约，所属容器为 SingleSignOnV1。
   * Purpose: Declares the input/result contract for providers in SingleSignOnV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { oidc: boolean; saml: boolean; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "providers": () => {
    oidc: boolean;
    saml: boolean;
};
  /**
   * 签名 / Signature: SingleSignOnV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 SingleSignOnV1。
   * Purpose: Declares the input/result contract for view in SingleSignOnV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: accountId: string | undefined optional
   * 输出 / Returns: { oidc: { issuer: string; clientId: string; authMethod: "none" | "client_secret_basic" | "client_secret_post"; hasSecret: boolean; } | undefined; saml: { issuer: string; entry….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (accountId?: string | undefined) => {
    oidc: {
        issuer: string;
        clientId: string;
        authMethod: "none" | "client_secret_basic" | "client_secret_post";
        hasSecret: boolean;
    } | undefined;
    saml: {
        issuer: string;
        entryPoint: string;
        fingerprints: string[];
    } | undefined;
    callbackUrl: string;
    samlCallbackUrl: string;
    serviceProviderId: string;
    bindings: {
        id: string;
        provider: "oidc" | "saml";
        accountId: string;
        issuer: string;
        subject: string;
        createdAt: string;
    }[];
};
  /**
   * 签名 / Signature: SingleSignOnV1.configureOidc.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configureOidc 的输入与结果契约，所属容器为 SingleSignOnV1。
   * Purpose: Declares the input/result contract for configureOidc in SingleSignOnV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: raw: unknown
   * 输出 / Returns: Promise<{ oidc: { issuer: string; clientId: string; authMethod: "none" | "client_secret_basic" | "client_secret_post"; hasSecret: boolean; } | undefined; saml: { issuer: strin….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configureOidc": (raw: unknown) => Promise<{
    oidc: {
        issuer: string;
        clientId: string;
        authMethod: "none" | "client_secret_basic" | "client_secret_post";
        hasSecret: boolean;
    } | undefined;
    saml: {
        issuer: string;
        entryPoint: string;
        fingerprints: string[];
    } | undefined;
    callbackUrl: string;
    samlCallbackUrl: string;
    serviceProviderId: string;
    bindings: {
        id: string;
        provider: "oidc" | "saml";
        accountId: string;
        issuer: string;
        subject: string;
        createdAt: string;
    }[];
}>;
  /**
   * 签名 / Signature: SingleSignOnV1.configureSaml.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configureSaml 的输入与结果契约，所属容器为 SingleSignOnV1。
   * Purpose: Declares the input/result contract for configureSaml in SingleSignOnV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: raw: unknown
   * 输出 / Returns: Promise<{ oidc: { issuer: string; clientId: string; authMethod: "none" | "client_secret_basic" | "client_secret_post"; hasSecret: boolean; } | undefined; saml: { issuer: strin….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configureSaml": (raw: unknown) => Promise<{
    oidc: {
        issuer: string;
        clientId: string;
        authMethod: "none" | "client_secret_basic" | "client_secret_post";
        hasSecret: boolean;
    } | undefined;
    saml: {
        issuer: string;
        entryPoint: string;
        fingerprints: string[];
    } | undefined;
    callbackUrl: string;
    samlCallbackUrl: string;
    serviceProviderId: string;
    bindings: {
        id: string;
        provider: "oidc" | "saml";
        accountId: string;
        issuer: string;
        subject: string;
        createdAt: string;
    }[];
}>;
  /**
   * 签名 / Signature: SingleSignOnV1.disable.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 disable 的输入与结果契约，所属容器为 SingleSignOnV1。
   * Purpose: Declares the input/result contract for disable in SingleSignOnV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: providerId: "oidc" | "saml"
   * 输出 / Returns: Promise<{ oidc: { issuer: string; clientId: string; authMethod: "none" | "client_secret_basic" | "client_secret_post"; hasSecret: boolean; } | undefined; saml: { issuer: strin….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "disable": (providerId: "oidc" | "saml") => Promise<{
    oidc: {
        issuer: string;
        clientId: string;
        authMethod: "none" | "client_secret_basic" | "client_secret_post";
        hasSecret: boolean;
    } | undefined;
    saml: {
        issuer: string;
        entryPoint: string;
        fingerprints: string[];
    } | undefined;
    callbackUrl: string;
    samlCallbackUrl: string;
    serviceProviderId: string;
    bindings: {
        id: string;
        provider: "oidc" | "saml";
        accountId: string;
        issuer: string;
        subject: string;
        createdAt: string;
    }[];
}>;
  /**
   * 签名 / Signature: SingleSignOnV1.begin.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 begin 的输入与结果契约，所属容器为 SingleSignOnV1。
   * Purpose: Declares the input/result contract for begin in SingleSignOnV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: raw: unknown; sourceToken: string | undefined optional
   * 输出 / Returns: Promise<{ redirect: string; state: string; expiresAt: number; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "begin": (raw: unknown, sourceToken?: string | undefined) => Promise<{
    redirect: string;
    state: string;
    expiresAt: number;
}>;
  /**
   * 签名 / Signature: SingleSignOnV1.completeOidc.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 completeOidc 的输入与结果契约，所属容器为 SingleSignOnV1。
   * Purpose: Declares the input/result contract for completeOidc in SingleSignOnV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: callback: URL
   * 输出 / Returns: Promise<{ origin: string; state: string; result: { token: string; principal: PrincipalV1; } | { linked: boolean; binding: { createdAt: string; issuer: string; subject: string;….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "completeOidc": (callback: URL) => Promise<{
    origin: string;
    state: string;
    result: {
        token: string;
        principal: PrincipalV1;
    } | {
        linked: boolean;
        binding: {
            createdAt: string;
            issuer: string;
            subject: string;
            id: `${string}-${string}-${string}-${string}-${string}`;
            provider: "oidc" | "saml";
            accountId: string;
        };
    };
}>;
  /**
   * 签名 / Signature: SingleSignOnV1.completeSaml.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 completeSaml 的输入与结果契约，所属容器为 SingleSignOnV1。
   * Purpose: Declares the input/result contract for completeSaml in SingleSignOnV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: { SAMLResponse: string; RelayState: string; }
   * 输出 / Returns: Promise<{ origin: string; state: string; result: { token: string; principal: PrincipalV1; } | { linked: boolean; binding: { createdAt: string; issuer: string; subject: string;….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "completeSaml": (input: {
    SAMLResponse: string;
    RelayState: string;
}) => Promise<{
    origin: string;
    state: string;
    result: {
        token: string;
        principal: PrincipalV1;
    } | {
        linked: boolean;
        binding: {
            createdAt: string;
            issuer: string;
            subject: string;
            id: `${string}-${string}-${string}-${string}-${string}`;
            provider: "oidc" | "saml";
            accountId: string;
        };
    };
}>;
  /**
   * 签名 / Signature: SingleSignOnV1.unlink.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 unlink 的输入与结果契约，所属容器为 SingleSignOnV1。
   * Purpose: Declares the input/result contract for unlink in SingleSignOnV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: accountId: string; providerId: "oidc" | "saml"
   * 输出 / Returns: Promise<{ removed: number; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "unlink": (accountId: string, providerId: "oidc" | "saml") => Promise<{
    removed: number;
}>;
}

export interface TerminalSharingV1 {
  /**
   * 签名 / Signature: TerminalSharingV1.list.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 list 的输入与结果契约，所属容器为 TerminalSharingV1。
   * Purpose: Declares the input/result contract for list in TerminalSharingV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: accountId: string | undefined optional; vmId: string | undefined optional; projectId: string | undefined optional
   * 输出 / Returns: { id: string; vmId: string; session: string; viewerId: string; createdAt: string; expiresAt: number; projectId?: string | undefined; terminalId?: string | undefined; }[].
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "list": (accountId?: string | undefined, vmId?: string | undefined, projectId?: string | undefined) => {
    id: string;
    vmId: string;
    session: string;
    viewerId: string;
    createdAt: string;
    expiresAt: number;
    projectId?: string | undefined;
    terminalId?: string | undefined;
}[];
  /**
   * 签名 / Signature: TerminalSharingV1.find.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 find 的输入与结果契约，所属容器为 TerminalSharingV1。
   * Purpose: Declares the input/result contract for find in TerminalSharingV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: viewerId: string; vmId: string; session: string; projectId: string | null | undefined optional
   * 输出 / Returns: { id: string; vmId: string; session: string; viewerId: string; createdAt: string; expiresAt: number; projectId?: string | undefined; terminalId?: string | undefined; } | null.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "find": (viewerId: string, vmId: string, session: string, projectId?: string | null | undefined) => {
    id: string;
    vmId: string;
    session: string;
    viewerId: string;
    createdAt: string;
    expiresAt: number;
    projectId?: string | undefined;
    terminalId?: string | undefined;
} | null;
  /**
   * 签名 / Signature: TerminalSharingV1.create.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 create 的输入与结果契约，所属容器为 TerminalSharingV1。
   * Purpose: Declares the input/result contract for create in TerminalSharingV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ id: string; vmId: string; session: string; viewerId: string; createdAt: string; expiresAt: number; projectId?: string | undefined; terminalId?: string | undefined; }….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "create": (input: unknown) => Promise<{
    id: string;
    vmId: string;
    session: string;
    viewerId: string;
    createdAt: string;
    expiresAt: number;
    projectId?: string | undefined;
    terminalId?: string | undefined;
}>;
  /**
   * 签名 / Signature: TerminalSharingV1.revoke.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 revoke 的输入与结果契约，所属容器为 TerminalSharingV1。
   * Purpose: Declares the input/result contract for revoke in TerminalSharingV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ revoked: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "revoke": (id: string) => Promise<{
    revoked: string;
}>;
  /**
   * 签名 / Signature: TerminalSharingV1.revokeViewer.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 revokeViewer 的输入与结果契约，所属容器为 TerminalSharingV1。
   * Purpose: Declares the input/result contract for revokeViewer in TerminalSharingV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: viewerId: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "revokeViewer": (viewerId: string) => Promise<void>;
}

export interface JitPrivilegesV1 {
  /**
   * 签名 / Signature: JitPrivilegesV1.list.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 list 的输入与结果契约，所属容器为 JitPrivilegesV1。
   * Purpose: Declares the input/result contract for list in JitPrivilegesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: principal: PrincipalV1
   * 输出 / Returns: { status: "failed" | "expired" | "pending" | "completed" | "revoked" | "approved" | "denied" | "claimed"; id: string; viewerId: string; vmId: string; operation: "start" | "sto….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "list": (principal: PrincipalV1) => {
    status: "failed" | "expired" | "pending" | "completed" | "revoked" | "approved" | "denied" | "claimed";
    id: string;
    viewerId: string;
    vmId: string;
    operation: "start" | "stop";
    reason: string;
    createdAt: number;
    requestExpiresAt: number;
    approvedBy?: string | undefined;
    approvedAt?: number | undefined;
    expiresAt?: number | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}[];
  /**
   * 签名 / Signature: JitPrivilegesV1.create.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 create 的输入与结果契约，所属容器为 JitPrivilegesV1。
   * Purpose: Declares the input/result contract for create in JitPrivilegesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: principal: PrincipalV1; input: unknown
   * 输出 / Returns: Promise<{ status: "failed" | "expired" | "pending" | "completed" | "revoked" | "approved" | "denied" | "claimed"; id: string; viewerId: string; vmId: string; operation: "start….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "create": (principal: PrincipalV1, input: unknown) => Promise<{
    status: "failed" | "expired" | "pending" | "completed" | "revoked" | "approved" | "denied" | "claimed";
    id: string;
    viewerId: string;
    vmId: string;
    operation: "start" | "stop";
    reason: string;
    createdAt: number;
    requestExpiresAt: number;
    approvedBy?: string | undefined;
    approvedAt?: number | undefined;
    expiresAt?: number | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}>;
  /**
   * 签名 / Signature: JitPrivilegesV1.decide.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 decide 的输入与结果契约，所属容器为 JitPrivilegesV1。
   * Purpose: Declares the input/result contract for decide in JitPrivilegesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: principal: PrincipalV1; id: string; input: unknown
   * 输出 / Returns: Promise<{ status: "failed" | "expired" | "pending" | "completed" | "revoked" | "approved" | "denied" | "claimed"; id: string; viewerId: string; vmId: string; operation: "start….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "decide": (principal: PrincipalV1, id: string, input: unknown) => Promise<{
    status: "failed" | "expired" | "pending" | "completed" | "revoked" | "approved" | "denied" | "claimed";
    id: string;
    viewerId: string;
    vmId: string;
    operation: "start" | "stop";
    reason: string;
    createdAt: number;
    requestExpiresAt: number;
    approvedBy?: string | undefined;
    approvedAt?: number | undefined;
    expiresAt?: number | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}>;
  /**
   * 签名 / Signature: JitPrivilegesV1.execute.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 execute 的输入与结果契约，所属容器为 JitPrivilegesV1。
   * Purpose: Declares the input/result contract for execute in JitPrivilegesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: principal: PrincipalV1; id: string
   * 输出 / Returns: Promise<{ status: "failed" | "expired" | "pending" | "completed" | "revoked" | "approved" | "denied" | "claimed"; id: string; viewerId: string; vmId: string; operation: "start….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "execute": (principal: PrincipalV1, id: string) => Promise<{
    status: "failed" | "expired" | "pending" | "completed" | "revoked" | "approved" | "denied" | "claimed";
    id: string;
    viewerId: string;
    vmId: string;
    operation: "start" | "stop";
    reason: string;
    createdAt: number;
    requestExpiresAt: number;
    approvedBy?: string | undefined;
    approvedAt?: number | undefined;
    expiresAt?: number | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}>;
}

export interface BrowserExtensionsV1 {
  /**
   * 签名 / Signature: BrowserExtensionsV1.list.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 list 的输入与结果契约，所属容器为 BrowserExtensionsV1。
   * Purpose: Declares the input/result contract for list in BrowserExtensionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: ownerId: string
   * 输出 / Returns: { connected: boolean; expired: boolean; permissions: string[]; id: string; origin: string; ownerId: string; createdAt: number; expiresAt: number; lastSeenAt?: number | undefin….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "list": (ownerId: string) => {
    connected: boolean;
    expired: boolean;
    permissions: string[];
    id: string;
    origin: string;
    ownerId: string;
    createdAt: number;
    expiresAt: number;
    lastSeenAt?: number | undefined;
}[];
  /**
   * 签名 / Signature: BrowserExtensionsV1.createPairing.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 createPairing 的输入与结果契约，所属容器为 BrowserExtensionsV1。
   * Purpose: Declares the input/result contract for createPairing in BrowserExtensionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: ownerId: string
   * 输出 / Returns: { code: string; expiresAt: number; permissions: string[]; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "createPairing": (ownerId: string) => {
    code: string;
    expiresAt: number;
    permissions: string[];
};
  /**
   * 签名 / Signature: BrowserExtensionsV1.connect.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 connect 的输入与结果契约，所属容器为 BrowserExtensionsV1。
   * Purpose: Declares the input/result contract for connect in BrowserExtensionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: originValue: unknown; input: unknown
   * 输出 / Returns: Promise<{ token: string; id: string; expiresAt: number; permissions: string[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "connect": (originValue: unknown, input: unknown) => Promise<{
    token: string;
    id: string;
    expiresAt: number;
    permissions: string[];
}>;
  /**
   * 签名 / Signature: BrowserExtensionsV1.authorize.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 authorize 的输入与结果契约，所属容器为 BrowserExtensionsV1。
   * Purpose: Declares the input/result contract for authorize in BrowserExtensionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: originValue: unknown; token: unknown
   * 输出 / Returns: { id: string; expiresAt: number; permissions: string[]; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "authorize": (originValue: unknown, token: unknown) => {
    id: string;
    expiresAt: number;
    permissions: string[];
};
  /**
   * 签名 / Signature: BrowserExtensionsV1.revoke.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 revoke 的输入与结果契约，所属容器为 BrowserExtensionsV1。
   * Purpose: Declares the input/result contract for revoke in BrowserExtensionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: ownerId: string; id: string
   * 输出 / Returns: Promise<{ revoked: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "revoke": (ownerId: string, id: string) => Promise<{
    revoked: string;
}>;
  /**
   * 签名 / Signature: BrowserExtensionsV1.revokeAll.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 revokeAll 的输入与结果契约，所属容器为 BrowserExtensionsV1。
   * Purpose: Declares the input/result contract for revokeAll in BrowserExtensionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "revokeAll": () => Promise<void>;
}

export interface RemoteAuditLockV1 {
  /**
   * 签名 / Signature: RemoteAuditLockV1.status.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 status 的输入与结果契约，所属容器为 RemoteAuditLockV1。
   * Purpose: Declares the input/result contract for status in RemoteAuditLockV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ hostId: string; target: { bucket: string; region: string; prefix: string; retentionDays: number; endpoint?: string | undefined; } | null; last: { key: string; versio….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "status": () => Promise<{
    hostId: string;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        retentionDays: number;
        endpoint?: string | undefined;
    } | null;
    last: {
        key: string;
        versionId: string;
        sequence: number;
        hash: string;
        retainUntil: string;
    } | undefined;
    local: {
        valid: boolean;
        sequence: number;
        hash: string;
        error?: undefined;
    } | {
        valid: boolean;
        error: string;
        sequence?: undefined;
        hash?: undefined;
    };
    protected: boolean;
    caughtUp: boolean;
    lastAttemptAt: string | undefined;
    lastVerifiedAt: string | undefined;
    lastError: string | undefined;
}>;
  /**
   * 签名 / Signature: RemoteAuditLockV1.configure.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configure 的输入与结果契约，所属容器为 RemoteAuditLockV1。
   * Purpose: Declares the input/result contract for configure in RemoteAuditLockV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ hostId: string; target: { bucket: string; region: string; prefix: string; retentionDays: number; endpoint?: string | undefined; } | null; last: { key: string; versio….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configure": (input: unknown, signal?: AbortSignal | undefined) => Promise<{
    hostId: string;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        retentionDays: number;
        endpoint?: string | undefined;
    } | null;
    last: {
        key: string;
        versionId: string;
        sequence: number;
        hash: string;
        retainUntil: string;
    } | undefined;
    local: {
        valid: boolean;
        sequence: number;
        hash: string;
        error?: undefined;
    } | {
        valid: boolean;
        error: string;
        sequence?: undefined;
        hash?: undefined;
    };
    protected: boolean;
    caughtUp: boolean;
    lastAttemptAt: string | undefined;
    lastVerifiedAt: string | undefined;
    lastError: string | undefined;
}>;
  /**
   * 签名 / Signature: RemoteAuditLockV1.disable.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 disable 的输入与结果契约，所属容器为 RemoteAuditLockV1。
   * Purpose: Declares the input/result contract for disable in RemoteAuditLockV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ hostId: string; target: { bucket: string; region: string; prefix: string; retentionDays: number; endpoint?: string | undefined; } | null; last: { key: string; versio….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "disable": () => Promise<{
    hostId: string;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        retentionDays: number;
        endpoint?: string | undefined;
    } | null;
    last: {
        key: string;
        versionId: string;
        sequence: number;
        hash: string;
        retainUntil: string;
    } | undefined;
    local: {
        valid: boolean;
        sequence: number;
        hash: string;
        error?: undefined;
    } | {
        valid: boolean;
        error: string;
        sequence?: undefined;
        hash?: undefined;
    };
    protected: boolean;
    caughtUp: boolean;
    lastAttemptAt: string | undefined;
    lastVerifiedAt: string | undefined;
    lastError: string | undefined;
}>;
  /**
   * 签名 / Signature: RemoteAuditLockV1.verify.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 verify 的输入与结果契约，所属容器为 RemoteAuditLockV1。
   * Purpose: Declares the input/result contract for verify in RemoteAuditLockV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ hostId: string; target: { bucket: string; region: string; prefix: string; retentionDays: number; endpoint?: string | undefined; } | null; last: { key: string; versio….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "verify": (signal?: AbortSignal | undefined) => Promise<{
    hostId: string;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        retentionDays: number;
        endpoint?: string | undefined;
    } | null;
    last: {
        key: string;
        versionId: string;
        sequence: number;
        hash: string;
        retainUntil: string;
    } | undefined;
    local: {
        valid: boolean;
        sequence: number;
        hash: string;
        error?: undefined;
    } | {
        valid: boolean;
        error: string;
        sequence?: undefined;
        hash?: undefined;
    };
    protected: boolean;
    caughtUp: boolean;
    lastAttemptAt: string | undefined;
    lastVerifiedAt: string | undefined;
    lastError: string | undefined;
}>;
  /**
   * 签名 / Signature: RemoteAuditLockV1.sync.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 sync 的输入与结果契约，所属容器为 RemoteAuditLockV1。
   * Purpose: Declares the input/result contract for sync in RemoteAuditLockV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ hostId: string; target: { bucket: string; region: string; prefix: string; retentionDays: number; endpoint?: string | undefined; } | null; last: { key: string; versio….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "sync": (signal?: AbortSignal | undefined) => Promise<{
    hostId: string;
    target: {
        bucket: string;
        region: string;
        prefix: string;
        retentionDays: number;
        endpoint?: string | undefined;
    } | null;
    last: {
        key: string;
        versionId: string;
        sequence: number;
        hash: string;
        retainUntil: string;
    } | undefined;
    local: {
        valid: boolean;
        sequence: number;
        hash: string;
        error?: undefined;
    } | {
        valid: boolean;
        error: string;
        sequence?: undefined;
        hash?: undefined;
    };
    protected: boolean;
    caughtUp: boolean;
    lastAttemptAt: string | undefined;
    lastVerifiedAt: string | undefined;
    lastError: string | undefined;
}>;
}

export interface FeatureRolloutsV1 {
  /**
   * 签名 / Signature: FeatureRolloutsV1.decision.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 decision 的输入与结果契约，所属容器为 FeatureRolloutsV1。
   * Purpose: Declares the input/result contract for decision in FeatureRolloutsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; draft: { pluginId: string; enabled: boolean; percentage: number; cohortVersion: string; } | … optional
   * 输出 / Returns: { policy?: { pluginId: string; enabled: boolean; percentage: number; cohortVersion: string; } | undefined; pluginId: string; allowed: boolean; bucket: number | null; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "decision": (id: string, draft?: {
    pluginId: string;
    enabled: boolean;
    percentage: number;
    cohortVersion: string;
} | undefined) => {
    policy?: {
        pluginId: string;
        enabled: boolean;
        percentage: number;
        cohortVersion: string;
    } | undefined;
    pluginId: string;
    allowed: boolean;
    bucket: number | null;
};
  /**
   * 签名 / Signature: FeatureRolloutsV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 FeatureRolloutsV1。
   * Purpose: Declares the input/result contract for view in FeatureRolloutsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { hostId: string; plugins: { policy?: { pluginId: string; enabled: boolean; percentage: number; cohortVersion: string; } | undefined; pluginId: string; allowed: boolean; bucke….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => {
    hostId: string;
    plugins: {
        policy?: {
            pluginId: string;
            enabled: boolean;
            percentage: number;
            cohortVersion: string;
        } | undefined;
        pluginId: string;
        allowed: boolean;
        bucket: number | null;
        id: string;
        name: string;
    }[];
    policies: {
        pluginId: string;
        enabled: boolean;
        percentage: number;
        cohortVersion: string;
        revision: number;
        updatedAt: number;
    }[];
};
  /**
   * 签名 / Signature: FeatureRolloutsV1.configure.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configure 的输入与结果契约，所属容器为 FeatureRolloutsV1。
   * Purpose: Declares the input/result contract for configure in FeatureRolloutsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ policy?: { pluginId: string; enabled: boolean; percentage: number; cohortVersion: string; } | undefined; pluginId: string; allowed: boolean; bucket: number | null; }….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configure": (input: unknown) => Promise<{
    policy?: {
        pluginId: string;
        enabled: boolean;
        percentage: number;
        cohortVersion: string;
    } | undefined;
    pluginId: string;
    allowed: boolean;
    bucket: number | null;
} | {
    hostId: string;
    plugins: {
        policy?: {
            pluginId: string;
            enabled: boolean;
            percentage: number;
            cohortVersion: string;
        } | undefined;
        pluginId: string;
        allowed: boolean;
        bucket: number | null;
        id: string;
        name: string;
    }[];
    policies: {
        pluginId: string;
        enabled: boolean;
        percentage: number;
        cohortVersion: string;
        revision: number;
        updatedAt: number;
    }[];
}>;
}

export interface ProjectExecutionV1 {
  /**
   * 签名 / Signature: ProjectExecutionV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 ProjectExecutionV1。
   * Purpose: Declares the input/result contract for run in ProjectExecutionV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; projectId: string | null | undefined optional; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ stdout: string; stderr: string; code: number; scope: "instance"; } | { scope: "project"; projectId: string; directory: string; networkIsolation: "host" | "private"; ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, input: unknown, projectId?: string | null | undefined, signal?: AbortSignal | undefined) => Promise<{
    stdout: string;
    stderr: string;
    code: number;
    scope: "instance";
} | {
    scope: "project";
    projectId: string;
    directory: string;
    networkIsolation: "host" | "private";
    stdout: string;
    stderr: string;
    code: number;
}>;
}

export interface UsbHotplugV1 {
  /**
   * 签名 / Signature: UsbHotplugV1.reconcile.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 reconcile 的输入与结果契约，所属容器为 UsbHotplugV1。
   * Purpose: Declares the input/result contract for reconcile in UsbHotplugV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "reconcile": () => Promise<void>;
  /**
   * 签名 / Signature: UsbHotplugV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 UsbHotplugV1。
   * Purpose: Declares the input/result contract for view in UsbHotplugV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string
   * 输出 / Returns: Promise<{ ready: boolean; hostDevices: string; hostError: string; rules: { id: string; vmId: string; vendorId: number; productId: number; createdAt: string; mediaKind?: "camer….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (vmId: string) => Promise<{
    ready: boolean;
    hostDevices: string;
    hostError: string;
    rules: {
        id: string;
        vmId: string;
        vendorId: number;
        productId: number;
        createdAt: string;
        mediaKind?: "camera" | "microphone" | "headset" | undefined;
    }[];
    configured: DeviceV1[];
    events: {
        id: string;
        vmId: string;
        operation: "attach" | "detach";
        deviceId: string;
        vendorId: number;
        productId: number;
        source: "rule" | "manual";
        status: "failed" | "configured" | "requested";
        at: string;
        error?: string | undefined;
    }[];
}>;
  /**
   * 签名 / Signature: UsbHotplugV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 UsbHotplugV1。
   * Purpose: Declares the input/result contract for action in UsbHotplugV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string; input: unknown
   * 输出 / Returns: Promise<{ ready: boolean; hostDevices: string; hostError: string; rules: { id: string; vmId: string; vendorId: number; productId: number; createdAt: string; mediaKind?: "camer….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (vmId: string, input: unknown) => Promise<{
    ready: boolean;
    hostDevices: string;
    hostError: string;
    rules: {
        id: string;
        vmId: string;
        vendorId: number;
        productId: number;
        createdAt: string;
        mediaKind?: "camera" | "microphone" | "headset" | undefined;
    }[];
    configured: DeviceV1[];
    events: {
        id: string;
        vmId: string;
        operation: "attach" | "detach";
        deviceId: string;
        vendorId: number;
        productId: number;
        source: "rule" | "manual";
        status: "failed" | "configured" | "requested";
        at: string;
        error?: string | undefined;
    }[];
}>;
}

export interface MediaDevicesV1 {
  /**
   * 签名 / Signature: MediaDevicesV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 MediaDevicesV1。
   * Purpose: Declares the input/result contract for view in MediaDevicesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ vmId: string; vmName: string; status: import("../../shared/contracts/vm.ts").VMStatus; audio: "none" | "hda-duplex"; audioBackend: "none" | "dsound"; support: Record….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => Promise<{
    vmId: string;
    vmName: string;
    status: import("../../shared/contracts/vm.ts").VMStatus;
    audio: "none" | "hda-duplex";
    audioBackend: "none" | "dsound";
    support: Record<"none" | "dsound", AudioBackendSupportV1>;
    guest: {
        audio: string;
        video: string;
        error?: string | undefined;
    } | null;
    usb: {
        ready: boolean;
        hostDevices: string;
        hostError: string;
        rules: {
            id: string;
            vmId: string;
            vendorId: number;
            productId: number;
            createdAt: string;
            mediaKind?: "camera" | "microphone" | "headset" | undefined;
        }[];
        configured: DeviceV1[];
        events: {
            id: string;
            vmId: string;
            operation: "attach" | "detach";
            deviceId: string;
            vendorId: number;
            productId: number;
            source: "rule" | "manual";
            status: "failed" | "configured" | "requested";
            at: string;
            error?: string | undefined;
        }[];
    };
}>;
  /**
   * 签名 / Signature: MediaDevicesV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 MediaDevicesV1。
   * Purpose: Declares the input/result contract for action in MediaDevicesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<{ vmId: string; vmName: string; status: import("../../shared/contracts/vm.ts").VMStatus; audio: "none" | "hda-duplex"; audioBackend: "none" | "dsound"; support: Record….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, input: unknown) => Promise<{
    vmId: string;
    vmName: string;
    status: import("../../shared/contracts/vm.ts").VMStatus;
    audio: "none" | "hda-duplex";
    audioBackend: "none" | "dsound";
    support: Record<"none" | "dsound", AudioBackendSupportV1>;
    guest: {
        audio: string;
        video: string;
        error?: string | undefined;
    } | null;
    usb: {
        ready: boolean;
        hostDevices: string;
        hostError: string;
        rules: {
            id: string;
            vmId: string;
            vendorId: number;
            productId: number;
            createdAt: string;
            mediaKind?: "camera" | "microphone" | "headset" | undefined;
        }[];
        configured: DeviceV1[];
        events: {
            id: string;
            vmId: string;
            operation: "attach" | "detach";
            deviceId: string;
            vendorId: number;
            productId: number;
            source: "rule" | "manual";
            status: "failed" | "configured" | "requested";
            at: string;
            error?: string | undefined;
        }[];
    };
} | {
    ready: boolean;
    reasons: string[];
    vmId: string;
    vmName: string;
    mode: "host" | "off" | "virtual";
    before: {
        cpu?: {
            sockets: number;
            cores: number;
            threads: number;
            numa?: {
                memoryMiB: number;
                cpus: number[];
            }[] | undefined;
        } | undefined;
        devices?: {
            graphics: "none" | "virtio-gpu" | "virgl";
            networkCard: "virtio-net-pci" | "e1000";
            randomDevice: boolean;
            balloon: boolean;
            diskCache: "none" | "writeback" | "writethrough";
            discard: boolean;
            graphicsOutputs?: number | undefined;
            graphicsWidth?: number | undefined;
            graphicsHeight?: number | undefined;
            graphicsMemoryMiB?: number | undefined;
            audio?: "none" | "hda-duplex" | undefined;
            audioBackend?: "none" | "dsound" | undefined;
        } | undefined;
        memory?: {
            maxMiB: number;
            slots: number;
        } | undefined;
        ipv6?: boolean | undefined;
    };
    after: {
        cpu?: {
            sockets: number;
            cores: number;
            threads: number;
            numa?: {
                memoryMiB: number;
                cpus: number[];
            }[] | undefined;
        } | undefined;
        devices?: {
            graphics: "none" | "virtio-gpu" | "virgl";
            networkCard: "virtio-net-pci" | "e1000";
            randomDevice: boolean;
            balloon: boolean;
            diskCache: "none" | "writeback" | "writethrough";
            discard: boolean;
            graphicsOutputs?: number | undefined;
            graphicsWidth?: number | undefined;
            graphicsHeight?: number | undefined;
            graphicsMemoryMiB?: number | undefined;
            audio?: "none" | "hda-duplex" | undefined;
            audioBackend?: "none" | "dsound" | undefined;
        } | undefined;
        memory?: {
            maxMiB: number;
            slots: number;
        } | undefined;
        ipv6?: boolean | undefined;
    };
    previewToken: string;
    memoryMiB: number;
    architecture: "x86_64" | "aarch64" | undefined;
    qemuAudioArguments: string[];
}>;
}

export interface MemoryReclaimV1 {
  /**
   * 签名 / Signature: MemoryReclaimV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 MemoryReclaimV1。
   * Purpose: Declares the input/result contract for view in MemoryReclaimV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ policy: { enabled: boolean; minMiB: number; }; effectiveMinMiB: number; currentTargetMiB: number; observation: ObservationV1 | null; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => Promise<{
    policy: {
        enabled: boolean;
        minMiB: number;
    };
    effectiveMinMiB: number;
    currentTargetMiB: number;
    observation: ObservationV1 | null;
}>;
  /**
   * 签名 / Signature: MemoryReclaimV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 MemoryReclaimV1。
   * Purpose: Declares the input/result contract for action in MemoryReclaimV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: Promise<{ policy: { enabled: boolean; minMiB: number; }; effectiveMinMiB: number; currentTargetMiB: number; observation: ObservationV1 | null; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, raw: unknown) => Promise<{
    policy: {
        enabled: boolean;
        minMiB: number;
    };
    effectiveMinMiB: number;
    currentTargetMiB: number;
    observation: ObservationV1 | null;
}>;
  /**
   * 签名 / Signature: MemoryReclaimV1.sample.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 sample 的输入与结果契约，所属容器为 MemoryReclaimV1。
   * Purpose: Declares the input/result contract for sample in MemoryReclaimV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "sample": (id: string) => Promise<void>;
}

export interface HostMountsV1 {
  /**
   * 签名 / Signature: HostMountsV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 HostMountsV1。
   * Purpose: Declares the input/result contract for view in HostMountsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ policy: { enabled: boolean; hostPath: string; readOnly: boolean; }; guestPath: string; running: boolean; mounted: boolean; observation: HostMountObservationV1 | null….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => Promise<{
    policy: {
        enabled: boolean;
        hostPath: string;
        readOnly: boolean;
    };
    guestPath: string;
    running: boolean;
    mounted: boolean;
    observation: HostMountObservationV1 | null;
}>;
  /**
   * 签名 / Signature: HostMountsV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 HostMountsV1。
   * Purpose: Declares the input/result contract for action in HostMountsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: Promise<{ policy: { enabled: boolean; hostPath: string; readOnly: boolean; }; guestPath: string; running: boolean; mounted: boolean; observation: HostMountObservationV1 | null….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, raw: unknown) => Promise<{
    policy: {
        enabled: boolean;
        hostPath: string;
        readOnly: boolean;
    };
    guestPath: string;
    running: boolean;
    mounted: boolean;
    observation: HostMountObservationV1 | null;
}>;
}

export interface VirtioFsSharesV1 {
  /**
   * 签名 / Signature: VirtioFsSharesV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 VirtioFsSharesV1。
   * Purpose: Declares the input/result contract for view in VirtioFsSharesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ policy: { enabled: boolean; hostPath: string; readOnly: boolean; }; guestPath: string; tag: string; stopped: boolean; running: boolean; attached: boolean; mounted: b….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => Promise<{
    policy: {
        enabled: boolean;
        hostPath: string;
        readOnly: boolean;
    };
    guestPath: string;
    tag: string;
    stopped: boolean;
    running: boolean;
    attached: boolean;
    mounted: boolean;
    observation: VirtioFsObservationV1 | null;
}>;
  /**
   * 签名 / Signature: VirtioFsSharesV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 VirtioFsSharesV1。
   * Purpose: Declares the input/result contract for action in VirtioFsSharesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: Promise<{ policy: { enabled: boolean; hostPath: string; readOnly: boolean; }; guestPath: string; tag: string; stopped: boolean; running: boolean; attached: boolean; mounted: b….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, raw: unknown) => Promise<{
    policy: {
        enabled: boolean;
        hostPath: string;
        readOnly: boolean;
    };
    guestPath: string;
    tag: string;
    stopped: boolean;
    running: boolean;
    attached: boolean;
    mounted: boolean;
    observation: VirtioFsObservationV1 | null;
}>;
}

export interface TrustedBootServiceV1 {
  /**
   * 签名 / Signature: TrustedBootServiceV1.capture.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 capture 的输入与结果契约，所属容器为 TrustedBootServiceV1。
   * Purpose: Declares the input/result contract for capture in TrustedBootServiceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; snapshotId: string | undefined optional
   * 输出 / Returns: Promise<TrustedBootFilesV1 | undefined>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "capture": (id: string, snapshotId?: string | undefined) => Promise<TrustedBootFilesV1 | undefined>;
  /**
   * 签名 / Signature: TrustedBootServiceV1.restore.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 restore 的输入与结果契约，所属容器为 TrustedBootServiceV1。
   * Purpose: Declares the input/result contract for restore in TrustedBootServiceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; snapshot: TrustedBootFilesV1
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "restore": (id: string, snapshot: TrustedBootFilesV1) => Promise<void>;
  /**
   * 签名 / Signature: TrustedBootServiceV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 TrustedBootServiceV1。
   * Purpose: Declares the input/result contract for view in TrustedBootServiceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ policy: { enabled: boolean; }; stopped: boolean; attached: boolean; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => Promise<{
    policy: {
        enabled: boolean;
    };
    stopped: boolean;
    attached: boolean;
}>;
  /**
   * 签名 / Signature: TrustedBootServiceV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 TrustedBootServiceV1。
   * Purpose: Declares the input/result contract for action in TrustedBootServiceV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: Promise<{ policy: { enabled: boolean; }; stopped: boolean; attached: boolean; } | { policy: { enabled: boolean; }; ready: boolean; executed: boolean; firmware: "bios" | "uefi"….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, raw: unknown) => Promise<{
    policy: {
        enabled: boolean;
    };
    stopped: boolean;
    attached: boolean;
} | {
    policy: {
        enabled: boolean;
    };
    ready: boolean;
    executed: boolean;
    firmware: "bios" | "uefi";
    host: {
        secureFirmware: boolean;
        varsTemplate: boolean;
        smm: boolean;
        tpmBackend: boolean;
        swtpm: boolean;
        rebootAction: boolean;
    };
    guest: {
        efi: boolean;
        secureBootEnabled: boolean | null;
        setupMode: boolean | null;
        tpmDevicePresent: boolean;
    } | null;
    observed: boolean;
    reason: string | null;
}>;
}

export interface GpuProfilesV1 {
  /**
   * 签名 / Signature: GpuProfilesV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 GpuProfilesV1。
   * Purpose: Declares the input/result contract for view in GpuProfilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ profiles: { name: string; graphics: "virtio-gpu" | "virgl"; outputs: number; width: number; height: number; hostMemoryMiB: number; minVmMemoryMiB: number; id: string….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => Promise<{
    profiles: {
        name: string;
        graphics: "virtio-gpu" | "virgl";
        outputs: number;
        width: number;
        height: number;
        hostMemoryMiB: number;
        minVmMemoryMiB: number;
        id: string;
        revision: number;
        createdAt: string;
        updatedAt: string;
    }[];
    support: Record<"virtio-gpu" | "virgl", GpuBackendSupportV1>;
    assignments: {
        vmName: string | null;
        drifted: boolean;
        vmId: string;
        profileId: string;
        profileName: string;
        profileRevision: number;
        hardwareHash: string;
        appliedAt: string;
    }[];
}>;
  /**
   * 签名 / Signature: GpuProfilesV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 GpuProfilesV1。
   * Purpose: Declares the input/result contract for action in GpuProfilesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ name: string; graphics: "virtio-gpu" | "virgl"; outputs: number; width: number; height: number; hostMemoryMiB: number; minVmMemoryMiB: number; id: string; revision: ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (input: unknown) => Promise<{
    name: string;
    graphics: "virtio-gpu" | "virgl";
    outputs: number;
    width: number;
    height: number;
    hostMemoryMiB: number;
    minVmMemoryMiB: number;
    id: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
} | {
    ready: boolean;
    reasons: string[];
    vmId: string;
    vmName: string;
    profileId: string;
    profileRevision: number;
    previewToken: string;
    before: {
        cpu?: {
            sockets: number;
            cores: number;
            threads: number;
            numa?: {
                memoryMiB: number;
                cpus: number[];
            }[] | undefined;
        } | undefined;
        devices?: {
            graphics: "none" | "virtio-gpu" | "virgl";
            networkCard: "virtio-net-pci" | "e1000";
            randomDevice: boolean;
            balloon: boolean;
            diskCache: "none" | "writeback" | "writethrough";
            discard: boolean;
            graphicsOutputs?: number | undefined;
            graphicsWidth?: number | undefined;
            graphicsHeight?: number | undefined;
            graphicsMemoryMiB?: number | undefined;
            audio?: "none" | "hda-duplex" | undefined;
            audioBackend?: "none" | "dsound" | undefined;
        } | undefined;
        memory?: {
            maxMiB: number;
            slots: number;
        } | undefined;
        ipv6?: boolean | undefined;
    };
    memoryMiB: number;
    architecture: "x86_64" | "aarch64" | undefined;
    after: {
        cpu?: {
            sockets: number;
            cores: number;
            threads: number;
            numa?: {
                memoryMiB: number;
                cpus: number[];
            }[] | undefined;
        } | undefined;
        devices?: {
            graphics: "none" | "virtio-gpu" | "virgl";
            networkCard: "virtio-net-pci" | "e1000";
            randomDevice: boolean;
            balloon: boolean;
            diskCache: "none" | "writeback" | "writethrough";
            discard: boolean;
            graphicsOutputs?: number | undefined;
            graphicsWidth?: number | undefined;
            graphicsHeight?: number | undefined;
            graphicsMemoryMiB?: number | undefined;
            audio?: "none" | "hda-duplex" | undefined;
            audioBackend?: "none" | "dsound" | undefined;
        } | undefined;
        memory?: {
            maxMiB: number;
            slots: number;
        } | undefined;
        ipv6?: boolean | undefined;
    };
    qemuDeviceArguments: string[];
} | {
    removed: string;
} | {
    hardware: {
        cpu?: {
            sockets: number;
            cores: number;
            threads: number;
            numa?: {
                memoryMiB: number;
                cpus: number[];
            }[] | undefined;
        } | undefined;
        devices?: {
            graphics: "none" | "virtio-gpu" | "virgl";
            networkCard: "virtio-net-pci" | "e1000";
            randomDevice: boolean;
            balloon: boolean;
            diskCache: "none" | "writeback" | "writethrough";
            discard: boolean;
            graphicsOutputs?: number | undefined;
            graphicsWidth?: number | undefined;
            graphicsHeight?: number | undefined;
            graphicsMemoryMiB?: number | undefined;
            audio?: "none" | "hda-duplex" | undefined;
            audioBackend?: "none" | "dsound" | undefined;
        } | undefined;
        memory?: {
            maxMiB: number;
            slots: number;
        } | undefined;
        ipv6?: boolean | undefined;
    };
    vmId: string;
    profileId: string;
    profileName: string;
    profileRevision: number;
    hardwareHash: string;
    appliedAt: string;
    removed?: undefined;
}>;
}

export interface BuildFarmV1 {
  readonly "jobs": JobsV1;
  /**
   * 签名 / Signature: BuildFarmV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 BuildFarmV1。
   * Purpose: Declares the input/result contract for view in BuildFarmV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { nodes: { vmName: string | null; status: string; busy: number; vmId: string; slots: number; labels: string[]; enabled: boolean; projectId?: string | undefined; }[]; tasks: { ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => {
    nodes: {
        vmName: string | null;
        status: string;
        busy: number;
        vmId: string;
        slots: number;
        labels: string[];
        enabled: boolean;
        projectId?: string | undefined;
    }[];
    tasks: {
        job: import("../../shared/contracts/jobs.ts").JobView | null;
        name: string;
        command: string;
        labels: string[];
        timeoutSeconds: number;
        id: string;
        status: "error" | "cancelled" | "interrupted" | "running" | "done" | "queued";
        createdAt: string;
        cwd?: string | undefined;
        retryOf?: string | undefined;
        vmId?: string | undefined;
        jobId?: string | undefined;
        startedAt?: string | undefined;
        finishedAt?: string | undefined;
        error?: string | undefined;
        errorCode?: string | undefined;
        projectId?: string | undefined;
        directory?: string | undefined;
        projectDirectory?: string | undefined;
        configVersion?: string | undefined;
        networkIsolation?: "host" | "private" | undefined;
    }[];
    persistenceError: string | undefined;
};
  /**
   * 签名 / Signature: BuildFarmV1.projects.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 projects 的输入与结果契约，所属容器为 BuildFarmV1。
   * Purpose: Declares the input/result contract for projects in BuildFarmV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string
   * 输出 / Returns: Promise<{ active: string; projects: { id: string; name: string; }[]; vmId: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "projects": (vmId: string) => Promise<{
    active: string;
    projects: {
        id: string;
        name: string;
    }[];
    vmId: string;
}>;
  /**
   * 签名 / Signature: BuildFarmV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 BuildFarmV1。
   * Purpose: Declares the input/result contract for action in BuildFarmV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ name: string; command: string; labels: string[]; timeoutSeconds: number; id: string; status: "error" | "cancelled" | "interrupted" | "running" | "done" | "queued"; c….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (input: unknown) => Promise<{
    name: string;
    command: string;
    labels: string[];
    timeoutSeconds: number;
    id: string;
    status: "error" | "cancelled" | "interrupted" | "running" | "done" | "queued";
    createdAt: string;
    cwd?: string | undefined;
    retryOf?: string | undefined;
    vmId?: string | undefined;
    jobId?: string | undefined;
    startedAt?: string | undefined;
    finishedAt?: string | undefined;
    error?: string | undefined;
    errorCode?: string | undefined;
    projectId?: string | undefined;
    directory?: string | undefined;
    projectDirectory?: string | undefined;
    configVersion?: string | undefined;
    networkIsolation?: "host" | "private" | undefined;
} | {
    projectId: string;
    vmId: string;
    slots: number;
    labels: string[];
    enabled: boolean;
} | {
    removed: string;
}>;
}

export interface ProjectPermissionsV1 {
  /**
   * 签名 / Signature: ProjectPermissionsV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 ProjectPermissionsV1。
   * Purpose: Declares the input/result contract for view in ProjectPermissionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string; projectId: string
   * 输出 / Returns: Promise<{ version: string; roles: { id: string; name: string; permissions: ("write" | "read" | "execute" | "approve")[]; }[]; grants: { accountId: string; roleId: string; }[];….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (vmId: string, projectId: string) => Promise<{
    version: string;
    roles: {
        id: string;
        name: string;
        permissions: ("write" | "read" | "execute" | "approve")[];
    }[];
    grants: {
        accountId: string;
        roleId: string;
    }[];
    approvalRequired: boolean;
    vmId: string;
    projectId: string;
}>;
  /**
   * 签名 / Signature: ProjectPermissionsV1.version.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 version 的输入与结果契约，所属容器为 ProjectPermissionsV1。
   * Purpose: Declares the input/result contract for version in ProjectPermissionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string; projectId: string
   * 输出 / Returns: string.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "version": (vmId: string, projectId: string) => string;
  /**
   * 签名 / Signature: ProjectPermissionsV1.configure.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configure 的输入与结果契约，所属容器为 ProjectPermissionsV1。
   * Purpose: Declares the input/result contract for configure in ProjectPermissionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string; projectId: string; input: unknown; expectedVersion: string | undefined optional
   * 输出 / Returns: Promise<{ version: string; vmId: string; projectId: string; roles: { id: string; name: string; permissions: ("write" | "read" | "execute" | "approve")[]; }[]; grants: { accoun….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configure": (vmId: string, projectId: string, input: unknown, expectedVersion?: string | undefined) => Promise<{
    version: string;
    vmId: string;
    projectId: string;
    roles: {
        id: string;
        name: string;
        permissions: ("write" | "read" | "execute" | "approve")[];
    }[];
    grants: {
        accountId: string;
        roleId: string;
    }[];
    approvalRequired: boolean;
    revision: number;
}>;
  /**
   * 签名 / Signature: ProjectPermissionsV1.accessible.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 accessible 的输入与结果契约，所属容器为 ProjectPermissionsV1。
   * Purpose: Declares the input/result contract for accessible in ProjectPermissionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: principal: PrincipalV1
   * 输出 / Returns: Promise<{ vmId: string; vmName: string; projectId: string; projectName: string; roleId: string; permissions: ("write" | "read" | "execute" | "approve")[]; approvalRequired: bo….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "accessible": (principal: PrincipalV1) => Promise<{
    vmId: string;
    vmName: string;
    projectId: string;
    projectName: string;
    roleId: string;
    permissions: ("write" | "read" | "execute" | "approve")[];
    approvalRequired: boolean;
}[]>;
  /**
   * 签名 / Signature: ProjectPermissionsV1.require.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 require 的输入与结果契约，所属容器为 ProjectPermissionsV1。
   * Purpose: Declares the input/result contract for require in ProjectPermissionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: principal: PrincipalV1; vmId: string; projectId: string; required: "write" | "read" | "execute" | "approve"
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "require": (principal: PrincipalV1, vmId: string, projectId: string, required: "write" | "read" | "execute" | "approve") => Promise<void>;
  /**
   * 签名 / Signature: ProjectPermissionsV1.requireCommitted.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 requireCommitted 的输入与结果契约，所属容器为 ProjectPermissionsV1。
   * Purpose: Declares the input/result contract for requireCommitted in ProjectPermissionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: principal: PrincipalV1; vmId: string; projectId: string; required: "write" | "read" | "execute" | "approve"
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "requireCommitted": (principal: PrincipalV1, vmId: string, projectId: string, required: "write" | "read" | "execute" | "approve") => Promise<void>;
  /**
   * 签名 / Signature: ProjectPermissionsV1.requiresApproval.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 requiresApproval 的输入与结果契约，所属容器为 ProjectPermissionsV1。
   * Purpose: Declares the input/result contract for requiresApproval in ProjectPermissionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string; projectId: string
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "requiresApproval": (vmId: string, projectId: string) => boolean;
  /**
   * 签名 / Signature: ProjectPermissionsV1.liveApprover.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 liveApprover 的输入与结果契约，所属容器为 ProjectPermissionsV1。
   * Purpose: Declares the input/result contract for liveApprover in ProjectPermissionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: accountId: string; vmId: string; projectId: string
   * 输出 / Returns: Promise<boolean>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "liveApprover": (accountId: string, vmId: string, projectId: string) => Promise<boolean>;
  /**
   * 签名 / Signature: ProjectPermissionsV1.revokeMember.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 revokeMember 的输入与结果契约，所属容器为 ProjectPermissionsV1。
   * Purpose: Declares the input/result contract for revokeMember in ProjectPermissionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: accountId: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "revokeMember": (accountId: string) => Promise<void>;
  /**
   * 签名 / Signature: ProjectPermissionsV1.revokeVm.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 revokeVm 的输入与结果契约，所属容器为 ProjectPermissionsV1。
   * Purpose: Declares the input/result contract for revokeVm in ProjectPermissionsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "revokeVm": (vmId: string) => Promise<void>;
}

export interface PolicyBundlesV1 {
  /**
   * 签名 / Signature: PolicyBundlesV1.keys.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 keys 的输入与结果契约，所属容器为 PolicyBundlesV1。
   * Purpose: Declares the input/result contract for keys in PolicyBundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { revision: number; localKey: { name: string; fingerprint: string; publicKey: string; }; trustedKeys: { name: string; fingerprint: string; publicKey: string; }[]; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "keys": () => {
    revision: number;
    localKey: {
        name: string;
        fingerprint: string;
        publicKey: string;
    };
    trustedKeys: {
        name: string;
        fingerprint: string;
        publicKey: string;
    }[];
};
  /**
   * 签名 / Signature: PolicyBundlesV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 PolicyBundlesV1。
   * Purpose: Declares the input/result contract for action in PolicyBundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ revision: number; localKey: { name: string; fingerprint: string; publicKey: string; }; trustedKeys: { name: string; fingerprint: string; publicKey: string; }[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (input: unknown) => Promise<{
    revision: number;
    localKey: {
        name: string;
        fingerprint: string;
        publicKey: string;
    };
    trustedKeys: {
        name: string;
        fingerprint: string;
        publicKey: string;
    }[];
}>;
  /**
   * 签名 / Signature: PolicyBundlesV1.export.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 export 的输入与结果契约，所属容器为 PolicyBundlesV1。
   * Purpose: Declares the input/result contract for export in PolicyBundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string; projectId: string
   * 输出 / Returns: Promise<{ format: "sakura-project-policy/v1"; source: { vmId: string; projectId: string; }; policy: { roles: { id: string; name: string; permissions: ("write" | "read" | "exec….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "export": (vmId: string, projectId: string) => Promise<{
    format: "sakura-project-policy/v1";
    source: {
        vmId: string;
        projectId: string;
    };
    policy: {
        roles: {
            id: string;
            name: string;
            permissions: ("write" | "read" | "execute" | "approve")[];
        }[];
        grants: {
            accountId: string;
            roleId: string;
        }[];
        approvalRequired: boolean;
    };
    signature: {
        algorithm: "Ed25519";
        publicKey: string;
        value: string;
    };
}>;
  /**
   * 签名 / Signature: PolicyBundlesV1.preview.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 preview 的输入与结果契约，所属容器为 PolicyBundlesV1。
   * Purpose: Declares the input/result contract for preview in PolicyBundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown; target: unknown
   * 输出 / Returns: Promise<{ source: { vmId: string; projectId: string; }; target: { vmId: string; projectId: string; }; signer: string; trusted: boolean; expectedVersion: string; current: { rol….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "preview": (input: unknown, target: unknown) => Promise<{
    source: {
        vmId: string;
        projectId: string;
    };
    target: {
        vmId: string;
        projectId: string;
    };
    signer: string;
    trusted: boolean;
    expectedVersion: string;
    current: {
        roles: {
            id: string;
            name: string;
            permissions: ("write" | "read" | "execute" | "approve")[];
        }[];
        grants: {
            accountId: string;
            roleId: string;
        }[];
        approvalRequired: boolean;
    };
    proposed: {
        roles: {
            id: string;
            name: string;
            permissions: ("write" | "read" | "execute" | "approve")[];
        }[];
        grants: {
            accountId: string;
            roleId: string;
        }[];
        approvalRequired: boolean;
    };
}>;
  /**
   * 签名 / Signature: PolicyBundlesV1.apply.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 apply 的输入与结果契约，所属容器为 PolicyBundlesV1。
   * Purpose: Declares the input/result contract for apply in PolicyBundlesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ signer: string; source: { vmId: string; projectId: string; }; policy: { version: string; vmId: string; projectId: string; roles: { id: string; name: string; permissi….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "apply": (input: unknown) => Promise<{
    signer: string;
    source: {
        vmId: string;
        projectId: string;
    };
    policy: {
        version: string;
        vmId: string;
        projectId: string;
        roles: {
            id: string;
            name: string;
            permissions: ("write" | "read" | "execute" | "approve")[];
        }[];
        grants: {
            accountId: string;
            roleId: string;
        }[];
        approvalRequired: boolean;
        revision: number;
    };
}>;
}

export interface ChangeApprovalsV1 {
  /**
   * 签名 / Signature: ChangeApprovalsV1.list.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 list 的输入与结果契约，所属容器为 ChangeApprovalsV1。
   * Purpose: Declares the input/result contract for list in ChangeApprovalsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: principal: PrincipalV1
   * 输出 / Returns: Promise<{ status: "failed" | "expired" | "pending" | "applied" | "approved" | "denied" | "claimed"; id: string; vmId: string; projectId: string; requesterId: string; summary: ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "list": (principal: PrincipalV1) => Promise<{
    status: "failed" | "expired" | "pending" | "applied" | "approved" | "denied" | "claimed";
    id: string;
    vmId: string;
    projectId: string;
    requesterId: string;
    summary: string;
    project: {
        directory: string;
        template: "none" | "node" | "python" | "rust";
        repository: string;
        setup: string;
        command: string;
        previewPort?: number | undefined;
        networkIsolation?: "host" | "private" | undefined;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        runtimes?: {
            python?: string | undefined;
            node?: string | undefined;
        } | undefined;
        services?: {
            name: string;
            command: string;
            dependsOn: string[];
            ready: string;
            timeout: number;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            health?: {
                command: string;
                interval: number;
                timeout: number;
                failures: number;
                restart: boolean;
                maxRestarts: number;
                backoff: number;
            } | undefined;
        }[] | undefined;
    };
    expectedVersion: string;
    createdAt: number;
    expiresAt: number;
    approvedBy?: string | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}[]>;
  /**
   * 签名 / Signature: ChangeApprovalsV1.create.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 create 的输入与结果契约，所属容器为 ChangeApprovalsV1。
   * Purpose: Declares the input/result contract for create in ChangeApprovalsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: principal: PrincipalV1; input: unknown
   * 输出 / Returns: Promise<{ status: "failed" | "expired" | "pending" | "applied" | "approved" | "denied" | "claimed"; id: string; vmId: string; projectId: string; requesterId: string; summary: ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "create": (principal: PrincipalV1, input: unknown) => Promise<{
    status: "failed" | "expired" | "pending" | "applied" | "approved" | "denied" | "claimed";
    id: string;
    vmId: string;
    projectId: string;
    requesterId: string;
    summary: string;
    project: {
        directory: string;
        template: "none" | "node" | "python" | "rust";
        repository: string;
        setup: string;
        command: string;
        previewPort?: number | undefined;
        networkIsolation?: "host" | "private" | undefined;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        runtimes?: {
            python?: string | undefined;
            node?: string | undefined;
        } | undefined;
        services?: {
            name: string;
            command: string;
            dependsOn: string[];
            ready: string;
            timeout: number;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            health?: {
                command: string;
                interval: number;
                timeout: number;
                failures: number;
                restart: boolean;
                maxRestarts: number;
                backoff: number;
            } | undefined;
        }[] | undefined;
    };
    expectedVersion: string;
    createdAt: number;
    expiresAt: number;
    approvedBy?: string | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}>;
  /**
   * 签名 / Signature: ChangeApprovalsV1.decide.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 decide 的输入与结果契约，所属容器为 ChangeApprovalsV1。
   * Purpose: Declares the input/result contract for decide in ChangeApprovalsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: principal: PrincipalV1; id: string; input: unknown
   * 输出 / Returns: Promise<{ status: "failed" | "expired" | "pending" | "applied" | "approved" | "denied" | "claimed"; id: string; vmId: string; projectId: string; requesterId: string; summary: ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "decide": (principal: PrincipalV1, id: string, input: unknown) => Promise<{
    status: "failed" | "expired" | "pending" | "applied" | "approved" | "denied" | "claimed";
    id: string;
    vmId: string;
    projectId: string;
    requesterId: string;
    summary: string;
    project: {
        directory: string;
        template: "none" | "node" | "python" | "rust";
        repository: string;
        setup: string;
        command: string;
        previewPort?: number | undefined;
        networkIsolation?: "host" | "private" | undefined;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        runtimes?: {
            python?: string | undefined;
            node?: string | undefined;
        } | undefined;
        services?: {
            name: string;
            command: string;
            dependsOn: string[];
            ready: string;
            timeout: number;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            health?: {
                command: string;
                interval: number;
                timeout: number;
                failures: number;
                restart: boolean;
                maxRestarts: number;
                backoff: number;
            } | undefined;
        }[] | undefined;
    };
    expectedVersion: string;
    createdAt: number;
    expiresAt: number;
    approvedBy?: string | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}>;
  /**
   * 签名 / Signature: ChangeApprovalsV1.apply.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 apply 的输入与结果契约，所属容器为 ChangeApprovalsV1。
   * Purpose: Declares the input/result contract for apply in ChangeApprovalsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: principal: PrincipalV1; id: string
   * 输出 / Returns: Promise<{ status: "failed" | "expired" | "pending" | "applied" | "approved" | "denied" | "claimed"; id: string; vmId: string; projectId: string; requesterId: string; summary: ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "apply": (principal: PrincipalV1, id: string) => Promise<{
    status: "failed" | "expired" | "pending" | "applied" | "approved" | "denied" | "claimed";
    id: string;
    vmId: string;
    projectId: string;
    requesterId: string;
    summary: string;
    project: {
        directory: string;
        template: "none" | "node" | "python" | "rust";
        repository: string;
        setup: string;
        command: string;
        previewPort?: number | undefined;
        networkIsolation?: "host" | "private" | undefined;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        runtimes?: {
            python?: string | undefined;
            node?: string | undefined;
        } | undefined;
        services?: {
            name: string;
            command: string;
            dependsOn: string[];
            ready: string;
            timeout: number;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            health?: {
                command: string;
                interval: number;
                timeout: number;
                failures: number;
                restart: boolean;
                maxRestarts: number;
                backoff: number;
            } | undefined;
        }[] | undefined;
    };
    expectedVersion: string;
    createdAt: number;
    expiresAt: number;
    approvedBy?: string | undefined;
    decidedAt?: number | undefined;
    claimedAt?: number | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
}>;
}

export interface ProcessInteropV1 {
  /**
   * 签名 / Signature: ProcessInteropV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 ProcessInteropV1。
   * Purpose: Declares the input/result contract for action in ProcessInteropV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; options: unknown; phase: "check" | "run"; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ message: string; reason?: string | undefined; ready: boolean; executed: boolean; enabled: boolean; installed: boolean; programs: { programId: string; executable: str….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, options: unknown, phase: "check" | "run", signal?: AbortSignal | undefined) => Promise<{
    message: string;
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    programs: {
        programId: string;
        executable: string;
        fixedArgs: string[];
        sha256: string;
    }[];
    programId?: undefined;
    sha256?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256: string;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    programId: string;
    sha256?: undefined;
    enabled?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    programId?: undefined;
    sha256?: undefined;
    installed?: undefined;
    reason?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    installed: boolean;
    reason: string | undefined;
    programId?: undefined;
    sha256?: undefined;
    enabled?: undefined;
    command?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    enabled: boolean;
    installed: boolean;
    command: string;
    programId?: undefined;
    sha256?: undefined;
    reason?: undefined;
}>;
  /**
   * 签名 / Signature: ProcessInteropV1.guest.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 guest 的输入与结果契约，所属容器为 ProcessInteropV1。
   * Purpose: Declares the input/result contract for guest in ProcessInteropV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: request: unknown; token: string | undefined; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ exitCode: number; stdout: string; stderr: string; programId: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "guest": (request: unknown, token: string | undefined, signal?: AbortSignal | undefined) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    programId: string;
}>;
}

export interface HostPeersV1 {
  /**
   * 签名 / Signature: HostPeersV1.registerMigrationSession.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 registerMigrationSession 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for registerMigrationSession in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: requesterId: string; ports: Record<MigrationChannelV1, number> & { sessionId?: string | undefined; qmp?: number |…
   * 输出 / Returns: `${string}-${string}-${string}-${string}-${string}`.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "registerMigrationSession": (requesterId: string, ports: Record<MigrationChannelV1, number> & {
    sessionId?: string | undefined;
    qmp?: number | undefined;
    targetDiskNode?: string | undefined;
    targetVmId?: string | undefined;
    transferId?: string | undefined;
}) => `${string}-${string}-${string}-${string}-${string}`;
  /**
   * 签名 / Signature: HostPeersV1.matchesMigrationSession.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 matchesMigrationSession 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for matchesMigrationSession in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; requesterId: string; targetVmId: string; transferId: string
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "matchesMigrationSession": (id: string, requesterId: string, targetVmId: string, transferId: string) => boolean;
  /**
   * 签名 / Signature: HostPeersV1.closeMigrationSession.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 closeMigrationSession 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for closeMigrationSession in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "closeMigrationSession": (id: string) => void;
  /**
   * 签名 / Signature: HostPeersV1.openMigrationForward.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 openMigrationForward 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for openMigrationForward in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string; sessionId: string; channel: MigrationChannelV1
   * 输出 / Returns: Promise<{ port: number; close: () => Promise<void>; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "openMigrationForward": (peerId: string, sessionId: string, channel: MigrationChannelV1) => Promise<{
    port: number;
    /**
     * 签名 / Signature: HostPeersV1.close.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 close 的输入与结果契约，所属容器为 HostPeersV1。
     * Purpose: Declares the input/result contract for close in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    close: () => Promise<void>;
}>;
  /**
   * 签名 / Signature: HostPeersV1.targetMigrationQmp.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 targetMigrationQmp 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for targetMigrationQmp in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string; sessionId: string; command: string; args: Record<string, unknown> | undefined optional; timeoutMs: number optional
   * 输出 / Returns: Promise<unknown>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "targetMigrationQmp": (peerId: string, sessionId: string, command: string, args?: Record<string, unknown> | undefined, timeoutMs?: number) => Promise<unknown>;
  /**
   * 签名 / Signature: HostPeersV1.prepareLiveTarget.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 prepareLiveTarget 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for prepareLiveTarget in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string; raw: unknown
   * 输出 / Returns: Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationPrepareReceipt>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "prepareLiveTarget": (peerId: string, raw: unknown) => Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationPrepareReceipt>;
  /**
   * 签名 / Signature: HostPeersV1.completeLiveTarget.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 completeLiveTarget 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for completeLiveTarget in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string; raw: unknown
   * 输出 / Returns: Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "completeLiveTarget": (peerId: string, raw: unknown) => Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus>;
  /**
   * 签名 / Signature: HostPeersV1.abortLiveTarget.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 abortLiveTarget 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for abortLiveTarget in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string; raw: unknown
   * 输出 / Returns: Promise<{ targetVmId: string; aborted: true; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "abortLiveTarget": (peerId: string, raw: unknown) => Promise<{
    targetVmId: string;
    aborted: true;
}>;
  /**
   * 签名 / Signature: HostPeersV1.inspectLiveTarget.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 inspectLiveTarget 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for inspectLiveTarget in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string; raw: unknown
   * 输出 / Returns: Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "inspectLiveTarget": (peerId: string, raw: unknown) => Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus>;
  /**
   * 签名 / Signature: HostPeersV1.rolloutStatus.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 rolloutStatus 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for rolloutStatus in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string
   * 输出 / Returns: Promise<{ hostId: string; policies: { pluginId: string; enabled: boolean; percentage: number; cohortVersion: string; revision: number; updatedAt: number; }[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "rolloutStatus": (peerId: string) => Promise<{
    hostId: string;
    policies: {
        pluginId: string;
        enabled: boolean;
        percentage: number;
        cohortVersion: string;
        revision: number;
        updatedAt: number;
    }[];
}>;
  /**
   * 签名 / Signature: HostPeersV1.publishRollout.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 publishRollout 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for publishRollout in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: Promise<{ hostId: string; policies: { pluginId: string; enabled: boolean; percentage: number; cohortVersion: string; revision: number; updatedAt: number; }[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "publishRollout": (peerId: string, input: unknown) => Promise<{
    hostId: string;
    policies: {
        pluginId: string;
        enabled: boolean;
        percentage: number;
        cohortVersion: string;
        revision: number;
        updatedAt: number;
    }[];
}>;
  /**
   * 签名 / Signature: HostPeersV1.importStatus.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 importStatus 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for importStatus in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string; transferId: string
   * 输出 / Returns: Promise<{ id: string; name: string; sha256?: string | undefined; sourceVmId?: string | undefined; snapshotId?: string | undefined; } | null>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "importStatus": (peerId: string, transferId: string) => Promise<{
    id: string;
    name: string;
    sha256?: string | undefined;
    sourceVmId?: string | undefined;
    snapshotId?: string | undefined;
} | null>;
  /**
   * 签名 / Signature: HostPeersV1.activateImport.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 activateImport 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for activateImport in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: Promise<{ id: string; status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping"; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "activateImport": (peerId: string, input: unknown) => Promise<{
    id: string;
    status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
}>;
  /**
   * 签名 / Signature: HostPeersV1.checkImportActivation.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 checkImportActivation 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for checkImportActivation in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: Promise<{ ready: true; id: string; status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping"; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "checkImportActivation": (peerId: string, input: unknown) => Promise<{
    ready: true;
    id: string;
    status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
}>;
  /**
   * 签名 / Signature: HostPeersV1.checkReplicaActivation.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 checkReplicaActivation 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for checkReplicaActivation in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: Promise<{ ready: true; id: string; status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping"; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "checkReplicaActivation": (peerId: string, input: unknown) => Promise<{
    ready: true;
    id: string;
    status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
}>;
  /**
   * 签名 / Signature: HostPeersV1.activateReplica.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 activateReplica 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for activateReplica in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: Promise<{ id: string; status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping"; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "activateReplica": (peerId: string, input: unknown) => Promise<{
    id: string;
    status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
}>;
  /**
   * 签名 / Signature: HostPeersV1.retireReplica.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 retireReplica 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for retireReplica in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: Promise<{ id: string; retired: true; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "retireReplica": (peerId: string, input: unknown) => Promise<{
    id: string;
    retired: true;
}>;
  /**
   * 签名 / Signature: HostPeersV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for view in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { hostId: string; name: string; fingerprint: string; listener: { error?: string | undefined; active: boolean; enabled: boolean; host: "127.0.0.1" | "0.0.0.0"; port: number; };….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => {
    hostId: string;
    name: string;
    fingerprint: string;
    listener: {
        error?: string | undefined;
        active: boolean;
        enabled: boolean;
        host: "127.0.0.1" | "0.0.0.0";
        port: number;
    };
    pairing: {
        value: string;
        expiresAt: number;
    } | null;
    incoming: {
        id: string;
        requesterId: string;
        name: string;
        createdAt: number;
        allowImport: boolean;
        allowPolicy: boolean;
        allowActivate: boolean;
        allowFailover: boolean;
    }[];
    outbound: {
        observation: HostPeersObservationV1 | null;
        id: string;
        remoteId: string;
        name: string;
        url: string;
        fingerprint: string;
        createdAt: number;
    }[];
};
  /**
   * 签名 / Signature: HostPeersV1.status.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 status 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for status in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ version: 1; id: string; name: string; platform: string; arch: string; cpus: number; memoryTotal: number; memoryFree: number; load: number[]; vmCount: number; running….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "status": () => Promise<{
    version: 1;
    id: string;
    name: string;
    platform: string;
    arch: string;
    cpus: number;
    memoryTotal: number;
    memoryFree: number;
    load: number[];
    vmCount: number;
    runningVms: number;
    checkedAt: string;
}>;
  /**
   * 签名 / Signature: HostPeersV1.score.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 score 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for score in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ requirements: { cpus: number; memoryMiB: number; }; scoredAt: string; candidates: { id: string; name: string; source: "local" | "peer"; eligible: boolean; score: num….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "score": (input: unknown) => Promise<{
    requirements: {
        cpus: number;
        memoryMiB: number;
    };
    scoredAt: string;
    candidates: {
        id: string;
        name: string;
        source: "local" | "peer";
        eligible: boolean;
        score: number | null;
        components: {
            memory: number;
            cpuLoad: number;
            instanceDensity: number;
        };
        reasons: string[];
        status: {
            version: 1;
            id: string;
            name: string;
            platform: string;
            arch: string;
            cpus: number;
            memoryTotal: number;
            memoryFree: number;
            load: number[];
            vmCount: number;
            runningVms: number;
            checkedAt: string;
        } | null;
        observedAt: number | null;
    }[];
}>;
  /**
   * 签名 / Signature: HostPeersV1.upload.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 upload 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for upload in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: peerId: string; transferId: string; name: string; produce: (target: import("stream").Writable, signal: AbortSignal) => Promise<unknown>; signal: AbortSignal; origin: { sourceVmId: string; snapshotId: string; } | undefined optional
   * 输出 / Returns: Promise<{ id: string; name: string; sha256?: string | undefined; sourceVmId?: string | undefined; snapshotId?: string | undefined; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "upload": (peerId: string, transferId: string, name: string, produce: (target: import("stream").Writable, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal, origin?: {
    sourceVmId: string;
    snapshotId: string;
} | undefined) => Promise<{
    id: string;
    name: string;
    sha256?: string | undefined;
    sourceVmId?: string | undefined;
    snapshotId?: string | undefined;
}>;
  /**
   * 签名 / Signature: HostPeersV1.configure.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configure 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for configure in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ requirements: { cpus: number; memoryMiB: number; }; scoredAt: string; candidates: { id: string; name: string; source: "local" | "peer"; eligible: boolean; score: num….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configure": (input: unknown) => Promise<{
    requirements: {
        cpus: number;
        memoryMiB: number;
    };
    scoredAt: string;
    candidates: {
        id: string;
        name: string;
        source: "local" | "peer";
        eligible: boolean;
        score: number | null;
        components: {
            memory: number;
            cpuLoad: number;
            instanceDensity: number;
        };
        reasons: string[];
        status: {
            version: 1;
            id: string;
            name: string;
            platform: string;
            arch: string;
            cpus: number;
            memoryTotal: number;
            memoryFree: number;
            load: number[];
            vmCount: number;
            runningVms: number;
            checkedAt: string;
        } | null;
        observedAt: number | null;
    }[];
} | {
    hostId: string;
    name: string;
    fingerprint: string;
    listener: {
        error?: string | undefined;
        active: boolean;
        enabled: boolean;
        host: "127.0.0.1" | "0.0.0.0";
        port: number;
    };
    pairing: {
        value: string;
        expiresAt: number;
    } | null;
    incoming: {
        id: string;
        requesterId: string;
        name: string;
        createdAt: number;
        allowImport: boolean;
        allowPolicy: boolean;
        allowActivate: boolean;
        allowFailover: boolean;
    }[];
    outbound: {
        observation: HostPeersObservationV1 | null;
        id: string;
        remoteId: string;
        name: string;
        url: string;
        fingerprint: string;
        createdAt: number;
    }[];
}>;
  /**
   * 签名 / Signature: HostPeersV1.refresh.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 refresh 的输入与结果契约，所属容器为 HostPeersV1。
   * Purpose: Declares the input/result contract for refresh in HostPeersV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "refresh": () => Promise<void>;
}

export interface MobileCompanionV1 {
  /**
   * 签名 / Signature: MobileCompanionV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 MobileCompanionV1。
   * Purpose: Declares the input/result contract for view in MobileCompanionV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: ownerId: string
   * 输出 / Returns: { devices: { expired: boolean; connected: boolean; id: string; name: string; ownerId: string; policy: { enabled: boolean; vmIds: string[]; kinds: ("cpu" | "memory" | "secret" ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (ownerId: string) => {
    devices: {
        expired: boolean;
        connected: boolean;
        id: string;
        name: string;
        ownerId: string;
        policy: {
            enabled: boolean;
            vmIds: string[];
            kinds: ("cpu" | "memory" | "secret" | "backup" | "disk" | "service" | "task")[];
        };
        createdAt: number;
        expiresAt: number;
        lastSeenAt?: number | undefined;
    }[];
};
  /**
   * 签名 / Signature: MobileCompanionV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 MobileCompanionV1。
   * Purpose: Declares the input/result contract for action in MobileCompanionV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: ownerId: string; input: unknown
   * 输出 / Returns: Promise<{ devices: { expired: boolean; connected: boolean; id: string; name: string; ownerId: string; policy: { enabled: boolean; vmIds: string[]; kinds: ("cpu" | "memory" | "….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (ownerId: string, input: unknown) => Promise<{
    devices: {
        expired: boolean;
        connected: boolean;
        id: string;
        name: string;
        ownerId: string;
        policy: {
            enabled: boolean;
            vmIds: string[];
            kinds: ("cpu" | "memory" | "secret" | "backup" | "disk" | "service" | "task")[];
        };
        createdAt: number;
        expiresAt: number;
        lastSeenAt?: number | undefined;
    }[];
} | {
    code: string;
    expiresAt: number;
}>;
  /**
   * 签名 / Signature: MobileCompanionV1.handle.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 handle 的输入与结果契约，所属容器为 MobileCompanionV1。
   * Purpose: Declares the input/result contract for handle in MobileCompanionV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: request: import("http").IncomingMessage; response: import("http").ServerResponse<import("http").IncomingMessage>
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "handle": (request: import("http").IncomingMessage, response: import("http").ServerResponse<import("http").IncomingMessage>) => Promise<void>;
  /**
   * 签名 / Signature: MobileCompanionV1.revokeAll.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 revokeAll 的输入与结果契约，所属容器为 MobileCompanionV1。
   * Purpose: Declares the input/result contract for revokeAll in MobileCompanionV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "revokeAll": () => Promise<void>;
}

export interface LiveMigrationReceiverV1 {
  /**
   * 签名 / Signature: LiveMigrationReceiverV1.prepare.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 prepare 的输入与结果契约，所属容器为 LiveMigrationReceiverV1。
   * Purpose: Declares the input/result contract for prepare in LiveMigrationReceiverV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: PrepareInputV1
   * 输出 / Returns: Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationPrepareReceipt>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "prepare": (input: PrepareInputV1) => Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationPrepareReceipt>;
  /**
   * 签名 / Signature: LiveMigrationReceiverV1.status.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 status 的输入与结果契约，所属容器为 LiveMigrationReceiverV1。
   * Purpose: Declares the input/result contract for status in LiveMigrationReceiverV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: { requesterId: string; transferId: string; targetVmId: string; }
   * 输出 / Returns: import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "status": (input: {
    requesterId: string;
    transferId: string;
    targetVmId: string;
}) => import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus;
  /**
   * 签名 / Signature: LiveMigrationReceiverV1.verifiedStatus.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 verifiedStatus 的输入与结果契约，所属容器为 LiveMigrationReceiverV1。
   * Purpose: Declares the input/result contract for verifiedStatus in LiveMigrationReceiverV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: { requesterId: string; transferId: string; targetVmId: string }
   * 输出 / Returns: Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "verifiedStatus": (input: { requesterId: string; transferId: string; targetVmId: string }) =>
    Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus>;
  /**
   * 签名 / Signature: LiveMigrationReceiverV1.complete.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 complete 的输入与结果契约，所属容器为 LiveMigrationReceiverV1。
   * Purpose: Declares the input/result contract for complete in LiveMigrationReceiverV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: { requesterId: string; transferId: string; targetVmId: string; sessionId: string; }
   * 输出 / Returns: Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "complete": (input: {
    requesterId: string;
    transferId: string;
    targetVmId: string;
    sessionId: string;
}) => Promise<import('../../shared/contracts/live-migration.ts').LiveMigrationTargetStatus>;
  /**
   * 签名 / Signature: LiveMigrationReceiverV1.abort.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 abort 的输入与结果契约，所属容器为 LiveMigrationReceiverV1。
   * Purpose: Declares the input/result contract for abort in LiveMigrationReceiverV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: { requesterId: string; transferId: string; targetVmId: string; sessionId: string; sou…
   * 输出 / Returns: Promise<{ targetVmId: string; aborted: true; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "abort": (input: {
    requesterId: string;
    transferId: string;
    targetVmId: string;
    sessionId: string;
    sourceRunning: true;
}) => Promise<{
    targetVmId: string;
    aborted: true;
}>;
}

export interface FleetPolicyRolloutsV1 {
  /**
   * 签名 / Signature: FleetPolicyRolloutsV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 FleetPolicyRolloutsV1。
   * Purpose: Declares the input/result contract for view in FleetPolicyRolloutsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { batches: { id: string; revision: number; policy: { pluginId: string; enabled: boolean; percentage: number; cohortVersion: string; }; targets: { peerId: string; hostId: strin….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => {
    batches: {
        id: string;
        revision: number;
        policy: {
            pluginId: string;
            enabled: boolean;
            percentage: number;
            cohortVersion: string;
        };
        targets: {
            peerId: string;
            hostId: string;
            name: string;
            beforeRevision: number;
            state: "failed" | "pending" | "applied";
            error?: string | undefined;
            appliedAt?: string | undefined;
        }[];
        createdAt: string;
        updatedAt: string;
    }[];
};
  /**
   * 签名 / Signature: FleetPolicyRolloutsV1.configure.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configure 的输入与结果契约，所属容器为 FleetPolicyRolloutsV1。
   * Purpose: Declares the input/result contract for configure in FleetPolicyRolloutsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ id: string; revision: number; policy: { pluginId: string; enabled: boolean; percentage: number; cohortVersion: string; }; targets: { peerId: string; hostId: string; ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configure": (input: unknown) => Promise<{
    id: string;
    revision: number;
    policy: {
        pluginId: string;
        enabled: boolean;
        percentage: number;
        cohortVersion: string;
    };
    targets: {
        peerId: string;
        hostId: string;
        name: string;
        beforeRevision: number;
        state: "failed" | "pending" | "applied";
        error?: string | undefined;
        appliedAt?: string | undefined;
    }[];
    createdAt: string;
    updatedAt: string;
}>;
}

export interface NotebookEnvironmentsV1 {
  /**
   * 签名 / Signature: NotebookEnvironmentsV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 NotebookEnvironmentsV1。
   * Purpose: Declares the input/result contract for view in NotebookEnvironmentsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown optional; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; installed: boolean; projectId: string; session: { provider: "jupyter" | "marimo"; directory: string; guestPort: number; hostPort: ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string, input?: unknown, signal?: AbortSignal | undefined) => Promise<{
    ready: boolean;
    executed: boolean;
    installed: boolean;
    projectId: string;
    session: {
        provider: "jupyter" | "marimo";
        directory: string;
        guestPort: number;
        hostPort: number;
        status: string;
        startedAt: string;
        needsReview: boolean;
    } | null;
    message: string;
}>;
  /**
   * 签名 / Signature: NotebookEnvironmentsV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 NotebookEnvironmentsV1。
   * Purpose: Declares the input/result contract for run in NotebookEnvironmentsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal; log: (line: string) => void
   * 输出 / Returns: Promise<NotebookResponseV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, input: unknown, signal: AbortSignal, log: (line: string) => void) => Promise<NotebookResponseV1>;
  /**
   * 签名 / Signature: NotebookEnvironmentsV1.link.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 link 的输入与结果契约，所属容器为 NotebookEnvironmentsV1。
   * Purpose: Declares the input/result contract for link in NotebookEnvironmentsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ provider: "jupyter" | "marimo"; url: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "link": (id: string) => Promise<{
    provider: "jupyter" | "marimo";
    url: string;
}>;
}

export interface BrowserIdeV1 {
  /**
   * 签名 / Signature: BrowserIdeV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 BrowserIdeV1。
   * Purpose: Declares the input/result contract for view in BrowserIdeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown optional; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; supported: boolean; installed: boolean; projectId: string; session: { directory: string; hostPort: number; guestPort: number; star….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string, input?: unknown, signal?: AbortSignal | undefined) => Promise<{
    ready: boolean;
    executed: boolean;
    supported: boolean;
    installed: boolean;
    projectId: string;
    session: {
        directory: string;
        hostPort: number;
        guestPort: number;
        startedAt: string;
        expiresAt: string;
        status: string;
        needsReview: boolean;
    } | null;
    message: string;
}>;
  /**
   * 签名 / Signature: BrowserIdeV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 BrowserIdeV1。
   * Purpose: Declares the input/result contract for run in BrowserIdeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal; log: (line: string) => void
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; supported: boolean; installed: boolean; projectId: string; session: { directory: string; hostPort: number; guestPort: number; star….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, input: unknown, signal: AbortSignal, log: (line: string) => void) => Promise<{
    ready: boolean;
    executed: boolean;
    supported: boolean;
    installed: boolean;
    projectId: string;
    session: {
        directory: string;
        hostPort: number;
        guestPort: number;
        startedAt: string;
        expiresAt: string;
        status: string;
        needsReview: boolean;
    } | null;
    message: string;
} | {
    ready: boolean;
    executed: boolean;
    session: {
        status: string;
        hostPort: number;
        guestPort: number;
        expiresAt: string;
    };
    message: string;
} | {
    ready: boolean;
    executed: boolean;
    installed: boolean;
    message: string;
    session?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    session: null;
    message: string;
    installed?: undefined;
}>;
  /**
   * 签名 / Signature: BrowserIdeV1.link.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 link 的输入与结果契约，所属容器为 BrowserIdeV1。
   * Purpose: Declares the input/result contract for link in BrowserIdeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ url: string; password: string; expiresAt: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "link": (id: string) => Promise<{
    url: string;
    password: string;
    expiresAt: string;
}>;
}

export interface ColdMigrationsV1 {
  /**
   * 签名 / Signature: ColdMigrationsV1.recoveryTickets.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 recoveryTickets 的输入与结果契约，所属容器为 ColdMigrationsV1。
   * Purpose: Declares the input/result contract for recoveryTickets in ColdMigrationsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<DomainRecoveryTicket[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "recoveryTickets": () => Promise<DomainRecoveryTicket[]>;
  /**
   * 签名 / Signature: ColdMigrationsV1.recoverTicket.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 recoverTicket 的输入与结果契约，所属容器为 ColdMigrationsV1。
   * Purpose: Declares the input/result contract for recoverTicket in ColdMigrationsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: ticket: DomainRecoveryTicket
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "recoverTicket": (ticket: DomainRecoveryTicket) => Promise<void>;
  /**
   * 签名 / Signature: ColdMigrationsV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 ColdMigrationsV1。
   * Purpose: Declares the input/result contract for view in ColdMigrationsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { enabled: boolean; entries: { vmId: string; transferId: string; peerId: string; targetName: string; status: "queued" | "review" | "transferring" | "copied" | "moved"; created….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => {
    enabled: boolean;
    entries: {
        vmId: string;
        transferId: string;
        peerId: string;
        targetName: string;
        status: "queued" | "review" | "transferring" | "copied" | "moved";
        createdAt: string;
        updatedAt: string;
        remoteVmId?: string | undefined;
        error?: string | undefined;
    }[];
};
  /**
   * 签名 / Signature: ColdMigrationsV1.preview.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 preview 的输入与结果契约，所属容器为 ColdMigrationsV1。
   * Purpose: Declares the input/result contract for preview in ColdMigrationsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; reason: string; queue: { vmId: string; transferId: string; peerId: string; targetName: string; fingerprint: { recordHash: string; ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "preview": (id: string, input: unknown) => Promise<{
    ready: boolean;
    executed: boolean;
    reason: string;
    queue: {
        vmId: string;
        transferId: string;
        peerId: string;
        targetName: string;
        fingerprint: {
            recordHash: string;
            diskSize: number;
            diskMtimeMs: number;
        };
        status: "queued" | "review" | "transferring" | "copied" | "moved";
        createdAt: string;
        updatedAt: string;
        remoteVmId?: string | undefined;
        error?: string | undefined;
    }[];
    target?: undefined;
    fingerprint?: undefined;
    sourceRemovalRequested?: undefined;
    targetStartRequested?: undefined;
    message?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    target: {
        id: string;
        name: string;
        hostId: string;
        score: number | null;
    };
    fingerprint: MigrationFingerprintV1;
    sourceRemovalRequested: boolean;
    targetStartRequested: boolean;
    queue: {
        vmId: string;
        transferId: string;
        peerId: string;
        targetName: string;
        fingerprint: {
            recordHash: string;
            diskSize: number;
            diskMtimeMs: number;
        };
        status: "queued" | "review" | "transferring" | "copied" | "moved";
        createdAt: string;
        updatedAt: string;
        remoteVmId?: string | undefined;
        error?: string | undefined;
    }[];
    message: string;
    reason?: undefined;
}>;
  /**
   * 签名 / Signature: ColdMigrationsV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 ColdMigrationsV1。
   * Purpose: Declares the input/result contract for run in ColdMigrationsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; phase: string; transferId: string; sourceVmId: string; remoteVmId: string; targetHostId: string; sourceRemoved: boolean; message: ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, input: unknown, signal: AbortSignal) => Promise<{
    ready: boolean;
    executed: boolean;
    phase: string;
    transferId: string;
    sourceVmId: string;
    remoteVmId: string;
    targetHostId: string;
    sourceRemoved: boolean;
    message: string;
} | {
    targetStart?: {
        id: string;
        status: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
    } | undefined;
    message?: string | undefined;
    ready: boolean;
    executed: boolean;
    phase: string;
    transferId: string;
    sourceVmId: string;
    remoteVmId: string;
    targetHostId: string;
    sourceRemoved: boolean;
    queuePersisted: boolean;
}>;
  /**
   * 签名 / Signature: ColdMigrationsV1.previewDrain.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 previewDrain 的输入与结果契约，所属容器为 ColdMigrationsV1。
   * Purpose: Declares the input/result contract for previewDrain in ColdMigrationsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ message: string; ready: boolean; executed: boolean; machines: ({ remoteVmId: string | undefined; id: string; name: string; targetName: string; ready: boolean; } | { ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "previewDrain": (input: unknown) => Promise<{
    message: string;
    ready: boolean;
    executed: boolean;
    machines: ({
        remoteVmId: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    } | {
        reason: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    })[];
} | {
    reason: string;
    ready: boolean;
    executed: boolean;
    machines: ({
        remoteVmId: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    } | {
        reason: string | undefined;
        id: string;
        name: string;
        targetName: string;
        ready: boolean;
    })[];
}>;
  /**
   * 签名 / Signature: ColdMigrationsV1.runDrain.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 runDrain 的输入与结果契约，所属容器为 ColdMigrationsV1。
   * Purpose: Declares the input/result contract for runDrain in ColdMigrationsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown; signal: AbortSignal
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; phase: string; completed: { sourceVmId: string; name: string; targetName: string; remoteVmId: string; sourceRemoved: boolean; }[];….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "runDrain": (input: unknown, signal: AbortSignal) => Promise<{
    ready: boolean;
    executed: boolean;
    phase: string;
    completed: {
        sourceVmId: string;
        name: string;
        targetName: string;
        remoteVmId: string;
        sourceRemoved: boolean;
    }[];
    remainingSourceVms: number;
    message: string;
}>;
}

export interface SnapshotReplicationsV1 {
  /**
   * 签名 / Signature: SnapshotReplicationsV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 SnapshotReplicationsV1。
   * Purpose: Declares the input/result contract for view in SnapshotReplicationsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { enabled: boolean; entries: { vmId: string; snapshotId: string; peerId: string; transferId: string; targetName: string; sourceFingerprint: string; status: "queued" | "review"….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => {
    enabled: boolean;
    entries: {
        vmId: string;
        snapshotId: string;
        peerId: string;
        transferId: string;
        targetName: string;
        sourceFingerprint: string;
        status: "queued" | "review" | "transferring" | "replicated";
        createdAt: string;
        updatedAt: string;
        remoteVmId?: string | undefined;
        sha256?: string | undefined;
        sourceSha256?: string | undefined;
        error?: string | undefined;
    }[];
};
  /**
   * 签名 / Signature: SnapshotReplicationsV1.preview.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 preview 的输入与结果契约，所属容器为 SnapshotReplicationsV1。
   * Purpose: Declares the input/result contract for preview in SnapshotReplicationsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; reason: string; snapshot?: undefined; target?: undefined; existingRemoteVmId?: undefined; existingSha256?: undefined; message?: un….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "preview": (id: string, input: unknown) => Promise<{
    ready: boolean;
    executed: boolean;
    reason: string;
    snapshot?: undefined;
    target?: undefined;
    existingRemoteVmId?: undefined;
    existingSha256?: undefined;
    message?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    snapshot: {
        id: string;
        name: string;
        createdAt: string;
    };
    target: {
        id: string;
        hostId: string;
        name: string;
    };
    existingRemoteVmId: string | undefined;
    existingSha256: string | undefined;
    message: string;
    reason?: undefined;
}>;
  /**
   * 签名 / Signature: SnapshotReplicationsV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 SnapshotReplicationsV1。
   * Purpose: Declares the input/result contract for run in SnapshotReplicationsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; transferId: string; sourceVmId: string; snapshotId: string; remoteVmId: string; targetHostId: string; sha256: string | undefined; ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, input: unknown, signal: AbortSignal) => Promise<{
    ready: boolean;
    executed: boolean;
    transferId: string;
    sourceVmId: string;
    snapshotId: string;
    remoteVmId: string;
    targetHostId: string;
    sha256: string | undefined;
    message: string;
}>;
}

export interface HaHostFailoverV1 {
  /**
   * 签名 / Signature: HaHostFailoverV1.configured.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configured 的输入与结果契约，所属容器为 HaHostFailoverV1。
   * Purpose: Declares the input/result contract for configured in HaHostFailoverV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configured": () => boolean;
  /**
   * 签名 / Signature: HaHostFailoverV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 HaHostFailoverV1。
   * Purpose: Declares the input/result contract for view in HaHostFailoverV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: { configured: boolean; armed: boolean; phase: string | null; targetVmId: string | null; failback: "pending" | "completed" | null; recoveryHeld: boolean; statusPending: boolean….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => {
    configured: boolean;
    armed: boolean;
    phase: string | null;
    targetVmId: string | null;
    failback: "pending" | "completed" | null;
    recoveryHeld: boolean;
    statusPending: boolean;
    error: string | null;
};
  /**
   * 签名 / Signature: HaHostFailoverV1.authorizeStart.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 authorizeStart 的输入与结果契约，所属容器为 HaHostFailoverV1。
   * Purpose: Declares the input/result contract for authorizeStart in HaHostFailoverV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "authorizeStart": (id: string) => Promise<void>;
  /**
   * 签名 / Signature: HaHostFailoverV1.disarm.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 disarm 的输入与结果契约，所属容器为 HaHostFailoverV1。
   * Purpose: Declares the input/result contract for disarm in HaHostFailoverV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; failureThreshold: number
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "disarm": (id: string, failureThreshold: number) => Promise<void>;
  /**
   * 签名 / Signature: HaHostFailoverV1.sample.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 sample 的输入与结果契约，所属容器为 HaHostFailoverV1。
   * Purpose: Declares the input/result contract for sample in HaHostFailoverV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "sample": () => Promise<void>;
  /**
   * 签名 / Signature: HaHostFailoverV1.witnessStatus.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 witnessStatus 的输入与结果契约，所属容器为 HaHostFailoverV1。
   * Purpose: Declares the input/result contract for witnessStatus in HaHostFailoverV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ phase?: string | undefined; armed?: boolean | undefined; lastHeartbeatAt?: number | undefined; targetVmId?: string | null | undefined; targetHostId?: string | undefi….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "witnessStatus": (id: string) => Promise<{
    phase?: string | undefined;
    armed?: boolean | undefined;
    lastHeartbeatAt?: number | undefined;
    targetVmId?: string | null | undefined;
    targetHostId?: string | undefined;
    failureThreshold?: number | undefined;
    error?: string | null | undefined;
    failback?: {
        phase: "pending" | "completed";
        retiredVmId: string;
        requestedAt: number;
        completedAt: number | null;
    } | null | undefined;
    recoveryHeld?: boolean | undefined;
    recoveredRetiredVmIds?: string[] | undefined;
    configured: boolean;
}>;
  /**
   * 签名 / Signature: HaHostFailoverV1.rejoin.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 rejoin 的输入与结果契约，所属容器为 HaHostFailoverV1。
   * Purpose: Declares the input/result contract for rejoin in HaHostFailoverV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; dataReconciled: boolean
   * 输出 / Returns: Promise<{ message: string; released?: boolean | undefined; retiredRemoteVmId?: string | undefined; failback?: "pending" | "completed" | undefined; recovered?: boolean | undefi….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "rejoin": (id: string, dataReconciled: boolean) => Promise<{
    message: string;
    released?: boolean | undefined;
    retiredRemoteVmId?: string | undefined;
    failback?: "pending" | "completed" | undefined;
    recovered?: boolean | undefined;
    retiredVmIds?: string[] | undefined;
    ready: boolean;
    executed: boolean;
}>;
}

export interface HaLocalFailoversV1 {
  /**
   * 签名 / Signature: HaLocalFailoversV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 HaLocalFailoversV1。
   * Purpose: Declares the input/result contract for view in HaLocalFailoversV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: { error: string | null; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => {
    error: string | null;
};
  /**
   * 签名 / Signature: HaLocalFailoversV1.hasObservedLive.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 hasObservedLive 的输入与结果契约，所属容器为 HaLocalFailoversV1。
   * Purpose: Declares the input/result contract for hasObservedLive in HaLocalFailoversV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "hasObservedLive": (id: string) => boolean;
  /**
   * 签名 / Signature: HaLocalFailoversV1.sample.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 sample 的输入与结果契约，所属容器为 HaLocalFailoversV1。
   * Purpose: Declares the input/result contract for sample in HaLocalFailoversV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "sample": () => Promise<void>;
  /**
   * 签名 / Signature: HaLocalFailoversV1.rejoin.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 rejoin 的输入与结果契约，所属容器为 HaLocalFailoversV1。
   * Purpose: Declares the input/result contract for rejoin in HaLocalFailoversV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; dataReconciled: boolean
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; retiredRemoteVmId: string; message: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "rejoin": (id: string, dataReconciled: boolean) => Promise<{
    ready: boolean;
    executed: boolean;
    retiredRemoteVmId: string;
    message: string;
}>;
}

export interface DisasterRecoveryDrillV1 {
  /**
   * 签名 / Signature: DisasterRecoveryDrillV1.status.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 status 的输入与结果契约，所属容器为 DisasterRecoveryDrillV1。
   * Purpose: Declares the input/result contract for status in DisasterRecoveryDrillV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ backups: { id: string; createdAt: string; bytes: number; encrypted: boolean | undefined; storage: "blocks" | undefined; verifiedAt: string | null; }[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "status": (id: string) => Promise<{
    backups: {
        id: string;
        createdAt: string;
        bytes: number;
        encrypted: boolean | undefined;
        storage: "blocks" | undefined;
        verifiedAt: string | null;
    }[];
}>;
  /**
   * 签名 / Signature: DisasterRecoveryDrillV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 DisasterRecoveryDrillV1。
   * Purpose: Declares the input/result contract for run in DisasterRecoveryDrillV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; action: "check" | "run"; signal: AbortSignal | undefined optional; log: (line: string) => void optional
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; backups: { id: string; createdAt: string; bytes: number; encrypted: boolean | undefined; storage: "blocks" | undefined; verifiedAt….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, input: unknown, action: "check" | "run", signal?: AbortSignal | undefined, log?: (line: string) => void) => Promise<{
    ready: boolean;
    executed: boolean;
    backups: {
        id: string;
        createdAt: string;
        bytes: number;
        encrypted: boolean | undefined;
        storage: "blocks" | undefined;
        verifiedAt: string | null;
    }[];
} | {
    cleanupError?: string | undefined;
    error?: string | undefined;
    restoreMs: number | null;
    bootMs: number | null;
    totalMs: number;
    restoredName: string;
    temporaryVmId: string | null;
    temporaryVmRemoved: boolean;
    probeSha256?: string | undefined;
    ready: boolean;
    executed: boolean;
    backupId: string;
    probePath: string;
}>;
}

export interface NativeIntegrationV1 {
  /**
   * 签名 / Signature: NativeIntegrationV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 NativeIntegrationV1。
   * Purpose: Declares the input/result contract for view in NativeIntegrationV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<import("../../shared/native-integration.ts").NativeView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => Promise<import("../../shared/native-integration.ts").NativeView>;
  /**
   * 签名 / Signature: NativeIntegrationV1.revoke.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 revoke 的输入与结果契约，所属容器为 NativeIntegrationV1。
   * Purpose: Declares the input/result contract for revoke in NativeIntegrationV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "revoke": () => void;
  /**
   * 签名 / Signature: NativeIntegrationV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 NativeIntegrationV1。
   * Purpose: Declares the input/result contract for action in NativeIntegrationV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<import("../../shared/native-integration.ts").NativeView | import("../../shared/native-integration.ts").NativeHandoff | { ticket: `${string}-${string}-${string}-${strin….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (input: unknown) => Promise<import("../../shared/native-integration.ts").NativeView | import("../../shared/native-integration.ts").NativeHandoff | {
    ticket: `${string}-${string}-${string}-${string}-${string}`;
    url: string;
    opened?: undefined;
    target?: undefined;
    path?: undefined;
} | {
    opened: boolean;
    target: "editor" | "explorer";
    path: string;
    ticket?: undefined;
    url?: undefined;
}>;
}

export interface NativeClipboardV1 {
  /**
   * 签名 / Signature: NativeClipboardV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 NativeClipboardV1。
   * Purpose: Declares the input/result contract for view in NativeClipboardV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: import("../../shared/native-clipboard.ts").NativeClipboardView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => import("../../shared/native-clipboard.ts").NativeClipboardView;
  /**
   * 签名 / Signature: NativeClipboardV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 NativeClipboardV1。
   * Purpose: Declares the input/result contract for action in NativeClipboardV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: Promise<import("../../shared/native-clipboard.ts").NativeClipboardView | { process: { pid: number; created: string; image: string; bits: 0 | 32 | 64; }; view: import("../../sh….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (value: unknown) => Promise<import("../../shared/native-clipboard.ts").NativeClipboardView | {
    process: {
        pid: number;
        created: string;
        image: string;
        bits: 0 | 32 | 64;
    };
    view: import("../../shared/native-clipboard.ts").NativeClipboardView;
} | {
    image: string;
    sha256: string;
}>;
}

export interface LocalAssistantV1 {
  /**
   * 签名 / Signature: LocalAssistantV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 LocalAssistantV1。
   * Purpose: Declares the input/result contract for view in LocalAssistantV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: import("../../shared/assistant.ts").AssistantView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => import("../../shared/assistant.ts").AssistantView;
  /**
   * 签名 / Signature: LocalAssistantV1.revoke.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 revoke 的输入与结果契约，所属容器为 LocalAssistantV1。
   * Purpose: Declares the input/result contract for revoke in LocalAssistantV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "revoke": () => void;
  /**
   * 签名 / Signature: LocalAssistantV1.configure.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configure 的输入与结果契约，所属容器为 LocalAssistantV1。
   * Purpose: Declares the input/result contract for configure in LocalAssistantV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: version: number; input: unknown
   * 输出 / Returns: Promise<import("../../shared/assistant.ts").AssistantView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configure": (version: number, input: unknown) => Promise<import("../../shared/assistant.ts").AssistantView>;
  /**
   * 签名 / Signature: LocalAssistantV1.preview.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 preview 的输入与结果契约，所属容器为 LocalAssistantV1。
   * Purpose: Declares the input/result contract for preview in LocalAssistantV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: import("../../shared/assistant.ts").AssistantPreview.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "preview": (input: unknown) => import("../../shared/assistant.ts").AssistantPreview;
  /**
   * 签名 / Signature: LocalAssistantV1.models.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 models 的输入与结果契约，所属容器为 LocalAssistantV1。
   * Purpose: Declares the input/result contract for models in LocalAssistantV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ models: { name: string; size: number; }[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "models": (signal?: AbortSignal | undefined) => Promise<{
    models: {
        name: string;
        size: number;
    }[];
}>;
  /**
   * 签名 / Signature: LocalAssistantV1.generate.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 generate 的输入与结果契约，所属容器为 LocalAssistantV1。
   * Purpose: Declares the input/result contract for generate in LocalAssistantV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<import("../../shared/assistant.ts").AssistantResult>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "generate": (id: string, signal?: AbortSignal | undefined) => Promise<import("../../shared/assistant.ts").AssistantResult>;
}

export interface CommunityPluginsV1 {
  /**
   * 签名 / Signature: CommunityPluginsV1.recoverCleanup.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 recoverCleanup 的输入与结果契约，所属容器为 CommunityPluginsV1。
   * Purpose: Declares the input/result contract for recoverCleanup in CommunityPluginsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: pluginId: string; generation: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  readonly recoverCleanup: (pluginId: string, generation: string) => Promise<void>;
  /**
   * 签名 / Signature: CommunityPluginsV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 CommunityPluginsV1。
   * Purpose: Declares the input/result contract for view in CommunityPluginsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { publishers: { fingerprint: string; name: string; addedAt: number; }[]; sources: { id: string; name: string; url: string; addedAt: number; }[]; installed: { name: string; id:….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => {
    publishers: {
        fingerprint: string;
        name: string;
        addedAt: number;
    }[];
    sources: {
        id: string;
        name: string;
        url: string;
        addedAt: number;
    }[];
    installed: {
        name: string;
        id: string;
        sha256: string;
        version: string;
        schemaVersion: 1;
        signature: string;
        description: string;
        publisher: string;
        sourceId: string;
        installedAt: number;
        extensions?: {
            routes: {
                id: string;
                name: string;
            }[];
            panels: {
                id: string;
                title: string;
                description: string;
                routeId: string;
                fields: {
                    key: string;
                    label: string;
                    type: "number" | "boolean" | "text";
                    required: boolean;
                }[];
            }[];
        } | undefined;
        phase?: "running" | "cleanup-pending" | "draining" | undefined;
        generation?: string | undefined;
    }[];
    catalogs: Record<string, {
        schemaVersion: 1;
        id: string;
        name: string;
        description: string;
        version: string;
        sha256: string;
        publisher: string;
        signature: string;
        wasmUrl: string;
        extensions?: {
            routes: {
                id: string;
                name: string;
            }[];
            panels: {
                id: string;
                title: string;
                description: string;
                routeId: string;
                fields: {
                    key: string;
                    label: string;
                    type: "number" | "boolean" | "text";
                    required: boolean;
                }[];
            }[];
        } | undefined;
    }[]>;
    problems: Record<string, string>;
    subscriptions: {
        pluginId: string;
        types: ("job.finished" | "alert.raised")[];
        enabled: boolean;
        activeSince: number;
        updatedAt: number;
    }[];
    schedules: {
        pluginId: string;
        intervalMinutes: number;
        enabled: boolean;
        nextRunAt: number;
        updatedAt: number;
    }[];
    deliveries: {
        id: string;
        pluginId: string;
        event: {
            id: string;
            type: "test" | "job.finished" | "alert.raised";
            occurredAt: string;
            tags: string[];
            vmId?: string | undefined;
            projectId?: string | undefined;
            jobId?: string | undefined;
            scope?: string | undefined;
            status?: "error" | "cancelled" | "interrupted" | "done" | undefined;
            kind?: "cpu" | "memory" | "secret" | "backup" | "disk" | "service" | "task" | undefined;
        } | {
            id: string;
            type: "plugin.timer";
            occurredAt: string;
            tags: [];
        };
        status: "failed" | "done" | "pending";
        processedAt?: number | undefined;
        error?: string | undefined;
        resultPreview?: string | undefined;
    }[];
    eventError: string | undefined;
    runtime: {
        version: number;
        instances: import("../../shared/contracts/plugin-runtime.ts").PluginInstanceView[];
    };
};
  /**
   * 签名 / Signature: CommunityPluginsV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 CommunityPluginsV1。
   * Purpose: Declares the input/result contract for action in CommunityPluginsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: raw: unknown
   * 输出 / Returns: Promise<{ publishers: { fingerprint: string; name: string; addedAt: number; }[]; sources: { id: string; name: string; url: string; addedAt: number; }[]; installed: { name: str….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (raw: unknown) => Promise<{
    publishers: {
        fingerprint: string;
        name: string;
        addedAt: number;
    }[];
    sources: {
        id: string;
        name: string;
        url: string;
        addedAt: number;
    }[];
    installed: {
        name: string;
        id: string;
        sha256: string;
        version: string;
        schemaVersion: 1;
        signature: string;
        description: string;
        publisher: string;
        sourceId: string;
        installedAt: number;
        extensions?: {
            routes: {
                id: string;
                name: string;
            }[];
            panels: {
                id: string;
                title: string;
                description: string;
                routeId: string;
                fields: {
                    key: string;
                    label: string;
                    type: "number" | "boolean" | "text";
                    required: boolean;
                }[];
            }[];
        } | undefined;
        phase?: "running" | "cleanup-pending" | "draining" | undefined;
        generation?: string | undefined;
    }[];
    catalogs: Record<string, {
        schemaVersion: 1;
        id: string;
        name: string;
        description: string;
        version: string;
        sha256: string;
        publisher: string;
        signature: string;
        wasmUrl: string;
        extensions?: {
            routes: {
                id: string;
                name: string;
            }[];
            panels: {
                id: string;
                title: string;
                description: string;
                routeId: string;
                fields: {
                    key: string;
                    label: string;
                    type: "number" | "boolean" | "text";
                    required: boolean;
                }[];
            }[];
        } | undefined;
    }[]>;
    problems: Record<string, string>;
    subscriptions: {
        pluginId: string;
        types: ("job.finished" | "alert.raised")[];
        enabled: boolean;
        activeSince: number;
        updatedAt: number;
    }[];
    schedules: {
        pluginId: string;
        intervalMinutes: number;
        enabled: boolean;
        nextRunAt: number;
        updatedAt: number;
    }[];
    deliveries: {
        id: string;
        pluginId: string;
        event: {
            id: string;
            type: "test" | "job.finished" | "alert.raised";
            occurredAt: string;
            tags: string[];
            vmId?: string | undefined;
            projectId?: string | undefined;
            jobId?: string | undefined;
            scope?: string | undefined;
            status?: "error" | "cancelled" | "interrupted" | "done" | undefined;
            kind?: "cpu" | "memory" | "secret" | "backup" | "disk" | "service" | "task" | undefined;
        } | {
            id: string;
            type: "plugin.timer";
            occurredAt: string;
            tags: [];
        };
        status: "failed" | "done" | "pending";
        processedAt?: number | undefined;
        error?: string | undefined;
        resultPreview?: string | undefined;
    }[];
    eventError: string | undefined;
    runtime: {
        version: number;
        instances: import("../../shared/contracts/plugin-runtime.ts").PluginInstanceView[];
    };
} | {
    pluginId: string;
    version: string;
    result: unknown;
}>;
  /**
   * 签名 / Signature: CommunityPluginsV1.invokeRoute.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 invokeRoute 的输入与结果契约，所属容器为 CommunityPluginsV1。
   * Purpose: Declares the input/result contract for invokeRoute in CommunityPluginsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: rawPluginId: string; rawRouteId: string; body: unknown
   * 输出 / Returns: Promise<{ pluginId: string; version: string; result: unknown; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "invokeRoute": (rawPluginId: string, rawRouteId: string, body: unknown) => Promise<{
    pluginId: string;
    version: string;
    result: unknown;
}>;
  /**
   * 签名 / Signature: CommunityPluginsV1.tick.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 tick 的输入与结果契约，所属容器为 CommunityPluginsV1。
   * Purpose: Declares the input/result contract for tick in CommunityPluginsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "tick": () => Promise<void>;
}

export interface WebhooksV1 {
  /**
   * 签名 / Signature: WebhooksV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 WebhooksV1。
   * Purpose: Declares the input/result contract for view in WebhooksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: import("../../shared/webhooks.ts").WebhookView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => import("../../shared/webhooks.ts").WebhookView;
  /**
   * 签名 / Signature: WebhooksV1.configure.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configure 的输入与结果契约，所属容器为 WebhooksV1。
   * Purpose: Declares the input/result contract for configure in WebhooksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<{ secret?: string | undefined; subscriptions: import("../../shared/webhooks.ts").WebhookSubscription[]; deliveries: import("../../shared/webhooks.ts").WebhookDelivery[….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configure": (input: unknown) => Promise<{
    secret?: string | undefined;
    subscriptions: import("../../shared/webhooks.ts").WebhookSubscription[];
    deliveries: import("../../shared/webhooks.ts").WebhookDelivery[];
    error?: string | undefined;
    collecting: boolean;
    limits: {
        subscriptions: number;
        pending: number;
        history: number;
        attempts: number;
        sourceHours: number;
    };
}>;
  /**
   * 签名 / Signature: WebhooksV1.collect.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 collect 的输入与结果契约，所属容器为 WebhooksV1。
   * Purpose: Declares the input/result contract for collect in WebhooksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "collect": () => Promise<void>;
  /**
   * 签名 / Signature: WebhooksV1.tick.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 tick 的输入与结果契约，所属容器为 WebhooksV1。
   * Purpose: Declares the input/result contract for tick in WebhooksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "tick": () => Promise<void>;
}

export interface AutomationRulesV1 {
  /**
   * 签名 / Signature: AutomationRulesV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 AutomationRulesV1。
   * Purpose: Declares the input/result contract for view in AutomationRulesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: AutomationViewV1.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => AutomationViewV1;
  /**
   * 签名 / Signature: AutomationRulesV1.configure.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configure 的输入与结果契约，所属容器为 AutomationRulesV1。
   * Purpose: Declares the input/result contract for configure in AutomationRulesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<AutomationViewV1 | { matches: { event: import("../../shared/webhooks.ts").WebhookEvent; targetVmId: string | null; action: "start" | "stop" | "suspend" | "resume" | "r….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configure": (input: unknown) => Promise<AutomationViewV1 | {
    matches: {
        event: import("../../shared/webhooks.ts").WebhookEvent;
        targetVmId: string | null;
        action: "start" | "stop" | "suspend" | "resume" | "runbook";
        wouldExecute: boolean;
    }[];
    approval?: string | undefined;
    rule: {
        name: string;
        enabled: boolean;
        previewOnly: boolean;
        filter: {
            types: ("job.finished" | "alert.raised")[];
            vmIds: string[];
            projectIds: string[];
            tags: string[];
            statuses: ("error" | "cancelled" | "interrupted" | "done")[];
            kinds: ("cpu" | "memory" | "secret" | "backup" | "disk" | "service" | "task")[];
        };
        action: "start" | "stop" | "suspend" | "resume" | "runbook";
        steps: {
            name: string;
            command: string;
            timeout: number;
        }[];
        cooldownSeconds: number;
        id: string;
        version: number;
        createdAt: number;
        activeSince: number;
        updatedAt: number;
    };
}>;
  /**
   * 签名 / Signature: AutomationRulesV1.tick.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 tick 的输入与结果契约，所属容器为 AutomationRulesV1。
   * Purpose: Declares the input/result contract for tick in AutomationRulesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "tick": () => Promise<void>;
}

export interface LogRetentionV1 {
    /** 中文：读取清理候选及引用版本。English: Read cleanup candidates and reference revision. */
    cleanupSnapshot: () => import('../../shared/contracts/cleanup-plan.ts').CleanupSnapshot;
    /** 中文：在串行队列内复核并清理。English: Revalidate and clean in the serialized queue. */
    cleanupExecute: (revision: string, signal?: AbortSignal) => Promise<{ removedCount: number; reclaimedBytes: number }>;
  /**
   * 签名 / Signature: LogRetentionV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 LogRetentionV1。
   * Purpose: Declares the input/result contract for view in LogRetentionV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: import("../../shared/log-retention.ts").LogRetentionView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": () => import("../../shared/log-retention.ts").LogRetentionView;
  /**
   * 签名 / Signature: LogRetentionV1.preview.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 preview 的输入与结果契约，所属容器为 LogRetentionV1。
   * Purpose: Declares the input/result contract for preview in LogRetentionV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: { token: string; stores: number; completedLogs: number; completedBytes: number; protectedLogs: number; protectedBytes: number; removeLogs: number; removeBytes: number; expired….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "preview": (input: unknown) => {
    token: string;
    stores: number;
    completedLogs: number;
    completedBytes: number;
    protectedLogs: number;
    protectedBytes: number;
    removeLogs: number;
    removeBytes: number;
    expiredLogs: number;
    capacityLogs: number;
    remainingBytes: number;
};
  /**
   * 签名 / Signature: LogRetentionV1.save.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 save 的输入与结果契约，所属容器为 LogRetentionV1。
   * Purpose: Declares the input/result contract for save in LogRetentionV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown; token: string
   * 输出 / Returns: Promise<import("../../shared/log-retention.ts").LogRetentionView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "save": (input: unknown, token: string) => Promise<import("../../shared/log-retention.ts").LogRetentionView>;
  /**
   * 签名 / Signature: LogRetentionV1.sweep.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 sweep 的输入与结果契约，所属容器为 LogRetentionV1。
   * Purpose: Declares the input/result contract for sweep in LogRetentionV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<import("../../shared/log-retention.ts").LogRetentionView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "sweep": () => Promise<import("../../shared/log-retention.ts").LogRetentionView>;
}

export interface GraphApiV1 {
  /**
   * 签名 / Signature: GraphApiV1.query.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 query 的输入与结果契约，所属容器为 GraphApiV1。
   * Purpose: Declares the input/result contract for query in GraphApiV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown; external: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ status: number; body: import("graphql").FormattedExecutionResult<Record<string, unknown>, Record<string, unknown>>; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "query": (input: unknown, external?: AbortSignal | undefined) => Promise<{
    status: number;
    body: import("graphql").FormattedExecutionResult<Record<string, unknown>, Record<string, unknown>>;
}>;
}

export interface PackageWorkbenchV1 {
  /**
   * 签名 / Signature: PackageWorkbenchV1.query.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 query 的输入与结果契约，所属容器为 PackageWorkbenchV1。
   * Purpose: Declares the input/result contract for query in PackageWorkbenchV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; raw: unknown; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ vmId: string; mode: "installed" | "updates" | "search"; manager: "apk" | "apt"; query: string; page: number; total: number; items: ItemV1[]; hasMore: boolean; warnin….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "query": (id: string, raw: unknown, signal?: AbortSignal | undefined) => Promise<{
    vmId: string;
    mode: "installed" | "updates" | "search";
    manager: "apk" | "apt";
    query: string;
    page: number;
    total: number;
    items: ItemV1[];
    hasMore: boolean;
    warning: string;
}>;
  /**
   * 签名 / Signature: PackageWorkbenchV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 PackageWorkbenchV1。
   * Purpose: Declares the input/result contract for action in PackageWorkbenchV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; raw: unknown; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ job: unknown; token?: undefined; expiresAt?: undefined; manager?: undefined; plan?: undefined; change?: undefined; name?: undefined; } | { token: `${string}-${string….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, raw: unknown, signal?: AbortSignal | undefined) => Promise<{
    job: unknown;
    token?: undefined;
    expiresAt?: undefined;
    manager?: undefined;
    plan?: undefined;
    change?: undefined;
    name?: undefined;
} | {
    token: `${string}-${string}-${string}-${string}-${string}`;
    expiresAt: number;
    manager: "apk" | "apt";
    plan: string;
    change: "remove" | "install" | "upgrade" | "upgrade-all";
    name: string | null;
    job?: undefined;
}>;
}

export type AlertEventV1 = {
    id: string;
    vmId: string;
    kind: "cpu" | "memory" | "secret" | "backup" | "disk" | "service" | "task";
    message: string;
    createdAt: string;
    acknowledged: boolean;
    projectId?: string | undefined;
    jobId?: string | undefined;
};

export type MetricPointV1 = {
    sampledAt: string;
    cpuPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    diskUsed: number;
    diskTotal: number;
    networkReceivedBytes?: number | null | undefined;
    networkTransmittedBytes?: number | null | undefined;
    networkReceiveBytesPerSecond?: number | null | undefined;
    networkTransmitBytesPerSecond?: number | null | undefined;
};

export type JumpV1 = {
    family: FamilyV1;
    interface: string;
    chain: string;
    rules?: string[] | undefined;
};

export type VulnerabilityScanV1 = {
    source: "OSV";
    status: "complete" | "unavailable";
    ecosystem: string | null;
    packagesChecked: number;
    affectedPackages: number;
    vulnerabilityCount: number;
    matches: VulnerabilityMatchV1[];
    error?: string | undefined;
};

export type BackupDownloadV1 = {
    type: "file";
    path: string;
    name: string;
} | {
    type: "stream";
    name: string;
    bytes: number;
    /**
     * 签名 / Signature: BackupDownloadV1.write.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 write 的输入与结果契约，所属容器为 BackupDownloadV1。
     * Purpose: Declares the input/result contract for write in BackupDownloadV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: output: import("stream").Writable; signal: AbortSignal
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    write: (output: import("stream").Writable, signal: AbortSignal) => Promise<void>;
};

export type BackupRecordV1 = {
    id: string;
    createdAt: string;
    bytes: number;
    checksum: string;
    verifiedAt?: string | undefined;
    error?: string | undefined;
    directory?: string | undefined;
    encrypted?: boolean | undefined;
    passwordSecret?: string | undefined;
    retainUntil?: string | undefined;
    storage?: "blocks" | undefined;
};

export type BackupStateV1 = {
    policy: {
        enabled: boolean;
        intervalHours: number;
        keep: number;
        maxGiB: number;
        lockDays?: number | undefined;
        deduplicate?: boolean | undefined;
        bandwidthMiBps?: number | undefined;
        directory?: string | undefined;
        passwordSecret?: string | undefined;
    };
    items: BackupRecordV1[];
    lastSuccess?: string | undefined;
};

export type DiagnosticV1 = {
    severity: "error" | "info" | "warning";
    message: string;
    line?: number | undefined;
    column?: number | undefined;
};

export type FrameV1 = {
    id: number;
    name: string;
    path: string;
    line: number;
    column: number;
};

export type VariableV1 = {
    name: string;
    value: string;
    type: string;
    variablesReference: number;
};

export interface SingleAppWindowsV1 {
  /**
   * 签名 / Signature: SingleAppWindowsV1.onSessionInvalidated.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 onSessionInvalidated 的输入与结果契约，所属容器为 SingleAppWindowsV1。
   * Purpose: Declares the input/result contract for onSessionInvalidated in SingleAppWindowsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; sessionId: string; listener: () => void
   * 输出 / Returns: () => void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "onSessionInvalidated": (id: string, sessionId: string, listener: () => void) => () => void;
  /**
   * 签名 / Signature: SingleAppWindowsV1.clipboardPolicies.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 clipboardPolicies 的输入与结果契约，所属容器为 SingleAppWindowsV1。
   * Purpose: Declares the input/result contract for clipboardPolicies in SingleAppWindowsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<Record<string, { copy: boolean; paste: boolean; }>>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "clipboardPolicies": (id: string) => Promise<Record<string, {
    copy: boolean;
    paste: boolean;
}>>;
  /**
   * 签名 / Signature: SingleAppWindowsV1.saveClipboardPolicy.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 saveClipboardPolicy 的输入与结果契约，所属容器为 SingleAppWindowsV1。
   * Purpose: Declares the input/result contract for saveClipboardPolicy in SingleAppWindowsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; program: string; raw: unknown
   * 输出 / Returns: Promise<{ program: string; clipboard: { copy: boolean; paste: boolean; }; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "saveClipboardPolicy": (id: string, program: string, raw: unknown) => Promise<{
    program: string;
    clipboard: {
        copy: boolean;
        paste: boolean;
    };
}>;
  /**
   * 签名 / Signature: SingleAppWindowsV1.removeClipboardPolicy.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 removeClipboardPolicy 的输入与结果契约，所属容器为 SingleAppWindowsV1。
   * Purpose: Declares the input/result contract for removeClipboardPolicy in SingleAppWindowsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; program: string
   * 输出 / Returns: Promise<{ removed: boolean; program: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "removeClipboardPolicy": (id: string, program: string) => Promise<{
    removed: boolean;
    program: string;
}>;
  /**
   * 签名 / Signature: SingleAppWindowsV1.list.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 list 的输入与结果契约，所属容器为 SingleAppWindowsV1。
   * Purpose: Declares the input/result contract for list in SingleAppWindowsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ id: string; vmId: string; program: string; display: number; port: number; resolution: string; clipboard: { copy: boolean; paste: boolean; }; startedAt: string; passw….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "list": (id: string) => Promise<{
    id: string;
    vmId: string;
    program: string;
    display: number;
    port: number;
    resolution: string;
    clipboard: {
        copy: boolean;
        paste: boolean;
    };
    startedAt: string;
    password: string;
    dataDirectory: string;
    revoked: boolean;
    cleanupPending: boolean;
    status: "running" | "cleanup-pending" | "preparing" | "stopped" | "relaunch-required" | "review-required";
    projectId?: string | undefined;
    networkIsolation?: "host" | "private" | undefined;
    projectOwner?: {
        uid: number;
        user: string;
    } | undefined;
    applicationOwner?: {
        uid: number;
        user: string;
    } | undefined;
    lastError?: string | undefined;
}[]>;
  /**
   * 签名 / Signature: SingleAppWindowsV1.port.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 port 的输入与结果契约，所属容器为 SingleAppWindowsV1。
   * Purpose: Declares the input/result contract for port in SingleAppWindowsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; sessionId: string
   * 输出 / Returns: Promise<number>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "port": (id: string, sessionId: string) => Promise<number>;
  /**
   * 签名 / Signature: SingleAppWindowsV1.connectionCommand.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 connectionCommand 的输入与结果契约，所属容器为 SingleAppWindowsV1。
   * Purpose: Declares the input/result contract for connectionCommand in SingleAppWindowsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; sessionId: string; port: number
   * 输出 / Returns: Promise<string>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "connectionCommand": (id: string, sessionId: string, port: number) => Promise<string>;
  /**
   * 签名 / Signature: SingleAppWindowsV1.start.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 start 的输入与结果契约，所属容器为 SingleAppWindowsV1。
   * Purpose: Declares the input/result contract for start in SingleAppWindowsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; raw: unknown; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ id: string; vmId: string; program: string; display: number; port: number; resolution: string; clipboard: { copy: boolean; paste: boolean; }; startedAt: string; passw….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "start": (id: string, raw: unknown, signal?: AbortSignal | undefined) => Promise<{
    id: string;
    vmId: string;
    program: string;
    display: number;
    port: number;
    resolution: string;
    clipboard: {
        copy: boolean;
        paste: boolean;
    };
    startedAt: string;
    password: string;
    dataDirectory: string;
    revoked: boolean;
    cleanupPending: boolean;
    status: "running" | "cleanup-pending" | "preparing" | "stopped" | "relaunch-required" | "review-required";
    projectId?: string | undefined;
    networkIsolation?: "host" | "private" | undefined;
    projectOwner?: {
        uid: number;
        user: string;
    } | undefined;
    applicationOwner?: {
        uid: number;
        user: string;
    } | undefined;
    lastError?: string | undefined;
}>;
  /**
   * 签名 / Signature: SingleAppWindowsV1.stop.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 stop 的输入与结果契约，所属容器为 SingleAppWindowsV1。
   * Purpose: Declares the input/result contract for stop in SingleAppWindowsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; sessionId: string
   * 输出 / Returns: Promise<{ stopped: boolean; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "stop": (id: string, sessionId: string) => Promise<{
    stopped: boolean;
}>;
}

/**
 * 签名 / Signature: WorkV1.WorkV1.
 * 功能：为维护独立于实现的 V1 公共服务接口声明 WorkV1 的输入与结果契约，所属容器为 WorkV1。
 * Purpose: Declares the input/result contract for WorkV1 in WorkV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
 * 输入 / Inputs: log: (text: string) => void; signal: AbortSignal; update: import("../../shared/contracts/jobs.ts").JobUpdate; result: (value: unknown) => Promise<void>
 * 输出 / Returns: Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
export type WorkV1 = (log: (text: string) => void, signal: AbortSignal, update: import("../../shared/contracts/jobs.ts").JobUpdate, result: (value: unknown) => Promise<void>) => Promise<void>;

export type FeatureSettingV1 = {
    enabled: boolean;
    options: Record<string, unknown>;
    updatedAt: string;
};

export type FeatureExecutionV1 = {
    featureId: "ipv6" | "syscall-profile" | "ssh-agent-forward" | "gpg-agent-forward" | "project-quota" | "guest-quota" | "network-quota" | "egress-policy" | "power-aware-schedule" | "availability-report" | "audit-log" | "cpu-topology" | "device-profiles" | "resource-reservation" | "crash-loop-guard" | "maintenance-windows" | "patch-bundle" | "environment-recreate" | "editor-profiles" | "metrics-export" | "event-timeline" | "anomaly-detection" | "review-comments" | "command-forms" | "vm-dependency-start" | "environment-parity" | "test-matrix" | "cross-vm-copy" | "packet-capture" | "reverse-tunnel" | "archive-wizard" | "hash-manifest" | "case-conflict-report" | "task-import" | "project-onboarding" | "env-schema" | "shell-profiles" | "toolchain-check" | "bootstrap-dry-run" | "project-template-pack" | "git-stash" | "git-reflog" | "git-cherry-pick" | "git-bisect" | "git-rebase" | "git-policy" | "precommit-secrets" | "code-ownership" | "flaky-tests" | "coverage-history" | "benchmark-regression" | "sbom" | "license-report" | "release-gates" | "artifact-provenance" | "changelog" | "reproducible-build" | "posix-acl" | "guest-clock-policy" | "static-routes" | "process-history" | "disk-io-metrics" | "network-metrics" | "command-risk" | "command-macros" | "runbooks" | "session-lock" | "vm-suspend" | "rescue-boot" | "qemu-commandline" | "disk-encryption" | "qcow2-scrub" | "backup-dedup" | "cow-workspace" | "secure-erase" | "watch-sync" | "sync-window" | "rename-detection" | "sync-queue" | "path-sync-policy" | "sync-rollback" | "merge-drivers" | "multi-host-view" | "network-isolation" | "local-dns-alias" | "tpm-secure-boot" | "hello-unlock" | "clipboard-redaction" | "secret-rotation" | "signed-bundles" | "immutable-backups" | "multi-host-health" | "explorer-integration" | "terminal-layouts" | "shortcut-editor" | "offline-pwa" | "accessibility-audit" | "locale-packs" | "self-update" | "api-explorer";
    action: "check" | "run";
    startedAt: string;
    finishedAt: string;
    ready: boolean;
    result: Record<string, unknown>;
};

export interface ResumableUploadsV1 {
  /**
   * 签名 / Signature: ResumableUploadsV1.create.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 create 的输入与结果契约，所属容器为 ResumableUploadsV1。
   * Purpose: Declares the input/result contract for create in ResumableUploadsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string; input: unknown
   * 输出 / Returns: Promise<{ received: number[]; chunkBytes: number; path: string; size: number; chunks: string[]; overwrite: boolean; id: string; vmId: string; fingerprint: string; createdAt: s….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "create": (vmId: string, input: unknown) => Promise<{
    received: number[];
    chunkBytes: number;
    path: string;
    size: number;
    chunks: string[];
    overwrite: boolean;
    id: string;
    vmId: string;
    fingerprint: string;
    createdAt: string;
    expiresAt: string;
    completed?: {
        bytes: number;
        sha256: string;
    } | undefined;
    committing?: {
        bytes: number;
        sha256: string;
    } | undefined;
}>;
  /**
   * 签名 / Signature: ResumableUploadsV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 ResumableUploadsV1。
   * Purpose: Declares the input/result contract for view in ResumableUploadsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: Promise<{ received: number[]; chunkBytes: number; path: string; size: number; chunks: string[]; overwrite: boolean; id: string; vmId: string; fingerprint: string; createdAt: s….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (vmId: string, id: string) => Promise<{
    received: number[];
    chunkBytes: number;
    path: string;
    size: number;
    chunks: string[];
    overwrite: boolean;
    id: string;
    vmId: string;
    fingerprint: string;
    createdAt: string;
    expiresAt: string;
    completed?: {
        bytes: number;
        sha256: string;
    } | undefined;
    committing?: {
        bytes: number;
        sha256: string;
    } | undefined;
}>;
  /**
   * 签名 / Signature: ResumableUploadsV1.chunk.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 chunk 的输入与结果契约，所属容器为 ResumableUploadsV1。
   * Purpose: Declares the input/result contract for chunk in ResumableUploadsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string; id: string; index: number; input: import("stream").Readable; signal: AbortSignal
   * 输出 / Returns: Promise<{ index: number; bytes: number; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "chunk": (vmId: string, id: string, index: number, input: import("stream").Readable, signal: AbortSignal) => Promise<{
    index: number;
    bytes: number;
}>;
  /**
   * 签名 / Signature: ResumableUploadsV1.commit.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 commit 的输入与结果契约，所属容器为 ResumableUploadsV1。
   * Purpose: Declares the input/result contract for commit in ResumableUploadsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string; id: string; signal: AbortSignal
   * 输出 / Returns: Promise<{ bytes: number; sha256: string; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "commit": (vmId: string, id: string, signal: AbortSignal) => Promise<{
    bytes: number;
    sha256: string;
}>;
  /**
   * 签名 / Signature: ResumableUploadsV1.remove.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 remove 的输入与结果契约，所属容器为 ResumableUploadsV1。
   * Purpose: Declares the input/result contract for remove in ResumableUploadsV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: Promise<{ removed: boolean; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "remove": (vmId: string, id: string) => Promise<{
    removed: boolean;
}>;
}

export type PreviewV1 = {
    [key: string]: unknown;
    kind: string;
    name: string;
    size: number;
};

export type ProjectV1 = {
    directory: string;
    template: "none" | "node" | "python" | "rust";
    repository: string;
    setup: string;
    command: string;
    previewPort?: number | undefined;
    networkIsolation?: "host" | "private" | undefined;
    environment?: Record<string, string> | undefined;
    secrets?: Record<string, string> | undefined;
    runtimes?: {
        python?: string | undefined;
        node?: string | undefined;
    } | undefined;
    services?: {
        name: string;
        command: string;
        dependsOn: string[];
        ready: string;
        timeout: number;
        environment?: Record<string, string> | undefined;
        secrets?: Record<string, string> | undefined;
        health?: {
            command: string;
            interval: number;
            timeout: number;
            failures: number;
            restart: boolean;
            maxRestarts: number;
            backoff: number;
        } | undefined;
    }[] | undefined;
} & {
    _workspace?: string | undefined;
};

export type DiskOperationV1 = "trim" | "compact";

export type AttemptV1 = {
    startedAt: string;
    finishedAt?: string | undefined;
    error?: string | undefined;
    result?: Record<string, unknown> | undefined;
};

export type DiskMaintenanceStateV1 = {
    policy: {
        enabled: boolean;
        intervalHours: number;
        mode: "trim" | "compact" | "both";
        compress: boolean;
    };
    attempts: Partial<Record<DiskOperationV1, AttemptV1>>;
    successes: Partial<Record<DiskOperationV1, string>>;
};

export type DiagnosticCheckV1 = {
    name: string;
    status: "error" | "ok" | "skip" | "warning";
    detail: string;
    suggestion?: string | undefined;
};

export type MigrationFileV1 = {
    path: string;
    bytes: number;
    modified: number;
};

export type NetworkChangeV1 = {
    path: string;
    before: string | null;
    after: string;
};

export type ForwardChangeV1 = {
    before: {
        host: number;
        guest: number;
        name?: string | undefined;
    }[];
    after: {
        host: number;
        guest: number;
        name?: string | undefined;
    }[];
};

export type NetworkStateV1 = {
    config: {
        dnsServers: string[];
        dnsDomains: string[];
        dnssec: "no" | "yes" | "inherit" | "allow-downgrade";
        httpProxy: string;
        httpsProxy: string;
        noProxy: string;
        npmRegistry: string;
        pipIndex: string;
        apkMirror: string;
        aptMirror: string;
        aptSecurityMirror: string;
        forwards?: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[] | undefined;
        dependencyDownloads?: {
            npm?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            pip?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
            git?: {
                kind: "bearer";
                endpoint: string;
                tokenSecret: string;
            } | {
                kind: "basic";
                endpoint: string;
                username: string;
                passwordSecret: string;
            } | undefined;
        } | undefined;
    };
    changes: NetworkChangeV1[];
    forwards?: ForwardChangeV1 | undefined;
    dnsBackend?: "resolved" | undefined;
    resolverLink?: {
        before: string;
        after: string;
    } | undefined;
    appliedAt?: string | undefined;
};

export type PipelineV1 = {
    name: string;
    maxConcurrency?: number;
    inputs?: string[];
    steps: {
        id?: string;
        dependsOn?: string[];
        rerunnable?: boolean;
        name: string;
        command: string;
        timeout: number;
    }[];
    artifacts: string[];
    id?: string | undefined;
} & {
    id: string;
};

export type PipelineRunV1 = {
    id: string;
    sourceRunId?: string;
    selectedStepIds?: string[];
    fingerprint?: string;
    rerunUnavailable?: string;
    pipelineId: string;
    name: string;
    projectId: string;
    startedAt: string;
    finishedAt?: string | undefined;
    status: "error" | "cancelled" | "interrupted" | "running" | "done";
    error?: string | undefined;
    errorCode?: string | undefined;
    steps: {
        id?: string;
        dependsOn?: string[];
        blockedReason?: string;
        name: string;
        status: "error" | "cancelled" | "running" | "done" | "pending";
        startedAt?: string | undefined;
        finishedAt?: string | undefined;
        code?: number | undefined;
        errorCode?: string | undefined;
        log: string;
    }[];
    artifacts: {
        name: string;
        bytes: number;
        index: number;
    }[];
};

export interface StorageTieringV1 {
  /**
   * 签名 / Signature: StorageTieringV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 StorageTieringV1。
   * Purpose: Declares the input/result contract for view in StorageTieringV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string | undefined optional
   * 输出 / Returns: Promise<{ policy: { enabled: boolean; hotPoolId: string; coldPoolId: string; idleHours: number; intervalHours: number; } | null; lastRunAt: string | null; lastError: string | ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id?: string | undefined) => Promise<{
    policy: {
        enabled: boolean;
        hotPoolId: string;
        coldPoolId: string;
        idleHours: number;
        intervalHours: number;
    } | null;
    lastRunAt: string | null;
    lastError: string | null;
    history: {
        vmId: string;
        name: string;
        from: string;
        to: string;
        at: string;
        status: "failed" | "moved";
        error?: string | undefined;
    }[];
    current: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    } | null;
    candidates: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    }[];
    pools: {
        id: string;
        name: string;
        available: boolean;
        freeBytes: number | null;
    }[];
    running: boolean;
}>;
  /**
   * 签名 / Signature: StorageTieringV1.tick.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 tick 的输入与结果契约，所属容器为 StorageTieringV1。
   * Purpose: Declares the input/result contract for tick in StorageTieringV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "tick": (signal?: AbortSignal | undefined) => Promise<void>;
  /**
   * 签名 / Signature: StorageTieringV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 StorageTieringV1。
   * Purpose: Declares the input/result contract for run in StorageTieringV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; action: "check" | "run"; signal: AbortSignal | undefined optional; log: (text: string) => void optional
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; policy: { enabled: boolean; hotPoolId: string; coldPoolId: string; idleHours: number; intervalHours: number; } | null; lastRunAt: ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, input: unknown, action: "check" | "run", signal?: AbortSignal | undefined, log?: (text: string) => void) => Promise<{
    ready: boolean;
    executed: boolean;
    policy: {
        enabled: boolean;
        hotPoolId: string;
        coldPoolId: string;
        idleHours: number;
        intervalHours: number;
    } | null;
    lastRunAt: string | null;
    lastError: string | null;
    history: {
        vmId: string;
        name: string;
        from: string;
        to: string;
        at: string;
        status: "failed" | "moved";
        error?: string | undefined;
    }[];
    current: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    } | null;
    candidates: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    }[];
    pools: {
        id: string;
        name: string;
        available: boolean;
        freeBytes: number | null;
    }[];
    running: boolean;
} | {
    ready: boolean;
    executed: boolean;
    applied: {
        warning?: string | undefined;
        moved: boolean;
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    } | {
        warning?: string | undefined;
        moved: boolean;
        cleanupPending: boolean;
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    };
    policy: {
        enabled: boolean;
        hotPoolId: string;
        coldPoolId: string;
        idleHours: number;
        intervalHours: number;
    } | null;
    lastRunAt: string | null;
    lastError: string | null;
    history: {
        vmId: string;
        name: string;
        from: string;
        to: string;
        at: string;
        status: "failed" | "moved";
        error?: string | undefined;
    }[];
    current: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    } | null;
    candidates: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    }[];
    pools: {
        id: string;
        name: string;
        available: boolean;
        freeBytes: number | null;
    }[];
    running: boolean;
} | {
    ready: boolean;
    executed: boolean;
    rebalance: {
        moved: number;
        failed: number;
        entries: {
            vmId: string;
            name: string;
            from: string;
            to: string;
            at: string;
            status: "failed" | "moved";
            error?: string | undefined;
        }[];
    };
    policy: {
        enabled: boolean;
        hotPoolId: string;
        coldPoolId: string;
        idleHours: number;
        intervalHours: number;
    } | null;
    lastRunAt: string | null;
    lastError: string | null;
    history: {
        vmId: string;
        name: string;
        from: string;
        to: string;
        at: string;
        status: "failed" | "moved";
        error?: string | undefined;
    }[];
    current: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    } | null;
    candidates: {
        vmId: string;
        name: string;
        currentPoolId: string;
        targetPoolId: string | null;
        lastUsedAt: string;
        ready: boolean;
        reason: string;
    }[];
    pools: {
        id: string;
        name: string;
        available: boolean;
        freeBytes: number | null;
    }[];
    running: boolean;
}>;
}

export interface ServiceMeshV1 {
  /**
   * 签名 / Signature: ServiceMeshV1.status.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 status 的输入与结果契约，所属容器为 ServiceMeshV1。
   * Purpose: Declares the input/result contract for status in ServiceMeshV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ reason?: string | undefined; projectId: string; policy: { name: string; listenPort: number; upstreamPort: number; updatedAt: string; }; guestRunning: boolean; envoyI….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "status": (id: string, signal?: AbortSignal | undefined) => Promise<{
    reason?: string | undefined;
    projectId: string;
    policy: {
        name: string;
        listenPort: number;
        upstreamPort: number;
        updatedAt: string;
    };
    guestRunning: boolean;
    envoyInstalled: boolean;
    tmuxInstalled: boolean;
    pythonInstalled: boolean;
    sidecarRunning: boolean;
    bindingValid: boolean | null;
    bindingError: string | null;
    runId: string | null;
    processes: number[];
    configPresent: boolean;
    directoryPresent: boolean;
    namespacePresent: boolean;
    version: string | null;
    envoyUsable: boolean | null;
    directory: string;
    networkIsolation: "host" | "private";
    sidecarStateKnown: boolean;
    ready: boolean;
    executed: false;
}>;
  /**
   * 签名 / Signature: ServiceMeshV1.assertNoRunning.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 assertNoRunning 的输入与结果契约，所属容器为 ServiceMeshV1。
   * Purpose: Declares the input/result contract for assertNoRunning in ServiceMeshV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "assertNoRunning": (id: string) => Promise<void>;
  /**
   * 签名 / Signature: ServiceMeshV1.configure.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 configure 的输入与结果契约，所属容器为 ServiceMeshV1。
   * Purpose: Declares the input/result contract for configure in ServiceMeshV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; enabled: boolean; save: () => Promise<T>
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "configure": <T>(id: string, enabled: boolean, save: () => Promise<T>) => Promise<T>;
  /**
   * 签名 / Signature: ServiceMeshV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 ServiceMeshV1。
   * Purpose: Declares the input/result contract for action in ServiceMeshV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; raw: unknown; action: "check" | "run"; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ reason?: string | undefined; projectId: string; policy: { name: string; listenPort: number; upstreamPort: number; updatedAt: string; }; guestRunning: boolean; envoyI….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, raw: unknown, action: "check" | "run", signal?: AbortSignal | undefined) => Promise<{
    reason?: string | undefined;
    projectId: string;
    policy: {
        name: string;
        listenPort: number;
        upstreamPort: number;
        updatedAt: string;
    };
    guestRunning: boolean;
    envoyInstalled: boolean;
    tmuxInstalled: boolean;
    pythonInstalled: boolean;
    sidecarRunning: boolean;
    bindingValid: boolean | null;
    bindingError: string | null;
    runId: string | null;
    processes: number[];
    configPresent: boolean;
    directoryPresent: boolean;
    namespacePresent: boolean;
    version: string | null;
    envoyUsable: boolean | null;
    directory: string;
    networkIsolation: "host" | "private";
    sidecarStateKnown: boolean;
    ready: boolean;
    executed: false;
} | {
    ready: boolean;
    executed: boolean;
    message: string;
    reason?: string | undefined;
    projectId: string;
    policy: {
        name: string;
        listenPort: number;
        upstreamPort: number;
        updatedAt: string;
    };
    guestRunning: boolean;
    envoyInstalled: boolean;
    tmuxInstalled: boolean;
    pythonInstalled: boolean;
    sidecarRunning: boolean;
    bindingValid: boolean | null;
    bindingError: string | null;
    runId: string | null;
    processes: number[];
    configPresent: boolean;
    directoryPresent: boolean;
    namespacePresent: boolean;
    version: string | null;
    envoyUsable: boolean | null;
    directory: string;
    networkIsolation: "host" | "private";
    sidecarStateKnown: boolean;
} | {
    executed: boolean;
    configPath: string;
    reason?: string | undefined;
    projectId: string;
    policy: {
        name: string;
        listenPort: number;
        upstreamPort: number;
        updatedAt: string;
    };
    guestRunning: boolean;
    envoyInstalled: boolean;
    tmuxInstalled: boolean;
    pythonInstalled: boolean;
    sidecarRunning: boolean;
    bindingValid: boolean | null;
    bindingError: string | null;
    runId: string | null;
    processes: number[];
    configPresent: boolean;
    directoryPresent: boolean;
    namespacePresent: boolean;
    version: string | null;
    envoyUsable: boolean | null;
    directory: string;
    networkIsolation: "host" | "private";
    sidecarStateKnown: boolean;
    ready: boolean;
}>;
}

export interface VtpmEnrollmentV1 {
  /**
   * 签名 / Signature: VtpmEnrollmentV1.status.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 status 的输入与结果契约，所属容器为 VtpmEnrollmentV1。
   * Purpose: Declares the input/result contract for status in VtpmEnrollmentV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; at: Date optional
   * 输出 / Returns: { ready: boolean; executed: boolean; records: { rotateDueAt: string; overdue: boolean; dueSoon: boolean; fingerprint: string; label: string; enrolledAt: string; rotateAfterDay….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "status": (id: string, at?: Date) => {
    ready: boolean;
    executed: boolean;
    records: {
        rotateDueAt: string;
        overdue: boolean;
        dueSoon: boolean;
        fingerprint: string;
        label: string;
        enrolledAt: string;
        rotateAfterDays: number;
        updatedAt: string;
    }[];
    overdueCount: number;
    dueSoonCount: number;
    message: string;
};
  /**
   * 签名 / Signature: VtpmEnrollmentV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 VtpmEnrollmentV1。
   * Purpose: Declares the input/result contract for action in VtpmEnrollmentV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; raw: unknown; action: "check" | "run"
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; records: { rotateDueAt: string; overdue: boolean; dueSoon: boolean; fingerprint: string; label: string; enrolledAt: string; rotate….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, raw: unknown, action: "check" | "run") => Promise<{
    ready: boolean;
    executed: boolean;
    records: {
        rotateDueAt: string;
        overdue: boolean;
        dueSoon: boolean;
        fingerprint: string;
        label: string;
        enrolledAt: string;
        rotateAfterDays: number;
        updatedAt: string;
    }[];
    overdueCount: number;
    dueSoonCount: number;
    message: string;
}>;
}

export interface AcmeRenewalV1 {
  /**
   * 签名 / Signature: AcmeRenewalV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 AcmeRenewalV1。
   * Purpose: Declares the input/result contract for view in AcmeRenewalV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: { policy: { vmId: string; enabled: boolean; intervalHours: number; updatedAt: string; nextAttemptAt: number; lastAttemptAt?: number | undefined; } | null; attempts: { vmId: st….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => {
    policy: {
        vmId: string;
        enabled: boolean;
        intervalHours: number;
        updatedAt: string;
        nextAttemptAt: number;
        lastAttemptAt?: number | undefined;
    } | null;
    attempts: {
        vmId: string;
        at: number;
        mode: "dry-run" | "manual" | "scheduled";
        status: "success" | "failed";
        exitCode?: number | undefined;
    }[];
    running: boolean;
};
  /**
   * 签名 / Signature: AcmeRenewalV1.save.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 save 的输入与结果契约，所属容器为 AcmeRenewalV1。
   * Purpose: Declares the input/result contract for save in AcmeRenewalV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; policy: { vmId: string; enabled: boolean; intervalHours: number; updatedAt: string; nextAttemptAt: number; lastAttemptAt?: number ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "save": (id: string, input: unknown) => Promise<{
    ready: boolean;
    executed: boolean;
    policy: {
        vmId: string;
        enabled: boolean;
        intervalHours: number;
        updatedAt: string;
        nextAttemptAt: number;
        lastAttemptAt?: number | undefined;
    } | null;
    attempts: {
        vmId: string;
        at: number;
        mode: "dry-run" | "manual" | "scheduled";
        status: "success" | "failed";
        exitCode?: number | undefined;
    }[];
    running: boolean;
}>;
  /**
   * 签名 / Signature: AcmeRenewalV1.check.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 check 的输入与结果契约，所属容器为 AcmeRenewalV1。
   * Purpose: Declares the input/result contract for check in AcmeRenewalV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ reason?: string | undefined; ready: boolean; executed: boolean; policy: { vmId: string; enabled: boolean; intervalHours: number; updatedAt: string; nextAttemptAt: nu….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "check": (id: string, signal?: AbortSignal | undefined) => Promise<{
    reason?: string | undefined;
    ready: boolean;
    executed: boolean;
    policy: {
        vmId: string;
        enabled: boolean;
        intervalHours: number;
        updatedAt: string;
        nextAttemptAt: number;
        lastAttemptAt?: number | undefined;
    } | null;
    attempts: {
        vmId: string;
        at: number;
        mode: "dry-run" | "manual" | "scheduled";
        status: "success" | "failed";
        exitCode?: number | undefined;
    }[];
    running: boolean;
}>;
  /**
   * 签名 / Signature: AcmeRenewalV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 AcmeRenewalV1。
   * Purpose: Declares the input/result contract for run in AcmeRenewalV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; action: "check" | "run"; signal: AbortSignal | undefined optional
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; policy: { vmId: string; enabled: boolean; intervalHours: number; updatedAt: string; nextAttemptAt: number; lastAttemptAt?: number ….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": (id: string, input: unknown, action: "check" | "run", signal?: AbortSignal | undefined) => Promise<{
    ready: boolean;
    executed: boolean;
    policy: {
        vmId: string;
        enabled: boolean;
        intervalHours: number;
        updatedAt: string;
        nextAttemptAt: number;
        lastAttemptAt?: number | undefined;
    } | null;
    attempts: {
        vmId: string;
        at: number;
        mode: "dry-run" | "manual" | "scheduled";
        status: "success" | "failed";
        exitCode?: number | undefined;
    }[];
    running: boolean;
}>;
  /**
   * 签名 / Signature: AcmeRenewalV1.tick.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 tick 的输入与结果契约，所属容器为 AcmeRenewalV1。
   * Purpose: Declares the input/result contract for tick in AcmeRenewalV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "tick": () => Promise<void>;
}

export interface TeamTemplatesV1 {
  /**
   * 签名 / Signature: TeamTemplatesV1.action.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 action 的输入与结果契约，所属容器为 TeamTemplatesV1。
   * Purpose: Declares the input/result contract for action in TeamTemplatesV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; input: unknown; action: "check" | "run"
   * 输出 / Returns: Promise<{ ready: boolean; executed: boolean; unchanged: boolean; template: { id: string; name: string; version: number; fingerprint: string; content: { resources: { cpus: numb….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "action": (id: string, input: unknown, action: "check" | "run") => Promise<{
    ready: boolean;
    executed: boolean;
    unchanged: boolean;
    template: {
        id: string;
        name: string;
        version: number;
        fingerprint: string;
        content: {
            resources: {
                cpus: number;
                memoryMiB: number;
                diskGiB: number;
                accelerator: "auto" | "tcg" | "whpx";
                distro: "alpine" | "debian" | "ubuntu";
                firmware: "bios" | "uefi";
                template: "none" | "node" | "python" | "rust";
                architecture?: "x86_64" | "aarch64" | undefined;
            };
            project: {
                directory: "/workspace";
                template: "none" | "node" | "python" | "rust";
                repository: string;
                previewPort?: number | undefined;
                networkIsolation?: "host" | "private" | undefined;
                runtimes?: {
                    python?: string | undefined;
                    node?: string | undefined;
                } | undefined;
            };
        };
        createdAt: string;
        updatedAt: string;
    };
} | {
    ready: boolean;
    executed: boolean;
    template: {
        content: {
            resources: {
                cpus: number;
                memoryMiB: number;
                diskGiB: number;
                accelerator: "auto" | "tcg" | "whpx";
                distro: "alpine" | "debian" | "ubuntu";
                firmware: "bios" | "uefi";
                template: "none" | "node" | "python" | "rust";
                architecture?: "x86_64" | "aarch64" | undefined;
            };
            project: {
                directory: "/workspace";
                template: "none" | "node" | "python" | "rust";
                repository: string;
                previewPort?: number | undefined;
                networkIsolation?: "host" | "private" | undefined;
                runtimes?: {
                    python?: string | undefined;
                    node?: string | undefined;
                } | undefined;
            };
        };
        fingerprint: string;
        version: number;
        updatedAt: string;
        id: string;
        name: string;
        createdAt: string;
    };
    unchanged?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    deleted: string;
    templateId?: undefined;
    vmId?: undefined;
    vm?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    templateId: string;
    vmId: string;
    vm: import("../../shared/contracts/vm.ts").VMView;
    deleted?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    templates: {
        id: string;
        name: string;
        version: number;
        fingerprint: string;
        createdAt: string;
        updatedAt: string;
    }[];
    name?: undefined;
    fingerprint?: undefined;
    previousFingerprint?: undefined;
    content?: undefined;
    excluded?: undefined;
    template?: undefined;
    message?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    name: string;
    fingerprint: string;
    previousFingerprint: string | undefined;
    content: {
        resources: {
            cpus: number;
            memoryMiB: number;
            diskGiB: number;
            accelerator: "auto" | "tcg" | "whpx";
            distro: "alpine" | "debian" | "ubuntu";
            firmware: "bios" | "uefi";
            template: "none" | "node" | "python" | "rust";
            architecture?: "x86_64" | "aarch64" | undefined;
        };
        project: {
            directory: "/workspace";
            template: "none" | "node" | "python" | "rust";
            repository: string;
            previewPort?: number | undefined;
            networkIsolation?: "host" | "private" | undefined;
            runtimes?: {
                python?: string | undefined;
                node?: string | undefined;
            } | undefined;
        };
    };
    excluded: string[];
    templates?: undefined;
    template?: undefined;
    message?: undefined;
} | {
    ready: boolean;
    executed: boolean;
    template: {
        id: string;
        name: string;
        version: number;
        fingerprint: string;
        content: {
            resources: {
                cpus: number;
                memoryMiB: number;
                diskGiB: number;
                accelerator: "auto" | "tcg" | "whpx";
                distro: "alpine" | "debian" | "ubuntu";
                firmware: "bios" | "uefi";
                template: "none" | "node" | "python" | "rust";
                architecture?: "x86_64" | "aarch64" | undefined;
            };
            project: {
                directory: "/workspace";
                template: "none" | "node" | "python" | "rust";
                repository: string;
                previewPort?: number | undefined;
                networkIsolation?: "host" | "private" | undefined;
                runtimes?: {
                    python?: string | undefined;
                    node?: string | undefined;
                } | undefined;
            };
        };
        createdAt: string;
        updatedAt: string;
    };
    message: string | undefined;
    templates?: undefined;
    name?: undefined;
    fingerprint?: undefined;
    previousFingerprint?: undefined;
    content?: undefined;
    excluded?: undefined;
}>;
}

export interface HaFailureMonitorV1 {
  /**
   * 签名 / Signature: HaFailureMonitorV1.sample.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 sample 的输入与结果契约，所属容器为 HaFailureMonitorV1。
   * Purpose: Declares the input/result contract for sample in HaFailureMonitorV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "sample": () => Promise<void>;
  /**
   * 签名 / Signature: HaFailureMonitorV1.reconfigure.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 reconfigure 的输入与结果契约，所属容器为 HaFailureMonitorV1。
   * Purpose: Declares the input/result contract for reconfigure in HaFailureMonitorV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "reconfigure": (id: string) => Promise<void>;
  /**
   * 签名 / Signature: HaFailureMonitorV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 HaFailureMonitorV1。
   * Purpose: Declares the input/result contract for view in HaFailureMonitorV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: { suspected: boolean; sampleIntervalSeconds: number; armed: boolean; consecutiveFailures: number; observedState: "error" | "running" | "stopped" | "starting" | "paused" | "sto….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "view": (id: string) => {
    suspected: boolean;
    sampleIntervalSeconds: number;
    armed: boolean;
    consecutiveFailures: number;
    observedState: "error" | "running" | "stopped" | "starting" | "paused" | "stopping";
    observedAt: string;
    policyVersion?: string | undefined;
    lastHealthyAt?: string | undefined;
    suspectedAt?: string | undefined;
} | null;
}

export type NextSettingV1 = {
    enabled: boolean;
    options: Record<string, unknown>;
    updatedAt: string;
};

export type NextExecutionV1 = {
    featureId: "process-interop" | "gpu-compute-passthrough" | "pci-usb-passthrough" | "vtpm-key-enrollment" | "service-mesh" | "acme-renewal" | "team-templates" | "wireguard-overlay" | "object-backup" | "storage-pools" | "storage-tiering" | "disaster-recovery-drill" | "authenticated-ide-preview" | "notebook-environment" | "cross-host-snapshots" | "maintenance-drain" | "cold-migration" | "ebpf-profiler" | "flamegraph" | "network-emulation" | "nat-hairpin" | "host-disk-health" | "global-dedup" | "otel-tracing" | "dependency-bot" | "vcpu-hotplug" | "memory-hotplug" | "schema-panels" | "compliance-evidence" | "proxy-pac" | "build-cache" | "branch-preview" | "onboarding-checklist" | "review-threads" | "activity-digest" | "slo-dashboard" | "error-budget" | "capacity-forecast" | "log-index" | "test-sharding" | "network-topology" | "code-search-index" | "language-server-catalog" | "pii-classification" | "ha-failover" | "host-pairing" | "host-cert-rotation" | "multi-host-inventory" | "live-migration" | "resource-scheduler" | "fleet-policy-rollout" | "uefi-ovmf" | "gpu-vgpu-profiles" | "nested-virtualization" | "virtio-fs" | "virtual-media-devices" | "hardware-compatibility" | "snapshot-merge" | "file-level-restore" | "backup-throttle" | "rpo-rto-planner" | "private-dns-dnssec" | "http-ingress" | "mtls-policy" | "passkey-webauthn" | "oidc-saml" | "custom-rbac" | "jit-privilege" | "dual-approval" | "signed-policy-bundles" | "remote-audit-lock" | "incident-lockdown" | "log-retention" | "alert-routing" | "auto-remediation" | "build-farm" | "devcontainer-marketplace" | "local-ai-assistant" | "natural-command-planner" | "shared-terminal" | "shared-desktop-view" | "session-handoff" | "file-locks" | "project-permissions" | "change-approval" | "host-drive-policy" | "file-associations" | "clipboard-policy" | "media-passthrough" | "usb-hotplug" | "desktop-recording" | "plugin-marketplace" | "signed-plugin-sandbox" | "graphql-api" | "webhook-events" | "automation-dsl" | "mobile-companion" | "browser-extension" | "tray-companion" | "feature-rollout";
    action: "check" | "run";
    startedAt: string;
    finishedAt: string;
    ready: boolean;
    executed: boolean;
    result: Record<string, unknown>;
};

export type PowerSampleV1 = {
    checkedAt: string;
    onAC: boolean | null;
    batteryPresent: boolean | null;
    batteryPercent: number | null;
    error?: string | undefined;
};

export type ProbeV1 = {
    available: boolean;
    devices: string[];
    deviceNodes: boolean;
    diagnostic?: string | undefined;
};

export type AudioBackendSupportV1 = {
    available: boolean;
    reason?: string | undefined;
};

export type DeviceV1 = {
    id: string;
    vendorId: number;
    productId: number;
    ruleId?: string | undefined;
};

export type MigrationFingerprintV1 = {
    recordHash: string;
    diskSize: number;
    diskMtimeMs: number;
};

export type RowV1 = {
    id: string;
    name: string;
    available: boolean;
    evidence: string;
    reason?: string | undefined;
};

export type ProjectFileV1 = {
    path: string;
    directory: boolean;
    size: number;
};

export type SearchMatchV1 = {
    path: string;
    line: number;
    text: string;
};

export interface ProjectCatalogV1 {
  /**
   * 签名 / Signature: ProjectCatalogV1.current.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 current 的输入与结果契约，所属容器为 ProjectCatalogV1。
   * Purpose: Declares the input/result contract for current in ProjectCatalogV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: string.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "current": (id: string) => string;
  /**
   * 签名 / Signature: ProjectCatalogV1.key.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 key 的输入与结果契约，所属容器为 ProjectCatalogV1。
   * Purpose: Declares the input/result contract for key in ProjectCatalogV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: string.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "key": (id: string) => string;
  /**
   * 签名 / Signature: ProjectCatalogV1.list.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 list 的输入与结果契约，所属容器为 ProjectCatalogV1。
   * Purpose: Declares the input/result contract for list in ProjectCatalogV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ active: string; projects: { id: string; name: string; }[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "list": (id: string) => Promise<{
    active: string;
    projects: {
        id: string;
        name: string;
    }[];
}>;
  /**
   * 签名 / Signature: ProjectCatalogV1.readCommittedList.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 readCommittedList 的输入与结果契约，所属容器为 ProjectCatalogV1。
   * Purpose: Declares the input/result contract for readCommittedList in ProjectCatalogV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ active: string; projects: { id: string; name: string; }[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "readCommittedList": (id: string) => Promise<{
    active: string;
    projects: {
        id: string;
        name: string;
    }[];
}>;
  /**
   * 签名 / Signature: ProjectCatalogV1.with.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 with 的输入与结果契约，所属容器为 ProjectCatalogV1。
   * Purpose: Declares the input/result contract for with in ProjectCatalogV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; requested: string | null | undefined; action: () => Promise<T>
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "with": <T>(id: string, requested: string | null | undefined, action: () => Promise<T>) => Promise<T>;
  /**
   * 签名 / Signature: ProjectCatalogV1.inScope.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 inScope 的输入与结果契约，所属容器为 ProjectCatalogV1。
   * Purpose: Declares the input/result contract for inScope in ProjectCatalogV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; projectId: string; action: () => T
   * 输出 / Returns: T.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "inScope": <T>(id: string, projectId: string, action: () => T) => T;
  /**
   * 签名 / Signature: ProjectCatalogV1.create.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 create 的输入与结果契约，所属容器为 ProjectCatalogV1。
   * Purpose: Declares the input/result contract for create in ProjectCatalogV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; name: string; initialize: () => Promise<void>
   * 输出 / Returns: Promise<{ active: string; projects: { id: string; name: string; }[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "create": (id: string, name: string, initialize: () => Promise<void>) => Promise<{
    active: string;
    projects: {
        id: string;
        name: string;
    }[];
}>;
  /**
   * 签名 / Signature: ProjectCatalogV1.update.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 update 的输入与结果契约，所属容器为 ProjectCatalogV1。
   * Purpose: Declares the input/result contract for update in ProjectCatalogV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; project: string; name: string | undefined optional
   * 输出 / Returns: Promise<{ active: string; projects: { id: string; name: string; }[]; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "update": (id: string, project: string, name?: string | undefined) => Promise<{
    active: string;
    projects: {
        id: string;
        name: string;
    }[];
}>;
}

export type ResolvedDependencyAuthenticationV1 = {
    endpoint: string;
    authorization: string;
    privateValues: string[];
};

export type ProjectRuntimeV1 = {
    status: string;
    log: string;
    services?: {
        name: string;
        status: string;
        log: string;
    }[] | undefined;
    main?: {
        status: string;
    } | undefined;
};

export type RuntimeProbeStateV1 = "failed" | "running" | "stale" | "unprobed" | "cached";

export type SandboxViewV1 = {
    name: string;
    memoryMiB: number;
    cpus: number;
    diskGiB: number;
    accelerator: "auto" | "tcg" | "whpx";
    forwards: {
        host: number;
        guest: number;
        name?: string | undefined;
    }[];
    storagePoolId?: string | undefined;
    firmware?: "bios" | "uefi" | undefined;
    distro?: "alpine" | "debian" | "ubuntu" | undefined;
    architecture?: "x86_64" | "aarch64" | undefined;
    template?: "none" | "node" | "python" | "rust" | undefined;
    hardware?: {
        cpu?: {
            sockets: number;
            cores: number;
            threads: number;
            numa?: {
                memoryMiB: number;
                cpus: number[];
            }[] | undefined;
        } | undefined;
        devices?: {
            graphics: "none" | "virtio-gpu" | "virgl";
            networkCard: "virtio-net-pci" | "e1000";
            randomDevice: boolean;
            balloon: boolean;
            diskCache: "none" | "writeback" | "writethrough";
            discard: boolean;
            graphicsOutputs?: number | undefined;
            graphicsWidth?: number | undefined;
            graphicsHeight?: number | undefined;
            graphicsMemoryMiB?: number | undefined;
            audio?: "none" | "hda-duplex" | undefined;
            audioBackend?: "none" | "dsound" | undefined;
        } | undefined;
        memory?: {
            maxMiB: number;
            slots: number;
        } | undefined;
        ipv6?: boolean | undefined;
    } | undefined;
} & {
    id: string;
    diskEncryption?: import("../../shared/contracts/vm.ts").DiskEncryptionConfig | undefined;
    sandbox?: {
        network: "isolated" | "nat";
        expiresAt: string;
        onExpire: "stop" | "delete";
        storage?: "persistent" | "discard-on-stop" | undefined;
    } | undefined;
    rescueOf?: string | undefined;
    createdAt: string;
    snapshots: import("../../shared/contracts/vm.ts").Snapshot[];
    bootstrapped?: boolean | undefined;
    lastUsedAt?: string | undefined;
    lastError?: string | undefined;
    organization?: {
        group: string;
        tags: string[];
        favorite: boolean;
    } | undefined;
    pendingResize?: boolean | undefined;
    migrationOrigin?: {
        sourceHostId: string;
        transferId: string;
        targetName: string;
        sourceVmId?: string | undefined;
        snapshotId?: string | undefined;
        diskSha256?: string | undefined;
    } | undefined;
    haPromotion?: {
        peerId: string;
        targetHostId: string;
        transferId: string;
        remoteVmId: string;
        snapshotId: string;
        sha256: string;
        fencedAt: string;
        status: "fenced" | "accepted";
        updatedAt: string;
        error?: string | undefined;
    } | undefined;
    haRetirement?: {
        sourceHostId: string;
        transferId: string;
        sourceVmId: string;
        snapshotId: string;
        sha256: string;
        retiredAt: string;
    } | undefined;
    haWitnessEnrollment?: {
        targetHostId: string;
        failureThreshold: number;
        registeredAt: string;
    } | undefined;
    liveMigrationFence?: import('../../shared/contracts/vm.ts').LiveMigrationFence | undefined;
    liveMigrationOrigin?: import('../../shared/contracts/vm.ts').LiveMigrationOrigin | undefined;
    branchOrigin?: {
        sourceVmId: string;
        snapshotId: string;
        createdAt: string;
    } | undefined;
    mergeOrigin?: {
        branchVmId: string;
        targetVmId: string;
        snapshotId: string;
        path: string;
        mergedAt: string;
        appliedFiles: number;
    } | undefined;
} & {
    activeAccelerator?: "tcg" | "whpx" | undefined;
    memoryTargetMiB?: number | undefined;
    status: import("../../shared/contracts/vm.ts").VMStatus;
    poweredOn: boolean;
    startedAt?: string | undefined;
    diskBytes: number;
} & {
    sandbox: {
        network: "isolated" | "nat";
        expiresAt: string;
        onExpire: "stop" | "delete";
        storage?: "persistent" | "discard-on-stop" | undefined;
    };
    expired: boolean;
};

export type SandboxOverviewV1 = {
    sandboxes: SandboxViewV1[];
    runs: import("../../shared/contracts/jobs.ts").JobView[];
    persistenceError?: string | undefined;
};

export type SecretRotationItemV1 = {
    name: string;
    lastChangedAt: string;
    policy: {
        enabled: boolean;
        maxAgeDays: number;
        remindBeforeDays: number;
    };
    ageDays: number | null;
    dueAt: string | null;
    daysRemaining: number | null;
    status: "unknown" | "current" | "disabled" | "due-soon" | "overdue";
};

export type HealthViewV1 = {
    name: string;
    desired: boolean;
    status: "stopped" | "healthy" | "unhealthy" | "waiting" | "restarting" | "exhausted";
    failures: number;
    restarts: number;
    checkedAt?: string | undefined;
    nextCheck: number;
    error?: string | undefined;
};

export interface StorageRuntimeV1 {
  /**
   * 签名 / Signature: StorageRuntimeV1.acquire.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 acquire 的输入与结果契约，所属容器为 StorageRuntimeV1。
   * Purpose: Declares the input/result contract for acquire in StorageRuntimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: request: StorageRequestV1
   * 输出 / Returns: Promise<{ id: string; release: () => void; assertActive: (checkSignal?: boolean) => void; reserveTemporary: (path: string, bytes: number) => Promise<void>; releaseTemporary: (….
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "acquire": (request: StorageRequestV1) => Promise<{
    id: string;
    /**
     * 签名 / Signature: StorageRuntimeV1.release.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 release 的输入与结果契约，所属容器为 StorageRuntimeV1。
     * Purpose: Declares the input/result contract for release in StorageRuntimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    release: () => void;
    /**
     * 签名 / Signature: StorageRuntimeV1.assertActive.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 assertActive 的输入与结果契约，所属容器为 StorageRuntimeV1。
     * Purpose: Declares the input/result contract for assertActive in StorageRuntimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: checkSignal: boolean optional
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    assertActive: (checkSignal?: boolean) => void;
    /**
     * 签名 / Signature: StorageRuntimeV1.reserveTemporary.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 reserveTemporary 的输入与结果契约，所属容器为 StorageRuntimeV1。
     * Purpose: Declares the input/result contract for reserveTemporary in StorageRuntimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: path: string; bytes: number
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    reserveTemporary: (path: string, bytes: number) => Promise<void>;
    /**
     * 签名 / Signature: StorageRuntimeV1.releaseTemporary.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 releaseTemporary 的输入与结果契约，所属容器为 StorageRuntimeV1。
     * Purpose: Declares the input/result contract for releaseTemporary in StorageRuntimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: path: string
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    releaseTemporary: (path: string) => Promise<void>;
    /**
     * 签名 / Signature: StorageRuntimeV1.cleanupPending.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 cleanupPending 的输入与结果契约，所属容器为 StorageRuntimeV1。
     * Purpose: Declares the input/result contract for cleanupPending in StorageRuntimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: error: unknown
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    cleanupPending: (error: unknown) => void;
    readonly pendingCleanup: boolean;
    /**
     * 签名 / Signature: StorageRuntimeV1.transfer.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 transfer 的输入与结果契约，所属容器为 StorageRuntimeV1。
     * Purpose: Declares the input/result contract for transfer in StorageRuntimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: owner: string
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    transfer: (owner: string) => void;
}>;
  /**
   * 签名 / Signature: StorageRuntimeV1.run.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 run 的输入与结果契约，所属容器为 StorageRuntimeV1。
   * Purpose: Declares the input/result contract for run in StorageRuntimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: request: StorageRequestV1; work: (lease: { id: string; release: () => void; assertActive: (checkSignal?: boolean) => v…
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "run": <T>(request: StorageRequestV1, work: (lease: {
    id: string;
    /**
     * 签名 / Signature: StorageRuntimeV1.release.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 release 的输入与结果契约，所属容器为 StorageRuntimeV1。
     * Purpose: Declares the input/result contract for release in StorageRuntimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    release: () => void;
    /**
     * 签名 / Signature: StorageRuntimeV1.assertActive.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 assertActive 的输入与结果契约，所属容器为 StorageRuntimeV1。
     * Purpose: Declares the input/result contract for assertActive in StorageRuntimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: checkSignal: boolean optional
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    assertActive: (checkSignal?: boolean) => void;
    /**
     * 签名 / Signature: StorageRuntimeV1.reserveTemporary.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 reserveTemporary 的输入与结果契约，所属容器为 StorageRuntimeV1。
     * Purpose: Declares the input/result contract for reserveTemporary in StorageRuntimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: path: string; bytes: number
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    reserveTemporary: (path: string, bytes: number) => Promise<void>;
    /**
     * 签名 / Signature: StorageRuntimeV1.releaseTemporary.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 releaseTemporary 的输入与结果契约，所属容器为 StorageRuntimeV1。
     * Purpose: Declares the input/result contract for releaseTemporary in StorageRuntimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: path: string
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    releaseTemporary: (path: string) => Promise<void>;
    /**
     * 签名 / Signature: StorageRuntimeV1.cleanupPending.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 cleanupPending 的输入与结果契约，所属容器为 StorageRuntimeV1。
     * Purpose: Declares the input/result contract for cleanupPending in StorageRuntimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: error: unknown
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    cleanupPending: (error: unknown) => void;
    readonly pendingCleanup: boolean;
    /**
     * 签名 / Signature: StorageRuntimeV1.transfer.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 transfer 的输入与结果契约，所属容器为 StorageRuntimeV1。
     * Purpose: Declares the input/result contract for transfer in StorageRuntimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: owner: string
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    transfer: (owner: string) => void;
}) => Promise<T>) => Promise<T>;
}

export type SyncHistoryViewV1 = Pick<{
    id: string;
    createdAt: string;
    host: string;
    guest: string;
    status: "failed" | "done" | "pending" | "rolled-back";
    bytes: number;
    entries: {
        side: "host" | "guest";
        path: string;
        before: {
            sha: string;
            mode: number;
            uid?: number | undefined;
            gid?: number | undefined;
        } | null;
        after: string | null;
    }[];
    state: string | null;
    base: string | null;
    error?: string | undefined;
    afterState?: string | null | undefined;
    afterBase?: string | null | undefined;
}, "error" | "id" | "bytes" | "status" | "createdAt"> & {
    changes: number;
};

export type SyncWatchViewV1 = {
    host: "watching" | "polling";
    guest: "watching" | "polling" | "offline";
    reason?: string | undefined;
    lastEvent?: string | undefined;
};

export type SyncPreviewV1 = {
    token: string;
    changes: SyncChangeV1[];
    unchanged: number;
};

export type SyncDecisionsV1 = {
    [x: string]: "push" | "pull" | "skip" | "merge" | "both" | "manual" | "delete-host" | "delete-guest" | "restore-host" | "restore-guest";
};

export type SyncManualMergesV1 = {
    [x: string]: string;
};

export interface ProjectPreparationV1 {
  readonly "workspaces": Readonly<Pick<WorkspacesV1, "view" | "jobs" | "projects" | "beforeAction" | "onConfigChange" | "beforeConfigChange" | "config" | "readCommittedConfig" | "networkEnvironment" | "dependencyDownloadAuthentication" | "repositoryDownloadAuthentication" | "resolvedConfig" | "resolveProject" | "save" | "run" | "runPrepared" | "runtime" | "metrics">>;
  readonly "signal": AbortSignal;
  /**
   * 签名 / Signature: ProjectPreparationV1.serial.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 serial 的输入与结果契约，所属容器为 ProjectPreparationV1。
   * Purpose: Declares the input/result contract for serial in ProjectPreparationV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; signal: AbortSignal; action: (signal: AbortSignal) => Promise<T>
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "serial": <T>(id: string, signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  /**
   * 签名 / Signature: ProjectPreparationV1.hasTerminal.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 hasTerminal 的输入与结果契约，所属容器为 ProjectPreparationV1。
   * Purpose: Declares the input/result contract for hasTerminal in ProjectPreparationV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: vmId: string; terminalId: string
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "hasTerminal": (vmId: string, terminalId: string) => boolean;
  /**
   * 签名 / Signature: ProjectPreparationV1.prepare.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 prepare 的输入与结果契约，所属容器为 ProjectPreparationV1。
   * Purpose: Declares the input/result contract for prepare in ProjectPreparationV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; projectId: string | null | undefined; signal: AbortSignal | undefined; options: { task: boolean; readOnly?: boolean | undefined; verifyOnly?: boolean | undefined; }; action: (context: PreparationContextV1) => Promise<T>
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "prepare": <T>(id: string, projectId: string | null | undefined, signal: AbortSignal | undefined, options: {
    task: boolean;
    readOnly?: boolean | undefined;
    verifyOnly?: boolean | undefined;
}, action: (context: PreparationContextV1) => Promise<T>) => Promise<T>;
  /**
   * 签名 / Signature: ProjectPreparationV1.retain.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 retain 的输入与结果契约，所属容器为 ProjectPreparationV1。
   * Purpose: Declares the input/result contract for retain in ProjectPreparationV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: context: PreparationContextV1; task: boolean; terminalId: string | undefined optional; stop: (() => Promise<void>) | undefined optional
   * 输出 / Returns: () => void | Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "retain": (context: PreparationContextV1, task: boolean, terminalId?: string | undefined, stop?: (() => Promise<void>) | undefined) => () => void | Promise<void>;
  /**
   * 签名 / Signature: ProjectPreparationV1.prepareTask.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 prepareTask 的输入与结果契约，所属容器为 ProjectPreparationV1。
   * Purpose: Declares the input/result contract for prepareTask in ProjectPreparationV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string; projectId: string | null | undefined; signal: AbortSignal | undefined optional; options: { verifyOnly?: boolean | undefined; } optional
   * 输出 / Returns: Promise<PreparedProjectV1>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "prepareTask": (id: string, projectId: string | null | undefined, signal?: AbortSignal | undefined, options?: {
    verifyOnly?: boolean | undefined;
}) => Promise<PreparedProjectV1>;
  /**
   * 签名 / Signature: ProjectPreparationV1.close.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 close 的输入与结果契约，所属容器为 ProjectPreparationV1。
   * Purpose: Declares the input/result contract for close in ProjectPreparationV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "close": () => Promise<void>;
}

export type PreparedProjectV1 = {
    command: string;
    projectId: string;
    networkIsolation: string;
    terminalId?: string | undefined;
    /**
     * 签名 / Signature: PreparedProjectV1.release.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 release 的输入与结果契约，所属容器为 PreparedProjectV1。
     * Purpose: Declares the input/result contract for release in PreparedProjectV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: void | Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    release: () => void | Promise<void>;
    signal?: AbortSignal | undefined;
    captured?: {
        project: ProjectV1;
        configVersion: string;
        live: Readonly<Pick<LiveV1, "error" | "accelerator" | "status" | "incoming" | "startedAt" | "sshPort" | "qmpPort" | "agentPort" | "serialPort" | "memoryTargetMiB">> & {
            readonly abort: Readonly<Pick<AbortController, "signal">>;
        };
        identity?: Readonly<{
            vmId: string;
            vmProcessId: string;
            executionGeneration: string;
            bootId?: string | undefined;
            networkGeneration?: string | undefined;
        }> | undefined;
    } | undefined;
};

export type StreamDownloadV1 = {
    bytes: number;
    /**
     * 签名 / Signature: StreamDownloadV1.write.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 write 的输入与结果契约，所属容器为 StreamDownloadV1。
     * Purpose: Declares the input/result contract for write in StreamDownloadV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: output: import("stream").Writable; signal: AbortSignal
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    write: (output: import("stream").Writable, signal: AbortSignal) => Promise<void>;
};

export type DownloadTargetV1 = ({
    type: "file";
    path: string;
} | {
    type: "export";
} | {
    type: "local";
    path: string;
} | ({
    type: "stream";
} & StreamDownloadV1)) & {
    id: string;
    name: string;
};

export type PrincipalV1 = Pick<{
    id: string;
    username: string;
    role: "member" | "owner" | "viewer";
    credential: {
        salt: string;
        hash: string;
    };
    vmIds: string[];
    expiresAt: number | null;
    createdAt: string;
    passkeys: {
        id: string;
        publicKey: string;
        counter: number;
        transports: string[];
        name: string;
        createdAt: string;
        lastUsedAt?: string | undefined;
    }[];
}, "id" | "username" | "role" | "vmIds"> & {
    expiresAt: number;
};

export type ObservationV1 = {
    at: string;
    totalMiB: number;
    availableMiB: number;
    targetMiB: number;
    decision: "restore" | "shrink" | "hold" | "disabled";
    reason: string;
    error?: string | undefined;
};

export type HostMountObservationV1 = {
    at: string;
    mounted: boolean;
    error?: string | undefined;
};

export type VirtioFsObservationV1 = {
    at: string;
    mounted: boolean;
    error?: string | undefined;
};

export type TrustedBootFilesV1 = {
    enabled: boolean;
    files: {
        name: string;
        data: Buffer<ArrayBufferLike>;
    }[];
};

export type GpuBackendSupportV1 = {
    available: boolean;
    reason?: string | undefined;
};

export type MigrationChannelV1 = "state" | "disk";

export type HostPeersObservationV1 = {
    status?: {
        version: 1;
        id: string;
        name: string;
        platform: string;
        arch: string;
        cpus: number;
        memoryTotal: number;
        memoryFree: number;
        load: number[];
        vmCount: number;
        runningVms: number;
        checkedAt: string;
    } | undefined;
    error?: string | undefined;
    checkedAt: number;
    lastSuccessAt?: number | undefined;
};

export type PrepareInputV1 = {
    requesterId: string;
    transferId: string;
    sourceVmId: string;
    completionProtocol?: 1;
    config: {
        name: string;
        memoryMiB: number;
        cpus: number;
        diskGiB: number;
        accelerator: "auto" | "tcg" | "whpx";
        forwards: {
            host: number;
            guest: number;
            name?: string | undefined;
        }[];
        storagePoolId?: string | undefined;
        firmware?: "bios" | "uefi" | undefined;
        distro?: "alpine" | "debian" | "ubuntu" | undefined;
        architecture?: "x86_64" | "aarch64" | undefined;
        template?: "none" | "node" | "python" | "rust" | undefined;
        hardware?: {
            cpu?: {
                sockets: number;
                cores: number;
                threads: number;
                numa?: {
                    memoryMiB: number;
                    cpus: number[];
                }[] | undefined;
            } | undefined;
            devices?: {
                graphics: "none" | "virtio-gpu" | "virgl";
                networkCard: "virtio-net-pci" | "e1000";
                randomDevice: boolean;
                balloon: boolean;
                diskCache: "none" | "writeback" | "writethrough";
                discard: boolean;
                graphicsOutputs?: number | undefined;
                graphicsWidth?: number | undefined;
                graphicsHeight?: number | undefined;
                graphicsMemoryMiB?: number | undefined;
                audio?: "none" | "hda-duplex" | undefined;
                audioBackend?: "none" | "dsound" | undefined;
            } | undefined;
            memory?: {
                maxMiB: number;
                slots: number;
            } | undefined;
            ipv6?: boolean | undefined;
        } | undefined;
    };
    key: string;
    seed: Buffer<ArrayBufferLike>;
    projects?: {
        active: string;
        projects: {
            id: string;
            name: string;
        }[];
        configs: Record<string, {
            directory: string;
            template: "none" | "node" | "python" | "rust";
            repository: string;
            setup: string;
            command: string;
            previewPort?: number | undefined;
            networkIsolation?: "host" | "private" | undefined;
            environment?: Record<string, string> | undefined;
            secrets?: Record<string, string> | undefined;
            runtimes?: {
                python?: string | undefined;
                node?: string | undefined;
            } | undefined;
            services?: {
                name: string;
                command: string;
                dependsOn: string[];
                ready: string;
                timeout: number;
                environment?: Record<string, string> | undefined;
                secrets?: Record<string, string> | undefined;
                health?: {
                    command: string;
                    interval: number;
                    timeout: number;
                    failures: number;
                    restart: boolean;
                    maxRestarts: number;
                    backoff: number;
                } | undefined;
            }[] | undefined;
        }>;
    } | undefined;
    organization?: {
        group: string;
        tags: string[];
        favorite: boolean;
    } | undefined;
};

export type NotebookResponseV1 = {
    ready: boolean;
    executed: boolean;
    message: string;
    installed?: boolean | undefined;
    projectId?: string | undefined;
    provider?: "jupyter" | "marimo" | undefined;
    session?: {
        provider: "jupyter" | "marimo";
        status: string;
        hostPort: number;
        guestPort: number;
        directory?: string | undefined;
        startedAt?: string | undefined;
        needsReview?: boolean | undefined;
    } | null | undefined;
};

export type AutomationViewV1 = {
    rules: {
        name: string;
        enabled: boolean;
        previewOnly: boolean;
        filter: {
            types: ("job.finished" | "alert.raised")[];
            vmIds: string[];
            projectIds: string[];
            tags: string[];
            statuses: ("error" | "cancelled" | "interrupted" | "done")[];
            kinds: ("cpu" | "memory" | "secret" | "backup" | "disk" | "service" | "task")[];
        };
        action: "start" | "stop" | "suspend" | "resume" | "runbook";
        steps: {
            name: string;
            command: string;
            timeout: number;
        }[];
        cooldownSeconds: number;
        id: string;
        version: number;
        createdAt: number;
        activeSince: number;
        updatedAt: number;
    }[];
    executions: {
        id: string;
        ruleId: string;
        ruleVersion: number;
        eventId: string;
        action: "start" | "stop" | "suspend" | "resume" | "runbook";
        status: "failed" | "done" | "preview" | "pending" | "skipped";
        startedAt: number;
        vmId?: string | undefined;
        finishedAt?: number | undefined;
        reason?: string | undefined;
        steps?: {
            name: string;
            code: number;
        }[] | undefined;
    }[];
    error?: string | undefined;
    collecting: boolean;
    limits: {
        rules: number;
        history: number;
        observed: number;
        dailyActions: number;
    };
};

export type ItemV1 = {
    name: string;
    version: string;
    description?: string | undefined;
    installedVersion?: string | undefined;
    availableVersion?: string | undefined;
};

export type FamilyV1 = "iptables" | "ip6tables";

export type VulnerabilityMatchV1 = PackageVersionV1 & {
    ids: string[];
};

export type StorageRequestV1 = {
    owner: string;
    taskId: string;
    label: string;
    paths: readonly string[];
    mode: "write" | "read";
    transfer?: "outbound" | undefined;
    buffers: number;
    files: number;
    temporary?: readonly {
        path: string;
        bytes: number;
    }[] | undefined;
    temporaryPhases?: readonly (readonly {
        path: string;
        bytes: number;
    }[])[] | undefined;
    dynamicTemporary?: readonly string[] | undefined;
    lane?: "interactive" | "background" | "control" | undefined;
    signal?: AbortSignal | undefined;
    timeoutMs?: number | undefined;
};

export type SyncChangeV1 = {
    path: string;
    from?: string | undefined;
    driver?: "manual" | "keep-both" | "prefer-host" | "prefer-guest" | "merge-text" | undefined;
    suggestedDecision?: "push" | "pull" | "skip" | "merge" | "both" | undefined;
    action: "push" | "pull" | "skip" | "delete-host" | "delete-guest" | "conflict" | "mkdir-host" | "mkdir-guest" | "rename-host" | "rename-guest";
};

export type PreparationContextV1 = {
    id: string;
    scope: string;
    project: ProjectV1;
    version: string;
    live: Readonly<Pick<LiveV1, "error" | "accelerator" | "status" | "incoming" | "startedAt" | "sshPort" | "qmpPort" | "agentPort" | "serialPort" | "memoryTargetMiB">> & {
        readonly abort: Readonly<Pick<AbortController, "signal">>;
    };
    abort: AbortSignal;
    identity?: Readonly<{
        vmId: string;
        vmProcessId: string;
        executionGeneration: string;
        bootId?: string | undefined;
        networkGeneration?: string | undefined;
    }> | undefined;
};

export type LiveV1 = {
    lifetime?: VmLifetimeV1 | undefined;
    status: import("../../shared/contracts/vm.ts").VMStatus;
    incoming?: boolean | undefined;
    accelerator: "tcg" | "whpx";
    startedAt: string;
    sshPort: number;
    qmpPort: number;
    agentPort: number;
    serialPort: number;
    network?: VmNetworkLeaseV1 | undefined;
    abort: AbortController;
    bootAbort: AbortController;
    bootstrapKnown?: boolean | undefined;
    serialConnected?: boolean | undefined;
    serialReady?: boolean | undefined;
    serialTail?: string | undefined;
    done: Promise<void>;
    bootDone?: Promise<void> | undefined;
    allowInitialReset?: boolean | undefined;
    serial?: import("net").Socket | undefined;
    clients: Set<import("ssh2").Client>;
    memoryTargetMiB?: number | undefined;
    error?: string | undefined;
};

export type PackageVersionV1 = {
    name: string;
    version: string;
};

export interface VmLifetimeV1 {
  readonly "vmProcessId": `${string}-${string}-${string}-${string}-${string}`;
  readonly "resources": ResourceScopeV1;
  readonly "vmId": string;
  readonly "abort": AbortController;
  readonly "signal": AbortSignal;
  readonly "lastObservedBootId": string | undefined;
  readonly "active": number;
  readonly "admitting": boolean;
  /**
   * 签名 / Signature: VmLifetimeV1.capture.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 capture 的输入与结果契约，所属容器为 VmLifetimeV1。
   * Purpose: Declares the input/result contract for capture in VmLifetimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Readonly<{ vmId: string; vmProcessId: string; executionGeneration: string; bootId?: string | undefined; networkGeneration?: string | undefined; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "capture": () => Readonly<{
    vmId: string;
    vmProcessId: string;
    executionGeneration: string;
    bootId?: string | undefined;
    networkGeneration?: string | undefined;
}>;
  /**
   * 签名 / Signature: VmLifetimeV1.assert.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 assert 的输入与结果契约，所属容器为 VmLifetimeV1。
   * Purpose: Declares the input/result contract for assert in VmLifetimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: identity: Readonly<{ vmId: string; vmProcessId: string; executionGeneration: string; bootId?: s…
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "assert": (identity: Readonly<{
    vmId: string;
    vmProcessId: string;
    executionGeneration: string;
    bootId?: string | undefined;
    networkGeneration?: string | undefined;
}>) => void;
  /**
   * 签名 / Signature: VmLifetimeV1.observeBoot.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 observeBoot 的输入与结果契约，所属容器为 VmLifetimeV1。
   * Purpose: Declares the input/result contract for observeBoot in VmLifetimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: bootId: string
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "observeBoot": (bootId: string) => void;
  /**
   * 签名 / Signature: VmLifetimeV1.advanceExecution.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 advanceExecution 的输入与结果契约，所属容器为 VmLifetimeV1。
   * Purpose: Declares the input/result contract for advanceExecution in VmLifetimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Readonly<{ vmId: string; vmProcessId: string; executionGeneration: string; bootId?: string | undefined; networkGeneration?: string | undefined; }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "advanceExecution": () => Readonly<{
    vmId: string;
    vmProcessId: string;
    executionGeneration: string;
    bootId?: string | undefined;
    networkGeneration?: string | undefined;
}>;
  /**
   * 签名 / Signature: VmLifetimeV1.setNetwork.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 setNetwork 的输入与结果契约，所属容器为 VmLifetimeV1。
   * Purpose: Declares the input/result contract for setNetwork in VmLifetimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: lease: VmNetworkLeaseV1
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "setNetwork": (lease: VmNetworkLeaseV1) => Promise<void>;
  /**
   * 签名 / Signature: VmLifetimeV1.own.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 own 的输入与结果契约，所属容器为 VmLifetimeV1。
   * Purpose: Declares the input/result contract for own in VmLifetimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: name: string; resource: T; order: number optional
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "own": <T extends {
    /**
     * 签名 / Signature: VmLifetimeV1.T.close.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 close 的输入与结果契约，所属容器为 VmLifetimeV1.T。
     * Purpose: Declares the input/result contract for close in VmLifetimeV1.T. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: unknown.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    close(): unknown;
}>(name: string, resource: T, order?: number) => Promise<T>;
  /**
   * 签名 / Signature: VmLifetimeV1.enter.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 enter 的输入与结果契约，所属容器为 VmLifetimeV1。
   * Purpose: Declares the input/result contract for enter in VmLifetimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: identity: Readonly<{ vmId: string; vmProcessId: string; executionGeneration: string; bootId?: s… optional; options: { persistent?: boolean | undefined; } optional
   * 输出 / Returns: { signal: AbortSignal; release: () => void; cleanupPending: (error: unknown) => void; }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "enter": (identity?: Readonly<{
    vmId: string;
    vmProcessId: string;
    executionGeneration: string;
    bootId?: string | undefined;
    networkGeneration?: string | undefined;
}>, options?: {
    persistent?: boolean | undefined;
}) => {
    signal: AbortSignal;
    /**
     * 签名 / Signature: VmLifetimeV1.release.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 release 的输入与结果契约，所属容器为 VmLifetimeV1。
     * Purpose: Declares the input/result contract for release in VmLifetimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    release: () => void;
    /**
     * 签名 / Signature: VmLifetimeV1.cleanupPending.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 cleanupPending 的输入与结果契约，所属容器为 VmLifetimeV1。
     * Purpose: Declares the input/result contract for cleanupPending in VmLifetimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: error: unknown
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    cleanupPending: (error: unknown) => void;
};
  /**
   * 签名 / Signature: VmLifetimeV1.exclusive.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 exclusive 的输入与结果契约，所属容器为 VmLifetimeV1。
   * Purpose: Declares the input/result contract for exclusive in VmLifetimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: work: () => Promise<T>; allowFailed: boolean optional
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "exclusive": <T>(work: () => Promise<T>, allowFailed?: boolean) => Promise<T>;
  /**
   * 签名 / Signature: VmLifetimeV1.barrier.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 barrier 的输入与结果契约，所属容器为 VmLifetimeV1。
   * Purpose: Declares the input/result contract for barrier in VmLifetimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: work: () => Promise<T>; cancel: boolean optional; allowFailed: boolean optional
   * 输出 / Returns: Promise<T>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "barrier": <T>(work: () => Promise<T>, cancel?: boolean, allowFailed?: boolean) => Promise<T>;
  /**
   * 签名 / Signature: VmLifetimeV1.end.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 end 的输入与结果契约，所属容器为 VmLifetimeV1。
   * Purpose: Declares the input/result contract for end in VmLifetimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: reason: unknown optional
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "end": (reason?: unknown) => void;
  /**
   * 签名 / Signature: VmLifetimeV1.close.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 close 的输入与结果契约，所属容器为 VmLifetimeV1。
   * Purpose: Declares the input/result contract for close in VmLifetimeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "close": () => Promise<void>;
}

export type VmNetworkLeaseV1 = {
    readonly vmId: string;
    readonly generation: string;
    readonly netdev: string;
    readonly policy: Readonly<{
        isolated: boolean;
        ipv6: boolean;
        forwards: readonly {
            host: number;
            guest: number;
        }[];
    }>;
    readonly signal: AbortSignal;
    readonly connected: boolean;
    readonly resources?: Readonly<{
        worker: string;
        backend?: string | undefined;
    }> | undefined;
    /**
     * 签名 / Signature: VmNetworkLeaseV1.setConnected.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 setConnected 的输入与结果契约，所属容器为 VmNetworkLeaseV1。
     * Purpose: Declares the input/result contract for setConnected in VmNetworkLeaseV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: connected: boolean
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    setConnected(connected: boolean): Promise<void>;
    /**
     * 签名 / Signature: VmNetworkLeaseV1.forward.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 forward 的输入与结果契约，所属容器为 VmNetworkLeaseV1。
     * Purpose: Declares the input/result contract for forward in VmNetworkLeaseV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: verb: "remove" | "add"; port: { host: number; guest: number; }
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    forward(verb: "remove" | "add", port: {
        host: number;
        guest: number;
    }): Promise<void>;
    /**
     * 签名 / Signature: VmNetworkLeaseV1.renew.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 renew 的输入与结果契约，所属容器为 VmNetworkLeaseV1。
     * Purpose: Declares the input/result contract for renew in VmNetworkLeaseV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: generation: string
     * 输出 / Returns: Promise<VmNetworkLeaseV1>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    renew(generation: string): Promise<VmNetworkLeaseV1>;
    /**
     * 签名 / Signature: VmNetworkLeaseV1.close.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 close 的输入与结果契约，所属容器为 VmNetworkLeaseV1。
     * Purpose: Declares the input/result contract for close in VmNetworkLeaseV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    close(): Promise<void>;
};

export interface ResourceScopeV1 {
  readonly "signal": AbortSignal;
  /**
   * 签名 / Signature: ResourceScopeV1.defer.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 defer 的输入与结果契约，所属容器为 ResourceScopeV1。
   * Purpose: Declares the input/result contract for defer in ResourceScopeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: name: string; dispose: () => unknown; order: number optional; requires: readonly string[] optional
   * 输出 / Returns: () => void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "defer": (name: string, dispose: () => unknown, order?: number, requires?: readonly string[]) => () => void;
  /**
   * 签名 / Signature: ResourceScopeV1.own.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 own 的输入与结果契约，所属容器为 ResourceScopeV1。
   * Purpose: Declares the input/result contract for own in ResourceScopeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: name: string; value: T; order: number optional
   * 输出 / Returns: T.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "own": <T extends {
    /**
     * 签名 / Signature: ResourceScopeV1.T.close.
     * 功能：为维护独立于实现的 V1 公共服务接口声明 close 的输入与结果契约，所属容器为 ResourceScopeV1.T。
     * Purpose: Declares the input/result contract for close in ResourceScopeV1.T. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: unknown.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    close(): unknown;
}>(name: string, value: T, order?: number) => T;
  /**
   * 签名 / Signature: ResourceScopeV1.child.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 child 的输入与结果契约，所属容器为 ResourceScopeV1。
   * Purpose: Declares the input/result contract for child in ResourceScopeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: name: string; order: number optional; owner: string optional
   * 输出 / Returns: ResourceScopeV1.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "child": (name: string, order?: number, owner?: string) => ResourceScopeV1;
  /**
   * 签名 / Signature: ResourceScopeV1.retryCleanup.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 retryCleanup 的输入与结果契约，所属容器为 ResourceScopeV1。
   * Purpose: Declares the input/result contract for retryCleanup in ResourceScopeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "retryCleanup": () => Promise<void>;
  /**
   * 签名 / Signature: ResourceScopeV1.close.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 close 的输入与结果契约，所属容器为 ResourceScopeV1。
   * Purpose: Declares the input/result contract for close in ResourceScopeV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  "close": () => Promise<void>;
}

export interface CapabilityChecksV1 {
  /**
   * 签名 / Signature: CapabilityChecksV1.acmeAllowed.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 acmeAllowed 的输入与结果契约，所属容器为 CapabilityChecksV1。
   * Purpose: Declares the input/result contract for acmeAllowed in CapabilityChecksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  acmeAllowed(): boolean;
  /**
   * 签名 / Signature: CapabilityChecksV1.mutation.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 mutation 的输入与结果契约，所属容器为 CapabilityChecksV1。
   * Purpose: Declares the input/result contract for mutation in CapabilityChecksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: delta: number
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  mutation(delta: number): void;
  /**
   * 签名 / Signature: CapabilityChecksV1.scoreHosts.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 scoreHosts 的输入与结果契约，所属容器为 CapabilityChecksV1。
   * Purpose: Declares the input/result contract for scoreHosts in CapabilityChecksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: ReturnType<HostPeersV1['score']>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  scoreHosts(input: unknown): ReturnType<HostPeersV1['score']>;
  /**
   * 签名 / Signature: CapabilityChecksV1.sharedDesktopCheck.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 sharedDesktopCheck 的输入与结果契约，所属容器为 CapabilityChecksV1。
   * Purpose: Declares the input/result contract for sharedDesktopCheck in CapabilityChecksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ ready: boolean; reason?: string }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  sharedDesktopCheck(id: string): Promise<{ ready: boolean; reason?: string }>;
  /**
   * 签名 / Signature: CapabilityChecksV1.sharedTerminalCheck.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 sharedTerminalCheck 的输入与结果契约，所属容器为 CapabilityChecksV1。
   * Purpose: Declares the input/result contract for sharedTerminalCheck in CapabilityChecksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<{ ready: boolean; reason?: string }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  sharedTerminalCheck(id: string): Promise<{ ready: boolean; reason?: string }>;
  /**
   * 签名 / Signature: CapabilityChecksV1.passkeyCheck.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 passkeyCheck 的输入与结果契约，所属容器为 CapabilityChecksV1。
   * Purpose: Declares the input/result contract for passkeyCheck in CapabilityChecksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { ready: boolean; registered: number; reason?: string }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  passkeyCheck(): { ready: boolean; registered: number; reason?: string };
  /**
   * 签名 / Signature: CapabilityChecksV1.accountModeReady.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 accountModeReady 的输入与结果契约，所属容器为 CapabilityChecksV1。
   * Purpose: Declares the input/result contract for accountModeReady in CapabilityChecksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  accountModeReady(): boolean;
  /**
   * 签名 / Signature: CapabilityChecksV1.mobileCheck.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 mobileCheck 的输入与结果契约，所属容器为 CapabilityChecksV1。
   * Purpose: Declares the input/result contract for mobileCheck in CapabilityChecksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: { ready: boolean; devices: number; reason?: string }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  mobileCheck(): { ready: boolean; devices: number; reason?: string };
  /**
   * 签名 / Signature: CapabilityChecksV1.remoteAuditCheck.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 remoteAuditCheck 的输入与结果契约，所属容器为 CapabilityChecksV1。
   * Purpose: Declares the input/result contract for remoteAuditCheck in CapabilityChecksV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<{ ready: boolean; configured: boolean; anchoredSequence: number; reason?: string }>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  remoteAuditCheck(): Promise<{ ready: boolean; configured: boolean; anchoredSequence: number; reason?: string }>;
}

/** Management access keeps the domain's recovery authority behind its versioned interface. */
export interface RecoveryCatalogV1 {
  /**
   * 签名 / Signature: RecoveryCatalogV1.refresh.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 refresh 的输入与结果契约，所属容器为 RecoveryCatalogV1。
   * Purpose: Declares the input/result contract for refresh in RecoveryCatalogV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<RecoveryView[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  refresh(): Promise<RecoveryView[]>;
  /**
   * 签名 / Signature: RecoveryCatalogV1.view.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 view 的输入与结果契约，所属容器为 RecoveryCatalogV1。
   * Purpose: Declares the input/result contract for view in RecoveryCatalogV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: RecoveryView[].
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  view(): RecoveryView[];
  /**
   * 签名 / Signature: RecoveryCatalogV1.diagnostics.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 diagnostics 的输入与结果契约，所属容器为 RecoveryCatalogV1。
   * Purpose: Declares the input/result contract for diagnostics in RecoveryCatalogV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: RecoveryDiagnostics.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  diagnostics(): RecoveryDiagnostics;
  /**
   * 签名 / Signature: RecoveryCatalogV1.retry.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 retry 的输入与结果契约，所属容器为 RecoveryCatalogV1。
   * Purpose: Declares the input/result contract for retry in RecoveryCatalogV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<RecoveryView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  retry(input: unknown): Promise<RecoveryView>;
  /**
   * 签名 / Signature: RecoveryCatalogV1.rebuild.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 rebuild 的输入与结果契约，所属容器为 RecoveryCatalogV1。
   * Purpose: Declares the input/result contract for rebuild in RecoveryCatalogV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<RecoveryCatalogView>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  rebuild(input: unknown): Promise<RecoveryCatalogView>;
  /**
   * 签名 / Signature: RecoveryCatalogV1.close.
   * 功能：为维护独立于实现的 V1 公共服务接口声明 close 的输入与结果契约，所属容器为 RecoveryCatalogV1。
   * Purpose: Declares the input/result contract for close in RecoveryCatalogV1. Module responsibility: Owns public V1 interfaces independently of implementations; member changes require explicit revision and initialization stays with providers.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  close(): Promise<void>;
}
