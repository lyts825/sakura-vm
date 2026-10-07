/**
 * 模块职责：管理工程扩展功能配置及动作，区分可持久策略与一次性命令输入。
 * Module purpose: Owns engineering extension settings and actions, distinguishing persistent policies from one-shot commands.
 */
import { jsonValueSchema } from '../shared/contracts/json-values.ts';
import type { IdeV1, TrustedBootServiceV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { EngineeringDomainServices } from './engineering-domain-services.ts';

import { noHostServices, type HostServiceResolver } from './host-service-contracts.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  extendedFeatureCatalog,
  type ExtendedFeature,
  type ExtendedFeatureId,
} from '../shared/catalogs/engineering.ts';
import { AppError } from '../shared/errors.ts';
import { CapabilityActions } from './capability-actions.ts';
import { capabilityParameters, capabilityViews, hasCapability } from './capability-definitions.ts';
import { encryptedImageOptions, qemuSecretObject } from './disk-encryption.ts';
import {
  engineeringOperations,
  operationViews,
  validateOperation,
  type EngineeringOperation,
} from './engineering-operations.ts';
import {
  requireSuccessfulResult,
  runEngineeringOperation,
  type EngineeringResult,
} from './engineering-runner.ts';
import { checkGpgAgentForward, runGpgAgentForward } from './gpg-agent-forward.ts';
import { Jobs } from './jobs.ts';
import { metadataFile } from './metadata-store.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { DATA, ROOT, vmDir } from './paths.ts';
import { projectVersion } from './project-config.ts';
import { projectNetworkNamespace } from './project-network-isolation.ts';
import { ProjectRunScopes } from './project-run-scope.ts';
import { type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { ReverseTunnels } from './reverse-tunnels.ts';
import { secretName } from './secrets.ts';
import { checkSecureErase, runSecureErase } from './secure-erase.ts';

import { inspectTrustedBoot } from './trusted-boot.ts';

export { extendedFeatureCatalog,type ExtendedFeature,type ExtendedFeatureId,type ExtendedFeatureState } from '../shared/catalogs/engineering.ts';

const catalog: ExtendedFeature[] = extendedFeatureCatalog.map(
  ([id, name, category, priority, summary, state]) => ({
    id,
    name,
    category,
    priority,
    summary,
    state,
  }),
);

type FeatureSetting = { enabled: boolean; options: Record<string, unknown>; updatedAt: string };
type FeatureExecution = {
  featureId: ExtendedFeatureId;
  action: 'check' | 'run';
  startedAt: string;
  finishedAt: string;
  ready: boolean;
  result: Record<string, unknown>;
};
type ExtendedState = {
  settings: Record<string, Record<string, FeatureSetting>>;
  manifests: Record<string, { createdAt: string; path: string; entries: number; checksum: string }>;
  executions: Record<string, FeatureExecution[]>;
};
/**
 * 入口 / Entry: defaultState.
 * 功能：从当前输入或状态计算 `({ settings: {}, manifests: {}, executions: {} })`，供调用方后续验证或使用。
 * Purpose: Computes `({ settings: {}, manifests: {}, executions: {} })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: ExtendedState；结果来自 / values from `({ settings: {}, manifests: {}, executions: {} })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const defaultState = (): ExtendedState => ({ settings: {}, manifests: {}, executions: {} });
const idSchema = z.enum(
  extendedFeatureCatalog.map(([id]) => id) as [ExtendedFeatureId, ...ExtendedFeatureId[]],
);
const pathSchema = z.string().optional();
const oneShotFeatures = new Set(['secure-erase', 'gpg-agent-forward', 'ssh-agent-forward']);

/**
 * 入口 / Entry: adapterFor.
 * 功能：在管理工程扩展功能配置及动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `({ id: spec.id, category: spec.category, mode: spec.category === '虚拟机' || spec.category === '网络' ? 'guest-aware' : 'portable'…` 供上层消费（`extended-features.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `extended-features.ts`; this entry produces `({ id: spec.id, category: spec.category, mode: spec.category === '虚拟机' || spec.category === '网络' ? 'guest-aware' : 'portable'…` for its caller. Module context: Owns engineering extension settings and actions, distinguishing persistent policies from one-shot commands.
 * 处理：通过 `inline.includes`, `hasCapability` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.includes`, `hasCapability`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: spec: ExtendedFeature
 * 输出 / Returns: Record<string, unknown>；结果来自 / values from `({ id: spec.id, category: spec.category, mode: spec.category === '虚拟机' || spec.category === '网络' ? 'guest-aware' : 'portable'…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const adapterFor = (spec: ExtendedFeature): Record<string, unknown> => ({
  id: spec.id,
  category: spec.category,
  mode: spec.category === '虚拟机' || spec.category === '网络' ? 'guest-aware' : 'portable',
  actions: ['self-update', 'locale-packs', 'network-isolation'].includes(spec.id) ? ['check'] :
    spec.state === 'available' || hasCapability(spec.id) ? ['configure', 'check', 'run'] : ['configure', 'check'],
  persistent: spec.id !== 'self-update' && spec.id !== 'locale-packs',
});

export const extendedFeatureActionRequest = z
      .discriminatedUnion('action', [
        z
          .object({
            action: z.literal('configure'),
            featureId: idSchema,
            enabled: z.boolean(),
            options: z.record(z.string(), jsonValueSchema).default({}),
          })
          .strict(),
        z.object({ action: z.literal('check'), featureId: idSchema }).strict(),
        z
          .object({
            action: z.literal('run'),
            featureId: idSchema,
            path: pathSchema,
            options: z.record(z.string(), jsonValueSchema).default({}),
          })
          .strict(),
        z
          .object({
            action: z.literal('operation'),
            operation: z.string(),
            parameters: z.record(z.string(), jsonValueSchema).default({}),
          })
          .strict(),
      ]);

export class ExtendedFeatures {
  jobs = new Jobs('extended-features');
  /**
   * 入口 / Entry: ExtendedFeatures.trustedBoot.
   * 功能：向调用者提供 `this.domains.trustedBoot` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.domains.trustedBoot` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: TrustedBootServiceV1 | undefined；结果来自 / values from `this.domains.trustedBoot`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private get trustedBoot(): TrustedBootServiceV1 | undefined { return this.domains.trustedBoot; }
  /**
   * 入口 / Entry: ExtendedFeatures.projectTerminals.
   * 功能：向调用者提供 `this.domains.projectTerminals` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.domains.projectTerminals` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: ProjectTerminals | undefined；结果来自 / values from `this.domains.projectTerminals`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private get projectTerminals(): ProjectTerminals | undefined { return this.domains.projectTerminals; }
  private domains: EngineeringDomainServices;
  /**
   * 入口 / Entry: ExtendedFeatures.tunnels.
   * 功能：向调用者提供 `this.domains.tunnels` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.domains.tunnels` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.domains.tunnels`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private get tunnels() { return this.domains.tunnels; }
  /**
   * 入口 / Entry: ExtendedFeatures.constructor.
   * 功能：建立 ExtendedFeatures 的管理工程扩展功能配置及动作上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ExtendedFeatures context for this module's responsibility: Owns engineering extension settings and actions, distinguishing persistent policies from one-shot commands. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; dependencies: HostServiceResolver default=noHostServices; editor: () => Pick<IdeV1, 'profile'> | undefined optional
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.domains`.
   */
  constructor(
    private machines: Machines,
    private workspaces: WorkspacesV1,
    private dependencies: HostServiceResolver = noHostServices,
    private editor?: () => Pick<IdeV1, 'profile'> | undefined,
  ) {
    this.domains = new EngineeringDomainServices(machines, workspaces, dependencies);
  }
  
  

  /**
   * 入口 / Entry: ExtendedFeatures.file.
   * 功能：把本层请求转交 `join`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `join` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `join(DATA, 'extended-features.json')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file() {
    return join(DATA, 'extended-features.json');
  }
  /**
   * 入口 / Entry: ExtendedFeatures.store.
   * 功能：在管理工程扩展功能配置及动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `metadataFile(this.file(), defaultState, raw => { const value = raw as ExtendedState; value.executions ||= {}; return value; }…` 供上层消费（`ExtendedFeatures`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ExtendedFeatures`; this entry produces `metadataFile(this.file(), defaultState, raw => { const value = raw as ExtendedState; value.executions ||= {}; return value; }…` for its caller. Module context: Owns engineering extension settings and actions, distinguishing persistent policies from one-shot commands.
   * 处理：通过 `metadataFile`, `this.file` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `metadataFile`, `this.file`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `metadataFile(this.file(), defaultState, raw => { const value = raw as ExtendedState; value.executions ||= {}; return value; }…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private store() {
    return metadataFile(this.file(), defaultState, raw => {
      const value = raw as ExtendedState;
      value.executions ||= {}; return value;
    });
  }
  /**
   * 入口 / Entry: ExtendedFeatures.state.
   * 功能：在管理工程扩展功能配置及动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(await this.store().read()).value` 供上层消费（`ExtendedFeatures`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ExtendedFeatures`; this entry produces `(await this.store().read()).value` for its caller. Module context: Owns engineering extension settings and actions, distinguishing persistent policies from one-shot commands.
   * 处理：通过 `this.store().read`, `this.store` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.store().read`, `this.store`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `(await this.store().read()).value`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async state() { return (await this.store().read()).value; }
  /**
   * 入口 / Entry: ExtendedFeatures.spec.
   * 功能：在管理工程扩展功能配置及动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `catalog.find((item) => item.id === id)!` 供上层消费（`ExtendedFeatures`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ExtendedFeatures`; this entry produces `catalog.find((item) => item.id === id)!` for its caller. Module context: Owns engineering extension settings and actions, distinguishing persistent policies from one-shot commands.
   * 处理：通过 `idSchema.parse`, `catalog.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `idSchema.parse`, `catalog.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: featureId: string
   * 输出 / Returns: `catalog.find((item) => item.id === id)!`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private spec(featureId: string) {
    const id = idSchema.parse(featureId) as ExtendedFeatureId;
    return catalog.find((item) => item.id === id)!;
  }
  /**
   * 入口 / Entry: ExtendedFeatures.catalog.
   * 功能：在管理工程扩展功能配置及动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ features: catalog, operations: operationViews(), capabilities: capabilityViews('extended'), count: catalog.length, generate…` 供上层消费（`ExtendedFeatures`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ExtendedFeatures`; this entry produces `{ features: catalog, operations: operationViews(), capabilities: capabilityViews('extended'), count: catalog.length, generate…` for its caller. Module context: Owns engineering extension settings and actions, distinguishing persistent policies from one-shot commands.
   * 处理：通过 `operationViews`, `capabilityViews` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `operationViews`, `capabilityViews`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ features: catalog, operations: operationViews(), capabilities: capabilityViews('extended'), count: catalog.length, generate…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async catalog() {
    return {
      features: catalog,
      operations: operationViews(),
      capabilities: capabilityViews('extended'),
      count: catalog.length,
      generatedAt: new Date().toISOString(),
    };
  }
  /**
   * 入口 / Entry: ExtendedFeatures.view.
   * 功能：在管理工程扩展功能配置及动作中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ projectId, features: catalog, operations: operationViews(), capabilities: capabilityViews('extended'), settings: state.sett…` 供上层消费（`ExtendedFeatures`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ExtendedFeatures`; this entry produces `{ projectId, features: catalog, operations: operationViews(), capabilities: capabilityViews('extended'), settings: state.sett…` for its caller. Module context: Owns engineering extension settings and actions, distinguishing persistent policies from one-shot commands.
   * 处理：通过 `this.machines.get`, `this.state`, `this.workspaces.projects.current`, `operationViews` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.state`, `this.workspaces.projects.current`, `operationViews`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ projectId, features: catalog, operations: operationViews(), capabilities: capabilityViews('extended'), settings: state.sett…`.
   * 副作用 / Effects: 更新 / updates `state.executions`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string) {
    this.machines.get(id);
    const state = await this.state();
    state.executions ||= {};
    const projectId = this.workspaces.projects.current(id);
    return {
      projectId,
      features: catalog,
      operations: operationViews(),
      capabilities: capabilityViews('extended'),
      settings: state.settings[id] || {},
      manifest: state.manifests[id],
      executions: (state.executions[id] || []).slice(-50).reverse(),
      jobs: this.jobs
        .list()
        .filter((job) => job.vmId === id && (job.projectId || 'default') === projectId)
        .slice(0, 30),
    };
  }
  /**
   * 入口 / Entry: ExtendedFeatures.configure.
   * 功能：在管理工程扩展功能配置及动作中，校验并提交领域状态变更；本入口产生 `(await this.store().update(state => { const settings = (state.settings[id] ||= {}); settings[value.featureId] = { enabled: va…` 供上层消费（`ExtendedFeatures`）。
   * Purpose: Validates and commits a domain state change in `ExtendedFeatures`; this entry produces `(await this.store().update(state => { const settings = (state.settings[id] ||= {}); settings[value.featureId] = { enabled: va…` for its caller. Module context: Owns engineering extension settings and actions, distinguishing persistent policies from one-shot commands.
   * 处理：通过 `this.machines.get`, `z.object().strict().parse`, `z.object().strict`, `z.object` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `z.object().strict().parse`, `z.object().strict`, `z.object`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value.featureId === 'disk-encryption'`.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `(await this.store().update(state => { const settings = (state.settings[id] ||= {}); settings[value.featureId] = { enabled: va…`.
   * 副作用 / Effects: `this.store().update`; 更新 / updates `value.options`.
   * 拒绝 / Refusals: 条件 / conditions `oneShotFeatures.has(value.featureId) && Object.keys(value.options).length`; 异常 / errors `new AppError('一次性命令与确认不能保存为持久配置', 409)`.
   */
  async configure(id: string, input: unknown) {
    this.machines.get(id);
    const value = z
      .object({
        featureId: idSchema,
        enabled: z.boolean(),
        options: z.record(z.string(), z.unknown()).default({}),
      })
      .strict()
      .parse(input);
    if (value.featureId === 'disk-encryption')
      value.options = z.object({ secretName: secretName.optional() }).strict().parse(value.options);
    if (oneShotFeatures.has(value.featureId) &&
        Object.keys(value.options).length)
      throw new AppError('一次性命令与确认不能保存为持久配置', 409);
    return (await this.store().update(state => {
      const settings = (state.settings[id] ||= {});
      settings[value.featureId] = {
        enabled: value.enabled,
        options: value.options,
        updatedAt: new Date().toISOString(),
      };

      return settings[value.featureId];
    })).result;
  }
  /**
   * 入口 / Entry: ExtendedFeatures.probe.
   * 功能：针对工程扩展读取实例、工具与项目状态，生成实际可用性和操作前提。
   * Purpose: Probes VM/tool/project state for engineering extensions and reports measured availability/prerequisites.
   * 设计：按功能分支读取真实状态；缺少工具、停止实例或不支持平台保留明确不可用原因。
   * Design: Each branch probes real state and keeps explicit reasons for missing tools, stopped VMs or unsupported platforms.
   * 输入 / Inputs: id: string; spec: ExtendedFeature; signal: AbortSignal optional; options: Record<string, unknown> default={}
   * 输出 / Returns: `{ ready: true, state: spec.state, adapter, commandline: this.machines.commandline(id) }`; `{ ...base, ready: false, active: false, verification: 'not-configured', reason: '在项目设置中选择独立命名空间，完成目录权限迁移后启动项目。' }`; `{ ...base, ready: false, active: false, verification: 'stopped', reason: '启动或恢复实例后，可只读核对原项目账号及网络策略。' }`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `spec.id === 'network-isolation'`; `!live || this.machines.live.get(id) !== live || this.machines.state(id) !== 'running' || (current._workspace || 'default') !=…`; 异常 / errors `new AppError('网络检查期间项目配置已改变，请重新检查', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   * 失败处理：catch 分支执行 `signal?.throwIfAborted();`; `return { ...base, ready: false, active: false, verification: 'unverified', code: error instanceof AppError && error.code ? er…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `signal?.throwIfAborted();`; `return { ...base, ready: false, active: false, verification: 'unverified', code: error instanceof AppError && error.code ? er…`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async probe(
    id: string,
    spec: ExtendedFeature,
    signal?: AbortSignal,
    options: Record<string, unknown> = {},
  ) {
    const current = await this.state();
    const configured = current.settings[id]?.[spec.id];
    const adapter = {
      ...adapterFor(spec),
      enabled: configured?.enabled ?? true,
      options: { ...(configured?.options || {}), ...options },
    };
    if (spec.id === 'qemu-commandline')
      return { ready: true, state: spec.state, adapter, commandline: this.machines.commandline(id) };
    if (spec.id === 'network-isolation') {
      const project = await this.workspaces.config(id);
      const namespace = projectNetworkNamespace(project);
      const base = { executed: false, state: spec.state, adapter,
        mode: project.networkIsolation || 'host', namespace, projectId: project._workspace || 'default' };
      if (!namespace) return { ...base, ready: false, active: false, verification: 'not-configured',
        reason: '在项目设置中选择独立命名空间，完成目录权限迁移后启动项目。' };
      if (this.machines.state(id) !== 'running') return { ...base, ready: false, active: false,
        verification: 'stopped', reason: '启动或恢复实例后，可只读核对原项目账号及网络策略。' };
      const live = this.machines.live.get(id);
      try {
        const proof = await new ProjectRunScopes(this.machines).networkStatus(id, project, signal);
        const current = await this.workspaces.config(id);
        signal?.throwIfAborted();
        if (!live || this.machines.live.get(id) !== live || this.machines.state(id) !== 'running' ||
            (current._workspace || 'default') !== base.projectId || projectVersion(current) !== projectVersion(project))
          throw new AppError('网络检查期间项目配置已改变，请重新检查', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        return { ...base, ready: true, active: true, verification: 'verified',
          identity: { account: proof.identity.account, uid: proof.identity.uid, gid: proof.identity.gid,
            identityId: proof.identity.identityId, revision: proof.identity.revision },
          network: proof.network,
          checks: { namespace: true, projectAccount: true, uidEgress: true, noNewPrivileges: true },
          reason: '原项目账号、独立回环网络、共享网络 UID 出站规则及普通服务提权限制已核对。客户机管理员及其他账号保持各自的权限范围。' };
      } catch (error) {
        signal?.throwIfAborted();
        return { ...base, ready: false, active: false, verification: 'unverified',
          code: error instanceof AppError && error.code ? error.code : 'PROJECT_IDENTITY_NETWORK_UNVERIFIED',
          reason: error instanceof AppError ? error.message : '原项目网络策略未能完整核对，请恢复原运行记录后重试。' };
      }
    }
    if (spec.id === 'tpm-secure-boot') {
      const [inspection, configured] = await Promise.all([
        inspectTrustedBoot(this.machines, id, undefined, signal),
        this.trustedBoot?.view(id)]);
      return { ...inspection,
        ready: inspection.ready && !!configured?.attached && !!configured.policy.enabled,
        policy: configured?.policy, attached: configured?.attached,
        state: spec.state, adapter };
    }
    if (spec.id === 'disk-encryption') {
      const status = await this.machines.diskEncryptionStatus(id);
      return { ready: status.encrypted === status.enabled && (!status.enabled || status.keyAvailable),
        executed: false, state: spec.state,
        adapter, ...status,
        reason: status.enabled
          ? '实例磁盘已加密；启动时使用同名私密配置解锁。导入其他主机后需重新保存口令。'
          : '先在开发 → 私密配置中保存 16–256 字符口令，再停止实例、清除内部快照并运行此能力，参数为 {"secretName":"名称"}。' };
    }
    if (spec.id === 'cow-workspace')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason:
          '启用沙箱插件，在沙箱工作台创建时选择“临时 COW：停止即丢弃”。每次停止恢复初始磁盘，任务日志和明确提取的产物保留。',
      };
    if (spec.id === 'rescue-boot')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason:
          '启用磁盘快照插件，在实例快照页使用“只读救援”，检查分区、执行限时命令并保存选定产物。源实例必须停止。',
      };
    if (spec.id === 'api-explorer')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '系统设置 → 开发接口，浏览 OpenAPI、试读状态并下载 JavaScript SDK。',
      };
    if (spec.id === 'self-update')
      return {
        ready: existsSync(join(ROOT, 'scripts', 'self-update.mjs')) &&
          existsSync(join(ROOT, 'scripts', 'launch.mjs')),
        executed: false,
        state: spec.state,
        adapter,
        reason: '从安装目录使用 npm run update:check / update:stage / update:activate；重启后自动健康检查，失败回滚，也可手动运行 npm run update:rollback。升级仅替换应用版本，保留宿主数据与 QEMU/PosixLoom。',
      };
    if (spec.id === 'explorer-integration')
      return {
        ready: process.platform === 'win32',
        executed: false,
        state: spec.state,
        adapter,
        reason:
          '系统设置 → 管理 Windows 集成，注册当前用户右键菜单；根据已保存的同步目录定位项目。需启用项目、文件与目录同步插件。',
      };
    if (spec.id === 'session-lock')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '系统设置 → 管理会话锁定，设置解锁密码和空闲时间；锁定会拒绝控制请求并断开终端与桌面。',
      };
    if (spec.id === 'hello-unlock')
      return { ready: process.platform === 'win32', executed: false,
        state: spec.state, adapter,
        reason: process.platform === 'win32'
          ? '在 localhost 为管理员登记本机平台通行密钥并启用控制面锁定；锁定页可用 Windows Hello 解锁。'
          : 'Windows Hello 解锁需要 Windows 主机。' };
    if (spec.id === 'offline-pwa')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '系统设置 → 离线监控 PWA，打开独立只读页面并启用浏览器离线缓存。',
      };
    if (spec.id === 'local-dns-alias')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '网络插件 → 服务与端口可生成 .sakura.localhost 入口别名；明确启用 Windows 系统域名解析后同步 Sakura 管理的 hosts 区块，需以管理员身份运行。',
      };
    if (spec.id === 'multi-host-view' || spec.id === 'multi-host-health')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '系统设置 → 主机配对与多主机状态，查看已配对主机的资源、最近检查时间和连接错误，并可撤销访问。',
      };
    if (spec.id === 'accessibility-audit')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '顶栏无障碍检查模式：实际扫描当前页面、定位元素、查看键盘焦点并导出报告。',
      };
    if (spec.id === 'locale-packs')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '系统设置 → 语言与区域：在本浏览器切换简体/繁体中文、时区和数字格式，保存后重新载入界面。',
      };
    if (spec.id === 'shortcut-editor')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '系统设置 → 快捷键编辑器，保存本浏览器的全局按键及当前实例项目覆盖；冲突会阻止保存。',
      };
    if (spec.id === 'backup-dedup')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '已接入快照页的备份策略；启用本机内容块去重后创建备份，在全局去重能力中查看占用及回收。',
      };
    if (spec.id === 'signed-bundles')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '打开镜像库或实例快照页的“签名实例包”，启用严格导入并管理受信任 Ed25519 公钥。',
      };
    if (spec.id === 'secret-rotation' || spec.id === 'clipboard-redaction')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason:
          spec.id === 'secret-rotation'
            ? '开发 → 私密配置中为每个条目设置轮换周期，提醒进入能力中心的通知列表。'
            : '设置 → 剪贴板敏感检测，启用后检查本页面复制/剪切和桌面双向文本传递。',
      };
    if (
      [
        'watch-sync',
        'rename-detection',
        'path-sync-policy',
        'sync-rollback',
        'sync-window',
        'sync-queue',
        'merge-drivers',
      ].includes(spec.id)
    )
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '已接入同步面板；打开工作空间 → 同步配置，按路径设置驱动并预览冲突处理后执行。',
      };
    if (spec.id === 'qcow2-scrub') {
      try {
        this.machines.requireStopped(id);
        const vm = this.machines.get(id);
        const disk = join(vmDir(id), 'disk.qcow2');
        const result = vm.diskEncryption
          ? await this.machines.withDiskSecret(vm, (secret) => this.machines.engine.run(
              'sakura-img', ['check', '--object', qemuSecretObject(secret), '--image-opts',
                encryptedImageOptions(disk)], { signal, timeoutMs: 120000 }))
          : await this.machines.engine.run('sakura-img', ['check', '-f', 'qcow2', disk],
              { signal, timeoutMs: 120000 });
        return { ready: true, state: spec.state, adapter, output: result.trim() || 'QCOW2 检查通过' };
      } catch (error) {
        return {
          ready: false,
          state: spec.state,
          adapter,
          executed: false,
          reason: String((error as Error).message || error),
        };
      }
    }
    const commands: Partial<Record<ExtendedFeatureId, string>> = {
      'guest-quota': 'command -v quota >/dev/null && quota -s',
    };
    if (commands[spec.id]) {
      const result = await this.runGuest(id, commands[spec.id]!, signal).catch(() => null);
      return {
        ready: false,
        executed: false,
        state: spec.state,
        adapter,
        probePassed: result?.code === 0,
        output: result?.stdout,
        reason: '仅提供环境探测，尚无完整管理流程。',
      };
    }
    return {
      ready: false,
      state: spec.state,
      adapter,
      executed: false,
      liveProbe: false,
      reason: '当前仅提供配置和记录，尚无可执行的客户机或宿主实现。',
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * 入口 / Entry: ExtendedFeatures.executeFeature.
   * 功能：按扩展功能 ID 选择工程执行方案，连接客户机运行器或对应领域服务。
   * Purpose: Selects engineering execution by extension ID and invokes the guest runner or owning domain.
   * 设计：输入先按目录契约验证，项目代码仍通过捕获的账户运行域执行，返回值保留原检查退出码。
   * Design: Catalogue validation precedes execution; project code uses the captured account scope and results retain check exit status.
   * 输入 / Inputs: id: string; spec: ExtendedFeature; action: 'check' | 'run'; signal: AbortSignal optional; options: Record<string, unknown> optional
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `this.tunnels.stop`; `this.store().update`; 更新 / updates `result`.
   * 拒绝 / Refusals: 条件 / conditions `action === 'run' && configured?.enabled === false`; `spec.id === 'self-update' && action === 'run'`; `spec.id === 'network-isolation' && action === 'run'`; 异常 / errors `new AppError('此能力已禁用', 409)`; `new AppError('请在安装目录运行离线更新命令；此入口仅供检查', 409)`.
   */
  private async executeFeature(
    id: string,
    spec: ExtendedFeature,
    action: 'check' | 'run',
    signal?: AbortSignal,
    options?: Record<string, unknown>,
  ) {
    const startedAt = new Date().toISOString();
    const configured = (await this.state()).settings[id]?.[spec.id];
    if (action === 'run' && configured?.enabled === false) throw new AppError('此能力已禁用', 409);
    const merged = oneShotFeatures.has(spec.id) ? options || {} :
      { ...configured?.options, ...options };
    if (spec.id === 'self-update' && action === 'run')
      throw new AppError('请在安装目录运行离线更新命令；此入口仅供检查', 409);
    if (spec.id === 'network-isolation' && action === 'run')
      throw new AppError('请在项目设置中切换网络模式，再启动项目', 409);
    if (spec.id === 'tpm-secure-boot' && action === 'run')
      throw new AppError('请在资源设置中启用 TPM 与安全启动，然后重启 UEFI 实例；此入口仅检查证据', 409);
    const operation = Object.entries(engineeringOperations).find(
      ([_, value]) => value.feature === spec.id,
    )?.[0] as EngineeringOperation | undefined;
    let result: Record<string, unknown> & { ready: boolean };
    if (spec.id === 'secure-erase') {
      result = action === 'check'
        ? await checkSecureErase(this.machines, this.workspaces, id, signal)
        : await runSecureErase(this.machines, this.workspaces, id, merged, signal);
    } else if (spec.id === 'gpg-agent-forward') {
      result = action === 'check'
        ? await checkGpgAgentForward(this.machines, id, signal)
        : await runGpgAgentForward(this.machines, id, merged, signal, this.workspaces, this.projectTerminals);
    } else if (spec.id === 'reverse-tunnel') {
      if (action === 'check') result = await this.tunnels.check(id, signal);
      else {
        const p = capabilityParameters('reverse-tunnel', merged);
        if (p.mode === 'open') {
          if (!p.guestPort) throw new AppError('开启隧道需要客户机端口');
          result = await this.tunnels.open(id, Number(p.guestPort), Number(p.durationSeconds), signal);
        } else if (p.mode === 'close') {
          const closed = await this.tunnels.stop(id);
          result = { code: 0, ready: true, executed: true, closed, ...this.tunnels.status(id) };
        } else result = { code: 0, ready: true, executed: true, ...this.tunnels.status(id) };
      }
    } else if (spec.id === 'disk-encryption') {
      if (action === 'run') {
        const input = z.object({ secretName }).strict().parse(merged);
        const status = await this.machines.encryptDisk(id, input.secretName, signal);
        result = { ready: status.enabled && status.encrypted, executed: true, ...status };
      } else result = await this.probe(id, spec, signal, merged);
    } else if (hasCapability(spec.id)) {
      const runner = new CapabilityActions(this.machines, this.workspaces, this.projectTerminals, this.editor?.());
      result =
        action === 'run'
          ? await runner.run(id, spec.id, merged, signal || new AbortController().signal)
          : await runner.check(id, spec.id, signal);
    } else if (action === 'run' && operation) {
      const validated = validateOperation({ operation, parameters: merged });
      const executed = await this.runOperation(id, operation, validated.parameters, signal);
      result = { ...executed, ready: executed.code === 0, executed: true };
    } else if (spec.id === 'network-isolation' || spec.id === 'tpm-secure-boot') {
      result = await this.probe(id, spec, signal, merged);
    } else if (spec.id === 'vm-suspend') {
      if (action === 'run') {
        const input = z
          .object({ mode: z.enum(['pause', 'resume']) })
          .strict()
          .parse(merged);
        await (input.mode === 'pause' ? this.machines.suspend(id) : this.machines.resume(id));
      }
      result = {
        ready: ['running', 'paused'].includes(this.machines.state(id)),
        executed: action === 'run',
        status: this.machines.state(id),
      };
    } else if (action === 'run' && spec.state !== 'available') {
      throw new AppError('此能力尚无完整执行器，请查看目录中的实现状态', 501);
    } else if (operation) {
      const probe = await this.runGuest(
        id,
        'command -v python3 >/dev/null && python3 --version',
        signal,
      ).catch(() => null);
      result = {
        ready: probe?.code === 0,
        executed: false,
        operation,
        state: spec.state,
        reason:
          probe?.code === 0
            ? '工程入口已实现；具体操作仍需按参数检查项目与工具依赖。'
            : '需要运行中的客户机和 Python 3。',
      };
    } else {
      result = await this.probe(id, spec, signal, merged);
      if (spec.state !== 'available') result = { ...result, ready: false, executed: false };
    }
    /**
     * 入口 / Entry: ExtendedFeatures.executeFeature.callback@560.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.store().update）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.store().update).
     * 输入 / Inputs: state
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `history.push`; `history.shift`; 更新 / updates `state.executions`, `state.executions[id]`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    await this.store().update(state => {
      state.executions ||= {};
      const history = (state.executions[id] ||= []);
      history.push({
        featureId: spec.id,
        action,
        startedAt,
        finishedAt: new Date().toISOString(),
        ready: Boolean(result.ready),
        result,
      });
      while (history.length > 50) history.shift();
    });
    return result;
  }
  /**
   * 入口 / Entry: ExtendedFeatures.runGuest.
   * 功能：在管理工程扩展功能配置及动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.exec(id, `set +e\n${command}`, 60000, signal)` 供上层消费（`ExtendedFeatures`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ExtendedFeatures`; this entry produces `this.machines.exec(id, `set +e\n${command}`, 60000, signal)` for its caller. Module context: Owns engineering extension settings and actions, distinguishing persistent policies from one-shot commands.
   * 处理：通过 `this.machines.state`, `this.machines.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.state`, `this.machines.exec`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; command: string; signal: AbortSignal optional
   * 输出 / Returns: `this.machines.exec(id, `set +e\n${command}`, 60000, signal)`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('请先启动发行版', 409)`.
   */
  private async runGuest(id: string, command: string, signal?: AbortSignal) {
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    return this.machines.exec(id, `set +e\n${command}`, 60000, signal);
  }
  /**
   * 入口 / Entry: ExtendedFeatures.runOperation.
   * 功能：在管理工程扩展功能配置及动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value` / `runEngineeringOperation( this.machines, this.workspaces, id, operation, parameters, signal || new AbortController().signal, {…` 供上层消费（`ExtendedFeatures`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ExtendedFeatures`; this entry produces `value` / `runEngineeringOperation( this.machines, this.workspaces, id, operation, parameters, signal || new AbortController().signal, {…` for its caller. Module context: Owns engineering extension settings and actions, distinguishing persistent policies from one-shot commands.
   * 处理：通过 `this.spec`, `this.executeFeature`, `onResult`, `runEngineeringOperation` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.spec`, `this.executeFeature`, `onResult`, `runEngineeringOperation`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `operation === 'feature-run'`.
   * 输入 / Inputs: id: string; operation: EngineeringOperation; parameters: Record<string, unknown>; signal: AbortSignal optional; onResult: (result: EngineeringResult) => Promise<void> optional
   * 输出 / Returns: `value`; `runEngineeringOperation( this.machines, this.workspaces, id, operation, parameters, signal || new AbortController().signal, {…`.
   * 副作用 / Effects: `this.executeFeature`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async runOperation(
    id: string,
    operation: EngineeringOperation,
    parameters: Record<string, unknown>,
    signal?: AbortSignal,
    onResult?: (result: EngineeringResult) => Promise<void>,
  ) {
    if (operation === 'feature-run') {
      const spec = this.spec(String(parameters.featureId));
      const mode = parameters.mode === 'check' ? 'check' : 'run';
      const result = await this.executeFeature(
        id,
        spec,
        mode,
        signal,
        (parameters.options || {}) as Record<string, unknown>,
      );
      const value = { operation, code: result.ready ? 0 : 1, result };
      await onResult?.(value);
      return value;
    }
    return runEngineeringOperation(
      this.machines,
      this.workspaces,
      id,
      operation,
      parameters,
      signal || new AbortController().signal,
      { ...(this.projectTerminals ? { terminals: this.projectTerminals } : {}), onResult },
    );
  }

  /**
   * 入口 / Entry: ExtendedFeatures.action.
   * 功能：在管理工程扩展功能配置及动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.configure(id, configuration)` / `this.jobs.start( `${this.workspaces.projects.key(id)}:operation:${validated.operation}`, async (log, taskSignal, _update, sav…` 供上层消费（`ExtendedFeatures`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ExtendedFeatures`; this entry produces `this.configure(id, configuration)` / `this.jobs.start( `${this.workspaces.projects.key(id)}:operation:${validated.operation}`, async (log, taskSignal, _update, sav…` for its caller. Module context: Owns engineering extension settings and actions, distinguishing persistent policies from one-shot commands.
   * 处理：通过 `extendedFeatureActionRequest.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.configure` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `extendedFeatureActionRequest.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.configure`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value.action !== 'check'`; `value.action === 'configure'`; `value.action === 'check'`.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal optional
   * 输出 / Returns: `this.configure(id, configuration)`; `this.jobs.start( `${this.workspaces.projects.key(id)}:operation:${validated.operation}`, async (log, taskSignal, _update, sav…`; `this.executeFeature(id, spec, 'check', signal)`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `this.jobs.start`; `this.executeFeature`.
   * 拒绝 / Refusals: 条件 / conditions `value.action === 'operation'`; `setting?.enabled === false`; 异常 / errors `new AppError('此能力已禁用', 409)`.
   */
  async action(id: string, input: unknown, signal?: AbortSignal) {
    const value = extendedFeatureActionRequest
      .parse(input);
    this.machines.get(id);
    if (value.action !== 'check') this.machines.requireUnlocked?.(id);
    if (value.action === 'configure') {
      const { action: _, ...configuration } = value;
      return this.configure(id, configuration);
    }
    if (value.action === 'operation') {
      const validated = validateOperation({ operation: value.operation, parameters: value.parameters });
      const setting = (await this.state()).settings[id]?.[engineeringOperations[validated.operation].feature];
      if (setting?.enabled === false) throw new AppError('此能力已禁用', 409);
      const projectId = this.workspaces.projects.current(id);
      /**
       * 入口 / Entry: ExtendedFeatures.action.callback@627.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
       * 输入 / Inputs: log; taskSignal; _update; saveResult
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `persist`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      return this.jobs.start(
        `${this.workspaces.projects.key(id)}:operation:${validated.operation}`,
        async (log, taskSignal, _update, saveResult) => {
          let stored = false;
          /**
           * 入口 / Entry: ExtendedFeatures.action.persist.
           * 功能：在管理工程扩展功能配置及动作中，校验并提交领域状态变更；完成下述调用及状态处理（`ExtendedFeatures`）。
           * Purpose: Validates and commits a domain state change in `ExtendedFeatures`; the calls and state transitions below complete the operation. Module context: Owns engineering extension settings and actions, distinguishing persistent policies from one-shot commands.
           * 处理：通过 `saveResult` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `saveResult`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: result: EngineeringResult
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: `saveResult`; 更新 / updates `stored`.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          const persist = async (result: EngineeringResult) => { await saveResult(result); stored = true; };
          const result = await this.runOperation(id, validated.operation, validated.parameters, taskSignal, persist);
          if (!stored) await persist(result);
          log(JSON.stringify(result) + '\n');
          requireSuccessfulResult(result);
        },
        {
          title: '工程操作 · ' + engineeringOperations[validated.operation].name,
          vmId: id,
          projectId,
          action: 'operation:' + validated.operation,
        },
      );
    }
    const spec = this.spec(value.featureId);
    if (value.action === 'check') return this.executeFeature(id, spec, 'check', signal);
    if (hasCapability(spec.id)) {
      const configured = oneShotFeatures.has(spec.id) ? {} :
        (await this.state()).settings[id]?.[spec.id]?.options || {};
      capabilityParameters(spec.id, { ...configured, ...value.options });
    }
    const projectId = this.workspaces.projects.current(id);
    /**
     * 入口 / Entry: ExtendedFeatures.action.callback@653.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: log; taskSignal; _update; saveResult
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.executeFeature`; `saveResult`.
     * 拒绝 / Refusals: 条件 / conditions `!result.ready`; 异常 / errors `new AppError('能力尚未就绪或执行失败', 409)`.
     */
    return this.jobs.start(
      `${this.workspaces.projects.key(id)}:${spec.id}`,
      async (log, taskSignal, _update, saveResult) => {
        const result = await this.executeFeature(id, spec, 'run', taskSignal, {
          ...value.options,
          ...(value.path ? { path: value.path } : {}),
        });
        await saveResult(result);
        log(`${JSON.stringify(result)}\n`);
        if (!result.ready) throw new AppError('能力尚未就绪或执行失败', 409);
      },
      { title: `扩展能力 · ${spec.name}`, vmId: id, projectId, action: `extended:${spec.id}` },
    );
  }
  /**
   * 入口 / Entry: ExtendedFeatures.close.
   * 功能：在管理工程扩展功能配置及动作中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ExtendedFeatures`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ExtendedFeatures`; the calls and state transitions below complete the operation. Module context: Owns engineering extension settings and actions, distinguishing persistent policies from one-shot commands.
   * 处理：通过 `this.jobs.close`, `this.tunnels.close`, `this.store().flush`, `this.store` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.jobs.close`, `this.tunnels.close`, `this.store().flush`, `this.store`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.jobs.close`; `this.tunnels.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `await this.tunnels.close();`; `await this.store().flush();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await this.tunnels.close();`; `await this.store().flush();`; these steps also apply to exceptional exits.
   */
  async close() {
    try {
      await this.jobs.close();
    } finally {
      await this.tunnels.close();
      await this.store().flush();
    }
  }
}
