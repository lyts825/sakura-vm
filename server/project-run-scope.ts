/**
 * 模块职责：维护项目账户运行日志及资源票据，协调任务、终端、SSH 与网络核销的原归属。
 * Module purpose: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
 */
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { ExecutionScope } from './execution-scope.ts';
import { vmLifetime } from './vm-lifetime.ts';
import { ProjectSessionLifetime } from './project-session-lifetime.ts';
import type { Project } from './project-config.ts';
import { AppError } from '../shared/errors.ts';
import { vmDir } from './paths.ts';
import { quote } from './shell.ts';
import { readStore, writeStore } from './local-store.ts';
import { guestTask } from './guest-task.ts';
import { projectIdSchema } from './project-catalog.ts';
import { assertNoPendingProjectDirectoryMigration } from './project-admission.ts';
import {
  SshAgentScopes,
  OwnedForwardAgent,
  sshAgentResourceSchema,
  sshAgentSocketPath,
  bindTaskAgent,
  type SshAgentResource,
  type SshAgentContext,
} from './ssh-agent-scope.ts';
import {
  GpgAgentScopes,
  gpgAgentResourceSchema,
  gpgAgentHomePath,
  bindTaskGpg,
  type GpgAgentResource,
  type GpgAgentContext,
} from './gpg-agent-scope.ts';
import { OwnedGpgForward } from './gpg-agent-host.ts';
import {
  ProjectIdentities,
  projectIdentitySchema,
  projectIdentityRunSchema,
  projectIdentityNetworkSchema,
  type ProjectIdentity,
  type ProjectIdentityRun,
  type ProjectIdentityExecution,
} from './project-identity.ts';
import { projectIdentitySshDaemonSchema, type ProjectIdentitySshDaemon } from './project-identity.ts';

const bindingSchema = z.object({ directory: z.string().min(1), networkIsolation: z.enum(['host', 'private']) }).strict();
const ownerSchema = z.object({ kind: z.enum(['task', 'main', 'service', 'terminal', 'ssh']), runId: z.uuid(), bootId: z.uuid(),
  cgroupName: z.string().regex(/^(openrc\.sakura-ssh-(default|[a-f0-9]{16})|system\.slice\/sakura-ssh-(default|[a-f0-9]{16})\.service)$/).optional(),
}).strict().refine(value => (value.kind === 'ssh') === Boolean(value.cgroupName));
export type ProjectRunOwner = z.infer<typeof ownerSchema>;
const terminalSchema = z.object({ name: z.string().regex(/^sakura-terminal-(default|[a-f0-9]{16})-[a-z0-9-]{1,48}$/),
  persistent: z.boolean() }).strict();
const cacheTransferSchema = z.object({ stageId: z.uuid(), manager: z.enum(['npm', 'pip']),
  build: z.string().regex(/^[a-f0-9]{64}$/), phase: z.enum(['pending', 'closed']) }).strict();
