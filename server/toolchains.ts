/**
 * 模块职责：探测并安装项目工具链，结果必须对应捕获的项目配置及客户机运行身份。
 * Module purpose: Probes/installs project toolchains, requiring results to match captured configuration and guest identity.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectPrivateValues } from './workspaces.ts';
import { projectVersion, type Project } from './project-config.ts';
import { Jobs } from './jobs.ts';
import { guestTask } from './guest-task.ts';
import { envPrefix } from './project-services.ts';
import { quote } from './shell.ts';
import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { projectIdentityPayload } from './project-identity.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { redactValues, privateLog } from './secrets.ts';

export const toolCatalog = {
  git: {
    name: 'Git',
    executable: 'git',
    version: 'git --version',
    alpine: 'git',
    apt: 'git',
    markers: ['.git'],
  },
  node: {
    name: 'Node.js / npm',
    executable: 'node',
    version: 'node --version; npm --version',
    alpine: 'nodejs npm',
    apt: 'nodejs npm',
    markers: ['package.json'],
  },
  python: {
    name: 'Python / pip',
    executable: 'python3',
    version: 'python3 --version; python3 -m pip --version',
    alpine: 'python3 py3-pip',
    apt: 'python3 python3-pip python3-venv',
    markers: ['pyproject.toml', 'requirements.txt'],
  },
  rust: {
    name: 'Rust / Cargo',
    executable: 'cargo',
    version: 'rustc --version; cargo --version',
    alpine: 'rust cargo build-base',
    apt: 'rustc cargo build-essential',
    markers: ['Cargo.toml'],
  },
  go: {
    name: 'Go',
    executable: 'go',
    version: 'go version',
    alpine: 'go',
    apt: 'golang-go',
    markers: ['go.mod'],
  },
  java: {
    name: 'Java JDK',
    executable: 'javac',
    version: 'java -version; javac -version',
    alpine: 'openjdk17-jdk',
    apt: 'default-jdk',
    markers: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  },
  php: {
    name: 'PHP',
    executable: 'php',
    version: 'php --version',
    alpine: 'php84 php84-phar php84-openssl',
    apt: 'php-cli php-mbstring php-xml',
    markers: ['composer.json'],
  },
} as const;
export type ToolId = keyof typeof toolCatalog;
export type ToolchainsOptions = {
  /**
   * 签名 / Signature: ToolchainsOptions.createPreparation.
   * 功能：为探测并安装项目工具链声明 createPreparation 的输入与结果契约，所属容器为 ToolchainsOptions。
   * Purpose: Declares the input/result contract for createPreparation in ToolchainsOptions. Module responsibility: Probes/installs project toolchains, requiring results to match captured configuration and guest identity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Pick<ProjectTerminals, 'prepare' | 'close'>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  createPreparation?: () => Pick<ProjectTerminals, 'prepare' | 'close'>;
  runTask?: typeof projectIdentityTask;
  runInstallTask?: typeof guestTask;
};
/**
 * 入口 / Entry: capturedProject.
 * 功能：从当前输入或状态计算 `captured`，供调用方后续验证或使用。
 * Purpose: Computes `captured` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: project: Project; projectId: string
 * 输出 / Returns: `captured`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function capturedProject(project: Project, projectId: string) {
  const captured = structuredClone(project);
  Object.defineProperty(captured, '_workspace', {
    value: projectId === 'default' ? undefined : projectId, enumerable: false,
  });
  return captured;
}
/**
 * 入口 / Entry: changed.
 * 功能：从当前输入或状态计算 `new AppError('工具探测原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('工具探测原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('工具探测原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const changed = () => new AppError('工具探测原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
/**
 * 入口 / Entry: redactError.
 * 功能：在探测并安装项目工具链中，执行此领域的具体处理步骤并返回其结果；本入口产生 `error` / `wrapped` 供上层消费（`toolchains.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `toolchains.ts`; this entry produces `error` / `wrapped` for its caller. Module context: Probes/installs project toolchains, requiring results to match captured configuration and guest identity.
 * 处理：通过 `redactValues` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `redactValues`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!(error instanceof Error)`; `message === error.message`.
 * 输入 / Inputs: error: unknown; values: string[]
 * 输出 / Returns: `error`; `wrapped`.
 * 副作用 / Effects: 更新 / updates `wrapped.name`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `const wrapped = new AppError(message, error instanceof AppError ? error.status : 500, error instanceof AppError ? error.code …`; `wrapped.name = error.name;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `const wrapped = new AppError(message, error instanceof AppError ? error.status : 500, error instanceof AppError ? error.code …`; `wrapped.name = error.name;`; these statements determine whether a failure is absorbed or rejected again.
 */
