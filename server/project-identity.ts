/**
 * 模块职责：校验项目账户、网络和运行票据，部署经摘要验证的固定账户启动器并核对完整身份。
 * Module purpose: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { ROOT } from './paths.ts';
import { quote } from './shell.ts';

export const projectIdentityAssetNames = ['protocol.h', 'launcher.c', 'controller.py'] as const;
const uuid = z.uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
const projectId = z.string().regex(/^(default|[a-f0-9]{16})$/);
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const directory = z.string().min(1).max(1023).refine(value => value.startsWith('/') &&
  !/[\x00-\x1f\x7f]/.test(value) && (value === '/' || value.split('/').slice(1).every(part => part && part !== '.' && part !== '..')));
export const projectIdentitySchema = z.object({
  version: z.literal(1), phase: z.enum(['intent', 'active']), registryId: uuid, projectId,
  identityId: uuid, revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  account: z.string().regex(/^skp[a-f0-9]{24}$/), uid: z.number().int().min(20000).max(59999),
  gid: z.number().int().min(20000).max(59999), home: directory, directory,
  directoryDevice: decimal, directoryInode: decimal, homeDevice: decimal, homeInode: decimal,
  networkIsolation: z.enum(['host', 'private']),
}).strict().superRefine((value, ctx) => {
  if (value.gid !== value.uid || value.account !== 'skp' + value.identityId.replaceAll('-', '').slice(0, 24) ||
      value.home !== '/var/lib/sakura-project-homes/' + value.identityId || value.directoryInode === '0' ||
      (value.phase === 'active' && value.homeInode === '0'))
    ctx.addIssue({ code: 'custom', message: '项目账户绑定不完整' });
});
export type ProjectIdentity = z.infer<typeof projectIdentitySchema>;
export const projectIdentityExpectedSchema = z.object({ registryId: uuid, identityId: uuid,
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict();
export type ProjectIdentityExpected = z.infer<typeof projectIdentityExpectedSchema>;
export const projectIdentityRunSchema = z.object({
  version: z.literal(1), phase: z.enum(['active', 'closed']), mode: z.enum(['independent', 'inherit-current']),
  registryId: uuid, identityId: uuid, projectId, runId: uuid, revision: z.number().int().min(1),
  bootId: uuid, build: digest, networkDevice: decimal, networkInode: decimal,
  cgroupDevice: decimal, cgroupInode: decimal, cgroupName: z.string(), namespace: z.string(),
}).strict().superRefine((value, ctx) => {
  if (value.cgroupInode === '0' || value.networkInode === '0' ||
      (value.mode === 'independent' ? value.cgroupName !== 'sakura-identity-' + value.runId :
        !/^sakura-(task|main|service)-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.cgroupName) &&
        !['openrc.sakura-ssh-' + value.projectId, 'system.slice/sakura-ssh-' + value.projectId + '.service'].includes(value.cgroupName)) ||
      (value.namespace !== '' && value.namespace !== 'sk-' + value.projectId))
    ctx.addIssue({ code: 'custom', message: '项目运行票据不完整' });
});
export type ProjectIdentityRun = z.infer<typeof projectIdentityRunSchema>;
export const projectIdentityNetworkSchema = z.object({ version: z.literal(1), registryId: uuid, identityId: uuid,
  projectId, revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), bootId: uuid,
  namespace: z.string(), networkDevice: decimal, networkInode: decimal, generation: uuid }).strict().superRefine((value, ctx) => {
  if (value.namespace !== 'sk-' + value.projectId || value.networkInode === '0')
    ctx.addIssue({ code: 'custom', message: '项目网络固定记录不完整' });
});
export type ProjectIdentityNetwork = z.infer<typeof projectIdentityNetworkSchema>;
export const projectIdentityNetworkLeaseSchema = z.object({ version: z.literal(1), phase: z.literal('pending'),
  releaseId: uuid, network: projectIdentityNetworkSchema }).strict();
export type ProjectIdentityNetworkLease = z.infer<typeof projectIdentityNetworkLeaseSchema>;
export const projectIdentityNetworkReleaseSchema = z.object({ version: z.literal(1), phase: z.literal('released'),
  releaseId: uuid, network: projectIdentityNetworkSchema }).strict();
export type ProjectIdentityNetworkRelease = z.infer<typeof projectIdentityNetworkReleaseSchema>;
const manifestSchema = z.object({ version: z.literal(1), build: digest,
  files: z.array(z.object({ name: z.enum(projectIdentityAssetNames), size: z.number().int().min(1).max(262144),
    sha256: digest }).strict()).length(3),
}).strict().refine(value => value.files.every((file, index) => file.name === projectIdentityAssetNames[index]));

/**
 * 入口 / Entry: projectIdentitySources.
 * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ manifest, files, directory: '/usr/local/lib/sakura-project-identity/' + manifest.build }` 供上层消费（`project-identity.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-identity.ts`; this entry produces `{ manifest, files, directory: '/usr/local/lib/sakura-project-identity/' + manifest.build }` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
 * 处理：通过 `manifestSchema.parse`, `readFile`, `join`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `manifestSchema.parse`, `readFile`, `join`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: sourceDirectory: default=join(ROOT, '.sakura-server/assets/project-identity')
 * 输出 / Returns: `{ manifest, files, directory: '/usr/local/lib/sakura-project-identity/' + manifest.build }`.
 * 副作用 / Effects: `createHash`; `createHash().update().digest`; `createHash().update`; `aggregate.update().update`; `aggregate.update`.
 * 拒绝 / Refusals: 条件 / conditions `bytes.length !== expected.size || createHash('sha256').update(bytes).digest('hex') !== expected.sha256`; `aggregate.digest('hex') !== manifest.build`; 异常 / errors `new AppError('项目账户启动器源码摘要不符', 503, 'PROJECT_IDENTITY_SOURCE_INVALID')`; `new AppError('项目账户启动器版本摘要不符', 503, 'PROJECT_IDENTITY_SOURCE_INVALID')`.
 */
