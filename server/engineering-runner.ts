import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, ROOT } from './model.ts';
import type { Machines } from './machines.ts';
import { projectPrivateValues, projectVersion, type Workspaces } from './workspaces.ts';
import { guestTask } from './guest-task.ts';
import { quote } from './files.ts';
import { redactValues } from './secrets.ts';
import { CommandPresets, presetSchema } from './command-presets.ts';
import { ProjectTerminals } from './project-terminals.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { projectIdentityPayload } from './project-identity.ts';
import { projectNetworkCheckScript, projectNetworkNamespace } from './project-network-isolation.ts';
import { engineeringOperations, validateOperation } from './engineering-operations.ts';
import { capabilityDefinitions, capabilityParameters, hasCapability } from './capability-definitions.ts';

let source: Promise<string> | undefined;
export function engineeringSource() {
  return (source ||= readFile(join(ROOT, 'server', 'engineering-runner.py'), 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return readFile(join(ROOT, '.sakura-server', 'assets', 'engineering-runner.py'), 'utf8');
  }));
}
export type EngineeringResult = { code: number; error?: string; [key: string]: unknown };
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
const boundary = () => new AppError('工程执行正文超过传输边界', 413, 'ENGINEERING_INPUT_TOO_LARGE');
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const encode = (value: Buffer, rawLimit: number, compressedLimit: number) => {
  if (!value.length || value.length > rawLimit) throw boundary();
  const compressed = deflateSync(value, { level: 9 });
  if (compressed.length > compressedLimit) throw boundary();
  return { data: compressed.toString('base64'), bytes: value.length, sha256: digest(value) };
};
/** Trusted source is unpacked only by the selected process after UID drop. */
export function engineeringInvocation(moduleSource: string, request: object, administrative = false) {
  const rawSource = Buffer.from(moduleSource, 'utf8');
  if (rawSource.toString('utf8') !== moduleSource || moduleSource.includes('\0')) throw boundary();
  const rawRequest = Buffer.from(JSON.stringify(request), 'utf8');
  if (rawRequest.length > engineeringLimits.requestBytes) throw boundary();
  const packedSource = encode(rawSource, engineeringLimits.sourceBytes, engineeringLimits.compressedSourceBytes);
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
  onResult?: (result: EngineeringResult) => Promise<void>;
};
export async function runEngineeringOperation(
  machines: Machines, workspaces: Workspaces, id: string, operation: string,
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
  return workspaces.projects.inScope(id, projectId, async () => {
    const originalConfig = await workspaces.config(id);
    if ((originalConfig._workspace || 'default') !== projectId)
      throw new AppError('工程任务原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    const capturedConfig = structuredClone(originalConfig);
    // Workspaces deliberately keeps the scope outside the serialized config.
    // structuredClone drops non-enumerable properties; preserve this binding.
    Object.defineProperty(capturedConfig, '_workspace', { value: originalConfig._workspace, enumerable: false });
    const version = projectVersion(capturedConfig);
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
    const terminals = options.terminals || (ownedTerminals = new ProjectTerminals(machines, workspaces));
    let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
    let failed = false, failure: unknown;
    try {
      prepared = await terminals.prepare(id, projectId, null, false, signal, undefined, { mode: 'task' });
      const { captured, signal: executionSignal } = prepared;
      if (!captured || !executionSignal || prepared.projectId !== projectId || captured.live !== live ||
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
