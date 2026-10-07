/**
 * 模块职责：加载固定工程运行器并组织客户机调用，限制命令输入和结果边界并核对退出状态。
 * Module purpose: Loads fixed engineering code and constructs guest invocations, bounding inputs/results and checking exit status.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { ROOT } from './paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { vmLiveIdentity } from './vm-reference.ts';
import { projectPrivateValues } from './workspaces.ts';
import { projectVersion } from './project-config.ts';
import { guestTask } from './guest-task.ts';
import { quote } from './shell.ts';
import { redactValues } from './secrets.ts';
import { CommandPresets, presetSchema } from './command-presets.ts';
import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { projectIdentityPayload } from './project-identity.ts';
import { projectNetworkCheckScript, projectNetworkNamespace } from './project-network-isolation.ts';
import { engineeringOperations, validateOperation } from './engineering-operations.ts';
import { capabilityDefinitions, capabilityParameters, hasCapability } from './capability-definitions.ts';

let source: Promise<string> | undefined;
/**
 * 入口 / Entry: engineeringSource.
 * 功能：在加载固定工程运行器并组织客户机调用中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(source ||= readFile(join(ROOT, 'server', 'engineering-runner.py'), 'utf8').catch((error) => { if (error.code !== 'ENOENT') t…` 供上层消费（`engineering-runner.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `engineering-runner.ts`; this entry produces `(source ||= readFile(join(ROOT, 'server', 'engineering-runner.py'), 'utf8').catch((error) => { if (error.code !== 'ENOENT') t…` for its caller. Module context: Loads fixed engineering code and constructs guest invocations, bounding inputs/results and checking exit status.
 * 处理：通过 `readFile().catch`, `readFile`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `readFile().catch`, `readFile`, `join`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `(source ||= readFile(join(ROOT, 'server', 'engineering-runner.py'), 'utf8').catch((error) => { if (error.code !== 'ENOENT') t…`.
 * 副作用 / Effects: 更新 / updates `source`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function engineeringSource() {
  return (source ||= readFile(join(ROOT, 'server', 'engineering-runner.py'), 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return readFile(join(ROOT, '.sakura-server', 'assets', 'engineering-runner.py'), 'utf8');
  }));
}
export type EngineeringResult = { code: number; error?: string; [key: string]: unknown };
/**
 * 入口 / Entry: requireSuccessfulResult.
 * 功能：在加载固定工程运行器并组织客户机调用中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`engineering-runner.ts`）。
 * Purpose: Checks admission, input or resource ownership in `engineering-runner.ts`; the calls and state transitions below complete the operation. Module context: Loads fixed engineering code and constructs guest invocations, bounding inputs/results and checking exit status.
 * 输入 / Inputs: result: Record<string, unknown>
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError( String(result.error || '工程操作未通过（退出码 ' + (result.code ?? '未知') + '）'), 409, )`.
 */
export function requireSuccessfulResult(result: Record<string, unknown>) {
  if (result.code !== 0)
    throw new AppError(
      String(result.error || '工程操作未通过（退出码 ' + (result.code ?? '未知') + '）'),
      409,
    );
}