export type ProjectTaskResourceDescriptor = Omit<z.infer<typeof cacheTransferSchema>, 'phase'>;
/**
 * 入口 / Entry: callback@66.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.object().strict().superRefine）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.object().strict().superRefine).
 * 输入 / Inputs: value; ctx
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `value.terminal.name.startsWith`; `ctx.addIssue`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const entrySchema = z.object({ version: z.literal(1), projectId: projectIdSchema, identity: projectIdentitySchema,
  runId: z.uuid(), owner: ownerSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(['intent', 'active', 'closed']), run: projectIdentityRunSchema.nullable(),
  cacheTransfer: cacheTransferSchema.optional(),
  sshAgent: sshAgentResourceSchema.optional(),
  gpgAgent: gpgAgentResourceSchema.optional(),
  terminal: terminalSchema.optional(),
  retirement: z.object({ reason: z.literal('guest-reboot'), bootId: z.uuid() }).strict().optional() }).strict()
  .superRefine((value, ctx) => {
    if (value.projectId !== value.identity.projectId || value.runId !== value.owner.runId ||
        (value.owner.kind === 'ssh' && !['openrc.sakura-ssh-' + value.projectId,
          'system.slice/sakura-ssh-' + value.projectId + '.service'].includes(value.owner.cgroupName!)) ||
        (Boolean(value.terminal) !== (value.owner.kind === 'terminal')) ||
        (value.terminal && !value.terminal.name.startsWith('sakura-terminal-' + value.projectId + '-')) ||
        (value.run && (value.run.runId !== value.runId || value.run.mode !== (value.owner.kind === 'terminal' ? 'independent' : 'inherit-current') ||
          value.run.projectId !== value.projectId || value.run.identityId !== value.identity.identityId ||
          value.run.registryId !== value.identity.registryId || value.run.revision !== value.identity.revision ||
          value.run.bootId !== value.owner.bootId || value.run.cgroupName !== scopeName(value.owner))) ||
        (value.phase === 'active' && !value.run) ||
        ((value.sshAgent || value.gpgAgent) && value.owner.kind !== 'task') ||
        (value.sshAgent && value.gpgAgent) || (value.cacheTransfer && value.owner.kind !== 'task') ||
        (value.cacheTransfer?.phase === 'closed' && value.phase !== 'closed') ||
        (value.retirement && (value.phase !== 'closed' || value.retirement.bootId === value.owner.bootId)) ||
        (value.phase === 'closed' && value.run?.phase === 'active' && !value.retirement))
      ctx.addIssue({ code: 'custom', message: '项目账号运行记录不完整' });
  });
type Entry = z.infer<typeof entrySchema>;
const networkLeaseSchema = z.object({ version: z.literal(1), phase: z.literal('pending'), releaseId: z.uuid(),
  network: projectIdentityNetworkSchema }).strict();
const networkReleaseIntentSchema = z.object({ version: z.literal(1), releaseId: z.uuid(), bootId: z.uuid(),
  identity: projectIdentitySchema, lease: networkLeaseSchema.nullable() }).strict().superRefine((value, ctx) => {
  if (value.lease && (value.identity.networkIsolation !== 'private' ||
      value.lease.releaseId !== value.releaseId || value.lease.network.bootId !== value.bootId ||
      (['projectId', 'identityId', 'registryId', 'revision'] as const).some(key =>
        value.lease!.network[key] !== value.identity[key])))
    ctx.addIssue({ code: 'custom', message: '项目网络核销身份不完整' });
});
export type ProjectNetworkReleaseIntent = z.infer<typeof networkReleaseIntentSchema>;
const networkReleaseStateSchema = z.object({ intent: networkReleaseIntentSchema,
  phase: z.enum(['intent', 'pending', 'released']) }).strict();
const journalSchema = z.object({ version: z.literal(1), projectId: projectIdSchema,
  identity: projectIdentitySchema.nullable(),
  pending: z.object({ kind: z.enum(['ensure', 'rebind']), binding: bindingSchema }).strict().nullable(),
  networkRelease: networkReleaseStateSchema.nullable().optional(),
  runs: z.array(entrySchema).max(1024) }).strict().superRefine((value, ctx) => {
    if ((value.identity && value.identity.projectId !== value.projectId) ||
        value.runs.some(run => run.projectId !== value.projectId) ||
        new Set(value.runs.map(run => run.runId)).size !== value.runs.length ||
        (value.pending?.kind === 'rebind' && !value.identity) ||
        (value.networkRelease && (value.networkRelease.intent.identity.projectId !== value.projectId ||
          (value.networkRelease.phase !== 'released' && !same(value.networkRelease.intent.identity, value.identity)))))
      ctx.addIssue({ code: 'custom', message: '项目账号登记记录不完整' });
  });
type Journal = z.infer<typeof journalSchema>;
type Core = Pick<ProjectIdentities, 'ensure' | 'inspect' | 'rebind' | 'inheritedInput' | 'run' | 'stop'> &
  Partial<Pick<ProjectIdentities, 'runReadonly' | 'networkReadonly' | 'prepare' | 'retireTerminal' | 'sshSnapshotInput' | 'prepareSsh'>> & {
    /**
     * 签名 / Signature: Core.beginNetworkRelease.
     * 功能：为维护项目账户运行日志及资源票据声明 beginNetworkRelease 的输入与结果契约，所属容器为 Core。
     * Purpose: Declares the input/result contract for beginNetworkRelease in Core. Module responsibility: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
     * 输入 / Inputs: vmId: string; identity: ProjectIdentity; options: { releaseId: string; bootId: string }; signal: AbortSignal optional
     * 输出 / Returns: Promise<z.infer<typeof networkLeaseSchema> | null>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    beginNetworkRelease?: (vmId: string, identity: ProjectIdentity, options: { releaseId: string; bootId: string },
      signal?: AbortSignal) => Promise<z.infer<typeof networkLeaseSchema> | null>;
    /**
     * 签名 / Signature: Core.releaseNetwork.
     * 功能：为维护项目账户运行日志及资源票据声明 releaseNetwork 的输入与结果契约，所属容器为 Core。
     * Purpose: Declares the input/result contract for releaseNetwork in Core. Module responsibility: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
     * 输入 / Inputs: vmId: string; identity: ProjectIdentity; lease: z.infer<typeof networkLeaseSchema>; signal: AbortSignal optional
     * 输出 / Returns: Promise<{ version: 1; phase: 'released'; releaseId: string; network: z.infer<typeof projectIdentityNetworkSchema> }>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    releaseNetwork?: (vmId: string, identity: ProjectIdentity, lease: z.infer<typeof networkLeaseSchema>,
      signal?: AbortSignal) => Promise<{ version: 1; phase: 'released'; releaseId: string; network: z.infer<typeof projectIdentityNetworkSchema> }>;
  };
const sharedCores = new WeakMap<Machines, ProjectIdentities>();
const scopeQueues = new WeakMap<Machines, Map<string, Promise<unknown>>>();
type TaskContext = { live: NonNullable<ReturnType<Machines['live']['get']>>; bootId: string };
export type ProjectTaskResourceContext = { identity: ProjectIdentity; owner: { kind: 'task'; runId: string; bootId: string };
  sha256: string; live: TaskContext['live'] };
export type ProjectTaskResourceReceipt = { run: ProjectIdentityRun | null;
  retirement?: { reason: 'guest-reboot'; bootId: string } };
export type ProjectTaskAdmissionOptions = { resource?: {
  descriptor: ProjectTaskResourceDescriptor;
  /**
   * 签名 / Signature: ProjectTaskAdmissionOptions.prepare.
   * 功能：为维护项目账户运行日志及资源票据声明 prepare 的输入与结果契约，所属容器为 ProjectTaskAdmissionOptions。
   * Purpose: Declares the input/result contract for prepare in ProjectTaskAdmissionOptions. Module responsibility: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 输入 / Inputs: context: ProjectTaskResourceContext
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  prepare(context: ProjectTaskResourceContext): Promise<void>;
  /**
   * 签名 / Signature: ProjectTaskAdmissionOptions.retire.
   * 功能：为维护项目账户运行日志及资源票据声明 retire 的输入与结果契约，所属容器为 ProjectTaskAdmissionOptions。
   * Purpose: Declares the input/result contract for retire in ProjectTaskAdmissionOptions. Module responsibility: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 输入 / Inputs: context: ProjectTaskResourceContext; receipt: ProjectTaskResourceReceipt
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  retire(context: ProjectTaskResourceContext, receipt: ProjectTaskResourceReceipt): Promise<void>;
};
/**
 * 签名 / Signature: ProjectTaskAdmissionOptions.beforeIntent.
 * 功能：为维护项目账户运行日志及资源票据声明 beforeIntent 的输入与结果契约，所属容器为 ProjectTaskAdmissionOptions。
 * Purpose: Declares the input/result contract for beforeIntent in ProjectTaskAdmissionOptions. Module responsibility: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
 * 输入 / Inputs: value: { identity: ProjectIdentity; owner: ProjectRunOwner; sha256: string }
 * 输出 / Returns: Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
beforeIntent?: (value: { identity: ProjectIdentity; owner: ProjectRunOwner; sha256: string }) => Promise<void>;
  expectedLive?: TaskContext['live']; expectedBootId?: string;
  sshAgent?: { resource: SshAgentResource; agent: OwnedForwardAgent; scopes?: SshAgentScopes };
  gpgAgent?: { resource: GpgAgentResource; bridge: OwnedGpgForward; scopes?: GpgAgentScopes } };
type ActiveTask = TaskContext & { file: string; entry: Entry };
const activeTasks = new WeakMap<Machines, Map<string, ActiveTask>>();
type TaskRecovery = { record: ActiveTask;
/**
 * 签名 / Signature: TaskRecovery.recover.
 * 功能：为维护项目账户运行日志及资源票据声明 recover 的输入与结果契约，所属容器为 TaskRecovery。
 * Purpose: Declares the input/result contract for recover in TaskRecovery. Module responsibility: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
recover: () => Promise<void> };
const taskRecoveries = new WeakMap<Machines, Map<string, TaskRecovery>>();
export type ProjectInheritedPayload = { identity: ProjectIdentity; runId: string; command: string; input: Buffer; sha256: string };
type Access = {
  /**
   * 签名 / Signature: Access.reserve.
   * 功能：为维护项目账户运行日志及资源票据声明 reserve 的输入与结果契约，所属容器为 Access。
   * Purpose: Declares the input/result contract for reserve in Access. Module responsibility: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 输入 / Inputs: project: Project; signal: AbortSignal optional
   * 输出 / Returns: Promise<ProjectIdentity>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  reserve(project: Project, signal?: AbortSignal): Promise<ProjectIdentity>;
  /**
   * 签名 / Signature: Access.identity.
   * 功能：为维护项目账户运行日志及资源票据声明 identity 的输入与结果契约，所属容器为 Access。
   * Purpose: Declares the input/result contract for identity in Access. Module responsibility: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 输入 / Inputs: project: Project; signal: AbortSignal optional
   * 输出 / Returns: Promise<ProjectIdentity>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  identity(project: Project, signal?: AbortSignal): Promise<ProjectIdentity>;
  /**
   * 签名 / Signature: Access.recoverStoppedTasks.
   * 功能：为维护项目账户运行日志及资源票据声明 recoverStoppedTasks 的输入与结果契约，所属容器为 Access。
   * Purpose: Declares the input/result contract for recoverStoppedTasks in Access. Module responsibility: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  recoverStoppedTasks(): Promise<void>;
  /**
   * 签名 / Signature: Access.guard.
   * 功能：为维护项目账户运行日志及资源票据声明 guard 的输入与结果契约，所属容器为 Access。
   * Purpose: Declares the input/result contract for guard in Access. Module responsibility: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  guard(): Promise<void>;
};
/**
 * 入口 / Entry: same.
 * 功能：从当前输入或状态计算 `JSON.stringify(left) === JSON.stringify(right)`，供调用方后续验证或使用。
 * Purpose: Computes `JSON.stringify(left) === JSON.stringify(right)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: left: unknown; right: unknown
 * 输出 / Returns: `JSON.stringify(left) === JSON.stringify(right)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
/**
 * 入口 / Entry: binding.
 * 功能：把本层请求转交 `bindingSchema.parse`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `bindingSchema.parse` and propagates the provider result or rejection.
 * 输入 / Inputs: project: { directory: string; networkIsolation?: 'host' | 'private' }
 * 输出 / Returns: `bindingSchema.parse({ directory: project.directory, networkIsolation: project.networkIsolation || 'host' })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const binding = (project: { directory: string; networkIsolation?: 'host' | 'private' }) => bindingSchema.parse({ directory: project.directory,
  networkIsolation: project.networkIsolation || 'host' });
/**
 * 入口 / Entry: expected.
 * 功能：从当前输入或状态计算 `({ registryId: identity.registryId, identityId: identity.identityId, revision: identity.revision })`，供调用方后续验证或使用。
 * Purpose: Computes `({ registryId: identity.registryId, identityId: identity.identityId, revision: identity.revision })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: identity: ProjectIdentity
 * 输出 / Returns: `({ registryId: identity.registryId, identityId: identity.identityId, revision: identity.revision })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const expected = (identity: ProjectIdentity) => ({ registryId: identity.registryId,
  identityId: identity.identityId, revision: identity.revision });
/**
 * 入口 / Entry: projectId.
 * 功能：把本层请求转交 `projectIdSchema.parse`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `projectIdSchema.parse` and propagates the provider result or rejection.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `projectIdSchema.parse(project._workspace || 'default')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const projectId = (project: Project) => projectIdSchema.parse(project._workspace || 'default');
/**
 * 入口 / Entry: scopeName.
 * 功能：从当前输入或状态计算 `owner.kind === 'ssh' ? owner.cgroupName! : `sakura-${owner.kind === 'terminal' ? 'identity' : owner.kind}-${owner.runId}``，供调用方后续验证或使用。
 * Purpose: Computes `owner.kind === 'ssh' ? owner.cgroupName! : `sakura-${owner.kind === 'terminal' ? 'identity' : owner.kind}-${owner.runId}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: owner: ProjectRunOwner
 * 输出 / Returns: `owner.kind === 'ssh' ? owner.cgroupName! : `sakura-${owner.kind === 'terminal' ? 'identity' : owner.kind}-${owner.runId}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const scopeName = (owner: ProjectRunOwner) => owner.kind === 'ssh' ? owner.cgroupName! :
  `sakura-${owner.kind === 'terminal' ? 'identity' : owner.kind}-${owner.runId}`;
/**
 * 入口 / Entry: sameIdentity.
 * 功能：从当前输入或状态计算 `Object.keys(left).every(key => mutable.has(key) || left[key as keyof ProjectIdentity] === right[key as keyof ProjectIdentity]…`，供调用方后续验证或使用。
 * Purpose: Computes `Object.keys(left).every(key => mutable.has(key) || left[key as keyof ProjectIdentity] === right[key as keyof ProjectIdentity]…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: left: ProjectIdentity; right: ProjectIdentity; rebind: default=false
 * 输出 / Returns: `Object.keys(left).every(key => mutable.has(key) || left[key as keyof ProjectIdentity] === right[key as keyof ProjectIdentity]…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const sameIdentity = (left: ProjectIdentity, right: ProjectIdentity, rebind = false) => {
  const mutable = new Set(['phase', ...(rebind ? ['revision', 'directory', 'directoryDevice', 'directoryInode', 'networkIsolation'] : [])]);
  return Object.keys(left).every(key => mutable.has(key) || left[key as keyof ProjectIdentity] === right[key as keyof ProjectIdentity]) &&
    (left.phase !== 'active' || right.phase === 'active') && (!rebind || right.revision === left.revision + 1);
};

/** Host receipts contain identities and hashes only, never project command/environment bodies. */
export class ProjectRunScopes {
  private core: Core;
  /**
   * 入口 / Entry: ProjectRunScopes.constructor.
   * 功能：建立 ProjectRunScopes 的维护项目账户运行日志及资源票据上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectRunScopes context for this module's responsibility: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; options: { identities?: Core; rootDirectory?: string; agentScopes?: Pick<SshAgentScopes, 'clea… default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `sharedCores.set`; 更新 / updates `this.core`, `core`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private machines: Machines, private options: { identities?: Core; rootDirectory?: string;
    agentScopes?: Pick<SshAgentScopes, 'cleanup'>; gpgScopes?: Pick<GpgAgentScopes, 'cleanup'> } = {}) {
    if (options.identities) this.core = options.identities;
    else {
      let core = sharedCores.get(machines);
      if (!core) { core = new ProjectIdentities(machines); sharedCores.set(machines, core); }
      this.core = core;
    }
  }
  /**
   * 入口 / Entry: ProjectRunScopes.file.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(this.options.rootDirectory || vmDir(vmId), 'project-identities', projectIdSchema.parse(id) + '.json')` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `join(this.options.rootDirectory || vmDir(vmId), 'project-identities', projectIdSchema.parse(id) + '.json')` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `join`, `vmDir`, `projectIdSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `vmDir`, `projectIdSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: `join(this.options.rootDirectory || vmDir(vmId), 'project-identities', projectIdSchema.parse(id) + '.json')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file(vmId: string, id: string) {
    return join(this.options.rootDirectory || vmDir(vmId), 'project-identities', projectIdSchema.parse(id) + '.json');
  }
  /**
   * 入口 / Entry: ProjectRunScopes.read.
   * 功能：在维护项目账户运行日志及资源票据中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `value` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectRunScopes`; this entry produces `value` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `journalSchema.parse`, `readStore`, `this.file` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `journalSchema.parse`, `readStore`, `this.file`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: `value`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `value.projectId !== id`; 异常 / errors `new Error('wrong project')`; `new AppError('项目账号主机登记无法核对，保留原记录', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   * 失败处理：catch 分支执行 `throw new AppError('项目账号主机登记无法核对，保留原记录', 409, 'PROJECT_IDENTITY_HOST_CHANGED');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('项目账号主机登记无法核对，保留原记录', 409, 'PROJECT_IDENTITY_HOST_CHANGED');`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async read(vmId: string, id: string) {
    try {
      const value = journalSchema.parse(await readStore(this.file(vmId, id), (): Journal => ({
        version: 1, projectId: id, identity: null, pending: null, runs: [] })));
      if (value.projectId !== id) throw new Error('wrong project');
      return value;
    } catch {
      throw new AppError('项目账号主机登记无法核对，保留原记录', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    }
  }
  /**
   * 入口 / Entry: ProjectRunScopes.save.
   * 功能：在维护项目账户运行日志及资源票据中，校验并提交领域状态变更；本入口产生 `writeStore(this.file(vmId, id), journalSchema.parse(value))` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Validates and commits a domain state change in `ProjectRunScopes`; this entry produces `writeStore(this.file(vmId, id), journalSchema.parse(value))` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `writeStore`, `this.file`, `journalSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `writeStore`, `this.file`, `journalSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; value: Journal
   * 输出 / Returns: `writeStore(this.file(vmId, id), journalSchema.parse(value))`.
   * 副作用 / Effects: `writeStore`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private save(vmId: string, id: string, value: Journal) {
    return writeStore(this.file(vmId, id), journalSchema.parse(value));
  }
  /**
   * 入口 / Entry: ProjectRunScopes.archiveFile.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(this.options.rootDirectory || vmDir(vmId), 'project-identities', projectIdSchema.parse(id), 'closed-runs', z.uuid().pars…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `join(this.options.rootDirectory || vmDir(vmId), 'project-identities', projectIdSchema.parse(id), 'closed-runs', z.uuid().pars…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `join`, `vmDir`, `projectIdSchema.parse`, `z.uuid().parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `vmDir`, `projectIdSchema.parse`, `z.uuid().parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; runId: string
   * 输出 / Returns: `join(this.options.rootDirectory || vmDir(vmId), 'project-identities', projectIdSchema.parse(id), 'closed-runs', z.uuid().pars…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private archiveFile(vmId: string, id: string, runId: string) {
    return join(this.options.rootDirectory || vmDir(vmId), 'project-identities', projectIdSchema.parse(id),
      'closed-runs', z.uuid().parse(runId) + '.json');
  }
  /**
   * 入口 / Entry: ProjectRunScopes.archived.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `null` / `entry` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `null` / `entry` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `Symbol`, `readStore`, `this.archiveFile`, `entrySchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Symbol`, `readStore`, `this.archiveFile`, `entrySchema.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value === absent`.
   * 输入 / Inputs: vmId: string; id: string; runId: string
   * 输出 / Returns: Promise<Entry | null>；结果来自 / values from `null`; `entry`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `entry.projectId !== id || entry.runId !== runId || entry.phase !== 'closed'`; 异常 / errors `new Error('wrong archive')`; `new AppError('项目账号历史记录无法核对，保留原记录', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   * 失败处理：catch 分支执行 `throw new AppError('项目账号历史记录无法核对，保留原记录', 409, 'PROJECT_IDENTITY_HOST_CHANGED');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('项目账号历史记录无法核对，保留原记录', 409, 'PROJECT_IDENTITY_HOST_CHANGED');`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async archived(vmId: string, id: string, runId: string): Promise<Entry | null> {
    try {
      const absent = Symbol('archive absent');
      const value = await readStore<unknown>(this.archiveFile(vmId, id, runId), () => absent);
      if (value === absent) return null;
      const entry = entrySchema.parse(value);
      if (entry.projectId !== id || entry.runId !== runId || entry.phase !== 'closed') throw new Error('wrong archive');
      return entry;
    } catch {
      throw new AppError('项目账号历史记录无法核对，保留原记录', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    }
  }
  /**
   * 入口 / Entry: ProjectRunScopes.compact.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `void` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `journal.runs.filter().slice`, `journal.runs.filter`, `this.archived`, `same` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `journal.runs.filter().slice`, `journal.runs.filter`, `this.archived`, `same`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `journal.runs.length < 1024`; `!prior`.
   * 输入 / Inputs: vmId: string; id: string; journal: Journal
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `writeStore`; `closed.map`; `this.save`; 更新 / updates `journal.runs`.
   * 拒绝 / Refusals: 条件 / conditions `!closed.length`; `prior && !same(prior, entry)`; `!same(await this.archived(vmId, id, entry.runId), entry)`; 异常 / errors `new AppError('项目账号未确认的运行记录达到上限，请先完成所属运行清理', 409, 'PROJECT_IDENTITY_HOST_LIMIT')`; `new AppError('项目账号历史记录与原运行不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   */
  private async compact(vmId: string, id: string, journal: Journal) {
    if (journal.runs.length < 1024) return;
    const closed = journal.runs.filter(run => run.phase === 'closed' && run.cacheTransfer?.phase !== 'pending').slice(0, 512);
    if (!closed.length)
      throw new AppError('项目账号未确认的运行记录达到上限，请先完成所属运行清理', 409, 'PROJECT_IDENTITY_HOST_LIMIT');
    // 先把完整 closed 回执写成持久墓碑再从有界日志移除；部分归档失败保留原日志。
    // 已归档的 UUID 仍参与准入检查，不能被再次用于新的执行。
    for (const entry of closed) {
      const prior = await this.archived(vmId, id, entry.runId);
      if (prior && !same(prior, entry))
        throw new AppError('项目账号历史记录与原运行不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      if (!prior) await writeStore(this.archiveFile(vmId, id, entry.runId), entrySchema.parse(entry));
      if (!same(await this.archived(vmId, id, entry.runId), entry))
        throw new AppError('项目账号历史记录写入未确认', 503, 'PROJECT_IDENTITY_HOST_CHANGED');
    }
    const retired = new Set(closed.map(run => run.runId));
    journal.runs = journal.runs.filter(run => !retired.has(run.runId));
    await this.save(vmId, id, journal);
  }
  /**
   * 入口 / Entry: ProjectRunScopes.guardUnlocked.
   * 功能：在维护项目账户运行日志及资源票据中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`ProjectRunScopes`）。
   * Purpose: Checks admission, input or resource ownership in `ProjectRunScopes`; the calls and state transitions below complete the operation. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `this.read`, `value.runs.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.read`, `value.runs.some`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; permitPending: default=false; permitNetworkRelease: default=false
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!permitNetworkRelease && value.networkRelease && value.networkRelease.phase !== 'released'`; `!permitPending && value.pending`; `value.runs.some(run => run.phase !== 'closed' || run.cacheTransfer?.phase === 'pending')`; 异常 / errors `new AppError('项目网络核销尚未确认，请先重试原停止操作', 409, 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING')`; `new AppError('项目账号绑定尚未确认，请先恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING')`.
   */
  private async guardUnlocked(vmId: string, id: string, permitPending = false, permitNetworkRelease = false) {
    const value = await this.read(vmId, id);
    if (!permitNetworkRelease && value.networkRelease && value.networkRelease.phase !== 'released')
      throw new AppError('项目网络核销尚未确认，请先重试原停止操作', 409, 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING');
    if (!permitPending && value.pending)
      throw new AppError('项目账号绑定尚未确认，请先恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING');
    if (value.runs.some(run => run.phase !== 'closed' || run.cacheTransfer?.phase === 'pending'))
      throw new AppError('项目账号仍有待确认的运行，请先完成所属运行清理', 409, 'PROJECT_IDENTITY_RUNS_MUST_STOP');
  }
  /** 对同一实例项目串行操作账号日志；回调退出后，交付的锁内访问器也立即失效。 */
  /**
   * 入口 / Entry: ProjectRunScopes.withLock.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await operation` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `await operation` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `scopeQueues.get`, `scopeQueues.set`, `inline.catch().then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `scopeQueues.get`, `scopeQueues.set`, `inline.catch().then`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!queue`; `queue.get(key) === operation`.
   * 输入 / Inputs: vmId: string; id: string; action: (access: Access) => Promise<T>
   * 输出 / Returns: `await operation`.
   * 副作用 / Effects: `scopeQueues.set`; `queue.set`; `queue.delete`; 更新 / updates `id`, `queue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `if (queue.get(key) === operation) queue.delete(key);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (queue.get(key) === operation) queue.delete(key);`; these steps also apply to exceptional exits.
   */
  async withLock<T>(vmId: string, id: string, action: (access: Access) => Promise<T>) {
    id = projectIdSchema.parse(id);
    const key = `project-identity:${vmId}:${id}`;
    let queue = scopeQueues.get(this.machines);
    if (!queue) { queue = new Map(); scopeQueues.set(this.machines, queue); }
    /**
     * 入口 / Entry: ProjectRunScopes.withLock.callback@238.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `await action({ reserve: async (project, signal) => { checked(project); return this.reserveUnlocked(vmId, project, true, signa…`.
     * 副作用 / Effects: 更新 / updates `open`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 收尾：退出 try 区域时始终执行 `open = false;`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `open = false;`; these steps also apply to exceptional exits.
     */
    const operation = (queue.get(key) || Promise.resolve()).catch(() => {}).then(() =>
      this.machines.locked(key,
      /**
       * 中文功能：在原项目账号锁中提供 reserve、identity、recover 与 guard 能力，闭包每次检查项目且 finally 失效。
       * English: Provides reserve, identity, recovery and guard capabilities under the original account lock, checking project on each call and invalidating them in finally.
       * 所属 / Owner: ProjectRunScopes.withLock.operation.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       */
      async () => {
        let open = true;
        /**
         * 入口 / Entry: ProjectRunScopes.withLock.checked.
         * 功能：在维护项目账户运行日志及资源票据中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`ProjectRunScopes`）。
         * Purpose: Checks admission, input or resource ownership in `ProjectRunScopes`; the calls and state transitions below complete the operation. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
         * 处理：通过 `projectId` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `projectId`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: project: Project optional
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 拒绝 / Refusals: 条件 / conditions `!open || (project && projectId(project) !== id)`; 异常 / errors `new AppError('项目账号锁或项目范围已失效', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
         */
        const checked = (project?: Project) => {
          if (!open || (project && projectId(project) !== id))
            throw new AppError('项目账号锁或项目范围已失效', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        };
        try {
          return await action({
            /**
             * 入口 / Entry: ProjectRunScopes.withLock.reserve.
             * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.reserveUnlocked(vmId, project, true, signal)` 供上层消费（`ProjectRunScopes`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `this.reserveUnlocked(vmId, project, true, signal)` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
             * 处理：通过 `checked`, `this.reserveUnlocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `checked`, `this.reserveUnlocked`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: project; signal
             * 输出 / Returns: `this.reserveUnlocked(vmId, project, true, signal)`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            reserve: async (project, signal) => { checked(project); return this.reserveUnlocked(vmId, project, true, signal); },
            /**
             * 入口 / Entry: ProjectRunScopes.withLock.identity.
             * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.reserveUnlocked(vmId, project, false, signal)` 供上层消费（`ProjectRunScopes`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `this.reserveUnlocked(vmId, project, false, signal)` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
             * 处理：通过 `checked`, `this.reserveUnlocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `checked`, `this.reserveUnlocked`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: project; signal
             * 输出 / Returns: `this.reserveUnlocked(vmId, project, false, signal)`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            identity: async (project, signal) => { checked(project); return this.reserveUnlocked(vmId, project, false, signal); },
            /**
             * 入口 / Entry: ProjectRunScopes.withLock.recoverStoppedTasks.
             * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectRunScopes`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; the calls and state transitions below complete the operation. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
             * 处理：通过 `checked`, `this.recoverStoppedTasksUnlocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `checked`, `this.recoverStoppedTasksUnlocked`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
             * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            recoverStoppedTasks: async () => { checked(); await this.recoverStoppedTasksUnlocked(vmId, id); },
            /**
             * 入口 / Entry: ProjectRunScopes.withLock.guard.
             * 功能：在维护项目账户运行日志及资源票据中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`ProjectRunScopes`）。
             * Purpose: Checks admission, input or resource ownership in `ProjectRunScopes`; the calls and state transitions below complete the operation. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
             * 处理：通过 `checked`, `this.guardUnlocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `checked`, `this.guardUnlocked`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
             * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            guard: async () => { checked(); await this.guardUnlocked(vmId, id); },
          });
        } finally { open = false; }
      }));
    queue.set(key, operation);
    try { return await operation; }
    finally { if (queue.get(key) === operation) queue.delete(key); }
  }
  /**
   * 入口 / Entry: ProjectRunScopes.reserve.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.withLock(vmId, projectId(project), access => access.reserve(project, signal))` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `this.withLock(vmId, projectId(project), access => access.reserve(project, signal))` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `this.withLock`, `projectId` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.withLock`, `projectId`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; project: Project; signal: AbortSignal optional
   * 输出 / Returns: `this.withLock(vmId, projectId(project), access => access.reserve(project, signal))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  reserve(vmId: string, project: Project, signal?: AbortSignal) {
    return this.withLock(vmId, projectId(project), access => access.reserve(project, signal));
  }
  /**
   * 入口 / Entry: ProjectRunScopes.identity.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.withLock(vmId, projectId(project), async access => { const identity = await access.identity(project, signal); await asse…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `this.withLock(vmId, projectId(project), async access => { const identity = await access.identity(project, signal); await asse…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `this.withLock`, `projectId` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.withLock`, `projectId`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; project: Project; signal: AbortSignal optional
   * 输出 / Returns: `this.withLock(vmId, projectId(project), async access => { const identity = await access.identity(project, signal); await asse…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  identity(vmId: string, project: Project, signal?: AbortSignal) {
    return this.withLock(vmId, projectId(project), async access => {
      const identity = await access.identity(project, signal);
      await assertNoPendingProjectDirectoryMigration(this.machines, vmId, identity.projectId, signal);
      return identity;
    });
  }
  /**
   * 入口 / Entry: ProjectRunScopes.guard.
   * 功能：把本层请求转交 `this.withLock`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.withLock` and propagates the provider result or rejection.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: `this.withLock(vmId, id, access => access.guard())`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  guard(vmId: string, id: string) {
    return this.withLock(vmId, id, access => access.guard());
  }
  /**
   * 入口 / Entry: ProjectRunScopes.reserveUnlocked.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `actual` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `actual` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `signal.throwIfAborted`, `projectId`, `binding`, `this.read` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `projectId`, `binding`, `this.read`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `actual && sameIdentity(old, actual, true) && same(binding(actual), target)`; `rebind`.
   * 输入 / Inputs: vmId: string; project: Project; permitIntent: boolean; signal: AbortSignal optional
   * 输出 / Returns: Promise<ProjectIdentity>；结果来自 / values from `actual`.
   * 副作用 / Effects: `this.save`; 更新 / updates `journal.identity`, `journal.pending`, `old`, `actual`.
   * 拒绝 / Refusals: 条件 / conditions `journal.networkRelease && journal.networkRelease.phase !== 'released'`; `journal.pending && !same(journal.pending.binding, target)`; `journal.pending?.kind === 'rebind' && old`; 异常 / errors `new AppError('项目网络核销尚未确认，请先重试原停止操作', 409, 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING')`; `new AppError('项目账号有另一份尚未确认的绑定变更，请恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING')`.
   * 失败处理：catch 分支执行 `if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED') throw error;`; `if (!old) { const intent = await this.core.inspect(vmId, id, signal); if (intent === null && journal.runs.length === 0) { // …`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED') throw error;`; `if (!old) { const intent = await this.core.inspect(vmId, id, signal); if (intent === null && journal.runs.length === 0) { // …`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async reserveUnlocked(vmId: string, project: Project, permitIntent: boolean, signal?: AbortSignal): Promise<ProjectIdentity> {
    signal?.throwIfAborted();
    const id = projectId(project), target = binding(project), journal = await this.read(vmId, id);
    if (journal.networkRelease && journal.networkRelease.phase !== 'released')
      throw new AppError('项目网络核销尚未确认，请先重试原停止操作', 409, 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING');
    if (journal.pending && !same(journal.pending.binding, target))
      throw new AppError('项目账号有另一份尚未确认的绑定变更，请恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING');
    let old = journal.identity;
    if (journal.pending?.kind === 'rebind' && old) {
      const actual = await this.core.inspect(vmId, id, signal);
      if (actual && sameIdentity(old, actual, true) && same(binding(actual), target)) {
        journal.identity = actual; journal.pending = null; await this.save(vmId, id, journal); old = actual;
      } else if (!actual || !sameIdentity(old, actual) || !same(binding(actual), binding(old))) {
        throw new AppError('待确认的账号修订与客户机记录不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      }
    }
    const rebind = Boolean(old && !same(binding(old), target));
    if (rebind) await this.guardUnlocked(vmId, id, true);
    // 先记录待确认绑定，再修改客户机账户；SSH 回执丢失后仍能按原目标恢复而非重新选择身份。
    journal.pending = { kind: rebind ? 'rebind' : 'ensure', binding: target };
    await this.save(vmId, id, journal);
    let actual: ProjectIdentity;
    try {
      actual = old && rebind
        ? await this.core.rebind(vmId, old, target, signal)
        : await this.core.ensure(vmId, { projectId: id, ...target }, old ? expected(old) : undefined, signal);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED') throw error;
      // The first reservation has no usable command entry. Pin its exact intent
      // so a permissions preview cannot choose or adopt a different account.
      if (!old) {
        const intent = await this.core.inspect(vmId, id, signal);
        if (intent === null && journal.runs.length === 0) {
          // A typed directory refusal followed by a verified absent binding
          // proves this reservation never became an account. Do not pin an
          // invalid path forever; unknown control failures still retain pending.
          journal.pending = null; await this.save(vmId, id, journal); throw error;
        }
        if (!intent || intent.phase !== 'intent' || !same(binding(intent), target))
          throw new AppError('目录迁移所需的账号保留记录不完整', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        actual = intent;
      } else actual = old;
      journal.identity = actual; journal.pending = null; await this.save(vmId, id, journal);
      if (!permitIntent) throw error;
      return actual;
    }
    if (actual.projectId !== id || !same(binding(actual), target) ||
        (old && !sameIdentity(old, actual, rebind)) || actual.phase !== 'active')
      throw new AppError('项目账号完整绑定或修订与主机记录不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    journal.identity = actual; journal.pending = null; await this.save(vmId, id, journal);
    return actual;
  }
  /**
   * 入口 / Entry: ProjectRunScopes.hasRun.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(await this.read(vmId, id)).runs.some(run => run.runId === runId) || Boolean(await this.archived(vmId, id, runId))` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `(await this.read(vmId, id)).runs.some(run => run.runId === runId) || Boolean(await this.archived(vmId, id, runId))` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `inline.runs.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `inline.runs.some`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; runId: string
   * 输出 / Returns: `(await this.read(vmId, id)).runs.some(run => run.runId === runId) || Boolean(await this.archived(vmId, id, runId))`.
   * 副作用 / Effects: 更新 / updates `id`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async hasRun(vmId: string, id: string, runId: string) {
    id = projectIdSchema.parse(id); z.uuid().parse(runId);
    return (await this.read(vmId, id)).runs.some(run => run.runId === runId) || Boolean(await this.archived(vmId, id, runId));
  }
  /** 只读发现原缓存转交资源，保留活动所有者，不签发新的项目执行权限。 */
  /**
   * 入口 / Entry: ProjectRunScopes.taskResources.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `journal.runs.filter(entry => entry.cacheTransfer?.phase === 'pending').map(entry => ({ context: { identity: structuredClone(e…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `journal.runs.filter(entry => entry.cacheTransfer?.phase === 'pending').map(entry => ({ context: { identity: structuredClone(e…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `this.read`, `projectIdSchema.parse`, `journal.runs.filter().map`, `journal.runs.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.read`, `projectIdSchema.parse`, `journal.runs.filter().map`, `journal.runs.filter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: `journal.runs.filter(entry => entry.cacheTransfer?.phase === 'pending').map(entry => ({ context: { identity: structuredClone(e…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async taskResources(vmId: string, id: string) {
    const journal = await this.read(vmId, projectIdSchema.parse(id));
    return journal.runs.filter(entry => entry.cacheTransfer?.phase === 'pending').map(entry => ({
      context: { identity: structuredClone(entry.identity), owner: { ...entry.owner, kind: 'task' as const },
        sha256: entry.sha256, live: this.machines.live.get(vmId)! },
      descriptor: { stageId: entry.cacheTransfer!.stageId, manager: entry.cacheTransfer!.manager, build: entry.cacheTransfer!.build },
      active: entry.phase !== 'closed' && Boolean(activeTasks.get(this.machines)?.get(this.taskKey(vmId, id, entry.runId))) &&
        activeTasks.get(this.machines)!.get(this.taskKey(vmId, id, entry.runId))!.live === this.machines.live.get(vmId),
    }));
  }
  /**
   * 入口 / Entry: ProjectRunScopes.completeTaskResource.
   * 功能：把本层请求转交 `this.withLock`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.withLock` and propagates the provider result or rejection.
   * 输入 / Inputs: vmId: string; context: ProjectTaskResourceContext; descriptor: ProjectTaskResourceDescriptor
   * 输出 / Returns: `this.withLock(vmId, context.identity.projectId, async () => { const journal = await this.read(vmId, context.identity.projectI…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async completeTaskResource(vmId: string, context: ProjectTaskResourceContext, descriptor: ProjectTaskResourceDescriptor) {
    /**
     * 入口 / Entry: ProjectRunScopes.completeTaskResource.callback@338.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withLock）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withLock).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `this.save`; 更新 / updates `entry.cacheTransfer.phase`.
     * 拒绝 / Refusals: 条件 / conditions `!entry || entry.phase !== 'closed' || !entry.cacheTransfer || !same({ ...entry.cacheTransfer, phase: 'pending' }, hint) || !s…`; `this.machines.live.get(vmId) !== context.live || boot !== (entry.retirement?.bootId || entry.owner.bootId)`; 异常 / errors `new AppError('任务缓存退休缺少准确原 journal', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`; `new AppError('任务缓存退休开机身份改变', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
     */
    return this.withLock(vmId, context.identity.projectId, async () => {
      const journal = await this.read(vmId, context.identity.projectId), entry = journal.runs.find(run => run.runId === context.owner.runId);
      const hint = cacheTransferSchema.parse({ ...descriptor, phase: 'pending' });
      if (!entry || entry.phase !== 'closed' || !entry.cacheTransfer ||
          !same({ ...entry.cacheTransfer, phase: 'pending' }, hint) || !same(entry.identity, context.identity) ||
          !same(entry.owner, context.owner) || entry.sha256 !== context.sha256 || this.machines.live.get(vmId) !== context.live)
        throw new AppError('任务缓存退休缺少准确原 journal', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      if (entry.cacheTransfer.phase === 'closed') return;
      const boot = await this.confirmScopeStopped(vmId, entry.owner);
      if (this.machines.live.get(vmId) !== context.live || boot !== (entry.retirement?.bootId || entry.owner.bootId))
        throw new AppError('任务缓存退休开机身份改变', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      entry.cacheTransfer.phase = 'closed'; await this.save(vmId, context.identity.projectId, journal);
    });
  }
  /** 读取原 closed 证明供资源退休核验，此接口不能签发运行或授权项目代码执行。 */
  /**
   * 入口 / Entry: ProjectRunScopes.taskResourceReceipt.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `structuredClone({ run: entry.run, ...(entry.retirement ? { retirement: entry.retirement } : {}) })` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `structuredClone({ run: entry.run, ...(entry.retirement ? { retirement: entry.retirement } : {}) })` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `inline.runs.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `inline.runs.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; context: ProjectTaskResourceContext
   * 输出 / Returns: Promise<ProjectTaskResourceReceipt>；结果来自 / values from `structuredClone({ run: entry.run, ...(entry.retirement ? { retirement: entry.retirement } : {}) })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!entry || entry.phase !== 'closed' || entry.owner.kind !== 'task' || !same(entry.identity, context.identity) || !same(entry.o…`; 异常 / errors `new AppError('任务资源缺少准确原账号核销证明', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
   */
  async taskResourceReceipt(vmId: string, context: ProjectTaskResourceContext): Promise<ProjectTaskResourceReceipt> {
    const id = projectIdSchema.parse(context.identity.projectId), runId = z.uuid().parse(context.owner.runId);
    const entry = (await this.read(vmId, id)).runs.find(run => run.runId === runId) ||
      await this.archived(vmId, id, runId);
    if (!entry || entry.phase !== 'closed' || entry.owner.kind !== 'task' ||
        !same(entry.identity, context.identity) || !same(entry.owner, context.owner) || entry.sha256 !== context.sha256)
      throw new AppError('任务资源缺少准确原账号核销证明', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    return structuredClone({ run: entry.run, ...(entry.retirement ? { retirement: entry.retirement } : {}) });
  }
  /**
   * 入口 / Entry: ProjectRunScopes.assertTaskIssued.
   * 功能：在维护项目账户运行日志及资源票据中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Checks admission, input or resource ownership in `ProjectRunScopes`; this entry produces `void` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `inline.runs.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `inline.runs.find`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `entry?.owner.kind === 'task' && entry.phase === 'closed' && entry.run && !entry.retirement`.
   * 输入 / Inputs: vmId: string; id: string; runId: string; result: { code: number; stdout: string; stderr: string }
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `id`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('项目启动器未确认发行本次运行票据，项目代码未执行', controlled ? 409 : 503, controlled ? 'PROJECT_IDENTITY_' + refusal.data.code : 'PROJ…`.
   */
  async assertTaskIssued(vmId: string, id: string, runId: string,
    result: { code: number; stdout: string; stderr: string }) {
    id = projectIdSchema.parse(id); z.uuid().parse(runId);
    const entry = (await this.read(vmId, id)).runs.find(run => run.runId === runId) ||
      await this.archived(vmId, id, runId);
    if (entry?.owner.kind === 'task' && entry.phase === 'closed' && entry.run && !entry.retirement) return;
    // 项目代码可任意打印 JSON 和退出码；只有已核销且从未签发客户机票据的意图才证明这是控制器拒绝。
    const refusal = z.object({ ok: z.literal(false), code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
      detail: z.unknown() }).strict().safeParse(parseJson(result.stdout));
    const controlled = entry?.owner.kind === 'task' && entry.phase === 'closed' && !entry.run &&
      result.code !== 0 && refusal.success;
    throw new AppError('项目启动器未确认发行本次运行票据，项目代码未执行', controlled ? 409 : 503,
      controlled ? 'PROJECT_IDENTITY_' + refusal.data.code : 'PROJECT_IDENTITY_LAUNCH_UNCONFIRMED');
  }
  /**
   * 入口 / Entry: ProjectRunScopes.assertAdmission.
   * 功能：把本层请求转交 `this.withLock`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.withLock` and propagates the provider result or rejection.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id); if (journal.networkRelease && journal.networ…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async assertAdmission(vmId: string, id: string) {
    return this.withLock(vmId, id, async () => {
      const journal = await this.read(vmId, id);
      if (journal.networkRelease && journal.networkRelease.phase !== 'released')
        throw new AppError('项目网络核销尚未确认，请先重试原停止操作', 409, 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING');
      if (journal.pending)
        throw new AppError('项目账号绑定尚未确认，请先恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING');
    });
  }
  /** 只读核对主机与客户机完整网络证明，不安装辅助程序，也不签发新的运行。 */
  /**
   * 入口 / Entry: ProjectRunScopes.networkStatus.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.withLock(vmId, id, async () => { signal?.throwIfAborted(); const live = this.machines.live.get(vmId), journal = await th…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `this.withLock(vmId, id, async () => { signal?.throwIfAborted(); const live = this.machines.live.get(vmId), journal = await th…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectId`, `binding`, `this.withLock` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectId`, `binding`, `this.withLock`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; project: Project; signal: AbortSignal optional
   * 输出 / Returns: `this.withLock(vmId, id, async () => { signal?.throwIfAborted(); const live = this.machines.live.get(vmId), journal = await th…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async networkStatus(vmId: string, project: Project, signal?: AbortSignal) {
    const id = projectId(project), target = binding(project);
    /**
     * 入口 / Entry: ProjectRunScopes.networkStatus.callback@388.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withLock）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withLock).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `proof`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `journal.pending`; `journal.networkRelease && journal.networkRelease.phase !== 'released'`; `!journal.identity || journal.identity.phase !== 'active' || target.networkIsolation !== 'private' || !same(binding(journal.id…`; 异常 / errors `new AppError('项目账号绑定尚未确认，请先恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING')`; `new AppError('项目网络核销尚未确认，请先重试原停止操作', 409, 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING')`.
     */
    return this.withLock(vmId, id, async () => {
      signal?.throwIfAborted();
      const live = this.machines.live.get(vmId), journal = await this.read(vmId, id);
      /**
       * 入口 / Entry: ProjectRunScopes.networkStatus.unchanged.
       * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectRunScopes`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; the calls and state transitions below complete the operation. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
       * 处理：通过 `signal.throwIfAborted`, `this.machines.live.get`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.machines.live.get`, `this.machines.state`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `!live || this.machines.live.get(vmId) !== live || this.machines.state(vmId) !== 'running'`; 异常 / errors `new AppError('网络检查期间客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
       */
      const unchanged = () => {
        signal?.throwIfAborted();
        if (!live || this.machines.live.get(vmId) !== live || this.machines.state(vmId) !== 'running')
          throw new AppError('网络检查期间客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      };
      unchanged();
      if (journal.pending)
        throw new AppError('项目账号绑定尚未确认，请先恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING');
      if (journal.networkRelease && journal.networkRelease.phase !== 'released')
        throw new AppError('项目网络核销尚未确认，请先重试原停止操作', 409, 'PROJECT_IDENTITY_NETWORK_RETIREMENT_PENDING');
      if (!journal.identity || journal.identity.phase !== 'active' || target.networkIsolation !== 'private' ||
          !same(binding(journal.identity), target))
        throw new AppError('当前项目尚无已确认的私有网络账号绑定，请先启动项目', 409, 'PROJECT_IDENTITY_NETWORK_UNPREPARED');
      await assertNoPendingProjectDirectoryMigration(this.machines, vmId, id, signal);
      if (!this.core.networkReadonly)
        throw new AppError('项目网络只读检查入口不可用', 409, 'PROJECT_IDENTITY_READONLY_UNAVAILABLE');
      const proof = await this.core.networkReadonly(vmId, journal.identity, signal);
      unchanged();
      const current = await this.read(vmId, id);
      if (!same(current.identity, journal.identity) || !same(current.pending, journal.pending) ||
          !same(current.networkRelease, journal.networkRelease))
        throw new AppError('网络检查期间原项目绑定已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      unchanged();
      return proof;
    });
  }
  /**
   * 入口 / Entry: ProjectRunScopes.kernelBoot.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `boot.data` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `boot.data` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `this.machines.exec`, `z.uuid().safeParse`, `z.uuid`, `result.stdout.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.exec`, `z.uuid().safeParse`, `z.uuid`, `result.stdout.trim`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; signal: AbortSignal optional
   * 输出 / Returns: `boot.data`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0 || !boot.success`; 异常 / errors `new AppError('项目网络开机身份无法核对', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED')`.
   */
  private async kernelBoot(vmId: string, signal?: AbortSignal) {
    const result = await this.machines.exec(vmId,
      'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/cat /proc/sys/kernel/random/boot_id', 10000, signal);
    const boot = z.uuid().safeParse(result.stdout.trim());
    if (result.code !== 0 || !boot.success)
      throw new AppError('项目网络开机身份无法核对', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
    return boot.data;
  }
  /**
   * 入口 / Entry: ProjectRunScopes.confirmNetworkAbsent.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value.data.bootId` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `value.data.bootId` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `this.machines.exec`, `quote`, `z.object().strict`, `z.object` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.exec`, `quote`, `z.object().strict`, `z.object`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; expectedBoot: string
   * 输出 / Returns: `value.data.bootId`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0 || !value.success`; 异常 / errors `new AppError('当前网络对象仍存在或身份未确认，原核销记录继续保留', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED')`.
   */
  private async confirmNetworkAbsent(vmId: string, id: string, expectedBoot: string) {
    // An intent whose begin reply was lost across a real reboot may be retired
    // only when no current namespace or current native retirement authority exists.
    const source = `import json,os,stat\nproject=${JSON.stringify(id)}\nboot=open('/proc/sys/kernel/random/boot_id').read().strip()\n` +
      `paths=['/run/netns/sk-'+project]\nif boot!=${JSON.stringify(expectedBoot)}:\n` +
      ` paths+=['/run/sakura-project-identities/networks/'+project+suffix for suffix in ['.json','.generation.json','.release.bin','.tool.json']]\n` +
      `for path in paths:\n current='/'\n for part in path.split('/')[1:-1]:\n` +
      `  current=os.path.join(current,part)\n  try:info=os.lstat(current)\n  except FileNotFoundError:break\n` +
      `  assert stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022\n` +
      ` assert not os.path.lexists(path)\nprint(json.dumps({'bootId':boot,'absent':True}))\n`;
    const result = await this.machines.exec(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ${quote(source)}`, 10000);
    const schema = z.object({ bootId: z.uuid(), absent: z.literal(true) }).strict();
    const value = schema.safeParse(parseJson(result.stdout));
    if (result.code !== 0 || !value.success)
      throw new AppError('当前网络对象仍存在或身份未确认，原核销记录继续保留', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
    return value.data.bootId;
  }
  /**
   * 入口 / Entry: ProjectRunScopes.beginNetworkRelease.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), instance = this.machines.live.get(vmId); if …` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), instance = this.machines.live.get(vmId); if …` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `this.withLock` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `this.withLock`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; signal: AbortSignal optional
   * 输出 / Returns: Promise<ProjectNetworkReleaseIntent | null>；结果来自 / values from `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), instance = this.machines.live.get(vmId); if …`.
   * 副作用 / Effects: 更新 / updates `id`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async beginNetworkRelease(vmId: string, id: string, signal?: AbortSignal): Promise<ProjectNetworkReleaseIntent | null> {
    id = projectIdSchema.parse(id);
    /**
     * 入口 / Entry: ProjectRunScopes.beginNetworkRelease.callback@444.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withLock）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withLock).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `null`; `state.intent`.
     * 副作用 / Effects: `this.save`; 更新 / updates `state`, `journal.networkRelease`, `state.intent.lease`, `state.phase`.
     * 拒绝 / Refusals: 条件 / conditions `!journal.identity`; `journal.pending || journal.runs.length || journal.networkRelease`; `journal.pending`; 异常 / errors `new AppError('网络核销缺少原完整账号身份', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`; `new AppError('项目账号绑定尚未确认，请先恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING')`.
     */
    return this.withLock(vmId, id, async () => {
      const journal = await this.read(vmId, id), instance = this.machines.live.get(vmId);
      if (!journal.identity) {
        if (journal.pending || journal.runs.length || journal.networkRelease)
          throw new AppError('网络核销缺少原完整账号身份', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        return null; // Only a project that never acquired an account uses legacy deletion.
      }
      if (journal.pending)
        throw new AppError('项目账号绑定尚未确认，请先恢复原配置核对', 409, 'PROJECT_IDENTITY_BINDING_PENDING');
      let state = journal.networkRelease;
      if (!state || state.phase === 'released') {
        state = { phase: 'intent', intent: { version: 1, releaseId: randomUUID(), identity: journal.identity,
          bootId: await this.kernelBoot(vmId, signal), lease: null } };
        if (!instance || this.machines.live.get(vmId) !== instance)
          throw new AppError('客户机实例改变，网络核销未开始', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
        journal.networkRelease = state; await this.save(vmId, id, journal);
      }
      if (state.phase === 'pending') return state.intent;
      if (await this.kernelBoot(vmId, signal) !== state.intent.bootId) {
        const boot = await this.confirmNetworkAbsent(vmId, id, state.intent.bootId);
        if (await this.confirmNetworkAbsent(vmId, id, state.intent.bootId) !== boot)
          throw new AppError('客户机开机身份再次改变，网络核销未确认', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      } else {
        if (!this.core.beginNetworkRelease)
          throw new AppError('项目网络核销入口不可用', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
        state.intent.lease = await this.core.beginNetworkRelease(vmId, state.intent.identity,
          { releaseId: state.intent.releaseId, bootId: state.intent.bootId }, signal);
      }
      if (!instance || this.machines.live.get(vmId) !== instance)
        throw new AppError('客户机实例改变，网络冻结未确认', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      state.phase = 'pending'; await this.save(vmId, id, journal); return state.intent;
    });
  }
  /**
   * 入口 / Entry: ProjectRunScopes.releaseNetwork.
   * 功能：在维护项目账户运行日志及资源票据中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), instance = this.machines.live.get(vmId), sta…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectRunScopes`; this entry produces `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), instance = this.machines.live.get(vmId), sta…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `networkReleaseIntentSchema.parse`, `this.withLock` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `networkReleaseIntentSchema.parse`, `this.withLock`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; intent: ProjectNetworkReleaseIntent; signal: AbortSignal optional
   * 输出 / Returns: `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), instance = this.machines.live.get(vmId), sta…`.
   * 副作用 / Effects: 更新 / updates `id`, `intent`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async releaseNetwork(vmId: string, id: string, intent: ProjectNetworkReleaseIntent, signal?: AbortSignal) {
    id = projectIdSchema.parse(id); intent = networkReleaseIntentSchema.parse(intent);
    /**
     * 入口 / Entry: ProjectRunScopes.releaseNetwork.callback@479.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withLock）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withLock).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `this.core.releaseNetwork`; `this.save`; 更新 / updates `current.networkRelease!.phase`.
     * 拒绝 / Refusals: 条件 / conditions `!state || !same(state.intent, intent) || intent.identity.projectId !== id`; `state.phase !== 'pending'`; `intent.lease`; 异常 / errors `new AppError('网络核销请求不属于原停止代次', 409, 'PROJECT_IDENTITY_NETWORK_STALE')`; `new AppError('原网络冻结回执尚未确认，请重试原停止操作', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED')`.
     */
    return this.withLock(vmId, id, async () => {
      const journal = await this.read(vmId, id), instance = this.machines.live.get(vmId), state = journal.networkRelease;
      if (!state || !same(state.intent, intent) || intent.identity.projectId !== id)
        throw new AppError('网络核销请求不属于原停止代次', 409, 'PROJECT_IDENTITY_NETWORK_STALE');
      if (state.phase === 'released') return;
      if (state.phase !== 'pending')
        throw new AppError('原网络冻结回执尚未确认，请重试原停止操作', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      await this.recoverStoppedTasksUnlocked(vmId, id);
      await this.guardUnlocked(vmId, id, false, true);
      if (intent.lease) {
        if (!this.core.releaseNetwork)
          throw new AppError('项目网络核销入口不可用', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
        const released = await this.core.releaseNetwork(vmId, intent.identity, intent.lease, signal);
        if (released.phase !== 'released' || released.releaseId !== intent.releaseId || !same(released.network, intent.lease.network))
          throw new AppError('网络核销回执不属于原冻结代次', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      } else {
        const boot = await this.confirmNetworkAbsent(vmId, id, intent.bootId);
        if (await this.confirmNetworkAbsent(vmId, id, intent.bootId) !== boot)
          throw new AppError('客户机开机身份再次改变，空网络核销未确认', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      }
      if (!instance || this.machines.live.get(vmId) !== instance)
        throw new AppError('客户机实例改变，网络核销未确认', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      // Task recovery may have advanced run receipts; update only the network state.
      const current = await this.read(vmId, id);
      if (!same(current.networkRelease, state))
        throw new AppError('网络核销主机记录已变化', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      current.networkRelease!.phase = 'released'; await this.save(vmId, id, current);
    });
  }
  /**
   * 入口 / Entry: ProjectRunScopes.active.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), entry = journal.runs.find(run => run.runId =…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), entry = journal.runs.find(run => run.runId =…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `this.withLock` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `this.withLock`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; runId: string; signal: AbortSignal optional
   * 输出 / Returns: `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), entry = journal.runs.find(run => run.runId =…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async active(vmId: string, id: string, runId: string, signal?: AbortSignal) {
    z.uuid().parse(runId);
    /**
     * 入口 / Entry: ProjectRunScopes.active.callback@510.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withLock）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withLock).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `false`; `run.phase === 'active'`.
     * 副作用 / Effects: `this.save`; 更新 / updates `run`, `entry.run`, `entry.phase`.
     * 拒绝 / Refusals: 条件 / conditions `!instance || this.machines.live.get(vmId) !== instance || !this.matches(entry, run)`; 异常 / errors `error`; `new AppError('项目账号票据与原运行身份不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
     * 失败处理：catch 分支执行 `if (error instanceof AppError && error.code === 'PROJECT_IDENTITY_RECORD_ABSENT' && !entry.run) return false;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (error instanceof AppError && error.code === 'PROJECT_IDENTITY_RECORD_ABSENT' && !entry.run) return false;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.withLock(vmId, id, async () => {
      const journal = await this.read(vmId, id), entry = journal.runs.find(run => run.runId === runId);
      if (!entry) { await this.archived(vmId, id, runId); return false; }
      if (entry.phase === 'closed') return false;
      const instance = this.machines.live.get(vmId);
      let run: ProjectIdentityRun;
      try { run = await this.core.run(vmId, entry.identity, runId, signal); }
      catch (error) {
        if (error instanceof AppError && error.code === 'PROJECT_IDENTITY_RECORD_ABSENT' && !entry.run) return false;
        throw error;
      }
      if (!instance || this.machines.live.get(vmId) !== instance || !this.matches(entry, run))
        throw new AppError('项目账号票据与原运行身份不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      entry.run = run; entry.phase = run.phase === 'closed' && !entry.sshAgent && !entry.gpgAgent ? 'closed' : 'active';
      await this.save(vmId, id, journal);
      this.pinActiveTask(vmId, id, entry, run);
      return run.phase === 'active';
    });
  }
  /**
   * 入口 / Entry: ProjectRunScopes.readonlyActive.
   * 功能：在维护项目账户运行日志及资源票据中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `false` / `run.phase === 'active'` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectRunScopes`; this entry produces `false` / `run.phase === 'active'` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `this.read` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `this.read`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!entry`; `entry.phase === 'closed'`.
   * 输入 / Inputs: vmId: string; id: string; runId: string; signal: AbortSignal optional
   * 输出 / Returns: `false`; `run.phase === 'active'`.
   * 副作用 / Effects: 更新 / updates `id`.
   * 拒绝 / Refusals: 条件 / conditions `!this.core.runReadonly`; `!instance || this.machines.live.get(vmId) !== instance || !this.matches(entry, run)`; 异常 / errors `new AppError('账号只读核对入口不可用', 409, 'PROJECT_IDENTITY_READONLY_UNAVAILABLE')`; `new AppError('项目账号只读回执与原运行不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   */
  async readonlyActive(vmId: string, id: string, runId: string, signal?: AbortSignal) {
    id = projectIdSchema.parse(id); z.uuid().parse(runId);
    const journal = await this.read(vmId, id), entry = journal.runs.find(run => run.runId === runId);
    if (!entry) { await this.archived(vmId, id, runId); return false; }
    if (entry.phase === 'closed') return false;
    if (!this.core.runReadonly)
      throw new AppError('账号只读核对入口不可用', 409, 'PROJECT_IDENTITY_READONLY_UNAVAILABLE');
    const instance = this.machines.live.get(vmId);
    const run = await this.core.runReadonly(vmId, entry.identity, runId, signal);
    if (!instance || this.machines.live.get(vmId) !== instance || !this.matches(entry, run))
      throw new AppError('项目账号只读回执与原运行不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    // Reads never install a guest helper or advance host receipt phases.
    return run.phase === 'active';
  }
  /**
   * 入口 / Entry: ProjectRunScopes.taskRun.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `null` / `structuredClone({ identity: entry.identity, owner: entry.owner, sha256: entry.sha256, phase: entry.phase, run: entry.run })` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `null` / `structuredClone({ identity: entry.identity, owner: entry.owner, sha256: entry.sha256, phase: entry.phase, run: entry.run })` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `inline.runs.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `inline.runs.find`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!entry`.
   * 输入 / Inputs: vmId: string; id: string; runId: string
   * 输出 / Returns: `null`; `structuredClone({ identity: entry.identity, owner: entry.owner, sha256: entry.sha256, phase: entry.phase, run: entry.run })`.
   * 副作用 / Effects: 更新 / updates `id`.
   * 拒绝 / Refusals: 条件 / conditions `entry.owner.kind !== 'task'`; 异常 / errors `new AppError('原运行不属于任务域', 409, 'PROJECT_IDENTITY_RUN_STALE')`.
   */
  async taskRun(vmId: string, id: string, runId: string) {
    id = projectIdSchema.parse(id); z.uuid().parse(runId);
    const entry = (await this.read(vmId, id)).runs.find(value => value.runId === runId) || await this.archived(vmId, id, runId);
    if (!entry) return null;
    if (entry.owner.kind !== 'task') throw new AppError('原运行不属于任务域', 409, 'PROJECT_IDENTITY_RUN_STALE');
    return structuredClone({ identity: entry.identity, owner: entry.owner, sha256: entry.sha256, phase: entry.phase, run: entry.run });
  }
  /**
   * 入口 / Entry: ProjectRunScopes.readonlyTask.
   * 功能：在维护项目账户运行日志及资源票据中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ identity: structuredClone(entry.identity), owner: { ...entry.owner }, sha256: entry.sha256, run: structuredClone(entry.run)…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectRunScopes`; this entry produces `{ identity: structuredClone(entry.identity), owner: { ...entry.owner }, sha256: entry.sha256, run: structuredClone(entry.run)…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `this.taskRun` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `this.taskRun`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; runId: string; signal: AbortSignal optional
   * 输出 / Returns: `{ identity: structuredClone(entry.identity), owner: { ...entry.owner }, sha256: entry.sha256, run: structuredClone(entry.run)…`.
   * 副作用 / Effects: 更新 / updates `id`.
   * 拒绝 / Refusals: 条件 / conditions `!entry || entry.phase !== 'active' || !entry.run || entry.run.phase !== 'active'`; `!this.core.runReadonly`; `!live || this.machines.live.get(vmId) !== live || run.phase !== 'active' || !same(run, entry.run) || !same(await this.taskRun…`; 异常 / errors `new AppError('原完整任务票据未登记，拒绝只读接管', 409, 'PROJECT_IDENTITY_RUN_STALE')`; `new AppError('账号只读核对入口不可用', 409, 'PROJECT_IDENTITY_READONLY_UNAVAILABLE')`.
   */
  async readonlyTask(vmId: string, id: string, runId: string, signal?: AbortSignal) {
    id = projectIdSchema.parse(id); z.uuid().parse(runId);
    const entry = await this.taskRun(vmId, id, runId);
    if (!entry || entry.phase !== 'active' || !entry.run || entry.run.phase !== 'active')
      throw new AppError('原完整任务票据未登记，拒绝只读接管', 409, 'PROJECT_IDENTITY_RUN_STALE');
    if (!this.core.runReadonly) throw new AppError('账号只读核对入口不可用', 409, 'PROJECT_IDENTITY_READONLY_UNAVAILABLE');
    const live = this.machines.live.get(vmId), run = await this.core.runReadonly(vmId, entry.identity, runId, signal);
    if (!live || this.machines.live.get(vmId) !== live || run.phase !== 'active' ||
        !same(run, entry.run) || !same(await this.taskRun(vmId, id, runId), entry) || this.machines.live.get(vmId) !== live)
      throw new AppError('账号只读回执与原完整任务不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    return { identity: structuredClone(entry.identity), owner: { ...entry.owner }, sha256: entry.sha256,
      run: structuredClone(entry.run), phase: entry.phase };
  }
  /**
   * 入口 / Entry: ProjectRunScopes.matches.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `run.mode === (entry.owner.kind === 'terminal' ? 'independent' : 'inherit-current') && run.cgroupName === scopeName(entry.owne…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `run.mode === (entry.owner.kind === 'terminal' ? 'independent' : 'inherit-current') && run.cgroupName === scopeName(entry.owne…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `scopeName`, `same` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `scopeName`, `same`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: entry: Entry; run: ProjectIdentityRun
   * 输出 / Returns: `run.mode === (entry.owner.kind === 'terminal' ? 'independent' : 'inherit-current') && run.cgroupName === scopeName(entry.owne…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private matches(entry: Entry, run: ProjectIdentityRun) {
    return run.mode === (entry.owner.kind === 'terminal' ? 'independent' : 'inherit-current') &&
      run.cgroupName === scopeName(entry.owner) && run.bootId === entry.owner.bootId &&
      run.runId === entry.runId && run.projectId === entry.projectId && run.identityId === entry.identity.identityId &&
      run.registryId === entry.identity.registryId && run.revision === entry.identity.revision &&
      (!entry.run || same({ ...run, phase: entry.run.phase }, entry.run));
  }
  /**
   * 入口 / Entry: ProjectRunScopes.inherited.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.withLock(vmId, projectId(project), () => this.inheritedUnlocked(vmId, project, execution, owner, signal))` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `this.withLock(vmId, projectId(project), () => this.inheritedUnlocked(vmId, project, execution, owner, signal))` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `ownerSchema.parse`, `this.withLock`, `projectId` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `ownerSchema.parse`, `this.withLock`, `projectId`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; project: Project; execution: ProjectIdentityExecution; owner: ProjectRunOwner; signal: AbortSignal optional
   * 输出 / Returns: Promise<ProjectInheritedPayload>；结果来自 / values from `this.withLock(vmId, projectId(project), () => this.inheritedUnlocked(vmId, project, execution, owner, signal))`.
   * 副作用 / Effects: 更新 / updates `owner`.
   * 拒绝 / Refusals: 条件 / conditions `owner.kind === 'terminal' || owner.kind === 'ssh'`; 异常 / errors `new AppError('会话须使用专属运行登记入口', 400)`.
   */
  async inherited(vmId: string, project: Project, execution: ProjectIdentityExecution,
    owner: ProjectRunOwner, signal?: AbortSignal): Promise<ProjectInheritedPayload> {
    owner = ownerSchema.parse(owner);
    if (owner.kind === 'terminal' || owner.kind === 'ssh') throw new AppError('会话须使用专属运行登记入口', 400);
    return this.withLock(vmId, projectId(project), () =>
      this.inheritedUnlocked(vmId, project, execution, owner, signal));
  }
  /**
   * 入口 / Entry: ProjectRunScopes.inheritedUnlocked.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...payload, command, identity, runId: owner.runId }` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `{ ...payload, command, identity, runId: owner.runId }` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `this.reserveUnlocked`, `assertNoPendingProjectDirectoryMigration`, `this.read`, `this.core.inheritedInput` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.reserveUnlocked`, `assertNoPendingProjectDirectoryMigration`, `this.read`, `this.core.inheritedInput`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!prior`.
   * 输入 / Inputs: vmId: string; project: Project; execution: ProjectIdentityExecution; owner: ProjectRunOwner; signal: AbortSignal optional; sshAgent: SshAgentResource optional; gpgAgent: GpgAgentResource optional; beforeIntent: (identity: ProjectIdentity, sha256: string) => Promise<void> optional; cacheTransfer: z.infer<typeof cacheTransferSchema> optional
   * 输出 / Returns: Promise<ProjectInheritedPayload>；结果来自 / values from `{ ...payload, command, identity, runId: owner.runId }`.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`; `journal.runs.push`; `this.save`.
   * 拒绝 / Refusals: 条件 / conditions `payload.runId !== owner.runId || createHash('sha256').update(payload.input).digest('hex') !== payload.sha256`; `await this.archived(vmId, id, owner.runId)`; `prior`; 异常 / errors `new AppError('项目正文摘要或本次运行身份不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`; `new AppError('项目账号运行票据已经归档，拒绝重新执行', 409, 'PROJECT_IDENTITY_RUN_STALE')`.
   */
  private async inheritedUnlocked(vmId: string, project: Project, execution: ProjectIdentityExecution,
    owner: ProjectRunOwner, signal?: AbortSignal, sshAgent?: SshAgentResource,
    gpgAgent?: GpgAgentResource,
    beforeIntent?: (identity: ProjectIdentity, sha256: string) => Promise<void>,
    cacheTransfer?: z.infer<typeof cacheTransferSchema>): Promise<ProjectInheritedPayload> {
      const identity = await this.reserveUnlocked(vmId, project, false, signal), id = identity.projectId;
      await assertNoPendingProjectDirectoryMigration(this.machines, vmId, id, signal);
      const journal = await this.read(vmId, id);
      const payload = await this.core.inheritedInput(identity, execution, { runId: owner.runId });
      if (payload.runId !== owner.runId || createHash('sha256').update(payload.input).digest('hex') !== payload.sha256)
        throw new AppError('项目正文摘要或本次运行身份不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      signal?.throwIfAborted();
      const entry: Entry = { version: 1, projectId: id, identity, runId: owner.runId, owner,
        sha256: payload.sha256, phase: 'intent', run: null, ...(sshAgent ? { sshAgent } : {}),
        ...(gpgAgent ? { gpgAgent } : {}), ...(cacheTransfer ? { cacheTransfer } : {}) };
      if (await this.archived(vmId, id, owner.runId))
        throw new AppError('项目账号运行票据已经归档，拒绝重新执行', 409, 'PROJECT_IDENTITY_RUN_STALE');
      const prior = journal.runs.find(run => run.runId === owner.runId);
      if (prior) {
        if (prior.phase !== 'intent' || !same(prior, entry))
          throw new AppError('项目账号运行票据已存在或被关闭，拒绝重新执行', 409, 'PROJECT_IDENTITY_RUN_STALE');
      } else {
        await this.compact(vmId, id, journal);
      }
      // GPG helpers have an independent host lifetime. Its exact unstarted
      // receipt must exist before a durable project intent can need recovery.
      await beforeIntent?.(identity, payload.sha256);
      signal?.throwIfAborted();
      if (!prior) journal.runs.push(entry);
      await this.save(vmId, id, journal);
      // A process cannot survive a real guest reboot between this guard and
      // launcher entry. No user command/environment is part of this argv.
      const command = `test "$(cat /proc/sys/kernel/random/boot_id)" = ${quote(owner.bootId)} && ${payload.command}`;
      return { ...payload, command, identity, runId: owner.runId };
  }
  /**
   * 入口 / Entry: ProjectRunScopes.terminalRuns.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `journal.runs.filter(entry => entry.owner.kind === 'terminal' && entry.phase !== 'closed') .map(entry => ({ runId: entry.runId…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `journal.runs.filter(entry => entry.owner.kind === 'terminal' && entry.phase !== 'closed') .map(entry => ({ runId: entry.runId…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `this.read`, `journal.runs.filter().map`, `journal.runs.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `this.read`, `journal.runs.filter().map`, `journal.runs.filter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: `journal.runs.filter(entry => entry.owner.kind === 'terminal' && entry.phase !== 'closed') .map(entry => ({ runId: entry.runId…`.
   * 副作用 / Effects: 更新 / updates `id`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async terminalRuns(vmId: string, id: string) {
    id = projectIdSchema.parse(id);
    const journal = await this.read(vmId, id);
    return journal.runs.filter(entry => entry.owner.kind === 'terminal' && entry.phase !== 'closed')
      .map(entry => ({ runId: entry.runId, terminal: entry.terminal!, phase: entry.phase }));
  }
  /**
   * 入口 / Entry: ProjectRunScopes.sshRuns.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(await this.read(vmId, id)).runs.filter(entry => entry.owner.kind === 'ssh' && entry.phase !== 'closed') .map(entry => ({ run…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `(await this.read(vmId, id)).runs.filter(entry => entry.owner.kind === 'ssh' && entry.phase !== 'closed') .map(entry => ({ run…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `inline.runs.filter().map`, `inline.runs.filter`, `this.read` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `inline.runs.filter().map`, `inline.runs.filter`, `this.read`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: `(await this.read(vmId, id)).runs.filter(entry => entry.owner.kind === 'ssh' && entry.phase !== 'closed') .map(entry => ({ run…`.
   * 副作用 / Effects: 更新 / updates `id`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async sshRuns(vmId: string, id: string) {
    id = projectIdSchema.parse(id);
    return (await this.read(vmId, id)).runs.filter(entry => entry.owner.kind === 'ssh' && entry.phase !== 'closed')
      .map(entry => ({ runId: entry.runId, owner: entry.owner, identity: entry.identity,
        sha256: entry.sha256, run: entry.run, phase: entry.phase }));
  }
  /**
   * 入口 / Entry: ProjectRunScopes.beginSsh.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.withLock(vmId, projectId(project), async () => { const context = await this.taskContext(vmId, signal); if (context.bootI…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `this.withLock(vmId, projectId(project), async () => { const context = await this.taskContext(vmId, signal); if (context.bootI…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `ownerSchema.parse`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `ownerSchema.parse`, `inline.includes`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; project: Project; runId: string; owner: ProjectRunOwner; environment: Record<string, string>; signal: AbortSignal optional
   * 输出 / Returns: `this.withLock(vmId, projectId(project), async () => { const context = await this.taskContext(vmId, signal); if (context.bootI…`.
   * 副作用 / Effects: 更新 / updates `runId`, `owner`.
   * 拒绝 / Refusals: 条件 / conditions `owner.kind !== 'ssh' || owner.runId !== runId || !['openrc.sakura-ssh-' + projectId(project), 'system.slice/sakura-ssh-' + pr…`; 异常 / errors `new AppError('SSH 登记身份不符', 409, 'PROJECT_IDENTITY_RUN_STALE')`.
   */
  async beginSsh(vmId: string, project: Project, runId: string,
    owner: ProjectRunOwner, environment: Record<string, string>, signal?: AbortSignal) {
    runId = z.uuid().parse(runId); owner = ownerSchema.parse(owner);
    if (owner.kind !== 'ssh' || owner.runId !== runId || !['openrc.sakura-ssh-' + projectId(project),
        'system.slice/sakura-ssh-' + projectId(project) + '.service'].includes(owner.cgroupName!))
      throw new AppError('SSH 登记身份不符', 409, 'PROJECT_IDENTITY_RUN_STALE');
    /**
     * 入口 / Entry: ProjectRunScopes.beginSsh.callback@630.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withLock）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withLock).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ identity, owner, snapshot }`.
     * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`; `journal.runs.push`; `this.save`.
     * 拒绝 / Refusals: 条件 / conditions `context.bootId !== owner.bootId`; `!this.core.sshSnapshotInput`; `journal.runs.some(entry => entry.runId === runId || entry.owner.kind === 'ssh' && entry.phase !== 'closed') || await this.arc…`; 异常 / errors `new AppError('SSH 登记期间客户机已重启', 409, 'PROJECT_IDENTITY_RUN_STALE')`; `new AppError('项目 SSH 登记入口不可用', 503)`.
     */
    return this.withLock(vmId, projectId(project), async () => {
      const context = await this.taskContext(vmId, signal);
      if (context.bootId !== owner.bootId) throw new AppError('SSH 登记期间客户机已重启', 409, 'PROJECT_IDENTITY_RUN_STALE');
      const identity = await this.reserveUnlocked(vmId, project, false, signal), id = identity.projectId;
      await assertNoPendingProjectDirectoryMigration(this.machines, vmId, id, signal);
      if (!this.core.sshSnapshotInput) throw new AppError('项目 SSH 登记入口不可用', 503);
      const journal = await this.read(vmId, id);
      if (journal.runs.some(entry => entry.runId === runId || entry.owner.kind === 'ssh' && entry.phase !== 'closed') ||
          await this.archived(vmId, id, runId))
        throw new AppError('项目 SSH 原运行尚未清理', 409, 'PROJECT_IDENTITY_RUN_STALE');
      await this.compact(vmId, id, journal);
      const snapshot = await this.core.sshSnapshotInput(identity, runId, environment);
      if (snapshot.runId !== runId || createHash('sha256').update(snapshot.input).digest('hex') !== snapshot.sha256)
        throw new AppError('项目 SSH 环境摘要不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      const current = await this.taskContext(vmId, signal);
      if (current.live !== context.live || current.bootId !== context.bootId)
        throw new AppError('项目 SSH 登记期间客户机身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      const entry: Entry = { version: 1, projectId: id, identity, owner, runId,
        sha256: snapshot.sha256, phase: 'intent', run: null };
      journal.runs.push(entry); await this.save(vmId, id, journal);
      return { identity, owner, snapshot };
    });
  }
  /**
   * 入口 / Entry: ProjectRunScopes.activateSsh.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), entry = journal.runs.find(entry => entry.run…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), entry = journal.runs.find(entry => entry.run…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `projectIdentitySshDaemonSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `projectIdentitySshDaemonSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; runId: string; daemon: ProjectIdentitySshDaemon; signal: AbortSignal optional
   * 输出 / Returns: `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), entry = journal.runs.find(entry => entry.run…`.
   * 副作用 / Effects: 更新 / updates `id`, `runId`, `daemon`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async activateSsh(vmId: string, id: string, runId: string, daemon: ProjectIdentitySshDaemon, signal?: AbortSignal) {
    id = projectIdSchema.parse(id); runId = z.uuid().parse(runId); daemon = projectIdentitySshDaemonSchema.parse(daemon);
    /**
     * 入口 / Entry: ProjectRunScopes.activateSsh.callback@655.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withLock）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withLock).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ identity: entry.identity, run, owner: entry.owner, sha256: entry.sha256 }`.
     * 副作用 / Effects: `this.save`; 更新 / updates `entry.run`, `entry.phase`.
     * 拒绝 / Refusals: 条件 / conditions `!entry || entry.owner.kind !== 'ssh' || entry.phase !== 'intent' || entry.run || !this.core.prepareSsh || entry.owner.bootId …`; `context.bootId !== daemon.bootId`; `current.live !== context.live || current.bootId !== context.bootId || run.phase !== 'active' || !this.matches(entry, run)`; 异常 / errors `new AppError('SSH 原启动登记或服务身份不符', 409, 'PROJECT_IDENTITY_RUN_STALE')`; `new AppError('SSH 启动期间客户机已重启', 409, 'PROJECT_IDENTITY_RUN_STALE')`.
     */
    return this.withLock(vmId, id, async () => {
      const journal = await this.read(vmId, id), entry = journal.runs.find(entry => entry.runId === runId);
      if (!entry || entry.owner.kind !== 'ssh' || entry.phase !== 'intent' || entry.run || !this.core.prepareSsh ||
          entry.owner.bootId !== daemon.bootId || scopeName(entry.owner) !== daemon.cgroupName)
        throw new AppError('SSH 原启动登记或服务身份不符', 409, 'PROJECT_IDENTITY_RUN_STALE');
      const context = await this.taskContext(vmId, signal);
      if (context.bootId !== daemon.bootId) throw new AppError('SSH 启动期间客户机已重启', 409, 'PROJECT_IDENTITY_RUN_STALE');
      const run = await this.core.prepareSsh(vmId, entry.identity, { runId, daemon, snapshotSha256: entry.sha256 }, signal);
      const current = await this.taskContext(vmId, signal);
      if (current.live !== context.live || current.bootId !== context.bootId || run.phase !== 'active' || !this.matches(entry, run))
        throw new AppError('SSH 完整运行归属未确认，原登记保留', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      entry.run = run; entry.phase = 'active'; await this.save(vmId, id, journal);
      return { identity: entry.identity, run, owner: entry.owner, sha256: entry.sha256 };
    });
  }
  /**
   * 入口 / Entry: ProjectRunScopes.recoverSshTicket.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), entry = journal.runs.find(entry => entry.run…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), entry = journal.runs.find(entry => entry.run…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `this.withLock` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `this.withLock`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; runId: string; signal: AbortSignal optional
   * 输出 / Returns: `this.withLock(vmId, id, async () => { const journal = await this.read(vmId, id), entry = journal.runs.find(entry => entry.run…`.
   * 副作用 / Effects: 更新 / updates `id`, `runId`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async recoverSshTicket(vmId: string, id: string, runId: string, signal?: AbortSignal) {
    id = projectIdSchema.parse(id); runId = z.uuid().parse(runId);
    /**
     * 入口 / Entry: ProjectRunScopes.recoverSshTicket.callback@672.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withLock）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withLock).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `null`; `{ runId: entry.runId, owner: entry.owner, identity: entry.identity, sha256: entry.sha256, run: entry.run, phase: entry.phase …`.
     * 副作用 / Effects: `this.save`; 更新 / updates `run`, `entry.run`, `entry.phase`.
     * 拒绝 / Refusals: 条件 / conditions `!entry || entry.owner.kind !== 'ssh' || entry.phase === 'closed'`; `context.bootId !== entry.owner.bootId`; `!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_RECORD_ABSENT' || entry.run`; 异常 / errors `new AppError('SSH 原启动登记不存在或已关闭，拒绝恢复其他运行', 409, 'PROJECT_IDENTITY_RUN_STALE')`; `new AppError('客户机已重启，原 SSH 票据须在全域停止后核销', 409, 'PROJECT_IDENTITY_RUN_STALE')`.
     * 失败处理：catch 分支执行 `if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_RECORD_ABSENT' || entry.run) throw error;`; `await unchanged();`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_RECORD_ABSENT' || entry.run) throw error;`; `await unchanged();`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.withLock(vmId, id, async () => {
      const journal = await this.read(vmId, id), entry = journal.runs.find(entry => entry.runId === runId);
      if (!entry || entry.owner.kind !== 'ssh' || entry.phase === 'closed')
        throw new AppError('SSH 原启动登记不存在或已关闭，拒绝恢复其他运行', 409, 'PROJECT_IDENTITY_RUN_STALE');
      const context = await this.taskContext(vmId, signal);
      if (context.bootId !== entry.owner.bootId)
        throw new AppError('客户机已重启，原 SSH 票据须在全域停止后核销', 409, 'PROJECT_IDENTITY_RUN_STALE');
      /**
       * 入口 / Entry: ProjectRunScopes.recoverSshTicket.unchanged.
       * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectRunScopes`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; the calls and state transitions below complete the operation. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
       * 处理：通过 `this.taskContext`, `same`, `this.read`, `signal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.taskContext`, `same`, `this.read`, `signal.throwIfAborted`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `current.live !== context.live || current.bootId !== context.bootId || !same(await this.read(vmId, id), journal)`; 异常 / errors `new AppError('SSH 恢复期间客户机或主机原登记已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
       */
      const unchanged = async () => {
        const current = await this.taskContext(vmId, signal);
        if (current.live !== context.live || current.bootId !== context.bootId ||
            !same(await this.read(vmId, id), journal))
          throw new AppError('SSH 恢复期间客户机或主机原登记已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        signal?.throwIfAborted();
      };
      let run: ProjectIdentityRun;
      try { run = await this.core.run(vmId, entry.identity, runId, signal); }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_RECORD_ABSENT' || entry.run) throw error;
        await unchanged(); return null;
      }
      const checked = projectIdentityRunSchema.safeParse(run);
      if (!checked.success || !this.matches(entry, checked.data) ||
          checked.data.namespace !== (entry.identity.networkIsolation === 'private' ? 'sk-' + id : '') ||
          (entry.run?.phase === 'closed' && checked.data.phase !== 'closed'))
        throw new AppError('SSH 完整恢复票据与原运行不可变归属不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      await unchanged();
      // This is a cleanup query, never another prepare. Even a closed native
      // receipt keeps the host run guarded until its whole original domain is
      // confirmed stopped by closeAfterScopeStopped.
      entry.run = checked.data; entry.phase = 'active'; await this.save(vmId, id, journal);
      return { runId: entry.runId, owner: entry.owner, identity: entry.identity,
        sha256: entry.sha256, run: entry.run, phase: entry.phase };
    });
  }
  /**
   * 入口 / Entry: ProjectRunScopes.sshRun.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ identity: entry.identity, run, owner: entry.owner, sha256: entry.sha256 }` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `{ identity: entry.identity, run, owner: entry.owner, sha256: entry.sha256 }` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `inline.runs.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `inline.runs.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; runId: string; signal: AbortSignal optional
   * 输出 / Returns: `{ identity: entry.identity, run, owner: entry.owner, sha256: entry.sha256 }`.
   * 副作用 / Effects: 更新 / updates `id`, `runId`.
   * 拒绝 / Refusals: 条件 / conditions `!entry || entry.owner.kind !== 'ssh' || entry.phase !== 'active' || !entry.run || !this.core.runReadonly`; `!instance || this.machines.live.get(vmId) !== instance || run.phase !== 'active' || !this.matches(entry, run)`; 异常 / errors `new AppError('SSH 完整账号票据尚未确认，请先停止原服务', 409, 'PROJECT_IDENTITY_RUN_STALE')`; `new AppError('SSH 原账号运行归属已改变', 409, 'PROJECT_IDENTITY_RUN_STALE')`.
   */
  async sshRun(vmId: string, id: string, runId: string, signal?: AbortSignal) {
    id = projectIdSchema.parse(id); runId = z.uuid().parse(runId);
    const entry = (await this.read(vmId, id)).runs.find(entry => entry.runId === runId);
    if (!entry || entry.owner.kind !== 'ssh' || entry.phase !== 'active' || !entry.run || !this.core.runReadonly)
      throw new AppError('SSH 完整账号票据尚未确认，请先停止原服务', 409, 'PROJECT_IDENTITY_RUN_STALE');
    const instance = this.machines.live.get(vmId), run = await this.core.runReadonly(vmId, entry.identity, runId, signal);
    if (!instance || this.machines.live.get(vmId) !== instance || run.phase !== 'active' || !this.matches(entry, run))
      throw new AppError('SSH 原账号运行归属已改变', 409, 'PROJECT_IDENTITY_RUN_STALE');
    return { identity: entry.identity, run, owner: entry.owner, sha256: entry.sha256 };
  }
  /**
   * 入口 / Entry: ProjectRunScopes.retireRebootedTerminals.
   * 功能：在维护项目账户运行日志及资源票据中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ProjectRunScopes`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectRunScopes`; the calls and state transitions below complete the operation. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `this.taskContext`, `this.read`, `this.stopTerminal` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `this.taskContext`, `this.read`, `this.stopTerminal`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `entry.owner.kind === 'terminal' && entry.phase !== 'closed' && entry.owner.bootId !== context.bootId`.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.stopTerminal`; 更新 / updates `id`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async retireRebootedTerminals(vmId: string, id: string) {
    id = projectIdSchema.parse(id);
    const context = await this.taskContext(vmId), journal = await this.read(vmId, id);
    for (const entry of journal.runs) {
      if (entry.owner.kind === 'terminal' && entry.phase !== 'closed' && entry.owner.bootId !== context.bootId)
        await this.stopTerminal(vmId, id, entry.runId);
    }
  }
  /**
   * 入口 / Entry: ProjectRunScopes.prepareTerminal.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.withLock(vmId, projectId(project), async () => { const context = await this.taskContext(vmId, signal), identity = await …` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `this.withLock(vmId, projectId(project), async () => { const context = await this.taskContext(vmId, signal), identity = await …` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `terminalSchema.parse`, `this.withLock` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `terminalSchema.parse`, `this.withLock`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; project: Project; runId: string; terminal: z.infer<typeof terminalSchema>; signal: AbortSignal optional
   * 输出 / Returns: `this.withLock(vmId, projectId(project), async () => { const context = await this.taskContext(vmId, signal), identity = await …`.
   * 副作用 / Effects: 更新 / updates `runId`, `terminal`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async prepareTerminal(vmId: string, project: Project, runId: string,
    terminal: z.infer<typeof terminalSchema>, signal?: AbortSignal) {
    runId = z.uuid().parse(runId); terminal = terminalSchema.parse(terminal);
    /**
     * 入口 / Entry: ProjectRunScopes.prepareTerminal.callback@727.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withLock）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withLock).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `session.perform(async active => { const run = await this.core.prepare!(vmId, identity, { runId }, active); const current = aw…`.
     * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`; `journal.runs.push`; `this.save`.
     * 拒绝 / Refusals: 条件 / conditions `!this.core.prepare`; `journal.runs.some(entry => entry.runId === runId || (entry.owner.kind === 'terminal' && entry.phase !== 'closed' && entry.ter…`; 异常 / errors `new AppError('项目终端独立运行入口不可用', 503)`; `new AppError('终端运行已登记，请先核对或停止原会话', 409, 'PROJECT_IDENTITY_RUN_STALE')`.
     */
    return this.withLock(vmId, projectId(project), async () => {
      const context = await this.taskContext(vmId, signal), identity = await this.reserveUnlocked(vmId, project, false, signal);
      const id = identity.projectId;
      await assertNoPendingProjectDirectoryMigration(this.machines, vmId, id, signal);
      if (!this.core.prepare) throw new AppError('项目终端独立运行入口不可用', 503);
      const journal = await this.read(vmId, id);
      if (journal.runs.some(entry => entry.runId === runId ||
          (entry.owner.kind === 'terminal' && entry.phase !== 'closed' && entry.terminal?.name === terminal.name)) ||
          await this.archived(vmId, id, runId))
        throw new AppError('终端运行已登记，请先核对或停止原会话', 409, 'PROJECT_IDENTITY_RUN_STALE');
      await this.compact(vmId, id, journal);
      const owner: ProjectRunOwner = { kind: 'terminal', runId, bootId: context.bootId };
      const entry: Entry = { version: 1, projectId: id, identity, owner, runId, terminal,
        sha256: createHash('sha256').update(JSON.stringify({ identity, owner, terminal })).digest('hex'),
        phase: 'intent', run: null };
      journal.runs.push(entry); await this.save(vmId, id, journal);
      const session = await ProjectSessionLifetime.acquire({ machines: this.machines, vmId, kind: 'terminal',
        live: context.live, signal, receipt: { projectId: id, runId, bootId: context.bootId, identity, terminal, run: null as ProjectIdentityRun | null },
        /**
         * 入口 / Entry: ProjectRunScopes.prepareTerminal.cleanup.
         * 功能：把本层请求转交 `this.stopTerminalNative`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `this.stopTerminalNative` and propagates the provider result or rejection.
         * 输入 / Inputs: receipt
         * 输出 / Returns: `this.stopTerminalNative(vmId, id, runId, receipt)`.
         * 副作用 / Effects: `this.stopTerminalNative`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        cleanup: receipt => this.stopTerminalNative(vmId, id, runId, receipt) });
      /**
       * 入口 / Entry: ProjectRunScopes.prepareTerminal.callback@746.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（session.perform）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (session.perform).
       * 输入 / Inputs: active
       * 输出 / Returns: `{ identity, run, terminal }`.
       * 副作用 / Effects: `this.save`; 更新 / updates `entry.run`, `entry.phase`.
       * 拒绝 / Refusals: 条件 / conditions `current.live !== context.live || current.bootId !== context.bootId || run.phase !== 'active' || !this.matches(entry, run)`; 异常 / errors `new AppError('项目终端完整运行归属未确认，原 intent 保留', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
       */
      return session.perform(async active => {
      const run = await this.core.prepare!(vmId, identity, { runId }, active);
      const current = await this.taskContext(vmId, active);
      if (current.live !== context.live || current.bootId !== context.bootId || run.phase !== 'active' || !this.matches(entry, run))
        throw new AppError('项目终端完整运行归属未确认，原 intent 保留', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      entry.run = run; entry.phase = 'active'; await this.save(vmId, id, journal);
      session.pin({ projectId: id, runId, bootId: context.bootId, identity, terminal, run });
      return { identity, run, terminal };
      }, signal);
    });
  }
  /**
   * 入口 / Entry: ProjectRunScopes.terminalRun.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ identity: entry.identity, run, terminal: entry.terminal! }` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `{ identity: entry.identity, run, terminal: entry.terminal! }` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `inline.runs.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `inline.runs.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; runId: string; signal: AbortSignal optional
   * 输出 / Returns: `{ identity: entry.identity, run, terminal: entry.terminal! }`.
   * 副作用 / Effects: 更新 / updates `id`, `runId`.
   * 拒绝 / Refusals: 条件 / conditions `!entry || entry.owner.kind !== 'terminal' || entry.phase !== 'active' || !entry.run || !this.core.runReadonly`; `!instance || this.machines.live.get(vmId) !== instance || run.phase !== 'active' || !this.matches(entry, run)`; 异常 / errors `new AppError('终端的完整运行票据尚未确认，请先停止原会话', 409, 'PROJECT_IDENTITY_RUN_STALE')`; `new AppError('终端已结束或客户机运行归属已改变', 409, 'PROJECT_IDENTITY_RUN_STALE')`.
   */
  async terminalRun(vmId: string, id: string, runId: string, signal?: AbortSignal) {
    id = projectIdSchema.parse(id); runId = z.uuid().parse(runId);
    const entry = (await this.read(vmId, id)).runs.find(entry => entry.runId === runId);
    if (!entry || entry.owner.kind !== 'terminal' || entry.phase !== 'active' || !entry.run || !this.core.runReadonly)
      throw new AppError('终端的完整运行票据尚未确认，请先停止原会话', 409, 'PROJECT_IDENTITY_RUN_STALE');
    const instance = this.machines.live.get(vmId), run = await this.core.runReadonly(vmId, entry.identity, runId, signal);
    if (!instance || this.machines.live.get(vmId) !== instance || run.phase !== 'active' || !this.matches(entry, run))
      throw new AppError('终端已结束或客户机运行归属已改变', 409, 'PROJECT_IDENTITY_RUN_STALE');
    return { identity: entry.identity, run, terminal: entry.terminal! };
  }
  /**
   * 入口 / Entry: ProjectRunScopes.stopTerminal.
   * 功能：在维护项目账户运行日志及资源票据中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.stopTerminalNative(vmId, id, runId)` / `ProjectSessionLifetime.retire(this.machines, vmId, { projectId: id, runId, bootId: entry.owner.bootId, identity: entry.identi…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectRunScopes`; this entry produces `this.stopTerminalNative(vmId, id, runId)` / `ProjectSessionLifetime.retire(this.machines, vmId, { projectId: id, runId, bootId: entry.owner.bootId, identity: entry.identi…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `inline.runs.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `inline.runs.find`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!entry || entry.owner.kind !== 'terminal'`.
   * 输入 / Inputs: vmId: string; id: string; runId: string
   * 输出 / Returns: `this.stopTerminalNative(vmId, id, runId)`; `ProjectSessionLifetime.retire(this.machines, vmId, { projectId: id, runId, bootId: entry.owner.bootId, identity: entry.identi…`.
   * 副作用 / Effects: `this.stopTerminalNative`; 更新 / updates `id`, `runId`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async stopTerminal(vmId: string, id: string, runId: string) {
    id = projectIdSchema.parse(id); runId = z.uuid().parse(runId);
    const entry = (await this.read(vmId, id)).runs.find(entry => entry.runId === runId);
    if (!entry || entry.owner.kind !== 'terminal') return this.stopTerminalNative(vmId, id, runId);
    return ProjectSessionLifetime.retire(this.machines, vmId, { projectId: id, runId,
      bootId: entry.owner.bootId, identity: entry.identity, terminal: entry.terminal, run: entry.run },
      receipt => this.stopTerminalNative(vmId, id, runId, receipt));
  }
  /**
   * 入口 / Entry: ProjectRunScopes.stopTerminalNative.
   * 功能：在维护项目账户运行日志及资源票据中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.withLock(vmId, id, async () => { const entry = (await this.read(vmId, id)).runs.find(entry => entry.runId === runId); co…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectRunScopes`; this entry produces `this.withLock(vmId, id, async () => { const entry = (await this.read(vmId, id)).runs.find(entry => entry.runId === runId); co…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `this.withLock().catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `this.withLock().catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; runId: string; expected: { bootId: string; identity: unknown; terminal: unknown; run: ProjectIdentityRun | nul… optional
   * 输出 / Returns: `this.withLock(vmId, id, async () => { const entry = (await this.read(vmId, id)).runs.find(entry => entry.runId === runId); co…`.
   * 副作用 / Effects: 更新 / updates `id`, `runId`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async stopTerminalNative(vmId: string, id: string, runId: string,
    expected?: { bootId: string; identity: unknown; terminal: unknown; run: ProjectIdentityRun | null }) {
    id = projectIdSchema.parse(id); runId = z.uuid().parse(runId);
    /**
     * 入口 / Entry: ProjectRunScopes.stopTerminalNative.callback@778.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withLock）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withLock).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `this.closeUnlocked`; `this.core.stop`; `this.machines.exec`; 更新 / updates `run`.
     * 拒绝 / Refusals: 条件 / conditions `!entry`; `entry.owner.kind !== 'terminal'`; `context.bootId === entry.owner.bootId`; 异常 / errors `new AppError('原终端运行记录不存在，清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`; `new AppError('停止请求不属于交互终端', 409)`.
     * 失败处理：catch 分支执行 `if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_RECORD_ABSENT' || entry.run) throw error;`; `await this.closeUnlocked(vmId, id, runId);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_RECORD_ABSENT' || entry.run) throw error;`; `await this.closeUnlocked(vmId, id, runId);`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.withLock(vmId, id, async () => {
      const entry = (await this.read(vmId, id)).runs.find(entry => entry.runId === runId);
      /**
       * 入口 / Entry: ProjectRunScopes.stopTerminalNative.original.
       * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectRunScopes`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; the calls and state transitions below complete the operation. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
       * 处理：通过 `same` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `same`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: candidate: Entry
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `expected && (candidate.owner.bootId !== expected.bootId || !same(candidate.identity, expected.identity) || !same(candidate.te…`; 异常 / errors `new AppError('原终端完整归属已改变，清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
       */
      const original = (candidate: Entry) => {
        if (expected && (candidate.owner.bootId !== expected.bootId ||
            !same(candidate.identity, expected.identity) || !same(candidate.terminal, expected.terminal) ||
            (expected.run && (!candidate.run || !same({ ...candidate.run, phase: expected.run.phase }, expected.run)))))
          throw new AppError('原终端完整归属已改变，清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      };
      if (!entry) {
        const prior = await this.archived(vmId, id, runId);
        if (prior?.owner.kind === 'terminal') { original(prior); return; }
        throw new AppError('原终端运行记录不存在，清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      }
      original(entry);
      if (entry.owner.kind !== 'terminal') throw new AppError('停止请求不属于交互终端', 409);
      if (entry.phase === 'closed') return;
      const context = await this.taskContext(vmId);
      if (context.bootId === entry.owner.bootId) {
        let run: ProjectIdentityRun;
        try { run = await this.core.run(vmId, entry.identity, runId); }
        catch (error) {
          if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_RECORD_ABSENT' || entry.run) throw error;
          await this.closeUnlocked(vmId, id, runId); return;
        }
        if (!this.matches(entry, run)) throw new AppError('终端运行票据已改变，拒绝停止其他运行', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        const stopped = await this.core.stop(vmId, entry.identity, run);
        if (stopped.phase !== 'closed' || !same({ ...stopped, phase: run.phase }, run) || !this.core.retireTerminal)
          throw new AppError('原终端停止回执未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        await this.core.retireTerminal(vmId, entry.identity, stopped);
      } else {
        const paths = ['/run/sakura-project-terminals/' + runId, '/run/sakura-project-identities/terminals/' + runId + '.json'];
        const result = await this.machines.exec(vmId,
          `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S -c ${quote(
            `import os\nassert all(not os.path.lexists(p) for p in ${JSON.stringify(paths)})\n`)}`, 10000);
        if (result.code !== 0) throw new AppError('新开机仍存在原终端资源，保留核销记录', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      }
      if (this.machines.live.get(vmId) !== context.live || await this.kernelBoot(vmId) !== context.bootId)
        throw new AppError('终端清理期间客户机身份改变', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      await this.closeUnlocked(vmId, id, runId);
    }).catch(error => {
      if (error instanceof AppError && error.code === 'PROJECT_IDENTITY_CLEANUP_FAILED') throw error;
      throw new AppError('原终端全域或资源清理尚未确认，保留原运行记录：' +
        (error instanceof Error ? error.message : String(error)), 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    });
  }
  /**
   * 入口 / Entry: ProjectRunScopes.stopTerminals.
   * 功能：在维护项目账户运行日志及资源票据中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ProjectRunScopes`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectRunScopes`; the calls and state transitions below complete the operation. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `this.terminalRuns`, `this.stopTerminal` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.terminalRuns`, `this.stopTerminal`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!name || entry.terminal.name === name`.
   * 输入 / Inputs: vmId: string; id: string; name: string optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.stopTerminal`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async stopTerminals(vmId: string, id: string, name?: string) {
    const runs = await this.terminalRuns(vmId, id);
    for (const entry of runs) if (!name || entry.terminal.name === name) await this.stopTerminal(vmId, id, entry.runId);
  }
  /**
   * 入口 / Entry: ProjectRunScopes.taskKey.
   * 功能：从当前输入或状态计算 `vmId + ':' + id + ':' + runId`，供调用方后续验证或使用。
   * Purpose: Computes `vmId + ':' + id + ':' + runId` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: vmId: string; id: string; runId: string
   * 输出 / Returns: `vmId + ':' + id + ':' + runId`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private taskKey(vmId: string, id: string, runId: string) {
    return vmId + ':' + id + ':' + runId;
  }
  /**
   * 入口 / Entry: ProjectRunScopes.taskMetadataMatches.
   * 功能：从当前输入或状态计算 `entry.owner.kind === 'task' && entry.version === record.entry.version && entry.projectId === record.entry.projectId && entry.…`，供调用方后续验证或使用。
   * Purpose: Computes `entry.owner.kind === 'task' && entry.version === record.entry.version && entry.projectId === record.entry.projectId && entry.…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: record: ActiveTask; entry: Entry
   * 输出 / Returns: `entry.owner.kind === 'task' && entry.version === record.entry.version && entry.projectId === record.entry.projectId && entry.…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private taskMetadataMatches(record: ActiveTask, entry: Entry) {
    return entry.owner.kind === 'task' && entry.version === record.entry.version &&
      entry.projectId === record.entry.projectId && entry.runId === record.entry.runId &&
      entry.sha256 === record.entry.sha256 && same(entry.owner, record.entry.owner) &&
      same(entry.identity, record.entry.identity) && same(entry.sshAgent, record.entry.sshAgent) &&
      same(entry.gpgAgent, record.entry.gpgAgent) && same(entry.cacheTransfer, record.entry.cacheTransfer);
  }
  /**
   * 入口 / Entry: ProjectRunScopes.pinActiveTask.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `void` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `activeTasks.get().get`, `activeTasks.get`, `this.taskKey`, `this.file` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `activeTasks.get().get`, `activeTasks.get`, `this.taskKey`, `this.file`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!record || record.file !== this.file(vmId, id) || record.live !== this.machines.live.get(vmId) || re…`.
   * 输入 / Inputs: vmId: string; id: string; entry: Entry; run: ProjectIdentityRun
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `record.entry.run`.
   * 拒绝 / Refusals: 条件 / conditions `record.entry.run && !same({ ...run, phase: record.entry.run.phase }, record.entry.run)`; 异常 / errors `new AppError('当前任务完整票据已变化', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   */
  private pinActiveTask(vmId: string, id: string, entry: Entry, run: ProjectIdentityRun) {
    const record = activeTasks.get(this.machines)?.get(this.taskKey(vmId, id, entry.runId));
    if (!record || record.file !== this.file(vmId, id) || record.live !== this.machines.live.get(vmId) ||
        record.bootId !== run.bootId || !this.taskMetadataMatches(record, entry)) return;
    if (record.entry.run && !same({ ...run, phase: record.entry.run.phase }, record.entry.run))
      throw new AppError('当前任务完整票据已变化', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    record.entry.run = structuredClone(run);
  }
  /**
   * 入口 / Entry: ProjectRunScopes.isActiveTask.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `entry.run === null ? record.entry.run === null : Boolean(record.entry.run && same({ ...entry.run, phase: record.entry.run.pha…` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `false` / `entry.run === null ? record.entry.run === null : Boolean(record.entry.run && same({ ...entry.run, phase: record.entry.run.pha…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `activeTasks.get().get`, `activeTasks.get`, `this.taskKey`, `this.file` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `activeTasks.get().get`, `activeTasks.get`, `this.taskKey`, `this.file`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!record || !context || record.file !== this.file(vmId, id) || record.live !== context.live || record…`.
   * 输入 / Inputs: vmId: string; id: string; entry: Entry; context: TaskContext optional
   * 输出 / Returns: `false`; `entry.run === null ? record.entry.run === null : Boolean(record.entry.run && same({ ...entry.run, phase: record.entry.run.pha…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private isActiveTask(vmId: string, id: string, entry: Entry, context?: TaskContext) {
    const record = activeTasks.get(this.machines)?.get(this.taskKey(vmId, id, entry.runId));
    if (!record || !context || record.file !== this.file(vmId, id) ||
        record.live !== context.live || record.live !== this.machines.live.get(vmId) ||
        record.bootId !== context.bootId || !this.taskMetadataMatches(record, entry)) return false;
    return entry.run === null ? record.entry.run === null : Boolean(record.entry.run &&
      same({ ...entry.run, phase: record.entry.run.phase }, record.entry.run));
  }
  /**
   * 入口 / Entry: ProjectRunScopes.taskContext.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ live, bootId: bootId.data }` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `{ live, bootId: bootId.data }` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `this.machines.live.get`, `this.machines.exec`, `z.uuid().safeParse`, `z.uuid` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.live.get`, `this.machines.exec`, `z.uuid().safeParse`, `z.uuid`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; signal: AbortSignal optional
   * 输出 / Returns: Promise<TaskContext>；结果来自 / values from `{ live, bootId: bootId.data }`.
   * 副作用 / Effects: `this.machines.exec`; `vmLifetime().observeBoot`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0 || !bootId.success || !live || this.machines.live.get(vmId) !== live`; 异常 / errors `new AppError('无法固定客户机开机身份，项目代码未执行', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   */
  private async taskContext(vmId: string, signal?: AbortSignal): Promise<TaskContext> {
    const live = this.machines.live.get(vmId), result = await this.machines.exec(vmId,
      'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/cat /proc/sys/kernel/random/boot_id', 10000, signal);
    const bootId = z.uuid().safeParse(result.stdout.trim());
    if (result.code !== 0 || !bootId.success || !live || this.machines.live.get(vmId) !== live)
      throw new AppError('无法固定客户机开机身份，项目代码未执行', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    vmLifetime(vmId, live).observeBoot(bootId.data);
    return { live, bootId: bootId.data };
  }
  /** 只有本次准入能创建进程内任务所有者；磁盘旧回执不能重建执行权或冒充活动任务。 */
  /**
   * 入口 / Entry: ProjectRunScopes.admitTask.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.withLock(vmId, id, async () => { signal.throwIfAborted(); const context = await this.taskContext(vmId, signal), runId = …` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `this.withLock(vmId, id, async () => { signal.throwIfAborted(); const context = await this.taskContext(vmId, signal), runId = …` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectId`, `inline.ProjectCacheTransfers.recover`, `inline`, `cacheTransferSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectId`, `inline.ProjectCacheTransfers.recover`, `inline`, `cacheTransferSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; project: Project; execution: ProjectIdentityExecution; signal: AbortSignal; options: ProjectTaskAdmissionOptions default={}
   * 输出 / Returns: `this.withLock(vmId, id, async () => { signal.throwIfAborted(); const context = await this.taskContext(vmId, signal), runId = …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `forwarding && gpgForwarding`; 异常 / errors `new AppError('单次任务不能同时登记两种 Agent 转发', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   */
  async admitTask(vmId: string, project: Project, execution: ProjectIdentityExecution, signal: AbortSignal,
    options: ProjectTaskAdmissionOptions = {}) {
    const id = projectId(project);
    await (new (await import('./project-cache-transfer.ts')).ProjectCacheTransfers(this.machines, { scopes: this, rootDirectory: this.options.rootDirectory })).recover(vmId, id);
    const cacheTransfer = options.resource ? cacheTransferSchema.parse({ ...options.resource.descriptor, phase: 'pending' }) : undefined;
    const expectedLive = options.expectedLive;
    const forwarding = options.sshAgent ? { ...options.sshAgent,
      resource: sshAgentResourceSchema.parse(options.sshAgent.resource) } : undefined;
    const gpgForwarding = options.gpgAgent ? { ...options.gpgAgent,
      resource: gpgAgentResourceSchema.parse(options.gpgAgent.resource) } : undefined;
    if (forwarding && gpgForwarding)
      throw new AppError('单次任务不能同时登记两种 Agent 转发', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    /**
     * 入口 / Entry: ProjectRunScopes.admitTask.callback@875.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withLock）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withLock).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ payload, live: context.live, owner: { ...owner, kind: 'task' as const }, agentContext, forwarding, gpgContext, gpgForwardin…`.
     * 副作用 / Effects: `activeTasks.set`; `registry.set`; `ExecutionScope.current`; `taskRecoveries.set`; `recoveries.set`; 更新 / updates `registry`, `recoveries`.
     * 拒绝 / Refusals: 条件 / conditions `(expectedLive && context.live !== expectedLive) || (options.expectedBootId && context.bootId !== z.uuid().parse(options.expec…`; `forwarding && !(forwarding.agent instanceof OwnedForwardAgent)`; `gpgForwarding && (!(gpgForwarding.bridge instanceof OwnedGpgForward) || gpgForwarding.bridge.hostSourceSha256 !== gpgResource…`; 异常 / errors `new AppError('客户机运行身份与本次任务准备不符，项目代码未执行', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`; `new AppError('SSH Agent 缺少本次独立的宿主 stream owner', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
     */
    return this.withLock(vmId, id, async () => {
      signal.throwIfAborted();
      const context = await this.taskContext(vmId, signal), runId = randomUUID();
      if ((expectedLive && context.live !== expectedLive) || (options.expectedBootId && context.bootId !== z.uuid().parse(options.expectedBootId)))
        throw new AppError('客户机运行身份与本次任务准备不符，项目代码未执行', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      await this.recoverStoppedTasksUnlocked(vmId, id, context);
      const owner: ProjectRunOwner = { kind: 'task', runId, bootId: context.bootId };
      const resource = forwarding?.resource;
      const gpgResource = gpgForwarding?.resource;
      if (forwarding && !(forwarding.agent instanceof OwnedForwardAgent))
        throw new AppError('SSH Agent 缺少本次独立的宿主 stream owner', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      if (gpgForwarding && (!(gpgForwarding.bridge instanceof OwnedGpgForward) ||
          gpgForwarding.bridge.hostSourceSha256 !== gpgResource!.hostSourceSha256 ||
          gpgForwarding.bridge.hostHelperSha256 !== gpgResource!.hostHelperSha256))
        throw new AppError('GPG Agent 宿主来源与本次资源摘要不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      const body = resource ? { ...execution, environment: { ...execution.environment,
        SSH_AUTH_SOCK: sshAgentSocketPath(resource.leaseId) } } : gpgResource ? {
          ...execution, environment: { ...execution.environment, GNUPGHOME: gpgAgentHomePath(gpgResource.leaseId) },
        } : execution;
      const payload = await this.inheritedUnlocked(vmId, project, body, owner, signal, resource, gpgResource,
        options.beforeIntent || gpgResource && gpgForwarding ? async (identity, sha256) => {
          await options.beforeIntent?.({ identity: structuredClone(identity), owner: { ...owner }, sha256 });
          if (gpgResource && gpgForwarding)
            await gpgForwarding.bridge.prepareAdmission({ resource: structuredClone(gpgResource), identity,
              owner: { ...owner, kind: 'task' }, sha256 }, context.live, signal);
        } : undefined, cacheTransfer);
      const current = await this.taskContext(vmId);
      if (current.live !== context.live || current.bootId !== context.bootId)
        throw new AppError('客户机身份在任务入场期间改变，原 intent 保留', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      const entry: Entry = { version: 1, projectId: id, identity: structuredClone(payload.identity),
        owner, runId, sha256: payload.sha256, phase: 'intent', run: null,
        ...(resource ? { sshAgent: structuredClone(resource) } : {}),
        ...(gpgResource ? { gpgAgent: structuredClone(gpgResource) } : {}), ...(cacheTransfer ? { cacheTransfer } : {}) };
      const agentContext: SshAgentContext | undefined = resource ? {
        resource: structuredClone(resource), identity: payload.identity,
        owner: { ...owner, kind: 'task' }, sha256: payload.sha256 } : undefined;
      const gpgContext: GpgAgentContext | undefined = gpgResource ? {
        resource: structuredClone(gpgResource), identity: payload.identity,
        owner: { ...owner, kind: 'task' }, sha256: payload.sha256 } : undefined;
      const unbind = agentContext && forwarding ?
        bindTaskAgent(this.machines, vmId, agentContext, forwarding.agent, context.live) : undefined;
      const unbindGpg = gpgContext && gpgForwarding ?
        bindTaskGpg(this.machines, vmId, gpgContext, gpgForwarding.bridge, context.live) : undefined;
      const record: ActiveTask = { ...context, file: this.file(vmId, id), entry };
      let registry = activeTasks.get(this.machines);
      if (!registry) { registry = new Map(); activeTasks.set(this.machines, registry); }
      const key = this.taskKey(vmId, id, runId);
      registry.set(key, record);
      const executionScope = ExecutionScope.current();
      if (executionScope) {
        let recoveries = taskRecoveries.get(this.machines);
        if (!recoveries) taskRecoveries.set(this.machines, recoveries = new Map());
        recoveries.set(key, { record, recover: executionScope.recovery() });
      }
      return { payload, live: context.live, owner: { ...owner, kind: 'task' as const }, agentContext, forwarding, gpgContext, gpgForwarding,
      /**
       * 入口 / Entry: ProjectRunScopes.admitTask.release.
       * 功能：在维护项目账户运行日志及资源票据中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ProjectRunScopes`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectRunScopes`; the calls and state transitions below complete the operation. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
       * 处理：通过 `unbind`, `unbindGpg`, `registry.get`, `registry.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `unbind`, `unbindGpg`, `registry.get`, `registry.delete`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `registry.get(key) === record`; `executionScope && !executionScope.hasPendingCleanup()`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `registry.delete`; `executionScope.hasPendingCleanup`; `taskRecoveries.get().delete`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      release: () => {
        unbind?.(); unbindGpg?.();
        if (registry.get(key) === record) registry.delete(key);
        if (executionScope && !executionScope.hasPendingCleanup()) taskRecoveries.get(this.machines)?.delete(key);
      } };
    });
  }
  /**
   * 入口 / Entry: ProjectRunScopes.confirmScopeStopped.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `schema.parse(parseJson(result.stdout)).bootId` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; this entry produces `schema.parse(parseJson(result.stdout)).bootId` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `scopeName`, `this.machines.exec`, `quote`, `z.object().strict` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `scopeName`, `this.machines.exec`, `quote`, `z.object().strict`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; owner: ProjectRunOwner
   * 输出 / Returns: `schema.parse(parseJson(result.stdout)).bootId`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0 || !schema.safeParse(parseJson(result.stdout)).success`; 异常 / errors `new AppError('所属项目运行域尚未确认停止，账号票据继续保留', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
   */
  private async confirmScopeStopped(vmId: string, owner: ProjectRunOwner) {
    const source = `import json,os,stat\nname=${JSON.stringify(scopeName(owner))}\nboot=open('/proc/sys/kernel/random/boot_id').read().strip()\nmounts=open('/proc/self/mountinfo').read().splitlines()\nassert any(len(line.split())>6 and line.split()[4]=='/sys/fs/cgroup' and line.split()[3]=='/' and ' - cgroup2 ' in line for line in mounts)\npath='/sys/fs/cgroup'\ninfo=os.lstat(path)\nassert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022\nfor part in name.split('/')[:-1]:\n path+='/'+part\n if not os.path.lexists(path): break\n info=os.lstat(path)\n assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022\nassert not os.path.lexists('/sys/fs/cgroup/'+name)\nprint(json.dumps({'bootId':boot,'absent':True}))\n`;
    const result = await this.machines.exec(vmId, `env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ${quote(source)}`, 10000);
    const schema = z.object({ bootId: z.uuid(), absent: z.literal(true) }).strict();
    if (result.code !== 0 || !schema.safeParse(parseJson(result.stdout)).success)
      throw new AppError('所属项目运行域尚未确认停止，账号票据继续保留', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    return schema.parse(parseJson(result.stdout)).bootId;
  }
  /**
   * 入口 / Entry: ProjectRunScopes.closeAfterScopeStopped.
   * 功能：在维护项目账户运行日志及资源票据中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.withLock(vmId, id, () => this.closeUnlocked(vmId, id, runId))` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectRunScopes`; this entry produces `this.withLock(vmId, id, () => this.closeUnlocked(vmId, id, runId))` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `this.withLock` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `z.uuid().parse`, `z.uuid`, `this.withLock`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; runId: string
   * 输出 / Returns: `this.withLock(vmId, id, () => this.closeUnlocked(vmId, id, runId))`.
   * 副作用 / Effects: 更新 / updates `id`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async closeAfterScopeStopped(vmId: string, id: string, runId: string) {
    id = projectIdSchema.parse(id); z.uuid().parse(runId);
    return this.withLock(vmId, id, () => this.closeUnlocked(vmId, id, runId));
  }
  /**
   * 入口 / Entry: ProjectRunScopes.recoverStoppedTasks.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; the calls and state transitions below complete the operation. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `projectIdSchema.parse`, `this.withLock`, `recovery.recover`, `taskRecoveries.get().get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `this.withLock`, `recovery.recover`, `taskRecoveries.get().get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `taskRecoveries.get(this.machines)?.get(key) === recovery`.
   * 输入 / Inputs: vmId: string; id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `inline.delete`; 更新 / updates `id`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async recoverStoppedTasks(vmId: string, id: string) {
    id = projectIdSchema.parse(id);
    /**
     * 入口 / Entry: ProjectRunScopes.recoverStoppedTasks.callback@950.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withLock）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withLock).
     * 输入 / Inputs: access
     * 输出 / Returns: `selected`.
     * 副作用 / Effects: `selected.push`.
     * 拒绝 / Refusals: 条件 / conditions `recovery.record.file !== this.file(vmId, id) || entry.phase !== 'closed' || !this.taskMetadataMatches(recovery.record, normal…`; 异常 / errors `new AppError('原执行清理能力与完整运行票据不符', 503, 'EXECUTION_CLEANUP_PENDING')`.
     */
    const owned = await this.withLock(vmId, id, async access => {
      await access.recoverStoppedTasks();
      const journal = await this.read(vmId, id), selected: { key: string; recovery: TaskRecovery }[] = [];
      for (const entry of journal.runs) {
        const key = this.taskKey(vmId, id, entry.runId), recovery = taskRecoveries.get(this.machines)?.get(key);
        if (!recovery || activeTasks.get(this.machines)?.has(key)) continue;
        const expected = recovery.record.entry;
        const normalized = { ...entry, ...(entry.cacheTransfer ? { cacheTransfer: { ...entry.cacheTransfer, phase: expected.cacheTransfer?.phase } } : {}) } as Entry;
        if (recovery.record.file !== this.file(vmId, id) || entry.phase !== 'closed' ||
            !this.taskMetadataMatches(recovery.record, normalized) ||
            (expected.run && (!entry.run || !same({ ...entry.run, phase: expected.run.phase }, expected.run))))
          throw new AppError('原执行清理能力与完整运行票据不符', 503, 'EXECUTION_CLEANUP_PENDING');
        selected.push({ key, recovery });
      }
      return selected;
    });
    // Original cleanup can re-enter the identity lock through its afterCleanup callback.
    // Domain proof is obtained first; never invoke the owned closure while holding this lock.
    for (const { key, recovery } of owned) {
      await recovery.recover();
      if (taskRecoveries.get(this.machines)?.get(key) === recovery) taskRecoveries.get(this.machines)!.delete(key);
    }
  }
  /**
   * 入口 / Entry: ProjectRunScopes.recoverStoppedTasksUnlocked.
   * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectRunScopes`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; the calls and state transitions below complete the operation. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `this.read`, `journal.runs.some`, `this.taskContext`, `this.isActiveTask` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.read`, `journal.runs.some`, `this.taskContext`, `this.isActiveTask`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!context && journal.runs.some(entry => activeTasks.get(this.machines)?.has(this.taskKey(vmId, id, en…`; `entry.owner.kind === 'task' && entry.phase !== 'closed' && !this.isActiveTask(vmId, id, entry, conte…`.
   * 输入 / Inputs: vmId: string; id: string; context: TaskContext optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.closeUnlocked`; 更新 / updates `context`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async recoverStoppedTasksUnlocked(vmId: string, id: string, context?: TaskContext) {
    const journal = await this.read(vmId, id);
    if (!context && journal.runs.some(entry =>
      activeTasks.get(this.machines)?.has(this.taskKey(vmId, id, entry.runId))))
      context = await this.taskContext(vmId);
    for (const entry of journal.runs) {
      if (entry.owner.kind === 'task' && entry.phase !== 'closed' && !this.isActiveTask(vmId, id, entry, context))
        await this.closeUnlocked(vmId, id, entry.runId);
    }
  }
  /**
   * 入口 / Entry: ProjectRunScopes.closeUnlocked.
   * 功能：在维护项目账户运行日志及资源票据中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`ProjectRunScopes`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectRunScopes`; this entry produces `void` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `this.machines.live.get`, `this.read`, `journal.runs.find`, `this.archived` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.live.get`, `this.read`, `journal.runs.find`, `this.archived`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `await this.archived(vmId, id, runId)`; `entry.phase === 'closed'`; `run.phase === 'closed'`.
   * 输入 / Inputs: vmId: string; id: string; runId: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `closeAgent`; `this.save`; `this.core.stop`; 更新 / updates `entry.phase`, `entry.retirement`, `run`, `entry.run`.
   * 拒绝 / Refusals: 条件 / conditions `!entry`; `currentBoot !== entry.owner.bootId`; `await this.confirmScopeStopped(vmId, entry.owner) !== currentBoot`; 异常 / errors `new AppError('主机缺少本次账号运行记录，拒绝推断清理成功', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`; `new AppError('客户机开机身份再次改变，原账号运行核销未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
   * 失败处理：catch 分支执行 `if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_RECORD_ABSENT' || entry.run) { throw new AppError('账号运行回…`; `await unchanged();`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_RECORD_ABSENT' || entry.run) { throw new AppError('账号运行回…`; `await unchanged();`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async closeUnlocked(vmId: string, id: string, runId: string) {
      const instance = this.machines.live.get(vmId), journal = await this.read(vmId, id);
      const entry = journal.runs.find(run => run.runId === runId);
      if (!entry) {
        if (await this.archived(vmId, id, runId)) return;
        throw new AppError('主机缺少本次账号运行记录，拒绝推断清理成功', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      }
      if (entry.phase === 'closed') return;
      /**
       * 入口 / Entry: ProjectRunScopes.closeUnlocked.unchanged.
       * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectRunScopes`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectRunScopes`; the calls and state transitions below complete the operation. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
       * 处理：通过 `this.machines.live.get`, `inline.runs.find`, `this.read`, `same` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.machines.live.get`, `inline.runs.find`, `this.read`, `same`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `!instance || this.machines.live.get(vmId) !== instance`; `!same(current, entry)`; 异常 / errors `new AppError('客户机 live 实例改变，账号票据清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`; `new AppError('账号运行主机记录已变化', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
       */
      const unchanged = async () => {
        if (!instance || this.machines.live.get(vmId) !== instance)
          throw new AppError('客户机 live 实例改变，账号票据清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        const current = (await this.read(vmId, id)).runs.find(run => run.runId === runId);
        if (!same(current, entry)) throw new AppError('账号运行主机记录已变化', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      };
      await unchanged();
      const currentBoot = await this.confirmScopeStopped(vmId, entry.owner);
      await unchanged();
      /**
       * 入口 / Entry: ProjectRunScopes.closeUnlocked.closeAgent.
       * 功能：在维护项目账户运行日志及资源票据中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`ProjectRunScopes`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectRunScopes`; this entry produces `void` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
       * 处理：通过 `inline.cleanup`, `unchanged`, `this.confirmScopeStopped` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `inline.cleanup`, `unchanged`, `this.confirmScopeStopped`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `!entry.sshAgent && !entry.gpgAgent`; `entry.sshAgent`; `entry.gpgAgent`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `void`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `entry.owner.kind !== 'task'`; `await this.confirmScopeStopped(vmId, entry.owner) !== currentBoot`; 异常 / errors `new AppError('Agent 归属不是单次任务', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`; `new AppError('Agent 清理期间客户机开机身份已改变', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
       */
      const closeAgent = async () => {
        if (!entry.sshAgent && !entry.gpgAgent) return;
        if (entry.owner.kind !== 'task') throw new AppError('Agent 归属不是单次任务', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        if (entry.sshAgent) await (this.options.agentScopes || new SshAgentScopes(this.machines)).cleanup(vmId, {
          resource: entry.sshAgent, identity: entry.identity, owner: { ...entry.owner, kind: 'task' }, sha256: entry.sha256 });
        if (entry.gpgAgent) await (this.options.gpgScopes || new GpgAgentScopes(this.machines)).cleanup(vmId, {
          resource: entry.gpgAgent, identity: entry.identity, owner: { ...entry.owner, kind: 'task' }, sha256: entry.sha256 });
        await unchanged();
        if (await this.confirmScopeStopped(vmId, entry.owner) !== currentBoot)
          throw new AppError('Agent 清理期间客户机开机身份已改变', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        await unchanged();
      };
      if (currentBoot !== entry.owner.bootId) {
        if (await this.confirmScopeStopped(vmId, entry.owner) !== currentBoot)
          throw new AppError('客户机开机身份再次改变，原账号运行核销未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        await unchanged();
        await closeAgent();
        // A real reboot ended every process from the recorded boot. Keep the
        // original guest ticket unchanged rather than inventing a stop receipt
        // after its /run record disappeared. Never send an old stop to this boot.
        entry.phase = 'closed'; entry.retirement = { reason: 'guest-reboot', bootId: currentBoot };
        await this.save(vmId, id, journal); return;
      }
      let run: ProjectIdentityRun;
      try { run = await this.core.run(vmId, entry.identity, runId); }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== 'PROJECT_IDENTITY_RECORD_ABSENT' || entry.run) {
          throw new AppError('账号运行回执读取未确认，原记录继续保留', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        }
        await unchanged(); await this.confirmScopeStopped(vmId, entry.owner); await unchanged();
        await closeAgent();
        entry.phase = 'closed'; await this.save(vmId, id, journal); return;
      }
      if (!this.matches(entry, run))
        throw new AppError('账号票据的上层运行归属不符', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      // A closed native receipt cannot retire an unresolved Agent resource.
      entry.run = run; entry.phase = run.phase === 'closed' && !entry.sshAgent && !entry.gpgAgent ? 'closed' : 'active';
      await this.save(vmId, id, journal);
      this.pinActiveTask(vmId, id, entry, run);
      if (entry.phase === 'closed') return;
      // Once a complete ticket was received, an absent or changed receipt is
      // never treated as a task that did not start.
      await this.confirmScopeStopped(vmId, entry.owner); await unchanged();
      await closeAgent();
      if (run.phase === 'closed') { entry.phase = 'closed'; await this.save(vmId, id, journal); return; }
      const stopped = await this.core.stop(vmId, entry.identity, run);
      if (stopped.phase !== 'closed' || !same({ ...stopped, phase: run.phase }, run))
        throw new AppError('账号运行停止回执不属于本次票据', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      await unchanged(); entry.run = stopped; entry.phase = 'closed'; await this.save(vmId, id, journal);
  }
}
/**
 * 入口 / Entry: parseJson.
 * 功能：在维护项目账户运行日志及资源票据中，转换协议或持久数据表示并保持调用边界；本入口产生 `JSON.parse(value)` / `null` 供上层消费（`project-run-scope.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `project-run-scope.ts`; this entry produces `JSON.parse(value)` / `null` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `JSON.parse(value)`; `null`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败处理：catch 分支执行 `return null;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return null;`; these statements determine whether a failure is absorbed or rejected again.
 */
const parseJson = (value: string) => { try { return JSON.parse(value); } catch { return null; } };

/** All user code remains in the outer task domain; only that owner may authorize retirement. */
/**
 * 入口 / Entry: projectIdentityTask.
 * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `ExecutionScope.run({ machines, vmId, projectId: projectId(project), live: options.expectedLive, signal, delegate: true }, sco…` 供上层消费（`project-run-scope.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-run-scope.ts`; this entry produces `ExecutionScope.run({ machines, vmId, projectId: projectId(project), live: options.expectedLive, signal, delegate: true }, sco…` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
 * 处理：通过 `ExecutionScope.run`, `projectId` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `ExecutionScope.run`, `projectId`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Machines; vmId: string; project: Project; execution: ProjectIdentityExecution; signal: AbortSignal; log: (text: string) => void optional; timeout: default=1200000; agentPath: string optional; afterCleanup: () => Promise<void> optional; options: ProjectTaskAdmissionOptions default={}
 * 输出 / Returns: `ExecutionScope.run({ machines, vmId, projectId: projectId(project), live: options.expectedLive, signal, delegate: true }, sco…`.
 * 副作用 / Effects: `ExecutionScope.run`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function projectIdentityTask(machines: Machines, vmId: string, project: Project,
  execution: ProjectIdentityExecution, signal: AbortSignal, log?: (text: string) => void,
  timeout = 1200000, agentPath?: string, afterCleanup?: () => Promise<void>,
  options: ProjectTaskAdmissionOptions = {}) {
  return ExecutionScope.run({ machines, vmId, projectId: projectId(project), live: options.expectedLive, signal, delegate: true },
    scope => projectIdentityTaskInScope(machines, vmId, project, execution, scope.signal, log, timeout,
      agentPath, afterCleanup, options));
}

/**
 * 入口 / Entry: projectIdentityTaskInScope.
 * 功能：在维护项目账户运行日志及资源票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `executed` 供上层消费（`project-run-scope.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-run-scope.ts`; this entry produces `executed` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
 * 处理：通过 `signal.throwIfAborted`, `scopes.admitTask`, `structuredClone`, `ExecutionScope.current().deferCleanup` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `scopes.admitTask`, `structuredClone`, `ExecutionScope.current().deferCleanup`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `signal.aborted`; `!launched`; `launched`.
 * 输入 / Inputs: machines: Machines; vmId: string; project: Project; execution: ProjectIdentityExecution; signal: AbortSignal; log: ((text: string) => void) | undefined; timeout: number; agentPath: string | undefined; afterCleanup: (() => Promise<void>) | undefined; options: ProjectTaskAdmissionOptions
 * 输出 / Returns: `executed`.
 * 副作用 / Effects: `ExecutionScope.current().deferCleanup`; `ExecutionScope.current`; `scopes.closeAfterScopeStopped`; `agentScopes.install`; `gpgScopes.install`; 更新 / updates `command`, `launched`.
 * 拒绝 / Refusals: 条件 / conditions `machines.live.get(vmId) !== admission.live`; `admission.agentContext && admission.forwarding`; `admission.gpgContext && admission.gpgForwarding`; 异常 / errors `new AppError('客户机运行身份在任务启动前改变，原 intent 保留且项目代码未执行', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`; `new AppError('Agent 安装期间客户机身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
 * 收尾：退出 try 区域时始终执行 `try { if (launched) await retirePreflight(); } finally { admission.release(); }`; `admission.release();`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `try { if (launched) await retirePreflight(); } finally { admission.release(); }`; `admission.release();`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `if (!launched) await retirePreflight();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (!launched) await retirePreflight();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
async function projectIdentityTaskInScope(machines: Machines, vmId: string, project: Project,
  execution: ProjectIdentityExecution, signal: AbortSignal, log: ((text: string) => void) | undefined,
  timeout: number, agentPath: string | undefined, afterCleanup: (() => Promise<void>) | undefined,
  options: ProjectTaskAdmissionOptions) {
  signal.throwIfAborted();
  const scopes = new ProjectRunScopes(machines), admission = await scopes.admitTask(vmId, project, execution, signal, options);
  const { payload } = admission, runId = payload.runId;
  const resourceContext: ProjectTaskResourceContext = { identity: structuredClone(payload.identity),
    owner: admission.owner, sha256: payload.sha256, live: admission.live };
  let launched = false;
  /**
   * 入口 / Entry: projectIdentityTaskInScope.closeBeforeLaunch.
   * 功能：在维护项目账户运行日志及资源票据中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`project-run-scope.ts`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `project-run-scope.ts`; this entry produces `void` for its caller. Module context: Owns account run journals/resource tickets, coordinating original task, terminal, SSH and network retirement ownership.
   * 处理：通过 `machines.live.get`, `scopes.closeAfterScopeStopped`, `projectId`, `options.resource.retire` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `machines.live.get`, `scopes.closeAfterScopeStopped`, `projectId`, `options.resource.retire`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `launched`; `options.resource`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `scopes.closeAfterScopeStopped`.
   * 拒绝 / Refusals: 条件 / conditions `machines.live.get(vmId) !== admission.live`; 异常 / errors `new AppError('客户机运行身份改变，任务资源核销未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
   */
  const closeBeforeLaunch = async () => {
    if (launched) return;
    if (machines.live.get(vmId) !== admission.live)
      throw new AppError('客户机运行身份改变，任务资源核销未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    await scopes.closeAfterScopeStopped(vmId, projectId(project), runId);
    if (options.resource) {
      await options.resource.retire(resourceContext, await scopes.taskResourceReceipt(vmId, resourceContext));
      await scopes.completeTaskResource(vmId, resourceContext, options.resource.descriptor);
    }
  };
  const retirePreflight = ExecutionScope.current()?.deferCleanup(closeBeforeLaunch) || closeBeforeLaunch;
  try {
    await options.resource?.prepare(resourceContext);
    if (machines.live.get(vmId) !== admission.live)
      throw new AppError('客户机运行身份在任务启动前改变，原 intent 保留且项目代码未执行', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    if (signal.aborted) {
      await scopes.closeAfterScopeStopped(vmId, projectId(project), runId);
      signal.throwIfAborted();
    }
    let command = payload.command;
    if (admission.agentContext && admission.forwarding) {
      const agentScopes = admission.forwarding.scopes || new SshAgentScopes(machines);
      await agentScopes.install(vmId, admission.agentContext.resource, signal);
      if (machines.live.get(vmId) !== admission.live)
        throw new AppError('Agent 安装期间客户机身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      command = agentScopes.command('run', admission.agentContext, payload.command);
    }
    if (admission.gpgContext && admission.gpgForwarding) {
      const gpgScopes = admission.gpgForwarding.scopes || new GpgAgentScopes(machines);
      await gpgScopes.install(vmId, admission.gpgContext.resource, signal);
      const prepared = await gpgScopes.prepare(vmId, admission.gpgContext, signal);
      if (machines.live.get(vmId) !== admission.live)
        throw new AppError('GPG 准备期间客户机身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      await admission.gpgForwarding.bridge.start(machines, vmId, admission.gpgContext, prepared.sourcePath, signal);
      if (machines.live.get(vmId) !== admission.live)
        throw new AppError('GPG 转发准备期间客户机身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      command = gpgScopes.command('run', admission.gpgContext, payload.command);
    }
    launched = true;
    const executed = await guestTask(machines, vmId, command, signal, log, timeout,
      admission.forwarding?.agent || agentPath, async () => {
      await scopes.closeAfterScopeStopped(vmId, projectId(project), runId);
      if (options.resource) {
        await options.resource.retire(resourceContext, await scopes.taskResourceReceipt(vmId, resourceContext));
        await scopes.completeTaskResource(vmId, resourceContext, options.resource.descriptor);
      }
      await afterCleanup?.();
    }, { input: payload.input, runId, ...(admission.agentContext ? { forwardedAgent: true } : {}) });
    await scopes.assertTaskIssued(vmId, projectId(project), runId, executed);
    return executed;
  } catch (error) {
    if (!launched) await retirePreflight();
    throw error;
  } finally {
    try { if (launched) await retirePreflight(); }
    finally { admission.release(); }
  }
}
