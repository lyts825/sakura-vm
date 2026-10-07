/**
 * 模块职责：管理临时隧道会话与停止，原运行归属不足时保留旧票据而不接管未知进程。
 * Module purpose: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { networkFor } from './network/index.ts';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Server, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual as same } from 'node:util';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectPrivateValues } from './workspaces.ts';
import { projectVersion, type Project } from './project-config.ts';
import { projectIdSchema } from './project-catalog.ts';
import { writeStore } from './local-store.ts';
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
  ProjectReverseTunnelScope,
  projectReverseTunnelRecordSchema,
  type ProjectReverseTunnelRecord,
} from './project-service-scope.ts';
import {
  reverseTunnelBrokerCommand,
  reverseTunnelListenerCommand,
  reverseTunnelListenerSchema,
  openReverseTunnelBridge,
  type ReverseTunnelListener,
} from './reverse-tunnel-transport.ts';
import { redactValues } from './secrets.ts';

const { createServer } = networkFor('core:reverse-tunnels');

const digest = z.string().regex(/^[a-f0-9]{64}$/);
/**
 * 入口 / Entry: changed.
 * 功能：从当前输入或状态计算 `new AppError('原临时隧道项目、账号、boot、完整运行域或监听归属无法核对', 409, 'SERVICE_SCOPE_CHANGED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('原临时隧道项目、账号、boot、完整运行域或监听归属无法核对', 409, 'SERVICE_SCOPE_CHANGED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('原临时隧道项目、账号、boot、完整运行域或监听归属无法核对', 409, 'SERVICE_SCOPE_CHANGED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const changed = () => new AppError('原临时隧道项目、账号、boot、完整运行域或监听归属无法核对', 409, 'SERVICE_SCOPE_CHANGED');
/**
 * 入口 / Entry: legacy.
 * 功能：从当前输入或状态计算 `new AppError('临时隧道缺少完整项目账号票据；请管理员核查原 root/未知进程及全部后代，原记录保留，未自动接管', 409, 'PROJECT_IDENTITY_REQUIRED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('临时隧道缺少完整项目账号票据；请管理员核查原 root/未知进程及全部后代，原记录保留，未自动接管', 409, 'PROJECT_IDENTITY_REQUIRED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('临时隧道缺少完整项目账号票据；请管理员核查原 root/未知进程及全部后代，原记录保留，未自动接管', 409, 'PROJECT_IDENTITY_REQUIRED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const legacy = () => new AppError('临时隧道缺少完整项目账号票据；请管理员核查原 root/未知进程及全部后代，原记录保留，未自动接管', 409, 'PROJECT_IDENTITY_REQUIRED');
/**
 * 入口 / Entry: matches.
 * 功能：从当前输入或状态计算 `run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId && run.registryId === identi…`，供调用方后续验证或使用。
 * Purpose: Computes `run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId && run.registryId === identi…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: run: ProjectIdentityRun; identity: ProjectIdentity; record: ProjectReverseTunnelRecord
 * 输出 / Returns: `run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId && run.registryId === identi…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function matches(run: ProjectIdentityRun, identity: ProjectIdentity, record: ProjectReverseTunnelRecord) {
  return run.phase === 'active' && run.mode === 'inherit-current' && run.projectId === identity.projectId &&
    run.registryId === identity.registryId && run.identityId === identity.identityId && run.revision === identity.revision &&
    run.runId === record.runId && run.bootId === record.bootId && run.cgroupName === record.scopeName &&
    record.inode !== null && run.cgroupInode === record.inode &&
    run.namespace === (identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : '');
}
export const reverseTunnelSessionSchema = z.object({ id: z.uuid(), vmId: z.uuid(), projectId: projectIdSchema,
  directory: z.string().min(1).max(4096), networkIsolation: z.enum(['host', 'private']),
  guestPort: z.number().int().min(1).max(65535), localPort: z.number().int().min(0).max(65535),
  startedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), phase: z.enum(['starting', 'running', 'stopping', 'review']),
  configSha256: digest.optional(), token: digest.optional(), listener: reverseTunnelListenerSchema.optional(),
  execution: z.object({ identity: projectIdentitySchema, record: projectReverseTunnelRecordSchema,
    run: projectIdentityRunSchema.nullable(), sha256: digest }).strict().optional(),
}).strict().superRefine((session, context) => {
  const value = session.execution;
  if (value && (!session.token || !session.configSha256 || value.identity.phase !== 'active' ||
      value.identity.projectId !== session.projectId || value.identity.directory !== session.directory ||
      value.identity.networkIsolation !== session.networkIsolation || value.record.projectId !== session.projectId ||
      value.run && !matches(value.run, value.identity, value.record) ||
      session.phase === 'running' && (!value.run || value.record.phase !== 'running' || !session.listener || session.localPort < 1024)))
    context.addIssue({ code: 'custom', message: '临时隧道完整项目运行归属缺失' });
});
type Session = z.infer<typeof reverseTunnelSessionSchema>;
const storeSchema = z.object({ version: z.literal(1), sessions: z.array(reverseTunnelSessionSchema).max(128) }).strict()
  .refine(value => new Set(value.sessions.map(row => `${row.vmId}:${row.projectId}`)).size === value.sessions.length,
    '临时隧道项目归属重复');
type Preparation = Pick<ProjectTerminals, 'prepare' | 'close'>;
type Lease = Awaited<ReturnType<ProjectTerminals['prepare']>>;
type Scope = Pick<ProjectReverseTunnelScope, 'status' | 'newIntent' | 'persistIntent' | 'start' | 'stop' | 'expiresAt'>;
export type ReverseTunnelOptions = {
  file?: string;
  /**
   * 签名 / Signature: ReverseTunnelOptions.createPreparation.
   * 功能：为管理临时隧道会话与停止声明 createPreparation 的输入与结果契约，所属容器为 ReverseTunnelOptions。
   * Purpose: Declares the input/result contract for createPreparation in ReverseTunnelOptions. Module responsibility: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Preparation.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  createPreparation?: () => Preparation; runTask?: typeof projectIdentityTask;
  scopes?: Pick<ProjectRunScopes, 'identity' | 'inherited' | 'active' | 'readonlyActive'>;
  identities?: Pick<ProjectIdentities, 'runReadonly'>;
  /**
   * 签名 / Signature: ReverseTunnelOptions.processScope.
   * 功能：为管理临时隧道会话与停止声明 processScope 的输入与结果契约，所属容器为 ReverseTunnelOptions。
   * Purpose: Declares the input/result contract for processScope in ReverseTunnelOptions. Module responsibility: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 输入 / Inputs: id: string; project: Project; durationSeconds: number optional
   * 输出 / Returns: Scope.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  processScope?: (id: string, project: Project, durationSeconds?: number) => Scope;
  /**
   * 签名 / Signature: ReverseTunnelOptions.listener.
   * 功能：为管理临时隧道会话与停止声明 listener 的输入与结果契约，所属容器为 ReverseTunnelOptions。
   * Purpose: Declares the input/result contract for listener in ReverseTunnelOptions. Module responsibility: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 输入 / Inputs: identity: ProjectIdentity; run: ProjectIdentityRun; signal: AbortSignal optional
   * 输出 / Returns: Promise<ReverseTunnelListener | null>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  listener?: (identity: ProjectIdentity, run: ProjectIdentityRun, signal?: AbortSignal) => Promise<ReverseTunnelListener | null>;
  bridge?: typeof openReverseTunnelBridge;
};
type Capture = { vmId: string; projectId: string; project: Project; version: string;
  live: NonNullable<ReturnType<Machines['live']['get']>>; preparation: Preparation; lease: Lease; signal: AbortSignal };
type Tunnel = { session: Session; instance: unknown; capture: Capture; server: Server;
  sockets: Set<Socket>; channels: Set<Duplex>; timer?: ReturnType<typeof setTimeout>; revoked: boolean };
type Opening = { vmId: string; instance: unknown; abort: AbortController; pending: Promise<unknown> };
const probeCommand = '/usr/bin/python3 -I -S -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)"';
/**
 * 入口 / Entry: keyOf.
 * 功能：从当前输入或状态计算 ``${row.vmId}:${row.projectId}``，供调用方后续验证或使用。
 * Purpose: Computes ``${row.vmId}:${row.projectId}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: row: Pick<Session, 'vmId' | 'projectId'>
 * 输出 / Returns: ``${row.vmId}:${row.projectId}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const keyOf = (row: Pick<Session, 'vmId' | 'projectId'>) => `${row.vmId}:${row.projectId}`;
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
 * 输入 / Inputs: row: Session
 * 输出 / Returns: Project；结果来自 / values from `copy({ directory: row.directory, template: 'none', repository: '', setup: '', command: '', networkIsolation: row.networkIsola…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function binding(row: Session): Project {
  return copy({ directory: row.directory, template: 'none', repository: '', setup: '', command: '',
    networkIsolation: row.networkIsolation }, row.projectId);
}
/**
 * 入口 / Entry: cleanup.
 * 功能：在管理临时隧道会话与停止中，结束、撤销或清理本次拥有的领域资源；本入口产生 `errors[0]` / `Object.assign(new AppError('临时隧道完整清理尚未确认，已保留原运行记录', 503, critical instanceof AppError ? critical.code : 'PROJECT_IDENTITY_CLE…` 供上层消费（`reverse-tunnels.ts`）。
 * Purpose: Ends, revokes or cleans resources owned by this domain action in `reverse-tunnels.ts`; this entry produces `errors[0]` / `Object.assign(new AppError('临时隧道完整清理尚未确认，已保留原运行记录', 503, critical instanceof AppError ? critical.code : 'PROJECT_IDENTITY_CLE…` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
 * 处理：通过 `errors.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `errors.find`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `errors.length === 1 && errors[0] instanceof AppError && errors[0].status === 503`.
 * 输入 / Inputs: errors: unknown[]
 * 输出 / Returns: `errors[0]`; `Object.assign(new AppError('临时隧道完整清理尚未确认，已保留原运行记录', 503, critical instanceof AppError ? critical.code : 'PROJECT_IDENTITY_CLE…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function cleanup(errors: unknown[]) {
  if (errors.length === 1 && errors[0] instanceof AppError && errors[0].status === 503) return errors[0];
  const critical = errors.find(error => error instanceof AppError && error.status === 503);
  return Object.assign(new AppError('临时隧道完整清理尚未确认，已保留原运行记录', 503,
    critical instanceof AppError ? critical.code : 'PROJECT_IDENTITY_CLEANUP_FAILED'), { errors, cause: critical || errors[0] });
}

export class ReverseTunnels {
  private tunnels = new Map<string, Tunnel>();
  private pendingCaptures = new Map<string, Capture>();
  private stopping = new Map<string, Promise<boolean>>();
  private opening = new Map<string, Opening>();
  private checks = new Set<Promise<unknown>>();
  private controller = new AbortController();
  private closed = false;
  private closing?: Promise<void>;
  /**
   * 签名 / Signature: ReverseTunnels.unguard.
   * 功能：为管理临时隧道会话与停止声明 unguard 的输入与结果契约，所属容器为 ReverseTunnels。
   * Purpose: Declares the input/result contract for unguard in ReverseTunnels. Module responsibility: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private unguard: () => void;
  private records: Session[];
  private writes: Promise<unknown> = Promise.resolve();
  private file: string;
  private scopes: NonNullable<ReverseTunnelOptions['scopes']>;
  private identities: NonNullable<ReverseTunnelOptions['identities']>;
  /**
   * 入口 / Entry: ReverseTunnels.key.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``${id}:${projectIdSchema.parse(this.workspaces.projects.current(id))}`` 供上层消费（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; this entry produces ``${id}:${projectIdSchema.parse(this.workspaces.projects.current(id))}`` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `projectIdSchema.parse`, `this.workspaces.projects.current` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `this.workspaces.projects.current`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: ``${id}:${projectIdSchema.parse(this.workspaces.projects.current(id))}``.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private key(id: string) { return `${id}:${projectIdSchema.parse(this.workspaces.projects.current(id))}`; }
  /**
   * 入口 / Entry: ReverseTunnels.isRunning.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.state(id) === 'running'` / `false` 供上层消费（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; this entry produces `this.machines.state(id) === 'running'` / `false` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.state`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.machines.state(id) === 'running'`; `false`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return false;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private isRunning(id: string) { try { return this.machines.state(id) === 'running'; } catch { return false; } }
  /**
   * 入口 / Entry: ReverseTunnels.row.
   * 功能：把本层请求转交 `this.records.find`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.records.find` and propagates the provider result or rejection.
   * 输入 / Inputs: key: string
   * 输出 / Returns: `this.records.find(row => keyOf(row) === key)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private row(key: string) { return this.records.find(row => keyOf(row) === key); }
  /**
   * 入口 / Entry: ReverseTunnels.current.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `same(this.row(keyOf(row)), row)` 供上层消费（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; this entry produces `same(this.row(keyOf(row)), row)` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `same`, `this.row`, `keyOf` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `same`, `this.row`, `keyOf`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: row: Session
   * 输出 / Returns: `same(this.row(keyOf(row)), row)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private current(row: Session) { return same(this.row(keyOf(row)), row); }
  /**
   * 入口 / Entry: ReverseTunnels.owner.
   * 功能：从当前输入或状态计算 `'reverse-tunnel:' + row.id`，供调用方后续验证或使用。
   * Purpose: Computes `'reverse-tunnel:' + row.id` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: row: Session
   * 输出 / Returns: `'reverse-tunnel:' + row.id`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private owner(row: Session) { return 'reverse-tunnel:' + row.id; }
  /**
   * 入口 / Entry: ReverseTunnels.process.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.options.processScope?.(row.vmId, binding(row), duration) || new ProjectReverseTunnelScope(this.machines, row.vmId, bindi…` 供上层消费（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; this entry produces `this.options.processScope?.(row.vmId, binding(row), duration) || new ProjectReverseTunnelScope(this.machines, row.vmId, bindi…` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.options.processScope`, `binding` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.options.processScope`, `binding`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: row: Session; duration: number optional
   * 输出 / Returns: `this.options.processScope?.(row.vmId, binding(row), duration) || new ProjectReverseTunnelScope(this.machines, row.vmId, bindi…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private process(row: Session, duration?: number) {
    return this.options.processScope?.(row.vmId, binding(row), duration) ||
      new ProjectReverseTunnelScope(this.machines, row.vmId, binding(row), duration);
  }
  /**
   * 入口 / Entry: ReverseTunnels.save.
   * 功能：在管理临时隧道会话与停止中，校验并提交领域状态变更；本入口产生 `pending` 供上层消费（`ReverseTunnels`）。
   * Purpose: Validates and commits a domain state change in `ReverseTunnels`; this entry produces `pending` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.writes.then`, `pending.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.then`, `pending.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: change: (rows: Session[]) => void
   * 输出 / Returns: `pending`.
   * 副作用 / Effects: `this.writes.then`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private save(change: (rows: Session[]) => void) {
    /**
     * 入口 / Entry: ReverseTunnels.save.callback@135.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.writes.then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.writes.then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.records`.
     * 拒绝 / Refusals: 条件 / conditions `!same(await this.disk(), this.records)`; 异常 / errors `changed()`.
     */
    const pending = this.writes.then(async () => {
      if (!same(await this.disk(), this.records)) throw changed();
      const rows = structuredClone(this.records); change(rows);
      const state = storeSchema.parse({ version: 1, sessions: rows }); await writeStore(this.file, state);
      this.records = state.sessions;
    });
    this.writes = pending.catch(() => {}); return pending;
  }
  /**
   * 入口 / Entry: ReverseTunnels.disk.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `storeSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))).sessions` / `[]` 供上层消费（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; this entry produces `storeSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))).sessions` / `[]` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `storeSchema.parse`, `readFile`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `storeSchema.parse`, `readFile`, `changed`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `(error as NodeJS.ErrnoException).code === 'ENOENT'`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `storeSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))).sessions`; `[]`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `changed()`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];`; `throw changed();`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];`; `throw changed();`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async disk() {
    try { return storeSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))).sessions; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw changed(); }
  }
  /**
   * 入口 / Entry: ReverseTunnels.durable.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; the calls and state transitions below complete the operation. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.current`, `same`, `this.disk`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.current`, `same`, `this.disk`, `changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: row: Session
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.current(row) || !same(await this.disk(), this.records)`; 异常 / errors `changed()`.
   */
  private async durable(row: Session) {
    await this.writes;
    if (!this.current(row) || !same(await this.disk(), this.records)) throw changed();
  }
  /**
   * 入口 / Entry: ReverseTunnels.update.
   * 功能：在管理临时隧道会话与停止中，校验并提交领域状态变更；本入口产生 `next` 供上层消费（`ReverseTunnels`）。
   * Purpose: Validates and commits a domain state change in `ReverseTunnels`; this entry produces `next` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.save`, `this.row`, `keyOf`, `this.tunnels.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.save`, `this.row`, `keyOf`, `this.tunnels.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `tunnel`.
   * 输入 / Inputs: row: Session; change: (value: Session) => void
   * 输出 / Returns: `next`.
   * 副作用 / Effects: `this.save`; 更新 / updates `tunnel.session`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async update(row: Session, change: (value: Session) => void) {
    await this.save(rows => { const found = rows.find(value => value.id === row.id);
      if (!found || !same(found, row)) throw changed(); change(found); });
    const next = this.row(keyOf(row))!; const tunnel = this.tunnels.get(keyOf(row)); if (tunnel) tunnel.session = next;
    return next;
  }
  /**
   * 入口 / Entry: ReverseTunnels.schedule.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; this entry produces `void` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.tunnels.get`, `keyOf`, `clearTimeout`, `setTimeout` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.tunnels.get`, `keyOf`, `clearTimeout`, `setTimeout`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!tunnel`; `tunnel.timer`.
   * 输入 / Inputs: row: Session; retry: default=false
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `clearTimeout`; `setTimeout`; 更新 / updates `tunnel.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private schedule(row: Session, retry = false) {
    const tunnel = this.tunnels.get(keyOf(row)); if (!tunnel) return;
    if (tunnel.timer) clearTimeout(tunnel.timer);
    tunnel.timer = setTimeout(() => void this.stopKey(keyOf(row)).catch(() => this.schedule(tunnel.session, true)),
      retry ? 5000 : Math.max(0, Date.parse(row.expiresAt) - Date.now())); tunnel.timer.unref();
  }
  /**
   * 入口 / Entry: ReverseTunnels.automatic.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; the calls and state transitions below complete the operation. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.stopKey().catch`, `this.stopKey` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.stopKey().catch`, `this.stopKey`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: key: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.stopKey().catch`; `this.stopKey`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private automatic(key: string) { void this.stopKey(key).catch(() => { const row = this.row(key); if (row) this.schedule(row, true); }); }
  /**
   * 入口 / Entry: ReverseTunnels.changed.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; the calls and state transitions below complete the operation. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.isRunning`, `this.machines.live.get`, `this.automatic`, `this.opening.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.isRunning`, `this.machines.live.get`, `this.automatic`, `this.opening.values`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.isRunning(tunnel.session.vmId) || this.machines.live.get(tunnel.session.vmId) !== tunnel.insta…`; `!this.isRunning(opening.vmId) || this.machines.live.get(opening.vmId) !== opening.instance`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `opening.abort.abort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private readonly changed = () => {
    for (const [key, tunnel] of this.tunnels) if (!this.isRunning(tunnel.session.vmId) ||
        this.machines.live.get(tunnel.session.vmId) !== tunnel.instance) this.automatic(key);
    for (const opening of this.opening.values()) if (!this.isRunning(opening.vmId) ||
        this.machines.live.get(opening.vmId) !== opening.instance) opening.abort.abort();
  };
  /**
   * 入口 / Entry: ReverseTunnels.locked.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; the calls and state transitions below complete the operation. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.automatic`, `this.opening.values`, `opening.abort.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.automatic`, `this.opening.values`, `opening.abort.abort`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `tunnel.session.vmId === id`; `opening.vmId === id`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `opening.abort.abort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private readonly locked = (id: string) => {
    for (const [key, tunnel] of this.tunnels) if (tunnel.session.vmId === id) this.automatic(key);
    for (const opening of this.opening.values()) if (opening.vmId === id) opening.abort.abort();
  };
  /**
   * 入口 / Entry: ReverseTunnels.constructor.
   * 功能：建立 ReverseTunnels 的管理临时隧道会话与停止上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ReverseTunnels context for this module's responsibility: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; options: ReverseTunnelOptions default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.file`, `this.records`, `this.scopes`, `this.identities`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('临时隧道主机记录无法核对，原文件保留', 409, 'SERVICE_SCOPE_CHANGED')`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.records = []; else throw new AppError('临时隧道主机记录无法核对，原文件保留', 409,…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.records = []; else throw new AppError('临时隧道主机记录无法核对，原文件保留', 409,…`; these statements determine whether a failure is absorbed or rejected again.
   */
  constructor(private machines: Machines, private workspaces: WorkspacesV1, private options: ReverseTunnelOptions = {}) {
    this.file = options.file || join(DATA, 'reverse-tunnels.json');
    try { this.records = storeSchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))).sessions; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.records = [];
      else throw new AppError('临时隧道主机记录无法核对，原文件保留', 409, 'SERVICE_SCOPE_CHANGED'); }
    this.scopes = options.scopes || new ProjectRunScopes(machines);
    this.identities = options.identities || new ProjectIdentities(machines);
    machines.on('change', this.changed); machines.on('incident-lockdown', this.locked);
    this.unguard = workspaces.beforeConfigChange(async (id, previous, next) => {
      if (previous.directory === next.directory && (previous.networkIsolation || 'host') === (next.networkIsolation || 'host')) return;
      const key = `${id}:${previous._workspace || 'default'}`;
      if (this.row(key) || this.opening.has(key) || this.stopping.has(key))
        throw new AppError('请先关闭此项目的临时隧道，再修改目录或网络模式', 409);
    });
  }
  /**
   * 入口 / Entry: ReverseTunnels.assertCapture.
   * 功能：在管理临时隧道会话与停止中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`ReverseTunnels`）。
   * Purpose: Checks admission, input or resource ownership in `ReverseTunnels`; the calls and state transitions below complete the operation. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `origin`, `this.workspaces.config`, `projectVersion`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `origin`, `this.workspaces.config`, `projectVersion`, `changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: value: Capture
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `(current._workspace || 'default') !== value.projectId || projectVersion(current) !== value.version || projectVersion(value.pr…`; 异常 / errors `changed()`.
   */
  private async assertCapture(value: Capture) {
    /**
     * 入口 / Entry: ReverseTunnels.assertCapture.origin.
     * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ReverseTunnels`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; the calls and state transitions below complete the operation. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
     * 处理：通过 `value.signal.throwIfAborted`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.isRunning` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `value.signal.throwIfAborted`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.isRunning`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.closed || this.workspaces.projects.current(value.vmId) !== value.projectId || this.machines.live.get(value.vmId) !== val…`; 异常 / errors `changed()`.
     */
    const origin = () => { value.signal.throwIfAborted();
      if (this.closed || this.workspaces.projects.current(value.vmId) !== value.projectId ||
          this.machines.live.get(value.vmId) !== value.live || !this.isRunning(value.vmId)) throw changed(); };
    origin(); const current = await this.workspaces.config(value.vmId); origin();
    if ((current._workspace || 'default') !== value.projectId || projectVersion(current) !== value.version ||
        projectVersion(value.project) !== value.version) throw changed();
  }
  /**
   * 入口 / Entry: ReverseTunnels.release.
   * 功能：在管理临时隧道会话与停止中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ReverseTunnels`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ReverseTunnels`; the calls and state transitions below complete the operation. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `value.lease.release`, `errors.push`, `value.preparation.close`, `cleanup` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `value.lease.release`, `errors.push`, `value.preparation.close`, `cleanup`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: value: Pick<Capture, 'preparation' | 'lease'>; failure: unknown optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `value.lease.release`; `errors.push`; `value.preparation.close`.
   * 拒绝 / Refusals: 条件 / conditions `errors.length`; 异常 / errors `cleanup([...(failure ? [failure] : []), ...errors])`.
   * 失败处理：catch 分支执行 `errors.push(error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `errors.push(error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async release(value: Pick<Capture, 'preparation' | 'lease'>, failure?: unknown) {
    const errors: unknown[] = [];
    try { await value.lease.release(); } catch (error) { errors.push(error); }
    try { await value.preparation.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw cleanup([...(failure ? [failure] : []), ...errors]);
  }
  /**
   * 入口 / Entry: ReverseTunnels.capture.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `captured` 供上层消费（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; this entry produces `captured` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `signal.throwIfAborted`, `this.machines.live.get`, `this.isRunning`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.machines.live.get`, `this.isRunning`, `changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; projectId: string; live: Capture['live']; signal: AbortSignal; verifyOnly: default=false
   * 输出 / Returns: Promise<Capture>；结果来自 / values from `captured`.
   * 副作用 / Effects: `this.options.createPreparation`; `AbortSignal.any`; `lease.release`; `errors.push`; `preparation.close`; 更新 / updates `lease`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed || !live || this.machines.live.get(id) !== live || !this.isRunning(id)`; `this.closed || this.workspaces.projects.current(id) !== projectId || this.machines.live.get(id) !== live || !this.isRunning(i…`; `!lease.captured || !lease.signal || lease.projectId !== projectId || lease.captured.live !== live || (lease.captured.project.…`; 异常 / errors `changed()`; `errors.length > 1 ? cleanup(errors) : error`.
   * 失败处理：catch 分支执行 `const errors = [error];`; `try { await lease?.release(); } catch (error) { errors.push(error); }`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `const errors = [error];`; `try { await lease?.release(); } catch (error) { errors.push(error); }`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async capture(id: string, projectId: string, live: Capture['live'], signal: AbortSignal,
    verifyOnly = false): Promise<Capture> {
    signal.throwIfAborted(); if (this.closed || !live || this.machines.live.get(id) !== live || !this.isRunning(id)) throw changed();
    const original = await this.workspaces.config(id);
    signal.throwIfAborted();
    if (this.closed || this.workspaces.projects.current(id) !== projectId || this.machines.live.get(id) !== live ||
        !this.isRunning(id) || (original._workspace || 'default') !== projectId) throw changed();
    const project = copy(original, projectId), version = projectVersion(project);
    const preparation = this.options.createPreparation?.() || projectTerminalsFor(this.machines, this.workspaces);
    let lease: Lease | undefined;
    try {
      lease = await preparation.prepare(id, projectId, null, false, signal, undefined,
        { mode: 'task', ...(verifyOnly ? { verifyOnly: true } : {}) });
      if (!lease.captured || !lease.signal || lease.projectId !== projectId || lease.captured.live !== live ||
          (lease.captured.project._workspace || 'default') !== projectId || lease.captured.configVersion !== version ||
          projectVersion(lease.captured.project) !== version) throw changed();
      const captured: Capture = { vmId: id, projectId, project, version, live, preparation, lease,
        signal: AbortSignal.any([signal, lease.signal]) };
      await this.assertCapture(captured); return captured;
    } catch (error) {
      const errors = [error]; try { await lease?.release(); } catch (error) { errors.push(error); }
      try { await preparation.close(); } catch (error) { errors.push(error); }
      throw errors.length > 1 ? cleanup(errors) : error;
    }
  }
  /**
   * 入口 / Entry: ReverseTunnels.probe.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ project: resolved, ready: result.code === 0 }` 供上层消费（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; this entry produces `{ project: resolved, ready: result.code === 0 }` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.workspaces.resolveProject`, `copy`, `this.assertCapture`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.resolveProject`, `copy`, `this.assertCapture`, `changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: capture: Capture; requireReady: default=true
   * 输出 / Returns: `{ project: resolved, ready: result.code === 0 }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `(resolved._workspace || 'default') !== capture.projectId || resolved.directory !== capture.project.directory || (resolved.net…`; `!result || !Number.isInteger(result.code) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || Buffer…`; `requireReady && result.code !== 0`; 异常 / errors `changed()`; `new AppError('临时隧道探测环境超过受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID')`.
   * 失败处理：catch 分支执行 `throw new AppError('临时隧道探测环境超过受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('临时隧道探测环境超过受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID');`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async probe(capture: Capture, requireReady = true) {
    const resolved = await this.workspaces.resolveProject(capture.vmId, copy(capture.project)); await this.assertCapture(capture);
    if ((resolved._workspace || 'default') !== capture.projectId || resolved.directory !== capture.project.directory ||
        (resolved.networkIsolation || 'host') !== (capture.project.networkIsolation || 'host')) throw changed();
    const execution = { command: probeCommand, environment: resolved.environment };
    try { projectIdentityPayload(execution); }
    catch { throw new AppError('临时隧道探测环境超过受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID'); }
    const result = await (this.options.runTask || projectIdentityTask)(this.machines, capture.vmId, capture.project, execution,
      capture.signal, undefined, 10000, undefined, undefined, { expectedLive: capture.live });
    await this.assertCapture(capture);
    if (!result || !Number.isInteger(result.code) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' ||
        Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1024 * 1024)
      throw new AppError('项目 Python 探测结果无法核对', 409, 'PROJECT_IDENTITY_RESULT_INVALID');
    if (requireReady && result.code !== 0)
      throw new AppError(redactValues(result.stderr || '项目 Python 或网络空间未就绪', projectPrivateValues(resolved)), 409);
    return { project: resolved, ready: result.code === 0 };
  }
  /**
   * 入口 / Entry: ReverseTunnels.check.
   * 功能：在管理临时隧道会话与停止中，核对调用资格、输入或资源归属；本入口产生 `{ ready: false, executed: false, reason: '请先启动发行版。', ...this.status(id) }` / `await operation` 供上层消费（`ReverseTunnels`）。
   * Purpose: Checks admission, input or resource ownership in `ReverseTunnels`; this entry produces `{ ready: false, executed: false, reason: '请先启动发行版。', ...this.status(id) }` / `await operation` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `projectIdSchema.parse`, `this.workspaces.projects.current`, `this.machines.live.get`, `AbortSignal.any` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `this.workspaces.projects.current`, `this.machines.live.get`, `AbortSignal.any`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.isRunning(id) || !live`.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `{ ready: false, executed: false, reason: '请先启动发行版。', ...this.status(id) }`; `await operation`.
   * 副作用 / Effects: `AbortSignal.any`; `this.checks.add`; `this.checks.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `this.checks.delete(operation);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.checks.delete(operation);`; these steps also apply to exceptional exits.
   */
  async check(id: string, signal?: AbortSignal) {
    const projectId = projectIdSchema.parse(this.workspaces.projects.current(id)), key = `${id}:${projectId}`, live = this.machines.live.get(id);
    const active = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]); active.throwIfAborted();
    if (!this.isRunning(id) || !live) return { ready: false, executed: false, reason: '请先启动发行版。', ...this.status(id) };
    /**
     * 入口 / Entry: ReverseTunnels.check.callback@250.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.workspaces.projects.inScope）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.workspaces.projects.inScope).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ ready: true, executed: false, reason: '原临时隧道已确认停止。', ...this.status(id) }`; `{ ready: true, executed: false, reason: '原项目 UID broker 与回环入口已核对。', ...this.status(id) }`; `{ ready, executed: false, reason: ready ? '项目 Python 3.9+ 与网络空间已就绪，可创建限时本机 TCP 入口。' : '客户机需要 Python 3.9+，私有项目还需要有效的网络命名空间。', …`.
     * 副作用 / Effects: `this.stopKey`; `this.release`; 更新 / updates `failure`.
     * 拒绝 / Refusals: 条件 / conditions `row`; `!row.execution`; 异常 / errors `legacy()`; `error`.
     * 收尾：退出 try 区域时始终执行 `await this.release(capture, failure);`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `await this.release(capture, failure);`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `failure = error;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `failure = error;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    const operation = this.workspaces.projects.inScope(id, projectId, async () => {
      const row = this.row(key);
      if (row) {
        if (!row.execution) throw legacy();
        if (row.phase !== 'running' || Date.now() >= Date.parse(row.expiresAt)) {
          await this.stopKey(key); return { ready: true, executed: false, reason: '原临时隧道已确认停止。', ...this.status(id) };
        }
        if (!this.tunnels.has(key)) await this.restore(row, live, active);
        else await this.prove(row, live, active);
        return { ready: true, executed: false, reason: '原项目 UID broker 与回环入口已核对。', ...this.status(id) };
      }
      const capture = await this.capture(id, projectId, live, active); let failure: unknown;
      try { const { ready } = await this.probe(capture, false); return { ready, executed: false,
        reason: ready ? '项目 Python 3.9+ 与网络空间已就绪，可创建限时本机 TCP 入口。' :
          '客户机需要 Python 3.9+，私有项目还需要有效的网络命名空间。', ...this.status(id) }; }
      catch (error) { failure = error; throw error; }
      finally { await this.release(capture, failure); }
    });
    this.checks.add(operation); try { return await operation; } finally { this.checks.delete(operation); }
  }
  /**
   * 入口 / Entry: ReverseTunnels.describe.
   * 功能：从当前输入或状态计算 `{ active: true as const, host: '127.0.0.1', localPort: row.localPort, guestPort: row.guestPort, expiresAt: row.expiresAt, pro…`，供调用方后续验证或使用。
   * Purpose: Computes `{ active: true as const, host: '127.0.0.1', localPort: row.localPort, guestPort: row.guestPort, expiresAt: row.expiresAt, pro…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: tunnel: Tunnel
   * 输出 / Returns: `{ active: true as const, host: '127.0.0.1', localPort: row.localPort, guestPort: row.guestPort, expiresAt: row.expiresAt, pro…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private describe(tunnel: Tunnel) { const row = tunnel.session;
    return { active: true as const, host: '127.0.0.1', localPort: row.localPort, guestPort: row.guestPort,
      expiresAt: row.expiresAt, projectId: row.projectId, directory: row.directory,
      networkIsolation: row.networkIsolation, connections: tunnel.sockets.size }; }
  /**
   * 入口 / Entry: ReverseTunnels.status.
   * 功能：在管理临时隧道会话与停止中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ active: false as const }` / `tunnel && !tunnel.revoked && tunnel.session.phase === 'running' && this.current(tunnel.session) && this.isRunning(id) && this…` 供上层消费（`ReverseTunnels`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ReverseTunnels`; this entry produces `{ active: false as const }` / `tunnel && !tunnel.revoked && tunnel.session.phase === 'running' && this.current(tunnel.session) && this.isRunning(id) && this…` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.tunnels.get`, `this.key`, `same`, `storeSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.tunnels.get`, `this.key`, `same`, `storeSchema.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!same(storeSchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))).sessions, this.records)`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ active: false as const }`; `tunnel && !tunnel.revoked && tunnel.session.phase === 'running' && this.current(tunnel.session) && this.isRunning(id) && this…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return { active: false as const };`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return { active: false as const };`; these statements determine whether a failure is absorbed or rejected again.
   */
  status(id: string) {
    const tunnel = this.tunnels.get(this.key(id));
    try { if (!same(storeSchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))).sessions, this.records)) return { active: false as const }; }
    catch { return { active: false as const }; }
    return tunnel && !tunnel.revoked && tunnel.session.phase === 'running' && this.current(tunnel.session) && this.isRunning(id) &&
      this.machines.live.get(id) === tunnel.instance && Date.now() < Date.parse(tunnel.session.expiresAt)
      ? this.describe(tunnel) : { active: false as const };
  }
  /**
   * 入口 / Entry: ReverseTunnels.listener.
   * 功能：在管理临时隧道会话与停止中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `this.options.listener(identity, run, signal)` / `this.machines.exec(row.vmId, reverseTunnelListenerCommand(identity, run), 10000, signal).then(result => { if (result.code !==…` 供上层消费（`ReverseTunnels`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ReverseTunnels`; this entry produces `this.options.listener(identity, run, signal)` / `this.machines.exec(row.vmId, reverseTunnelListenerCommand(identity, run), 10000, signal).then(result => { if (result.code !==…` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.options.listener`, `this.records.find`, `changed`, `this.machines.exec().then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.options.listener`, `this.records.find`, `changed`, `this.machines.exec().then`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.options.listener`.
   * 输入 / Inputs: identity: ProjectIdentity; run: ProjectIdentityRun; signal: AbortSignal optional
   * 输出 / Returns: `this.options.listener(identity, run, signal)`; `this.machines.exec(row.vmId, reverseTunnelListenerCommand(identity, run), 10000, signal).then(result => { if (result.code !==…`.
   * 副作用 / Effects: `this.options.listener`; `this.machines.exec().then`; `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `!row`; 异常 / errors `changed()`.
   */
  private listener(identity: ProjectIdentity, run: ProjectIdentityRun, signal?: AbortSignal) {
    if (this.options.listener) return this.options.listener(identity, run, signal);
    const row = this.records.find(value => value.execution?.record.runId === run.runId); if (!row) throw changed();
    return this.machines.exec(row.vmId, reverseTunnelListenerCommand(identity, run), 10000, signal).then(result => {
      if (result.code !== 0) throw changed();
      return z.object({ listener: reverseTunnelListenerSchema.nullable() }).strict().parse(JSON.parse(result.stdout)).listener;
    });
  }
  /**
   * 入口 / Entry: ReverseTunnels.prove.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; the calls and state transitions below complete the operation. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.durable`, `signal.throwIfAborted`, `this.current`, `this.machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.durable`, `signal.throwIfAborted`, `this.current`, `this.machines.live.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: row: Session; live: unknown; signal: AbortSignal optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.listener`.
   * 拒绝 / Refusals: 条件 / conditions `!row.execution?.run || !row.listener || !this.current(row) || row.phase !== 'running' || this.machines.live.get(row.vmId) !==…`; `(project._workspace || 'default') !== row.projectId || projectVersion(project) !== row.configSha256`; `state.status !== 'running' || !same(state.record, row.execution.record) || state.bootId !== row.execution.run.bootId || !awai…`; 异常 / errors `changed()`.
   */
  private async prove(row: Session, live: unknown, signal?: AbortSignal) {
    await this.durable(row);
    signal?.throwIfAborted(); if (!row.execution?.run || !row.listener || !this.current(row) || row.phase !== 'running' ||
        this.machines.live.get(row.vmId) !== live || !this.isRunning(row.vmId) || Date.now() >= Date.parse(row.expiresAt)) throw changed();
    /**
     * 入口 / Entry: ReverseTunnels.prove.origin.
     * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ReverseTunnels`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; the calls and state transitions below complete the operation. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
     * 处理：通过 `signal.throwIfAborted`, `this.current`, `this.workspaces.projects.current`, `this.machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.current`, `this.workspaces.projects.current`, `this.machines.live.get`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.closed || !this.current(row) || this.workspaces.projects.current(row.vmId) !== row.projectId || this.machines.live.get(r…`; 异常 / errors `changed()`.
     */
    const origin = () => { signal?.throwIfAborted(); if (this.closed || !this.current(row) ||
        this.workspaces.projects.current(row.vmId) !== row.projectId || this.machines.live.get(row.vmId) !== live ||
        !this.isRunning(row.vmId) || Date.now() >= Date.parse(row.expiresAt)) throw changed(); };
    origin(); const project = await this.workspaces.config(row.vmId); origin();
    if ((project._workspace || 'default') !== row.projectId || projectVersion(project) !== row.configSha256) throw changed();
    const state = await this.process(row).status(signal, row.execution.sha256); origin();
    if (state.status !== 'running' || !same(state.record, row.execution.record) || state.bootId !== row.execution.run.bootId ||
        !await this.scopes.readonlyActive(row.vmId, row.projectId, row.execution.record.runId, signal)) throw changed();
    origin(); const run = await this.identities.runReadonly(row.vmId, row.execution.identity, row.execution.record.runId, signal); origin();
    if (!same(run, row.execution.run) || !matches(run, row.execution.identity, row.execution.record)) throw changed();
    const listener = await this.listener(row.execution.identity, run, signal); origin(); if (!same(listener, row.listener)) throw changed();
  }
  /**
   * 入口 / Entry: ReverseTunnels.open.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await operation` 供上层消费（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; this entry produces `await operation` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `projectIdSchema.parse`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.row` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdSchema.parse`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.row`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.opening.get(key) === opening`.
   * 输入 / Inputs: id: string; guestPort: number; durationSeconds: number; signal: AbortSignal optional
   * 输出 / Returns: `await operation`.
   * 副作用 / Effects: `this.stopping.has`; `AbortSignal.any`; `this.opening.set`; `this.opening.delete`; 更新 / updates `opening.pending`.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isInteger(guestPort) || guestPort < 1 || guestPort > 65535 || !Number.isInteger(durationSeconds) || durationSeconds <…`; `this.closed`; `this.row(key) || this.tunnels.has(key) || this.opening.has(key) || this.stopping.has(key)`; 异常 / errors `new AppError('客户机端口或隧道时限无效')`; `new AppError('临时隧道服务已关闭', 409)`.
   * 收尾：退出 try 区域时始终执行 `if (this.opening.get(key) === opening) this.opening.delete(key);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (this.opening.get(key) === opening) this.opening.delete(key);`; these steps also apply to exceptional exits.
   */
  async open(id: string, guestPort: number, durationSeconds: number, signal?: AbortSignal) {
    if (!Number.isInteger(guestPort) || guestPort < 1 || guestPort > 65535 || !Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 600)
      throw new AppError('客户机端口或隧道时限无效');
    const projectId = projectIdSchema.parse(this.workspaces.projects.current(id)), key = `${id}:${projectId}`, live = this.machines.live.get(id);
    if (this.closed) throw new AppError('临时隧道服务已关闭', 409);
    if (this.row(key) || this.tunnels.has(key) || this.opening.has(key) || this.stopping.has(key))
      throw new AppError('此项目已有临时调试入口，请先关闭', 409);
    if (!live || !this.isRunning(id)) throw new AppError('请先启动发行版', 409);
    const abort = new AbortController(), active = AbortSignal.any([this.controller.signal, abort.signal, ...(signal ? [signal] : [])]);
    const opening: Opening = { vmId: id, instance: live, abort, pending: Promise.resolve() }; this.opening.set(key, opening);
    const operation = this.workspaces.projects.inScope(id, projectId, () => this.start(id, projectId, live, guestPort, durationSeconds, active));
    opening.pending = operation;
    try { return await operation; } finally { if (this.opening.get(key) === opening) this.opening.delete(key); }
  }
  /**
   * 入口 / Entry: ReverseTunnels.start.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ code: 0, ready: true, executed: true, ...this.describe(tunnel) }` 供上层消费（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; this entry produces `{ code: 0, ready: true, executed: true, ...this.describe(tunnel) }` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.capture`, `this.probe`, `this.assertCapture`, `this.machines.requireUnlocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.capture`, `this.probe`, `this.assertCapture`, `this.machines.requireUnlocked`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `listener`; `!retained`.
   * 输入 / Inputs: id: string; projectId: string; live: Capture['live']; guestPort: number; duration: number; signal: AbortSignal
   * 输出 / Returns: `{ code: 0, ready: true, executed: true, ...this.describe(tunnel) }`.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`; `this.save`; `this.pendingCaptures.set`; 更新 / updates `sha256`, `row`, `retained`, `tunnel.session`.
   * 拒绝 / Refusals: 条件 / conditions `!['absent', 'stopped'].includes(state.status)`; `!same(payload.identity, identity) || payload.sha256 !== sha256`; `!expiresAt`; 异常 / errors `legacy()`; `new AppError('临时隧道正文或环境超过受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID')`.
   * 收尾：退出 try 区域时始终执行 `if (!retained) await this.release(capture, failure);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (!retained) await this.release(capture, failure);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `failure = error;`; `if (row) { try { await this.stopRecord(this.row(keyOf(row)) || row); } catch (failed) { failure = cleanup([error, failed]); t…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `failure = error;`; `if (row) { try { await this.stopRecord(this.row(keyOf(row)) || row); } catch (failed) { failure = cleanup([error, failed]); t…`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async start(id: string, projectId: string, live: Capture['live'], guestPort: number, duration: number, signal: AbortSignal) {
    const capture = await this.capture(id, projectId, live, signal); let row: Session | undefined, retained = false, failure: unknown;
    try {
      const { project } = await this.probe(capture); await this.assertCapture(capture); this.machines.requireUnlocked(id);
      const identity = await this.scopes.identity(id, capture.project, capture.signal); await this.assertCapture(capture);
      const partial: Session = { id: randomUUID(), vmId: id, projectId, directory: capture.project.directory,
        networkIsolation: capture.project.networkIsolation || 'host', guestPort, localPort: 0, startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + (duration + 120) * 1000).toISOString(), phase: 'starting',
        configSha256: capture.version, token: randomBytes(32).toString('hex') };
      const process = this.process(partial, duration), state = await process.status(capture.signal);
      await this.assertCapture(capture); if (!['absent', 'stopped'].includes(state.status)) throw legacy();
      const intent = process.newIntent(createHash('sha256').update(JSON.stringify([capture.version, guestPort, partial.token])).digest('hex'), state.bootId);
      const execution = { command: reverseTunnelBrokerCommand(guestPort, partial.token!, duration), environment: project.environment };
      let sha256: string;
      try { sha256 = projectIdentityPayload(execution).sha256; }
      catch { throw new AppError('临时隧道正文或环境超过受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID'); }
      row = { ...partial, execution: { identity, record: intent, run: null, sha256 } };
      await this.save(rows => { if (rows.some(value => keyOf(value) === keyOf(row!))) throw changed(); rows.push(row!); });
      this.pendingCaptures.set(keyOf(row), capture); retained = true;
      await process.persistIntent(intent);
      const payload = await this.scopes.inherited(id, capture.project, execution,
        { kind: 'service', runId: intent.runId, bootId: intent.bootId }, capture.signal);
      await this.assertCapture(capture); if (!same(payload.identity, identity) || payload.sha256 !== sha256) throw changed();
      const record = await process.start(intent, payload, capture.signal); await this.assertCapture(capture);
      const expiresAt = process.expiresAt(); if (!expiresAt) throw changed();
      row = await this.update(row, value => { value.execution!.record = record; value.expiresAt = expiresAt; });
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && Date.now() < Date.parse(row.expiresAt)) {
        await this.assertCapture(capture);
        if (await this.scopes.active(id, projectId, intent.runId, capture.signal)) {
          const run = await this.identities.runReadonly(id, identity, intent.runId, capture.signal); await this.assertCapture(capture);
          if (!matches(run, identity, record)) throw changed();
          const listener = await this.listener(identity, run, capture.signal); await this.assertCapture(capture);
          if (listener) {
            row = await this.update(row, value => { value.execution!.run = run; value.listener = listener; });
            const tunnel = await this.listen(row, capture, signal, false); retained = true;
            row = await this.update(tunnel.session, value => { value.phase = 'running'; }); tunnel.session = row;
            await this.assertCapture(capture); this.schedule(row); return { code: 0, ready: true, executed: true, ...this.describe(tunnel) };
          }
        }
        await delay(100, undefined, { signal: capture.signal });
      }
      throw new AppError('项目 UID 隧道 broker 就绪检查超时', 409);
    } catch (error) {
      failure = error;
      if (row) {
        try { await this.stopRecord(this.row(keyOf(row)) || row); }
        catch (failed) { failure = cleanup([error, failed]); throw failure; }
      }
      throw error;
    } finally { if (!retained) await this.release(capture, failure); }
  }
  /**
   * 入口 / Entry: ReverseTunnels.listen.
   * 功能：在管理临时隧道会话与停止中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `tunnel` 供上层消费（`ReverseTunnels`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ReverseTunnels`; this entry produces `tunnel` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `keyOf`, `createServer`, `signal.throwIfAborted`, `this.machines.requireUnlocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `keyOf`, `createServer`, `signal.throwIfAborted`, `this.machines.requireUnlocked`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `restore`; `!restore`; `this.pendingCaptures.get(key) === capture`.
   * 输入 / Inputs: row: Session; capture: Capture; signal: AbortSignal; restore: boolean
   * 输出 / Returns: `tunnel`.
   * 副作用 / Effects: `createServer`; `server.address`; `this.update`; `this.tunnels.set`; `this.pendingCaptures.delete`; 更新 / updates `reserved`, `row`.
   * 拒绝 / Refusals: 条件 / conditions `!address || typeof address === 'string'`; 异常 / errors `changed()`; `error`.
   * 失败处理：catch 分支执行 `await new Promise<void>(resolve => server.close(() => resolve()));`; `if (reserved) this.machines.reserveHostPorts(this.owner(row), []);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await new Promise<void>(resolve => server.close(() => resolve()));`; `if (reserved) this.machines.reserveHostPorts(this.owner(row), []);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async listen(row: Session, capture: Capture, signal: AbortSignal, restore: boolean) {
    const key = keyOf(row), server = createServer({ allowHalfOpen: true }, socket => void this.bridge(key, server, socket)); let reserved = false;
    try {
      signal.throwIfAborted(); this.machines.requireUnlocked(row.vmId);
      if (restore) { this.machines.reserveHostPorts(this.owner(row), [row.localPort]); reserved = true; }
      await new Promise<void>((resolve, reject) => { server.once('error', reject);
        server.once('close', () => reject(new AppError('临时隧道监听已取消', 409)));
        server.listen({ port: restore ? row.localPort : 0, host: '127.0.0.1' }, resolve); });
      signal.throwIfAborted(); await this.assertCapture(capture);
      const address = server.address(); if (!address || typeof address === 'string') throw changed();
      if (!restore) { this.machines.reserveHostPorts(this.owner(row), [address.port]); reserved = true;
        row = await this.update(row, value => { value.localPort = address.port; }); }
      const tunnel: Tunnel = { session: row, instance: capture.live, capture, server, sockets: new Set(), channels: new Set(), revoked: false };
      this.tunnels.set(key, tunnel);
      if (this.pendingCaptures.get(key) === capture) this.pendingCaptures.delete(key);
      server.on('error', () => this.automatic(key)); return tunnel;
    } catch (error) { await new Promise<void>(resolve => server.close(() => resolve()));
      if (reserved) this.machines.reserveHostPorts(this.owner(row), []); throw error; }
  }
  /**
   * 入口 / Entry: ReverseTunnels.restore.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `opening.pending`（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; the outcome is recorded in `opening.pending`. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `keyOf`, `this.opening.has`, `this.stopping.has`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `keyOf`, `this.opening.has`, `this.stopping.has`, `changed`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.opening.get(key) === opening`.
   * 输入 / Inputs: row: Session; live: Capture['live']; signal: AbortSignal
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.stopping.has`; `this.opening.set`; `this.opening.delete`; 更新 / updates `opening.pending`.
   * 拒绝 / Refusals: 条件 / conditions `this.opening.has(key) || this.stopping.has(key)`; 异常 / errors `changed()`.
   * 收尾：退出 try 区域时始终执行 `if (this.opening.get(key) === opening) this.opening.delete(key);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (this.opening.get(key) === opening) this.opening.delete(key);`; these steps also apply to exceptional exits.
   */
  private async restore(row: Session, live: Capture['live'], signal: AbortSignal) {
    const key = keyOf(row); if (this.opening.has(key) || this.stopping.has(key)) throw changed();
    const abort = new AbortController(), opening: Opening = { vmId: row.vmId, instance: live, abort, pending: Promise.resolve() }; this.opening.set(key, opening);
    /**
     * 入口 / Entry: ReverseTunnels.restore.callback@394.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `AbortSignal.any`; `this.listen`; `this.release`; 更新 / updates `retained`, `failure`.
     * 拒绝 / Refusals: 条件 / conditions `capture.version !== row.configSha256`; 异常 / errors `changed()`; `error`.
     * 收尾：退出 try 区域时始终执行 `if (!retained) await this.release(capture, failure);`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `if (!retained) await this.release(capture, failure);`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `failure = error;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `failure = error;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    const pending = (async () => {
      const active = AbortSignal.any([signal, abort.signal]); await this.prove(row, live, active);
      const capture = await this.capture(row.vmId, row.projectId, live, active, true); let retained = false, failure: unknown;
      try { if (capture.version !== row.configSha256) throw changed(); await this.prove(row, live, capture.signal);
        await this.listen(row, capture, capture.signal, true); retained = true; this.schedule(row); }
      catch (error) { failure = error; throw error; }
      finally { if (!retained) await this.release(capture, failure); }
    })(); opening.pending = pending;
    try { await pending; } finally { if (this.opening.get(key) === opening) this.opening.delete(key); }
  }
  /**
   * 入口 / Entry: ReverseTunnels.bridge.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; this entry produces `void` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.tunnels.get`, `socket.destroy`, `tunnel.sockets.add`, `socket.once` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.tunnels.get`, `socket.destroy`, `tunnel.sockets.add`, `socket.once`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!tunnel || tunnel.revoked || tunnel.server !== server || tunnel.sockets.size >= 4`.
   * 输入 / Inputs: key: string; server: Server; socket: Socket
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `socket.destroy`; `tunnel.sockets.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `socket.destroy();`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `socket.destroy();`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async bridge(key: string, server: Server, socket: Socket) {
    const tunnel = this.tunnels.get(key); if (!tunnel || tunnel.revoked || tunnel.server !== server || tunnel.sockets.size >= 4) { socket.destroy(); return; }
    const row = tunnel.session, abort = new AbortController(); tunnel.sockets.add(socket);
    socket.once('close', () => { abort.abort(); tunnel.sockets.delete(socket); }); socket.on('error', () => socket.destroy());
    try {
      /**
       * 入口 / Entry: ReverseTunnels.bridge.callback@409.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.workspaces.projects.inScope）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.workspaces.projects.inScope).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `channel.destroy`; `tunnel.channels.add`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      await this.workspaces.projects.inScope(row.vmId, row.projectId, async () => {
        /**
         * 入口 / Entry: ReverseTunnels.bridge.validate.
         * 功能：把本层请求转交 `this.prove`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `this.prove` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `this.prove(row, tunnel.instance, abort.signal)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const validate = () => this.prove(row, tunnel.instance, abort.signal); await validate(); this.machines.requireUnlocked(row.vmId);
        const channel = await (this.options.bridge || openReverseTunnelBridge)(this.machines, row.vmId,
          { identity: row.execution!.identity, run: row.execution!.run!, listener: row.listener!, token: row.token! }, tunnel.instance, abort.signal, validate);
        if (this.tunnels.get(key) !== tunnel || tunnel.revoked || socket.destroyed) { channel.destroy(); return; }
        tunnel.channels.add(channel); channel.once('close', () => { tunnel.channels.delete(channel); socket.end(); });
        channel.once('end', () => socket.end()); channel.on('error', () => socket.destroy()); socket.pipe(channel).pipe(socket);
      });
    } catch { socket.destroy(); }
  }
  /**
   * 入口 / Entry: ReverseTunnels.revoke.
   * 功能：在管理临时隧道会话与停止中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `tunnel.revoked`（`ReverseTunnels`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ReverseTunnels`; the outcome is recorded in `tunnel.revoked`. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `clearTimeout`, `socket.destroy`, `channel.destroy`, `this.machines.reserveHostPorts` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `clearTimeout`, `socket.destroy`, `channel.destroy`, `this.machines.reserveHostPorts`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `tunnel.timer`.
   * 输入 / Inputs: tunnel: Tunnel
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `clearTimeout`; `socket.destroy`; `channel.destroy`; 更新 / updates `tunnel.revoked`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async revoke(tunnel: Tunnel) {
    tunnel.revoked = true; if (tunnel.timer) clearTimeout(tunnel.timer);
    for (const socket of tunnel.sockets) socket.destroy(); for (const channel of tunnel.channels) channel.destroy();
    await new Promise<void>(resolve => tunnel.server.close(() => resolve())); this.machines.reserveHostPorts(this.owner(tunnel.session), []);
  }
  /**
   * 入口 / Entry: ReverseTunnels.stopRecord.
   * 功能：在管理临时隧道会话与停止中，结束、撤销或清理本次拥有的领域资源；本入口产生 `true` 供上层消费（`ReverseTunnels`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ReverseTunnels`; this entry produces `true` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `legacy`, `this.current`, `changed`, `keyOf` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `legacy`, `this.current`, `changed`, `keyOf`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `tunnel`; `capture`.
   * 输入 / Inputs: row: Session
   * 输出 / Returns: `true`.
   * 副作用 / Effects: `this.update`; `this.process().stop`; `this.release`; `this.save`; `this.tunnels.delete`; 更新 / updates `row`.
   * 拒绝 / Refusals: 条件 / conditions `!row.execution`; `!this.current(row)`; `tunnel`; 异常 / errors `legacy()`; `changed()`.
   * 失败处理：catch 分支执行 `if (tunnel) { try { await this.revoke(tunnel); } catch (failed) { throw cleanup([error, failed]); } }`; `throw cleanup([error]);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (tunnel) { try { await this.revoke(tunnel); } catch (failed) { throw cleanup([error, failed]); } }`; `throw cleanup([error]);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async stopRecord(row: Session) {
    if (!row.execution) throw legacy(); if (!this.current(row)) throw changed();
    const key = keyOf(row), tunnel = this.tunnels.get(key), capture = tunnel?.capture || this.pendingCaptures.get(key);
    try { row = await this.update(row, value => { value.phase = 'stopping'; }); }
    catch (error) { if (tunnel) { try { await this.revoke(tunnel); } catch (failed) { throw cleanup([error, failed]); } }
      throw cleanup([error]); }
    try {
      if (tunnel) await this.revoke(tunnel);
      if (!this.isRunning(row.vmId)) throw new AppError('请先启动或恢复实例，再核对原隧道完整运行域', 409);
      await this.process(row).stop(row.execution!.record); if (!this.current(row)) throw changed();
      if (capture) await this.release(capture);
      await this.save(rows => { const found = rows.find(value => value.id === row.id);
        if (!found || !same(found, row)) throw changed(); rows.splice(rows.indexOf(found), 1); });
      this.tunnels.delete(key); this.pendingCaptures.delete(key); return true;
    } catch (error) { throw cleanup([error]); }
  }
  /**
   * 入口 / Entry: ReverseTunnels.stopKey.
   * 功能：在管理临时隧道会话与停止中，结束、撤销或清理本次拥有的领域资源；本入口产生 `existing` / `opening.pending.catch(() => {}).then(() => this.stopKey(key))` 供上层消费（`ReverseTunnels`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ReverseTunnels`; this entry produces `existing` / `opening.pending.catch(() => {}).then(() => this.stopKey(key))` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.stopping.get`, `this.opening.get`, `opening.abort.abort`, `opening.pending.catch().then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.stopping.get`, `this.opening.get`, `opening.abort.abort`, `opening.pending.catch().then`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `existing`; `opening`; `!row`.
   * 输入 / Inputs: key: string
   * 输出 / Returns: Promise<boolean>；结果来自 / values from `existing`; `opening.pending.catch(() => {}).then(() => this.stopKey(key))`; `Promise.resolve(false)`.
   * 副作用 / Effects: `this.stopping.get`; `opening.abort.abort`; `this.stopping.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private stopKey(key: string): Promise<boolean> {
    const existing = this.stopping.get(key); if (existing) return existing;
    const opening = this.opening.get(key);
    if (opening) { opening.abort.abort(); return opening.pending.catch(() => {}).then(() => this.stopKey(key)); }
    const row = this.row(key); if (!row) return Promise.resolve(false);
    const pending = this.workspaces.projects.inScope(row.vmId, row.projectId, () => this.stopRecord(row))
      .finally(() => { if (this.stopping.get(key) === pending) this.stopping.delete(key); });
    this.stopping.set(key, pending); return pending;
  }
  /**
   * 入口 / Entry: ReverseTunnels.stop.
   * 功能：在管理临时隧道会话与停止中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.stopKey(this.key(id))` 供上层消费（`ReverseTunnels`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ReverseTunnels`; this entry produces `this.stopKey(this.key(id))` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.stopKey`, `this.key` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.stopKey`, `this.key`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.stopKey(this.key(id))`.
   * 副作用 / Effects: `this.stopKey`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  stop(id: string) { return this.stopKey(this.key(id)); }
  /**
   * 入口 / Entry: ReverseTunnels.close.
   * 功能：在管理临时隧道会话与停止中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closing` / `closing` 供上层消费（`ReverseTunnels`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ReverseTunnels`; this entry produces `this.closing` / `closing` for its caller. Module context: Owns temporary tunnel sessions/stops, retaining legacy tickets instead of adopting unknown processes with incomplete ownership.
   * 处理：通过 `this.controller.abort`, `this.machines.off`, `this.opening.values`, `opening.abort.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.controller.abort`, `this.machines.off`, `this.opening.values`, `opening.abort.abort`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closing`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.closing`; `closing`.
   * 副作用 / Effects: `this.controller.abort`; `opening.abort.abort`; 更新 / updates `this.closed`, `this.closing`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() {
    if (this.closing) return this.closing; this.closed = true; this.controller.abort();
    this.machines.off('change', this.changed); this.machines.off('incident-lockdown', this.locked);
    for (const opening of this.opening.values()) opening.abort.abort();
    /**
     * 入口 / Entry: ReverseTunnels.close.callback@454.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `errors.length`; 异常 / errors `cleanup(errors)`.
     */
    const closing = (async () => {
      const unfinished = await Promise.allSettled([...this.checks, ...[...this.opening.values()].map(value => value.pending)]);
      const stopped = await Promise.allSettled(this.records.filter(row => row.execution).map(row => this.stopKey(keyOf(row))));
      const errors = [...unfinished, ...stopped].flatMap(result => result.status === 'rejected' &&
        result.reason instanceof AppError && result.reason.status === 503 ? [result.reason] : []);
      if (errors.length) throw cleanup(errors); this.unguard();
    })(); this.closing = closing;
    void closing.catch(() => { if (this.closing === closing) this.closing = undefined; }); return closing;
  }
}
