/**
 * 模块职责：在捕获的项目配置与客户机身份下运行代码诊断，拒绝将结果用于已变化的项目。
 * Module purpose: Runs diagnostics against a captured project configuration and guest identity, rejecting results for changed projects.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { posix } from 'node:path';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectPrivateValues } from './workspaces.ts';
import { projectVersion, type Project } from './project-config.ts';
import { repositoryPath } from './git-workbench.ts';
import { quote } from './shell.ts';
import { AppError } from '../shared/errors.ts';
import { guestPath } from '../shared/paths.ts';
import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { projectIdentityPayload } from './project-identity.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { redactValues } from './secrets.ts';

export type Diagnostic = {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
};
type Preparation = Pick<ProjectTerminals, 'prepare' | 'close'>;
export type CodeIntelligenceOptions = {
  /**
   * 签名 / Signature: CodeIntelligenceOptions.createPreparation.
   * 功能：为在捕获的项目配置与客户机身份下运行代码诊断声明 createPreparation 的输入与结果契约，所属容器为 CodeIntelligenceOptions。
   * Purpose: Declares the input/result contract for createPreparation in CodeIntelligenceOptions. Module responsibility: Runs diagnostics against a captured project configuration and guest identity, rejecting results for changed projects.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Preparation.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  createPreparation?: () => Preparation;
  runProjectTask?: typeof projectIdentityTask;
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
  // Workspaces.config deliberately keeps this outside the serialized config.
  // structuredClone alone would silently turn a named project into default.
  const captured = structuredClone(project);
  Object.defineProperty(captured, '_workspace', {
    value: projectId === 'default' ? undefined : projectId,
    enumerable: false,
  });
  return captured;
}

export class CodeIntelligence {
  /**
   * 入口 / Entry: CodeIntelligence.constructor.
   * 功能：建立 CodeIntelligence 的在捕获的项目配置与客户机身份下运行代码诊断上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the CodeIntelligence context for this module's responsibility: Runs diagnostics against a captured project configuration and guest identity, rejecting results for changed projects. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; options: CodeIntelligenceOptions default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private workspaces: WorkspacesV1,
    private options: CodeIntelligenceOptions = {},
  ) {}
  /**
   * 入口 / Entry: CodeIntelligence.diagnose.
   * 功能：捕获项目与客户机身份，选择诊断工具并把工具输出归一为文件诊断。
   * Purpose: Captures project/guest identity, selects diagnostics tooling and normalizes its output into file diagnostics.
   * 设计：准备、执行和结果发布之间反复核对配置版本；原运行清理不确定时保留准备资源供恢复。
   * Design: Configuration versions are checked across preparation/execution/publication, and uncertain original cleanup retains preparation ownership.
   * 输入 / Inputs: id: string; path: string; signal: AbortSignal optional
   * 输出 / Returns: `this.workspaces.projects.inScope(id, projectId, async () => { const original = await this.workspaces.config(id); requestSigna…`.
   * 副作用 / Effects: `requestSignal.throwIfAborted`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async diagnose(id: string, path: string, signal?: AbortSignal) {
    // Capture scope and Live before the first asynchronous config read.
    const projectId = this.workspaces.projects.current(id), live = this.machines.live.get(id);
    const requestSignal = signal || new AbortController().signal;
    requestSignal.throwIfAborted();
    /**
     * 入口 / Entry: CodeIntelligence.diagnose.callback@52.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.workspaces.projects.inScope）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.workspaces.projects.inScope).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ path, diagnostics: [], supported: false }`; `{ path, diagnostics: [], supported: true }`; `{ path, diagnostics, supported: true }`.
     * 副作用 / Effects: `requestSignal.throwIfAborted`; `path.startsWith`; `path.split().pop().toLowerCase`; `path.split().pop`; `this.options.createPreparation`; 更新 / updates `path`, `command`, `prepared`, `failed`.
     * 拒绝 / Refusals: 条件 / conditions `(original._workspace || 'default') !== projectId`; `!live || this.machines.state(id) !== 'running'`; `!captured || !executionSignal || prepared.projectId !== projectId || captured.live !== live || (captured.project._workspace |…`; 异常 / errors `new AppError('诊断配置不属于原项目', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`; `new AppError('请先启动或恢复实例', 409)`.
     * 收尾：退出 try 区域时始终执行 `const errors: unknown[] = [];`; `try { await prepared?.release(); } catch (error) { errors.push(error); }`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `const errors: unknown[] = [];`; `try { await prepared?.release(); } catch (error) { errors.push(error); }`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `failed = true;`; `failure = error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `failed = true;`; `failure = error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.workspaces.projects.inScope(id, projectId, async () => {
      const original = await this.workspaces.config(id);
      requestSignal.throwIfAborted();
      if ((original._workspace || 'default') !== projectId)
        throw new AppError('诊断配置不属于原项目', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      const project = capturedProject(original, projectId), version = projectVersion(project);
      // The file editor uses absolute guest paths; CLI callers use project-relative paths.
      // Both forms must stay inside the originally captured project directory.
      path = repositoryPath.parse(
        path.startsWith('/') ? posix.relative(project.directory, guestPath(path)) : path,
      );
      const target = posix.join(project.directory, path);
      const ext = path.split('.').pop()?.toLowerCase();
      let command: string;
      if (['js', 'jsx', 'mjs', 'cjs'].includes(ext || '')) command = `node --check ${quote(target)}`;
      else if (['ts', 'tsx'].includes(ext || ''))
        command = `if command -v tsc >/dev/null; then tsc --noEmit --pretty false ${quote(target)}; else node --check ${quote(target)}; fi`;
      else if (ext === 'py') command = `python3 -m py_compile ${quote(target)}`;
      else if (ext === 'json') command = `python3 -m json.tool ${quote(target)} >/dev/null`;
      else return { path, diagnostics: [], supported: false };
      if (!live || this.machines.state(id) !== 'running')
        throw new AppError('请先启动或恢复实例', 409);
      /**
       * 入口 / Entry: CodeIntelligence.diagnose.assertCurrent.
       * 功能：在在捕获的项目配置与客户机身份下运行代码诊断中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`CodeIntelligence`）。
       * Purpose: Checks admission, input or resource ownership in `CodeIntelligence`; the calls and state transitions below complete the operation. Module context: Runs diagnostics against a captured project configuration and guest identity, rejecting results for changed projects.
       * 处理：通过 `assertOrigin`, `this.workspaces.config`, `projectVersion` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `assertOrigin`, `this.workspaces.config`, `projectVersion`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `(current._workspace || 'default') !== projectId || projectVersion(current) !== version`; 异常 / errors `new AppError('诊断原项目配置已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
       */
      const assertCurrent = async () => {
        /**
         * 入口 / Entry: CodeIntelligence.diagnose.assertOrigin.
         * 功能：在在捕获的项目配置与客户机身份下运行代码诊断中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`CodeIntelligence`）。
         * Purpose: Checks admission, input or resource ownership in `CodeIntelligence`; the calls and state transitions below complete the operation. Module context: Runs diagnostics against a captured project configuration and guest identity, rejecting results for changed projects.
         * 处理：通过 `requestSignal.throwIfAborted`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `requestSignal.throwIfAborted`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.machines.state`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `requestSignal.throwIfAborted`.
         * 拒绝 / Refusals: 条件 / conditions `this.workspaces.projects.current(id) !== projectId || this.machines.live.get(id) !== live || this.machines.state(id) !== 'run…`; 异常 / errors `new AppError('诊断原项目或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
         */
        const assertOrigin = () => {
          requestSignal.throwIfAborted();
          if (this.workspaces.projects.current(id) !== projectId ||
              this.machines.live.get(id) !== live || this.machines.state(id) !== 'running')
            throw new AppError('诊断原项目或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        };
        assertOrigin();
        const current = await this.workspaces.config(id);
        assertOrigin();
        if ((current._workspace || 'default') !== projectId || projectVersion(current) !== version)
          throw new AppError('诊断原项目配置已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      };
      await assertCurrent();
      // Each finite check owns its preparation manager. Its config guard stays
      // registered until the UID task has confirmed cleanup of the whole domain.
      const preparation = this.options.createPreparation?.() || projectTerminalsFor(this.machines, this.workspaces);
      let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
      let failed = false, failure: unknown;
      try {
        prepared = await preparation.prepare(id, projectId, null, false, requestSignal, undefined, { mode: 'task' });
        const { captured, signal: executionSignal } = prepared;
        if (!captured || !executionSignal || prepared.projectId !== projectId || captured.live !== live ||
            (captured.project._workspace || 'default') !== projectId || captured.configVersion !== version ||
            projectVersion(captured.project) !== version)
          throw new AppError('诊断准备租约不属于原项目、配置或客户机', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        await assertCurrent();
        executionSignal.throwIfAborted();
        const resolved = await this.workspaces.resolveProject(id, project);
        await assertCurrent();
        executionSignal.throwIfAborted();
        if ((resolved._workspace || 'default') !== projectId || resolved.directory !== project.directory ||
            (resolved.networkIsolation || 'host') !== (project.networkIsolation || 'host') ||
            projectVersion(project) !== version)
          throw new AppError('诊断解析配置改变了原项目执行边界', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        const execution = { command, environment: resolved.environment };
        // Body and resolved environment travel in the bounded native stdin
        // frame. Neither is interpolated into the root infrastructure argv.
        projectIdentityPayload(execution);
        const result = await (this.options.runProjectTask || projectIdentityTask)(this.machines, id, project,
          execution, executionSignal, undefined, 30000, undefined, undefined, { expectedLive: live });
        await assertCurrent();
        executionSignal.throwIfAborted();
        const output = redactValues(`${result.stdout}\n${result.stderr}`.trim(), projectPrivateValues(resolved));
        if (result.code === 0) return { path, diagnostics: [], supported: true };
        const diagnostics: Diagnostic[] = output
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(0, 100)
          .map((line) => {
            const match = line.match(/(?::|\()([0-9]+)(?::|,)([0-9]+)?(?:\)|:)?\s*(.*)$/);
            return {
              severity: 'error' as const,
              line: match ? Number(match[1]) : undefined,
              column: match?.[2] ? Number(match[2]) : undefined,
              message: match?.[3] || line.slice(0, 500),
            };
          });
        return { path, diagnostics, supported: true };
      } catch (error) { failed = true; failure = error; throw error; }
      finally {
        // Try both releases even if either fails. A successful compiler result
        // must never hide an unconfirmed preparation or native cleanup.
        const errors: unknown[] = [];
        try { await prepared?.release(); } catch (error) { errors.push(error); }
        try { await preparation.close(); } catch (error) { errors.push(error); }
        if (errors.length) {
          if (failed) errors.unshift(failure);
          if (errors.length === 1) throw errors[0];
          const critical = errors.find((error): error is AppError => error instanceof AppError && error.status === 503);
          const combined = new AggregateError(errors, critical?.message || '诊断任务准备清理未确认，请核查原运行记录',
            { cause: critical || failure || errors[0] });
          // Preserve the cleanup status/code at the HTTP boundary while keeping
          // every original exception in errors. A lone task error is unchanged.
          if (critical) Object.assign(combined, { status: critical.status, code: critical.code });
          throw combined;
        }
      }
    });
  }
}