function redactError(error: unknown, values: string[]) {
  if (!(error instanceof Error)) return error;
  const message = redactValues(error.message, values);
  // AbortSignal's default DOMException has a getter-only message. Never replace
  // an unchanged cancellation/cleanup error or let redaction mask its identity.
  if (message === error.message) return error;
  try {
    Object.defineProperty(error, 'message', { value: message, writable: true, configurable: true });
    return error;
  } catch {
    const wrapped = new AppError(message, error instanceof AppError ? error.status : 500,
      error instanceof AppError ? error.code : undefined);
    wrapped.name = error.name; Object.defineProperty(wrapped, 'cause', { value: error });
    return wrapped;
  }
}
class ToolchainCleanupErrors extends AppError {
  readonly cause: unknown;
  /**
   * 入口 / Entry: ToolchainCleanupErrors.constructor.
   * 功能：建立 ToolchainCleanupErrors 的探测并安装项目工具链上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ToolchainCleanupErrors context for this module's responsibility: Probes/installs project toolchains, requiring results to match captured configuration and guest identity. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: errors: unknown[]; cause: unknown
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.cause`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(readonly errors: unknown[], cause: unknown) {
    const critical = errors.find((error): error is AppError => error instanceof AppError && error.status === 503);
    super(critical?.message || '工具探测准备清理未确认，请核查原运行记录', 503,
      critical?.code || 'PROJECT_IDENTITY_CLEANUP_FAILED');
    this.cause = cause;
  }
}

// Package installation is instance administration. Only the administrator's
// applied network proxies enter its environment; never project PATH/config.
/**
 * 入口 / Entry: installEnvironment.
 * 功能：在探测并安装项目工具链中，执行此领域的具体处理步骤并返回其结果；本入口产生 `environment` 供上层消费（`toolchains.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `toolchains.ts`; this entry produces `environment` for its caller. Module context: Probes/installs project toolchains, requiring results to match captured configuration and guest identity.
 * 处理：通过 `content.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `content.includes`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `content === undefined`.
 * 输入 / Inputs: value: Record<string, string>
 * 输出 / Returns: `environment`.
 * 副作用 / Effects: 更新 / updates `environment[key]`.
 * 拒绝 / Refusals: 条件 / conditions `typeof content !== 'string' || content.includes('\0') || Buffer.byteLength(content) > 16384 || Buffer.from(content).toString(…`; 异常 / errors `new AppError('管理员安装网络环境超过受保护输入边界', 413, 'GUEST_INPUT_INVALID')`.
 */
function installEnvironment(value: Record<string, string>) {
  const environment: Record<string, string> = {};
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']) {
    const content = value[key];
    if (content === undefined) continue;
    if (typeof content !== 'string' || content.includes('\0') || Buffer.byteLength(content) > 16384 ||
        Buffer.from(content).toString('utf8') !== content)
      throw new AppError('管理员安装网络环境超过受保护输入边界', 413, 'GUEST_INPUT_INVALID');
    environment[key] = content;
  }
  return environment;
}
const installCommand = 'exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ USER=root LOGNAME=root ' +
  'LANG=C LC_ALL=C /bin/sh -eu -s';

export const toolchainInstallRequest = z
      .object({
        tools: z
          .array(z.enum(['git', 'node', 'python', 'rust', 'go', 'java', 'php']))
          .min(1)
          .max(7),
      })
      .strict();