export async function projectIdentitySources(sourceDirectory = join(ROOT, '.sakura-server/assets/project-identity')) {
  // 发布运行必须有资源清单；不能退回工作区源码或未经摘要核验的客户机编译输入。
  const manifest = manifestSchema.parse(JSON.parse(await readFile(join(sourceDirectory, 'manifest.json'), 'utf8')));
  const files = new Map<string, Buffer>(), aggregate = createHash('sha256');
  for (const expected of manifest.files) {
    const bytes = await readFile(join(sourceDirectory, expected.name));
    if (bytes.length !== expected.size || createHash('sha256').update(bytes).digest('hex') !== expected.sha256)
      throw new AppError('项目账户启动器源码摘要不符', 503, 'PROJECT_IDENTITY_SOURCE_INVALID');
    aggregate.update(expected.name).update(bytes); files.set(expected.name, bytes);
  }
  if (aggregate.digest('hex') !== manifest.build)
    throw new AppError('项目账户启动器版本摘要不符', 503, 'PROJECT_IDENTITY_SOURCE_INVALID');
  return { manifest, files, directory: '/usr/local/lib/sakura-project-identity/' + manifest.build };
}
const fixedEnvironment = 'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C';
/**
 * 入口 / Entry: expectedIdentity.
 * 功能：从当前输入或状态计算 `({ registryId: identity.registryId, identityId: identity.identityId, revision: identity.revision, })`，供调用方后续验证或使用。
 * Purpose: Computes `({ registryId: identity.registryId, identityId: identity.identityId, revision: identity.revision, })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: identity: ProjectIdentity
 * 输出 / Returns: ProjectIdentityExpected；结果来自 / values from `({ registryId: identity.registryId, identityId: identity.identityId, revision: identity.revision, })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const expectedIdentity = (identity: ProjectIdentity): ProjectIdentityExpected => ({
  registryId: identity.registryId, identityId: identity.identityId, revision: identity.revision,
});
/**
 * 入口 / Entry: utf8String.
 * 功能：从当前输入或状态计算 `!value.includes('\0') && Buffer.from(value, 'utf8').toString('utf8') === value`，供调用方后续验证或使用。
 * Purpose: Computes `!value.includes('\0') && Buffer.from(value, 'utf8').toString('utf8') === value` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `!value.includes('\0') && Buffer.from(value, 'utf8').toString('utf8') === value`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const utf8String = (value: string) => !value.includes('\0') && Buffer.from(value, 'utf8').toString('utf8') === value;
const executableOptionsSchema = z.object({ command: z.string().min(1).max(65536).refine(utf8String),
  stdin: z.literal('session').optional(),
  environment: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
    z.string().max(8192).refine(utf8String)).default({}),
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value.environment).length > 128 || ['HOME', 'USER', 'LOGNAME'].some(key => key in value.environment) ||
      Object.entries(value.environment).some(([key, content]) => Buffer.byteLength(key + '=' + content) > 8192) ||
      Buffer.byteLength(value.command) + Object.entries(value.environment).reduce((sum, [key, content]) => sum + Buffer.byteLength(key + '=' + content), 0) > 65536)
    ctx.addIssue({ code: 'custom', message: '项目命令或环境超过边界' });
});
export type ProjectIdentityExecution = { command: string; environment?: Record<string, string>; stdin?: 'session' };
export type ProjectIdentityInput = { command: string; input: Buffer; sha256: string };
export type ProjectIdentityInheritedInput = ProjectIdentityInput & { runId: string };
export const projectIdentitySshDaemonSchema = z.object({ pid: z.number().int().min(1),
  startTicks: decimal.refine(value => value !== '0'), bootId: uuid,
  cgroupName: z.string().regex(/^(openrc\.sakura-ssh-(default|[a-f0-9]{16})|system\.slice\/sakura-ssh-(default|[a-f0-9]{16})\.service)$/),
}).strict();
export type ProjectIdentitySshDaemon = z.infer<typeof projectIdentitySshDaemonSchema>;
export type ProjectIdentitySshSnapshot = ProjectIdentityInput & { build: string; runId: string };
export const projectIdentityTerminalSchema = z.object({ version: z.literal(1), terminalId: uuid,
  run: projectIdentityRunSchema, name: z.string().regex(/^sakura-terminal-(default|[a-f0-9]{16})-[a-z0-9-]{1,48}$/),
  serverPid: z.number().int().min(1), serverTicks: decimal,
  sessionId: z.string().regex(/^\$[0-9]+$/) }).strict().superRefine((value, ctx) => {
    if (value.terminalId !== value.run.runId || value.run.mode !== 'independent' || value.run.phase !== 'active' ||
        !value.name.startsWith('sakura-terminal-' + value.run.projectId + '-') || value.serverTicks === '0')
      ctx.addIssue({ code: 'custom', message: '项目终端回执不完整' });
  });
export type ProjectIdentityTerminal = z.infer<typeof projectIdentityTerminalSchema>;
type Transport = Pick<Machines, 'get' | 'exec' | 'execInput' | 'writeGuestFile'>;
/**
 * 入口 / Entry: projectIdentityPayload.
 * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ input, sha256: createHash('sha256').update(input).digest('hex') }` 供上层消费（`project-identity.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-identity.ts`; this entry produces `{ input, sha256: createHash('sha256').update(input).digest('hex') }` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
 * 处理：通过 `executableOptionsSchema.parse`, `environment.reduce`, `input.write`, `input.writeUInt32LE` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `executableOptionsSchema.parse`, `environment.reduce`, `input.write`, `input.writeUInt32LE`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: execution: ProjectIdentityExecution
 * 输出 / Returns: `{ input, sha256: createHash('sha256').update(input).digest('hex') }`.
 * 副作用 / Effects: `executableOptionsSchema.parse`; `input.write`; `input.writeUInt32LE`; `createHash().update().digest`; `createHash().update`; 更新 / updates `offset`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectIdentityPayload(execution: ProjectIdentityExecution) {
  const value = executableOptionsSchema.parse(execution), script = Buffer.from(value.command, 'utf8');
  const environment = Object.entries(value.environment).map(([key, content]) => [Buffer.from(key), Buffer.from(content, 'utf8')] as const);
  const size = script.length + environment.reduce((sum, [key, content]) => sum + 8 + key.length + content.length, 0);
  const input = Buffer.alloc(32 + size);
  input.write('SKIDP001', 0, 'ascii'); input.writeUInt32LE(1, 8); input.writeUInt32LE(value.stdin === 'session' ? 2 : 0, 12); input.writeUInt32LE(size, 16);
  input.writeUInt32LE(environment.length, 20); input.writeUInt32LE(script.length, 24);
  script.copy(input, 32); let offset = 32 + script.length;
  for (const [key, content] of environment) {
    input.writeUInt32LE(key.length, offset); input.writeUInt32LE(content.length, offset + 4); offset += 8;
    key.copy(input, offset); offset += key.length; content.copy(input, offset); offset += content.length;
  }
  return { input, sha256: createHash('sha256').update(input).digest('hex') };
}

export class ProjectIdentities {
  private installed = new Map<string, Promise<string>>();
  /**
   * 入口 / Entry: ProjectIdentities.constructor.
   * 功能：建立 ProjectIdentities 的校验项目账户、网络和运行票据上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectIdentities context for this module's responsibility: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Transport; options: { sourceDirectory?: string } default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Transport, private options: { sourceDirectory?: string } = {}) {}

  /**
   * 入口 / Entry: ProjectIdentities.build.
   * 功能：把本层请求转交 `projectIdentitySources`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `projectIdentitySources` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `await projectIdentitySources(this.options.sourceDirectory)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async build() { return await projectIdentitySources(this.options.sourceDirectory); }
  /**
   * 入口 / Entry: ProjectIdentities.controlCommand.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``${fixedEnvironment} /usr/bin/python3 -I -S ${quote('/usr/local/lib/sakura-project-identity/' + digest.parse(build) + '/contr…` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces ``${fixedEnvironment} /usr/bin/python3 -I -S ${quote('/usr/local/lib/sakura-project-identity/' + digest.parse(build) + '/contr…` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `quote`, `digest.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `quote`, `digest.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: build: string; request: object
   * 输出 / Returns: ``${fixedEnvironment} /usr/bin/python3 -I -S ${quote('/usr/local/lib/sakura-project-identity/' + digest.parse(build) + '/contr…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `data.length > 131072`; 异常 / errors `new AppError('项目账户请求超过边界', 413)`.
   */
  private controlCommand(build: string, request: object) {
    const data = Buffer.from(JSON.stringify(request)).toString('base64');
    if (data.length > 131072) throw new AppError('项目账户请求超过边界', 413);
    return `${fixedEnvironment} /usr/bin/python3 -I -S ${quote('/usr/local/lib/sakura-project-identity/' + digest.parse(build) + '/controller.py')} ${quote(data)}`;
  }
  /**
   * 入口 / Entry: ProjectIdentities.control.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `schema.parse(reply.result)` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `schema.parse(reply.result)` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `this.build`, `this.install`, `inline.includes`, `this.machines.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.build`, `this.install`, `inline.includes`, `this.machines.exec`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; request: object; schema: z.ZodType<T>; signal: AbortSignal optional; readonly: default=false
   * 输出 / Returns: `schema.parse(reply.result)`.
   * 副作用 / Effects: `this.install`; `this.machines.exec`; `code.startsWith`; 更新 / updates `reply`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0 || !reply.ok`; 异常 / errors `new AppError('项目账户控制器未返回可核对回执', 502, 'PROJECT_IDENTITY_CONTROL_FAILED')`; `new AppError(`${migration}（${code}${context}）`, cleanup ? 503 : 409, cleanup ? code : 'PROJECT_IDENTITY_' + code)`.
   * 失败处理：catch 分支执行 `throw new AppError('项目账户控制器未返回可核对回执', 502, 'PROJECT_IDENTITY_CONTROL_FAILED');`; `throw new AppError('项目账户回执身份不完整', 502, 'PROJECT_IDENTITY_CONTROL_FAILED');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('项目账户控制器未返回可核对回执', 502, 'PROJECT_IDENTITY_CONTROL_FAILED');`; `throw new AppError('项目账户回执身份不完整', 502, 'PROJECT_IDENTITY_CONTROL_FAILED');`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async control<T>(vmId: string, request: object, schema: z.ZodType<T>, signal?: AbortSignal, readonly = false) {
    const build = readonly ? (await this.build()).manifest.build : await this.install(vmId, signal);
    // Full admission can validate 1024 receipts and durably retire 512. Keep
    // its finite budget separate from ordinary reads and exact cancellation.
    const timeoutMs = 'action' in request && ['prepare', 'terminal-create', 'ssh-prepare'].includes(String(request.action)) ? 180000 : 40000;
    const result = await this.machines.exec(vmId, this.controlCommand(build, request), timeoutMs, signal);
    let reply: { ok: boolean; result?: unknown; code?: string; detail?: unknown };
    try { reply = JSON.parse(result.stdout); } catch {
      throw new AppError('项目账户控制器未返回可核对回执', 502, 'PROJECT_IDENTITY_CONTROL_FAILED');
    }
    if (result.code !== 0 || !reply.ok) {
      const code = typeof reply.code === 'string' && /^[A-Z_]{1,80}$/.test(reply.code) ? reply.code : 'CONTROL_FAILED';
      const toolFailure = z.object({ tool: z.enum(['groupadd', 'useradd', 'addgroup', 'adduser', 'openssl', 'chpasswd', 'ip']), exit: z.number().int() }).strict().safeParse(reply.detail);
      const context = code === 'SYSTEM_TOOL_FAILED' && toolFailure.success ? ':' + toolFailure.data.tool : '';
      const migration = code === 'DIRECTORY_MIGRATION_REQUIRED' ? '目录及父目录尚未授权给项目账户，请显式迁移权限'
        : code === 'EGRESS_NNP_RESTART_REQUIRED' ? '普通 SSH 或定时服务尚未继承提权限制，请管理员重启对应服务并结束旧会话后重试'
        : code === 'EGRESS_NNP_PENDING' ? '系统提权限制配置尚未生效，请管理员核对原配置及服务管理器状态后重试'
        : code.startsWith('EGRESS_') ? '项目账号的共享网络出站限制无法核对，请恢复原记录后重试' : '项目账户归属核对失败';
      const cleanup = code === 'PROJECT_IDENTITY_CLEANUP_FAILED' || code === 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED';
      throw new AppError(`${migration}（${code}${context}）`, cleanup ? 503 : 409, cleanup ? code : 'PROJECT_IDENTITY_' + code);
    }
    try { return schema.parse(reply.result); } catch {
      throw new AppError('项目账户回执身份不完整', 502, 'PROJECT_IDENTITY_CONTROL_FAILED');
    }
  }

  /**
   * 入口 / Entry: ProjectIdentities.install.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `build` / `await install` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `build` / `await install` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `this.build`, `this.installed.get`, `this.machines.exec`, `this.controlCommand` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.build`, `this.installed.get`, `this.machines.exec`, `this.controlCommand`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `pending`; `probe.code === 0 && reply.ok && reply.result?.build === build`.
   * 输入 / Inputs: vmId: string; signal: AbortSignal optional
   * 输出 / Returns: `build`; `await install`.
   * 副作用 / Effects: `this.installed.get`; `this.machines.exec`; `this.installed.delete`; `this.installSource`; `this.installed.set`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `this.installed.delete(key);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.installed.delete(key);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async install(vmId: string, signal?: AbortSignal) {
    const source = await this.build(), key = vmId + ':' + source.manifest.build;
    const pending = this.installed.get(key);
    if (pending) {
      const build = await pending;
      // A VM reboot/restore can keep its host ID while losing guest files.
      // Revalidate the root source/launcher receipt before reusing the cache.
      const probe = await this.machines.exec(vmId, this.controlCommand(build, { action: 'install' }), 30000, signal);
      try {
        const reply = JSON.parse(probe.stdout);
        if (probe.code === 0 && reply.ok && reply.result?.build === build) return build;
      } catch { /* A missing Python/controller is reinstalled below. */ }
      this.installed.delete(key);
    }
    const install = this.installSource(vmId, source, signal);
    this.installed.set(key, install);
    try { return await install; } catch (error) { this.installed.delete(key); throw error; }
  }
  /**
   * 入口 / Entry: ProjectIdentities.installSource.
   * 功能：把摘要验证过的固定账户启动器资源部署到客户机受控目录。
   * Purpose: Deploys digest-verified fixed account launcher assets into controlled guest directories.
   * 设计：先检查目录及已安装版本，独占暂存后核验再发布；失败清理本次暂存，不能回退到任意项目源码编译。
   * Design: Directories/existing builds are checked, exclusive staging is verified before publication and failure cleans staging without arbitrary source fallback.
   * 输入 / Inputs: vmId: string; source: Awaited<ReturnType<typeof projectIdentitySources>>; signal: AbortSignal optional
   * 输出 / Returns: `source.manifest.build`.
   * 副作用 / Effects: `this.machines.exec`; `this.machines.writeGuestFile`.
   * 拒绝 / Refusals: 条件 / conditions `ready.code !== 0`; `created.code !== 0`; `result.code !== 0`; 异常 / errors `new AppError('无法安装项目账户启动器工具', 502, 'PROJECT_IDENTITY_INSTALL_FAILED')`; `new AppError('无法创建项目启动器安装目录', 502)`.
   * 收尾：退出 try 区域时始终执行 `const cleanup = `import os,stat\np=${JSON.stringify(stage)}\ntry:\n i=os.lstat(p)\nexcept FileNotFoundError: raise SystemExit…`; `for (let attempt = 0; attempt < 3; attempt++) { try { const result = await this.machines.exec(vmId, `${fixedEnvironment} /usr…`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `const cleanup = `import os,stat\np=${JSON.stringify(stage)}\ntry:\n i=os.lstat(p)\nexcept FileNotFoundError: raise SystemExit…`; `for (let attempt = 0; attempt < 3; attempt++) { try { const result = await this.machines.exec(vmId, `${fixedEnvironment} /usr…`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `if (attempt === 2) throw new AppError('项目启动器安装临时目录清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (attempt === 2) throw new AppError('项目启动器安装临时目录清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async installSource(vmId: string, source: Awaited<ReturnType<typeof projectIdentitySources>>, signal?: AbortSignal) {
    const distro = this.machines.get(vmId).distro || 'alpine';
    const packages = distro === 'alpine' ? 'apk add --no-cache --timeout 30 python3 gcc musl-dev linux-headers iproute2 openssl shadow nftables' :
      'export DEBIAN_FRONTEND=noninteractive; apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update; apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y python3 gcc libc6-dev iproute2 openssl passwd nftables';
    // Installation is outside all project environment and shell initialization.
    const ready = await this.machines.exec(vmId, `${fixedEnvironment} /bin/sh -ec ${quote(`if ! command -v python3 >/dev/null || ! command -v cc >/dev/null || ! command -v ip >/dev/null || ! command -v openssl >/dev/null || ! command -v useradd >/dev/null || ! command -v groupadd >/dev/null || ! command -v nft >/dev/null; then ${packages}; fi`)}`, 300000, signal);
    if (ready.code !== 0) throw new AppError('无法安装项目账户启动器工具', 502, 'PROJECT_IDENTITY_INSTALL_FAILED');
    const stage = '/tmp/.sakura-project-identity-' + randomUUID();
    try {
      const created = await this.machines.exec(vmId, `${fixedEnvironment} /bin/sh -ec ${quote(`umask 077; mkdir ${quote(stage)}`)}`, 10000, signal);
      if (created.code !== 0) throw new AppError('无法创建项目启动器安装目录', 502);
      for (const [name, bytes] of source.files)
        await this.machines.writeGuestFile(vmId, stage + '/' + name, bytes.toString('utf8'));
      await this.machines.writeGuestFile(vmId, stage + '/manifest.json', JSON.stringify(source.manifest));
      const bootstrap = `import hashlib,json,os,stat,subprocess,sys,tempfile
stage=${JSON.stringify(stage)}; destination=${JSON.stringify(source.directory)}; names=['protocol.h','launcher.c','controller.py']
def secure(path):
 info=os.lstat(path)
 if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022: raise RuntimeError('untrusted directory')
for folder in ['/usr','/usr/local','/usr/local/lib','/usr/local/lib/sakura-project-identity']:
 try: os.mkdir(folder,0o755)
 except FileExistsError: pass
 secure(folder)
secure(stage)
try: os.mkdir(destination,0o755)
except FileExistsError: pass
secure(destination)
manifest=json.load(open(stage+'/manifest.json')); aggregate=hashlib.sha256()
if manifest!={${JSON.stringify('version')}:1,${JSON.stringify('build')}:${JSON.stringify(source.manifest.build)},${JSON.stringify('files')}:${JSON.stringify(source.manifest.files)}}: raise RuntimeError('manifest mismatch')
for expected in manifest['files']:
 name=expected['name']; descriptor=os.open(stage+'/'+name,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(descriptor,'rb') as stream:
  info=os.fstat(stream.fileno())
  if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022 or info.st_nlink!=1: raise RuntimeError('source permissions')
  data=stream.read(262145)
 if len(data)!=expected['size'] or hashlib.sha256(data).hexdigest()!=expected['sha256']: raise RuntimeError('source digest')
 aggregate.update(name.encode()); aggregate.update(data)
 path=destination+'/'+name
 if os.path.lexists(path):
  info=os.lstat(path)
  if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1 or open(path,'rb').read()!=data: raise RuntimeError('installed source changed')
 else:
  descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(descriptor,'wb') as stream: stream.write(data); stream.flush(); os.fsync(stream.fileno())
if aggregate.hexdigest()!=manifest['build']: raise RuntimeError('build digest')
launch=destination+'/launch'
if not os.path.lexists(launch):
 descriptor,temporary=tempfile.mkstemp(prefix='.launch-',dir=destination); os.close(descriptor)
 try:
  subprocess.run(['/usr/bin/cc','-std=c11','-O2','-Wall','-Wextra','-Werror','-fstack-protector-strong','-D_FORTIFY_SOURCE=2','-DPROJECT_BUILD="'+manifest['build']+'"',destination+'/launcher.c','-o',temporary],env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C','HOME':'/'},check=True,timeout=120)
  os.chmod(temporary,0o4755); os.replace(temporary,launch)
 finally:
  if os.path.exists(temporary): os.unlink(temporary)
info=os.lstat(launch)
if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o4755 or info.st_nlink!=1: raise RuntimeError('launcher replaced')
path=destination+'/manifest.json'; data=json.dumps(manifest,separators=(',',':')).encode()
if os.path.lexists(path):
 info=os.lstat(path)
 if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1 or json.load(open(path))!=manifest: raise RuntimeError('manifest replaced')
else:
 descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(descriptor,'wb') as stream: stream.write(data); stream.flush(); os.fsync(stream.fileno())
directory=os.open(destination,os.O_DIRECTORY); os.fsync(directory); os.close(directory)
`;
      const result = await this.machines.exec(vmId, `${fixedEnvironment} /usr/bin/python3 -I -S - <<'SAKURA_IDENTITY_INSTALL'\n${bootstrap}\nSAKURA_IDENTITY_INSTALL`, 180000, signal);
      if (result.code !== 0) throw new AppError('项目启动器安装身份或编译校验失败：' + result.stderr.slice(0, 4000), 502, 'PROJECT_IDENTITY_INSTALL_FAILED');
      const verified = await this.machines.exec(vmId, this.controlCommand(source.manifest.build, { action: 'install' }), 30000, signal);
      if (verified.code !== 0 || !JSON.parse(verified.stdout).ok)
        throw new AppError('项目账户安装回执无法核对', 502, 'PROJECT_IDENTITY_INSTALL_FAILED');
      return source.manifest.build;
    } finally {
      // Exact stage only; no caller-supplied path, recursive removal or project
      // directory permission changes. Retry after an interrupted transport.
      const cleanup = `import os,stat\np=${JSON.stringify(stage)}\ntry:\n i=os.lstat(p)\nexcept FileNotFoundError: raise SystemExit(0)\nif not stat.S_ISDIR(i.st_mode) or i.st_uid!=0 or stat.S_IMODE(i.st_mode)!=0o700: raise SystemExit(1)\nallowed={'protocol.h','launcher.c','controller.py','manifest.json'}\nif not set(os.listdir(p)).issubset(allowed): raise SystemExit(1)\nfor name in os.listdir(p):\n i=os.lstat(p+'/'+name)\n if not stat.S_ISREG(i.st_mode) or i.st_uid!=0 or i.st_nlink!=1: raise SystemExit(1)\n os.unlink(p+'/'+name)\nd=os.open(p,os.O_DIRECTORY|os.O_NOFOLLOW); os.fsync(d); os.close(d)\nos.rmdir(p)\nd=os.open('/tmp',os.O_DIRECTORY); os.fsync(d); os.close(d)\n`;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await this.machines.exec(vmId, `${fixedEnvironment} /usr/bin/python3 -I -S - <<'SAKURA_IDENTITY_CLEANUP'\n${cleanup}\nSAKURA_IDENTITY_CLEANUP`, 10000);
          if (result.code === 0) break;
          if (attempt === 2) throw new AppError('项目启动器安装临时目录清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        } catch { if (attempt === 2) throw new AppError('项目启动器安装临时目录清理未确认', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'); }
      }
    }
  }

  /**
   * 入口 / Entry: ProjectIdentities.ensure.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await this.control(vmId, { action: 'ensure', ...input, ...(expected ? { expected: projectIdentityExpectedSchema.parse(expecte…` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `await this.control(vmId, { action: 'ensure', ...input, ...(expected ? { expected: projectIdentityExpectedSchema.parse(expecte…` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `z.object().strict().parse`, `z.object().strict`, `z.object`, `z.enum` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.object().strict().parse`, `z.object().strict`, `z.object`, `z.enum`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; binding: { projectId: string; directory: string; networkIsolation: 'host' | 'private' }; expected: ProjectIdentityExpected optional; signal: AbortSignal optional
   * 输出 / Returns: `await this.control(vmId, { action: 'ensure', ...input, ...(expected ? { expected: projectIdentityExpectedSchema.parse(expecte…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async ensure(vmId: string, binding: { projectId: string; directory: string; networkIsolation: 'host' | 'private' }, expected?: ProjectIdentityExpected, signal?: AbortSignal) {
    const input = z.object({ projectId, directory, networkIsolation: z.enum(['host', 'private']) }).strict().parse(binding);
    return await this.control(vmId, { action: 'ensure', ...input, ...(expected ? { expected: projectIdentityExpectedSchema.parse(expected) } : {}) }, projectIdentitySchema, signal);
  }
  /**
   * 入口 / Entry: ProjectIdentities.inspect.
   * 功能：在校验项目账户、网络和运行票据中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `await this.control(vmId, { action: 'inspect', projectId: projectId.parse(id) }, projectIdentitySchema.nullable(), signal)` 供上层消费（`ProjectIdentities`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectIdentities`; this entry produces `await this.control(vmId, { action: 'inspect', projectId: projectId.parse(id) }, projectIdentitySchema.nullable(), signal)` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `this.control`, `projectId.parse`, `projectIdentitySchema.nullable` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.control`, `projectId.parse`, `projectIdentitySchema.nullable`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; id: string; signal: AbortSignal optional
   * 输出 / Returns: `await this.control(vmId, { action: 'inspect', projectId: projectId.parse(id) }, projectIdentitySchema.nullable(), signal)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async inspect(vmId: string, id: string, signal?: AbortSignal) {
    return await this.control(vmId, { action: 'inspect', projectId: projectId.parse(id) }, projectIdentitySchema.nullable(), signal);
  }
  /**
   * 入口 / Entry: ProjectIdentities.prepare.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `run` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `run` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `this.control`, `expectedIdentity`, `uuid.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `this.control`, `expectedIdentity`, `uuid.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; options: { runId?: string } default={}; signal: AbortSignal optional
   * 输出 / Returns: `run`.
   * 副作用 / Effects: 更新 / updates `identity`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async prepare(vmId: string, identity: ProjectIdentity, options: { runId?: string } = {}, signal?: AbortSignal) {
    identity = projectIdentitySchema.parse(identity);
    const run = await this.control(vmId, { action: 'prepare', projectId: identity.projectId, expected: expectedIdentity(identity),
      runId: options.runId ? uuid.parse(options.runId) : randomUUID() }, projectIdentityRunSchema, signal);
    this.match(identity, run); return run;
  }
  /**
   * 入口 / Entry: ProjectIdentities.sshSnapshotInput.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ input, sha256, build, runId, command: this.controlCommand(build, { action: 'ssh-snapshot', projectId: identity.projectId, e…` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `{ input, sha256, build, runId, command: this.controlCommand(build, { action: 'ssh-snapshot', projectId: identity.projectId, e…` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `uuid.parse`, `executableOptionsSchema.parse`, `expectedIdentity` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `uuid.parse`, `executableOptionsSchema.parse`, `expectedIdentity`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: identity: ProjectIdentity; runId: string; environment: Record<string, string> default={}
   * 输出 / Returns: Promise<ProjectIdentitySshSnapshot>；结果来自 / values from `{ input, sha256, build, runId, command: this.controlCommand(build, { action: 'ssh-snapshot', projectId: identity.projectId, e…`.
   * 副作用 / Effects: `executableOptionsSchema.parse`; `createHash().update().digest`; `createHash().update`; `createHash`; 更新 / updates `identity`, `runId`.
   * 拒绝 / Refusals: 条件 / conditions `identity.phase !== 'active'`; `input.length > 131072`; 异常 / errors `new AppError('项目账户尚未完成', 409, 'PROJECT_IDENTITY_INCOMPLETE')`; `new AppError('项目 SSH 环境超过传输边界', 413)`.
   */
  async sshSnapshotInput(identity: ProjectIdentity, runId: string,
    environment: Record<string, string> = {}): Promise<ProjectIdentitySshSnapshot> {
    identity = projectIdentitySchema.parse(identity); runId = uuid.parse(runId);
    if (identity.phase !== 'active') throw new AppError('项目账户尚未完成', 409, 'PROJECT_IDENTITY_INCOMPLETE');
    const validated = executableOptionsSchema.parse({ command: 'true', environment });
    const input = Buffer.from(JSON.stringify({ version: 1, projectId: identity.projectId, runId,
      identity: expectedIdentity(identity), environment: validated.environment }));
    if (input.length > 131072) throw new AppError('项目 SSH 环境超过传输边界', 413);
    const sha256 = createHash('sha256').update(input).digest('hex'), build = (await this.build()).manifest.build;
    return { input, sha256, build, runId, command: this.controlCommand(build, { action: 'ssh-snapshot',
      projectId: identity.projectId, expected: expectedIdentity(identity), runId, snapshotSha256: sha256 }) };
  }
  /**
   * 入口 / Entry: ProjectIdentities.publishSshSnapshot.
   * 功能：在校验项目账户、网络和运行票据中，校验并提交领域状态变更；完成下述调用及状态处理（`ProjectIdentities`）。
   * Purpose: Validates and commits a domain state change in `ProjectIdentities`; the calls and state transitions below complete the operation. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `this.build`, `createHash().update().digest`, `createHash().update` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `this.build`, `createHash().update().digest`, `createHash().update`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; snapshot: ProjectIdentitySshSnapshot; signal: AbortSignal optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`; `this.machines.execInput`; 更新 / updates `identity`, `reply`.
   * 拒绝 / Refusals: 条件 / conditions `snapshot.build !== source.manifest.build || createHash('sha256').update(snapshot.input).digest('hex') !== snapshot.sha256`; `result.code !== 0 || reply.result.projectId !== identity.projectId || reply.result.runId !== snapshot.runId || reply.result.s…`; 异常 / errors `new AppError('项目 SSH 环境快照已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`; `new AppError('项目 SSH 环境快照写入未确认', 409, 'PROJECT_IDENTITY_SSH_SNAPSHOT_FAILED')`.
   * 失败处理：catch 分支执行 `throw new AppError('项目 SSH 环境快照写入未确认', 409, 'PROJECT_IDENTITY_SSH_SNAPSHOT_FAILED');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('项目 SSH 环境快照写入未确认', 409, 'PROJECT_IDENTITY_SSH_SNAPSHOT_FAILED');`; these statements determine whether a failure is absorbed or rejected again.
   */
  async publishSshSnapshot(vmId: string, identity: ProjectIdentity, snapshot: ProjectIdentitySshSnapshot,
    signal?: AbortSignal) {
    identity = projectIdentitySchema.parse(identity);
    const source = await this.build();
    if (snapshot.build !== source.manifest.build || createHash('sha256').update(snapshot.input).digest('hex') !== snapshot.sha256)
      throw new AppError('项目 SSH 环境快照已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    const command = this.controlCommand(snapshot.build, { action: 'ssh-snapshot', projectId: identity.projectId,
      expected: expectedIdentity(identity), runId: uuid.parse(snapshot.runId), snapshotSha256: digest.parse(snapshot.sha256) });
    const result = await this.machines.execInput(vmId, command, snapshot.input, 40000, signal);
    const schema = z.object({ ok: z.literal(true), result: z.object({ version: z.literal(1), projectId,
      runId: uuid, snapshotSha256: digest }).strict() }).strict();
    let reply: z.infer<typeof schema>;
    try { reply = schema.parse(JSON.parse(result.stdout)); } catch {
      throw new AppError('项目 SSH 环境快照写入未确认', 409, 'PROJECT_IDENTITY_SSH_SNAPSHOT_FAILED');
    }
    if (result.code !== 0 || reply.result.projectId !== identity.projectId || reply.result.runId !== snapshot.runId ||
        reply.result.snapshotSha256 !== snapshot.sha256)
      throw new AppError('项目 SSH 环境快照不属于本次运行', 409, 'PROJECT_IDENTITY_SSH_SNAPSHOT_FAILED');
  }
  /**
   * 入口 / Entry: ProjectIdentities.prepareSsh.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `run` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `run` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `projectIdentitySshDaemonSchema.parse`, `names.includes`, `this.control` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `projectIdentitySshDaemonSchema.parse`, `names.includes`, `this.control`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; options: { runId: string; snapshotSha256: string; daemon: ProjectIdentitySshDaemon }; signal: AbortSignal optional
   * 输出 / Returns: `run`.
   * 副作用 / Effects: 更新 / updates `identity`.
   * 拒绝 / Refusals: 条件 / conditions `!names.includes(daemon.cgroupName)`; `run.mode !== 'inherit-current' || run.phase !== 'active' || run.runId !== options.runId || run.bootId !== daemon.bootId || ru…`; 异常 / errors `new AppError('SSH 服务域属于其他项目', 409, 'PROJECT_IDENTITY_RUN_STALE')`; `new AppError('项目 SSH 完整运行归属未确认', 409, 'PROJECT_IDENTITY_RUN_STALE')`.
   */
  async prepareSsh(vmId: string, identity: ProjectIdentity, options: { runId: string;
    snapshotSha256: string; daemon: ProjectIdentitySshDaemon }, signal?: AbortSignal) {
    identity = projectIdentitySchema.parse(identity);
    const daemon = projectIdentitySshDaemonSchema.parse(options.daemon);
    const names = ['openrc.sakura-ssh-' + identity.projectId, 'system.slice/sakura-ssh-' + identity.projectId + '.service'];
    if (!names.includes(daemon.cgroupName)) throw new AppError('SSH 服务域属于其他项目', 409, 'PROJECT_IDENTITY_RUN_STALE');
    const run = await this.control(vmId, { action: 'ssh-prepare', projectId: identity.projectId,
      expected: expectedIdentity(identity), runId: uuid.parse(options.runId),
      snapshotSha256: digest.parse(options.snapshotSha256), daemon }, projectIdentityRunSchema, signal);
    this.match(identity, run);
    if (run.mode !== 'inherit-current' || run.phase !== 'active' || run.runId !== options.runId ||
        run.bootId !== daemon.bootId || run.cgroupName !== daemon.cgroupName)
      throw new AppError('项目 SSH 完整运行归属未确认', 409, 'PROJECT_IDENTITY_RUN_STALE');
    return run;
  }
  /**
   * 入口 / Entry: ProjectIdentities.sshSessionCommand.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.controlCommand(snapshot.build, { action: 'ssh-session', projectId: identity.projectId, expected: expectedIdentity(identi…` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `this.controlCommand(snapshot.build, { action: 'ssh-session', projectId: identity.projectId, expected: expectedIdentity(identi…` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `this.build`, `this.controlCommand().slice`, `this.controlCommand` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `this.build`, `this.controlCommand().slice`, `this.controlCommand`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: identity: ProjectIdentity; snapshot: Pick<ProjectIdentitySshSnapshot, 'build' | 'runId' | 'sha256'>
   * 输出 / Returns: `this.controlCommand(snapshot.build, { action: 'ssh-session', projectId: identity.projectId, expected: expectedIdentity(identi…`.
   * 副作用 / Effects: 更新 / updates `identity`.
   * 拒绝 / Refusals: 条件 / conditions `source.manifest.build !== snapshot.build`; 异常 / errors `new AppError('SSH 启动器构建已改变', 409, 'PROJECT_IDENTITY_RUN_BUILD_STALE')`.
   */
  async sshSessionCommand(identity: ProjectIdentity, snapshot: Pick<ProjectIdentitySshSnapshot, 'build' | 'runId' | 'sha256'>) {
    identity = projectIdentitySchema.parse(identity);
    const source = await this.build();
    if (source.manifest.build !== snapshot.build) throw new AppError('SSH 启动器构建已改变', 409, 'PROJECT_IDENTITY_RUN_BUILD_STALE');
    // SSH_ORIGINAL_COMMAND and the environment snapshot are data consumed by
    // the fixed controller; neither is included in this privileged argv.
    return this.controlCommand(snapshot.build, { action: 'ssh-session', projectId: identity.projectId,
      expected: expectedIdentity(identity), runId: uuid.parse(snapshot.runId), snapshotSha256: digest.parse(snapshot.sha256) })
      .slice(fixedEnvironment.length + 1);
  }
  /**
   * 入口 / Entry: ProjectIdentities.match.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; the calls and state transitions below complete the operation. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 输入 / Inputs: identity: ProjectIdentity; run: ProjectIdentityRun
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `identity[key] !== run[key]`; `run.namespace !== (identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : '')`; 异常 / errors `new AppError('项目运行票据属于其他账户或版本', 409, 'PROJECT_IDENTITY_RUN_STALE')`; `new AppError('项目运行网络绑定不符', 409, 'PROJECT_IDENTITY_RUN_STALE')`.
   */
  private match(identity: ProjectIdentity, run: ProjectIdentityRun) {
    for (const key of ['registryId', 'identityId', 'projectId', 'revision'] as const)
      if (identity[key] !== run[key]) throw new AppError('项目运行票据属于其他账户或版本', 409, 'PROJECT_IDENTITY_RUN_STALE');
    if (run.namespace !== (identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : ''))
      throw new AppError('项目运行网络绑定不符', 409, 'PROJECT_IDENTITY_RUN_STALE');
  }
  /**
   * 入口 / Entry: ProjectIdentities.input.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...payload, command: fixedEnvironment + ' ' + args.map(quote).join(' ') }` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `{ ...payload, command: fixedEnvironment + ' ' + args.map(quote).join(' ') }` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `projectIdentityRunSchema.parse`, `this.match`, `projectIdentityPayload` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `projectIdentityRunSchema.parse`, `this.match`, `projectIdentityPayload`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: identity: ProjectIdentity; run: ProjectIdentityRun; execution: ProjectIdentityExecution
   * 输出 / Returns: ProjectIdentityInput；结果来自 / values from `{ ...payload, command: fixedEnvironment + ' ' + args.map(quote).join(' ') }`.
   * 副作用 / Effects: `args.push`; 更新 / updates `identity`, `run`.
   * 拒绝 / Refusals: 条件 / conditions `identity.phase !== 'active' || run.phase !== 'active'`; 异常 / errors `new AppError('项目账户或运行票据已关闭', 409, 'PROJECT_IDENTITY_RUN_CLOSED')`.
   */
  input(identity: ProjectIdentity, run: ProjectIdentityRun, execution: ProjectIdentityExecution): ProjectIdentityInput {
    identity = projectIdentitySchema.parse(identity); run = projectIdentityRunSchema.parse(run); this.match(identity, run);
    if (identity.phase !== 'active' || run.phase !== 'active') throw new AppError('项目账户或运行票据已关闭', 409, 'PROJECT_IDENTITY_RUN_CLOSED');
    const payload = projectIdentityPayload(execution);
    const args = ['/usr/local/lib/sakura-project-identity/' + run.build + '/launch', '--project', identity.projectId,
      identity.identityId, String(identity.revision), run.runId];
    args.push('--payload', payload.sha256);
    return { ...payload, command: fixedEnvironment + ' ' + args.map(quote).join(' ') };
  }
  /**
   * 入口 / Entry: ProjectIdentities.selfInput.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...payload, command: fixedEnvironment + ' ' + args.map(quote).join(' ') }` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `{ ...payload, command: fixedEnvironment + ' ' + args.map(quote).join(' ') }` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentityRunSchema.parse`, `projectIdentityPayload`, `args.push`, `args.map().join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentityRunSchema.parse`, `projectIdentityPayload`, `args.push`, `args.map().join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: run: ProjectIdentityRun; execution: ProjectIdentityExecution
   * 输出 / Returns: ProjectIdentityInput；结果来自 / values from `{ ...payload, command: fixedEnvironment + ' ' + args.map(quote).join(' ') }`.
   * 副作用 / Effects: `args.push`; 更新 / updates `run`.
   * 拒绝 / Refusals: 条件 / conditions `run.phase !== 'active'`; 异常 / errors `new AppError('项目运行票据已关闭', 409)`.
   */
  selfInput(run: ProjectIdentityRun, execution: ProjectIdentityExecution): ProjectIdentityInput {
    run = projectIdentityRunSchema.parse(run);
    if (run.phase !== 'active') throw new AppError('项目运行票据已关闭', 409);
    const payload = projectIdentityPayload(execution);
    const args = ['/usr/local/lib/sakura-project-identity/' + run.build + '/launch', '--self', run.runId];
    args.push('--payload', payload.sha256);
    return { ...payload, command: fixedEnvironment + ' ' + args.map(quote).join(' ') };
  }
  /**
   * 入口 / Entry: ProjectIdentities.command.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; the calls and state transitions below complete the operation. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 输入 / Inputs: _identity: ProjectIdentity; _run: ProjectIdentityRun; _execution: ProjectIdentityExecution
   * 输出 / Returns: never.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `new AppError('项目命令必须使用受保护 stdin payload 运输', 409, 'PROJECT_IDENTITY_PAYLOAD_REQUIRED')`.
   */
  command(_identity: ProjectIdentity, _run: ProjectIdentityRun, _execution: ProjectIdentityExecution): never {
    throw new AppError('项目命令必须使用受保护 stdin payload 运输', 409, 'PROJECT_IDENTITY_PAYLOAD_REQUIRED');
  }
  /**
   * 入口 / Entry: ProjectIdentities.selfCommand.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; the calls and state transitions below complete the operation. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 输入 / Inputs: _run: ProjectIdentityRun; _execution: ProjectIdentityExecution
   * 输出 / Returns: never.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `new AppError('项目命令必须使用受保护 stdin payload 运输', 409, 'PROJECT_IDENTITY_PAYLOAD_REQUIRED')`.
   */
  selfCommand(_run: ProjectIdentityRun, _execution: ProjectIdentityExecution): never {
    throw new AppError('项目命令必须使用受保护 stdin payload 运输', 409, 'PROJECT_IDENTITY_PAYLOAD_REQUIRED');
  }
  /**
   * 入口 / Entry: ProjectIdentities.exec.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await this.machines.execInput(vmId, plan.command, plan.input, timeout, signal)` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `await this.machines.execInput(vmId, plan.command, plan.input, timeout, signal)` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `this.input`, `this.machines.execInput`, `this.stop` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.input`, `this.machines.execInput`, `this.stop`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; run: ProjectIdentityRun; execution: ProjectIdentityExecution; signal: AbortSignal optional; timeout: default=30000
   * 输出 / Returns: `await this.machines.execInput(vmId, plan.command, plan.input, timeout, signal)`.
   * 副作用 / Effects: `this.machines.execInput`; `this.stop`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `await this.stop(vmId, identity, run);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await this.stop(vmId, identity, run);`; these steps also apply to exceptional exits.
   */
  async exec(vmId: string, identity: ProjectIdentity, run: ProjectIdentityRun, execution: ProjectIdentityExecution, signal?: AbortSignal, timeout = 30000) {
    try {
      const plan = this.input(identity, run, execution);
      return await this.machines.execInput(vmId, plan.command, plan.input, timeout, signal);
    }
    finally { await this.stop(vmId, identity, run); }
  }
  /**
   * 入口 / Entry: ProjectIdentities.inheritedInput.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...payload, runId, command: this.controlCommand(source.manifest.build, { action: execution.stdin === 'session' ? 'exec-curr…` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `{ ...payload, runId, command: this.controlCommand(source.manifest.build, { action: execution.stdin === 'session' ? 'exec-curr…` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `projectIdentityPayload`, `this.build`, `uuid.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `projectIdentityPayload`, `this.build`, `uuid.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: identity: ProjectIdentity; execution: ProjectIdentityExecution; options: { runId?: string } default={}
   * 输出 / Returns: Promise<ProjectIdentityInheritedInput>；结果来自 / values from `{ ...payload, runId, command: this.controlCommand(source.manifest.build, { action: execution.stdin === 'session' ? 'exec-curr…`.
   * 副作用 / Effects: 更新 / updates `identity`.
   * 拒绝 / Refusals: 条件 / conditions `identity.phase !== 'active'`; 异常 / errors `new AppError('项目账户尚未完成', 409, 'PROJECT_IDENTITY_INCOMPLETE')`.
   */
  async inheritedInput(identity: ProjectIdentity, execution: ProjectIdentityExecution, options: { runId?: string } = {}): Promise<ProjectIdentityInheritedInput> {
    identity = projectIdentitySchema.parse(identity); const payload = projectIdentityPayload(execution);
    if (identity.phase !== 'active') throw new AppError('项目账户尚未完成', 409, 'PROJECT_IDENTITY_INCOMPLETE');
    const source = await this.build();
    // Called inside a registered root task/main/service cgroup. The root
    // controller captures its own actual membership; no path/FD number can be
    // supplied by a project. The C launcher reopens and checks the pinned FD.
    const runId = options.runId ? uuid.parse(options.runId) : randomUUID();
    return { ...payload, runId, command: this.controlCommand(source.manifest.build, { action: execution.stdin === 'session' ? 'exec-current-session' : 'exec-current', projectId: identity.projectId,
      expected: expectedIdentity(identity), runId, payloadSha256: payload.sha256 }) };
  }
  /**
   * 入口 / Entry: ProjectIdentities.inheritedCommand.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; the calls and state transitions below complete the operation. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 输入 / Inputs: _identity: ProjectIdentity; _execution: ProjectIdentityExecution; _options: { runId?: string } default={}
   * 输出 / Returns: Promise<never>.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `new AppError('继承运行必须使用受保护 stdin payload 运输', 409, 'PROJECT_IDENTITY_PAYLOAD_REQUIRED')`.
   */
  async inheritedCommand(_identity: ProjectIdentity, _execution: ProjectIdentityExecution, _options: { runId?: string } = {}): Promise<never> {
    throw new AppError('继承运行必须使用受保护 stdin payload 运输', 409, 'PROJECT_IDENTITY_PAYLOAD_REQUIRED');
  }
  /**
   * 入口 / Entry: ProjectIdentities.status.
   * 功能：在校验项目账户、网络和运行票据中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `await this.control(vmId, { action: 'status', projectId: identity.projectId, expected: expectedIdentity(identity), runId: run.…` 供上层消费（`ProjectIdentities`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectIdentities`; this entry produces `await this.control(vmId, { action: 'status', projectId: identity.projectId, expected: expectedIdentity(identity), runId: run.…` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `projectIdentityRunSchema.parse`, `this.match`, `this.control` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `projectIdentityRunSchema.parse`, `this.match`, `this.control`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; run: ProjectIdentityRun; signal: AbortSignal optional
   * 输出 / Returns: `await this.control(vmId, { action: 'status', projectId: identity.projectId, expected: expectedIdentity(identity), runId: run.…`.
   * 副作用 / Effects: 更新 / updates `identity`, `run`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async status(vmId: string, identity: ProjectIdentity, run: ProjectIdentityRun, signal?: AbortSignal) {
    identity = projectIdentitySchema.parse(identity); run = projectIdentityRunSchema.parse(run); this.match(identity, run);
    return await this.control(vmId, { action: 'status', projectId: identity.projectId, expected: expectedIdentity(identity), runId: run.runId },
      z.object({ run: projectIdentityRunSchema, populated: z.boolean() }).strict(), signal);
  }
  /**
   * 入口 / Entry: ProjectIdentities.run.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `run` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `run` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `this.control`, `expectedIdentity`, `uuid.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `this.control`, `expectedIdentity`, `uuid.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; runId: string; signal: AbortSignal optional
   * 输出 / Returns: `run`.
   * 副作用 / Effects: 更新 / updates `identity`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async run(vmId: string, identity: ProjectIdentity, runId: string, signal?: AbortSignal) {
    identity = projectIdentitySchema.parse(identity);
    const run = await this.control(vmId, { action: 'run', projectId: identity.projectId,
      expected: expectedIdentity(identity), runId: uuid.parse(runId) }, projectIdentityRunSchema, signal);
    this.match(identity, run); return run;
  }
  /**
   * 入口 / Entry: ProjectIdentities.runReadonly.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `run` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `run` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `this.build`, `this.control`, `expectedIdentity` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `this.build`, `this.control`, `expectedIdentity`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; runId: string; signal: AbortSignal optional
   * 输出 / Returns: `run`.
   * 副作用 / Effects: 更新 / updates `identity`.
   * 拒绝 / Refusals: 条件 / conditions `run.build !== source.manifest.build`; 异常 / errors `new AppError('只读运行票据属于其他启动器构建', 409, 'PROJECT_IDENTITY_RUN_BUILD_STALE')`.
   */
  async runReadonly(vmId: string, identity: ProjectIdentity, runId: string, signal?: AbortSignal) {
    identity = projectIdentitySchema.parse(identity);
    const source = await this.build();
    // No install probe, package manager, stage, directory or registry creation.
    // The pinned current controller itself verifies its source and acquires an
    // existing SH lock. Missing/changed images and receipts remain errors.
    const run = await this.control(vmId, { action: 'run-readonly', projectId: identity.projectId,
      expected: expectedIdentity(identity), runId: uuid.parse(runId) }, projectIdentityRunSchema, signal, true);
    this.match(identity, run);
    if (run.build !== source.manifest.build)
      throw new AppError('只读运行票据属于其他启动器构建', 409, 'PROJECT_IDENTITY_RUN_BUILD_STALE');
    return run;
  }
  /**
   * 入口 / Entry: ProjectIdentities.terminal.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `reply` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `reply` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `projectIdentityRunSchema.parse`, `this.match`, `this.build` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `projectIdentityRunSchema.parse`, `this.match`, `this.build`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; run: ProjectIdentityRun; name: string; options: { create?: boolean; signal?: AbortSignal } default={}
   * 输出 / Returns: Promise<ProjectIdentityTerminal>；结果来自 / values from `reply`.
   * 副作用 / Effects: `name.startsWith`; 更新 / updates `identity`, `run`.
   * 拒绝 / Refusals: 条件 / conditions `run.mode !== 'independent' || run.phase !== 'active' || run.build !== source.manifest.build`; `!name.startsWith('sakura-terminal-' + identity.projectId + '-')`; `reply.name !== name || JSON.stringify(reply.run) !== JSON.stringify(run)`; 异常 / errors `new AppError('项目终端运行票据已改变', 409, 'PROJECT_IDENTITY_RUN_STALE')`; `new AppError('终端名称不属于原项目', 409, 'PROJECT_IDENTITY_RUN_STALE')`.
   */
  async terminal(vmId: string, identity: ProjectIdentity, run: ProjectIdentityRun, name: string,
    options: { create?: boolean; signal?: AbortSignal } = {}): Promise<ProjectIdentityTerminal> {
    identity = projectIdentitySchema.parse(identity); run = projectIdentityRunSchema.parse(run); this.match(identity, run);
    const source = await this.build();
    if (run.mode !== 'independent' || run.phase !== 'active' || run.build !== source.manifest.build)
      throw new AppError('项目终端运行票据已改变', 409, 'PROJECT_IDENTITY_RUN_STALE');
    projectIdentityTerminalSchema.shape.name.parse(name);
    if (!name.startsWith('sakura-terminal-' + identity.projectId + '-'))
      throw new AppError('终端名称不属于原项目', 409, 'PROJECT_IDENTITY_RUN_STALE');
    const reply = await this.control(vmId, { action: options.create ? 'terminal-create' : 'terminal-probe',
      projectId: identity.projectId, expected: expectedIdentity(identity), runId: run.runId, name },
      projectIdentityTerminalSchema, options.signal, !options.create);
    if (reply.name !== name || JSON.stringify(reply.run) !== JSON.stringify(run))
      throw new AppError('项目终端回执不属于原运行', 409, 'PROJECT_IDENTITY_RUN_STALE');
    return reply;
  }
  /**
   * 入口 / Entry: ProjectIdentities.terminalCommand.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.controlCommand(run.build, { action: 'terminal-attach', projectId: identity.projectId, expected: expectedIdentity(identit…` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `this.controlCommand(run.build, { action: 'terminal-attach', projectId: identity.projectId, expected: expectedIdentity(identit…` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `projectIdentityRunSchema.parse`, `this.match`, `this.build` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `projectIdentityRunSchema.parse`, `this.match`, `this.build`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: identity: ProjectIdentity; run: ProjectIdentityRun; name: string; readOnly: boolean
   * 输出 / Returns: `this.controlCommand(run.build, { action: 'terminal-attach', projectId: identity.projectId, expected: expectedIdentity(identit…`.
   * 副作用 / Effects: `name.startsWith`; 更新 / updates `identity`, `run`.
   * 拒绝 / Refusals: 条件 / conditions `!name.startsWith('sakura-terminal-' + identity.projectId + '-')`; `run.mode !== 'independent' || run.phase !== 'active' || run.build !== source.manifest.build`; 异常 / errors `new AppError('终端名称不属于原项目', 409, 'PROJECT_IDENTITY_RUN_STALE')`; `new AppError('项目终端运行票据已改变', 409, 'PROJECT_IDENTITY_RUN_STALE')`.
   */
  async terminalCommand(identity: ProjectIdentity, run: ProjectIdentityRun, name: string, readOnly: boolean) {
    identity = projectIdentitySchema.parse(identity); run = projectIdentityRunSchema.parse(run); this.match(identity, run);
    const source = await this.build(); projectIdentityTerminalSchema.shape.name.parse(name);
    if (!name.startsWith('sakura-terminal-' + identity.projectId + '-'))
      throw new AppError('终端名称不属于原项目', 409, 'PROJECT_IDENTITY_RUN_STALE');
    if (run.mode !== 'independent' || run.phase !== 'active' || run.build !== source.manifest.build)
      throw new AppError('项目终端运行票据已改变', 409, 'PROJECT_IDENTITY_RUN_STALE');
    return this.controlCommand(run.build, { action: 'terminal-attach', projectId: identity.projectId,
      expected: expectedIdentity(identity), runId: run.runId, name, readOnly });
  }
  /**
   * 入口 / Entry: ProjectIdentities.retireTerminal.
   * 功能：在校验项目账户、网络和运行票据中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ProjectIdentities`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectIdentities`; the calls and state transitions below complete the operation. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `projectIdentityRunSchema.parse`, `this.match`, `this.control` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `projectIdentityRunSchema.parse`, `this.match`, `this.control`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; run: ProjectIdentityRun
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `identity`, `run`.
   * 拒绝 / Refusals: 条件 / conditions `reply.terminalId !== run.runId`; 异常 / errors `new AppError('终端清理回执不属于原运行', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
   */
  async retireTerminal(vmId: string, identity: ProjectIdentity, run: ProjectIdentityRun) {
    identity = projectIdentitySchema.parse(identity); run = projectIdentityRunSchema.parse(run); this.match(identity, run);
    const reply = await this.control(vmId, { action: 'terminal-retire', projectId: identity.projectId,
      expected: expectedIdentity(identity), runId: run.runId },
      z.object({ version: z.literal(1), terminalId: uuid, retired: z.literal(true) }).strict());
    if (reply.terminalId !== run.runId)
      throw new AppError('终端清理回执不属于原运行', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  }
  /**
   * 入口 / Entry: ProjectIdentities.stop.
   * 功能：在校验项目账户、网络和运行票据中，结束、撤销或清理本次拥有的领域资源；本入口产生 `stopped` 供上层消费（`ProjectIdentities`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectIdentities`; this entry produces `stopped` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `projectIdentityRunSchema.parse`, `this.match`, `this.control` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `projectIdentityRunSchema.parse`, `this.match`, `this.control`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `attempt !== 2`.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; run: ProjectIdentityRun; _signal: AbortSignal optional
   * 输出 / Returns: `stopped`.
   * 副作用 / Effects: 更新 / updates `identity`, `run`, `reason`.
   * 拒绝 / Refusals: 条件 / conditions `stopped.phase !== 'closed' || Object.keys(run).some(key => key !== 'phase' && stopped[key as keyof ProjectIdentityRun] !== ru…`; 异常 / errors `new AppError('停止回执不属于原运行票据', 503, 'STOP_RECEIPT_CHANGED')`; `new AppError(`项目账户运行清理未确认（${reason}）`, 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`.
   * 失败处理：catch 分支执行 `reason = error instanceof AppError && error.code ? error.code : 'CONTROL_UNCONFIRMED';`; `if (attempt !== 2) await delay(100 * (attempt + 1));`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `reason = error instanceof AppError && error.code ? error.code : 'CONTROL_UNCONFIRMED';`; `if (attempt !== 2) await delay(100 * (attempt + 1));`; these statements determine whether a failure is absorbed or rejected again.
   */
  async stop(vmId: string, identity: ProjectIdentity, run: ProjectIdentityRun, _signal?: AbortSignal) {
    identity = projectIdentitySchema.parse(identity); run = projectIdentityRunSchema.parse(run); this.match(identity, run);
    let reason = 'CONTROL_FAILED';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Cleanup deliberately uses an independent, uncancelled connection.
        const stopped = await this.control(vmId, { action: 'stop', projectId: identity.projectId,
          expected: expectedIdentity(identity), runId: run.runId }, projectIdentityRunSchema);
        if (stopped.phase !== 'closed' || Object.keys(run).some(key => key !== 'phase' &&
          stopped[key as keyof ProjectIdentityRun] !== run[key as keyof ProjectIdentityRun]))
          throw new AppError('停止回执不属于原运行票据', 503, 'STOP_RECEIPT_CHANGED');
        return stopped;
      } catch (error) {
        reason = error instanceof AppError && error.code ? error.code : 'CONTROL_UNCONFIRMED';
        if (attempt !== 2) await delay(100 * (attempt + 1));
      }
    }
    throw new AppError(`项目账户运行清理未确认（${reason}）`, 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
  }
  /**
   * 入口 / Entry: ProjectIdentities.rebind.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await this.control(vmId, { action: 'rebind', projectId: identity.projectId, expected: expectedIdentity(identity), ...input },…` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `await this.control(vmId, { action: 'rebind', projectId: identity.projectId, expected: expectedIdentity(identity), ...input },…` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `z.object().strict().parse`, `z.object().strict`, `z.object` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `z.object().strict().parse`, `z.object().strict`, `z.object`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; binding: { directory: string; networkIsolation: 'host' | 'private' }; signal: AbortSignal optional
   * 输出 / Returns: `await this.control(vmId, { action: 'rebind', projectId: identity.projectId, expected: expectedIdentity(identity), ...input },…`.
   * 副作用 / Effects: 更新 / updates `identity`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async rebind(vmId: string, identity: ProjectIdentity, binding: { directory: string; networkIsolation: 'host' | 'private' }, signal?: AbortSignal) {
    identity = projectIdentitySchema.parse(identity);
    const input = z.object({ directory, networkIsolation: z.enum(['host', 'private']) }).strict().parse(binding);
    return await this.control(vmId, { action: 'rebind', projectId: identity.projectId, expected: expectedIdentity(identity), ...input }, projectIdentitySchema, signal);
  }
  /**
   * 入口 / Entry: ProjectIdentities.network.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `network` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `network` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `this.control`, `expectedIdentity`, `projectIdentityNetworkSchema.nullable` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `this.control`, `expectedIdentity`, `projectIdentityNetworkSchema.nullable`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; signal: AbortSignal optional
   * 输出 / Returns: `network`.
   * 副作用 / Effects: 更新 / updates `identity`.
   * 拒绝 / Refusals: 条件 / conditions `network && (identity.networkIsolation !== 'private' || (['registryId', 'identityId', 'projectId', 'revision'] as const).some(…`; 异常 / errors `new AppError('项目网络记录不属于当前身份', 409, 'PROJECT_IDENTITY_NETWORK_STALE')`.
   */
  async network(vmId: string, identity: ProjectIdentity, signal?: AbortSignal) {
    identity = projectIdentitySchema.parse(identity);
    const network = await this.control(vmId, { action: 'network', projectId: identity.projectId,
      expected: expectedIdentity(identity) }, projectIdentityNetworkSchema.nullable(), signal);
    if (network && (identity.networkIsolation !== 'private' ||
        (['registryId', 'identityId', 'projectId', 'revision'] as const).some(key => network[key] !== identity[key])))
      throw new AppError('项目网络记录不属于当前身份', 409, 'PROJECT_IDENTITY_NETWORK_STALE');
    return network;
  }
  /** Inspect an existing private binding without installation or policy repair. */
  /**
   * 入口 / Entry: ProjectIdentities.networkReadonly.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `result` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `z.object().strict`, `z.object`, `z.literal` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `z.object().strict`, `z.object`, `z.literal`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; signal: AbortSignal optional
   * 输出 / Returns: `result`.
   * 副作用 / Effects: 更新 / updates `identity`.
   * 拒绝 / Refusals: 条件 / conditions `identity.phase !== 'active' || identity.networkIsolation !== 'private' || JSON.stringify(result.identity) !== JSON.stringify(…`; 异常 / errors `new AppError('项目网络检查回执不属于原账号绑定', 409, 'PROJECT_IDENTITY_NETWORK_STALE')`.
   */
  async networkReadonly(vmId: string, identity: ProjectIdentity, signal?: AbortSignal) {
    identity = projectIdentitySchema.parse(identity);
    const schema = z.object({ version: z.literal(1), identity: projectIdentitySchema,
      network: projectIdentityNetworkSchema }).strict();
    const result = await this.control(vmId, { action: 'network-readonly', projectId: identity.projectId,
      expected: expectedIdentity(identity) }, schema, signal, true);
    if (identity.phase !== 'active' || identity.networkIsolation !== 'private' ||
        JSON.stringify(result.identity) !== JSON.stringify(identity) ||
        (['registryId', 'identityId', 'projectId', 'revision'] as const).some(key => result.network[key] !== identity[key]))
      throw new AppError('项目网络检查回执不属于原账号绑定', 409, 'PROJECT_IDENTITY_NETWORK_STALE');
    return result;
  }
  /**
   * 入口 / Entry: ProjectIdentities.beginNetworkRelease.
   * 功能：在校验项目账户、网络和运行票据中，执行此领域的具体处理步骤并返回其结果；本入口产生 `lease` 供上层消费（`ProjectIdentities`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectIdentities`; this entry produces `lease` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `uuid.parse`, `this.control`, `expectedIdentity` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `uuid.parse`, `this.control`, `expectedIdentity`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; options: { releaseId: string; bootId: string }; signal: AbortSignal optional
   * 输出 / Returns: `lease`.
   * 副作用 / Effects: 更新 / updates `identity`.
   * 拒绝 / Refusals: 条件 / conditions `lease && (lease.releaseId !== releaseId || lease.network.bootId !== bootId || identity.networkIsolation !== 'private' || (['r…`; 异常 / errors `new AppError('网络冻结回执不属于原请求', 409, 'PROJECT_IDENTITY_NETWORK_STALE')`.
   */
  async beginNetworkRelease(vmId: string, identity: ProjectIdentity, options: { releaseId: string; bootId: string }, signal?: AbortSignal) {
    identity = projectIdentitySchema.parse(identity);
    const releaseId = uuid.parse(options.releaseId), bootId = uuid.parse(options.bootId);
    const lease = await this.control(vmId, { action: 'begin-network-release', projectId: identity.projectId,
      expected: expectedIdentity(identity), releaseId, bootId }, projectIdentityNetworkLeaseSchema.nullable(), signal);
    if (lease && (lease.releaseId !== releaseId || lease.network.bootId !== bootId || identity.networkIsolation !== 'private' ||
        (['registryId', 'identityId', 'projectId', 'revision'] as const).some(key => lease.network[key] !== identity[key])))
      throw new AppError('网络冻结回执不属于原请求', 409, 'PROJECT_IDENTITY_NETWORK_STALE');
    return lease;
  }
  /**
   * 入口 / Entry: ProjectIdentities.releaseNetwork.
   * 功能：在校验项目账户、网络和运行票据中，结束、撤销或清理本次拥有的领域资源；本入口产生 `released` 供上层消费（`ProjectIdentities`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectIdentities`; this entry produces `released` for its caller. Module context: Validates account/network/run tickets and installs digest-verified fixed launchers, checking complete ownership proofs.
   * 处理：通过 `projectIdentitySchema.parse`, `projectIdentityNetworkLeaseSchema.parse`, `inline.some`, `this.control` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIdentitySchema.parse`, `projectIdentityNetworkLeaseSchema.parse`, `inline.some`, `this.control`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; identity: ProjectIdentity; lease: ProjectIdentityNetworkLease; signal: AbortSignal optional
   * 输出 / Returns: `released`.
   * 副作用 / Effects: 更新 / updates `identity`, `lease`.
   * 拒绝 / Refusals: 条件 / conditions `identity.networkIsolation !== 'private' || (['registryId', 'identityId', 'projectId', 'revision'] as const).some(key => netwo…`; `released.releaseId !== releaseId || JSON.stringify(released.network) !== JSON.stringify(network)`; 异常 / errors `new AppError('网络核销请求不属于当前项目身份', 409, 'PROJECT_IDENTITY_NETWORK_STALE')`; `new AppError('网络核销回执不属于原代次', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED')`.
   * 失败处理：catch 分支执行 `const reason = error instanceof AppError && error.code ? error.code : 'CONTROL_UNCONFIRMED';`; `throw new AppError(`项目网络核销未确认（${reason}）`, 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `const reason = error instanceof AppError && error.code ? error.code : 'CONTROL_UNCONFIRMED';`; `throw new AppError(`项目网络核销未确认（${reason}）`, 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');`; these statements determine whether a failure is absorbed or rejected again.
   */
  async releaseNetwork(vmId: string, identity: ProjectIdentity, lease: ProjectIdentityNetworkLease, signal?: AbortSignal) {
    identity = projectIdentitySchema.parse(identity); lease = projectIdentityNetworkLeaseSchema.parse(lease);
    const { network, releaseId } = lease;
    if (identity.networkIsolation !== 'private' ||
        (['registryId', 'identityId', 'projectId', 'revision'] as const).some(key => network[key] !== identity[key]))
      throw new AppError('网络核销请求不属于当前项目身份', 409, 'PROJECT_IDENTITY_NETWORK_STALE');
    try {
      const released = await this.control(vmId, { action: 'release-network', projectId: identity.projectId,
        expected: expectedIdentity(identity), network, releaseId }, projectIdentityNetworkReleaseSchema, signal);
      if (released.releaseId !== releaseId || JSON.stringify(released.network) !== JSON.stringify(network))
        throw new AppError('网络核销回执不属于原代次', 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
      return released;
    } catch (error) {
      const reason = error instanceof AppError && error.code ? error.code : 'CONTROL_UNCONFIRMED';
      throw new AppError(`项目网络核销未确认（${reason}）`, 503, 'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED');
    }
  }
}
