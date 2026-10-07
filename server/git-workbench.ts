/**
 * 模块职责：提供仓库状态、差异、冲突处理和 Git 动作；仓库相对路径与分支输入先校验。
 * Module purpose: Exposes repository status, diffs, conflicts and actions, validating relative paths and branch inputs before work.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import type { Project } from './project-config.ts';

import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';
import { textVersion } from './files.ts';
import { posix } from 'node:path';
import { Jobs } from './jobs.ts';
import { isGitConflict, type GitChange, type GitUpstream } from '../shared/git.ts';
import { GitProjectTasks, type GitWorkbenchOptions } from './git-project-task.ts';
export type { GitWorkbenchOptions } from './git-project-task.ts';

export type { GitChange } from '../shared/git.ts';
/**
 * 入口 / Entry: parseStatus.
 * 功能：在提供仓库状态、差异、冲突处理和 Git 动作中，转换协议或持久数据表示并保持调用边界；本入口产生 `items` 供上层消费（`git-workbench.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `git-workbench.ts`; this entry produces `items` for its caller. Module context: Exposes repository status, diffs, conflicts and actions, validating relative paths and branch inputs before work.
 * 处理：通过 `text.split`, `row.slice`, `inline.includes`, `items.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `text.split`, `row.slice`, `inline.includes`, `items.push`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `row.length < 4`; `'RC'.includes(row[0]) || 'RC'.includes(row[1])`.
 * 输入 / Inputs: text: string
 * 输出 / Returns: GitChange[]；结果来自 / values from `items`.
 * 副作用 / Effects: `items.push`; 更新 / updates `item.previous`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function parseStatus(text: string): GitChange[] {
  const parts = text.split('\0'),
    items: GitChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const row = parts[i];
    if (row.length < 4) continue;
    const item: GitChange = { index: row[0], worktree: row[1], path: row.slice(3) };
    if ('RC'.includes(row[0]) || 'RC'.includes(row[1])) item.previous = parts[++i];
    items.push(item);
  }
  return items;
}
export const repositoryPath = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) => !path.startsWith('/') && !path.split('/').includes('..') && !/[\x00-\x1f]/.test(path),
    '需要仓库内的相对文件路径',
  );
const branchName = z
  .string()
  .regex(/^(?!-)[A-Za-z0-9_./-]{1,128}$/)
  .refine(
    (name) =>
      name !== 'HEAD' &&
      !name.includes('..') &&
      !name.includes('//') &&
      !name
        .split('/')
        .some((part) => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock')),
    '分支名称不符合 Git 规则',
  );
const remoteName = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/)
  .refine(
    (name) => !name.includes('..') && !name.endsWith('.') && !name.endsWith('.lock'),
    '远程仓库名称不符合 Git 规则',
  );
/**
 * 入口 / Entry: callback@62.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.string().url().refine / 远程仓库只接受不含凭证、查询参数或片段的 HTTPS 地址）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.string().url().refine / 远程仓库只接受不含凭证、查询参数或片段的 HTTPS 地址).
 * 输入 / Inputs: value
 * 输出 / Returns: `( url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !/[\s\x00-\x1f]/.test(value) )`; `false`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return false;`; these statements determine whether a failure is absorbed or rejected again.
 */
const remoteUrl = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !/[\s\x00-\x1f]/.test(value)
      );
    } catch {
      return false;
    }
  }, '远程仓库只接受不含凭证、查询参数或片段的 HTTPS 地址');

/**
 * 入口 / Entry: redactGitOutput.
 * 功能：从当前输入或状态计算 `text.replace(/https?:\/\/[^\s<>"']+/gi, (value) => { try { const url = new URL(value); url.username = ''; url.password = ''; …`，供调用方后续验证或使用。
 * Purpose: Computes `text.replace(/https?:\/\/[^\s<>"']+/gi, (value) => { try { const url = new URL(value); url.username = ''; url.password = ''; …` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: text: string
 * 输出 / Returns: `text.replace(/https?:\/\/[^\s<>"']+/gi, (value) => { try { const url = new URL(value); url.username = ''; url.password = ''; …`.
 * 副作用 / Effects: `text.replace`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function redactGitOutput(text: string) {
  /**
   * 入口 / Entry: redactGitOutput.callback@79.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（text.replace）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (text.replace).
   * 输入 / Inputs: value
   * 输出 / Returns: `url.toString()`; `'[远程地址已隐藏]'`.
   * 副作用 / Effects: 更新 / updates `url.username`, `url.password`, `url.search`, `url.hash`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return '[远程地址已隐藏]';`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return '[远程地址已隐藏]';`; these statements determine whether a failure is absorbed or rejected again.
   */
  return text.replace(/https?:\/\/[^\s<>"']+/gi, (value) => {
    try {
      const url = new URL(value);
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return '[远程地址已隐藏]';
    }
  });
}

export const gitActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('resolve'),
      path: repositoryPath,
      content: z.string().max(1024 * 1024),
      expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
      expectedIndex: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z.object({
    action: z.literal('resolve-choice'),
    path: repositoryPath,
    choice: z.enum(['ours', 'theirs']),
    expectedIndex: z.string().regex(/^[a-f0-9]{64}$/),
    expectedWorktree: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  z.object({ action: z.enum(['stage', 'unstage']), paths: z.array(repositoryPath).min(1).max(200) }).strict(),
  z
    .object({
      action: z.literal('commit'),
      message: z.string().trim().min(1).max(4096),
      author: z.string().trim().max(100).optional(),
      email: z.email().optional(),
    })
    .strict(),
  z
    .object({
      action: z.enum(['switch', 'branch']),
      branch: branchName,
    })
    .strict(),
  z.object({ action: z.literal('init') }).strict(),
  z
    .object({
      action: z.enum(['remote-add', 'remote-remove']),
      name: remoteName,
      url: remoteUrl.optional(),
    })
    .strict(),
  z
    .object({
      action: z.enum(['fetch', 'pull', 'push']),
      remote: remoteName.default('origin'),
      branch: branchName.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('merge'),
      branch: branchName,
      ffOnly: z.boolean().default(true),
    })
    .strict(),
]);
const git =
  'git --no-pager --literal-pathspecs -c core.hooksPath=/dev/null -c core.fsmonitor=false -c color.ui=false';