const capabilityOperations = new Set([
  'test-sharding', 'directory-history', 'disk-analyzer', 'review-comments', 'command-forms',
  'capability-command', 'environment-fingerprint', 'network-topology', 'code-search-index',
  'language-server-catalog', 'pii-classification', 'patch-bundle', 'environment-recreate',
  'format-lint', 'build-cache', 'branch-preview', 'onboarding-checklist', 'review-threads',
  'workspace-search', 'git-worktrees', 'dependency-report', 'dependency-bot', 'runtime-matrix',
  'reproducible-env', 'network-diagnostics', 'packet-capture',
]);
const internalOperations = {
  'capability-command': capabilityDefinitions['test-matrix'].schema.pick({ argv: true, timeout: true })
    .refine(({ argv }) => Boolean(argv[0]) && argv.every(arg => !arg.includes('\0')), '命令参数无效'),
  'environment-fingerprint': z.object({}).strict(),
};
// These existing operations invoke only date/ip or bounded tcpdump argv.
// They never receive project environment, a project cwd, or command text.
const administrativeOperations = new Set(['guest-clock-policy', 'static-routes', 'packet-capture']);
export const engineeringLimits = Object.freeze({
  sourceBytes: 256 * 1024, compressedSourceBytes: 48 * 1024,
  requestBytes: 64 * 1024, compressedRequestBytes: 16 * 1024,
  commandBytes: 65536, outputBytes: 8 * 1024 * 1024,
});
/**
 * 入口 / Entry: boundary.
 * 功能：从当前输入或状态计算 `new AppError('工程执行正文超过传输边界', 413, 'ENGINEERING_INPUT_TOO_LARGE')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('工程执行正文超过传输边界', 413, 'ENGINEERING_INPUT_TOO_LARGE')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('工程执行正文超过传输边界', 413, 'ENGINEERING_INPUT_TOO_LARGE')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const boundary = () => new AppError('工程执行正文超过传输边界', 413, 'ENGINEERING_INPUT_TOO_LARGE');
/**
 * 入口 / Entry: digest.
 * 功能：在加载固定工程运行器并组织客户机调用中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(value).digest('hex')` 供上层消费（`engineering-runner.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `engineering-runner.ts`; this entry produces `createHash('sha256').update(value).digest('hex')` for its caller. Module context: Loads fixed engineering code and constructs guest invocations, bounding inputs/results and checking exit status.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: Buffer
 * 输出 / Returns: `createHash('sha256').update(value).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
/**
 * 入口 / Entry: encode.
 * 功能：在加载固定工程运行器并组织客户机调用中，转换协议或持久数据表示并保持调用边界；本入口产生 `{ data: compressed.toString('base64'), bytes: value.length, sha256: digest(value) }` 供上层消费（`engineering-runner.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `engineering-runner.ts`; this entry produces `{ data: compressed.toString('base64'), bytes: value.length, sha256: digest(value) }` for its caller. Module context: Loads fixed engineering code and constructs guest invocations, bounding inputs/results and checking exit status.
 * 处理：通过 `boundary`, `deflateSync`, `compressed.toString`, `digest` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `boundary`, `deflateSync`, `compressed.toString`, `digest`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: Buffer; rawLimit: number; compressedLimit: number
 * 输出 / Returns: `{ data: compressed.toString('base64'), bytes: value.length, sha256: digest(value) }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!value.length || value.length > rawLimit`; `compressed.length > compressedLimit`; 异常 / errors `boundary()`.
 */
const encode = (value: Buffer, rawLimit: number, compressedLimit: number) => {
  if (!value.length || value.length > rawLimit) throw boundary();
  const compressed = deflateSync(value, { level: 9 });
  if (compressed.length > compressedLimit) throw boundary();
  return { data: compressed.toString('base64'), bytes: value.length, sha256: digest(value) };
};
// The installed runner source is immutable. Keep one exact-source cache rather
// than recompressing it for every project operation or caching private requests.
let encodedSource: { source: string; packed: ReturnType<typeof encode> } | undefined;
/** Trusted source is unpacked only by the selected process after UID drop. */
/**
 * 入口 / Entry: engineeringInvocation.
 * 功能：在加载固定工程运行器并组织客户机调用中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ command, ...(administrative ? { input: rawRequest } : {}) }` 供上层消费（`engineering-runner.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `engineering-runner.ts`; this entry produces `{ command, ...(administrative ? { input: rawRequest } : {}) }` for its caller. Module context: Loads fixed engineering code and constructs guest invocations, bounding inputs/results and checking exit status.
 * 处理：通过 `rawSource.toString`, `moduleSource.includes`, `boundary`, `encode` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `rawSource.toString`, `moduleSource.includes`, `boundary`, `encode`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: moduleSource: string; request: object; administrative: default=false
 * 输出 / Returns: `{ command, ...(administrative ? { input: rawRequest } : {}) }`.
 * 副作用 / Effects: 更新 / updates `encodedSource`.
 * 拒绝 / Refusals: 条件 / conditions `rawSource.toString('utf8') !== moduleSource || moduleSource.includes('\0')`; `rawRequest.length > engineeringLimits.requestBytes`; `Buffer.byteLength(command) > engineeringLimits.commandBytes`; 异常 / errors `boundary()`.
 */
