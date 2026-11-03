/**
 * 模块职责：汇集自动化功能、指标告警和实例动作，并将后台采样与策略执行交给统一调度。
 * Module purpose: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
 */
import { jsonValueSchema } from '../shared/contracts/json-values.ts';
import type { HostMountsV1, IdeV1, MediaDevicesV1, ProcessInteropV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { AutomationDomainServices } from './automation-domain-services.ts';

import { cleanupReceipt } from './cleanup-receipt.ts';
import { noHostServices, type HostServiceResolver } from './host-service-contracts.ts';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  featureCatalog,
  featureCatalogView,
  implementedFeatureCatalogView,
  resourcePresets,
  type FeatureId,
  type ResourcePresetId,
} from '../shared/catalogs/automation.ts';
import { type JobView } from '../shared/contracts/jobs.ts';
import { AppError } from '../shared/errors.ts';
import { guestPath } from '../shared/paths.ts';
import { inMaintenance } from './automation-policy.ts';
import { observeAvailability, type AvailabilitySpan } from './availability.ts';
import { CapabilityActions } from './capability-actions.ts';
import { capabilityParameters, capabilityViews, hasCapability } from './capability-definitions.ts';
import { withDependencyAuthentication } from './dependency-downloads.ts';
import { requireSuccessfulResult, runEngineeringOperation } from './engineering-runner.ts';
import {
  featureDevTaskOperation,
  runFeatureDevTask,
  type FeatureDevTaskOptions,
} from './feature-suite-dev-task.ts';
import { firmwareSupport } from './firmware.ts';
import { guestTask } from './guest-task.ts';

import { distroInfo } from './images.ts';
import { Jobs } from './jobs.ts';
import { metadataFile } from './metadata-store.ts';
import type { VmAccess as Machines } from './vm-access.ts';

