/**
 * 模块职责：管理项目 Envoy 边车策略及运行状态，校验端口关系和完整项目运行归属。
 * Module purpose: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual as same } from 'node:util';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { writeStore } from './local-store.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectPrivateValues } from './workspaces.ts';
import { projectVersion, type Project } from './project-config.ts';
import { projectIdSchema } from './project-catalog.ts';
import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { ProjectRunScopes, projectIdentityTask } from './project-run-scope.ts';
import {
  ProjectIdentities,
  projectIdentityPayload,
  projectIdentitySchema,
  projectIdentityRunSchema,
  type ProjectIdentity,
  type ProjectIdentityRun,
} from './project-identity.ts';
import {
  ProjectMeshScope,
  projectMeshRecordSchema,
  type ProjectMeshRecord,
} from './project-service-scope.ts';
import {
  reverseTunnelListenerCommand,
  reverseTunnelListenerSchema,
  type ReverseTunnelListener,
} from './reverse-tunnel-transport.ts';
import { meshBinarySchema, meshConfigSchema, meshHostStatusSchema, meshConfigReplySchema, meshConfigCleanSchema, meshProcessReplySchema, meshConfigPlan, meshInspectInput, meshConfigInput, meshProcessInput, meshEnvoyExecution, meshControlCommand, type MeshConfig, type MeshConfigPlan, type MeshHostStatus } from './service-mesh-identity.ts';
import { redactValues } from './secrets.ts';

const policySchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  listenPort: z.number().int().min(1024).max(65535),
  upstreamPort: z.number().int().min(1024).max(65535),
}).strict();
export const serviceMeshPolicy = policySchema.refine(value => value.listenPort !== value.upstreamPort,
  '监听端口与上游端口不能相同');
export const serviceMeshInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('status') }).strict(),
  z.object({ mode: z.literal('save'), policy: serviceMeshPolicy }).strict(),
  z.object({ mode: z.literal('remove') }).strict(),
  z.object({ mode: z.literal('start') }).strict(),
  z.object({ mode: z.literal('stop') }).strict(),
]);
const savedPolicySchema = policySchema.extend({ updatedAt: z.iso.datetime() }).strict()
  .refine(value => value.listenPort !== value.upstreamPort);
type Policy = z.infer<typeof savedPolicySchema>;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const meshConfigPlanSchema = z.object({ projectId: projectIdSchema, identityId: z.uuid(),
  uid: z.number().int().min(20000).max(59999), gid: z.number().int().min(20000).max(59999),
  runId: z.uuid(), bootId: z.uuid(), path: z.string().max(256), sha256: digest,
  bytes: z.number().int().min(1).max(16384), listenPort: z.number().int().min(1024).max(65535),
  upstreamPort: z.number().int().min(1024).max(65535) }).strict()
  .refine(value => value.uid === value.gid && value.listenPort !== value.upstreamPort &&
    value.path === '/etc/sakura/mesh-uid/' + value.projectId + '/' + value.runId + '.json');
/**
 * 入口 / Entry: matches.
 * 功能：从当前输入或状态计算 `run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId && run.registryId === identi…`，供调用方后续验证或使用。
 * Purpose: Computes `run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId && run.registryId === identi…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: run: ProjectIdentityRun; identity: ProjectIdentity; record: ProjectMeshRecord
 * 输出 / Returns: `run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId && run.registryId === identi…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function matches(run: ProjectIdentityRun, identity: ProjectIdentity, record: ProjectMeshRecord) {
  return run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId &&
    run.registryId === identity.registryId && run.identityId === identity.identityId && run.revision === identity.revision &&
    run.runId === record.runId && run.bootId === record.bootId && run.cgroupName === record.scopeName &&
    record.inode !== null && run.cgroupInode === record.inode &&
    run.namespace === (identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : '');
}
/**
 * 入口 / Entry: callback@80.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.object().strict().superRefine）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.object().strict().superRefine).
 * 输入 / Inputs: row; context
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `context.addIssue`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const meshRunSchema = z.object({ id: z.uuid(), vmId: z.uuid(), projectId: projectIdSchema,
  directory: z.string().min(1).max(1023), networkIsolation: z.enum(['host', 'private']), configSha256: digest,
  policy: savedPolicySchema, binary: meshBinarySchema, plan: meshConfigPlanSchema, config: meshConfigSchema.nullable(),
  startedAt: z.iso.datetime(), phase: z.enum(['starting', 'running', 'stopping', 'review']),
  listener: reverseTunnelListenerSchema.nullable(),
  execution: z.object({ identity: projectIdentitySchema, record: projectMeshRecordSchema,
    run: projectIdentityRunSchema.nullable(), sha256: digest.nullable() }).strict(),
}).strict().superRefine((row, context) => {
  const value = row.execution, plan = row.plan;
  if (value.identity.phase !== 'active' || value.identity.projectId !== row.projectId ||
      value.identity.directory !== row.directory || value.identity.networkIsolation !== row.networkIsolation ||
      value.record.projectId !== row.projectId || plan.projectId !== row.projectId ||
      plan.identityId !== value.identity.identityId || plan.uid !== value.identity.uid || plan.gid !== value.identity.gid ||
      plan.runId !== value.record.runId || plan.bootId !== value.record.bootId ||
      plan.listenPort !== row.policy.listenPort || plan.upstreamPort !== row.policy.upstreamPort ||
      row.config && (row.config.path !== plan.path || row.config.sha256 !== plan.sha256 ||
        row.config.bytes !== plan.bytes || row.config.gid !== plan.gid) ||
      row.listener && row.listener.port !== plan.listenPort ||
      value.run && !matches(value.run, value.identity, value.record) ||
      row.phase === 'running' && (!row.config || !value.sha256 || !value.run || value.record.phase !== 'running' || !row.listener))
    context.addIssue({ code: 'custom', message: '网格边车完整项目归属缺失' });
});
type MeshRun = z.infer<typeof meshRunSchema>;
const meshProbeSchema = z.object({ vmId: z.uuid(), projectId: projectIdSchema, configSha256: digest, bootId: z.uuid(),
  identity: projectIdentitySchema, binary: meshBinarySchema, at: z.iso.datetime(), usable: z.boolean(),
  version: z.string().max(200).nullable(), error: z.string().max(2000).nullable() }).strict()
  .refine(value => value.identity.phase === 'active' && value.identity.projectId === value.projectId);
type MeshProbe = z.infer<typeof meshProbeSchema>;
const meshTaskSchema = z.object({ vmId: z.uuid(), projectId: projectIdSchema, configSha256: digest,
  identity: projectIdentitySchema, owner: z.object({ kind: z.literal('task'), runId: z.uuid(), bootId: z.uuid() }).strict(),
  sha256: digest, at: z.iso.datetime() }).strict().refine(value =>
    value.identity.phase === 'active' && value.identity.projectId === value.projectId);
type MeshTask = z.infer<typeof meshTaskSchema>;
const storeSchema = z.object({ version: z.literal(1),
  policies: z.record(z.string(), z.record(projectIdSchema, savedPolicySchema)),
  runs: z.array(meshRunSchema).max(128).default([]), probes: z.array(meshProbeSchema).max(256).default([]),
  tasks: z.array(meshTaskSchema).max(256).default([]),
}).strict().refine(value => new Set(value.runs.map(row => row.vmId + ':' + row.projectId)).size === value.runs.length &&
  new Set(value.probes.map(row => row.vmId + ':' + row.projectId)).size === value.probes.length &&
  new Set(value.tasks.map(row => row.owner.runId)).size === value.tasks.length, '网格项目归属重复');
type Store = z.infer<typeof storeSchema>;
/**
 * 入口 / Entry: defaults.
 * 功能：从当前输入或状态计算 `({ version: 1, policies: {}, runs: [], probes: [], tasks: [] })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: 1, policies: {}, runs: [], probes: [], tasks: [] })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Store；结果来自 / values from `({ version: 1, policies: {}, runs: [], probes: [], tasks: [] })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const defaults = (): Store => ({ version: 1, policies: {}, runs: [], probes: [], tasks: [] });
type Preparation = Pick<ProjectTerminals, 'prepare' | 'close'>;
type Lease = Awaited<ReturnType<ProjectTerminals['prepare']>>;
type Scope = Pick<ProjectMeshScope, 'status' | 'newIntent' | 'persistIntent' | 'start' | 'stop'>;
export type ServiceMeshOptions = {
  /**
   * 签名 / Signature: ServiceMeshOptions.createPreparation.
   * 功能：为管理项目 Envoy 边车策略及运行状态声明 createPreparation 的输入与结果契约，所属容器为 ServiceMeshOptions。
   * Purpose: Declares the input/result contract for createPreparation in ServiceMeshOptions. Module responsibility: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Preparation.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  createPreparation?: () => Preparation; runTask?: typeof projectIdentityTask;
  scopes?: Pick<ProjectRunScopes, 'identity' | 'inherited' | 'active' | 'readonlyActive' | 'taskRun' | 'closeAfterScopeStopped'>;
  identities?: Pick<ProjectIdentities, 'runReadonly'>;
  /**
   * 签名 / Signature: ServiceMeshOptions.processScope.
   * 功能：为管理项目 Envoy 边车策略及运行状态声明 processScope 的输入与结果契约，所属容器为 ServiceMeshOptions。
   * Purpose: Declares the input/result contract for processScope in ServiceMeshOptions. Module responsibility: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 输入 / Inputs: id: string; project: Project
   * 输出 / Returns: Scope.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  processScope?: (id: string, project: Project) => Scope;
  /**
   * 签名 / Signature: ServiceMeshOptions.hostStatus.
   * 功能：为管理项目 Envoy 边车策略及运行状态声明 hostStatus 的输入与结果契约，所属容器为 ServiceMeshOptions。
   * Purpose: Declares the input/result contract for hostStatus in ServiceMeshOptions. Module responsibility: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 输入 / Inputs: id: string; project: Project; signal: AbortSignal optional
   * 输出 / Returns: Promise<MeshHostStatus>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  hostStatus?: (id: string, project: Project, signal?: AbortSignal) => Promise<MeshHostStatus>;
  /**
   * 签名 / Signature: ServiceMeshOptions.configControl.
   * 功能：为管理项目 Envoy 边车策略及运行状态声明 configControl 的输入与结果契约，所属容器为 ServiceMeshOptions。
   * Purpose: Declares the input/result contract for configControl in ServiceMeshOptions. Module responsibility: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 输入 / Inputs: id: string; op: 'publish' | 'config' | 'cleanup'; plan: MeshConfigPlan; config: MeshConfig | null optional; source: string optional; signal: AbortSignal optional
   * 输出 / Returns: Promise<unknown>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  configControl?: (id: string, op: 'publish' | 'config' | 'cleanup', plan: MeshConfigPlan,
    config?: MeshConfig | null, source?: string, signal?: AbortSignal) => Promise<unknown>;
  /**
   * 签名 / Signature: ServiceMeshOptions.listener.
   * 功能：为管理项目 Envoy 边车策略及运行状态声明 listener 的输入与结果契约，所属容器为 ServiceMeshOptions。
   * Purpose: Declares the input/result contract for listener in ServiceMeshOptions. Module responsibility: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 输入 / Inputs: id: string; identity: ProjectIdentity; run: ProjectIdentityRun; signal: AbortSignal optional
   * 输出 / Returns: Promise<ReverseTunnelListener | null>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  listener?: (id: string, identity: ProjectIdentity, run: ProjectIdentityRun, signal?: AbortSignal) => Promise<ReverseTunnelListener | null>;
  /**
   * 签名 / Signature: ServiceMeshOptions.processProbe.
   * 功能：为管理项目 Envoy 边车策略及运行状态声明 processProbe 的输入与结果契约，所属容器为 ServiceMeshOptions。
   * Purpose: Declares the input/result contract for processProbe in ServiceMeshOptions. Module responsibility: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 输入 / Inputs: row: MeshRun; run: ProjectIdentityRun; listener: ReverseTunnelListener; signal: AbortSignal optional
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  processProbe?: (row: MeshRun, run: ProjectIdentityRun, listener: ReverseTunnelListener, signal?: AbortSignal) => Promise<void>;
};
type Context = { vmId: string; projectId: string; project: Project; version: string;
  live: NonNullable<ReturnType<Machines['live']['get']>>; signal: AbortSignal };
type Capture = Context & { preparation: Preparation; lease: Lease };
/**
 * 入口 / Entry: keyOf.
 * 功能：从当前输入或状态计算 `row.vmId + ':' + row.projectId`，供调用方后续验证或使用。
 * Purpose: Computes `row.vmId + ':' + row.projectId` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: row: { vmId: string; projectId: string }
 * 输出 / Returns: `row.vmId + ':' + row.projectId`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const keyOf = (row: { vmId: string; projectId: string }) => row.vmId + ':' + row.projectId;
/**
 * 入口 / Entry: changed.
 * 功能：从当前输入或状态计算 `new AppError('原网格项目、账号、boot、配置、完整运行域或监听归属无法核对', 409, 'SERVICE_SCOPE_CHANGED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('原网格项目、账号、boot、配置、完整运行域或监听归属无法核对', 409, 'SERVICE_SCOPE_CHANGED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('原网格项目、账号、boot、配置、完整运行域或监听归属无法核对', 409, 'SERVICE_SCOPE_CHANGED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const changed = () => new AppError('原网格项目、账号、boot、配置、完整运行域或监听归属无法核对', 409, 'SERVICE_SCOPE_CHANGED');
/**
 * 入口 / Entry: legacy.
 * 功能：从当前输入或状态计算 `new AppError('网格边车缺少完整项目账号票据；请管理员核查原 root/未知进程及全部后代，原记录保留，未自动接管', 409, 'PROJECT_IDENTITY_REQUIRED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('网格边车缺少完整项目账号票据；请管理员核查原 root/未知进程及全部后代，原记录保留，未自动接管', 409, 'PROJECT_IDENTITY_REQUIRED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('网格边车缺少完整项目账号票据；请管理员核查原 root/未知进程及全部后代，原记录保留，未自动接管', 409, 'PROJECT_IDENTITY_REQUIRED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const legacy = () => new AppError('网格边车缺少完整项目账号票据；请管理员核查原 root/未知进程及全部后代，原记录保留，未自动接管',
  409, 'PROJECT_IDENTITY_REQUIRED');
/**
 * 入口 / Entry: copy.
 * 功能：把本层请求转交 `structuredClone`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `structuredClone` and propagates the provider result or rejection.
 * 输入 / Inputs: project: Project; id: default=project._workspace || 'default'
 * 输出 / Returns: `Object.defineProperty(structuredClone(project), '_workspace', { value: id === 'default' ? undefined : id, enumerable: false }…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function copy(project: Project, id = project._workspace || 'default') {
  return Object.defineProperty(structuredClone(project), '_workspace', { value: id === 'default' ? undefined : id, enumerable: false });
}
/**
 * 入口 / Entry: binding.
 * 功能：把本层请求转交 `copy`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `copy` and propagates the provider result or rejection.
 * 输入 / Inputs: row: MeshRun
 * 输出 / Returns: Project；结果来自 / values from `copy({ directory: row.directory, template: 'none', repository: '', setup: '', command: '', networkIsolation: row.networkIsola…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function binding(row: MeshRun): Project {
  return copy({ directory: row.directory, template: 'none', repository: '', setup: '', command: '',
    networkIsolation: row.networkIsolation }, row.projectId);
}
/**
 * 入口 / Entry: cleanup.
 * 功能：把本层请求转交 `errors.find`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `errors.find` and propagates the provider result or rejection.
 * 输入 / Inputs: errors: unknown[]
 * 输出 / Returns: `Object.assign(new AppError('网格边车完整清理尚未确认，已保留原运行记录', 503, critical instanceof AppError ? critical.code : 'PROJECT_IDENTITY_CLE…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function cleanup(errors: unknown[]) {
  const critical = errors.find(error => error instanceof AppError && error.status === 503);
  return Object.assign(new AppError('网格边车完整清理尚未确认，已保留原运行记录', 503,
    critical instanceof AppError ? critical.code : 'PROJECT_IDENTITY_CLEANUP_FAILED'),
  { errors, cause: new AggregateError(errors, 'mesh operation and cleanup failures') });
}

/** A fixed loopback TCP Envoy configuration; no arbitrary bootstrap or admin listener. */
/**
 * 入口 / Entry: envoySidecarConfig.
 * 功能：从当前输入或状态计算 `{ static_resources: { listeners: [ { name: 'sakura_mesh_listener', address: { socket_address: { address: '127.0.0.1', port_va…`，供调用方后续验证或使用。
 * Purpose: Computes `{ static_resources: { listeners: [ { name: 'sakura_mesh_listener', address: { socket_address: { address: '127.0.0.1', port_va…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: policy: z.infer<typeof serviceMeshPolicy>
 * 输出 / Returns: `{ static_resources: { listeners: [ { name: 'sakura_mesh_listener', address: { socket_address: { address: '127.0.0.1', port_va…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function envoySidecarConfig(policy: z.infer<typeof serviceMeshPolicy>) {
  return {
    static_resources: {
      listeners: [
        {
          name: 'sakura_mesh_listener',
          address: { socket_address: { address: '127.0.0.1', port_value: policy.listenPort } },
          filter_chains: [
            {
              filters: [
                {
                  name: 'envoy.filters.network.tcp_proxy',
                  typed_config: {
                    '@type': 'type.googleapis.com/envoy.extensions.filters.network.tcp_proxy.v3.TcpProxy',
                    stat_prefix: 'sakura_mesh',
                    cluster: 'sakura_mesh_upstream',
                  },
                },
              ],
            },
          ],
        },
      ],
      clusters: [
        {
          name: 'sakura_mesh_upstream',
          connect_timeout: '1s',
          type: 'STATIC',
          load_assignment: {
            cluster_name: 'sakura_mesh_upstream',
            endpoints: [
              {
                lb_endpoints: [
                  {
                    endpoint: {
                      address: {
                        socket_address: {
                          address: '127.0.0.1',
                          port_value: policy.upstreamPort,
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  };
}

export class ServiceMesh {
  private store: Store = defaults();
  private writes: Promise<unknown> = Promise.resolve();
  private metadataWrites: Promise<unknown> = Promise.resolve();
  private checks = new Set<Promise<unknown>>();
  private pendingCaptures = new Map<string, Capture>();
  private pendingOperations = new Set<Capture>();
  private closed = false;
  private closing?: Promise<void>;
  private controller = new AbortController();
  /**
   * 签名 / Signature: ServiceMesh.unguard.
   * 功能：为管理项目 Envoy 边车策略及运行状态声明 unguard 的输入与结果契约，所属容器为 ServiceMesh。
   * Purpose: Declares the input/result contract for unguard in ServiceMesh. Module responsibility: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private unguard: () => void;
  private scopes: NonNullable<ServiceMeshOptions['scopes']>;
  private identities: NonNullable<ServiceMeshOptions['identities']>;
  /**
   * 入口 / Entry: ServiceMesh.constructor.
   * 功能：建立 ServiceMesh 的管理项目 Envoy 边车策略及运行状态上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ServiceMesh context for this module's responsibility: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; file: default=join(DATA, 'service-mesh.json'); canStart: (id: string) => Promise<boolean> default=async () => true; options: ServiceMeshOptions default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.scopes`, `this.identities`, `this.unguard`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private machines: Machines, private workspaces: WorkspacesV1,
    private file = join(DATA, 'service-mesh.json'),
    private canStart: (id: string) => Promise<boolean> = async () => true,
    private options: ServiceMeshOptions = {}) {
    this.scopes = options.scopes || new ProjectRunScopes(machines);
    this.identities = options.identities || new ProjectIdentities(machines);
    /**
     * 入口 / Entry: ServiceMesh.constructor.callback@222.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（workspaces.beforeConfigChange）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (workspaces.beforeConfigChange).
     * 输入 / Inputs: id; previous; next
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `previous.directory !== next.directory || (previous.networkIsolation || 'host') !== (next.networkIsolation || 'host')`; `this.row(id, projectId) || this.store.tasks.some(task => task.vmId === id && task.projectId === projectId)`; `this.running(id)`; 异常 / errors `new AppError('请先停止此项目的服务网格边车，再修改目录或网络模式', 409)`; `new AppError('请先恢复实例并停止此项目的边车', 409)`.
     */
    this.unguard = workspaces.beforeConfigChange(async (id, previous, next) => {
      const projectId = previous._workspace || 'default', policy = this.store.policies[id]?.[projectId];
      if (previous.directory !== next.directory || (previous.networkIsolation || 'host') !== (next.networkIsolation || 'host')) {
        await this.durable();
        if (this.row(id, projectId) || this.store.tasks.some(task => task.vmId === id && task.projectId === projectId))
          throw new AppError('请先停止此项目的服务网格边车，再修改目录或网络模式', 409);
        if (this.running(id)) {
          const host = await this.host(id, previous);
          const scope = await this.scope(id, previous).status();
          if (host.legacyRunning || !['absent', 'stopped'].includes(scope.status))
            throw new AppError('请先停止此项目的服务网格边车，再修改目录或网络模式', 409);
        } else if (this.machines.state(id) === 'paused' && policy)
          throw new AppError('请先恢复实例并停止此项目的边车', 409);
      }
      if (policy) await this.assertPortAvailable(id, projectId, policy.listenPort, next);
    });
  }
  /**
   * 入口 / Entry: ServiceMesh.init.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，初始化并核对当前领域状态；处理结果记录到 `this.store`（`ServiceMesh`）。
   * Purpose: Initializes and verifies current domain state in `ServiceMesh`; the outcome is recorded in `this.store`. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.disk` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.disk`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.store`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() { this.store = await this.disk(); }
  /**
   * 入口 / Entry: ServiceMesh.running.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.state(id) === 'running' && Boolean(this.machines.live.get(id))` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `this.machines.state(id) === 'running' && Boolean(this.machines.live.get(id))` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.machines.state`, `this.machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.state`, `this.machines.live.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.machines.state(id) === 'running' && Boolean(this.machines.live.get(id))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private running(id: string) { return this.machines.state(id) === 'running' && Boolean(this.machines.live.get(id)); }
  /**
   * 入口 / Entry: ServiceMesh.project.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `projectIdSchema.parse(this.workspaces.projects.current(id))` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `projectIdSchema.parse(this.workspaces.projects.current(id))` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.machines.get`, `projectIdSchema.parse`, `this.workspaces.projects.current` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `projectIdSchema.parse`, `this.workspaces.projects.current`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `projectIdSchema.parse(this.workspaces.projects.current(id))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private project(id: string) { this.machines.get(id); return projectIdSchema.parse(this.workspaces.projects.current(id)); }
  /**
   * 入口 / Entry: ServiceMesh.row.
   * 功能：把本层请求转交 `this.store.runs.find`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.store.runs.find` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; projectId: string
   * 输出 / Returns: `this.store.runs.find(row => row.vmId === id && row.projectId === projectId)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private row(id: string, projectId: string) { return this.store.runs.find(row => row.vmId === id && row.projectId === projectId); }
  /**
   * 入口 / Entry: ServiceMesh.current.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `same(this.row(row.vmId, row.projectId), row)` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `same(this.row(row.vmId, row.projectId), row)` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `same`, `this.row` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `same`, `this.row`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: row: MeshRun
   * 输出 / Returns: `same(this.row(row.vmId, row.projectId), row)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private current(row: MeshRun) { return same(this.row(row.vmId, row.projectId), row); }
  /**
   * 入口 / Entry: ServiceMesh.scope.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.options.processScope?.(id, copy(project)) || new ProjectMeshScope(this.machines, id, copy(project))` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `this.options.processScope?.(id, copy(project)) || new ProjectMeshScope(this.machines, id, copy(project))` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.options.processScope`, `copy` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.options.processScope`, `copy`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; project: Project
   * 输出 / Returns: `this.options.processScope?.(id, copy(project)) || new ProjectMeshScope(this.machines, id, copy(project))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private scope(id: string, project: Project) { return this.options.processScope?.(id, copy(project)) || new ProjectMeshScope(this.machines, id, copy(project)); }
  /**
   * 入口 / Entry: ServiceMesh.disk.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `storeSchema.parse(JSON.parse(await readFile(this.file, 'utf8')))` / `defaults()` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `storeSchema.parse(JSON.parse(await readFile(this.file, 'utf8')))` / `defaults()` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `storeSchema.parse`, `readFile`, `defaults`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `storeSchema.parse`, `readFile`, `defaults`, `changed`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `(error as NodeJS.ErrnoException).code === 'ENOENT'`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `storeSchema.parse(JSON.parse(await readFile(this.file, 'utf8')))`; `defaults()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `changed()`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults();`; `throw changed();`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults();`; `throw changed();`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async disk() {
    try { return storeSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults(); throw changed(); }
  }
  /**
   * 入口 / Entry: ServiceMesh.durable.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; the calls and state transitions below complete the operation. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `same`, `this.disk`, `this.current`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `same`, `this.disk`, `this.current`, `changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: row: MeshRun optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!same(await this.disk(), this.store) || row && !this.current(row)`; 异常 / errors `changed()`.
   */
  private async durable(row?: MeshRun) {
    await this.metadataWrites;
    if (!same(await this.disk(), this.store) || row && !this.current(row)) throw changed();
  }
  /**
   * 入口 / Entry: ServiceMesh.save.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，校验并提交领域状态变更；本入口产生 `task` 供上层消费（`ServiceMesh`）。
   * Purpose: Validates and commits a domain state change in `ServiceMesh`; this entry produces `task` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.metadataWrites.then`, `task.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.metadataWrites.then`, `task.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: change: (state: Store) => void
   * 输出 / Returns: `task`.
   * 副作用 / Effects: 更新 / updates `this.metadataWrites`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private save(change: (state: Store) => void) {
    /**
     * 入口 / Entry: ServiceMesh.save.callback@254.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.metadataWrites.then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.metadataWrites.then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.store`.
     * 拒绝 / Refusals: 条件 / conditions `!same(await this.disk(), this.store)`; 异常 / errors `changed()`.
     */
    const task = this.metadataWrites.then(async () => {
      if (!same(await this.disk(), this.store)) throw changed();
      const next = structuredClone(this.store); change(next); const parsed = storeSchema.parse(next);
      await writeStore(this.file, parsed); this.store = parsed;
    });
    this.metadataWrites = task.catch(() => {}); return task;
  }
  /**
   * 入口 / Entry: ServiceMesh.update.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，校验并提交领域状态变更；本入口产生 `this.row(row.vmId, row.projectId)!` 供上层消费（`ServiceMesh`）。
   * Purpose: Validates and commits a domain state change in `ServiceMesh`; this entry produces `this.row(row.vmId, row.projectId)!` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.save`, `this.row` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.save`, `this.row`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: row: MeshRun; change: (row: MeshRun) => void
   * 输出 / Returns: `this.row(row.vmId, row.projectId)!`.
   * 副作用 / Effects: `this.save`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async update(row: MeshRun, change: (row: MeshRun) => void) {
    await this.save(state => { const found = state.runs.find(value => value.id === row.id);
      if (!found || !same(found, row)) throw changed(); change(found); });
    return this.row(row.vmId, row.projectId)!;
  }
  /**
   * 入口 / Entry: ServiceMesh.serial.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `task` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch`, `task.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`, `task.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `task`.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>) {
    const task = this.writes.catch(() => {}).then(() => {
      if (this.closed) throw new AppError('服务网格正在关闭', 503); return work();
    });
    this.writes = task.catch(() => {}); return task;
  }
  /**
   * 入口 / Entry: ServiceMesh.context.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `context` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `context` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `signal.throwIfAborted`, `this.running`, `this.machines.live.get`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.running`, `this.machines.live.get`, `changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; projectId: string; live: Context['live'] | undefined; signal: AbortSignal
   * 输出 / Returns: `context`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!live || !this.running(id) || this.machines.live.get(id) !== live`; 异常 / errors `changed()`.
   */
  private async context(id: string, projectId: string, live: Context['live'] | undefined, signal: AbortSignal) {
    signal.throwIfAborted(); if (!live || !this.running(id) || this.machines.live.get(id) !== live) throw changed();
    const project = copy(await this.workspaces.config(id), projectId);
    const context: Context = { vmId: id, projectId, project, version: projectVersion(project), live, signal };
    await this.assertContext(context); return context;
  }
  /**
   * 入口 / Entry: ServiceMesh.assertContext.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`ServiceMesh`）。
   * Purpose: Checks admission, input or resource ownership in `ServiceMesh`; the calls and state transitions below complete the operation. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `origin`, `this.workspaces.config`, `projectVersion`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `origin`, `this.workspaces.config`, `projectVersion`, `changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: context: Context
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `(project._workspace || 'default') !== context.projectId || projectVersion(project) !== context.version`; 异常 / errors `changed()`.
   */
  private async assertContext(context: Context) {
    /**
     * 入口 / Entry: ServiceMesh.assertContext.origin.
     * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ServiceMesh`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; the calls and state transitions below complete the operation. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
     * 处理：通过 `context.signal.throwIfAborted`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.running` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `context.signal.throwIfAborted`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.running`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.closed || this.workspaces.projects.current(context.vmId) !== context.projectId || this.machines.live.get(context.vmId) !…`; 异常 / errors `changed()`.
     */
    const origin = () => { context.signal.throwIfAborted();
      if (this.closed || this.workspaces.projects.current(context.vmId) !== context.projectId ||
          this.machines.live.get(context.vmId) !== context.live || !this.running(context.vmId)) throw changed(); };
    origin(); const project = await this.workspaces.config(context.vmId); origin();
    if ((project._workspace || 'default') !== context.projectId || projectVersion(project) !== context.version) throw changed();
  }
  /**
   * 入口 / Entry: ServiceMesh.capture.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...context, preparation, lease, signal: lease.signal } satisfies Capture` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `{ ...context, preparation, lease, signal: lease.signal } satisfies Capture` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.options.createPreparation`, `projectTerminalsFor`, `preparation.prepare`, `this.assertContext` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.options.createPreparation`, `projectTerminalsFor`, `preparation.prepare`, `this.assertContext`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `lease`.
   * 输入 / Inputs: context: Context
   * 输出 / Returns: `{ ...context, preparation, lease, signal: lease.signal } satisfies Capture`.
   * 副作用 / Effects: `this.options.createPreparation`; `this.release`; `preparation.close`; 更新 / updates `lease`.
   * 拒绝 / Refusals: 条件 / conditions `!lease.captured || !lease.signal || lease.projectId !== context.projectId || lease.captured.live !== context.live || lease.ca…`; 异常 / errors `changed()`; `cleanup([error, failed])`.
   * 失败处理：catch 分支执行 `if (lease) await this.release({ ...context, preparation, lease, signal: lease.signal || context.signal }, error); else try { …`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (lease) await this.release({ ...context, preparation, lease, signal: lease.signal || context.signal }, error); else try { …`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async capture(context: Context) {
    const preparation = this.options.createPreparation?.() || projectTerminalsFor(this.machines, this.workspaces);
    let lease: Lease | undefined;
    try {
      lease = await preparation.prepare(context.vmId, context.projectId, null, false, context.signal, undefined, { mode: 'task' });
      await this.assertContext(context);
      if (!lease.captured || !lease.signal || lease.projectId !== context.projectId || lease.captured.live !== context.live ||
          lease.captured.configVersion !== context.version || projectVersion(lease.captured.project) !== context.version) throw changed();
      return { ...context, preparation, lease, signal: lease.signal } satisfies Capture;
    } catch (error) {
      if (lease) await this.release({ ...context, preparation, lease, signal: lease.signal || context.signal }, error);
      else try { await preparation.close(); } catch (failed) { throw cleanup([error, failed]); }
      throw error;
    }
  }
  /**
   * 入口 / Entry: ServiceMesh.release.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ServiceMesh`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ServiceMesh`; the calls and state transitions below complete the operation. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.stopTasks`, `this.pendingOperations.add`, `cleanup`, `capture.lease.release` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.stopTasks`, `this.pendingOperations.add`, `cleanup`, `capture.lease.release`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `errors.length === (failure === undefined ? 0 : 1)`.
   * 输入 / Inputs: capture: Capture; failure: unknown optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.stopTasks`; `this.pendingOperations.add`; `capture.lease.release`; `errors.push`; `capture.preparation.close`.
   * 拒绝 / Refusals: 条件 / conditions `errors.length > (failure === undefined ? 0 : 1)`; 异常 / errors `cleanup([...errors, error])`; `cleanup(errors)`.
   * 失败处理：catch 分支执行 `this.pendingOperations.add(capture);`; `throw cleanup([...errors, error]);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.pendingOperations.add(capture);`; `throw cleanup([...errors, error]);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async release(capture: Capture, failure?: unknown) {
    const errors: unknown[] = failure === undefined ? [] : [failure];
    try { await this.stopTasks(capture.vmId, capture.projectId); }
    catch (error) { this.pendingOperations.add(capture); throw cleanup([...errors, error]); }
    try { await capture.lease.release(); } catch (error) { errors.push(error); }
    // A failed release still owns the preparation. Do not drop its reservation.
    if (errors.length === (failure === undefined ? 0 : 1))
      try { await capture.preparation.close(); } catch (error) { errors.push(error); }
    if (errors.length > (failure === undefined ? 0 : 1)) { this.pendingOperations.add(capture); throw cleanup(errors); }
    this.pendingOperations.delete(capture);
  }
  /**
   * 入口 / Entry: ServiceMesh.stopTasks.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ServiceMesh`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ServiceMesh`; the calls and state transitions below complete the operation. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.durable`, `this.store.tasks.filter`, `this.scopes.taskRun`, `same` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.durable`, `this.store.tasks.filter`, `this.scopes.taskRun`, `same`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; projectId: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.scopes.closeAfterScopeStopped`; `this.save`.
   * 拒绝 / Refusals: 条件 / conditions `!entry || !same(entry.identity, task.identity) || !same(entry.owner, task.owner) || entry.sha256 !== task.sha256`; `!closed || closed.phase !== 'closed' || !same(closed.identity, task.identity) || !same(closed.owner, task.owner) || closed.sh…`; 异常 / errors `changed()`.
   */
  private async stopTasks(id: string, projectId: string) {
    await this.durable();
    for (const task of this.store.tasks.filter(value => value.vmId === id && value.projectId === projectId)) {
      // Finite tasks own a separate original UUID domain. A service stop is
      // never evidence that the validator/version task finished its cleanup.
      const entry = await this.scopes.taskRun(id, projectId, task.owner.runId);
      if (!entry || !same(entry.identity, task.identity) || !same(entry.owner, task.owner) || entry.sha256 !== task.sha256) throw changed();
      await this.scopes.closeAfterScopeStopped(id, projectId, task.owner.runId);
      const closed = await this.scopes.taskRun(id, projectId, task.owner.runId);
      if (!closed || closed.phase !== 'closed' || !same(closed.identity, task.identity) ||
          !same(closed.owner, task.owner) || closed.sha256 !== task.sha256) throw changed();
      await this.save(state => { const found = state.tasks.find(value => value.owner.runId === task.owner.runId);
        if (!found || !same(found, task)) throw changed(); state.tasks.splice(state.tasks.indexOf(found), 1); });
    }
  }
  /**
   * 入口 / Entry: ServiceMesh.finite.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `result` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.payload`, `inline`, `this.assertContext`, `this.result` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.payload`, `inline`, `this.assertContext`, `this.result`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: capture: Capture; identity: ProjectIdentity; bootId: string; execution: Parameters<typeof projectIdentityPayload>[0]; timeout: number
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `this.stopTasks`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async finite(capture: Capture, identity: ProjectIdentity, bootId: string,
    execution: Parameters<typeof projectIdentityPayload>[0], timeout: number) {
    const sha256 = this.payload(execution).sha256;
    const result = await (this.options.runTask || projectIdentityTask)(this.machines, capture.vmId, capture.project, execution,
      capture.signal, undefined, timeout, undefined, undefined, { expectedLive: capture.live, expectedBootId: bootId,
        /**
         * 入口 / Entry: ServiceMesh.finite.beforeIntent.
         * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ServiceMesh`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; the calls and state transitions below complete the operation. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
         * 处理：通过 `this.assertContext`, `same`, `changed`, `meshTaskSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `this.assertContext`, `same`, `changed`, `meshTaskSchema.parse`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: value
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `this.save`; `this.pendingOperations.add`.
         * 拒绝 / Refusals: 条件 / conditions `!same(value.identity, identity) || value.owner.kind !== 'task' || value.owner.bootId !== bootId || value.sha256 !== sha256`; 异常 / errors `changed()`.
         */
        beforeIntent: async value => {
          await this.assertContext(capture);
          if (!same(value.identity, identity) || value.owner.kind !== 'task' || value.owner.bootId !== bootId || value.sha256 !== sha256) throw changed();
          const task = meshTaskSchema.parse({ vmId: capture.vmId, projectId: capture.projectId, configSha256: capture.version,
            identity: value.identity, owner: value.owner, sha256, at: new Date().toISOString() });
          await this.save(state => { if (state.tasks.some(row => row.owner.runId === task.owner.runId)) throw changed(); state.tasks.push(task); });
          this.pendingOperations.add(capture);
        } });
    await this.assertContext(capture); this.result(result); await this.stopTasks(capture.vmId, capture.projectId); return result;
  }
  /**
   * 入口 / Entry: ServiceMesh.host.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `meshHostStatusSchema.parse(await this.options.hostStatus(id, copy(project), signal))` / `meshHostStatusSchema.parse(JSON.parse(result.stdout))` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `meshHostStatusSchema.parse(await this.options.hostStatus(id, copy(project), signal))` / `meshHostStatusSchema.parse(JSON.parse(result.stdout))` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `meshHostStatusSchema.parse`, `this.options.hostStatus`, `copy`, `this.machines.execInput` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `meshHostStatusSchema.parse`, `this.options.hostStatus`, `copy`, `this.machines.execInput`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.options.hostStatus`.
   * 输入 / Inputs: id: string; project: Project; signal: AbortSignal optional
   * 输出 / Returns: `meshHostStatusSchema.parse(await this.options.hostStatus(id, copy(project), signal))`; `meshHostStatusSchema.parse(JSON.parse(result.stdout))`.
   * 副作用 / Effects: `this.machines.execInput`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError(result.stderr.includes('SAKURA_MESH_PYTHON_REQUIRED') ? '客户机尚未安装 Python 3，无法核对边车原归属' : '无法核对网格系统工具与旧进程', 409, re…`.
   */
  private async host(id: string, project: Project, signal?: AbortSignal) {
    if (this.options.hostStatus) return meshHostStatusSchema.parse(await this.options.hostStatus(id, copy(project), signal));
    const result = await this.machines.execInput(id, meshControlCommand, meshInspectInput(project), 15000, signal);
    if (result.code !== 0) throw new AppError(result.stderr.includes('SAKURA_MESH_PYTHON_REQUIRED')
      ? '客户机尚未安装 Python 3，无法核对边车原归属' : '无法核对网格系统工具与旧进程', 409,
    result.stderr.includes('SAKURA_MESH_PYTHON_REQUIRED') ? 'SERVICE_SCOPE_UNAVAILABLE' : 'SERVICE_SCOPE_CHANGED');
    return meshHostStatusSchema.parse(JSON.parse(result.stdout));
  }
  /**
   * 入口 / Entry: ServiceMesh.control.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.options.configControl(id, op, plan, config, source, signal)` / `JSON.parse(result.stdout)` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `this.options.configControl(id, op, plan, config, source, signal)` / `JSON.parse(result.stdout)` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.options.configControl`, `this.machines.execInput`, `meshConfigInput`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.options.configControl`, `this.machines.execInput`, `meshConfigInput`, `changed`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.options.configControl`.
   * 输入 / Inputs: id: string; op: 'publish' | 'config' | 'cleanup'; plan: MeshConfigPlan; config: MeshConfig | null optional; source: string optional; signal: AbortSignal optional
   * 输出 / Returns: `this.options.configControl(id, op, plan, config, source, signal)`; `JSON.parse(result.stdout)`.
   * 副作用 / Effects: `this.machines.execInput`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `changed()`.
   */
  private async control(id: string, op: 'publish' | 'config' | 'cleanup', plan: MeshConfigPlan,
    config?: MeshConfig | null, source?: string, signal?: AbortSignal) {
    if (this.options.configControl) return this.options.configControl(id, op, plan, config, source, signal);
    const result = await this.machines.execInput(id, meshControlCommand, meshConfigInput(op, plan, config, source), 15000, signal);
    if (result.code !== 0) throw changed(); return JSON.parse(result.stdout);
  }
  /**
   * 入口 / Entry: ServiceMesh.listener.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `this.options.listener(row.vmId, row.execution.identity, run, signal)` / `z.object({ listener: reverseTunnelListenerSchema.nullable() }).strict().parse(JSON.parse(result.stdout)).listener` 供上层消费（`ServiceMesh`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ServiceMesh`; this entry produces `this.options.listener(row.vmId, row.execution.identity, run, signal)` / `z.object({ listener: reverseTunnelListenerSchema.nullable() }).strict().parse(JSON.parse(result.stdout)).listener` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.options.listener`, `this.machines.exec`, `reverseTunnelListenerCommand`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.options.listener`, `this.machines.exec`, `reverseTunnelListenerCommand`, `changed`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.options.listener`.
   * 输入 / Inputs: row: MeshRun; run: ProjectIdentityRun; signal: AbortSignal optional
   * 输出 / Returns: `this.options.listener(row.vmId, row.execution.identity, run, signal)`; `z.object({ listener: reverseTunnelListenerSchema.nullable() }).strict().parse(JSON.parse(result.stdout)).listener`.
   * 副作用 / Effects: `this.options.listener`; `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `changed()`.
   */
  private async listener(row: MeshRun, run: ProjectIdentityRun, signal?: AbortSignal) {
    if (this.options.listener) return this.options.listener(row.vmId, row.execution.identity, run, signal);
    const result = await this.machines.exec(row.vmId, reverseTunnelListenerCommand(row.execution.identity, run), 10000, signal);
    if (result.code !== 0) throw changed();
    return z.object({ listener: reverseTunnelListenerSchema.nullable() }).strict().parse(JSON.parse(result.stdout)).listener;
  }
  /**
   * 入口 / Entry: ServiceMesh.process.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.options.processProbe(row, run, listener, signal)` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `this.options.processProbe(row, run, listener, signal)` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `changed`, `this.options.processProbe`, `this.machines.execInput`, `meshProcessInput` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `changed`, `this.options.processProbe`, `this.machines.execInput`, `meshProcessInput`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.options.processProbe`.
   * 输入 / Inputs: row: MeshRun; run: ProjectIdentityRun; listener: ReverseTunnelListener; signal: AbortSignal optional
   * 输出 / Returns: `this.options.processProbe(row, run, listener, signal)`.
   * 副作用 / Effects: `this.machines.execInput`.
   * 拒绝 / Refusals: 条件 / conditions `!row.config`; `result.code !== 0`; 异常 / errors `changed()`.
   */
  private async process(row: MeshRun, run: ProjectIdentityRun, listener: ReverseTunnelListener, signal?: AbortSignal) {
    if (!row.config) throw changed();
    if (this.options.processProbe) return this.options.processProbe(row, run, listener, signal);
    const result = await this.machines.execInput(row.vmId, meshControlCommand,
      meshProcessInput(row.plan, row.config, row.binary, row.execution.identity, run, listener), 15000, signal);
    if (result.code !== 0) throw changed(); meshProcessReplySchema.parse(JSON.parse(result.stdout));
  }
  /**
   * 入口 / Entry: ServiceMesh.sample.
   * 功能：从当前输入或状态计算 `this.store.probes.find(value => value.vmId === context.vmId && value.projectId === context.projectId && value.configSha256 ==…`，供调用方后续验证或使用。
   * Purpose: Computes `this.store.probes.find(value => value.vmId === context.vmId && value.projectId === context.projectId && value.configSha256 ==…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: context: Context; host: MeshHostStatus
   * 输出 / Returns: `this.store.probes.find(value => value.vmId === context.vmId && value.projectId === context.projectId && value.configSha256 ==…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private sample(context: Context, host: MeshHostStatus) {
    return this.store.probes.find(value => value.vmId === context.vmId && value.projectId === context.projectId &&
      value.configSha256 === context.version && value.bootId === host.bootId && same(value.binary, host.envoy)) || null;
  }
  /**
   * 入口 / Entry: ServiceMesh.probe.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ project: resolved, identity, sample, privateValues }` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `{ project: resolved, identity, sample, privateValues }` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.workspaces.resolveProject`, `copy`, `this.assertContext`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.resolveProject`, `copy`, `this.assertContext`, `changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: capture: Capture; host: MeshHostStatus
   * 输出 / Returns: `{ project: resolved, identity, sample, privateValues }`.
   * 副作用 / Effects: `this.save`.
   * 拒绝 / Refusals: 条件 / conditions `!host.envoy || !host.pythonInstalled || !host.tmuxInstalled || !host.directoryPresent || !host.namespacePresent`; `(resolved._workspace || 'default') !== capture.projectId || resolved.directory !== capture.project.directory || (resolved.net…`; `current.bootId !== host.bootId || !same(current.envoy, host.envoy) || !same(await this.scopes.identity(capture.vmId, capture.…`; 异常 / errors `new AppError('客户机需要已安装的 Envoy、tmux 和 Python 3，以及已显式准备的项目目录与网络空间', 409)`; `changed()`.
   */
  private async probe(capture: Capture, host: MeshHostStatus) {
    if (!host.envoy || !host.pythonInstalled || !host.tmuxInstalled || !host.directoryPresent || !host.namespacePresent)
      throw new AppError('客户机需要已安装的 Envoy、tmux 和 Python 3，以及已显式准备的项目目录与网络空间', 409);
    const resolved = await this.workspaces.resolveProject(capture.vmId, copy(capture.project));
    await this.assertContext(capture);
    if ((resolved._workspace || 'default') !== capture.projectId || resolved.directory !== capture.project.directory ||
        (resolved.networkIsolation || 'host') !== (capture.project.networkIsolation || 'host')) throw changed();
    const identity = await this.scopes.identity(capture.vmId, capture.project, capture.signal); await this.assertContext(capture);
    const execution = { command: meshEnvoyExecution(host.envoy), environment: resolved.environment };
    const result = await this.finite(capture, identity, host.bootId, execution, 10000);
    const current = await this.host(capture.vmId, capture.project, capture.signal); await this.assertContext(capture);
    if (current.bootId !== host.bootId || !same(current.envoy, host.envoy) ||
        !same(await this.scopes.identity(capture.vmId, capture.project, capture.signal), identity)) throw changed();
    await this.assertContext(capture);
    const privateValues = projectPrivateValues(resolved);
    const sample: MeshProbe = { vmId: capture.vmId, projectId: capture.projectId, configSha256: capture.version,
      bootId: host.bootId, identity, binary: host.envoy, at: new Date().toISOString(), usable: result.code === 0,
      version: result.code === 0 ? redactValues(result.stdout, privateValues).trim().slice(0, 200) || null : null,
      error: result.code === 0 ? null : redactValues(result.stderr || '项目中的 Envoy 版本检查失败', privateValues).slice(-2000) };
    await this.save(state => { state.probes = state.probes.filter(value => keyOf(value) !== keyOf(sample)); state.probes.push(sample); });
    return { project: resolved, identity, sample, privateValues };
  }
  /**
   * 入口 / Entry: ServiceMesh.payload.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `projectIdentityPayload(execution)` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `projectIdentityPayload(execution)` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `projectIdentityPayload` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentityPayload`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: execution: Parameters<typeof projectIdentityPayload>[0]
   * 输出 / Returns: `projectIdentityPayload(execution)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `new AppError('网格正文或环境超过受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID')`.
   * 失败处理：catch 分支执行 `throw new AppError('网格正文或环境超过受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('网格正文或环境超过受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID');`; these statements determine whether a failure is absorbed or rejected again.
   */
  private payload(execution: Parameters<typeof projectIdentityPayload>[0]) {
    try { return projectIdentityPayload(execution); }
    catch { throw new AppError('网格正文或环境超过受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID'); }
  }
  /**
   * 入口 / Entry: ServiceMesh.result.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; the calls and state transitions below complete the operation. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: asserts value is { code: number; stdout: string; stderr: string }.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!value || typeof value !== 'object' || !Number.isInteger((value as any).code) || typeof (value as any).stdout !== 'string' ||…`; 异常 / errors `new AppError('网格有限任务结果无法核对', 409, 'PROJECT_IDENTITY_RESULT_INVALID')`.
   */
  private result(value: unknown): asserts value is { code: number; stdout: string; stderr: string } {
    if (!value || typeof value !== 'object' || !Number.isInteger((value as any).code) ||
        typeof (value as any).stdout !== 'string' || typeof (value as any).stderr !== 'string' ||
        Buffer.byteLength((value as any).stdout) + Buffer.byteLength((value as any).stderr) > 1024 * 1024)
      throw new AppError('网格有限任务结果无法核对', 409, 'PROJECT_IDENTITY_RESULT_INVALID');
  }
  /**
   * 入口 / Entry: ServiceMesh.prove.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; the calls and state transitions below complete the operation. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.durable`, `this.assertContext`, `same`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.durable`, `this.assertContext`, `same`, `changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: row: MeshRun; context: Context; host: MeshHostStatus
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.listener`.
   * 拒绝 / Refusals: 条件 / conditions `row.phase !== 'running' || context.version !== row.configSha256 || !same(host.envoy, row.binary) || row.execution.record.boot…`; `state.status !== 'running' || !same(state.record, row.execution.record) || state.bootId !== host.bootId || !await this.scopes…`; `!same(run, row.execution.run) || !matches(run, row.execution.identity, row.execution.record)`; 异常 / errors `changed()`.
   */
  private async prove(row: MeshRun, context: Context, host: MeshHostStatus) {
    await this.durable(row); await this.assertContext(context);
    if (row.phase !== 'running' || context.version !== row.configSha256 || !same(host.envoy, row.binary) ||
        row.execution.record.bootId !== host.bootId || !row.execution.sha256 || !row.execution.run || !row.listener || !row.config) throw changed();
    const state = await this.scope(row.vmId, binding(row)).status(context.signal, row.execution.sha256); await this.assertContext(context);
    if (state.status !== 'running' || !same(state.record, row.execution.record) || state.bootId !== host.bootId ||
        !await this.scopes.readonlyActive(row.vmId, row.projectId, row.execution.record.runId, context.signal)) throw changed();
    await this.assertContext(context);
    const run = await this.identities.runReadonly(row.vmId, row.execution.identity, row.execution.record.runId, context.signal);
    await this.assertContext(context); if (!same(run, row.execution.run) || !matches(run, row.execution.identity, row.execution.record)) throw changed();
    const config = meshConfigReplySchema.parse(await this.control(row.vmId, 'config', row.plan, row.config, undefined, context.signal));
    await this.assertContext(context); if (!config.present || !same(config.config, row.config)) throw changed();
    const listener = await this.listener(row, run, context.signal); await this.assertContext(context);
    if (!same(listener, row.listener)) throw changed();
    await this.process(row, run, row.listener, context.signal); await this.assertContext(context);
    if (!same(await this.listener(row, run, context.signal), row.listener)) throw changed();
    await this.assertContext(context); await this.durable(row);
  }
  /**
   * 入口 / Entry: ServiceMesh.status.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `this.workspaces.projects.inScope(id, projectId, () => this.view(id, projectId, live, abort))` 供上层消费（`ServiceMesh`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ServiceMesh`; this entry produces `this.workspaces.projects.inScope(id, projectId, () => this.view(id, projectId, live, abort))` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.project`, `this.machines.live.get`, `AbortSignal.any`, `abort.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.project`, `this.machines.live.get`, `AbortSignal.any`, `abort.throwIfAborted`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `this.workspaces.projects.inScope(id, projectId, () => this.view(id, projectId, live, abort))`.
   * 副作用 / Effects: `AbortSignal.any`; `abort.throwIfAborted`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async status(id: string, signal?: AbortSignal) {
    const projectId = this.project(id), live = this.machines.live.get(id);
    const abort = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]); abort.throwIfAborted();
    return this.workspaces.projects.inScope(id, projectId, () => this.view(id, projectId, live, abort));
  }
  /**
   * 入口 / Entry: ServiceMesh.view.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ ...result, reason: row || pendingTask ? '请先恢复原实例并核对原边车完整运行域。' : guestPaused ? '请先恢复 Linux 实例并检查边车状态。' : '请先启动 Linux 实例。' }` / `{ ...result, guestRunning: true, sidecarStateKnown: false, bindingError: '无法核对边车原归属，请检查 Python 3、系统工具和实例身份。', reason: '无法核对边车…` 供上层消费（`ServiceMesh`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ServiceMesh`; this entry produces `{ ...result, reason: row || pendingTask ? '请先恢复原实例并核对原边车完整运行域。' : guestPaused ? '请先恢复 Linux 实例并检查边车状态。' : '请先启动 Linux 实例。' }` / `{ ...result, guestRunning: true, sidecarStateKnown: false, bindingError: '无法核对边车原归属，请检查 Python 3、系统工具和实例身份。', reason: '无法核对边车…` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.durable`, `signal.throwIfAborted`, `copy`, `this.workspaces.config` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.durable`, `signal.throwIfAborted`, `copy`, `this.workspaces.config`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.running(id)`; `host.legacyRunning`; `pendingTask`.
   * 输入 / Inputs: id: string; projectId: string; live: Context['live'] | undefined; signal: AbortSignal
   * 输出 / Returns: `{ ...result, reason: row || pendingTask ? '请先恢复原实例并核对原边车完整运行域。' : guestPaused ? '请先恢复 Linux 实例并检查边车状态。' : '请先启动 Linux 实例。' }`; `{ ...result, guestRunning: true, sidecarStateKnown: false, bindingError: '无法核对边车原归属，请检查 Python 3、系统工具和实例身份。', reason: '无法核对边车…`; `{ ...result, ...(reason ? { reason } : {}) }`.
   * 副作用 / Effects: 更新 / updates `host`, `result.version`, `result.envoyUsable`, `result.sidecarRunning`.
   * 拒绝 / Refusals: 条件 / conditions `error instanceof AppError && error.status === 503`; `row`; `host.legacyRunning || pendingTask`; 异常 / errors `error`; `changed()`.
   * 失败处理：catch 分支执行 `signal.throwIfAborted();`; `if (error instanceof AppError && error.status === 503) throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `signal.throwIfAborted();`; `if (error instanceof AppError && error.status === 503) throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async view(id: string, projectId: string, live: Context['live'] | undefined, signal: AbortSignal) {
    await this.durable(); signal.throwIfAborted();
    const project = copy(await this.workspaces.config(id), projectId), row = this.row(id, projectId),
      policy = this.store.policies[id]?.[projectId] || null, guestPaused = this.machines.state(id) === 'paused';
    const pendingTask = this.store.tasks.some(value => value.vmId === id && value.projectId === projectId);
    const result = { projectId, policy, guestRunning: false, envoyInstalled: false, tmuxInstalled: false,
      pythonInstalled: false, sidecarRunning: Boolean(row) || pendingTask, bindingValid: row || pendingTask ? false as boolean | null : null as boolean | null,
      bindingError: null as string | null, runId: row?.execution.record.runId || null as string | null,
      processes: [] as number[], configPresent: Boolean(row?.config), directoryPresent: false, namespacePresent: false,
      version: null as string | null, envoyUsable: null as boolean | null, directory: project.directory,
      networkIsolation: project.networkIsolation || 'host', sidecarStateKnown: !guestPaused && !row && !pendingTask,
      ready: false, executed: false as const };
    if (!this.running(id)) return { ...result, reason: row || pendingTask ? '请先恢复原实例并核对原边车完整运行域。' :
      guestPaused ? '请先恢复 Linux 实例并检查边车状态。' : '请先启动 Linux 实例。' };
    const context = await this.context(id, projectId, live, signal);
    let host: MeshHostStatus;
    try { host = await this.host(id, project, signal); await this.assertContext(context); }
    catch (error) { signal.throwIfAborted(); if (error instanceof AppError && error.status === 503) throw error;
      return { ...result, guestRunning: true, sidecarStateKnown: false,
        bindingError: '无法核对边车原归属，请检查 Python 3、系统工具和实例身份。',
        reason: '无法核对边车原归属，请检查 Python 3、系统工具和实例身份。' }; }
    Object.assign(result, { guestRunning: true, envoyInstalled: Boolean(host.envoy), tmuxInstalled: host.tmuxInstalled,
      pythonInstalled: host.pythonInstalled, directoryPresent: host.directoryPresent, namespacePresent: host.namespacePresent,
      configPresent: Boolean(row?.config) || host.legacyConfigPresent, sidecarStateKnown: true });
    const sample = this.sample(context, host); result.version = sample?.version || null; result.envoyUsable = sample?.usable ?? null;
    if (host.legacyRunning) { result.sidecarRunning = true; result.processes = host.legacyProcesses;
      result.bindingValid = false; result.bindingError = legacy().message; }
    if (pendingTask) { result.sidecarRunning = true; result.bindingValid = false;
      result.bindingError = '原网格有限任务清理尚未确认，请先核对并停止原完整任务域。'; }
    if (row) {
      try { if (host.legacyRunning || pendingTask) throw changed(); await this.prove(row, context, host);
        result.bindingValid = true; result.processes = [row.listener!.pid]; }
      catch (error) { signal.throwIfAborted(); if (error instanceof AppError && error.status === 503) throw error;
        result.bindingValid = false; result.bindingError = row.phase !== 'running'
          ? '原边车启动或停止尚未完成，请重试停止原完整运行域。' : changed().message; }
    } else if (!host.legacyRunning) {
      const scope = await this.scope(id, project).status(signal); await this.assertContext(context);
      if (!['absent', 'stopped'].includes(scope.status)) { result.sidecarRunning = true;
        result.bindingValid = false; result.bindingError = legacy().message; }
    }
    result.ready = Boolean(policy && host.envoy && host.tmuxInstalled && host.pythonInstalled && host.directoryPresent &&
      host.namespacePresent && result.envoyUsable === true && (!result.sidecarRunning || result.bindingValid));
    const reason = result.bindingError || (!policy ? '请先保存此项目的边车策略。' : !host.envoy ? '客户机尚未安装 Envoy。' :
      !host.tmuxInstalled ? '客户机尚未安装 tmux。' : !host.pythonInstalled ? '客户机尚未安装 Python 3。' :
      !host.directoryPresent ? '项目目录需要显式准备并迁移至项目账号。' : !host.namespacePresent ? '项目网络空间尚未就绪。' :
      sample?.usable === false ? '项目中的 Envoy 版本检查失败，请检查网络和客户机二进制兼容性。' :
      !sample ? '显式检查或启动将以原项目账号验证 Envoy 兼容性。' : null);
    return { ...result, ...(reason ? { reason } : {}) };
  }
  /**
   * 入口 / Entry: ServiceMesh.assertPortAvailable.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`ServiceMesh`）。
   * Purpose: Checks admission, input or resource ownership in `ServiceMesh`; this entry produces `void` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.workspaces.projects.inScope`, `this.store.runs.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.projects.inScope`, `this.store.runs.some`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `project.networkIsolation === 'private'`; `otherProject === projectId || policy.listenPort !== port`.
   * 输入 / Inputs: id: string; projectId: string; port: number; project: Project
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `other.networkIsolation !== 'private'`; `this.store.runs.some(row => row.vmId === id && row.projectId !== projectId && row.networkIsolation === 'host' && row.policy.l…`; 异常 / errors `new AppError('此监听端口已由同一实例的其他共享网络项目边车使用', 409)`; `new AppError('此监听端口仍由其他共享网络项目原完整运行域占用', 409)`.
   */
  private async assertPortAvailable(id: string, projectId: string, port: number, project: Project) {
    if (project.networkIsolation === 'private') return;
    for (const [otherProject, policy] of Object.entries(this.store.policies[id] || {})) {
      if (otherProject === projectId || policy.listenPort !== port) continue;
      const other = await this.workspaces.projects.inScope(id, otherProject, () => this.workspaces.config(id));
      if (other.networkIsolation !== 'private') throw new AppError('此监听端口已由同一实例的其他共享网络项目边车使用', 409);
    }
    if (this.store.runs.some(row => row.vmId === id && row.projectId !== projectId &&
        row.networkIsolation === 'host' && row.policy.listenPort === port))
      throw new AppError('此监听端口仍由其他共享网络项目原完整运行域占用', 409);
  }
  /**
   * 入口 / Entry: ServiceMesh.assertNoRunning.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`ServiceMesh`）。
   * Purpose: Checks admission, input or resource ownership in `ServiceMesh`; this entry produces `void` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.durable`, `this.machines.state`, `this.store.runs.some`, `this.store.tasks.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.durable`, `this.machines.state`, `this.store.runs.some`, `this.store.tasks.some`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.running(id)`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) === 'paused'`; `this.store.runs.some(row => row.vmId === id) || this.store.tasks.some(task => task.vmId === id)`; 异常 / errors `new AppError('请先恢复实例并停止所有项目的服务网格边车', 409)`; `new AppError('请先停止所有项目的服务网格边车', 409)`.
   */
  async assertNoRunning(id: string) {
    await this.durable();
    if (this.machines.state(id) === 'paused') throw new AppError('请先恢复实例并停止所有项目的服务网格边车', 409);
    if (this.store.runs.some(row => row.vmId === id) || this.store.tasks.some(task => task.vmId === id))
      throw new AppError('请先停止所有项目的服务网格边车', 409);
    if (!this.running(id)) return;
    const index = await this.workspaces.projects.list(id);
    for (const projectId of new Set([...index.projects.map(project => project.id), ...Object.keys(this.store.policies[id] || {})]))
      await this.workspaces.projects.inScope(id, projectId, async () => {
        const project = copy(await this.workspaces.config(id)), host = await this.host(id, project);
        const state = await this.scope(id, project).status();
        if (host.legacyRunning || !['absent', 'stopped'].includes(state.status))
          throw new AppError('请先停止所有项目的服务网格边车', 409);
      });
  }
  /** Policy/settings mutations share their lock; UID execution uses its own SDK locks. */
  /**
   * 入口 / Entry: ServiceMesh.configure.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; enabled: boolean; save: () => Promise<T>
   * 输出 / Returns: `this.serial(() => this.machines.locked(id, async () => { if (!enabled) await this.assertNoRunning(id); return save(); }))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  configure<T>(id: string, enabled: boolean, save: () => Promise<T>) {
    return this.serial(() => this.machines.locked(id, async () => {
      if (!enabled) await this.assertNoRunning(id); return save();
    }));
  }
  /**
   * 入口 / Entry: ServiceMesh.action.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.status(id, abort)` / `await task` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `this.status(id, abort)` / `await task` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `serviceMeshInput.parse`, `this.project`, `this.machines.live.get`, `AbortSignal.any` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `serviceMeshInput.parse`, `this.project`, `this.machines.live.get`, `AbortSignal.any`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `input.mode === 'status' && action === 'run'`.
   * 输入 / Inputs: id: string; raw: unknown; action: 'check' | 'run'; signal: AbortSignal optional
   * 输出 / Returns: `this.status(id, abort)`; `await task`.
   * 副作用 / Effects: `AbortSignal.any`; `abort.throwIfAborted`; `this.checks.add`; `this.checks.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `this.checks.delete(task);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.checks.delete(task);`; these steps also apply to exceptional exits.
   */
  async action(id: string, raw: unknown, action: 'check' | 'run', signal?: AbortSignal) {
    const input = serviceMeshInput.parse(raw), projectId = this.project(id), live = this.machines.live.get(id);
    const abort = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]); abort.throwIfAborted();
    if (input.mode === 'status' && action === 'run') return this.status(id, abort);
    /**
     * 入口 / Entry: ServiceMesh.action.callback@512.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.workspaces.projects.inScope）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.workspaces.projects.inScope).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ ...current, preview: input.policy, config: envoySidecarConfig(input.policy), ready: current.sidecarStateKnown && !current.s…`; `current`; `this.view(id, projectId, live, abort)`；另有分支返回 / additional branch-specific returns.
     * 副作用 / Effects: `abort.throwIfAborted`; `this.release`; `this.stop`; `this.stopTasks`; `this.start`; 更新 / updates `failure`.
     * 拒绝 / Refusals: 条件 / conditions `action === 'check'`; `preparedHost.bootId !== host.bootId || !same(preparedHost.envoy, host.envoy)`; `input.mode === 'stop'`; 异常 / errors `changed()`; `error`.
     * 收尾：退出 try 区域时始终执行 `await this.release(capture, failure);`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `await this.release(capture, failure);`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `failure = error;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `failure = error;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    const task = this.serial(() => this.workspaces.projects.inScope(id, projectId,
    /**
     * 中文功能：按 check/save/remove/stop/start 分派原项目边车操作，保存要求已停止且归属已核对，probe 捕获在 finally 释放。
     * English: Dispatches original-project sidecar check/save/remove/stop/start, requiring stopped/known ownership for saving and releasing probe captures in finally.
     * 所属 / Owner: ServiceMesh.action.task.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     */
    async () => {
      await this.durable(); abort.throwIfAborted();
      if (action === 'check') {
        const current = await this.view(id, projectId, live, abort);
        if (input.mode === 'save') {
          await this.assertPortAvailable(id, projectId, input.policy.listenPort, copy(await this.workspaces.config(id), projectId));
          return { ...current, preview: input.policy, config: envoySidecarConfig(input.policy),
            ready: current.sidecarStateKnown && !current.sidecarRunning, message: '策略可保存；启动前还会由项目账号 Envoy 验证配置。' };
        }
        if (!current.guestRunning || current.sidecarRunning && !current.bindingValid || !current.envoyInstalled ||
            !current.tmuxInstalled || !current.pythonInstalled || !current.directoryPresent) return current;
        const context = await this.context(id, projectId, live, abort);
        const host = await this.host(id, context.project, abort); await this.assertContext(context);
        const capture = await this.capture(context);
        let failure: unknown;
        try {
          const preparedHost = await this.host(id, context.project, capture.signal);
          await this.assertContext(capture);
          if (preparedHost.bootId !== host.bootId || !same(preparedHost.envoy, host.envoy)) throw changed();
          await this.probe(capture, preparedHost);
        }
        catch (error) { failure = error; throw error; }
        finally { await this.release(capture, failure); }
        return this.view(id, projectId, live, abort);
      }
      if (input.mode === 'save' || input.mode === 'remove')
      /**
       * 入口 / Entry: ServiceMesh.action.callback@537.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `{ ...(await this.view(id, projectId, live, abort)), ready: true, executed: true, message: input.mode === 'save' ? '项目边车策略已保存。…`.
       * 副作用 / Effects: `this.save`.
       * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) === 'paused'`; `current.sidecarRunning || !current.sidecarStateKnown`; `!current.policy`; 异常 / errors `new AppError('请先恢复实例并停止此项目的边车', 409)`; `new AppError('请先停止当前项目的边车并核对原归属', 409)`.
       */
      return this.machines.locked(id, async () => {
        if (this.machines.state(id) === 'paused') throw new AppError('请先恢复实例并停止此项目的边车', 409);
        const current = await this.view(id, projectId, live, abort);
        if (current.sidecarRunning || !current.sidecarStateKnown) throw new AppError('请先停止当前项目的边车并核对原归属', 409);
        if (input.mode === 'save') await this.assertPortAvailable(id, projectId, input.policy.listenPort,
          copy(await this.workspaces.config(id), projectId));
        else if (!current.policy) throw new AppError('此项目尚无边车策略', 404);
        await this.save(state => {
          if (input.mode === 'save') (state.policies[id] ||= {})[projectId] = { ...input.policy, updatedAt: new Date().toISOString() };
          else delete state.policies[id][projectId];
        });
        return { ...(await this.view(id, projectId, live, abort)), ready: true, executed: true,
          message: input.mode === 'save' ? '项目边车策略已保存。' : '项目边车策略已移除。' };
      });
      if (input.mode === 'stop') {
        const row = this.row(id, projectId);
        if (row) await this.stop(row);
        else {
          try { await this.stopTasks(id, projectId);
            for (const capture of this.pendingOperations) if (capture.vmId === id && capture.projectId === projectId) await this.release(capture);
          } catch (error) { throw cleanup([error]); }
          const current = await this.view(id, projectId, live, abort);
          if (current.sidecarRunning || !current.sidecarStateKnown) throw legacy(); }
        return { ...(await this.view(id, projectId, live, abort)), ready: true, executed: Boolean(row), message: '边车已停止。' };
      }
      return this.start(id, projectId, live, abort);
    }));
    this.checks.add(task); try { return await task; } finally { this.checks.delete(task); }
  }
  /**
   * 入口 / Entry: ServiceMesh.start.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...(await this.view(id, projectId, live, signal)), executed: true, configPath: row.config!.path }` 供上层消费（`ServiceMesh`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; this entry produces `{ ...(await this.view(id, projectId, live, signal)), executed: true, configPath: row.config!.path }` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.canStart`, `this.row`, `this.store.tasks.some`, `this.context` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.canStart`, `this.row`, `this.store.tasks.some`, `this.context`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!retained && !row`.
   * 输入 / Inputs: id: string; projectId: string; live: Context['live'] | undefined; signal: AbortSignal
   * 输出 / Returns: `{ ...(await this.view(id, projectId, live, signal)), executed: true, configPath: row.config!.path }`.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`; `this.save`; `this.pendingCaptures.set`; 更新 / updates `row`, `retained`, `failure`.
   * 拒绝 / Refusals: 条件 / conditions `!(await this.canStart(id))`; `!policy`; `this.row(id, projectId) || this.store.tasks.some(task => task.vmId === id && task.projectId === projectId)`; 异常 / errors `new AppError('此能力已禁用', 409)`; `new AppError('请先保存此项目的边车策略', 409)`.
   * 收尾：退出 try 区域时始终执行 `if (!retained && !row) await this.release(capture, failure);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (!retained && !row) await this.release(capture, failure);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `failure = error;`; `if (row) try { await this.stop(this.row(id, projectId) || row); retained = false; } catch (failed) { failure = cleanup([error…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `failure = error;`; `if (row) try { await this.stop(this.row(id, projectId) || row); retained = false; } catch (failed) { failure = cleanup([error…`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async start(id: string, projectId: string, live: Context['live'] | undefined, signal: AbortSignal) {
    if (!(await this.canStart(id))) throw new AppError('此能力已禁用', 409);
    const policy = this.store.policies[id]?.[projectId]; if (!policy) throw new AppError('请先保存此项目的边车策略', 409);
    if (this.row(id, projectId) || this.store.tasks.some(task => task.vmId === id && task.projectId === projectId))
      throw new AppError('此项目边车原完整运行域尚未结束，请先停止', 409);
    const context = await this.context(id, projectId, live, signal), host = await this.host(id, context.project, signal);
    await this.assertContext(context);
    if (host.legacyRunning) throw legacy();
    if (!host.envoy || !host.tmuxInstalled || !host.pythonInstalled)
      throw new AppError('客户机需要已安装的 Envoy、tmux 和 Python 3', 409);
    await this.assertPortAvailable(id, projectId, policy.listenPort, context.project);
    const capture = await this.capture(context); let row: MeshRun | undefined, failure: unknown, retained = false;
    try {
      const preparedHost = await this.host(id, context.project, capture.signal);
      await this.assertContext(capture);
      if (preparedHost.bootId !== host.bootId || !same(preparedHost.envoy, host.envoy)) throw changed();
      const { project, identity, sample, privateValues } = await this.probe(capture, preparedHost);
      if (!sample.usable) throw new AppError(sample.error || '项目中的 Envoy 版本检查失败', 409);
      await this.assertContext(capture); if (!(await this.canStart(id))) throw new AppError('此能力已禁用', 409);
      const scope = this.scope(id, context.project), state = await scope.status(capture.signal);
      await this.assertContext(capture); if (!['absent', 'stopped'].includes(state.status) || state.bootId !== host.bootId) throw legacy();
      const intent = scope.newIntent(createHash('sha256').update(JSON.stringify([context.version, policy])).digest('hex'), host.bootId);
      const source = JSON.stringify(envoySidecarConfig(policy)), plan = meshConfigPlan(identity, intent, source, policy);
      row = meshRunSchema.parse({ id: randomUUID(), vmId: id, projectId, directory: context.project.directory,
        networkIsolation: context.project.networkIsolation || 'host', configSha256: context.version, policy, binary: host.envoy,
        plan, config: null, listener: null, phase: 'starting', startedAt: new Date().toISOString(),
        execution: { identity, record: intent, run: null, sha256: null } });
      await this.save(state => { if (state.runs.some(value => keyOf(value) === keyOf(row!))) throw changed(); state.runs.push(row!); });
      this.pendingCaptures.set(keyOf(row), capture); retained = true;
      await scope.persistIntent(intent); await this.assertContext(capture);
      const published = meshConfigReplySchema.parse(await this.control(id, 'publish', plan, null, source, capture.signal));
      await this.assertContext(capture); if (!published.present || !published.config) throw changed();
      row = await this.update(row, value => { value.config = published.config; });
      const validation = { command: meshEnvoyExecution(host.envoy!, row.config!, true), environment: project.environment };
      const validated = await this.finite(capture, identity, plan.bootId, validation, 180000);
      if (validated.code !== 0) throw new AppError(redactValues(validated.stderr || '无法验证边车固定配置', privateValues).slice(-2000), 409);
      const execution = { command: meshEnvoyExecution(host.envoy!, row.config!), environment: project.environment },
        sha256 = this.payload(execution).sha256;
      row = await this.update(row, value => { value.execution.sha256 = sha256; });
      const payload = await this.scopes.inherited(id, capture.project, execution,
        { kind: 'service', runId: intent.runId, bootId: intent.bootId }, capture.signal);
      await this.assertContext(capture); if (!same(payload.identity, identity) || payload.sha256 !== sha256) throw changed();
      const record = await scope.start(intent, payload, capture.signal); await this.assertContext(capture);
      row = await this.update(row, value => { value.execution.record = record; });
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        await this.assertContext(capture);
        if (await this.scopes.active(id, projectId, intent.runId, capture.signal)) {
          const run = await this.identities.runReadonly(id, identity, intent.runId, capture.signal); await this.assertContext(capture);
          if (!matches(run, identity, record)) throw changed();
          const listener = await this.listener(row, run, capture.signal); await this.assertContext(capture);
          if (listener) {
            if (listener.port !== policy.listenPort) throw changed();
            await this.process(row, run, listener, capture.signal); await this.assertContext(capture);
            if (!same(await this.listener(row, run, capture.signal), listener)) throw changed();
            row = await this.update(row, value => { value.execution.run = run; value.listener = listener; value.phase = 'running'; });
            await this.prove(row, capture, await this.host(id, context.project, capture.signal));
            await this.release(capture); this.pendingCaptures.delete(keyOf(row)); retained = false;
            return { ...(await this.view(id, projectId, live, signal)), executed: true, configPath: row.config!.path };
          }
        }
        await delay(100, undefined, { signal: capture.signal });
      }
      throw new AppError('项目 UID Envoy 就绪检查超时', 409);
    } catch (error) {
      failure = error;
      if (row) try { await this.stop(this.row(id, projectId) || row); retained = false; }
      catch (failed) { failure = cleanup([error, failed]); throw failure; }
      throw error;
    } finally {
      // Once intent exists, the pending capture is released only by confirmed
      // complete-domain stop or by the completed startup path above.
      if (!retained && !row) await this.release(capture, failure);
    }
  }
  /**
   * 入口 / Entry: ServiceMesh.stop.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ServiceMesh`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ServiceMesh`; the calls and state transitions below complete the operation. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.durable`, `this.machines.live.get`, `origin`, `this.update` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.durable`, `this.machines.live.get`, `origin`, `this.update`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `capture`; `pending !== capture && pending.vmId === row.vmId && pending.projectId === row.projectId`.
   * 输入 / Inputs: original: MeshRun
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.update`; `this.stopTasks`; `this.scope().stop`; `this.release`; `this.save`; 更新 / updates `row`.
   * 拒绝 / Refusals: 异常 / errors `cleanup([error])`.
   * 失败处理：catch 分支执行 `throw cleanup([error]);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw cleanup([error]);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async stop(original: MeshRun) {
    await this.durable(original);
    /**
     * 入口 / Entry: ServiceMesh.stop.origin.
     * 功能：在管理项目 Envoy 边车策略及运行状态中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ServiceMesh`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceMesh`; the calls and state transitions below complete the operation. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
     * 处理：通过 `this.running`, `this.machines.live.get`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.running`, `this.machines.live.get`, `changed`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!live || !this.running(original.vmId) || this.machines.live.get(original.vmId) !== live`; 异常 / errors `changed()`.
     */
    const live = this.machines.live.get(original.vmId), origin = () => {
      if (!live || !this.running(original.vmId) || this.machines.live.get(original.vmId) !== live) throw changed();
    };
    let row = original;
    try {
      origin(); row = await this.update(row, value => { value.phase = 'stopping'; });
      await this.stopTasks(row.vmId, row.projectId); origin();
      await this.scope(row.vmId, binding(row)).stop(row.execution.record); origin(); await this.durable(row);
      // This root metadata cleanup also requires original cgroup absence and
      // verifies the exact root-owned receipt/config before unlinking anything.
      meshConfigCleanSchema.parse(await this.control(row.vmId, 'cleanup', row.plan, row.config)); origin();
      const capture = this.pendingCaptures.get(keyOf(row)); if (capture) await this.release(capture);
      for (const pending of this.pendingOperations) if (pending !== capture && pending.vmId === row.vmId && pending.projectId === row.projectId)
        await this.release(pending);
      await this.save(state => { const found = state.runs.find(value => value.id === row.id);
        if (!found || !same(found, row)) throw changed(); state.runs.splice(state.runs.indexOf(found), 1); });
      this.pendingCaptures.delete(keyOf(row));
    } catch (error) { throw cleanup([error]); }
  }
  /**
   * 入口 / Entry: ServiceMesh.close.
   * 功能：在管理项目 Envoy 边车策略及运行状态中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closing` / `closing` 供上层消费（`ServiceMesh`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ServiceMesh`; this entry produces `this.closing` / `closing` for its caller. Module context: Owns project Envoy sidecar policy/state, checking port relationships and complete project runtime ownership.
   * 处理：通过 `this.controller.abort`, `inline`, `closing.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.controller.abort`, `inline`, `closing.catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closing`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.closing`; `closing`.
   * 副作用 / Effects: `this.controller.abort`; 更新 / updates `this.closed`, `this.closing`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() {
    if (this.closing) return this.closing;
    this.closed = true; this.controller.abort();
    /**
     * 入口 / Entry: ServiceMesh.close.callback@665.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.release`; `errors.push`.
     * 拒绝 / Refusals: 条件 / conditions `errors.length`; 异常 / errors `cleanup(errors)`.
     * 失败处理：catch 分支执行 `errors.push(error);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `errors.push(error);`; these statements determine whether a failure is absorbed or rejected again.
     */
    const closing = (async () => {
      await this.writes; await Promise.allSettled([...this.checks]);
      // Completed persistent services survive host reload. Failed startup
      // reservations remain owned until their original domains are stopped.
      const results = await Promise.allSettled([...this.pendingCaptures.keys()].map(async key => {
        const row = this.store.runs.find(value => keyOf(value) === key);
        if (!row) throw changed();
        await this.workspaces.projects.inScope(row.vmId, row.projectId, () => this.stop(row));
      }));
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      for (const capture of this.pendingOperations) {
        if (this.pendingCaptures.get(keyOf(capture)) === capture) continue;
        try { await this.release(capture); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw cleanup(errors); await this.metadataWrites; this.unguard();
    })();
    this.closing = closing; void closing.catch(() => { if (this.closing === closing) this.closing = undefined; }); return closing;
  }
}