export function engineeringInvocation(moduleSource: string, request: object, administrative = false) {
  const rawSource = Buffer.from(moduleSource, 'utf8');
  if (rawSource.toString('utf8') !== moduleSource || moduleSource.includes('\0')) throw boundary();
  const rawRequest = Buffer.from(JSON.stringify(request), 'utf8');
  if (rawRequest.length > engineeringLimits.requestBytes) throw boundary();
  const packedSource = encodedSource?.source === moduleSource ? encodedSource.packed :
    encode(rawSource, engineeringLimits.sourceBytes, engineeringLimits.compressedSourceBytes);
  encodedSource = { source: moduleSource, packed: packedSource };
  const packedRequest = administrative ? undefined : encode(rawRequest, engineeringLimits.requestBytes, engineeringLimits.compressedRequestBytes);
  const python = [
    'import base64,hashlib,io,sys,zlib',
    'def unpack(value,packed_limit,raw_limit,size,sha256):',
    ' packed=base64.b64decode(value,validate=True)',
    ' if len(packed)>packed_limit or not 0<size<=raw_limit: raise ValueError("Engineering transport boundary")',
    ' decoder=zlib.decompressobj()',
    ' raw=decoder.decompress(packed,raw_limit+1)',
    ' if len(raw)!=size or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail or hashlib.sha256(raw).hexdigest()!=sha256: raise ValueError("Engineering transport integrity")',
    ' return raw',
    'module=unpack(' + JSON.stringify(packedSource.data) + ',' + engineeringLimits.compressedSourceBytes + ',' +
      engineeringLimits.sourceBytes + ',' + packedSource.bytes + ',' + JSON.stringify(packedSource.sha256) + ')',
    ...(packedRequest ? [
      'request=unpack(' + JSON.stringify(packedRequest.data) + ',' + engineeringLimits.compressedRequestBytes + ',' +
        engineeringLimits.requestBytes + ',' + packedRequest.bytes + ',' + JSON.stringify(packedRequest.sha256) + ')',
    ] : [
      'request=sys.stdin.buffer.read(' + (engineeringLimits.requestBytes + 1) + ')',
      'if len(request)!=' + rawRequest.length + ' or hashlib.sha256(request).hexdigest()!=' + JSON.stringify(digest(rawRequest)) + ': raise ValueError("Engineering request integrity")',
    ]),
    'sys.stdin=io.TextIOWrapper(io.BytesIO(request),encoding="utf-8",errors="strict")',
    'exec(compile(module.decode("utf-8","strict"),"sakura-engineering-runner.py","exec"),{"__name__":"__main__","__file__":"sakura-engineering-runner.py"})',
  ].join('\n');
  const command = 'exec /usr/bin/python3 -I -S -c ' + quote(python);
  if (Buffer.byteLength(command) > engineeringLimits.commandBytes) throw boundary();
  return { command, ...(administrative ? { input: rawRequest } : {}) };
}