/**
 * 签名 / Signature: GitCommand.GitCommand.
 * 功能：为提供仓库状态、差异、冲突处理和 Git 动作声明 GitCommand 的输入与结果契约，所属容器为 GitCommand。
 * Purpose: Declares the input/result contract for GitCommand in GitCommand. Module responsibility: Exposes repository status, diffs, conflicts and actions, validating relative paths and branch inputs before work.
 * 输入 / Inputs: command: string; network: boolean optional
 * 输出 / Returns: Promise<{ stdout: string; stderr: string; code: number }>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
type GitCommand = (
  command: string,
  network?: boolean,
) => Promise<{ stdout: string; stderr: string; code: number }>;

/**
 * 入口 / Entry: repositoryState.
 * 功能：在提供仓库状态、差异、冲突处理和 Git 动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, '') : null, head: head.code === 0 ? head.stdout.…` 供上层消费（`git-workbench.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `git-workbench.ts`; this entry produces `{ branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, '') : null, head: head.code === 0 ? head.stdout.…` for its caller. Module context: Exposes repository status, diffs, conflicts and actions, validating relative paths and branch inputs before work.
 * 处理：通过 `command`, `redactGitOutput`, `parseStatus`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `command`, `redactGitOutput`, `parseStatus`, `quote`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `name && remote && ref?.startsWith('refs/heads/')`.
 * 输入 / Inputs: command: GitCommand
 * 输出 / Returns: `{ branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, '') : null, head: head.code === 0 ? head.stdout.…`.
 * 副作用 / Effects: `ref.startsWith`; `branch.stdout.trim().replace`; 更新 / updates `upstream`.
 * 拒绝 / Refusals: 条件 / conditions `status.code !== 0`; `operation.code !== 0`; `branch.code === 0`; 异常 / errors `new AppError(redactGitOutput(status.stderr))`; `new AppError('无法检查 Git 合并状态')`.
 */
async function repositoryState(command: GitCommand) {
  const status = await command('status --porcelain=v1 -z --untracked-files=all');
  if (status.code !== 0) throw new AppError(redactGitOutput(status.stderr));
  const branch = await command('symbolic-ref --quiet HEAD');
  const head = await command('rev-parse --verify HEAD');
  // --git-path also works for linked worktrees, whose .git is a file.
  const operation = await command(
    `rev-parse --git-dir >/dev/null && for state in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD sequencer; do if test -e "$(${git} rev-parse --git-path "$state")"; then printf '%s\\n' "$state"; fi; done`,
  );
  if (operation.code !== 0) throw new AppError('无法检查 Git 合并状态');
  const changes = parseStatus(status.stdout);
  let upstream: GitUpstream | null = null;
  if (branch.code === 0) {
    const tracking = await command(
      `for-each-ref --format='%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)' -- ${quote(branch.stdout.trim())}`,
    );
    if (tracking.code !== 0) throw new AppError(redactGitOutput(tracking.stderr));
    const [name, remote, ref] = tracking.stdout.trim().split('\0');
    if (name && remote && ref?.startsWith('refs/heads/')) upstream = { name, remote, branch: ref.slice(11) };
  }
  return {
    branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, '') : null,
    head: head.code === 0 ? head.stdout.trim() : null,
    changes,
    conflicts: changes.filter(isGitConflict).map((change) => change.path),
    operation: operation.stdout.trim().split('\n').filter(Boolean)[0] || null,
    upstream,
  };
}

/**
 * 入口 / Entry: requireSettled.
 * 功能：在提供仓库状态、差异、冲突处理和 Git 动作中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`git-workbench.ts`）。
 * Purpose: Checks admission, input or resource ownership in `git-workbench.ts`; the calls and state transitions below complete the operation. Module context: Exposes repository status, diffs, conflicts and actions, validating relative paths and branch inputs before work.
 * 处理：通过 `state.conflicts.join` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `state.conflicts.join`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: state: Awaited<ReturnType<typeof repositoryState>>; clean: default=false
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `state.conflicts.length`; `state.operation`; `!state.branch`; 异常 / errors `new AppError( `存在未解决的文件冲突：${state.conflicts.join('、')}。请编辑冲突文件并暂存解决结果，再完成或中止当前合并 / 变基。`, 409, 'git_conflict', )`; `new AppError( `Git 操作尚未结束（${state.operation}），请先在终端完成或中止该操作。`, 409, 'git_operation_in_progress', )`.
 */
