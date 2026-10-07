/**
 * 模块职责：组织开发任务命令与输入，执行前核对捕获的项目配置和客户机运行身份。
 * Module purpose: Constructs development task inputs and commands, checking captured project configuration and guest identity before execution.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectVersion, type Project } from './project-config.ts';

import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { projectIdentityPayload } from './project-identity.ts';
import { quote } from './shell.ts';
import { ProjectCacheTransfers, projectCachedInstallCommand } from './project-cache-transfer.ts';
import { dependencyManagerSchema, type DependencyManager } from './project-dependency-cache.ts';
import { privateLog, redactValues } from './secrets.ts';

export const featureDevTaskOperation = z.enum([
  'test', 'test-discover', 'dependencies', 'lock', 'lock-check', 'install-locked',
  'worktree-list', 'worktree-add', 'worktree-remove', 'install-cached-dependencies',
]);
export type FeatureDevTaskInput = { operation: z.infer<typeof featureDevTaskOperation>; branch?: string; path?: string; manager?: DependencyManager };
export type FeatureDevTaskResult = { code: number; stdout: string; stderr: string };
export type FeatureDevTaskOptions = {
  terminals?: Pick<ProjectTerminals, 'prepare'>;
  runTask?: typeof projectIdentityTask;
  cacheTransfers?: Pick<ProjectCacheTransfers, 'allocate'>;
  original?: { projectId: string; live: ReturnType<Machines['live']['get']> };
};
/**
 * 入口 / Entry: changed.
 * 功能：从当前输入或状态计算 `new AppError('开发任务原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('开发任务原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('开发任务原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const changed = () => new AppError('开发任务原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
/**
 * 入口 / Entry: cloneConfig.
 * 功能：把本层请求转交 `structuredClone`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `structuredClone` and propagates the provider result or rejection.
 * 输入 / Inputs: config: Project
 * 输出 / Returns: `Object.defineProperty(structuredClone(config), '_workspace', { value: config._workspace, enumerable: false }) as Project`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const cloneConfig = (config: Project) => Object.defineProperty(structuredClone(config), '_workspace',
  { value: config._workspace, enumerable: false }) as Project;

/** Only the native UID process interprets these finite project commands. */
/**
 * 入口 / Entry: featureDevTaskCommand.
 * 功能：在组织开发任务命令与输入中，执行此领域的具体处理步骤并返回其结果；本入口产生 `projectCachedInstallCommand(project.directory, cache, dependencyManagerSchema.parse(input.manager))` / ``set -eu\n${command}`` 供上层消费（`feature-suite-dev-task.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `feature-suite-dev-task.ts`; this entry produces `projectCachedInstallCommand(project.directory, cache, dependencyManagerSchema.parse(input.manager))` / ``set -eu\n${command}`` for its caller. Module context: Constructs development task inputs and commands, checking captured project configuration and guest identity before execution.
 * 处理：通过 `featureDevTaskOperation.parse`, `input.branch.trim`, `input.path.trim`, `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `featureDevTaskOperation.parse`, `input.branch.trim`, `input.path.trim`, `inline.test`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project; input: FeatureDevTaskInput; cache: string optional
 * 输出 / Returns: `projectCachedInstallCommand(project.directory, cache, dependencyManagerSchema.parse(input.manager))`; ``set -eu\n${command}``.
 * 副作用 / Effects: `path.startsWith`; 更新 / updates `command`.
 * 拒绝 / Refusals: 条件 / conditions `operation === 'worktree-add' && (!branch || !/^(?!-)[A-Za-z0-9_./-]{1,128}$/.test(branch))`; `['worktree-add', 'worktree-remove'].includes(operation) && (!path || path.startsWith('/') || path.split('/').includes('..') |…`; `!cache`; 异常 / errors `new AppError('分支名称无效')`; `new AppError('工作树路径必须是仓库内的相对路径')`.
 */