import { packageCacheOperations, packageCacheScript } from './package-cache.ts';
import { PackageWorkbench } from './package-workbench.ts';
import { DATA } from './paths.ts';
import { hostPower, powerDecision, powerPolicy, type PowerSample } from './power-policy.ts';
import { processInteropInput } from './process-interop.ts';
import {
  dependencyManagerSchema,
  projectDependencyCachePlan,
  type ProjectDependencyCachePlan,
} from './project-dependency-cache.ts';
import {
  ensureProjectNetworkScript,
  projectNetworkCheckScript,
  projectNetworkNamespace,
} from './project-network-isolation.ts';
import { type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { resourcePolicy } from './resource-policies.ts';
import type { SecretRotationItem } from './secret-rotation.ts';
import { privateLog, redactValues } from './secrets.ts';
import { scanGuestVulnerabilities } from './security-vulnerabilities.ts';
import type { HealthView } from './service-health.ts';
import { quote } from './shell.ts';

export { featureCatalog,featureCatalogView,implementedFeatureCatalogView,resourcePresets,type FeatureCatalogItem,type FeatureId,type ResourcePreset,type ResourcePresetId } from '../shared/catalogs/automation.ts';

const scheduleSchema = z
  .object({
    enabled: z.boolean().default(false),
    startAt: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    stopAt: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    idleMinutes: z.number().int().min(0).max(10080).default(0),
    idleAction: z.enum(['stop']).default('stop'),
  })
  .strict();
export type Schedule = z.infer<typeof scheduleSchema>;
const alertSchema = z
  .object({
    enabled: z.boolean().default(false),
    cpuPercent: z.number().min(0).max(100).default(90),
    memoryPercent: z.number().min(0).max(100).default(90),
    diskPercent: z.number().min(0).max(100).default(90),
    cooldownMinutes: z.number().int().min(1).max(10080).default(30),
    taskFailures: z.boolean().default(true),
    serviceFailures: z.boolean().default(true),
    secretRotation: z.boolean().default(true),
  })
  .strict();
export type AlertConfig = z.infer<typeof alertSchema>;
export type AlertEvent = {
  id: string;
  vmId: string;
  kind: 'cpu' | 'memory' | 'disk' | 'service' | 'backup' | 'task' | 'secret';
  message: string;
  createdAt: string;
  acknowledged: boolean;
  projectId?: string;
  jobId?: string;
};
export type MetricPoint = {
  sampledAt: string;
  cpuPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
  networkReceivedBytes?: number | null;
  networkTransmittedBytes?: number | null;
  networkReceiveBytesPerSecond?: number | null;
  networkTransmitBytesPerSecond?: number | null;
};
type FeatureState = {
  settings: Record<string, { schedule: Schedule; alerts: AlertConfig; updatedAt: string }>;
  history: Record<string, MetricPoint[]>;
  events: AlertEvent[];
  lastAlerts: Record<string, Record<string, number>>;
  notifiedJobs?: Record<string, string[]>;
  notifiedSecretRotations?: Record<string, Record<string, string>>;
  availability?: Record<string, AvailabilitySpan[]>;
  featureRuns: Record<
    string,
    Array<{ featureId: FeatureId; startedAt: string; finishedAt: string; result: Record<string, unknown> }>
  >;
};

/**
 * 入口 / Entry: defaultState.
 * 功能：从当前输入或状态计算 `({ settings: {}, history: {}, events: [], lastAlerts: {}, featureRuns: {}, })`，供调用方后续验证或使用。
 * Purpose: Computes `({ settings: {}, history: {}, events: [], lastAlerts: {}, featureRuns: {}, })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: FeatureState；结果来自 / values from `({ settings: {}, history: {}, events: [], lastAlerts: {}, featureRuns: {}, })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const defaultState = (): FeatureState => ({
  settings: {},
  history: {},
  events: [],
  lastAlerts: {},
  featureRuns: {},
});

/**
 * 入口 / Entry: defaultSchedule.
 * 功能：把本层请求转交 `scheduleSchema.parse`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `scheduleSchema.parse` and propagates the provider result or rejection.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Schedule；结果来自 / values from `scheduleSchema.parse({})`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const defaultSchedule = (): Schedule => scheduleSchema.parse({});
/**
 * 入口 / Entry: defaultAlerts.
 * 功能：把本层请求转交 `alertSchema.parse`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `alertSchema.parse` and propagates the provider result or rejection.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: AlertConfig；结果来自 / values from `alertSchema.parse({})`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const defaultAlerts = (): AlertConfig => alertSchema.parse({});
const packageName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9+_.-]{0,127}$/, '软件包名称无效')
  .refine((value) => !/[+-]$/.test(value), '软件包名称不能以 + 或 - 结尾');
const searchText = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((v) => !/[\x00-\x1f]/.test(v), '搜索内容包含控制字符');
const hostTarget = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, '目标地址无效');

export type FeatureAction =
  | { action: 'sample' }
  | { action: 'memory-target'; memoryMiB: number }
  | { action: 'apply-preset'; preset: ResourcePresetId }
  | { action: 'disk-analysis'; path?: string }
  | {
      action: 'dev';
      operation:
        | 'test'
        | 'test-discover'
        | 'lint'
        | 'format'
        | 'dependencies'
        | 'lock'
        | 'lock-check'
        | 'install-locked'
        | 'prefetch-dependencies'
        | 'install-cached-dependencies'
        | 'worktree-list'
        | 'worktree-add'
        | 'worktree-remove'
        | 'database';
      branch?: string;
      path?: string;
      database?: 'postgres' | 'redis' | 'mysql';
      name?: string;
      port?: number;
      password?: string;
      manager?: 'npm' | 'pip';
    }
  | { action: 'search'; query: string; path?: string; content?: boolean }
  | { action: 'package'; operation: 'list' | 'search' | 'install' | 'remove' | 'update' |
      'upgrade' | 'upgrade-all' |
      'cache-list' | 'cache-prefetch' | 'cache-install' | 'cache-clear'; name?: string }
  | { action: 'network-test'; target: string }
  | { action: 'security-scan' }
  | { action: 'discover-ports' }
  | { action: 'acknowledge'; id: string }
  | { action: 'feature-check'; featureId: FeatureId }
  | { action: 'feature-run'; featureId: FeatureId; options?: Record<string, unknown> };

export const featureSuiteUpdateRequest = z
      .object({ schedule: scheduleSchema.optional(), alerts: alertSchema.optional() })
      .strict();

export const featureSuiteActionRequest = z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('sample') }).strict(),
        z
          .object({ action: z.literal('memory-target'), memoryMiB: z.number().int().min(256).max(8192) })
          .strict(),
        z
          .object({
            action: z.literal('apply-preset'),
            preset: z.enum(['light', 'development', 'build', 'desktop']),
          })
          .strict(),
        z.object({ action: z.literal('disk-analysis'), path: z.string().optional() }).strict(),
        z
          .object({
            action: z.literal('dev'),
            operation: z.enum([
              'test',
              'test-discover',
              'lint',
              'format',
              'dependencies',
              'lock',
              'lock-check',
              'install-locked',
              'prefetch-dependencies',
              'install-cached-dependencies',
              'worktree-list',
              'worktree-add',
              'worktree-remove',
              'database',
            ]),
            branch: z.string().optional(),
            path: z.string().optional(),
            database: z.enum(['postgres', 'redis', 'mysql']).optional(),
            name: z.string().optional(),
            port: z.number().int().min(1024).max(65535).optional(),
            password: z.string().optional(),
            manager: dependencyManagerSchema.optional(),
          })
          .strict(),
        z
          .object({
            action: z.literal('search'),
            query: z.string(),
            path: z.string().optional(),
            content: z.boolean().optional(),
          })
          .strict(),
        z
          .object({
            action: z.literal('package'),
            operation: z.enum(['list', 'search', 'install', 'remove', 'update',
              ...packageCacheOperations]),
            name: z.string().optional(),
          })
          .strict(),
        z.object({ action: z.literal('network-test'), target: z.string() }).strict(),
        z.object({ action: z.literal('security-scan') }).strict(),
        z.object({ action: z.literal('discover-ports') }).strict(),
        z.object({ action: z.literal('acknowledge'), id: z.string().min(1).max(160) }).strict(),
        z
          .object({
            action: z.literal('feature-check'),
            featureId: z.enum(featureCatalog.map(([id]) => id) as [FeatureId, ...FeatureId[]]),
          })
          .strict(),
        z
          .object({
            action: z.literal('feature-run'),
            featureId: z.enum(featureCatalog.map(([id]) => id) as [FeatureId, ...FeatureId[]]),
            options: z.record(z.string(), jsonValueSchema).default({}),
          })
          .strict(),
      ]);

export class FeatureSuite {
  jobs = new Jobs('feature-suite');
  private backgroundEnabled = false;
  private closed = false;
  private idleSince = new Map<string, number>();
  private lastSampleAt = new Map<string, number>();
  private ticking = false;
  private powerAbort = new AbortController();
  /**
   * 入口 / Entry: FeatureSuite.processInterop.
   * 功能：向调用者提供 `this.domains.processInterop` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.domains.processInterop` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: ProcessInteropV1 | undefined；结果来自 / values from `this.domains.processInterop`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private get processInterop(): ProcessInteropV1 | undefined { return this.domains.processInterop; }
  /**
   * 入口 / Entry: FeatureSuite.mediaDevices.
   * 功能：向调用者提供 `this.domains.mediaDevices` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.domains.mediaDevices` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: MediaDevicesV1 | undefined；结果来自 / values from `this.domains.mediaDevices`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private get mediaDevices(): MediaDevicesV1 | undefined { return this.domains.mediaDevices; }
  /**
   * 入口 / Entry: FeatureSuite.hostMounts.
   * 功能：向调用者提供 `this.domains.hostMounts` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.domains.hostMounts` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: HostMountsV1 | undefined；结果来自 / values from `this.domains.hostMounts`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private get hostMounts(): HostMountsV1 | undefined { return this.domains.hostMounts; }
  /**
   * 入口 / Entry: FeatureSuite.projectTerminals.
   * 功能：向调用者提供 `this.domains.projectTerminals` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.domains.projectTerminals` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: ProjectTerminals | undefined；结果来自 / values from `this.domains.projectTerminals`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private get projectTerminals(): ProjectTerminals | undefined { return this.domains.projectTerminals; }
  private domains: AutomationDomainServices;
  /**
   * 入口 / Entry: FeatureSuite.packageWorkbench.
   * 功能：向调用者提供 `this.domains.packageWorkbench` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.domains.packageWorkbench` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.domains.packageWorkbench`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get packageWorkbench() { return this.domains.packageWorkbench; }

  /**
   * 入口 / Entry: FeatureSuite.constructor.
   * 功能：建立 FeatureSuite 的汇集自动化功能、指标告警和实例动作上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the FeatureSuite context for this module's responsibility: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; observations: { editor?: () => Pick<IdeV1, 'profile'> | undefined; jobs?: () => JobView[]; services… default={}; devTaskOptions: FeatureDevTaskOptions default={}; dependencies: HostServiceResolver default=noHostServices
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.domains`.
   */
  constructor(
    private machines: Machines,
    private workspaces: WorkspacesV1,
    private observations: {
      /**
       * 签名 / Signature: FeatureSuite.constructor.editor.
       * 功能：为汇集自动化功能、指标告警和实例动作声明 editor 的输入与结果契约，所属容器为 FeatureSuite.constructor。
       * Purpose: Declares the input/result contract for editor in FeatureSuite.constructor. Module responsibility: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: Pick<IdeV1, 'profile'> | undefined.
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      editor?: () => Pick<IdeV1, 'profile'> | undefined;
      /**
       * 签名 / Signature: FeatureSuite.constructor.jobs.
       * 功能：为汇集自动化功能、指标告警和实例动作声明 jobs 的输入与结果契约，所属容器为 FeatureSuite.constructor。
       * Purpose: Declares the input/result contract for jobs in FeatureSuite.constructor. Module responsibility: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: JobView[].
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      jobs?: () => JobView[];
      /**
       * 签名 / Signature: FeatureSuite.constructor.services.
       * 功能：为汇集自动化功能、指标告警和实例动作声明 services 的输入与结果契约，所属容器为 FeatureSuite.constructor。
       * Purpose: Declares the input/result contract for services in FeatureSuite.constructor. Module responsibility: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
       * 输入 / Inputs: id: string
       * 输出 / Returns: Array<HealthView & { projectId: string }>.
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      services?: (id: string) => Array<HealthView & { projectId: string }>;
      /**
       * 签名 / Signature: FeatureSuite.constructor.secrets.
       * 功能：为汇集自动化功能、指标告警和实例动作声明 secrets 的输入与结果契约，所属容器为 FeatureSuite.constructor。
       * Purpose: Declares the input/result contract for secrets in FeatureSuite.constructor. Module responsibility: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
       * 输入 / Inputs: id: string
       * 输出 / Returns: Promise<SecretRotationItem[] | undefined>.
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      secrets?: (id: string) => Promise<SecretRotationItem[] | undefined>;
      /**
       * 签名 / Signature: FeatureSuite.constructor.power.
       * 功能：为汇集自动化功能、指标告警和实例动作声明 power 的输入与结果契约，所属容器为 FeatureSuite.constructor。
       * Purpose: Declares the input/result contract for power in FeatureSuite.constructor. Module responsibility: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
       * 输入 / Inputs: signal: AbortSignal
       * 输出 / Returns: Promise<PowerSample>.
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      power?: (signal: AbortSignal) => Promise<PowerSample>;
      /**
       * 签名 / Signature: FeatureSuite.constructor.privateDatabase.
       * 功能：为汇集自动化功能、指标告警和实例动作声明 privateDatabase 的输入与结果契约，所属容器为 FeatureSuite.constructor。
       * Purpose: Declares the input/result contract for privateDatabase in FeatureSuite.constructor. Module responsibility: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
       * 输入 / Inputs: id: string; input: { database: 'postgres' | 'mysql' | 'redis'; password: string; name?: string; port?: n…; signal: AbortSignal; log: (text: string) => void
       * 输出 / Returns: Promise<void>.
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      privateDatabase?: (id: string,
        input: { database: 'postgres' | 'mysql' | 'redis'; password: string; name?: string; port?: number },
        signal: AbortSignal, log: (text: string) => void) => Promise<void>;
    } = {},
    private devTaskOptions: FeatureDevTaskOptions = {},
    private dependencies: HostServiceResolver = noHostServices,
  ) {
    this.domains = new AutomationDomainServices(machines, (id, operation, name) =>
      this.package(id, { operation, name }), dependencies);
  }




  /**
   * 入口 / Entry: FeatureSuite.enableBackground.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `cleanupReceipt(() => { if (this.powerAbort === controller) this.backgroundEnabled = false; controller.abort(); })` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `cleanupReceipt(() => { if (this.powerAbort === controller) this.backgroundEnabled = false; controller.abort(); })` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `cleanupReceipt` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `cleanupReceipt`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.powerAbort.signal.aborted`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `cleanupReceipt(() => { if (this.powerAbort === controller) this.backgroundEnabled = false; controller.abort(); })`.
   * 副作用 / Effects: 更新 / updates `this.powerAbort`, `this.backgroundEnabled`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  enableBackground() {
    if (this.powerAbort.signal.aborted) this.powerAbort = new AbortController();
    const controller = this.powerAbort;
    this.backgroundEnabled = true;
    return cleanupReceipt(() => {
      if (this.powerAbort === controller) this.backgroundEnabled = false;
      controller.abort();
    });
  }
  /**
   * 入口 / Entry: FeatureSuite.file.
   * 功能：把本层请求转交 `join`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `join` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `join(DATA, 'feature-suite.json')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file() {
    return join(DATA, 'feature-suite.json');
  }
  /**
   * 入口 / Entry: FeatureSuite.store.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `metadataFile(this.file(), defaultState)` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `metadataFile(this.file(), defaultState)` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `metadataFile`, `this.file` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `metadataFile`, `this.file`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `metadataFile(this.file(), defaultState)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private store() { return metadataFile(this.file(), defaultState); }
  /**
   * 入口 / Entry: FeatureSuite.state.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(await this.store().read()).value` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `(await this.store().read()).value` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `this.store().read`, `this.store` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.store().read`, `this.store`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `(await this.store().read()).value`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async state() { return (await this.store().read()).value; }
  /**
   * 入口 / Entry: FeatureSuite.settingsFor.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `value` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `defaultSchedule`, `defaultAlerts`, `scheduleSchema.parse`, `alertSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `defaultSchedule`, `defaultAlerts`, `scheduleSchema.parse`, `alertSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: state: FeatureState; id: string
   * 输出 / Returns: `value`.
   * 副作用 / Effects: 更新 / updates `value.schedule`, `value.alerts`, `state.settings[id]`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private settingsFor(state: FeatureState, id: string) {
    const value = state.settings[id] || {
      schedule: defaultSchedule(),
      alerts: defaultAlerts(),
      updatedAt: new Date(0).toISOString(),
    };
    value.schedule = scheduleSchema.parse(value.schedule);
    value.alerts = alertSchema.parse(value.alerts);
    state.settings[id] = value;
    return value;
  }
  /**
   * 入口 / Entry: FeatureSuite.catalog.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ features: implementedFeatureCatalogView(), capabilities: capabilityViews('suite'), presets: resourcePresets, generatedAt: n…` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `{ features: implementedFeatureCatalogView(), capabilities: capabilityViews('suite'), presets: resourcePresets, generatedAt: n…` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `implementedFeatureCatalogView`, `capabilityViews` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `implementedFeatureCatalogView`, `capabilityViews`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ features: implementedFeatureCatalogView(), capabilities: capabilityViews('suite'), presets: resourcePresets, generatedAt: n…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async catalog() {
    return {
      features: implementedFeatureCatalogView(),
      capabilities: capabilityViews('suite'),
      presets: resourcePresets,
      generatedAt: new Date().toISOString(),
    };
  }
  /**
   * 入口 / Entry: FeatureSuite.alertEvents.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `structuredClone((await this.state()).events)` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `structuredClone((await this.state()).events)` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `structuredClone`, `this.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `structuredClone`, `this.state`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `structuredClone((await this.state()).events)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async alertEvents() {
    return structuredClone((await this.state()).events);
  }
  /**
   * 入口 / Entry: FeatureSuite.view.
   * 功能：在汇集自动化功能、指标告警和实例动作中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ projectId: this.workspaces.projects.current(id), settings, history: (state.history[id] || []).slice(-size), events: state.e…` 供上层消费（`FeatureSuite`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `FeatureSuite`; this entry produces `{ projectId: this.workspaces.projects.current(id), settings, history: (state.history[id] || []).slice(-size), events: state.e…` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `this.machines.get`, `this.state`, `this.settingsFor`, `this.workspaces.projects.current` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.state`, `this.settingsFor`, `this.workspaces.projects.current`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; limit: default=120
   * 输出 / Returns: `{ projectId: this.workspaces.projects.current(id), settings, history: (state.history[id] || []).slice(-size), events: state.e…`.
   * 副作用 / Effects: `this.settingsFor`; 更新 / updates `state.featureRuns`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string, limit = 120) {
    this.machines.get(id);
    const state = await this.state();
    state.featureRuns ||= {};
    const settings = this.settingsFor(state, id);
    const size = Number.isFinite(limit) ? Math.min(720, Math.max(1, Math.floor(limit))) : 120;
    return {
      projectId: this.workspaces.projects.current(id),
      settings,
      history: (state.history[id] || []).slice(-size),
      events: state.events
        .filter((event) => event.vmId === id)
        .slice(-500)
        .reverse(),
      job: this.jobs.view(`${this.workspaces.projects.key(id)}:package`),
      devJob: this.jobs.view(`${this.workspaces.projects.key(id)}:dev`),
      presets: resourcePresets,
      features: implementedFeatureCatalogView(),
      featureRuns: (state.featureRuns[id] || []).slice(-50).reverse(),
      capabilities: capabilityViews('suite'),
      capabilityJobs: this.jobs
        .list()
        .filter(
          (job) =>
            job.vmId === id &&
            (job.projectId || 'default') === this.workspaces.projects.current(id) &&
            job.action?.startsWith('capability:'),
        ),
    };
  }

  /** Record generic capability checks without claiming their named actions ran. */
  /**
   * 入口 / Entry: FeatureSuite.feature.
   * 功能：组合选定自动化能力的配置、状态和限制，返回当前实例的功能视图。
   * Purpose: Combines settings/state/limits for a selected automation capability into the current VM feature view.
   * 设计：读取分支依据实际实例和工具能力；尚未准备的领域给出不可用状态，不创建运行副作用。
   * Design: Branches inspect actual VM/tool support, reporting unprepared domains without inventing a running resource.
   * 输入 / Inputs: id: string; input: { featureId: FeatureId; action: 'check' | 'run'; options?: Record<string, unknown> }; signal: AbortSignal optional
   * 输出 / Returns: `this.processInterop.action(id, options, 'check', signal)`; `this.jobs.start( this.workspaces.projects.key(id) + ':process-interop', async (log, taskSignal, _update, saveResult) => { con…`; `runner.check(id, featureId, signal)`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `this.jobs.start`; `this.machines.exec().catch`; `this.machines.exec`; `this.store().update`; 更新 / updates `result.ready`, `result.reason`, `result.architecture`, `result.qemu`.
   * 拒绝 / Refusals: 条件 / conditions `featureId === 'process-interop'`; `!this.processInterop`; 异常 / errors `new AppError('进程互操作服务尚未启动', 503)`.
   */
  async feature(
    id: string,
    input: { featureId: FeatureId; action: 'check' | 'run'; options?: Record<string, unknown> },
    signal?: AbortSignal,
  ) {
    this.machines.get(id);
    const featureId = z
      .enum(featureCatalog.map(([value]) => value) as [FeatureId, ...FeatureId[]])
      .parse(input.featureId);
    const spec = featureCatalog.find(([value]) => value === featureId)!;
    if (featureId === 'process-interop') {
      if (!this.processInterop) throw new AppError('进程互操作服务尚未启动', 503);
      const options = processInteropInput.parse(input.options || {});
      if (input.action === 'check') return this.processInterop.action(id, options, 'check', signal);
      this.machines.requireUnlocked(id);
      /**
       * 入口 / Entry: FeatureSuite.feature.callback@403.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
       * 输入 / Inputs: log; taskSignal; _update; saveResult
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `saveResult`.
       * 拒绝 / Refusals: 条件 / conditions `!result.ready`; 异常 / errors `new AppError('进程互操作失败', 409)`.
       */
      return this.jobs.start(
        this.workspaces.projects.key(id) + ':process-interop',
        async (log, taskSignal, _update, saveResult) => {
          const result = await this.processInterop!.action(id, options, 'run', taskSignal);
          await saveResult(result);
          log(JSON.stringify(result) + '\n');
          if (!result.ready) throw new AppError('进程互操作失败', 409);
        },
        { vmId: id, projectId: this.workspaces.projects.current(id),
          title: spec[1], action: 'capability:process-interop' },
      );
    }
    if (hasCapability(featureId)) {
      const runner = new CapabilityActions(this.machines, this.workspaces, this.projectTerminals, this.observations.editor?.());
      if (input.action === 'check') return runner.check(id, featureId, signal);
      this.machines.requireUnlocked(id);
      const parameters = capabilityParameters(featureId, input.options || {});
      /**
       * 入口 / Entry: FeatureSuite.feature.callback@420.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
       * 输入 / Inputs: log; taskSignal; _update; saveResult
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `saveResult`.
       * 拒绝 / Refusals: 条件 / conditions `!result.ready`; 异常 / errors `new AppError('能力执行失败', 409)`.
       */
      return this.jobs.start(
        this.workspaces.projects.key(id) + ':capability:' + featureId,
        async (log, taskSignal, _update, saveResult) => {
          const result = await runner.run(id, featureId, parameters, taskSignal);
          await saveResult(result);
          log(JSON.stringify(result) + '\n');
          if (!result.ready) throw new AppError('能力执行失败', 409);
        },
        {
          vmId: id,
          projectId: this.workspaces.projects.current(id),
          title: spec[1],
          action: 'capability:' + featureId,
        },
      );
    }
    const startedAt = new Date().toISOString();
    const vm = this.machines.get(id);
    const result: Record<string, unknown> = {
      ready: false,
      executed: false,
      featureId,
      name: spec[1],
      category: spec[2],
      state: featureCatalogView().find((feature) => feature.id === featureId)?.state,
      implementation: 'catalog-context',
      reason: '此入口仅记录功能目录与基础环境信息；请使用对应插件的实际操作检查能力。',
      vmState: this.machines.state(id),
      options: input.options || {},
      checkedAt: new Date().toISOString(),
    };
    if (featureId === 'single-app-windows') {
      result.ready = this.machines.state(id) === 'running';
      result.reason = result.ready
        ? '桌面 → 单应用窗口可为 Linux 图形程序创建独立浏览器窗口和虚拟显示器；尚未集成宿主系统原生单应用窗口。'
        : '请启动实例，然后在桌面页打开单应用窗口。';
    } else if (featureId === 'ai-assistant') {
      result.ready = true;
      result.reason =
        '系统设置 → 本地 AI 助手，连接本机 Ollama，审阅脱敏上下文后获取解释、测试或修复建议。需要已下载的本地模型。';
    } else if (featureId === 'golden-images') {
      result.ready = true;
      result.reason =
        '启用磁盘快照插件后，在实例 → 快照 → 黄金镜像库保存、校验和删除模板，并创建独立实例。镜像库页面也可管理所有模板。';
    } else if (featureId === 'disk-maintenance') {
      result.ready = true;
      result.reason = '已接入工作空间 → 维护；启用磁盘与诊断插件后可计划 TRIM、离线压缩和稀疏回收。';
    } else if (featureId === 'network-profiles') {
      result.ready = true;
      result.reason =
        '已接入工作空间 → 开发 → 网络配置：保存、加载 DNS、代理、镜像源与 NAT 端口档案，预览后应用，支持恢复原配置。';
    } else if (featureId === 'metrics-history' || featureId === 'alerts') {
      result.ready = true;
      result.reason = '已接入能力中心的资源趋势与通知中心；自动采样和告警需启用自动化调度插件。';
    } else if (featureId === 'multi-arch') {
      const image = distroInfo('debian', 'aarch64');
      const firmware = await firmwareSupport('aarch64');
      result.architecture = vm.architecture || 'x86_64';
      result.qemu = this.machines.engine.aarch64Available;
      result.firmware = firmware.available;
      result.imageReady = existsSync(image.file);
      result.ready = !!result.qemu && firmware.available && !!result.imageReady;
      result.reason = result.ready
        ? '在新建实例中选择 Debian 12 ARM64；使用 TCG、UEFI 与 QEMU virt 启动。'
        : '请准备 ARM64 QEMU、UEFI 固件和镜像库中的 Debian 12 ARM64 镜像。';
    } else if (featureId === 'snapshot-diff') {
      result.ready = true;
      result.reason =
        '启用磁盘快照插件后，在实例 → 快照选择起点和终点，离线比较整个磁盘及指定路径中的普通文件和符号链接。';
      result.snapshots = vm.snapshots.length;
    } else if (featureId === 'online-snapshots') {
      result.ready = true;
      result.reason = '在实例 → 快照中，对运行中的实例创建在线快照；客户机需安装并运行 qemu-guest-agent。';
      result.snapshots = vm.snapshots.length;
    } else if (featureId === 'package-cache') {
      result.ready = true;
      result.reason = '工作空间 → 软件包可预取并离线安装系统包；开发任务支持按 npm 锁文件或固定版本 requirements.txt 缓存项目依赖。';
    } else if (featureId === 'security-scan') {
      result.ready = this.machines.state(id) === 'running';
      result.reason = '工作空间 → 安全扫描：检查客户机 SSH 和系统文件，并用 OSV 匹配已安装源包的漏洞；查询失败会明确显示未完成。';
    } else if (featureId === 'multi-monitor') {
      const probe = this.machines.state(id) === 'running'
        ? await this.machines.exec(id,
            "test -f /etc/sakura/desktop-version && command -v xrandr >/dev/null",
            10000, signal).catch(() => null)
        : null;
      result.ready = probe?.code === 0;
      result.reason = result.ready
        ? '桌面 → 外观与布局，选择每块逻辑屏幕的分辨率、缩放和单屏/左右/上下布局；应用后重启桌面。两个逻辑屏幕共享一个 VNC 画布。'
        : '请先启动实例并在桌面页安装 KDE Plasma；新安装包含双逻辑屏幕所需的 xrandr。';
    } else if (featureId === 'audio-video') {
      const media = await this.mediaDevices?.view(id);
      const hostAudio = !!media && media.audio === 'hda-duplex' &&
        media.audioBackend === 'dsound' && media.support.dsound.available &&
        /^\s*\d+\s+\[/.test(media.guest?.audio || '');
      const activeUsb = !!media && media.usb.rules.some((rule) => !!rule.mediaKind &&
        media.usb.configured.some((device) => device.ruleId === rule.id));
      result.ready = hostAudio || activeUsb && (!!media?.guest?.audio || !!media?.guest?.video);
      result.audio = media?.audio || 'none';
      result.guest = media?.guest || null;
      result.reason = '系统设置 → 音视频设备：启用 HDA/DirectSound 后重启实例；USB 摄像头、麦克风和耳机使用指定设备的 VID:PID 转发规则，客户机需安装对应驱动。';
    } else if (featureId === 'windows-mount') {
      const mount = await this.hostMounts?.view(id);
      result.ready = !!mount?.policy.enabled && !!mount?.mounted;
      result.hostMount = mount || null;
      result.reason = mount?.mounted
        ? `宿主目录已通过 SSHFS 挂载到 ${mount.guestPath}。`
        : '能力中心 → 资源中填写宿主绝对路径、只读策略并保存；启动实例后会自动挂载。';
    } else if (
      featureId === 'file-drop' ||
      featureId === 'resumable-transfer'
    ) {
      result.transfer = 'sftp-resumable';
    } else if (featureId === 'dev-container') {
      const probe = vm.distro && vm.distro !== 'alpine' && this.machines.state(id) === 'running'
        ? await this.machines.exec(id, 'command -v docker >/dev/null && docker info >/dev/null',
            10000, signal).catch(() => null)
        : null;
      result.ready = probe?.code === 0;
      result.adapter = 'workspace-tooling';
      result.reason = result.ready
        ? '启用项目和容器插件后，在容器工作台从 devcontainer.json 或 Dockerfile 创建环境。'
        : '需要运行中的 Debian/Ubuntu 实例和 Docker；在容器工作台安装后重试。';
    } else if (featureId === 'language-services') {
      const probe = this.machines.state(id) === 'running'
        ? await this.machines.exec(id,
            'test -x /opt/sakura-language-services/node_modules/.bin/typescript-language-server && test -f /opt/sakura-language-services/node_modules/typescript/lib/tsserver.js && test -x /opt/sakura-language-services/node_modules/.bin/pyright-langserver',
            10000, signal).catch(() => null)
        : null;
      result.ready = probe?.code === 0;
      result.adapter = 'lsp-stdio';
      result.reason = result.ready
        ? '文件面板可对当前项目中的 TypeScript、JavaScript 和 Python 文件执行补全、跳转、语言诊断和预览后重命名。'
        : '请启动实例，在文件面板打开当前项目中的源文件并安装语言服务器。';
    } else if (featureId === 'debug-adapter') {
      const probe = this.machines.state(id) === 'running'
        ? await this.machines.exec(id,
            "/opt/sakura-debugger/bin/python -c 'import debugpy; assert debugpy.__version__ == \"1.8.16\"'",
            10000, signal).catch(() => null)
        : null;
      result.ready = probe?.code === 0;
      result.adapter = 'debugpy-dap-stdio';
      result.reason = result.ready
        ? '文件面板可为当前项目中的 Python 文件设置断点、暂停和单步，并查看调用栈、变量与程序输出。'
        : '请启动实例，在文件面板打开当前项目中的 Python 文件并安装 Python 调试器。';
    } else if (featureId === 'reverse-proxy') {
      result.ready = true;
      result.network = 'localhost-https-ingress';
      result.reason = '实例 → 服务与端口提供 HTTPS 路由、WebSocket 与证书轮换；可明确启用 Windows hosts 系统解析，使 .sakura.localhost 别名供本机程序访问。';
    } else if (featureId === 'vpn-integration') {
      result.ready = true;
      result.network = 'wireguard-overlay';
      result.reason = '启用平台与私密配置插件后，在能力中心 → WireGuard 覆盖网络生成密钥、保存对端配置并启动接口。当前支持 WireGuard，不包含 Tailscale。';
    } else if (featureId === 'rbac-sharing') {
      result.ready = true;
      result.controlPlane = 'opt-in-owner-viewer-accounts';
      result.reason = '系统设置 → 账户与只读分享：启用独立账户，管理员可为指定实例创建有期限的只读账户。账户会话按期限失效，写请求记录账户 ID；当前仍只监听本机。';
    } else if (featureId === 'plugin-api') {
      result.ready = true;
      result.controlPlane = 'signed-isolated-wasm-extensions';
      result.reason = '插件中心支持签名 WebAssembly 插件、脱敏事件订阅、定时触发、管理员 HTTP 操作及声明式表单面板；插件不能执行宿主 I/O 或注入前端代码。';
    }
    /**
     * 入口 / Entry: FeatureSuite.feature.callback@580.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.store().update）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.store().update).
     * 输入 / Inputs: state
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `history.push`; `history.shift`; 更新 / updates `state.featureRuns`, `state.featureRuns[id]`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    await this.store().update(state => {
      state.featureRuns ||= {};
      const history = (state.featureRuns[id] ||= []);
      history.push({ featureId, startedAt, finishedAt: new Date().toISOString(), result });
      while (history.length > 50) history.shift();
    });
    signal?.throwIfAborted();
    return result;
  }
  /**
   * 入口 / Entry: FeatureSuite.update.
   * 功能：在汇集自动化功能、指标告警和实例动作中，校验并提交领域状态变更；本入口产生 `result.result` 供上层消费（`FeatureSuite`）。
   * Purpose: Validates and commits a domain state change in `FeatureSuite`; this entry produces `result.result` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `this.machines.get`, `featureSuiteUpdateRequest.parse`, `this.store().update`, `this.store` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `featureSuiteUpdateRequest.parse`, `this.store().update`, `this.store`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value.schedule`.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `result.result`.
   * 副作用 / Effects: `this.store().update`; `this.idleSince.delete`; `this.lastSampleAt.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async update(id: string, input: unknown) {
    this.machines.get(id);
    const value = featureSuiteUpdateRequest
      .parse(input);
    /**
     * 入口 / Entry: FeatureSuite.update.callback@593.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.store().update）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.store().update).
     * 输入 / Inputs: state
     * 输出 / Returns: `settings`.
     * 副作用 / Effects: `this.settingsFor`; 更新 / updates `settings.schedule`, `settings.alerts`, `settings.updatedAt`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const result = await this.store().update(state => {
      const settings = this.settingsFor(state, id);
      if (value.schedule) settings.schedule = value.schedule;
      if (value.alerts) settings.alerts = value.alerts;
      settings.updatedAt = new Date().toISOString();
      return settings;
    });
    if (value.schedule) { this.idleSince.delete(id); this.lastSampleAt.delete(id); }
    return result.result;
  }
  /**
   * 入口 / Entry: FeatureSuite.sample.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `point` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `point` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `this.machines.live.get`, `this.workspaces.metrics`, `this.store().update`, `this.store` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.live.get`, `this.workspaces.metrics`, `this.store().update`, `this.store`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `point`.
   * 副作用 / Effects: `this.store().update`.
   * 拒绝 / Refusals: 条件 / conditions `boot !== this.machines.live?.get(id)?.startedAt`; 异常 / errors `new AppError('实例已重启，本次采样已失效', 409)`.
   */
  async sample(id: string) {
    const boot = this.machines.live?.get(id)?.startedAt;
    const point = await this.workspaces.metrics(id);
    if (boot !== this.machines.live?.get(id)?.startedAt)
      throw new AppError('实例已重启，本次采样已失效', 409);
    /**
     * 入口 / Entry: FeatureSuite.sample.callback@608.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.store().update）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.store().update).
     * 输入 / Inputs: state
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `history.push`; `history.shift`; 更新 / updates `state.history[id]`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    await this.store().update(state => {
      const history = (state.history[id] ||= []);
      if (history.some((entry) => entry.sampledAt === point.sampledAt)) return;
      history.push({
        sampledAt: point.sampledAt,
        cpuPercent: point.cpuPercent,
        memoryUsed: point.memoryUsed,
        memoryTotal: point.memoryTotal,
        diskUsed: point.diskUsed,
        diskTotal: point.diskTotal,
        networkReceivedBytes: point.networkReceivedBytes,
        networkTransmittedBytes: point.networkTransmittedBytes,
        networkReceiveBytesPerSecond: point.networkReceiveBytesPerSecond,
        networkTransmitBytesPerSecond: point.networkTransmitBytesPerSecond,
      });
      while (history.length > 720) history.shift();
      if (this.backgroundEnabled) this.checkAlerts(id, point, state);
    });
    return point;
  }
  /**
   * 入口 / Entry: FeatureSuite.memoryTarget.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.setMemoryTarget(id, target)` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `this.machines.setMemoryTarget(id, target)` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `z.number().int().min().max().parse`, `z.number().int().min().max`, `z.number().int().min`, `z.number().int` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.number().int().min().max().parse`, `z.number().int().min().max`, `z.number().int().min`, `z.number().int`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; memoryMiB: number
   * 输出 / Returns: `this.machines.setMemoryTarget(id, target)`.
   * 副作用 / Effects: `this.machines.setMemoryTarget`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async memoryTarget(id: string, memoryMiB: number) {
    const target = z.number().int().min(256).max(8192).parse(memoryMiB);
    return this.machines.setMemoryTarget(id, target);
  }
  /**
   * 入口 / Entry: FeatureSuite.applyPreset.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.update(id, { name: vm.name, memoryMiB: target.memoryMiB, cpus: target.cpus, diskGiB: vm.diskGiB, accelerator: v…` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `this.machines.update(id, { name: vm.name, memoryMiB: target.memoryMiB, cpus: target.cpus, diskGiB: vm.diskGiB, accelerator: v…` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `z.enum().parse`, `z.enum`, `this.machines.get`, `distroInfo` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.enum().parse`, `z.enum`, `this.machines.get`, `distroInfo`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; preset: ResourcePresetId
   * 输出 / Returns: `this.machines.update(id, { name: vm.name, memoryMiB: target.memoryMiB, cpus: target.cpus, diskGiB: vm.diskGiB, accelerator: v…`.
   * 副作用 / Effects: `this.machines.update`.
   * 拒绝 / Refusals: 条件 / conditions `target.memoryMiB < minimumMemory`; 异常 / errors `new AppError(`${target.name} 预设的内存低于 ${distro.name} 的最低要求（${minimumMemory} MiB）`)`.
   */
  async applyPreset(id: string, preset: ResourcePresetId) {
    const key = z.enum(['light', 'development', 'build', 'desktop']).parse(preset) as ResourcePresetId;
    const vm = this.machines.get(id);
    const target = resourcePresets[key];
    const distro = distroInfo(vm.distro);
    const minimumMemory = distro.minimumMemory;
    if (target.memoryMiB < minimumMemory)
      throw new AppError(`${target.name} 预设的内存低于 ${distro.name} 的最低要求（${minimumMemory} MiB）`);
    return this.machines.update(id, {
      name: vm.name,
      memoryMiB: target.memoryMiB,
      cpus: target.cpus,
      diskGiB: vm.diskGiB,
      accelerator: vm.accelerator,
      distro: vm.distro,
      template: vm.template,
      forwards: vm.forwards,
    });
  }
  /**
   * 入口 / Entry: FeatureSuite.diskAnalysis.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ path, entries, checkedAt: new Date().toISOString() }` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `{ path, entries, checkedAt: new Date().toISOString() }` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `this.machines.get`, `guestPath`, `this.machines.exec`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `guestPath`, `this.machines.exec`, `quote`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: { path?: string }; signal: AbortSignal optional
   * 输出 / Returns: `{ path, entries, checkedAt: new Date().toISOString() }`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0 && !result.stdout.trim()`; 异常 / errors `new AppError(result.stderr.trim() || '磁盘分析失败', 502)`.
   */
  async diskAnalysis(id: string, input: { path?: string }, signal?: AbortSignal) {
    this.machines.get(id);
    const path = guestPath(input.path || '/workspace');
    const result = await this.machines.exec(
      id,
      `set +e\ndu -x -k -d 2 ${quote(path)} 2>/dev/null | sort -nr | head -n 100`,
      30_000,
      signal,
    );
    if (result.code !== 0 && !result.stdout.trim())
      throw new AppError(result.stderr.trim() || '磁盘分析失败', 502);
    const entries = result.stdout
      .split(/\r?\n/)
      .map((line) => line.match(/^(\d+)\s+(.+)$/))
      .filter((match): match is RegExpMatchArray => !!match)
      .map((match) => ({ path: match[2], bytes: Number(match[1]) * 1024 }))
      .filter((entry) => Number.isSafeInteger(entry.bytes) && entry.bytes >= 0);
    return { path, entries, checkedAt: new Date().toISOString() };
  }
  /**
   * 入口 / Entry: FeatureSuite.cleanupDependencyStage.
   * 功能：在汇集自动化功能、指标告警和实例动作中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`FeatureSuite`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `FeatureSuite`; the calls and state transitions below complete the operation. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `this.machines.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.exec`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; command: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError('项目依赖暂存目录清理失败；请恢复实例连接后重试', 502)`.
   */
  private async cleanupDependencyStage(id: string, command: string) {
    const result = await this.machines.exec(id, command, 10_000);
    if (result.code !== 0)
      throw new AppError('项目依赖暂存目录清理失败；请恢复实例连接后重试', 502);
  }
  /**
   * 入口 / Entry: FeatureSuite.dev.
   * 功能：按开发动作生成并执行受限项目任务，包括环境锁、仓库和诊断流程。
   * Purpose: Builds/runs bounded project development tasks including environment locks, repository work and diagnostics.
   * 设计：工作目录、分支及输入先校验；执行复用原项目任务预算，产物和日志仍受边界与脱敏限制。
   * Design: Directory/branch/input validation precedes execution; original task admission is reused and outputs remain bounded/redacted.
   * 输入 / Inputs: id: string; input: Omit<Extract<FeatureAction, { action: 'dev' }>, 'action'>; signal: AbortSignal optional
   * 输出 / Returns: `this.jobs.start( `${this.workspaces.projects.key(id)}:dev`, async (log, taskSignal, _update, saveResult) => this.workspaces.p…`.
   * 副作用 / Effects: `path.startsWith`; `this.jobs.start`; 更新 / updates `input`.
   * 拒绝 / Refusals: 条件 / conditions `operation === 'worktree-add' && (!branch || !/^(?!-)[A-Za-z0-9_./-]{1,128}$/.test(branch))`; `['worktree-add', 'worktree-remove'].includes(operation)`; `!path || path.startsWith('/') || path.split('/').includes('..') || !/^[A-Za-z0-9_./-]{1,160}$/.test(path)`; 异常 / errors `new AppError('分支名称无效')`; `new AppError('工作树路径必须是仓库内的相对路径')`.
   */
  dev(id: string, input: Omit<Extract<FeatureAction, { action: 'dev' }>, 'action'>, signal?: AbortSignal) {
    const operation = z
      .enum([
        'test',
        'test-discover',
        'lint',
        'format',
        'dependencies',
        'lock',
        'lock-check',
        'install-locked',
        'prefetch-dependencies',
        'install-cached-dependencies',
        'worktree-list',
        'worktree-add',
        'worktree-remove',
        'database',
      ])
      .parse(input.operation);
    input = structuredClone(input);
    const branch = input.branch?.trim();
    const path = input.path?.trim();
    const database = operation === 'database' ? z.enum(['postgres', 'redis', 'mysql']).parse(input.database) : input.database;
    const cacheManager = ['prefetch-dependencies', 'install-cached-dependencies'].includes(operation)
      ? dependencyManagerSchema.parse(input.manager) : undefined;
    if (operation === 'worktree-add' && (!branch || !/^(?!-)[A-Za-z0-9_./-]{1,128}$/.test(branch)))
      throw new AppError('分支名称无效');
    if (['worktree-add', 'worktree-remove'].includes(operation)) {
      if (
        !path ||
        path.startsWith('/') ||
        path.split('/').includes('..') ||
        !/^[A-Za-z0-9_./-]{1,160}$/.test(path)
      )
        throw new AppError('工作树路径必须是仓库内的相对路径');
    }
    if (operation === 'database') {
      if (!database) throw new AppError('请选择数据库类型');
      if (
        !input.password ||
        input.password.length < 12 ||
        input.password.length > 128 ||
        !/^[\x21-\x7e]+$/.test(input.password)
      )
        throw new AppError('数据库密码需要 12–128 个不含空格的可打印 ASCII 字符');
      if (input.name !== undefined && !/^[a-z][a-z0-9-]{0,31}$/.test(input.name.trim()))
        throw new AppError('数据库容器名称无效');
      if (
        input.port !== undefined &&
        (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535)
      )
        throw new AppError('数据库端口需要在 1024–65535 之间');
    }
    const vm = this.machines.get(id);
    const original = { projectId: this.workspaces.projects.current(id), live: this.machines.live.get(id) };
    /**
     * 入口 / Entry: FeatureSuite.dev.callback@732.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.workspaces.projects.inScope）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.workspaces.projects.inScope).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `AbortSignal.any`; `settings.map().join`; `settings.map`; 更新 / updates `cachePlan`, `command`.
     * 拒绝 / Refusals: 条件 / conditions `!['prefetch-dependencies', 'database'].includes(operation)`; `prefetch`; `authentication`; 异常 / errors `new AppError('没有此开发执行器', 400, 'FEATURE_DEV_OPERATION_UNSUPPORTED')`; `error`.
     * 收尾：退出 try 区域时始终执行 `output.flush();`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `output.flush();`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `if (error instanceof AppError && error.status === 503) throw error;`; `throw new AppError(redactValues((error as Error).message, authentication.privateValues), error instanceof AppError ? error.st…`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (error instanceof AppError && error.status === 503) throw error;`; `throw new AppError(redactValues((error as Error).message, authentication.privateValues), error instanceof AppError ? error.st…`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.jobs.start(
      `${this.workspaces.projects.key(id)}:dev`,
      async (log, taskSignal, _update, saveResult) => this.workspaces.projects.inScope(id, original.projectId,
      /**
       * 中文功能：分派捕获项目的工程/开发任务，依赖预取仅读取网络认证，数据库按共享或私有网络执行，并对输出和异常脱敏。
       * English: Dispatches captured-project engineering/development tasks, uses only network authentication for dependency prefetch, selects shared/private database execution and redacts output/errors.
       * 所属 / Owner: FeatureSuite.dev.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       * 设计：每次等待后核对原项目/取消信号；认证暂存走独立清理，日志在 finally 刷新，不把项目 secrets 导出给共享预取。
       * Design: Recheck original-project/cancellation state after waits; authentication staging has separate cleanup and logs flush in finally without exporting project secrets to shared prefetch.
       */
      async () => {
        /**
         * 入口 / Entry: FeatureSuite.dev.assertLive.
         * 功能：在汇集自动化功能、指标告警和实例动作中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`FeatureSuite`）。
         * Purpose: Checks admission, input or resource ownership in `FeatureSuite`; the calls and state transitions below complete the operation. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
         * 处理：通过 `this.machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `this.machines.live.get`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 拒绝 / Refusals: 条件 / conditions `this.machines.live.get(id) !== original.live`; 异常 / errors `new AppError('开发任务客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
         */
        const assertLive = () => {
          if (this.machines.live.get(id) !== original.live)
            throw new AppError('开发任务客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        };
        assertLive();
        const combined = taskSignal && signal ? AbortSignal.any([taskSignal, signal]) : taskSignal;
        if (operation === 'lint' || operation === 'format') {
          const result = await new CapabilityActions(this.machines, this.workspaces, this.projectTerminals, this.observations.editor?.()).run(
            id,
            'format-lint',
            { mode: operation },
            combined,
            { expectedLive: original.live,
            /**
             * 入口 / Entry: FeatureSuite.dev.onEngineeringResult.
             * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`FeatureSuite`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; the calls and state transitions below complete the operation. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
             * 处理：通过 `assertLive`, `combined.throwIfAborted`, `saveResult` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `assertLive`, `combined.throwIfAborted`, `saveResult`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: result
             * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
             * 副作用 / Effects: `saveResult`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            onEngineeringResult: async result => {
              assertLive(); combined.throwIfAborted();
              await saveResult(result);
              assertLive(); combined.throwIfAborted();
            } },
          );
          assertLive(); combined.throwIfAborted();
          log(JSON.stringify(result) + '\n');
          requireSuccessfulResult(result);
          return;
        }
        const uidOperation = featureDevTaskOperation.safeParse(operation);
        if (uidOperation.success) {
          await runFeatureDevTask(this.machines, this.workspaces, id,
            { operation: uidOperation.data, branch, path, manager: cacheManager }, combined, log, saveResult,
            { ...this.devTaskOptions, terminals: this.devTaskOptions.terminals || this.projectTerminals, original });
          return;
        }
        if (!['prefetch-dependencies', 'database'].includes(operation))
          throw new AppError('没有此开发执行器', 400, 'FEATURE_DEV_OPERATION_UNSUPPORTED');
        // Shared download preparation never resolves or exports project secrets,
        // runtime selectors, import hooks or other project execution settings.
        const prefetch = operation === 'prefetch-dependencies';
        const project = await this.workspaces.config(id);
        assertLive(); combined.throwIfAborted();
        if (prefetch) {
          const authentication = await this.workspaces.dependencyDownloadAuthentication?.(id, cacheManager!);
          if (authentication) {
            const output = privateLog(log, authentication.privateValues);
            try {
              /**
               * 入口 / Entry: FeatureSuite.dev.callback@780.
               * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（withDependencyAuthentication）。
               * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (withDependencyAuthentication).
               * 输入 / Inputs: paths
               * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
               * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
               * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError( redactValues(result.stderr.trim(), authentication.privateValues) || `认证依赖预取失败（${result.code}）`, )`.
               */
              await withDependencyAuthentication(
                this.machines,
                id,
                authentication,
                combined,
                async (paths) => {
                  const plan = projectDependencyCachePlan(
                    project.directory,
                    this.workspaces.projects.current(id),
                    cacheManager!,
                    operation,
                    await this.workspaces.networkEnvironment(id),
                    paths,
                  );
                  const cleanup = plan.cleanup;
                  const result = await guestTask(this.machines, id, plan.command, combined, output.write, 600_000,
                    undefined, cleanup ? () => this.cleanupDependencyStage(id, cleanup) : undefined);
                  if (result.code !== 0)
                    throw new AppError(
                      redactValues(result.stderr.trim(), authentication.privateValues) ||
                        `认证依赖预取失败（${result.code}）`,
                    );
                },
              );
            } catch (error) {
              if (error instanceof AppError && error.status === 503) throw error;
              throw new AppError(redactValues((error as Error).message, authentication.privateValues),
                error instanceof AppError ? error.status : 400, error instanceof AppError ? error.code : undefined);
            } finally {
              output.flush();
            }
            assertLive(); combined.throwIfAborted();
            return;
          }
        }
        if (project.networkIsolation === 'private' && operation === 'database') {
          if (!this.observations.privateDatabase)
            throw new AppError('私有数据库需要启用容器插件', 409);
          await this.observations.privateDatabase(id, {
            database: database!, password: input.password!, name: input.name, port: input.port,
          }, combined, log);
          assertLive(); combined.throwIfAborted();
          return;
        }
        let command: string | undefined;
        let cachePlan: ProjectDependencyCachePlan | undefined;
        switch (operation) {
          case 'prefetch-dependencies':
            cachePlan = projectDependencyCachePlan(project.directory,
              this.workspaces.projects.current(id), cacheManager!, operation,
              prefetch ? await this.workspaces.networkEnvironment(id) : undefined);
            command = cachePlan.command;
            break;
          case 'database': {
            const image =
              database === 'postgres'
                ? 'postgres:16-alpine'
                : database === 'redis'
                  ? 'redis:7-alpine'
                  : 'mysql:8';
            const container = input.name?.trim() || `sakura-${database}`;
            const settings =
              database === 'postgres'
                ? [`POSTGRES_USER=sakura`, `POSTGRES_DB=sakura`, `POSTGRES_PASSWORD=${input.password}`]
                : database === 'mysql'
                  ? [
                      `MYSQL_DATABASE=sakura`,
                      `MYSQL_USER=sakura`,
                      `MYSQL_PASSWORD=${input.password}`,
                      `MYSQL_ROOT_PASSWORD=${input.password}`,
                    ]
                  : [];
            const guestPort = database === 'postgres' ? 5432 : database === 'mysql' ? 3306 : 6379;
            const publishedPort = input.port || guestPort;
            const volumePath =
              database === 'redis'
                ? '/data'
                : database === 'postgres'
                  ? '/var/lib/postgresql/data'
                  : '/var/lib/mysql';
            const imageCommand =
              database === 'redis'
                ? ` redis-server --appendonly yes --requirepass ${quote(input.password!)}`
                : '';
            command = `if ! command -v docker >/dev/null; then echo '客户机尚未安装 Docker' >&2; exit 1; fi\nif docker container inspect ${quote(container)} >/dev/null 2>&1; then echo '同名数据库容器已存在' >&2; exit 1; fi\ndocker run -d --restart unless-stopped --label sakura.managed=database --name ${quote(container)} --publish ${quote(`127.0.0.1:${publishedPort}:${guestPort}`)} --volume ${quote(`${container}-data:${volumePath}`)} ${settings.map((value) => `--env ${quote(value)}`).join(' ')} ${image}${imageCommand}\nprintf '%s\\n' ${quote(`${container} 已启动 · 客户机 127.0.0.1:${publishedPort} · 数据卷 ${container}-data`)}`;
            break;
          }
        }
        if (!command) throw new AppError('没有此开发执行器', 400, 'FEATURE_DEV_OPERATION_UNSUPPORTED');
        const secrets = [input.password || ''];
        const output = privateLog(log, secrets);
        const script = `set -eu\ncd /\n${command}`;
        const privateRuntime = project.networkIsolation === 'private' &&
          operation !== 'prefetch-dependencies';
        const namespace = privateRuntime ? projectNetworkNamespace(project) : null;
        const administrative = 'cd /\n' + (namespace ?
          ensureProjectNetworkScript(project, vm.distro || 'alpine') + '\n' +
          projectNetworkCheckScript(namespace) + '\nexec ip netns exec ' + namespace + ' /bin/sh -ec ' + quote(script) : script);
        const guestScript = '/usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C /bin/sh -ec ' + quote(administrative);
        const cleanup = cachePlan?.cleanup;
        try {
          assertLive(); combined.throwIfAborted();
          const result = await guestTask(
            this.machines,
            id,
            guestScript,
            combined,
            output.write,
            600_000,
            undefined,
            cleanup ? () => this.cleanupDependencyStage(id, cleanup) : undefined,
          );
          assertLive(); combined.throwIfAborted();
          if (result.code !== 0)
            throw new AppError(
              redactValues(result.stderr.trim(), secrets) || `开发操作失败（${result.code}）`,
            );
        } catch (error) {
          if (error instanceof AppError && error.status === 503) throw error;
          throw new AppError(redactValues((error as Error).message, secrets),
            error instanceof AppError ? error.status : 400, error instanceof AppError ? error.code : undefined);
        } finally {
          output.flush();
        }
      }),
      {
        title: `开发工具 · ${operation}`,
        vmId: id,
        projectId: original.projectId,
        action: `dev:${operation}${cacheManager ? `:${cacheManager}` : ''}`,
      },
    );
  }
  /**
   * 入口 / Entry: FeatureSuite.checkAlerts.
   * 功能：在汇集自动化功能、指标告警和实例动作中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`FeatureSuite`）。
   * Purpose: Checks admission, input or resource ownership in `FeatureSuite`; this entry produces `void` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `this.settingsFor`, `state.events.push`, `state.events.splice` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.settingsFor`, `state.events.push`, `state.events.splice`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!settings.enabled`; `!Number.isFinite(value) || value < threshold`; `Date.now() - last < settings.cooldownMinutes * 60_000`.
   * 输入 / Inputs: id: string; point: MetricPoint; state: FeatureState
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.settingsFor`; `state.events.push`; `state.events.splice`; 更新 / updates `state.lastAlerts[id]`, `previous[kind]`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private checkAlerts(id: string, point: MetricPoint, state: FeatureState) {
    const settings = this.settingsFor(state, id).alerts;
    if (!settings.enabled) return;
    const values: Array<[AlertEvent['kind'], number, number, string]> = [
      ['cpu', point.cpuPercent, settings.cpuPercent, `CPU 使用率超过 ${settings.cpuPercent}%`],
      [
        'memory',
        point.memoryTotal ? (point.memoryUsed / point.memoryTotal) * 100 : 0,
        settings.memoryPercent,
        `内存使用率超过 ${settings.memoryPercent}%`,
      ],
      [
        'disk',
        point.diskTotal ? (point.diskUsed / point.diskTotal) * 100 : 0,
        settings.diskPercent,
        `磁盘使用率超过 ${settings.diskPercent}%`,
      ],
    ];
    const previous = (state.lastAlerts[id] ||= {});
    for (const [kind, value, threshold, message] of values) {
      if (!Number.isFinite(value) || value < threshold) continue;
      const last = previous[kind] || 0;
      if (Date.now() - last < settings.cooldownMinutes * 60_000) continue;
      previous[kind] = Date.now();
      state.events.push({
        id: `${id}-${kind}-${Date.now()}`,
        vmId: id,
        kind,
        message,
        createdAt: new Date().toISOString(),
        acknowledged: false,
      });
    }
    if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
  }
  /**
   * 入口 / Entry: FeatureSuite.checkOperationalAlerts.
   * 功能：在汇集自动化功能、指标告警和实例动作中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`FeatureSuite`）。
   * Purpose: Checks admission, input or resource ownership in `FeatureSuite`; this entry produces `void` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `this.settingsFor`, `this.observations.jobs().filter`, `this.observations.jobs`, `seen.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.settingsFor`, `this.observations.jobs().filter`, `this.observations.jobs`, `seen.has`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!settings.alerts.enabled`; `!job.id || seen.has(job.id) || !['error', 'interrupted'].includes(job.status)`; `!(service ? settings.alerts.serviceFailures : settings.alerts.taskFailures) || !Number.isFinite(Date…`.
   * 输入 / Inputs: id: string; state: FeatureState; secrets: SecretRotationItem[] optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.settingsFor`; `seen.add`; `state.events.push`; `state.events.splice`; 更新 / updates `state.lastAlerts[id]`, `state.notifiedJobs`, `state.notifiedJobs[id]`, `state.notifiedSecretRotations`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private checkOperationalAlerts(id: string, state: FeatureState, secrets?: SecretRotationItem[]) {
    const settings = this.settingsFor(state, id);
    if (!settings.alerts.enabled) return;
    const now = Date.now(),
      previous = (state.lastAlerts[id] ||= {});
    const jobs = this.observations.jobs?.().filter((job) => job.vmId === id) || [];
    state.notifiedJobs ||= {};
    const seen = new Set(state.notifiedJobs[id] || []);
    for (const job of jobs) {
      if (!job.id || seen.has(job.id) || !['error', 'interrupted'].includes(job.status)) continue;
      seen.add(job.id);
      const service = job.scope === 'health';
      if (
        !(service ? settings.alerts.serviceFailures : settings.alerts.taskFailures) ||
        !Number.isFinite(Date.parse(job.finishedAt || '')) ||
        Date.parse(job.finishedAt!) < Date.parse(settings.updatedAt)
      )
        continue;
      const kind = job.scope === 'backups' ? 'backup' : service ? 'service' : 'task';
      state.events.push({
        id: randomUUID(),
        vmId: id,
        kind,
        jobId: job.id,
        projectId: job.projectId,
        message: `${kind === 'backup' ? '备份' : kind === 'service' ? '服务' : '后台'}任务${job.status === 'interrupted' ? '中断' : '失败'}：${job.title || job.scope || '未命名任务'}，请查看任务详情。`,
        createdAt: new Date(now).toISOString(),
        acknowledged: false,
      });
    }
    state.notifiedJobs[id] = [...seen].slice(-10000);
    if (settings.alerts.secretRotation !== false) {
      if (secrets) {
        state.notifiedSecretRotations ||= {};
        const notified = (state.notifiedSecretRotations[id] ||= {});
        for (const name of Object.keys(notified))
          if (!secrets.some((item) => item.name === name)) delete notified[name];
        for (const item of secrets) {
          if (!['due-soon', 'overdue'].includes(item.status)) continue;
          const key = `${item.lastChangedAt}:${item.dueAt}:${item.status}`;
          if (notified[item.name] === key) continue;
          notified[item.name] = key;
          state.events.push({
            id: randomUUID(),
            vmId: id,
            kind: 'secret',
            acknowledged: false,
            createdAt: new Date(now).toISOString(),
            message: `私密配置 ${item.name} ${item.status === 'overdue' ? '已到轮换期限' : '即将到轮换期限'}；请在开发设置中更新值。`,
          });
        }
      }
    }
    if (settings.alerts.serviceFailures)
      for (const service of this.observations.services?.(id) || []) {
        if (
          !service.desired ||
          !['unhealthy', 'exhausted', 'restarting'].includes(service.status) ||
          !service.checkedAt
        )
          continue;
        const key = `service:${service.projectId}:${service.name}`;
        if (now - (previous[key] || 0) < settings.alerts.cooldownMinutes * 60000) continue;
        previous[key] = now;
        state.events.push({
          id: randomUUID(),
          vmId: id,
          kind: 'service',
          projectId: service.projectId,
          message: `服务 ${service.name} ${service.status === 'exhausted' ? '已耗尽自动重启次数' : service.status === 'restarting' ? '健康检查失败，正在重启' : '健康检查失败'}。`,
          createdAt: new Date(now).toISOString(),
          acknowledged: false,
        });
      }
    if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
  }
  /**
   * 入口 / Entry: FeatureSuite.acknowledge.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(await this.store().update(state => { const event = state.events.find((value) => value.vmId === id && value.id === eventId); …` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `(await this.store().update(state => { const event = state.events.find((value) => value.vmId === id && value.id === eventId); …` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `this.machines.get`, `this.store().update`, `this.store` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.store().update`, `this.store`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; eventId: string
   * 输出 / Returns: `(await this.store().update(state => { const event = state.events.find((value) => value.vmId === id && value.id === eventId); …`.
   * 副作用 / Effects: `this.store().update`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async acknowledge(id: string, eventId: string) {
    this.machines.get(id);
    /**
     * 入口 / Entry: FeatureSuite.acknowledge.callback@1021.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.store().update）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.store().update).
     * 输入 / Inputs: state
     * 输出 / Returns: `event`.
     * 副作用 / Effects: 更新 / updates `event.acknowledged`.
     * 拒绝 / Refusals: 条件 / conditions `!event`; 异常 / errors `new AppError('告警不存在', 404)`.
     */
    return (await this.store().update(state => {
      const event = state.events.find((value) => value.vmId === id && value.id === eventId);
      if (!event) throw new AppError('告警不存在', 404);
      event.acknowledged = true;
      return event;
    })).result;
  }
  /**
   * 入口 / Entry: FeatureSuite.search.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ query, path, content: input.content !== false, matches: result.stdout.split(/\r?\n/).filter(Boolean).slice(0, 200), }` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `{ query, path, content: input.content !== false, matches: result.stdout.split(/\r?\n/).filter(Boolean).slice(0, 200), }` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `this.machines.get`, `searchText.parse`, `guestPath`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `searchText.parse`, `guestPath`, `quote`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: { query: string; path?: string; content?: boolean }; signal: AbortSignal optional
   * 输出 / Returns: `{ query, path, content: input.content !== false, matches: result.stdout.split(/\r?\n/).filter(Boolean).slice(0, 200), }`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code && !result.stdout.trim()`; 异常 / errors `new AppError(result.stderr.trim() || '搜索失败', 502)`.
   */
  async search(id: string, input: { query: string; path?: string; content?: boolean }, signal?: AbortSignal) {
    this.machines.get(id);
    const query = searchText.parse(input.query);
    const path = guestPath(input.path || '/workspace');
    const command =
      input.content === false
        ? `find ${quote(path)} -maxdepth 5 -type f -iname ${quote(`*${query}*`)} -print | head -n 200`
        : `if command -v rg >/dev/null; then rg -F -n --hidden --glob '!.git' --max-count 20 ${quote(query)} ${quote(path)} 2>/dev/null | head -n 200; else grep -RInF --exclude-dir=.git ${quote(query)} ${quote(path)} 2>/dev/null | head -n 200; fi`;
    const result = await this.machines.exec(id, command, 30_000, signal);
    if (result.code && !result.stdout.trim()) throw new AppError(result.stderr.trim() || '搜索失败', 502);
    return {
      query,
      path,
      content: input.content !== false,
      matches: result.stdout.split(/\r?\n/).filter(Boolean).slice(0, 200),
    };
  }
  /**
   * 入口 / Entry: FeatureSuite.package.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.jobs.start( `${this.workspaces.projects.key(id)}:package`, async (log, taskSignal) => { const combined = taskSignal && s…` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `this.jobs.start( `${this.workspaces.projects.key(id)}:package`, async (log, taskSignal) => { const combined = taskSignal && s…` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `z.enum().parse`, `z.enum`, `packageName.parse`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.enum().parse`, `z.enum`, `packageName.parse`, `inline.includes`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: Omit<Extract<FeatureAction, { action: 'package' }>, 'action'>; signal: AbortSignal optional
   * 输出 / Returns: `this.jobs.start( `${this.workspaces.projects.key(id)}:package`, async (log, taskSignal) => { const combined = taskSignal && s…`.
   * 副作用 / Effects: `operation.startsWith`; `this.jobs.start`.
   * 拒绝 / Refusals: 条件 / conditions `['search', 'install', 'remove', 'upgrade'].includes(operation) && !name`; 异常 / errors `new AppError('此操作需要软件包名称')`.
   */
  package(
    id: string,
    input: Omit<Extract<FeatureAction, { action: 'package' }>, 'action'>,
    signal?: AbortSignal,
  ) {
    const operation = z.enum(['list', 'search', 'install', 'remove', 'update', 'upgrade', 'upgrade-all',
      ...packageCacheOperations]).parse(input.operation);
    const name = input.name ? packageName.parse(input.name) : undefined;
    if (['search', 'install', 'remove', 'upgrade'].includes(operation) && !name)
      throw new AppError('此操作需要软件包名称');
    const vm = this.machines.get(id);
    const manager = !vm.distro || vm.distro === 'alpine' ? 'apk' : 'apt-get';
    const argument = quote(name || '');
    const regular = operation as 'list' | 'search' | 'install' | 'remove' | 'update' |
      'upgrade' | 'upgrade-all';
    const command = operation.startsWith('cache-')
      ? packageCacheScript(vm.distro, operation as (typeof packageCacheOperations)[number], name)
      : manager === 'apk'
        ? {
            list: 'apk info',
            search: `apk search -v ${argument}`,
            install: `apk add --no-cache --timeout 30 ${argument}`,
            remove: `apk del ${argument}`,
            update: 'apk update',
            upgrade: `apk upgrade ${argument}`,
            'upgrade-all': 'apk upgrade',
          }[regular]
        : {
            list: "dpkg-query -W -f='${Package}\\t${Version}\\n'",
            search: `apt-cache search ${argument}`,
            install: `DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=2 install -y ${argument}`,
            remove: `DEBIAN_FRONTEND=noninteractive apt-get remove -y ${argument}`,
            update: 'apt-get update',
            upgrade: `DEBIAN_FRONTEND=noninteractive apt-get --only-upgrade install -y ${argument}`,
            'upgrade-all': 'DEBIAN_FRONTEND=noninteractive apt-get upgrade -y',
          }[regular];
    return this.jobs.start(
      `${this.workspaces.projects.key(id)}:package`,
      async (log, taskSignal) => {
        const combined = taskSignal && signal ? AbortSignal.any([taskSignal, signal]) : taskSignal;
        const result = await guestTask(this.machines, id, `set -eu\n${command}`, combined, log, 300_000);
        if (result.code !== 0) throw new AppError(result.stderr.trim() || `软件包操作失败（${result.code}）`);
      },
      {
        title: `软件包${{ list: '列表', search: '搜索', install: '安装', remove: '卸载', update: '更新',
          upgrade: '升级', 'upgrade-all': '全部升级',
          'cache-list': '缓存列表', 'cache-prefetch': '预取缓存',
          'cache-install': '离线安装', 'cache-clear': '清除缓存' }[operation]}`,
        vmId: id,
        projectId: this.workspaces.projects.current(id),
        action: `package:${operation}${name ? `:${name}` : ''}`,
      },
    );
  }
  /**
   * 入口 / Entry: FeatureSuite.networkTest.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ target: host, output: JSON.stringify(result, null, 2), code: result.code, }` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `{ target: host, output: JSON.stringify(result, null, 2), code: result.code, }` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `hostTarget.parse`, `runEngineeringOperation`, `capabilityParameters` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `hostTarget.parse`, `runEngineeringOperation`, `capabilityParameters`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; target: string; signal: AbortSignal optional
   * 输出 / Returns: `{ target: host, output: JSON.stringify(result, null, 2), code: result.code, }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async networkTest(id: string, target: string, signal?: AbortSignal) {
    const host = hostTarget.parse(target);
    const result = await runEngineeringOperation(
      this.machines,
      this.workspaces,
      id,
      'network-diagnostics',
      capabilityParameters('network-diagnostics', { target: host }),
      signal || new AbortController().signal,
    );
    return {
      target: host,
      output: JSON.stringify(result, null, 2),
      code: result.code,
    };
  }
  /**
   * 入口 / Entry: FeatureSuite.discoverPorts.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ports: [...ports].filter((port) => port > 0 && port < 65536).sort((a, b) => a - b) }` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `{ ports: [...ports].filter((port) => port > 0 && port < 65536).sort((a, b) => a - b) }` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `this.machines.exec`, `result.stdout.split`, `line.match`, `ports.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.exec`, `result.stdout.split`, `line.match`, `ports.add`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `match`.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `{ ports: [...ports].filter((port) => port > 0 && port < 65536).sort((a, b) => a - b) }`.
   * 副作用 / Effects: `this.machines.exec`; `ports.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async discoverPorts(id: string, signal?: AbortSignal) {
    const result = await this.machines.exec(
      id,
      `(command -v ss >/dev/null && ss -ltnH) || (cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk '$4 == "0A" { split($2,a,":"); print a[2] }' | while read -r port; do printf 'LISTEN *:%d\\n' "0x$port"; done)`,
      15_000,
      signal,
    );
    const ports = new Set<number>();
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = line.match(/:(\d+)\s*$/);
      if (match) ports.add(Number(match[1]));
    }
    return { ports: [...ports].filter((port) => port > 0 && port < 65536).sort((a, b) => a - b) };
  }
  /**
   * 入口 / Entry: FeatureSuite.securityScan.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ checkedAt: new Date().toISOString(), findings, output, code: result.code, vulnerabilityScan }` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `{ checkedAt: new Date().toISOString(), findings, output, code: result.code, vulnerabilityScan }` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `this.machines.exec`, `inline.trim`, `scanGuestVulnerabilities`, `inline.join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.exec`, `inline.trim`, `scanGuestVulnerabilities`, `inline.join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `{ checkedAt: new Date().toISOString(), findings, output, code: result.code, vulnerabilityScan }`.
   * 副作用 / Effects: `this.machines.exec`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async securityScan(id: string, signal?: AbortSignal) {
    const result = await this.machines.exec(
      id,
      `set +e\nprintf 'IDENTITY\\n'; id\nprintf 'SSH\\n'; (sshd -T 2>/dev/null || true) | grep -E 'permitrootlogin|passwordauthentication|pubkeyauthentication'\nprintf 'UPDATES\\n'; if command -v apk >/dev/null; then apk version -l '<'; elif command -v apt-get >/dev/null; then apt list --upgradable 2>/dev/null | tail -n +2; fi\nprintf 'WORLD-WRITABLE\\n'; find /etc /usr/local/bin -xdev -type f -perm -0002 -print 2>/dev/null | head -n 50`,
      30_000,
      signal,
    );
    const localOutput = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.trim();
    const vulnerabilityScan = await scanGuestVulnerabilities(this.machines, id, signal);
    const vulnerabilityDetails = vulnerabilityScan.status === 'complete'
      ? [
          `OSV: ${vulnerabilityScan.ecosystem}，检查 ${vulnerabilityScan.packagesChecked} 个源包，${vulnerabilityScan.affectedPackages} 个受影响包，${vulnerabilityScan.vulnerabilityCount} 个不同漏洞编号`,
          ...vulnerabilityScan.matches.map((item) =>
            `${item.name}@${item.version}: ${item.ids.join(', ')}`),
        ].join('\n')
      : `OSV 漏洞匹配未完成：${vulnerabilityScan.error || '未知错误'}`;
    const output = `${localOutput}\nCVE\n${vulnerabilityDetails}`.trim();
    const findings = [
      ...(localOutput.includes('passwordauthentication yes') ? ['SSH 允许密码认证'] : []),
      ...(localOutput.includes('permitrootlogin yes') ? ['SSH 允许 root 密码登录'] : []),
      ...(localOutput.split('UPDATES\n')[1]?.split('WORLD-WRITABLE\n')[0].trim() ? ['存在待更新的软件包'] : []),
      ...(localOutput.split('WORLD-WRITABLE\n')[1]?.trim() ? ['发现可写系统文件'] : []),
      ...(vulnerabilityScan.status === 'complete' && vulnerabilityScan.vulnerabilityCount
        ? [`OSV 发现 ${vulnerabilityScan.affectedPackages} 个受影响软件包（${vulnerabilityScan.vulnerabilityCount} 个漏洞编号）`]
        : []),
      ...(vulnerabilityScan.status !== 'complete' ? ['漏洞库匹配未完成，结果不能视为无漏洞'] : []),
    ];
    return { checkedAt: new Date().toISOString(), findings, output, code: result.code,
      vulnerabilityScan };
  }
  /**
   * 入口 / Entry: FeatureSuite.action.
   * 功能：在汇集自动化功能、指标告警和实例动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.sample(id)` / `this.memoryTarget(id, value.memoryMiB)` 供上层消费（`FeatureSuite`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureSuite`; this entry produces `this.sample(id)` / `this.memoryTarget(id, value.memoryMiB)` for its caller. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `featureSuiteActionRequest.parse`, `this.sample`, `this.memoryTarget`, `this.applyPreset` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `featureSuiteActionRequest.parse`, `this.sample`, `this.memoryTarget`, `this.applyPreset`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value.action === 'sample'`; `value.action === 'memory-target'`; `value.action === 'apply-preset'`.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal optional
   * 输出 / Returns: `this.sample(id)`; `this.memoryTarget(id, value.memoryMiB)`; `this.applyPreset(id, value.preset)`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async action(id: string, input: unknown, signal?: AbortSignal) {
    const value = featureSuiteActionRequest
      .parse(input) as FeatureAction;
    if (value.action === 'sample') return this.sample(id);
    if (value.action === 'memory-target') return this.memoryTarget(id, value.memoryMiB);
    if (value.action === 'apply-preset') return this.applyPreset(id, value.preset);
    if (value.action === 'disk-analysis') return this.diskAnalysis(id, value, signal);
    if (value.action === 'dev') return this.dev(id, value, signal);
    if (value.action === 'search') return this.search(id, value, signal);
    if (value.action === 'package') return this.package(id, value, signal);
    if (value.action === 'network-test') return this.networkTest(id, value.target, signal);
    if (value.action === 'security-scan') return this.securityScan(id, signal);
    if (value.action === 'discover-ports') return this.discoverPorts(id, signal);
    if (value.action === 'feature-check') return this.feature(id, { ...value, action: 'check' }, signal);
    if (value.action === 'feature-run') return this.feature(id, { ...value, action: 'run' }, signal);
    return this.acknowledge(id, value.id);
  }
  /**
   * 入口 / Entry: FeatureSuite.tick.
   * 功能：周期采样指标、告警与实例调度策略，并触发符合条件的受管动作。
   * Purpose: Periodically samples metrics/alerts/schedules and triggers eligible managed actions.
   * 设计：跳过关闭、维护或活动冲突的对象；采样失败不使整个周期停止，动作仍需当前领域准入。
   * Design: Closed/maintenance/conflicting work is skipped; sampling failures do not stop the whole cycle and effects still require current admission.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.settingsFor`; `this.store().update`; `this.idleSince.delete`; `this.idleSince.set`; `this.lastSampleAt.set`; 更新 / updates `this.ticking`, `point`, `sampled`, `powerSample`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `this.ticking = false;`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.ticking = false;`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 ，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute ; these statements determine whether a failure is absorbed or rejected again.
   */
  async tick() {
    if (this.closed || this.ticking) return;
    const signal = this.powerAbort.signal;
    if (signal.aborted) return;
    this.ticking = true;
    try {
      const now = new Date();
      const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const policy = await resourcePolicy();
      let powerSample: PowerSample | undefined;
      const scheduled = [...this.machines.records.values()].sort(
        (a, b) => (policy.priorities[b.id] || 0) - (policy.priorities[a.id] || 0),
      );
      for (const vm of scheduled) {
        if (this.closed || signal.aborted) break;
        const maintenance = await inMaintenance(vm.id, now);
        const state = await this.state();
        const settings = this.settingsFor(state, vm.id);
        if (this.backgroundEnabled) {
          // Observe external services outside the metadata transaction. Only
          // applying the observation holds the per-file writer.
          const secrets = settings.alerts.enabled && settings.alerts.secretRotation !== false
            ? await this.observations.secrets?.(vm.id) : undefined;
          await this.store().update(current => this.checkOperationalAlerts(vm.id, current, secrets), { signal });
        }
        const schedule = settings.schedule;
        let sampled = false;
        let point = state.history[vm.id]?.at(-1);
        if (this.machines.state(vm.id) === 'running') {
          try {
            point = await this.sample(vm.id);
            sampled = true;
          } catch {
            /* Missing samples break the idle interval. */
          }
        }
        const sampledAt = point ? Date.parse(point.sampledAt) : NaN;
        const previous = this.lastSampleAt.get(vm.id);
        const probeHealthy =
          sampled &&
          Number.isFinite(sampledAt) &&
          sampledAt <= Date.now() &&
          Date.now() - sampledAt < 120_000;
        const fresh = probeHealthy && (previous === undefined || sampledAt > previous);
        if (this.backgroundEnabled) {
          const status = this.machines.state(vm.id);
          await this.store().update(current => {
            current.availability ||= {};
            observeAvailability(
              (current.availability[vm.id] ||= []),
              status === 'running' && !probeHealthy ? 'unreachable' : status,
              Date.now(),
            );
          }, { signal });
        }
        if (
          !fresh ||
          !Number.isFinite(point?.cpuPercent) ||
          point!.cpuPercent >= 5 ||
          !schedule.enabled ||
          !schedule.idleMinutes
        ) {
          this.idleSince.delete(vm.id);
        } else {
          if (previous === undefined || sampledAt - previous > 120_000) this.idleSince.delete(vm.id);
          if (!this.idleSince.has(vm.id)) this.idleSince.set(vm.id, sampledAt);
        }
        if (fresh) this.lastSampleAt.set(vm.id, sampledAt);
        else this.lastSampleAt.delete(vm.id);
        if (maintenance) {
          this.idleSince.delete(vm.id);
          this.lastSampleAt.delete(vm.id);
          continue;
        }
        const electricity = await powerPolicy(vm.id);
        let allowStart = true;
        if (electricity.enabled) {
          powerSample ||= await (this.observations.power?.(signal) || hostPower(signal));
          if (this.closed || signal.aborted) break;
          const decision = powerDecision(electricity, powerSample);
          allowStart = decision.allowStart;
          if (decision.stop && this.machines.state(vm.id) === 'running') {
            await this.machines.stop(vm.id, false).catch(() => {});
            continue;
          }
        }
        if (this.closed || signal.aborted) break;
        if (!schedule.enabled) continue;
        if (allowStart && schedule.startAt === clock && this.machines.state(vm.id) === 'stopped')
          await this.machines.start(vm.id).catch(() => {});
        if (schedule.stopAt === clock && this.machines.state(vm.id) === 'running')
          await this.machines.stop(vm.id, false).catch(() => {});
        if (schedule.idleMinutes > 0 && this.machines.state(vm.id) === 'running') {
          const since = this.idleSince.get(vm.id);
          if (since !== undefined && sampledAt - since >= schedule.idleMinutes * 60_000) {
            await this.machines.stop(vm.id, false).catch(() => {});
            this.idleSince.delete(vm.id);
            this.lastSampleAt.delete(vm.id);
          }
        }
      }
    } finally {
      this.ticking = false;
    }
  }
  /**
   * 入口 / Entry: FeatureSuite.close.
   * 功能：在汇集自动化功能、指标告警和实例动作中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`, `this.backgroundEnabled`（`FeatureSuite`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `FeatureSuite`; the outcome is recorded in `this.closed`, `this.backgroundEnabled`. Module context: Collects automation, metric alerts and VM actions, delegating background sampling and policy execution to shared scheduling.
   * 处理：通过 `this.powerAbort.abort`, `this.jobs.close`, `this.store().flush`, `this.store` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.powerAbort.abort`, `this.jobs.close`, `this.store().flush`, `this.store`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.powerAbort.abort`; `this.jobs.close`; 更新 / updates `this.closed`, `this.backgroundEnabled`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.powerAbort.abort();
    this.backgroundEnabled = false;
    await this.jobs.close();
    await this.store().flush();
  }
}