function requireSettled(state: Awaited<ReturnType<typeof repositoryState>>, clean = false) {
  if (state.conflicts.length)
    throw new AppError(
      `存在未解决的文件冲突：${state.conflicts.join('、')}。请编辑冲突文件并暂存解决结果，再完成或中止当前合并 / 变基。`,
      409,
      'git_conflict',
    );
  if (state.operation)
    throw new AppError(
      `Git 操作尚未结束（${state.operation}），请先在终端完成或中止该操作。`,
      409,
      'git_operation_in_progress',
    );
  if (!state.branch)
    throw new AppError('当前处于 detached HEAD，请先切换到本地分支。', 409, 'git_detached_head');
  if (!state.head) throw new AppError('当前分支还没有提交，请先创建首次提交。', 409, 'git_unborn_branch');
  if (clean && state.changes.length)
    throw new AppError(
      '工作区或暂存区存在未提交改动（含未跟踪文件），请先提交或自行暂存到 stash 后再拉取。',
      409,
      'git_dirty_worktree',
    );
}
export class GitWorkbench {
  jobs = new Jobs('git');
  private tasks: GitProjectTasks;
  /**
   * 入口 / Entry: GitWorkbench.constructor.
   * 功能：建立 GitWorkbench 的提供仓库状态、差异、冲突处理和 Git 动作上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the GitWorkbench context for this module's responsibility: Exposes repository status, diffs, conflicts and actions, validating relative paths and branch inputs before work. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; options: GitWorkbenchOptions default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.tasks`.
   */
  constructor(
    private machines: Machines,
    private workspaces: WorkspacesV1,
    options: GitWorkbenchOptions = {},
  ) { this.tasks = new GitProjectTasks(machines, workspaces, options); }
  /**
   * 入口 / Entry: GitWorkbench.command.
   * 功能：在提供仓库状态、差异、冲突处理和 Git 动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.tasks.exec(id, 'set -eu\n' + clean + `LC_ALL=C GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false SSH_ASKPASS=/bin/false GCM_I…` 供上层消费（`GitWorkbench`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GitWorkbench`; this entry produces `this.tasks.exec(id, 'set -eu\n' + clean + `LC_ALL=C GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false SSH_ASKPASS=/bin/false GCM_I…` for its caller. Module context: Exposes repository status, diffs, conflicts and actions, validating relative paths and branch inputs before work.
   * 处理：通过 `this.tasks.project`, `this.tasks.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.tasks.project`, `this.tasks.exec`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; command: string; signal: AbortSignal optional; project: Project optional; network: default=false
   * 输出 / Returns: `this.tasks.exec(id, 'set -eu\n' + clean + `LC_ALL=C GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false SSH_ASKPASS=/bin/false GCM_I…`.
   * 副作用 / Effects: `this.tasks.exec`; 更新 / updates `project`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async command(
    id: string, command: string, signal?: AbortSignal, project?: Project, network = false,
  ) {
    project ??= this.tasks.project(id);
    // Only the project UID reads its repository and independent HOME config.
    // Project overrides cannot redirect Git to root/global administrative state.
    const clean = 'unset GIT_CONFIG GIT_CONFIG_PARAMETERS GIT_DIR GIT_COMMON_DIR GIT_WORK_TREE GIT_INDEX_FILE ' +
      'GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_EXEC_PATH GIT_TEMPLATE_DIR; ' +
      'export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_GLOBAL="$HOME/.gitconfig" GIT_CONFIG_COUNT=0; ';
    // Native launch already fchdir'ed the pinned original directory descriptor.
    // Reopening its lexical path here would weaken that immutable binding.
    return this.tasks.exec(id, 'set -eu\n' + clean +
      `LC_ALL=C GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false SSH_ASKPASS=/bin/false GCM_INTERACTIVE=never ${network ? 'GIT_ALLOW_PROTOCOL=https ' : ''}${git} ${command}`,
      network ? 120000 : 30000, signal, project);
  }
  /**
   * 入口 / Entry: GitWorkbench.view.
   * 功能：把本层请求转交 `this.tasks.withProject`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.tasks.withProject` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `this.tasks.withProject(id, signal, undefined, async () => { const project = this.tasks.project(id); const command: GitCommand…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string, signal?: AbortSignal) {
    /**
     * 入口 / Entry: GitWorkbench.view.callback@232.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.tasks.withProject）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.tasks.withProject).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ projectId: this.workspaces.projects.current(id), repository: false, error: this.tasks.redact(id, redactGitOutput(check.stde…`; `{ projectId: this.workspaces.projects.current(id), repository: true, branch: state.branch || '(detached HEAD)', detached: !st…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.tasks.withProject(id, signal, undefined, async () => {
      const project = this.tasks.project(id);
      /**
       * 入口 / Entry: GitWorkbench.view.command.
       * 功能：把本层请求转交 `this.command`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.command` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `this.command(id, value, signal, project)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const command: GitCommand = (value) => this.command(id, value, signal, project);
      const check = await command('rev-parse --is-inside-work-tree');
      if (check.code !== 0)
        return {
          projectId: this.workspaces.projects.current(id),
          repository: false,
          error: this.tasks.redact(id, redactGitOutput(check.stderr)),
          changes: [],
          branches: [],
          history: [],
          job: this.jobs.view(this.workspaces.projects.key(id)),
        };
      const state = await repositoryState(command);
      const branches = await command("for-each-ref --format='%(refname:short)' refs/heads");
      const history = await command("log -30 --format='%H%x00%h%x00%s%x00%an%x00%aI%x00'");
      const remotes = await command('remote -v');
      const divergence =
        state.upstream && state.head
          ? await command('rev-list --left-right --count @{upstream}...HEAD')
          : { stdout: '', code: 1 };
      const records =
        history.code === 0
          ? history.stdout
              .split('\0\n')
              .filter(Boolean)
              .map((row) => {
                const [commitId, short, subject, author, date] = row.trimStart().split('\0');
                return { id: commitId, short, subject: this.tasks.redact(id, subject), author: this.tasks.redact(id, author), date };
              })
          : [];
      return {
        projectId: this.workspaces.projects.current(id),
        repository: true,
        branch: state.branch || '(detached HEAD)',
        detached: !state.branch,
        hasCommits: !!state.head,
        changes: state.changes,
        conflicts: state.conflicts,
        operation: state.operation,
        upstream: state.upstream,
        branches: branches.stdout.trim().split('\n').filter(Boolean),
        history: records,
        remotes:
          remotes.code === 0
            ? [
                ...new Map(
                  remotes.stdout
                    .split('\n')
                    .filter(Boolean)
                    .map((row) => {
                      const [name, url, kind] = row.split(/\s+/);
                      return [`${name}:${kind}`, { name, url: redactGitOutput(url), kind }];
                    }),
                ).values(),
              ]
            : [],
        divergence:
          divergence.code === 0 && /^\d+\s+\d+$/.test(divergence.stdout.trim())
            ? divergence.stdout.trim().split(/\s+/).map(Number)
            : [],
        job: this.jobs.view(this.workspaces.projects.key(id)),
      };
    });
  }
  /**
   * 入口 / Entry: GitWorkbench.diff.
   * 功能：在提供仓库状态、差异、冲突处理和 Git 动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.tasks.withProject(id, signal, undefined, async () => { const project = this.tasks.project(id); const untracked = !staged…` 供上层消费（`GitWorkbench`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GitWorkbench`; this entry produces `this.tasks.withProject(id, signal, undefined, async () => { const project = this.tasks.project(id); const untracked = !staged…` for its caller. Module context: Exposes repository status, diffs, conflicts and actions, validating relative paths and branch inputs before work.
   * 处理：通过 `repositoryPath.parse`, `this.tasks.withProject` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `repositoryPath.parse`, `this.tasks.withProject`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; path: string; staged: boolean; signal: AbortSignal optional
   * 输出 / Returns: `this.tasks.withProject(id, signal, undefined, async () => { const project = this.tasks.project(id); const untracked = !staged…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async diff(id: string, path: string, staged: boolean, signal?: AbortSignal) {
    repositoryPath.parse(path);
    /**
     * 入口 / Entry: GitWorkbench.diff.callback@300.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.tasks.withProject）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.tasks.withProject).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ diff: this.tasks.redact(id, redactGitOutput(result.stdout)).slice(0, 200000), truncated: result.stdout.length > 200000 }`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `result.code !== 0 && !(untracked && result.code === 1)`; 异常 / errors `new AppError(result.stderr)`.
     */
    return this.tasks.withProject(id, signal, undefined, async () => {
      const project = this.tasks.project(id);
      const untracked =
        !staged &&
        (await this.command(id, `ls-files --others --exclude-standard -z -- ${quote(path)}`, signal,
          project)).stdout
          .split('\0')
          .includes(path);
      const result = await this.command(
        id,
        `diff --no-ext-diff --no-textconv ${untracked ? '--no-index' : staged ? '--cached' : ''} -- ${untracked ? '/dev/null ' : ''}${quote(path)}`,
        signal,
        project,
      );
      if (result.code !== 0 && !(untracked && result.code === 1)) throw new AppError(result.stderr);
      return { diff: this.tasks.redact(id, redactGitOutput(result.stdout)).slice(0, 200000), truncated: result.stdout.length > 200000 };
    });
  }
  /**
   * 入口 / Entry: GitWorkbench.mergeInputs.
   * 功能：在提供仓库状态、差异、冲突处理和 Git 动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.tasks.withProject(id, signal, project, async () => { project = this.tasks.project(id); const directory = project.directo…` 供上层消费（`GitWorkbench`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GitWorkbench`; this entry produces `this.tasks.withProject(id, signal, project, async () => { project = this.tasks.project(id); const directory = project.directo…` for its caller. Module context: Exposes repository status, diffs, conflicts and actions, validating relative paths and branch inputs before work.
   * 处理：通过 `repositoryPath.parse`, `this.tasks.withProject` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `repositoryPath.parse`, `this.tasks.withProject`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; path: string; signal: AbortSignal optional; project: Project optional
   * 输出 / Returns: `this.tasks.withProject(id, signal, project, async () => { project = this.tasks.project(id); const directory = project.directo…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async mergeInputs(id: string, path: string, signal?: AbortSignal, project?: Project) {
    repositoryPath.parse(path);
    /**
     * 入口 / Entry: GitWorkbench.mergeInputs.callback@320.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.tasks.withProject）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.tasks.withProject).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ path, base: this.tasks.redact(id, values['1']), ours: this.tasks.redact(id, values['2']), theirs: this.tasks.redact(id, val…`.
     * 副作用 / Effects: `this.tasks.exec`; 更新 / updates `project`, `values[entry![3]]`.
     * 拒绝 / Refusals: 条件 / conditions `safe.code !== 0`; `index.code !== 0`; `entries.some((entry) => !entry) || !entries.some((entry) => entry?.[3] === '2') || !entries.some((entry) => entry?.[3] === '3…`; 异常 / errors `new AppError('冲突路径不能穿过符号链接')`; `new AppError(index.stderr)`.
     */
    return this.tasks.withProject(id, signal, project, async () => {
      project = this.tasks.project(id);
      const directory = project.directory;
      const components = path.split('/').filter(Boolean);
      const safe = await this.tasks.exec(
        id,
        components
          .map((_, index) => `test ! -L ${quote(posix.join(directory!, ...components.slice(0, index + 1)))}`)
          .join(' && '),
        10000,
        signal,
      );
      if (safe.code !== 0) throw new AppError('冲突路径不能穿过符号链接');
      const index = await this.command(id, `ls-files --unmerged -z -- ${quote(path)}`, signal, project);
      if (index.code !== 0) throw new AppError(index.stderr);
      const entries = index.stdout
        .split('\0')
        .filter(Boolean)
        .map((line) => line.match(/^(100644|100755) ([a-f0-9]{40,64}) ([123])\t/));
      if (
        entries.some((entry) => !entry) ||
        !entries.some((entry) => entry?.[3] === '2') ||
        !entries.some((entry) => entry?.[3] === '3')
      )
        throw new AppError('此文件不是可合并的普通文本冲突；删除、链接或子模块冲突请在终端处理', 409);
      const values: Record<string, string> = { '1': '', '2': '', '3': '' };
      for (const entry of entries) {
        const size = await this.command(id, `cat-file -s ${entry![2]}`, signal, project);
        if (size.code !== 0 || !/^\d+\s*$/.test(size.stdout) || Number(size.stdout) > 1024 ** 2)
          throw new AppError('冲突版本超过 1 MiB 或无法读取');
        const content = await this.command(id, `cat-file blob ${entry![2]}`, signal, project);
        if (content.code !== 0 || content.stdout.includes('\0') || content.stdout.includes('\uFFFD'))
          throw new AppError('三方编辑器需要 UTF-8 文本');
        values[entry![3]] = content.stdout;
      }
      // The conflict editor keeps the administrator Files read boundary (1 MiB UTF-8).
      // It never executes repository code and stays pinned to the leased original path.
      await this.tasks.assertCurrent(id);
      const current = await this.machines.readGuestFile(id, posix.join(directory, path));
      await this.tasks.assertCurrent(id);
      return {
        path,
        base: this.tasks.redact(id, values['1']),
        ours: this.tasks.redact(id, values['2']),
        theirs: this.tasks.redact(id, values['3']),
        expectedVersion: textVersion(current),
        expectedIndex: textVersion(index.stdout),
      };
    });
  }
  /**
   * 入口 / Entry: GitWorkbench.conflictChoices.
   * 功能：在提供仓库状态、差异、冲突处理和 Git 动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.tasks.withProject(id, signal, project, async () => { project = this.tasks.project(id); const directory = project.directo…` 供上层消费（`GitWorkbench`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GitWorkbench`; this entry produces `this.tasks.withProject(id, signal, project, async () => { project = this.tasks.project(id); const directory = project.directo…` for its caller. Module context: Exposes repository status, diffs, conflicts and actions, validating relative paths and branch inputs before work.
   * 处理：通过 `repositoryPath.parse`, `this.tasks.withProject` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `repositoryPath.parse`, `this.tasks.withProject`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; path: string; signal: AbortSignal optional; project: Project optional
   * 输出 / Returns: `this.tasks.withProject(id, signal, project, async () => { project = this.tasks.project(id); const directory = project.directo…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async conflictChoices(id: string, path: string, signal?: AbortSignal, project?: Project) {
    repositoryPath.parse(path);
    /**
     * 入口 / Entry: GitWorkbench.conflictChoices.callback@372.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.tasks.withProject）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.tasks.withProject).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ path, base: stages['1'] || null, ours: stages['2'] || null, theirs: stages['3'] || null, worktree: kind, expectedIndex: tex…`.
     * 副作用 / Effects: `this.tasks.exec`; `inline.exec`; 更新 / updates `project`, `stages[entry[3]]`, `worktree`.
     * 拒绝 / Refusals: 条件 / conditions `safe.code !== 0`; `index.code !== 0`; `!entry || entry[4] !== path || stages[entry[3]]`; 异常 / errors `new AppError('冲突路径不能穿过符号链接')`; `new AppError(index.stderr)`.
     */
    return this.tasks.withProject(id, signal, project, async () => {
      project = this.tasks.project(id);
      const directory = project.directory;
      const components = path.split('/').filter(Boolean);
      const safe = await this.tasks.exec(id,
        components.slice(0, -1)
          .map((_, index) => `test ! -L ${quote(posix.join(directory!, ...components.slice(0, index + 1)))}`)
          .join(' && ') || 'true', 10000, signal);
      if (safe.code !== 0) throw new AppError('冲突路径不能穿过符号链接');
      const index = await this.command(id, `ls-files --unmerged -z -- ${quote(path)}`, signal, project);
      if (index.code !== 0) throw new AppError(index.stderr);
      const stages: Record<string, { mode: string; oid: string }> = {};
      for (const line of index.stdout.split('\0').filter(Boolean)) {
        const entry = /^(100644|100755|120000|160000) ([a-f0-9]{40,64}) ([123])\t([^\0]*)$/.exec(line);
        if (!entry || entry[4] !== path || stages[entry[3]])
          throw new AppError('冲突索引包含不支持的条目，请在终端处理', 409);
        stages[entry[3]] = { mode: entry[1], oid: entry[2] };
      }
      if (!stages['2'] && !stages['3']) throw new AppError('此文件没有未解决的冲突', 409);
      const file = posix.join(directory, path);
      const type = await this.tasks.exec(id,
        `if test -L ${quote(file)}; then printf link; elif test -f ${quote(file)}; then printf file; ` +
        `elif test -d ${quote(file)}; then printf directory; else printf missing; fi`, 10000, signal);
      if (type.code !== 0) throw new AppError('无法检查冲突文件状态');
      const kind = type.stdout.trim();
      let worktree = kind;
      if (kind === 'file') {
        const hash = await this.command(id, `hash-object --no-filters -- ${quote(path)}`, signal, project);
        if (hash.code !== 0 || !/^[a-f0-9]{40,64}\s*$/.test(hash.stdout))
          throw new AppError('无法校验冲突文件内容，请重新打开', 409);
        worktree += ':' + hash.stdout.trim();
      } else if (kind === 'link') {
        const target = await this.tasks.exec(id, `readlink -n -- ${quote(file)}`, 10000, signal);
        if (target.code !== 0) throw new AppError('无法校验冲突符号链接，请重新打开', 409);
        worktree += ':' + target.stdout;
      } else if (kind === 'directory') {
        const head = await this.command(id, `-C ${quote(path)} rev-parse --verify HEAD`, signal, project);
        const status = head.code === 0
          ? await this.command(id, `-C ${quote(path)} status --porcelain=v1 -z`, signal, project)
          : null;
        if (status && status.code !== 0) throw new AppError('无法校验子模块工作目录，请重新打开', 409);
        worktree += ':' + (head.code === 0 ? head.stdout : '') + ':' + (status?.stdout || '');
      } else if (kind !== 'missing') throw new AppError('无法识别冲突文件状态');
      return {
        path,
        base: stages['1'] || null,
        ours: stages['2'] || null,
        theirs: stages['3'] || null,
        worktree: kind,
        expectedIndex: textVersion(index.stdout),
        expectedWorktree: textVersion(worktree),
      };
    });
  }
  /**
   * 入口 / Entry: GitWorkbench.run.
   * 功能：校验 Git 动作并在捕获的项目执行域完成分支、暂存、提交或冲突操作。
   * Purpose: Validates Git actions and runs branch/stage/commit/conflict work in the captured project execution scope.
   * 设计：路径、分支与动作条件在修改前核对；不把任务输出中的凭证带入日志，远端动作走专门认证边界。
   * Design: Path/branch/action preconditions precede mutations; credential-bearing output is redacted and remote work uses its dedicated boundary.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `this.machines.locked(`git:${captured.key}`, async () => this.tasks.inScope(captured, async () => { if (this.machines.state(id…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async run(id: string, input: unknown) {
    const value = gitActionSchema.parse(input);
    const captured = await this.tasks.capture(id);
    /**
     * 入口 / Entry: GitWorkbench.run.callback@429.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.tasks.inScope）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.tasks.inScope).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.jobs.start( this.workspaces.projects.key(id), async (rawLog, signal, update) => this.tasks.runCaptured(captured, signal,…`.
     * 副作用 / Effects: `this.jobs.start`.
     * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('请先启动发行版')`.
     */
    return this.machines.locked(`git:${captured.key}`, async () => this.tasks.inScope(captured,
    /**
     * 中文功能：要求实例运行后创建保留原项目配置的 Git job，任务中的命令与日志使用捕获执行域和脱敏能力。
     * English: Requires a running VM and creates a Git job retaining original project configuration, using captured execution scope and redaction for commands/logs.
     * 所属 / Owner: GitWorkbench.run.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     */
    async () => {
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
      // The accepted job retains its original config, named scope and Live.
      const project = captured.project;
      const { directory } = project;
      /**
       * 入口 / Entry: GitWorkbench.run.callback@436.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.tasks.runCaptured）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.tasks.runCaptured).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `this.machines.writeGuestFile`; `execute`; 更新 / updates `command`.
       * 拒绝 / Refusals: 条件 / conditions `value.action === 'fetch' || value.action === 'pull' || value.action === 'push'`; `error instanceof Error`; `message !== error.message`; 异常 / errors `reported`; `error`.
       * 失败处理：catch 分支执行 `if (error instanceof Error) { const message = redactGitOutput(error.message); if (message !== error.message) { try { Object.d…`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `if (error instanceof Error) { const message = redactGitOutput(error.message); if (message !== error.message) { try { Object.d…`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
       */
      return this.jobs.start(
        this.workspaces.projects.key(id),
        async (rawLog, signal, update) => this.tasks.runCaptured(captured, signal,
        /**
         * 中文功能：执行选定 Git 动作；合并和冲突选择复核索引/工作区版本，提交前扫描暂存密钥，命令失败输出脱敏异常。
         * English: Executes the Git action, rechecking index/worktree versions for merges/conflict choices, scanning staged secrets before commit and reporting redacted command failures.
         * 所属 / Owner: GitWorkbench.run.
         * 输入 / Inputs: 无显式参数 / no explicit parameters.
         * 设计：分支名和远端输入通过对应校验；冲突编辑先核对原项目身份，子模块选择不自动改变其工作目录。
         * Design: Validate branch/remote inputs; conflict edits recheck original project identity and submodule choices do not automatically change their working directory.
         */
        async () => {
          /**
           * 入口 / Entry: GitWorkbench.run.log.
           * 功能：在提供仓库状态、差异、冲突处理和 Git 动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `rawLog(this.tasks.redact(id, redactGitOutput(text)))` 供上层消费（`GitWorkbench`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `GitWorkbench`; this entry produces `rawLog(this.tasks.redact(id, redactGitOutput(text)))` for its caller. Module context: Exposes repository status, diffs, conflicts and actions, validating relative paths and branch inputs before work.
           * 处理：通过 `rawLog`, `this.tasks.redact`, `redactGitOutput` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `rawLog`, `this.tasks.redact`, `redactGitOutput`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: text: string
           * 输出 / Returns: `rawLog(this.tasks.redact(id, redactGitOutput(text)))`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          const log = (text: string) => rawLog(this.tasks.redact(id, redactGitOutput(text)));
          /**
           * 入口 / Entry: GitWorkbench.run.execute.
           * 功能：把本层请求转交 `this.command`，沿用该实现的结果与失败路径。
           * Purpose: Delegates this request to `this.command` and propagates the provider result or rejection.
           * 输入 / Inputs: command; network
           * 输出 / Returns: `this.command(id, command, signal, project, network)`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          const execute: GitCommand = (command, network) =>
            this.command(id, command, signal, project, network);
          if (value.action === 'fetch' || value.action === 'pull' || value.action === 'push') {
            try {
              await this.remoteAction(value, execute, log, update);
            } catch (error) {
              if (error instanceof Error) {
                const message = redactGitOutput(error.message);
                if (message !== error.message) {
                  try { Object.defineProperty(error, 'message', { value: message, writable: true, configurable: true }); }
                  catch {
                    const reported = new AppError(message, error instanceof AppError ? error.status : 500,
                      error instanceof AppError ? error.code : undefined);
                    Object.defineProperty(reported, 'cause', { value: error }); throw reported;
                  }
                }
              }
              throw error;
            }
            return;
          }
          let command: string;
          if (value.action === 'remote-add' && !value.url) throw new AppError('新增远程仓库需要 HTTPS 地址');
          switch (value.action) {
            case 'resolve': {
              const current = await this.mergeInputs(id, value.path, signal, project);
              if (
                current.expectedIndex !== value.expectedIndex ||
                current.expectedVersion !== value.expectedVersion
              )
                throw new AppError('冲突或文件已变化，请重新打开三方合并', 409);
              // The administrator conflict-editor upload keeps expectedVersion,
              // file history and UID/GID/mode preservation; Git itself stays at UID.
              await this.tasks.assertCurrent(id);
              await this.machines.writeGuestFile(
                id,
                posix.join(directory, value.path),
                value.content,
                true,
                value.expectedVersion,
              );
              await this.tasks.assertCurrent(id);
              command = `add -- ${quote(value.path)}`;
              break;
            }
            case 'resolve-choice': {
              const current = await this.conflictChoices(id, value.path, signal, project);
              if (current.expectedIndex !== value.expectedIndex ||
                  current.expectedWorktree !== value.expectedWorktree)
                throw new AppError('冲突或文件已变化，请重新选择版本', 409);
              const chosen = value.choice === 'ours' ? current.ours : current.theirs;
              if (chosen) {
                if (chosen.mode !== '160000') {
                  const checkout = await execute(`checkout --${value.choice} -- ${quote(value.path)}`);
                  if (checkout.code !== 0) throw new AppError(redactGitOutput(checkout.stderr));
                } else log('已选择子模块提交；子模块工作目录不会自动切换。\n');
                command = `update-index --add --cacheinfo ${chosen.mode},${chosen.oid},${quote(value.path)}`;
              } else if (current.worktree === 'directory') {
                log('已选择删除索引中的子模块；现有目录留在工作区供人工检查。\n');
                command = `update-index --force-remove -- ${quote(value.path)}`;
              } else command = `rm -f -- ${quote(value.path)}`;
              break;
            }
            case 'stage':
              command = `add -A -- ${value.paths.map(quote).join(' ')}`;
              break;
            case 'unstage': {
              const head = await execute('rev-parse --verify HEAD');
              command =
                head.code === 0
                  ? `reset -q HEAD -- ${value.paths.map(quote).join(' ')}`
                  : `rm --cached -- ${value.paths.map(quote).join(' ')}`;
              break;
            }
            case 'commit':
              {
                const pattern =
                  '-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----|\\b(AKIA|ASIA)[A-Z0-9]{16}\\b|\\bgh[pousr]_[A-Za-z0-9]{30,}\\b|\\bgithub_pat_[A-Za-z0-9_]{40,}\\b';
                const state = await repositoryState(execute);
                if (state.conflicts.length)
                  throw new AppError('请先解决所有文件冲突并暂存，再提交。', 409, 'git_conflict');
                const scan = await execute('grep --cached -I -n -z -E -e ' + quote(pattern) + ' --');
                if (scan.code !== 0 && scan.code !== 1) throw new AppError('无法检查 Git 暂存区，提交已停止');
                if (scan.code === 0) {
                  const locations = scan.stdout.split('\n').flatMap((line) => {
                    const match = /^([^\0]+)\0(\d+)\0/.exec(line);
                    return match ? [match[1] + ':' + match[2]] : [];
                  });
                  log('暂存区发现疑似密钥：\n' + locations.join('\n') + '\n');
                  throw new AppError('暂存区包含疑似密钥，请移除后重新提交');
                }
              }
              command = `${value.author ? `-c user.name=${quote(value.author)} ` : ''}${value.email ? `-c user.email=${quote(value.email)} ` : ''}commit -m ${quote(value.message)}`;
              break;
            case 'branch':
            case 'switch': {
              const check = await execute(`check-ref-format --branch ${quote(value.branch)}`);
              if (check.code !== 0) throw new AppError('分支名称不符合 Git 规则');
              command = `switch ${value.action === 'branch' ? '-c ' : '-- '}${quote(value.branch)}`;
              break;
            }
            case 'remote-add':
              command = `remote add ${quote(value.name)} ${quote(value.url!)}`;
              break;
            case 'remote-remove':
              command = `remote remove ${quote(value.name)}`;
              break;
            case 'merge':
              requireSettled(await repositoryState(execute), true);
              command = `merge --no-autostash --no-overwrite-ignore --no-rerere-autoupdate ${value.ffOnly ? '--ff-only' : '--no-edit'} -- ${quote(value.branch)}`;
              break;
            default:
              command = 'init';
          }
          const result = await execute(command);
          log(redactGitOutput(result.stdout + result.stderr));
          if (result.code !== 0) {
            if (value.action === 'merge') {
              const state = await repositoryState(execute);
              if (state.conflicts.length) requireSettled(state);
            }
            throw new AppError(redactGitOutput(result.stderr) || `Git 操作失败（${result.code}）`);
          }
        }),
        {
          title: `Git · ${value.action}${'remote' in value ? ' · ' + value.remote + (value.branch ? '/' + value.branch : '') : ''}`,
          vmId: id,
          action: value.action,
          projectId: this.workspaces.projects.current(id),
        },
      );
    }));
  }
  /**
   * 入口 / Entry: GitWorkbench.remoteAction.
   * 功能：为 fetch/pull/push 等远端动作准备限定凭证和受控 Git 环境。
   * Purpose: Prepares scoped credentials and controlled Git environment for remote fetch/pull/push work.
   * 设计：认证范围依据保存的仓库配置，禁止任意环境扩展凭证用途；临时材料在原任务收尾中释放。
   * Design: Saved repository configuration defines credential scope; arbitrary environments cannot widen it, and task cleanup owns temporary material.
   * 输入 / Inputs: value: { action: 'fetch' | 'pull' | 'push'; remote: string; branch?: string }; execute: GitCommand; log: (text: string) => void; update: (phase: string) => void
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `update`; `execute`; `fetched.stdout.trim`.
   * 拒绝 / Refusals: 条件 / conditions `remotes.code !== 0 || !remotes.stdout.trim().split('\n').includes(value.remote)`; `urls.code !== 0 || targets.some((url) => !remoteUrl.safeParse(url).success)`; `targets.length !== 1`; 异常 / errors `new AppError('远程仓库不存在，请刷新并选择已配置的远程。', 409, 'git_remote_missing')`; `new AppError( '远程目标必须使用不含凭证的 HTTPS 地址；请检查远程地址及 URL 重写配置。', 409, 'git_unsafe_remote', )`.
   */
  private async remoteAction(
    value: { action: 'fetch' | 'pull' | 'push'; remote: string; branch?: string },
    execute: GitCommand,
    log: (text: string) => void,
    update: (phase: string) => void,
  ) {
    update('检查仓库与远程目标');
    const state = await repositoryState(execute);
    if (value.action !== 'fetch') requireSettled(state, value.action === 'pull');
    const remotes = await execute('remote');
    if (remotes.code !== 0 || !remotes.stdout.trim().split('\n').includes(value.remote))
      throw new AppError('远程仓库不存在，请刷新并选择已配置的远程。', 409, 'git_remote_missing');
    const urls = await execute(
      `remote get-url ${value.action === 'push' ? '--push ' : ''}--all -- ${quote(value.remote)}`,
    );
    const targets = urls.stdout.trim().split('\n');
    if (urls.code !== 0 || targets.some((url) => !remoteUrl.safeParse(url).success))
      throw new AppError(
        '远程目标必须使用不含凭证的 HTTPS 地址；请检查远程地址及 URL 重写配置。',
        409,
        'git_unsafe_remote',
      );
    if (targets.length !== 1)
      throw new AppError('远程配置了多个目标地址，请先在终端选择唯一目标。', 409, 'git_ambiguous_remote');
    const branch =
      value.action === 'fetch'
        ? value.branch
        : value.branch || (state.upstream?.remote === value.remote ? state.upstream.branch : state.branch);
    if (branch) {
      if (
        !branchName.safeParse(branch).success ||
        (await execute(`check-ref-format ${quote(`refs/heads/${branch}`)}`)).code !== 0
      )
        throw new AppError('目标分支名称不符合 Git 规则。', 400, 'git_invalid_branch');
    } else if (value.action !== 'fetch') {
      throw new AppError('请选择目标分支。', 409, 'git_invalid_branch');
    }
    // Override repository defaults: only HTTPS, no recursive submodule operations,
    // no configured refspecs, implicit tags, pruning, mirroring or force pushes.
    const network = '-c protocol.allow=never -c protocol.https.allow=always -c http.followRedirects=false';
    /**
     * 入口 / Entry: GitWorkbench.remoteAction.run.
     * 功能：校验 Git 动作并在捕获的项目执行域完成分支、暂存、提交或冲突操作。
     * Purpose: Validates Git actions and runs branch/stage/commit/conflict work in the captured project execution scope.
     * 设计：路径、分支与动作条件在修改前核对；不把任务输出中的凭证带入日志，远端动作走专门认证边界。
     * Design: Path/branch/action preconditions precede mutations; credential-bearing output is redacted and remote work uses its dedicated boundary.
     * 输入 / Inputs: command: string
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `execute`.
     * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; `/\[rejected\].*(non-fast-forward|fetch first)/i.test(output)`; `/couldn't find remote ref/i.test(output)`; 异常 / errors `new AppError( '推送被拒绝：远程分支包含本地尚未整合的提交。请获取更新并手动整合分叉后重试；不会强制推送。', 409, 'git_push_rejected', )`; `new AppError(`远程分支 ${branch} 不存在，请检查目标分支。`, 409, 'git_remote_branch_missing')`.
     */
    const run = async (command: string) => {
      const result = await execute(`${network} ${command}`, true);
      log(redactGitOutput(result.stdout + result.stderr));
      if (result.code !== 0) {
        const output = result.stdout + result.stderr;
        if (/\[rejected\].*(non-fast-forward|fetch first)/i.test(output))
          throw new AppError(
            '推送被拒绝：远程分支包含本地尚未整合的提交。请获取更新并手动整合分叉后重试；不会强制推送。',
            409,
            'git_push_rejected',
          );
        if (/couldn't find remote ref/i.test(output))
          throw new AppError(`远程分支 ${branch} 不存在，请检查目标分支。`, 409, 'git_remote_branch_missing');
        throw new AppError(
          redactGitOutput(result.stderr || result.stdout) || `Git 网络操作失败（${result.code}）`,
          400,
          'git_remote_failed',
        );
      }
    };
    if (value.action === 'push') {
      update(`推送当前提交到 ${value.remote}/${branch}`);
      log(`推送 ${state.branch} → ${value.remote}/${branch}\n`);
      await run(
        `-c push.followTags=false -c remote.${value.remote}.mirror=false push --porcelain --no-force --no-mirror --no-follow-tags --recurse-submodules=no -- ${quote(value.remote)} ${quote(`${state.head}:refs/heads/${branch}`)}`,
      );
      return;
    }
    // Fetch without an explicit branch updates all remote-tracking branches.
    const fetchBranch = value.action === 'pull' ? branch! : value.branch;
    const tracking = `refs/remotes/${value.remote}/${fetchBranch || '*'}`;
    update(`获取 ${value.remote}${fetchBranch ? '/' + fetchBranch : ''}`);
    await run(
      `fetch --atomic --no-tags --no-prune --no-prune-tags --no-recurse-submodules --refmap= -- ${quote(value.remote)} ${quote(`+refs/heads/${fetchBranch || '*'}:${tracking}`)}`,
    );
    if (value.action === 'fetch') return;
    const fetched = await execute(`rev-parse --verify ${quote(tracking + '^{commit}')}`);
    if (fetched.code !== 0)
      throw new AppError('无法读取获取的提交，请重新获取更新。', 409, 'git_remote_failed');
    const target = fetched.stdout.trim();
    const current = await repositoryState(execute);
    requireSettled(current, true);
    if (current.head !== state.head || current.branch !== state.branch)
      throw new AppError('获取更新期间本地分支发生变化，请刷新并重试。', 409, 'git_branch_changed');
    const ancestor = await execute(`merge-base --is-ancestor ${quote(state.head!)} ${quote(target)}`);
    if (ancestor.code === 1) {
      const ahead = await execute(`merge-base --is-ancestor ${quote(target)} ${quote(state.head!)}`);
      if (ahead.code === 0) {
        log('当前分支已包含远程提交，无需快进。\n');
        return;
      }
      if (ahead.code !== 1) throw new AppError(redactGitOutput(ahead.stderr) || '无法比较提交历史');
      throw new AppError(
        '本地与远程历史已分叉，无法快进拉取。本地提交和文件保持不变；请在终端手动合并或变基，解决冲突后重试。',
        409,
        'git_diverged',
      );
    }
    if (ancestor.code !== 0) throw new AppError(redactGitOutput(ancestor.stderr) || '无法比较提交历史');
    update(`快进 ${state.branch} ← ${value.remote}/${branch}`);
    const merged = await execute(
      `-c submodule.recurse=false -c ${quote(`branch.${state.branch}.mergeOptions=`)} merge --ff-only --no-squash --no-autostash --no-overwrite-ignore --no-edit -- ${quote(target)}`,
    );
    log(redactGitOutput(merged.stdout + merged.stderr));
    if (merged.code !== 0)
      throw new AppError(
        '快进拉取已停止，请检查工作区和冲突后重试。\n' + redactGitOutput(merged.stderr),
        409,
        'git_pull_blocked',
      );
  }
  /**
   * 入口 / Entry: GitWorkbench.close.
   * 功能：在提供仓库状态、差异、冲突处理和 Git 动作中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`GitWorkbench`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `GitWorkbench`; the calls and state transitions below complete the operation. Module context: Exposes repository status, diffs, conflicts and actions, validating relative paths and branch inputs before work.
   * 处理：通过 `this.jobs.close`, `this.tasks.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.jobs.close`, `this.tasks.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.jobs.close`; `this.tasks.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `await this.tasks.close();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await this.tasks.close();`; these steps also apply to exceptional exits.
   */
  async close() {
    try { await this.jobs.close(); } finally { await this.tasks.close(); }
  }
}