export class Toolchains {
  jobs = new Jobs('toolchains');
  private controller = new AbortController();
  private pending = new Set<Promise<unknown>>();
  private closing?: Promise<void>;
  /**
   * 入口 / Entry: Toolchains.constructor.
   * 功能：建立 Toolchains 的探测并安装项目工具链上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Toolchains context for this module's responsibility: Probes/installs project toolchains, requiring results to match captured configuration and guest identity. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; options: ToolchainsOptions default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private workspaces: WorkspacesV1,
    private options: ToolchainsOptions = {},
  ) {}
  /**
   * 入口 / Entry: Toolchains.view.
   * 功能：在探测并安装项目工具链中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `await operation` 供上层消费（`Toolchains`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Toolchains`; this entry produces `await operation` for its caller. Module context: Probes/installs project toolchains, requiring results to match captured configuration and guest identity.
   * 处理：通过 `this.workspaces.projects.current`, `this.machines.live.get`, `AbortSignal.any`, `active.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.projects.current`, `this.machines.live.get`, `AbortSignal.any`, `active.throwIfAborted`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `await operation`.
   * 副作用 / Effects: `AbortSignal.any`; `this.pending.add`; `this.pending.delete`.
   * 拒绝 / Refusals: 条件 / conditions `!live || this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('请先启动或恢复实例', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.pending.delete(operation);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.pending.delete(operation);`; these steps also apply to exceptional exits.
   */
  async view(id: string, signal?: AbortSignal) {
    const projectId = this.workspaces.projects.current(id), live = this.machines.live.get(id);
    const active = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    active.throwIfAborted();
    if (!live || this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
    const operation = this.workspaces.projects.inScope(id, projectId, () => this.probe(id, projectId, live, active));
    this.pending.add(operation);
    try { return await operation; } finally { this.pending.delete(operation); }
  }
  /**
   * 入口 / Entry: Toolchains.probe.
   * 功能：在原项目账户与运行版本下探测工具链，解析实际安装状态。
   * Purpose: Probes toolchains under the original project account/runtime version and parses measured installation state.
   * 设计：准备与执行前后反复核对配置和 guest 身份；准备清理未确认阻止继续发布可用结果。
   * Design: Configuration/guest proof is rechecked around preparation/execution and unconfirmed cleanup prevents false availability publication.
   * 输入 / Inputs: id: string; projectId: string; live: NonNullable<ReturnType<Machines['live']['get']>>; signal: AbortSignal
   * 输出 / Returns: `{ tools: Object.entries(toolCatalog).map(([key, tool]) => { const part = result.stdout.split(`SAKURA_TOOL_${key}\n`)[1]?.spli…`.
   * 副作用 / Effects: `this.options.createPreparation`; `AbortSignal.any`; `lease.release`; `errors.push`; `preparation.close`; 更新 / updates `lease`, `active`, `privateValues`, `failed`.
   * 拒绝 / Refusals: 条件 / conditions `(original._workspace || 'default') !== projectId`; `!captured || !preparedSignal || lease.projectId !== projectId || captured.live !== live || (captured.project._workspace || 'd…`; `(resolved._workspace || 'default') !== projectId || resolved.directory !== project.directory || (resolved.networkIsolation ||…`; 异常 / errors `changed()`; `new AppError('工具探测命令或环境超过原生受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID')`.
   * 收尾：退出 try 区域时始终执行 `const errors: unknown[] = [];`; `try { await lease?.release(); } catch (error) { errors.push(error); }`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `const errors: unknown[] = [];`; `try { await lease?.release(); } catch (error) { errors.push(error); }`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `failed = true;`; `failure = redactError(error, privateValues);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `failed = true;`; `failure = redactError(error, privateValues);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async probe(id: string, projectId: string, live: NonNullable<ReturnType<Machines['live']['get']>>, signal: AbortSignal) {
    /**
     * 入口 / Entry: Toolchains.probe.origin.
     * 功能：在探测并安装项目工具链中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Toolchains`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `Toolchains`; the calls and state transitions below complete the operation. Module context: Probes/installs project toolchains, requiring results to match captured configuration and guest identity.
     * 处理：通过 `signal.throwIfAborted`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.machines.state`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.workspaces.projects.current(id) !== projectId || this.machines.live.get(id) !== live || this.machines.state(id) !== 'run…`; 异常 / errors `changed()`.
     */
    const origin = () => {
      signal.throwIfAborted();
      if (this.workspaces.projects.current(id) !== projectId || this.machines.live.get(id) !== live ||
          this.machines.state(id) !== 'running') throw changed();
    };
    origin();
    const original = await this.workspaces.config(id);
    origin();
    if ((original._workspace || 'default') !== projectId) throw changed();
    const project = capturedProject(original, projectId), version = projectVersion(project);
    let active = signal, privateValues = projectPrivateValues(project);
    /**
     * 入口 / Entry: Toolchains.probe.assertCurrent.
     * 功能：在探测并安装项目工具链中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`Toolchains`）。
     * Purpose: Checks admission, input or resource ownership in `Toolchains`; the calls and state transitions below complete the operation. Module context: Probes/installs project toolchains, requiring results to match captured configuration and guest identity.
     * 处理：通过 `origin`, `active.throwIfAborted`, `this.workspaces.config`, `projectVersion` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `origin`, `active.throwIfAborted`, `this.workspaces.config`, `projectVersion`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `(current._workspace || 'default') !== projectId || projectVersion(current) !== version || projectVersion(project) !== version`; 异常 / errors `changed()`.
     */
    const assertCurrent = async () => {
      origin(); active.throwIfAborted();
      const current = await this.workspaces.config(id);
      origin(); active.throwIfAborted();
      if ((current._workspace || 'default') !== projectId || projectVersion(current) !== version ||
          projectVersion(project) !== version) throw changed();
    };
    await assertCurrent();
    const preparation = this.options.createPreparation?.() || projectTerminalsFor(this.machines, this.workspaces);
    let lease: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
    let failed = false, failure: unknown;
    try {
      lease = await preparation.prepare(id, projectId, null, false, signal, undefined, { mode: 'task' });
      const { captured, signal: preparedSignal } = lease;
      if (!captured || !preparedSignal || lease.projectId !== projectId || captured.live !== live ||
          (captured.project._workspace || 'default') !== projectId || captured.configVersion !== version ||
          projectVersion(captured.project) !== version) throw changed();
      active = AbortSignal.any([signal, preparedSignal]);
      await assertCurrent();
      const resolved = await this.workspaces.resolveProject(id, capturedProject(project, projectId));
      privateValues = projectPrivateValues(resolved);
      await assertCurrent();
      if ((resolved._workspace || 'default') !== projectId || resolved.directory !== project.directory ||
          (resolved.networkIsolation || 'host') !== (project.networkIsolation || 'host')) throw changed();
      // Native launch fchdir'ed its pinned original directory descriptor. All
      // version binaries and marker lookups execute only after UID/GID drop.
      const script = Object.entries(toolCatalog)
        .map(
          ([key, tool]) =>
            `printf '\\nSAKURA_TOOL_${key}\\n'; if command -v ${tool.executable} >/dev/null; then ${tool.version} 2>&1 | head -c 2000; fi; printf '\\nSAKURA_REQUIRED_${key}\\n'; ${tool.markers.map((file) => `test ! -e ${quote(file)} || printf yes`).join('; ')}; printf '\\n'`,
        )
        .join('\n');
      const execution = { command: script, environment: resolved.environment };
      try { projectIdentityPayload(execution); }
      catch { throw new AppError('工具探测命令或环境超过原生受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID'); }
      const result = await (this.options.runTask || projectIdentityTask)(this.machines, id, project, execution,
        active, undefined, 20000, undefined, undefined, { expectedLive: live });
      await assertCurrent();
      if (!Number.isSafeInteger(result.code) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string')
        throw new AppError('工具探测任务响应缺少原退出码或输出', 502, 'TOOLCHAIN_TASK_RESULT_INVALID');
      if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1024 ** 2)
        throw new AppError('工具探测输出超过 1 MiB', 413, 'TOOLCHAIN_OUTPUT_TOO_LARGE');
      if (result.code !== 0) throw new AppError(redactValues(result.stderr || '无法检查开发工具', privateValues));
      return {
        tools: Object.entries(toolCatalog).map(([key, tool]) => {
          const part = result.stdout.split(`SAKURA_TOOL_${key}\n`)[1]?.split('\nSAKURA_TOOL_')[0] || '';
          const [version, required] = part.split(`\nSAKURA_REQUIRED_${key}\n`);
          return {
            id: key,
            name: tool.name,
            installed: !!version.trim(),
            version: redactValues(version.trim(), privateValues),
            required: required?.includes('yes') || false,
          };
        }),
        job: this.jobs.view(id),
      };
    } catch (error) {
      failed = true; failure = redactError(error, privateValues);
      throw failure;
    } finally {
      // The task transport owns full-domain retirement. Keep the preparation
      // guard until its awaited execution and cleanup settle, including errors.
      const errors: unknown[] = [];
      try { await lease?.release(); } catch (error) { errors.push(error); }
      try { await preparation.close(); } catch (error) { errors.push(error); }
      if (errors.length) {
        if (failed) errors.unshift(failure);
        const critical = errors.find((error) => error instanceof AppError && error.status === 503);
        const error = errors.length === 1 && critical ? critical :
          new ToolchainCleanupErrors(errors, critical || failure || errors[0]);
        throw redactError(error, privateValues);
      }
    }
  }
  /**
   * 入口 / Entry: Toolchains.install.
   * 功能：在探测并安装项目工具链中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.jobs.start( id, async (log, signal) => { assertOrigin(); signal.throwIfAborted(); const redacted = privateLog(log, Objec…` 供上层消费（`Toolchains`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Toolchains`; this entry produces `this.jobs.start( id, async (log, signal) => { assertOrigin(); signal.throwIfAborted(); const redacted = privateLog(log, Objec…` for its caller. Module context: Probes/installs project toolchains, requiring results to match captured configuration and guest identity.
   * 处理：通过 `this.controller.signal.throwIfAborted`, `toolchainInstallRequest.parse`, `this.machines.get`, `this.machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.controller.signal.throwIfAborted`, `toolchainInstallRequest.parse`, `this.machines.get`, `this.machines.live.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `this.jobs.start( id, async (log, signal) => { assertOrigin(); signal.throwIfAborted(); const redacted = privateLog(log, Objec…`.
   * 副作用 / Effects: `installEnvironment`; `this.jobs.start`.
   * 拒绝 / Refusals: 条件 / conditions `body.length > 128 * 1024`; 异常 / errors `new AppError('管理员安装正文超过受保护输入边界', 413, 'GUEST_INPUT_INVALID')`.
   */
  async install(id: string, input: unknown) {
    this.controller.signal.throwIfAborted();
    const { tools } = toolchainInstallRequest
      .parse(input);
    const vm = this.machines.get(id);
    const live = this.machines.live.get(id), distro = vm.distro || 'alpine';
    /**
     * 入口 / Entry: Toolchains.install.assertOrigin.
     * 功能：在探测并安装项目工具链中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`Toolchains`）。
     * Purpose: Checks admission, input or resource ownership in `Toolchains`; the calls and state transitions below complete the operation. Module context: Probes/installs project toolchains, requiring results to match captured configuration and guest identity.
     * 处理：通过 `this.controller.signal.throwIfAborted`, `this.machines.live.get`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.controller.signal.throwIfAborted`, `this.machines.live.get`, `this.machines.state`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!live || this.machines.live.get(id) !== live || this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('管理员安装原客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
     */
    const assertOrigin = () => {
      this.controller.signal.throwIfAborted();
      if (!live || this.machines.live.get(id) !== live || this.machines.state(id) !== 'running')
        throw new AppError('管理员安装原客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    };
    assertOrigin();
    const environment = installEnvironment(await this.workspaces.networkEnvironment(id));
    assertOrigin();
    const packages = [...new Set(tools)]
      .map((key) => toolCatalog[key][distro === 'alpine' ? 'alpine' : 'apt'])
      .join(' ');
    const script = distro === 'alpine' ? `/sbin/apk add --no-cache --timeout 30 ${packages} </dev/null` :
      `export DEBIAN_FRONTEND=noninteractive\n/usr/bin/apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update </dev/null\n/usr/bin/apt-get -y install ${packages} </dev/null`;
    const body = Buffer.from(`set -eu\ncd /\n${envPrefix(environment)}\n${script}\n`);
    if (body.length > 128 * 1024) throw new AppError('管理员安装正文超过受保护输入边界', 413, 'GUEST_INPUT_INVALID');
    /**
     * 入口 / Entry: Toolchains.install.callback@272.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: log; signal
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError('开发工具安装失败，请查看任务日志')`; `redactError(error, Object.values(environment))`.
     * 收尾：退出 try 区域时始终执行 `redacted.flush();`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `redacted.flush();`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `throw redactError(error, Object.values(environment));`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `throw redactError(error, Object.values(environment));`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.jobs.start(
      id,
      async (log, signal) => {
        assertOrigin(); signal.throwIfAborted();
        const redacted = privateLog(log, Object.values(environment));
        try {
          const result = await (this.options.runInstallTask || guestTask)(this.machines, id, installCommand,
            signal, redacted.write, undefined, undefined, undefined, { input: body });
          assertOrigin(); signal.throwIfAborted();
          if (result.code !== 0) throw new AppError('开发工具安装失败，请查看任务日志');
        } catch (error) {
          throw redactError(error, Object.values(environment));
        } finally { redacted.flush(); }
      },
      { title: `安装开发工具 · ${tools.join(', ')}`, vmId: id },
    );
  }
  /**
   * 入口 / Entry: Toolchains.close.
   * 功能：在探测并安装项目工具链中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closing` 供上层消费（`Toolchains`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Toolchains`; this entry produces `this.closing` for its caller. Module context: Probes/installs project toolchains, requiring results to match captured configuration and guest identity.
   * 处理：通过 `this.controller.abort`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.controller.abort`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closing`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.closing`.
   * 副作用 / Effects: `this.controller.abort`; 更新 / updates `this.closing`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() {
    if (this.closing) return this.closing;
    this.controller.abort();
    this.closing = (async () => {
      const results = await Promise.allSettled([this.jobs.close(), ...this.pending]);
      const errors = results.flatMap((result, index) => result.status === 'rejected' &&
        (index === 0 || result.reason instanceof AppError && result.reason.status === 503) ? [result.reason] : []);
      if (errors.length) throw errors.length === 1 ? errors[0] : new ToolchainCleanupErrors(errors, errors[0]);
    })();
    return this.closing;
  }
}