export type EngineeringRunOptions = {
  terminals?: Pick<ProjectTerminals, 'prepare'>;
  runProjectTask?: typeof projectIdentityTask;
  runAdministrativeTask?: typeof guestTask;
  source?: typeof engineeringSource;
  presets?: Pick<CommandPresets, 'list' | 'save' | 'close'>;
  /**
   * 签名 / Signature: EngineeringRunOptions.onResult.
   * 功能：为加载固定工程运行器并组织客户机调用声明 onResult 的输入与结果契约，所属容器为 EngineeringRunOptions。
   * Purpose: Declares the input/result contract for onResult in EngineeringRunOptions. Module responsibility: Loads fixed engineering code and constructs guest invocations, bounding inputs/results and checking exit status.
   * 输入 / Inputs: result: EngineeringResult
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  onResult?: (result: EngineeringResult) => Promise<void>;
};
/**
 * 入口 / Entry: runEngineeringOperation.
 * 功能：校验工程操作输入，部署固定 Python 运行器并在项目执行域读取结构化结果。
 * Purpose: Validates engineering input, deploys fixed Python code and reads structured results in the project execution scope.
 * 设计：命令正文和结果均有界；工具失败、非零检查以及原账户票据未签发不能当成成功结果。
 * Design: Command/results are bounded; tool failures, failed checks and unissued original account tickets cannot become successful outcomes.
 * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; id: string; operation: string; parameters: Record<string, unknown>; signal: AbortSignal; options: EngineeringRunOptions default={}
 * 输出 / Returns: Promise<EngineeringResult>；结果来自 / values from `workspaces.projects.inScope(id, projectId, async () => { const originalConfig = await workspaces.config(id); if ((originalCon…`.
 * 副作用 / Effects: 更新 / updates `parameters`.
 * 拒绝 / Refusals: 条件 / conditions `!live || machines.state(id) !== 'running'`; `operation === 'feature-run'`; 异常 / errors `new AppError('请先启动或恢复实例', 409)`; `new AppError('没有此工程执行器', 400, 'ENGINEERING_OPERATION_UNSUPPORTED')`.
 */
export async function runEngineeringOperation(
  machines: Machines, workspaces: WorkspacesV1, id: string, operation: string,
  parameters: Record<string, unknown>, signal: AbortSignal, options: EngineeringRunOptions = {},
): Promise<EngineeringResult> {
  // Choose the original scope/live synchronously, before any asynchronous read.
  const projectId = workspaces.projects.current(id), live = machines.live.get(id);
  signal.throwIfAborted();
  if (!live || machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
  if (operation === 'feature-run')
    throw new AppError('没有此工程执行器', 400, 'ENGINEERING_OPERATION_UNSUPPORTED');
  if (Object.hasOwn(internalOperations, operation))
    parameters = internalOperations[operation as keyof typeof internalOperations].parse(parameters);
  else if (Object.hasOwn(engineeringOperations, operation))
    parameters = validateOperation({ operation, parameters }).parameters;
  else if (capabilityOperations.has(operation) && hasCapability(operation))
    parameters = capabilityParameters(operation, parameters);
  else throw new AppError('没有此工程执行器', 400, 'ENGINEERING_OPERATION_UNSUPPORTED');
  parameters = structuredClone(parameters);
  /**
   * 入口 / Entry: runEngineeringOperation.callback@137.
   * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（workspaces.projects.inScope）。
   * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (workspaces.projects.inScope).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `executionSignal.throwIfAborted`; `presets.save`; `presets.close`; `prepared.release`; `ownedTerminals.close`; 更新 / updates `ownedTerminals`, `prepared`, `result`, `result.code`.
   * 拒绝 / Refusals: 条件 / conditions `(originalConfig._workspace || 'default') !== projectId`; `!captured || !executionSignal || prepared.projectId !== projectId || vmLiveIdentity(captured.live) !== vmLiveIdentity(live) |…`; `Buffer.byteLength(output.stdout) > engineeringLimits.outputBytes`; 异常 / errors `new AppError('工程任务原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`; `new AppError('工程任务准备租约不属于原项目或客户机', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   * 收尾：退出 try 区域时始终执行 `try { try { await prepared?.release(); } finally { await ownedTerminals?.close(); } } catch (error) { if (failure instanceof …`; `await presets.close();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `try { try { await prepared?.release(); } finally { await ownedTerminals?.close(); } } catch (error) { if (failure instanceof …`; `await presets.close();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `failed = true;`; `failure = error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `failed = true;`; `failure = error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  return workspaces.projects.inScope(id, projectId, async () => {
    const originalConfig = await workspaces.config(id);
    if ((originalConfig._workspace || 'default') !== projectId)
      throw new AppError('工程任务原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    const capturedConfig = structuredClone(originalConfig);
    // Workspaces deliberately keeps the scope outside the serialized config.
    // structuredClone drops non-enumerable properties; preserve this binding.
    Object.defineProperty(capturedConfig, '_workspace', { value: originalConfig._workspace, enumerable: false });
    const version = projectVersion(capturedConfig);
    /**
     * 入口 / Entry: runEngineeringOperation.assertCurrent.
     * 功能：在加载固定工程运行器并组织客户机调用中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`engineering-runner.ts`）。
     * Purpose: Checks admission, input or resource ownership in `engineering-runner.ts`; the calls and state transitions below complete the operation. Module context: Loads fixed engineering code and constructs guest invocations, bounding inputs/results and checking exit status.
     * 处理：通过 `signal.throwIfAborted`, `workspaces.config`, `workspaces.projects.current`, `machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `workspaces.config`, `workspaces.projects.current`, `machines.live.get`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `workspaces.projects.current(id) !== projectId || machines.live.get(id) !== live || machines.state(id) !== 'running' || (curre…`; 异常 / errors `new AppError('工程任务原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
     */
    const assertCurrent = async () => {
      signal.throwIfAborted();
      const currentConfig = await workspaces.config(id);
      if (workspaces.projects.current(id) !== projectId || machines.live.get(id) !== live ||
          machines.state(id) !== 'running' || (currentConfig._workspace || 'default') !== projectId ||
          projectVersion(currentConfig) !== version ||
          workspaces.projects.current(id) !== projectId || machines.live.get(id) !== live)
        throw new AppError('工程任务原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    };
    await assertCurrent();
    let ownedTerminals: ProjectTerminals | undefined;
    const terminals = options.terminals || (ownedTerminals = projectTerminalsFor(machines, workspaces));
    let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
    let failed = false, failure: unknown;
    try {
      prepared = await terminals.prepare(id, projectId, null, false, signal, undefined, { mode: 'task' });
      const { captured, signal: executionSignal } = prepared;
      if (!captured || !executionSignal || prepared.projectId !== projectId ||
          vmLiveIdentity(captured.live) !== vmLiveIdentity(live) ||
          (captured.project._workspace || 'default') !== projectId ||
          projectVersion(captured.project) !== version)
        throw new AppError('工程任务准备租约不属于原项目或客户机', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      await assertCurrent();
      const administrative = administrativeOperations.has(operation);
      const project = administrative ? capturedConfig : await workspaces.resolveProject(id, capturedConfig);
      await assertCurrent();
      executionSignal.throwIfAborted();
      const request = { operation, directory: administrative ? '/' : project.directory, environment: {},
        parameters: operation === 'guest-clock-policy' ? { ...parameters, _hostEpochMs: Date.now() } : parameters };
      const invocation = engineeringInvocation(await (options.source || engineeringSource)(), request, administrative);
      const seconds = Number(parameters.timeout || parameters.durationSeconds || 60) * Number(parameters.repeats || parameters.shards || 1);
      const steps = (parameters.steps || parameters.checks || []) as Array<{ timeout?: number }>;
      const timeout = Math.max(120000, (seconds * ((operation === 'reproducible-build' ||
        (operation === 'dependency-bot' && parameters.mode === 'apply')) ? 2 : 1) +
        steps.reduce((sum, step) => sum + Number(step.timeout || 60), 0) + 30) * 1000);
      await assertCurrent();
      executionSignal.throwIfAborted();
      if (!administrative) projectIdentityPayload({ command: invocation.command, environment: project.environment });
      const namespace = administrative ? projectNetworkNamespace(capturedConfig) : undefined;
      const administrativeCommand = administrative
        ? '/usr/bin/env -i HOME=/ USER=root LOGNAME=root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C ' +
          '/bin/sh -ec ' + quote('cd /\n' + (namespace ? projectNetworkCheckScript(namespace) + '\n' : '') +
            'exec ' + (namespace ? 'ip netns exec ' + namespace + ' ' : '') + invocation.command.slice('exec '.length))
        : undefined;
      // Native/cgroup cleanup exceptions propagate unchanged. Only a returned
      // stdout buffer is decoded, never a transport or cleanup exception.
      const output = administrative
        ? await (options.runAdministrativeTask || guestTask)(machines, id,
          administrativeCommand!,
          executionSignal, undefined, timeout, undefined, undefined, { input: invocation.input })
        : await (options.runProjectTask || projectIdentityTask)(machines, id, capturedConfig,
          { command: invocation.command, environment: project.environment }, executionSignal, undefined,
          timeout, undefined, undefined, { expectedLive: live });
      await assertCurrent();
      executionSignal.throwIfAborted();
      if (Buffer.byteLength(output.stdout) > engineeringLimits.outputBytes) throw new AppError('工程结果超过 8 MiB', 413);
      let result: EngineeringResult;
      try { result = JSON.parse(output.stdout); }
      catch {
        throw new AppError(redactValues(output.stderr || '工程执行器没有返回有效结果', projectPrivateValues(project)), 409);
      }
      if (!result || !Number.isSafeInteger(result.code)) throw new AppError('工程执行器响应缺少退出码', 502);
      if (output.code !== 0 && result.code === 0) result.code = output.code;
      if (operation === 'task-import' && parameters.save && result.code === 0) {
        const presets = options.presets || new CommandPresets(machines, workspaces);
        try {
          if (!Array.isArray(result.tasks) || result.tasks.length > 50) throw new AppError('任务导入结果无效', 409);
          const tasks = result.tasks.map((task: any) => {
            if (!task || typeof task.name !== 'string' || typeof task.command !== 'string') throw new AppError('任务导入结果无效', 409);
            return presetSchema.parse({ name: task.name.slice(0, 60), command: task.command });
          });
          await assertCurrent();
          const current = await presets.list(id);
          const additions = tasks.filter(task => !current.some(item => item.name === task.name && item.command === task.command));
          if (current.length + additions.length > 50) throw new AppError('导入后收藏命令超过 50 条，请减少任务数量');
          for (const task of additions) {
            await assertCurrent(); executionSignal.throwIfAborted();
            await presets.save(id, task);
          }
          result.saved = additions.length;
        } finally { await presets.close(); }
      }
      const privateValues = projectPrivateValues(project);
      /**
       * 入口 / Entry: runEngineeringOperation.redact.
       * 功能：在加载固定工程运行器并组织客户机调用中，执行此领域的具体处理步骤并返回其结果；本入口产生 `typeof value === 'string' ? redactValues(value, privateValues) : Array.isArray(value) ? value.map(redact) : value && typeof v…` 供上层消费（`engineering-runner.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `engineering-runner.ts`; this entry produces `typeof value === 'string' ? redactValues(value, privateValues) : Array.isArray(value) ? value.map(redact) : value && typeof v…` for its caller. Module context: Loads fixed engineering code and constructs guest invocations, bounding inputs/results and checking exit status.
       * 处理：通过 `redactValues`, `value.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `redactValues`, `value.map`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: value: unknown
       * 输出 / Returns: unknown；结果来自 / values from `typeof value === 'string' ? redactValues(value, privateValues) : Array.isArray(value) ? value.map(redact) : value && typeof v…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const redact = (value: unknown): unknown => typeof value === 'string' ? redactValues(value, privateValues)
        : Array.isArray(value) ? value.map(redact)
          : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)])) : value;
      result = redact(result) as EngineeringResult;
      await assertCurrent(); executionSignal.throwIfAborted();
      await options.onResult?.(result);
      await assertCurrent(); executionSignal.throwIfAborted();
      return result;
    } catch (error) { failed = true; failure = error; throw error; }
    finally {
      try {
        try { await prepared?.release(); } finally { await ownedTerminals?.close(); }
      } catch (error) {
        if (failure instanceof AppError && failure.status === 503) throw failure;
        if (error instanceof AppError && error.status === 503) throw error;
        if (failed) throw failure;
        throw error;
      }
    }
  });
}