export function featureDevTaskCommand(project: Project, input: FeatureDevTaskInput, cache?: string) {
  const operation = featureDevTaskOperation.parse(input.operation);
  const branch = input.branch?.trim(), path = input.path?.trim();
  if (operation === 'worktree-add' && (!branch || !/^(?!-)[A-Za-z0-9_./-]{1,128}$/.test(branch)))
    throw new AppError('分支名称无效');
  if (['worktree-add', 'worktree-remove'].includes(operation) && (!path || path.startsWith('/') ||
      path.split('/').includes('..') || !/^[A-Za-z0-9_./-]{1,160}$/.test(path)))
    throw new AppError('工作树路径必须是仓库内的相对路径');
  const worktreePath = path ? quote(path) : '';
  let command: string;
  switch (operation) {
    case 'test':
      command = `if [ -f package.json ]; then npm test; elif [ -f pyproject.toml ] || [ -f pytest.ini ]; then python3 -m pytest; elif [ -f Cargo.toml ]; then cargo test; elif [ -f go.mod ]; then go test ./...; else echo '没有识别到测试项目'; fi`;
      break;
    case 'test-discover':
      command = String.raw`find . -type d \( -name .git -o -name node_modules -o -name .venv -o -name target -o -name .worktrees \) -prune -o -type f \( -name '*.test.*' -o -name '*.spec.*' -o -name 'test_*.py' -o -name '*_test.py' -o -name '*_test.go' \) -print | head -n 300`;
      break;
    case 'dependencies':
      command = `set +e\nprintf 'NODE\\n'; test ! -f package.json || npm outdated --json\nprintf 'PYTHON\\n'; command -v pip3 >/dev/null && pip3 list --outdated --format=json\nprintf 'RUST\\n'; test ! -f Cargo.toml || cargo tree --depth 1`;
      break;
    case 'lock':
      command = `mkdir -p .sakura\nprintf '%s\\n' '# Generated by Sakura' ${quote('project=' + project.directory)} "node=$(node --version 2>/dev/null || true)" "python=$(python3 --version 2>/dev/null || true)" "rust=$(rustc --version 2>/dev/null || true)" > .sakura/environment.lock\ncat .sakura/environment.lock`;
      break;
    case 'lock-check':
      command = `test -f .sakura/environment.lock || { echo '环境锁文件不存在，请先生成锁文件' >&2; exit 1; }\nsakura_lock=$(mktemp)\ntrap 'rm -f "$sakura_lock"' EXIT\nprintf '%s\\n' '# Generated by Sakura' ${quote('project=' + project.directory)} "node=$(node --version 2>/dev/null || true)" "python=$(python3 --version 2>/dev/null || true)" "rust=$(rustc --version 2>/dev/null || true)" > "$sakura_lock"\ndiff -u .sakura/environment.lock "$sakura_lock"`;
      break;
    case 'install-locked':
      command = `if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci; elif [ -f yarn.lock ] && command -v yarn >/dev/null; then yarn install --frozen-lockfile; elif [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null; then pnpm install --frozen-lockfile; elif [ -f requirements.txt ]; then python3 -m pip install -r requirements.txt; elif [ -f Cargo.lock ]; then cargo fetch --locked; elif [ -f go.sum ]; then go mod download; else echo '没有识别到受支持的锁文件' >&2; exit 1; fi`;
      break;
    case 'install-cached-dependencies':
      if (!cache) throw new AppError('缓存安装缺少本次任务副本', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      return projectCachedInstallCommand(project.directory, cache, dependencyManagerSchema.parse(input.manager));
    case 'worktree-list': command = 'git worktree list --porcelain'; break;
    case 'worktree-add': command = `git worktree add -- ${worktreePath} ${quote(branch!)}`; break;
    case 'worktree-remove': command = `git worktree remove -- ${worktreePath}`; break;
  }
  // The native launcher already changed directory through the captured directory FD.
  return `set -eu\n${command}`;
}

/** The original preparation lease covers execution, verification and result persistence. */
/**
 * 入口 / Entry: runFeatureDevTask.
 * 功能：在组织开发任务命令与输入中，执行此领域的具体处理步骤并返回其结果；本入口产生 `workspaces.projects.inScope(id, projectId, async () => { const original = await workspaces.config(id); if ((original._workspa…` 供上层消费（`feature-suite-dev-task.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `feature-suite-dev-task.ts`; this entry produces `workspaces.projects.inScope(id, projectId, async () => { const original = await workspaces.config(id); if ((original._workspa…` for its caller. Module context: Constructs development task inputs and commands, checking captured project configuration and guest identity before execution.
 * 处理：通过 `featureDevTaskOperation.parse`, `structuredClone`, `dependencyManagerSchema.parse`, `workspaces.projects.current` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `featureDevTaskOperation.parse`, `structuredClone`, `dependencyManagerSchema.parse`, `workspaces.projects.current`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `input.operation === 'install-cached-dependencies'`.
 * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; id: string; input: FeatureDevTaskInput; signal: AbortSignal; log: (value: string) => void; onResult: (result: FeatureDevTaskResult) => Promise<void> optional; options: FeatureDevTaskOptions default={}
 * 输出 / Returns: `workspaces.projects.inScope(id, projectId, async () => { const original = await workspaces.config(id); if ((original._workspa…`.
 * 副作用 / Effects: 更新 / updates `input`, `input.manager`.
 * 拒绝 / Refusals: 条件 / conditions `!live || machines.live.get(id) !== live || machines.state(id) !== 'running'`; 异常 / errors `changed()`.
 */
export async function runFeatureDevTask(machines: Machines, workspaces: WorkspacesV1, id: string,
  input: FeatureDevTaskInput, signal: AbortSignal, log: (value: string) => void,
  onResult?: (result: FeatureDevTaskResult) => Promise<void>, options: FeatureDevTaskOptions = {}) {
  featureDevTaskOperation.parse(input.operation);
  input = structuredClone(input);
  if (input.operation === 'install-cached-dependencies') input.manager = dependencyManagerSchema.parse(input.manager);
  const { projectId, live } = options.original || {
    projectId: workspaces.projects.current(id), live: machines.live.get(id),
  };
  signal.throwIfAborted();
  if (!live || machines.live.get(id) !== live || machines.state(id) !== 'running') throw changed();
  /**
   * 入口 / Entry: runFeatureDevTask.callback@87.
   * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（workspaces.projects.inScope）。
   * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (workspaces.projects.inScope).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `redacted`.
   * 副作用 / Effects: `executionSignal.throwIfAborted`; `prepared.release`; `ownedTerminals.close`; 更新 / updates `ownedTerminals`, `prepared`, `failed`, `failure`.
   * 拒绝 / Refusals: 条件 / conditions `(original._workspace || 'default') !== projectId`; `!captured || !executionSignal || prepared.projectId !== projectId || captured.live !== live || (captured.project._workspace |…`; `(resolved._workspace || 'default') !== projectId || resolved.directory !== capturedConfig.directory || resolved.networkIsolat…`; 异常 / errors `changed()`; `new AppError(redacted.stderr.trim() || `开发操作失败（${result.code}）`)`.
   * 收尾：退出 try 区域时始终执行 `try { try { await prepared?.release(); } finally { await ownedTerminals?.close(); } } catch (error) { if (failure instanceof …`; `output.flush();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `try { try { await prepared?.release(); } finally { await ownedTerminals?.close(); } } catch (error) { if (failure instanceof …`; `output.flush();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `failed = true;`; `failure = error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `failed = true;`; `failure = error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  return workspaces.projects.inScope(id, projectId, async () => {
    const original = await workspaces.config(id);
    if ((original._workspace || 'default') !== projectId) throw changed();
    const capturedConfig = cloneConfig(original), version = projectVersion(capturedConfig);
    /**
     * 入口 / Entry: runFeatureDevTask.assertCurrent.
     * 功能：在组织开发任务命令与输入中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`feature-suite-dev-task.ts`）。
     * Purpose: Checks admission, input or resource ownership in `feature-suite-dev-task.ts`; the calls and state transitions below complete the operation. Module context: Constructs development task inputs and commands, checking captured project configuration and guest identity before execution.
     * 处理：通过 `signal.throwIfAborted`, `workspaces.config`, `workspaces.projects.current`, `machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `workspaces.config`, `workspaces.projects.current`, `machines.live.get`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `workspaces.projects.current(id) !== projectId || machines.live.get(id) !== live || machines.state(id) !== 'running' || (curre…`; 异常 / errors `changed()`.
     */
    const assertCurrent = async () => {
      signal.throwIfAborted();
      const current = await workspaces.config(id);
      if (workspaces.projects.current(id) !== projectId || machines.live.get(id) !== live ||
          machines.state(id) !== 'running' || (current._workspace || 'default') !== projectId ||
          projectVersion(current) !== version || workspaces.projects.current(id) !== projectId ||
          machines.live.get(id) !== live) throw changed();
    };
    await assertCurrent();
    let ownedTerminals: ProjectTerminals | undefined;
    const terminals = options.terminals || (ownedTerminals = projectTerminalsFor(machines, workspaces));
    let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
    let failed = false, failure: unknown;
    try {
      prepared = await terminals.prepare(id, projectId, null, false, signal, undefined, { mode: 'task' });
      const { captured, signal: executionSignal } = prepared;
      if (!captured || !executionSignal || prepared.projectId !== projectId || captured.live !== live ||
          (captured.project._workspace || 'default') !== projectId || captured.configVersion !== version ||
          projectVersion(captured.project) !== version) throw changed();
      await assertCurrent();
      const resolved = await workspaces.resolveProject(id, capturedConfig);
      await assertCurrent(); executionSignal.throwIfAborted();
      if ((resolved._workspace || 'default') !== projectId || resolved.directory !== capturedConfig.directory ||
          resolved.networkIsolation !== capturedConfig.networkIsolation) throw changed();
      // Allocate no guest storage until the native task has durably saved its intent.
      const cache = input.operation === 'install-cached-dependencies'
        ? await (options.cacheTransfers || new ProjectCacheTransfers(machines)).allocate(id, capturedConfig, input.manager!, executionSignal, live)
        : undefined;
      await assertCurrent(); executionSignal.throwIfAborted();
      const execution = { command: featureDevTaskCommand(capturedConfig, input, cache?.directory), environment: resolved.environment };
      projectIdentityPayload(execution);
      const secrets = Object.values(resolved.environment || {}), output = privateLog(log, secrets);
      try {
        // Transport and native cleanup errors propagate before parsing or result publication.
        const result = await (options.runTask || projectIdentityTask)(machines, id, capturedConfig, execution,
          executionSignal, output.write, 600000, undefined, undefined, { expectedLive: live,
            ...(cache ? { resource: cache.resource } : {}) });
        await assertCurrent(); executionSignal.throwIfAborted();
        const redacted = { code: result.code, stdout: redactValues(result.stdout, secrets),
          stderr: redactValues(result.stderr, secrets) };
        await onResult?.(redacted);
        await assertCurrent(); executionSignal.throwIfAborted();
        if (result.code !== 0) throw new AppError(redacted.stderr.trim() || `开发操作失败（${result.code}）`);
        return redacted;
      } catch (error) {
        if (error instanceof AppError && error.status === 503) throw error;
        throw new AppError(redactValues((error as Error).message, secrets),
          error instanceof AppError ? error.status : 400, error instanceof AppError ? error.code : undefined);
      } finally { output.flush(); }
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
