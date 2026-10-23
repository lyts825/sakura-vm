/**
 * 模块职责：管理项目配置、准备和运行，协调网络、凭证、日志与客户机身份变化钩子。
 * Module purpose: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
 */
import type { JobsV1, NetworkProfilesV1, ProjectCatalogV1, SecretsV1 } from './service-contracts/v1.ts';
import { projectMetadataFile } from './project-catalog.ts';
import { assertProjectPreparationIdle } from './project-preparation-registry.ts';
import { createHash } from 'node:crypto';
import { readCommittedStore, readStore } from './local-store.ts';
import { replaceMetadata } from './metadata-store.ts';
import { AppError } from '../shared/errors.ts';
import { cleanupReceipt } from './cleanup-receipt.ts';
import { terminalSessionPrefix } from '../shared/terminal-scope.ts';
import { resolveDependencyAuthentication } from './dependency-downloads.ts';
import { guestTask } from './guest-task.ts';
import { Jobs } from './jobs.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { Metrics } from './metrics.ts';

import { privateDockerPaths, privateDockerStatus } from './private-docker.ts';
import { ProjectCatalog } from './project-catalog.ts';
import { projectSchema, projectVersion, type Project } from './project-config.ts';
import type { DependencyManager } from './project-dependency-cache.ts';
import { legacyMainStatus, mainLog, mainSession, runProjectMain, stopProjectMain } from './project-main.ts';
import { ensureProjectNetworkScript, removeProjectNetwork } from './project-network-isolation.ts';
import { guardProjectQuotaDirectory, projectQuota, readProjectQuotaRecord } from './project-quota.ts';
import { prepareProjectRepository } from './project-repository.ts';
import { ProjectRunScopes, projectIdentityTask } from './project-run-scope.ts';
import { ProjectMainScope, ProjectServiceScopes } from './project-service-scope.ts';
import { runServices, serviceLog, type ProjectService } from './project-services.ts';
import { projectSshBusyScript } from './project-ssh.ts';
import { repositoryAuthorizationScope } from './repository-url.ts';
import { runtimeEnvironment } from './runtime-config.ts';
import { privateLog, redactValues } from './secrets.ts';
import { quote } from './shell.ts';
export { metricsScript,parseMetrics } from './metrics.ts';

export { projectSchema,projectVersion,type Project } from './project-config.ts';
export const projectSession = mainSession;
export const projectLog = mainLog;
export type ProjectRuntime = { status: string; log: string;
  services?: { name: string; status: string; log: string }[]; main?: { status: string } };
/**
 * 入口 / Entry: runtimeLogCommand.
 * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `'# SAKURA_PROJECT_RUNTIME_LOG\n' + `if [ ! -x /usr/bin/python3 ]; then echo 'SAKURA_PROJECT_RUNTIME_LOG_REFUSED: 缺少系统 Python；…` 供上层消费（`workspaces.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `workspaces.ts`; this entry produces `'# SAKURA_PROJECT_RUNTIME_LOG\n' + `if [ ! -x /usr/bin/python3 ]; then echo 'SAKURA_PROJECT_RUNTIME_LOG_REFUSED: 缺少系统 Python；…` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
 * 处理：通过 `inline.test`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`, `quote`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: path: string; limit: 8192 | 16384
 * 输出 / Returns: `'# SAKURA_PROJECT_RUNTIME_LOG\n' + `if [ ! -x /usr/bin/python3 ]; then echo 'SAKURA_PROJECT_RUNTIME_LOG_REFUSED: 缺少系统 Python；…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!/^\/tmp\/(?:sakura-project(?:-[a-f0-9]{16})?|sakura-service-(?:[a-f0-9]{16}-)?[a-z][a-z0-9-]{0,31})\.log$/.test(path)`; 异常 / errors `new AppError('项目日志路径无法核对', 409)`.
 */
function runtimeLogCommand(path: string, limit: 8192 | 16384) {
  if (!/^\/tmp\/(?:sakura-project(?:-[a-f0-9]{16})?|sakura-service-(?:[a-f0-9]{16}-)?[a-z][a-z0-9-]{0,31})\.log$/.test(path))
    throw new AppError('项目日志路径无法核对', 409);
  const source = `import os,stat,sys
path=${JSON.stringify(path)}; limit=${limit}
try:
 try: descriptor=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC)
 except FileNotFoundError: sys.exit(0)
 try:
  info=os.fstat(descriptor)
  if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o600:
   raise RuntimeError('日志文件归属、类型或权限无法核对')
  os.lseek(descriptor,max(0,info.st_size-limit),os.SEEK_SET)
  sys.stdout.buffer.write(os.read(descriptor,limit))
 finally: os.close(descriptor)
except Exception as error:
 print('SAKURA_PROJECT_RUNTIME_LOG_REFUSED: '+str(error),file=sys.stderr);sys.exit(73)
`;
  return '# SAKURA_PROJECT_RUNTIME_LOG\n' +
    `if [ ! -x /usr/bin/python3 ]; then echo 'SAKURA_PROJECT_RUNTIME_LOG_REFUSED: 缺少系统 Python；未读取未确认的 root 日志' >&2; exit 73; fi\n` +
    `/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C LC_ALL=C /usr/bin/python3 -I -S -c ${quote(source)}`;
}
/**
 * 入口 / Entry: projectPrivateValues.
 * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[ ...Object.keys(project.secrets || {}).map((key) => project.environment?.[key] || ''), ...(project.services || []).flatMap((…` 供上层消费（`workspaces.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `workspaces.ts`; this entry produces `[ ...Object.keys(project.secrets || {}).map((key) => project.environment?.[key] || ''), ...(project.services || []).flatMap((…` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
 * 处理：通过 `inline.filter`, `inline.flatMap` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.filter`, `inline.flatMap`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `[ ...Object.keys(project.secrets || {}).map((key) => project.environment?.[key] || ''), ...(project.services || []).flatMap((…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectPrivateValues(project: Project) {
  return [
    ...Object.keys(project.secrets || {}).map((key) => project.environment?.[key] || ''),
    ...(project.services || []).flatMap((service) =>
      Object.keys(service.secrets || {}).map((key) => service.environment?.[key] || ''),
    ),
  ].filter(Boolean);
}
/**
 * 入口 / Entry: setupFingerprint.
 * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256') .update( JSON.stringify({ directory, template, repository, setup, networkIsolation: networkIsolation || …` 供上层消费（`workspaces.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `workspaces.ts`; this entry produces `createHash('sha256') .update( JSON.stringify({ directory, template, repository, setup, networkIsolation: networkIsolation || …` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
 * 处理：通过 `createHash().update().digest().slice`, `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest().slice`, `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `createHash('sha256') .update( JSON.stringify({ directory, template, repository, setup, networkIsolation: networkIsolation || …`.
 * 副作用 / Effects: `createHash().update().digest().slice`; `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function setupFingerprint(project: Project) {
  const { directory, template, repository, setup, environment, networkIsolation } = project;
  return createHash('sha256')
    .update(
      JSON.stringify({
        directory,
        template,
        repository,
        setup,
        networkIsolation: networkIsolation || 'host',
        ...(environment && Object.keys(environment).length ? { environment } : {}),
      }),
    )
    .digest('hex')
    .slice(0, 16);
}
/**
 * 入口 / Entry: provisionScript.
 * 功能：从当前输入或状态计算 ``set -eu\nsakura_attempt=0\nuntil (\nset -e\n${install}\n); do\n sakura_attempt=$((sakura_attempt + 1))\n [ "$sakura_attempt"…`，供调用方后续验证或使用。
 * Purpose: Computes ``set -eu\nsakura_attempt=0\nuntil (\nset -e\n${install}\n); do\n sakura_attempt=$((sakura_attempt + 1))\n [ "$sakura_attempt"…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: template: Project['template']; distro: default='alpine'
 * 输出 / Returns: ``set -eu\nsakura_attempt=0\nuntil (\nset -e\n${install}\n); do\n sakura_attempt=$((sakura_attempt + 1))\n [ "$sakura_attempt"…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function provisionScript(template: Project['template'], distro = 'alpine') {
  const packages =
    distro === 'alpine'
      ? {
          none: 'git tmux',
          node: 'git tmux nodejs npm',
          python: 'git tmux python3 py3-pip',
          rust: 'git tmux rust cargo build-base',
        }
      : {
          none: 'git tmux',
          node: 'git tmux nodejs npm',
          python: 'git tmux python3 python3-pip python3-venv',
          rust: 'git tmux rustc cargo build-essential',
        };
  const install =
    distro === 'alpine'
      ? `apk add --no-cache --timeout 30 ${packages[template]}`
      : `export DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update &&\napt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 install -y ${packages[template]}`;
  return `set -eu\nsakura_attempt=0\nuntil (\nset -e\n${install}\n); do\n  sakura_attempt=$((sakura_attempt + 1))\n  [ "$sakura_attempt" -lt 3 ] || exit 1\n  echo '软件源暂时不可用，正在重试…'\n  sleep 2\ndone\nmkdir -p /etc/sakura /workspace\ntouch /etc/sakura/template-${template}\n`;
}
export class Workspaces {
  jobs: JobsV1;
  projects: ProjectCatalogV1;
  private configListeners = new Set<
  /**
   * 中文功能：为 Workspaces.configListeners 登记事件、状态变化或阶段结束通知，接收本声明规定的事件数据。
   * English: Registers event/state-change/phase-completion notification for Workspaces.configListeners using its declared event data.
   * 所属 / Owner: Workspaces.configListeners.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `Promise<void>`.
   */
  () => Promise<void>>();
  private configGuards = new Set<
  /**
   * 中文功能：在 Workspaces.configGuards 所属变更前核验原输入或身份条件；未通过以异常或 Promise 拒绝阻止变更。
   * English: Checks original input/identity conditions before the change owned by Workspaces.configGuards; exceptions or Promise rejection prevent that change.
   * 所属 / Owner: Workspaces.configGuards.
   * 输入 / Inputs: id: string; previous: Project; next: Project.
   * 结果 / Result: `Promise<void>`.
   */
  (id: string, previous: Project, next: Project) => Promise<void>>();
  private observed = new Map<string, string>();
  private sampler: Metrics;
  private actionHooks = new Set<
  /**
   * 中文功能：声明操作准备/结算通道，返回或接收的 success 回执用于原操作结果确认。
   * English: Declares an operation preparation/settlement channel whose returned or supplied success receipt confirms the original operation result.
   * 所属 / Owner: Workspaces.actionHooks.
   * 输入 / Inputs: id: string; action: 'start' | 'stop'; service?: string.
   * 结果 / Result: `Promise<(success: boolean) => void>`.
   */
  (id: string, action: 'start' | 'stop', service?: string) => Promise<
  /**
   * 中文功能：声明操作准备/结算通道，返回或接收的 success 回执用于原操作结果确认。
   * English: Declares an operation preparation/settlement channel whose returned or supplied success receipt confirms the original operation result.
   * 所属 / Owner: Workspaces.actionHooks.
   * 输入 / Inputs: success: boolean.
   * 结果 / Result: `void`.
   */
  (success: boolean) => void>>();
  /**
   * 入口 / Entry: Workspaces.beforeAction.
   * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `cleanupReceipt(() => { this.actionHooks.delete(hook); })` 供上层消费（`Workspaces`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; this entry produces `cleanupReceipt(() => { this.actionHooks.delete(hook); })` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
   * 处理：通过 `this.actionHooks.add`, `cleanupReceipt` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.actionHooks.add`, `cleanupReceipt`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: hook: (id: string, action: 'start' | 'stop', service?: string) => Promise<(success: boolean…
   * 输出 / Returns: `cleanupReceipt(() => { this.actionHooks.delete(hook); })`.
   * 副作用 / Effects: `this.actionHooks.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  beforeAction(hook: (id: string, action: 'start' | 'stop', service?: string) => Promise<(success: boolean) => void>) {
    this.actionHooks.add(hook);
    return cleanupReceipt(() => { this.actionHooks.delete(hook); });
  }
  /**
   * 入口 / Entry: Workspaces.prepareAction.
   * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(success: boolean) => { for (const receipt of receipts) receipt(success); }` 供上层消费（`Workspaces`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; this entry produces `(success: boolean) => { for (const receipt of receipts) receipt(success); }` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
   * 处理：通过 `receipts.push`, `hook`, `receipt` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `receipts.push`, `hook`, `receipt`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; action: 'start' | 'stop'; service: string optional
   * 输出 / Returns: `(success: boolean) => { for (const receipt of receipts) receipt(success); }`.
   * 副作用 / Effects: `receipts.push`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `for (const receipt of receipts) receipt(false);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `for (const receipt of receipts) receipt(false);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async prepareAction(id: string, action: 'start' | 'stop', service?: string) {
    const receipts: (
    /**
     * 中文功能：声明操作准备/结算通道，返回或接收的 success 回执用于原操作结果确认。
     * English: Declares an operation preparation/settlement channel whose returned or supplied success receipt confirms the original operation result.
     * 所属 / Owner: Workspaces.prepareAction.receipts.
     * 输入 / Inputs: success: boolean.
     * 结果 / Result: `void`.
     */
    (success: boolean) => void)[] = [];
    try { for (const hook of this.actionHooks) receipts.push(await hook(id, action, service)); }
    catch (error) { for (const receipt of receipts) receipt(false); throw error; }
    return (success: boolean) => { for (const receipt of receipts) receipt(success); };
  }
  /**
   * 入口 / Entry: Workspaces.constructor.
   * 功能：建立 Workspaces 的管理项目配置、准备和运行上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Workspaces context for this module's responsibility: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; context: { secrets?: SecretsV1; network?: NetworkProfilesV1 } optional; options: { background?: boolean } default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.jobs`, `this.sampler`, `this.projects`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    private machines: Machines,
    private context?: { secrets?: SecretsV1; network?: NetworkProfilesV1 },
    options: { background?: boolean } = {},
  ) {
    this.jobs = new Jobs(options.background === false ? undefined : 'projects');
    this.sampler = new Metrics(machines);
    this.projects = new ProjectCatalog(machines);
    if (options.background !== false) machines.on('change', this.onChange);
  }
  /**
   * 入口 / Entry: Workspaces.onChange.
   * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Workspaces`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; the calls and state transitions below complete the operation. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
   * 处理：通过 `this.observed.keys`, `this.machines.records.has`, `this.observed.delete`, `machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.observed.keys`, `this.machines.records.has`, `this.observed.delete`, `machines.live.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.machines.records.has(id)`; `!live || live.status !== 'running'`; `job.vmId === id && job.status === 'running'`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.observed.keys`; `this.observed.delete`; `this.observed.get`; `this.observed.set`; `this.jobs.start`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private onChange = () => {
    for (const id of this.observed.keys()) if (!this.machines.records.has(id)) this.observed.delete(id);
    const machines = this.machines;
    for (const [id, vm] of machines.records) {
      const live = machines.live.get(id);
      if (!live || live.status !== 'running') {
        for (const job of this.jobs.list())
          if (job.vmId === id && job.status === 'running') this.jobs.cancel(job.id!);
        this.sampler.forget(id);
        continue;
      }
      const boot = `${id}:${live.startedAt}`;
      if (vm.template && vm.template !== 'none' && this.observed.get(id) !== boot) {
        if (this.jobs.view(this.projects.key(id))?.status === 'running') continue;
        this.observed.set(id, boot);
        /**
         * 入口 / Entry: Workspaces.callback@154.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
         * 输入 / Inputs: log; signal
         * 输出 / Returns: `void`.
         * 副作用 / Effects: `machines.exec`; `this.execute`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        this.jobs.start(
          this.projects.key(id),
          async (log, signal) => {
            const check = await machines.exec(
              id,
              `test -f /etc/sakura/template-${vm.template}`,
              10000,
              signal,
            );
            if (check.code === 0) {
              log('开发环境已安装。\n');
              return;
            }
            await this.execute(id, provisionScript(vm.template!, vm.distro), log, signal);
          },
          { title: '安装开发环境', vmId: id, action: 'setup' },
        );
      }
    }
  };
  /**
   * 入口 / Entry: Workspaces.close.
   * 功能：在管理项目配置、准备和运行中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`Workspaces`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Workspaces`; the calls and state transitions below complete the operation. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
   * 处理：通过 `this.machines.off`, `this.observed.clear`, `this.configListeners.clear`, `this.configGuards.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.off`, `this.observed.clear`, `this.configListeners.clear`, `this.configGuards.clear`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.observed.clear`; `this.configListeners.clear`; `this.configGuards.clear`; `this.jobs.close`; `this.sampler.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.machines.off('change', this.onChange);
    this.observed.clear();
    this.configListeners.clear();
    this.configGuards.clear();
    await Promise.all([this.jobs.close(), this.sampler.close()]);
  }
  /**
   * 入口 / Entry: Workspaces.onConfigChange.
   * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `cleanupReceipt(() => { this.configListeners.delete(listener); })` 供上层消费（`Workspaces`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; this entry produces `cleanupReceipt(() => { this.configListeners.delete(listener); })` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
   * 处理：通过 `this.configListeners.add`, `cleanupReceipt` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.configListeners.add`, `cleanupReceipt`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: listener: () => Promise<void>
   * 输出 / Returns: `cleanupReceipt(() => { this.configListeners.delete(listener); })`.
   * 副作用 / Effects: `this.configListeners.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  onConfigChange(listener: () => Promise<void>) {
    this.configListeners.add(listener);
    return cleanupReceipt(() => { this.configListeners.delete(listener); });
  }
  /**
   * 入口 / Entry: Workspaces.beforeConfigChange.
   * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `cleanupReceipt(() => { this.configGuards.delete(guard); })` 供上层消费（`Workspaces`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; this entry produces `cleanupReceipt(() => { this.configGuards.delete(guard); })` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
   * 处理：通过 `this.configGuards.add`, `cleanupReceipt` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.configGuards.add`, `cleanupReceipt`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: guard: (id: string, previous: Project, next: Project) => Promise<void>
   * 输出 / Returns: `cleanupReceipt(() => { this.configGuards.delete(guard); })`.
   * 副作用 / Effects: `this.configGuards.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  beforeConfigChange(guard: (id: string, previous: Project, next: Project) => Promise<void>) {
    this.configGuards.add(guard);
    return cleanupReceipt(() => { this.configGuards.delete(guard); });
  }
  /**
   * 入口 / Entry: Workspaces.config.
   * 功能：把本层请求转交 `this.readConfig`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.readConfig` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<Project>；结果来自 / values from `this.readConfig(id, readStore)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async config(id: string): Promise<Project> { return this.readConfig(id, readStore); }
  /** Queue-free committed snapshot for admission checks and final commit guards. */
  /**
   * 入口 / Entry: Workspaces.readCommittedConfig.
   * 功能：把本层请求转交 `this.readConfig`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.readConfig` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<Project>；结果来自 / values from `this.readConfig(id, readCommittedStore)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async readCommittedConfig(id: string): Promise<Project> { return this.readConfig(id, readCommittedStore); }
  /**
   * 入口 / Entry: Workspaces.readConfig.
   * 功能：在管理项目配置、准备和运行中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `contextual(projectSchema.parse(await reader(projectMetadataFile(id, this.projects.current(id)), () => ({ template: vm.templat…` 供上层消费（`Workspaces`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Workspaces`; this entry produces `contextual(projectSchema.parse(await reader(projectMetadataFile(id, this.projects.current(id)), () => ({ template: vm.templat…` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
   * 处理：通过 `this.machines.get`, `this.projects.current`, `contextual`, `projectSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.projects.current`, `contextual`, `projectSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; reader: typeof readStore
   * 输出 / Returns: Promise<Project>；结果来自 / values from `contextual(projectSchema.parse(await reader(projectMetadataFile(id, this.projects.current(id)), () => ({ template: vm.templat…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async readConfig(id: string, reader: typeof readStore): Promise<Project> {
    const vm = this.machines.get(id);
    const scope = this.projects.current(id);
    /**
     * 入口 / Entry: Workspaces.readConfig.contextual.
     * 功能：从当前输入或状态计算 `Object.defineProperty(project, '_workspace', { value: scope === 'default' ? undefined : scope, enumerable: false, })`，供调用方后续验证或使用。
     * Purpose: Computes `Object.defineProperty(project, '_workspace', { value: scope === 'default' ? undefined : scope, enumerable: false, })` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: project: Project
     * 输出 / Returns: `Object.defineProperty(project, '_workspace', { value: scope === 'default' ? undefined : scope, enumerable: false, })`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    const contextual = (project: Project) =>
      Object.defineProperty(project, '_workspace', {
        value: scope === 'default' ? undefined : scope,
        enumerable: false,
      });
    return contextual(projectSchema.parse(await reader(projectMetadataFile(id, this.projects.current(id)), () =>
      ({ template: vm.template || 'none' }))));
  }
  /**
   * 入口 / Entry: Workspaces.networkEnvironment.
   * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.context?.network?.environment(id) || Promise.resolve({})` 供上层消费（`Workspaces`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; this entry produces `this.context?.network?.environment(id) || Promise.resolve({})` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
   * 处理：通过 `this.context.network.environment`, `Promise.resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.context.network.environment`, `Promise.resolve`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.context?.network?.environment(id) || Promise.resolve({})`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  networkEnvironment(id: string) {
    return this.context?.network?.environment(id) || Promise.resolve({});
  }
  /**
   * 入口 / Entry: Workspaces.dependencyDownloadAuthentication.
   * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `configuration ? resolveDependencyAuthentication(id, configuration, this.context?.secrets) : undefined` 供上层消费（`Workspaces`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; this entry produces `configuration ? resolveDependencyAuthentication(id, configuration, this.context?.secrets) : undefined` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
   * 处理：通过 `this.context.network.state`, `resolveDependencyAuthentication` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.context.network.state`, `resolveDependencyAuthentication`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; manager: DependencyManager
   * 输出 / Returns: `configuration ? resolveDependencyAuthentication(id, configuration, this.context?.secrets) : undefined`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async dependencyDownloadAuthentication(id: string, manager: DependencyManager) {
    const state = await this.context?.network?.state(id);
    const configuration = state?.appliedAt ? state.config.dependencyDownloads?.[manager] : undefined;
    return configuration
      ? resolveDependencyAuthentication(id, configuration, this.context?.secrets)
      : undefined;
  }
  /**
   * 入口 / Entry: Workspaces.repositoryDownloadAuthentication.
   * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `configuration && repositoryAuthorizationScope(repository, configuration.endpoint) ? resolveDependencyAuthentication(id, confi…` 供上层消费（`Workspaces`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; this entry produces `configuration && repositoryAuthorizationScope(repository, configuration.endpoint) ? resolveDependencyAuthentication(id, confi…` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
   * 处理：通过 `this.context.network.state`, `repositoryAuthorizationScope`, `resolveDependencyAuthentication` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.context.network.state`, `repositoryAuthorizationScope`, `resolveDependencyAuthentication`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; repository: string
   * 输出 / Returns: `configuration && repositoryAuthorizationScope(repository, configuration.endpoint) ? resolveDependencyAuthentication(id, confi…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async repositoryDownloadAuthentication(id: string, repository: string) {
    const state = await this.context?.network?.state(id);
    const configuration = state?.appliedAt ? state.config.dependencyDownloads?.git : undefined;
    // Public repositories outside the saved scope never resolve its secret.
    return configuration && repositoryAuthorizationScope(repository, configuration.endpoint)
      ? resolveDependencyAuthentication(id, configuration, this.context?.secrets)
      : undefined;
  }
  /**
   * 入口 / Entry: Workspaces.resolvedConfig.
   * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.resolveProject(id, await this.config(id))` 供上层消费（`Workspaces`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; this entry produces `this.resolveProject(id, await this.config(id))` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
   * 处理：通过 `this.resolveProject`, `this.config` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.resolveProject`, `this.config`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Promise<Project>；结果来自 / values from `this.resolveProject(id, await this.config(id))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async resolvedConfig(id: string): Promise<Project> {
    return this.resolveProject(id, await this.config(id));
  }
  // Resolve an already captured candidate without loading a second project or
  // carrying runtime overrides from the previous selection into the candidate.
  /**
   * 入口 / Entry: Workspaces.resolveProject.
   * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...project, _workspace: project._workspace, environment, ...(services ? { services } : {}) }` 供上层消费（`Workspaces`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; this entry produces `{ ...project, _workspace: project._workspace, environment, ...(services ? { services } : {}) }` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
   * 处理：通过 `project.services.some`, `this.networkEnvironment`, `this.context.secrets.resolve`, `runtimeEnvironment` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `project.services.some`, `this.networkEnvironment`, `this.context.secrets.resolve`, `runtimeEnvironment`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; project: Project
   * 输出 / Returns: Promise<Project>；结果来自 / values from `{ ...project, _workspace: project._workspace, environment, ...(services ? { services } : {}) }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.context?.secrets && (Object.keys(project.secrets || {}).length || project.services?.some((service) => Object.keys(servi…`; 异常 / errors `new AppError('项目引用了私密配置，请先启用 secrets 插件', 409)`.
   */
  async resolveProject(id: string, project: Project): Promise<Project> {
    if (
      !this.context?.secrets &&
      (Object.keys(project.secrets || {}).length ||
        project.services?.some((service) => Object.keys(service.secrets || {}).length))
    )
      throw new AppError('项目引用了私密配置，请先启用 secrets 插件', 409);
    const environment = {
      ...(await this.networkEnvironment(id)),
      ...project.environment,
      ...(await this.context?.secrets?.resolve(id, project.secrets)),
      ...runtimeEnvironment(project.runtimes, project.environment?.PATH),
    };
    const services = project.services
      ? await Promise.all(
          project.services.map(async (service) => ({
            ...service,
            environment: {
              ...service.environment,
              ...(await this.context?.secrets?.resolve(id, service.secrets)),
            },
          })),
        )
      : undefined;
    return { ...project, _workspace: project._workspace, environment, ...(services ? { services } : {}) };
  }
  /**
   * 入口 / Entry: Workspaces.save.
   * 功能：校验项目配置并协调目录、网络、账户和常驻服务的变更钩子后发布。
   * Purpose: Validates project settings and coordinates directory/network/account/persistent-service hooks before publication.
   * 设计：捕获 expectedVersion，异步准备后再次 CAS 核对；先恢复或停止原资源，未确认目录迁移与账号核销阻止配置覆盖。
   * Design: Expected versions are rechecked after waits; original resources recover/stop first and pending directory/account retirement blocks overwrite.
   * 输入 / Inputs: id: string; input: unknown; allowedDirectory: string optional; expectedVersion: string optional; commitGuard: () => void optional
   * 输出 / Returns: `this.machines.locked(id, async () => { commitGuard?.(); this.machines.get(id); if (this.jobs.view(this.projects.key(id))?.sta…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async save(id: string, input: unknown, allowedDirectory?: string, expectedVersion?: string,
    commitGuard?: () => void) {
    const project = projectSchema.parse(input);
    /**
     * 入口 / Entry: Workspaces.save.callback@253.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `project`.
     * 副作用 / Effects: `this.machines.exec`; `removed.push`; `identities.releaseNetwork`; `replaceMetadata`.
     * 拒绝 / Refusals: 条件 / conditions `this.jobs.view(this.projects.key(id))?.status === 'running'`; `expectedVersion !== undefined && projectVersion(previous) !== expectedVersion`; `allowedDirectory !== undefined && (project.directory !== allowedDirectory || previous.directory !== allowedDirectory)`; 异常 / errors `new AppError('请等待项目操作完成', 409)`; `new AppError('项目配置已变化，请重新审阅并提交变更', 409)`.
     */
    return this.machines.locked(id, async () => {
      commitGuard?.();
      this.machines.get(id);
      if (this.jobs.view(this.projects.key(id))?.status === 'running')
        throw new AppError('请等待项目操作完成', 409);
      const previous = await this.config(id);
      if (expectedVersion !== undefined && projectVersion(previous) !== expectedVersion)
        throw new AppError('项目配置已变化，请重新审阅并提交变更', 409);
      /**
       * 入口 / Entry: Workspaces.save.verifyVersion.
       * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Workspaces`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; the calls and state transitions below complete the operation. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
       * 处理：通过 `projectVersion`, `this.readCommittedConfig` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `projectVersion`, `this.readCommittedConfig`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `expectedVersion !== undefined && projectVersion(await this.readCommittedConfig(id)) !== expectedVersion`; 异常 / errors `new AppError('项目配置已变化，请重新审阅并提交变更', 409)`.
       */
      const verifyVersion = async () => {
        if (expectedVersion !== undefined && projectVersion(await this.readCommittedConfig(id)) !== expectedVersion)
          throw new AppError('项目配置已变化，请重新审阅并提交变更', 409);
      };
      if (allowedDirectory !== undefined &&
          (project.directory !== allowedDirectory || previous.directory !== allowedDirectory))
        throw new AppError('项目成员不能修改项目目录', 403);
      if (previous.directory !== project.directory || previous.networkIsolation !== project.networkIsolation)
        assertProjectPreparationIdle(this.machines, id, previous._workspace || 'default');
      for (const guard of this.configGuards) await guard(id, previous, project);
      /**
       * 入口 / Entry: Workspaces.save.mainBindingInput.
       * 功能：从当前输入或状态计算 `JSON.stringify([value.directory, value.command, value.networkIsolation || 'host', value.environment || {}, value.secrets || {…`，供调用方后续验证或使用。
       * Purpose: Computes `JSON.stringify([value.directory, value.command, value.networkIsolation || 'host', value.environment || {}, value.secrets || {…` from current inputs/state for the caller to validate or consume.
       * 输入 / Inputs: value: Project
       * 输出 / Returns: `JSON.stringify([value.directory, value.command, value.networkIsolation || 'host', value.environment || {}, value.secrets || {…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      const mainBindingInput = (value: Project) => JSON.stringify([value.directory, value.command,
        value.networkIsolation || 'host', value.environment || {}, value.secrets || {}, value.runtimes || {},
        Boolean(value.services?.length)]);
      /**
       * 入口 / Entry: Workspaces.save.identityBindingInput.
       * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `JSON.stringify([mainBindingInput(value), (value.services || []).map(service => [service.name, service.command, service.enviro…` 供上层消费（`Workspaces`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; this entry produces `JSON.stringify([mainBindingInput(value), (value.services || []).map(service => [service.name, service.command, service.enviro…` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
       * 处理：通过 `mainBindingInput`, `inline.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `mainBindingInput`, `inline.map`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: value: Project
       * 输出 / Returns: `JSON.stringify([mainBindingInput(value), (value.services || []).map(service => [service.name, service.command, service.enviro…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const identityBindingInput = (value: Project) => JSON.stringify([mainBindingInput(value),
        (value.services || []).map(service => [service.name, service.command, service.environment || {}, service.secrets || {}])]);
      if (mainBindingInput(previous) !== mainBindingInput(project)) {
        const mainScope = new ProjectMainScope(this.machines, id, previous);
        const hasReceipt = await mainScope.hasReceipt(), machineState = this.machines.state(id);
        if (machineState === 'paused') {
          if (!hasReceipt || (await mainScope.metadata())?.phase !== 'stopped')
            throw new AppError('请先恢复实例并核对或停止项目主命令，再修改运行绑定或切换到服务模式', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
        } else if (machineState === 'running') {
          if (hasReceipt) {
            const runtime = await mainScope.status();
            if (runtime.status !== 'stopped' && runtime.status !== 'absent')
              throw new AppError('请先确认停止项目主命令及其全部后代，再修改运行绑定或切换到服务模式', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
          } else if (await legacyMainStatus(this.machines, id, previous) === 'unmanaged') {
            throw new AppError('旧项目主命令缺少受管归属，请管理员检查并关闭旧会话及其后代后再修改运行绑定', 409, 'PROJECT_MAIN_SCOPE_UNMANAGED');
          }
        }
      }
      // Persistent service receipts retain detached descendants even after the
      // original tmux pane exits. Binding edits must keep that stop reachable.
      /**
       * 入口 / Entry: Workspaces.save.serviceBindingInput.
       * 功能：从当前输入或状态计算 `JSON.stringify([value.directory, value.networkIsolation || 'host', value.environment || {}, value.secrets || {}, value.runtim…`，供调用方后续验证或使用。
       * Purpose: Computes `JSON.stringify([value.directory, value.networkIsolation || 'host', value.environment || {}, value.secrets || {}, value.runtim…` from current inputs/state for the caller to validate or consume.
       * 输入 / Inputs: value: Project; service: ProjectService
       * 输出 / Returns: `JSON.stringify([value.directory, value.networkIsolation || 'host', value.environment || {}, value.secrets || {}, value.runtim…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      const serviceBindingInput = (value: Project, service: ProjectService) =>
        JSON.stringify([value.directory, value.networkIsolation || 'host', value.environment || {},
          value.secrets || {}, value.runtimes || {}, service.command, service.environment || {}, service.secrets || {}]);
      const serviceScopes = new ProjectServiceScopes(this.machines, id, previous);
      for (const service of previous.services || []) {
        const next = project.services?.find(item => item.name === service.name);
        if (next && serviceBindingInput(previous, service) === serviceBindingInput(project, next)) continue;
        const machineState = this.machines.state(id);
        if (!await serviceScopes.hasReceipt(service.name)) {
          if (machineState === 'paused')
            throw new AppError(`服务 ${service.name} 缺少可验证归属；请先恢复实例核对或关闭旧会话及其后代，再修改服务绑定或移除服务`,
              409, 'SERVICE_SCOPE_UNMANAGED');
          if (machineState === 'running') {
            const old = await this.machines.exec(id,
              `if tmux has-session -t =sakura-service-${previous._workspace ? previous._workspace + '-' : ''}${service.name} 2>/dev/null; then echo active; fi`, 10000);
            if (old.code !== 0) throw new AppError('无法检查旧服务会话', 409);
            if (old.stdout.includes('active'))
              throw new AppError('旧服务缺少受管归属，请明确关闭旧会话后重新启动，再修改服务绑定或移除服务', 409, 'SERVICE_SCOPE_UNMANAGED');
          }
          continue;
        }
        if (machineState === 'paused') {
          if ((await serviceScopes.metadata(service.name))?.phase !== 'stopped')
            throw new AppError('请先恢复实例并确认停止受管服务，再修改服务绑定或移除服务', 409);
          continue;
        }
        if (machineState !== 'running') continue;
        const runtime = await serviceScopes.status(service.name);
        if (runtime.status !== 'stopped' && runtime.status !== 'absent')
          throw new AppError('请先确认停止受管服务及其全部后代，再修改服务绑定或移除服务', 409, 'SERVICE_SCOPE_CHANGED');
      }
      if (identityBindingInput(previous) !== identityBindingInput(project))
        await new ProjectRunScopes(this.machines).guard(id, this.projects.current(id));
      if (previous.directory !== project.directory ||
          (previous.networkIsolation || 'host') !== (project.networkIsolation || 'host')) {
        if (this.machines.state(id) === 'paused')
          throw new AppError('请先恢复实例并停止项目终端，再修改目录或网络模式', 409);
        if (this.machines.state(id) === 'running') {
          const sshBusy = await this.machines.exec(id,
            projectSshBusyScript(this.projects.current(id)), 10_000);
          if (sshBusy.code !== 0) throw new AppError('无法检查项目 SSH 绑定', 409);
          if (sshBusy.stdout.includes('SAKURA_PROJECT_SSH_BUSY'))
            throw new AppError('请先停止项目 SSH 及其编辑器进程，再修改目录或网络模式', 409);
          // Keep existing Docker bindings protected even when its plugin is
          // disabled or the host service has been reloaded.
          const paths=privateDockerPaths(this.projects.current(id));
          const dockerPresent=await this.machines.exec(id,
            `if [ -e ${quote(paths.config+'/binding.json')} ] || [ -d ${quote(paths.data)} ] || [ -S ${quote(paths.socket)} ]; then echo SAKURA_PROJECT_DOCKER_PRESENT; fi`,10_000);
          if (dockerPresent.code!==0) throw new AppError('无法检查项目 Docker 绑定',409);
          if (dockerPresent.stdout.includes('SAKURA_PROJECT_DOCKER_PRESENT')) {
            const runtime=await privateDockerStatus(this.machines,id,previous);
            if (runtime.running || runtime.containers)
              throw new AppError('请先移除项目容器并停止私有 Docker 环境，再修改目录或网络模式',409);
          }
          if (project.networkIsolation==='private' && previous.networkIsolation!=='private') {
            const projectId=this.projects.current(id);
            const script=`set -eu\nif ! command -v docker >/dev/null; then exit 0; fi\n`+
              `docker --host unix:///var/run/docker.sock version >/dev/null\n`+
              `docker --host unix:///var/run/docker.sock ps -aq --filter ${quote('label=sakura.vm='+id)} --filter ${quote('label=sakura.project='+projectId)}\n`+
              `docker --host unix:///var/run/docker.sock ps -aq --filter ${quote('label=com.docker.compose.project=sakura-'+id.slice(0,8)+'-'+projectId)}\n`+
              `docker --host unix:///var/run/docker.sock ps -aq --filter ${quote('label=devcontainer.local_folder='+previous.directory)}\n`;
            const sharedDocker=await this.machines.exec(id,
              `env -i HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin /bin/sh -c ${quote(script)}`,15_000);
            if (sharedDocker.code!==0) throw new AppError('无法核对共享 Docker 的旧项目容器，请先恢复 Docker 并移除容器',409);
            if (sharedDocker.stdout.trim()) throw new AppError('请先移除旧项目容器，再修改目录或网络模式',409);
          }
          const prefix = terminalSessionPrefix(this.projects.current(id));
          const check = await this.machines.exec(id, `set -eu\n` +
            `if command -v tmux >/dev/null && tmux list-sessions -F '#{session_name}' >/dev/null 2>&1; then\n` +
            `  sakura_sessions=$(tmux list-sessions -F '#{session_name}')\n` +
            `  for sakura_session in $sakura_sessions; do\n` +
            `    case "$sakura_session" in ${prefix}*) echo active;; esac\n` +
            `  done\nfi`, 10000);
          if (check.code !== 0) throw new AppError(check.stderr || '无法检查项目终端状态', 409);
          if (check.stdout.includes('active'))
            throw new AppError('请先停止此项目的所有终端，再修改目录或网络模式', 409);
        }
      }
      await guardProjectQuotaDirectory(
        id, this.projects.current(id), project.directory,
        (await this.projects.list(id)).projects.map((item) => item.id),
      );
      const removed = (previous.services || [])
        .filter((s) => !project.services?.some((next) => next.name === s.name))
        .map((s) => `sakura-service-${previous._workspace ? previous._workspace + '-' : ''}${s.name}`);
      if (!previous.services?.length && project.services?.length) removed.push(projectSession(previous));
      if (removed.length && this.machines.state(id) === 'running') {
        const check = await this.machines.exec(
          id,
          removed
            .map((name) => `if tmux has-session -t =${name} 2>/dev/null; then echo ${name}; fi`)
            .join('\n'),
          10000,
        );
        if (check.stdout.trim()) throw new AppError('请先停止要移除或替换的运行服务', 409);
      }
      if ((previous.networkIsolation || 'host') !== (project.networkIsolation || 'host') &&
          this.machines.state(id) === 'running') {
        const sessions = [projectSession(previous),
          ...(previous.services || []).map((item) =>
            `sakura-service-${previous._workspace ? previous._workspace + '-' : ''}${item.name}`),
          `sakura-notebook-${this.projects.current(id)}`,
          `sakura-browser-ide-${this.projects.current(id)}`,
          `sakura-mesh-${this.projects.current(id)}`];
        const check = await this.machines.exec(id,
          sessions.map((name) => `tmux has-session -t =${name} 2>/dev/null && echo active || true`)
            .join('\n'), 10000);
        if (check.stdout.includes('active'))
          throw new AppError('请先停止运行中的项目，再切换网络隔离模式', 409);
      }
      if (previous.networkIsolation === 'private' && project.networkIsolation !== 'private' &&
          this.machines.state(id) === 'running') {
        const identities = new ProjectRunScopes(this.machines), projectId = this.projects.current(id);
        const lease = await identities.beginNetworkRelease(id, projectId);
        if (lease) await identities.releaseNetwork(id, projectId, lease);
        else await removeProjectNetwork(this.machines, id, previous);
      }
      const file = projectMetadataFile(id, this.projects.current(id));
      await verifyVersion();
      commitGuard?.();
      await replaceMetadata(file, project, {
        // This final domain guard reads the existing file directly: reentering
        // its metadata queue here would deadlock. Keep approval/project checks
        // immediately before each atomic publication attempt.
        /**
         * 入口 / Entry: Workspaces.save.beforeCommit.
         * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Workspaces`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; the calls and state transitions below complete the operation. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
         * 处理：通过 `verifyVersion`, `commitGuard` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `verifyVersion`, `commitGuard`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        beforeCommit: async () => { await verifyVersion(); commitGuard?.(); },
      });
      await Promise.allSettled([...this.configListeners].map((listener) => listener()));
      return project;
    });
  }
  /**
   * 入口 / Entry: Workspaces.view.
   * 功能：在管理项目配置、准备和运行中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ project, version: projectVersion(project), projectId: this.projects.current(id), job: this.jobs.view(this.projects.key(id))…` 供上层消费（`Workspaces`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Workspaces`; this entry produces `{ project, version: projectVersion(project), projectId: this.projects.current(id), job: this.jobs.view(this.projects.key(id))…` for its caller. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
   * 处理：通过 `this.config`, `projectVersion`, `this.projects.current`, `this.jobs.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.config`, `projectVersion`, `this.projects.current`, `this.jobs.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ project, version: projectVersion(project), projectId: this.projects.current(id), job: this.jobs.view(this.projects.key(id))…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string) {
    const project = await this.config(id);
    return {
      project,
      version: projectVersion(project),
      projectId: this.projects.current(id),
      job: this.jobs.view(this.projects.key(id)),
    };
  }
  /**
   * 入口 / Entry: Workspaces.execute.
   * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Workspaces`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; the calls and state transitions below complete the operation. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
   * 处理：通过 `guestTask`, `quote`, `result.stderr.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `guestTask`, `quote`, `result.stderr.slice`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; script: string; log: (text: string) => void; signal: AbortSignal
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new Error(result.stderr.slice(-2000) || `命令退出码 ${result.code}`)`.
   */
  private async execute(id: string, script: string, log: (text: string) => void, signal: AbortSignal) {
    const result = await guestTask(this.machines, id,
      `/usr/bin/env -i HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C /bin/sh -c ${quote(script)}`,
      signal, log);
    if (result.code !== 0) throw new Error(result.stderr.slice(-2000) || `命令退出码 ${result.code}`);
  }
  /**
   * 入口 / Entry: Workspaces.run.
   * 功能：把本层请求转交 `this.machines.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; action: 'setup' | 'start' | 'stop' | 'terminal'; service: string optional; automatic: default=false
   * 输出 / Returns: `this.machines.locked(id, async () => { const finish = !automatic && (action === 'start' || action === 'stop') ? await this.pr…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async run(
    id: string,
    action: 'setup' | 'start' | 'stop' | 'terminal',
    service?: string,
    automatic = false,
  ) {
    /**
     * 入口 / Entry: Workspaces.run.callback@445.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `job`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 异常 / errors `error`.
     * 失败处理：catch 分支执行 `finish?.(false);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `finish?.(false);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.machines.locked(id, async () => {
      const finish =
        !automatic && (action === 'start' || action === 'stop')
          ? await this.prepareAction(id, action, service)
          : undefined;
      try {
        const job = await this.runInternal(id, action, service);
        if (finish) void this.jobs.wait(this.projects.key(id)).then(() => finish(job.status === 'done'));
        return job;
      } catch (error) {
        finish?.(false);
        throw error;
      }
    });
  }
  /**
   * 入口 / Entry: Workspaces.runInternal.
   * 功能：按 setup/start/stop 等项目动作准备环境、仓库、运行时与服务执行。
   * Purpose: Prepares environment/repositories/runtimes/services for project setup/start/stop actions.
   * 设计：配置和原账户在任务开始捕获，setup 指纹控制重复初始化；停止先结束原服务与终端再核销网络。
   * Design: Configuration/account are captured at admission, setup fingerprints prevent blind replay and stop ends original services/terminals before network retirement.
   * 输入 / Inputs: id: string; action: 'setup' | 'start' | 'stop' | 'terminal'; service: string optional
   * 输出 / Returns: `this.jobs.start( this.projects.key(id), async (rawLog, signal) => { const privateValues = projectPrivateValues(project); cons…`.
   * 副作用 / Effects: `this.jobs.start`.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running'`; `(action === 'setup' || action === 'start') && await readProjectQuotaRecord(id, this.projects.current(id))`; `!quota.ready || !quota.active`; 异常 / errors `new AppError('请先启动发行版', 409)`; `new AppError('项目配额未挂载；拒绝在未受限的目录中启动项目', 409)`.
   */
  /** 运行已准备的项目：保留同一运行归属与停止流程，不安装软件或执行准备钩子。 */
  async runPrepared(id: string, action: 'start' | 'stop') {
    if (action !== 'start' && action !== 'stop') throw new AppError('已准备项目仅支持启动或停止', 400);
    return this.machines.locked(id, async () => {
      const finish = await this.prepareAction(id, action);
      try {
        const job = await this.runInternal(id, action, undefined, true);
        void this.jobs.wait(this.projects.key(id)).then(() => finish(job.status === 'done'));
        return job;
      } catch (error) { finish(false); throw error; }
    });
  }
  private async runInternal(id: string, action: 'setup' | 'start' | 'stop' | 'terminal', service?: string, prepared = false) {
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    if ((action === 'setup' || action === 'start') &&
        await readProjectQuotaRecord(id, this.projects.current(id))) {
      const quota = await projectQuota(this.machines, this, id, {}, 'check');
      if (!quota.ready || !quota.active)
        throw new AppError('项目配额未挂载；拒绝在未受限的目录中启动项目', 409);
    }
    const project =
      action === 'stop' || action === 'terminal' ? await this.config(id) : await this.resolvedConfig(id);
    const distro = this.machines.get(id).distro;
    if (prepared && action === 'start' &&
        (project.template !== 'none' || project.repository || project.setup.trim() || Object.keys(project.runtimes || {}).length))
      throw new AppError('已准备项目必须使用 none 模板，且不声明仓库、准备命令或待安装的运行时', 409, 'PROJECT_NOT_PREPARED');
    if (service && !project.services?.some((s) => s.name === service)) throw new AppError('服务不存在');
    /**
     * 入口 / Entry: Workspaces.runInternal.callback@474.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: rawLog; signal
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `stopProjectMain`; `identities.stopTerminals`; `identities.releaseNetwork`; `this.execute`; `setupFingerprint`.
     * 拒绝 / Refusals: 异常 / errors `new AppError(redactValues((error as Error).message, privateValues), error instanceof AppError ? error.status : 400, error ins…`.
     * 收尾：退出 try 区域时始终执行 `output.flush();`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `output.flush();`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `throw new AppError(redactValues((error as Error).message, privateValues), error instanceof AppError ? error.status : 400, err…`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `throw new AppError(redactValues((error as Error).message, privateValues), error instanceof AppError ? error.status : 400, err…`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.jobs.start(
      this.projects.key(id),
      async (rawLog, signal) => {
        const privateValues = projectPrivateValues(project);
        const output = privateLog(rawLog, privateValues),
          log = output.write;
        try {
          if (action === 'stop') {
            const identities = new ProjectRunScopes(this.machines), projectId = this.projects.current(id);
            // Capture and freeze this network generation before asynchronous
            // scope cleanup. A late retry must never acquire a later network.
            const lease = !service && project.networkIsolation === 'private'
              ? await identities.beginNetworkRelease(id, projectId, signal) : null;
            if (project.services?.length) {
              await runServices(this.machines, id, project, 'stop', log, signal, service);
              if (service) return;
            }
            await stopProjectMain(this.machines, id, project, log, signal);
            await identities.stopTerminals(id, projectId);
            if (lease) await identities.releaseNetwork(id, projectId, lease, signal);
            else await removeProjectNetwork(this.machines, id, project, signal);
            return;
          }
          if (action === 'terminal') {
            await this.execute(id, provisionScript('none', distro), log, signal);
            return;
          }
          // Main scope prerequisites can install before prepareProject runs.
          // Reject old retirement intent before admitting any such mutation.
          await new ProjectRunScopes(this.machines).assertAdmission(id, this.projects.current(id));
          const install =
            prepared
              ? 'for tool in python3 tmux cc ip openssl useradd groupadd nft; do command -v "$tool" >/dev/null || { echo "已准备项目缺少工具: $tool" >&2; exit 1; }; done'
              : action === 'setup'
              ? provisionScript(project.template, distro)
              : `if [ ! -f /etc/sakura/template-${project.template} ] || ! command -v tmux >/dev/null; then\n${provisionScript(project.template, distro)}\nfi\n`;
          const network = ensureProjectNetworkScript(project, distro || 'alpine', !prepared);
          // Previous markers certify a root setup, not setup by this account.
          const marker = `/etc/sakura/project-setup-uid1-${setupFingerprint(project)}`;
          log(action === 'setup' ? '正在安装环境并准备项目…\n' : '正在启动项目…\n');
          /**
           * 入口 / Entry: Workspaces.runInternal.prepareProject.
           * 功能：在管理项目配置、准备和运行中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Workspaces`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `Workspaces`; the calls and state transitions below complete the operation. Module context: Owns project configuration/preparation/execution, coordinating networks, credentials, logs and identity-change hooks.
           * 处理：通过 `ProjectRunScopes.assertAdmission`, `this.projects.current`, `this.execute`, `ProjectRunScopes.identity` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `ProjectRunScopes.assertAdmission`, `this.projects.current`, `this.execute`, `ProjectRunScopes.identity`; the branches below determine continuation, return or refusal.
           * 分支 / Branches: `setupNeeded && action !== 'setup'`; `project.repository`; `setupNeeded`.
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: `this.execute`; `project.setup.trim`; `this.machines.exec`; 更新 / updates `setupNeeded`, `prepare`.
           * 拒绝 / Refusals: 条件 / conditions `setupNeeded`; `result.code !== 0`; 异常 / errors `new AppError(result.stderr.slice(-2000) || `项目账号准备命令退出码 ${result.code}`, 409, 'PROJECT_SETUP_FAILED')`.
           */
          const prepareProject = async () => {
            await new ProjectRunScopes(this.machines).assertAdmission(id, this.projects.current(id));
            // Trusted installation/network control has no project environment,
            // repository, directory hooks or project command in its argv.
            await this.execute(id, `set -eu\n${install}\n${network}`, log, signal);
            await new ProjectRunScopes(this.machines).identity(id, project, signal);
            let setupNeeded = Boolean(project.setup.trim());
            if (setupNeeded && action !== 'setup') {
              const done = await this.machines.exec(id, `test -f ${marker}`, 10000, signal);
              setupNeeded = done.code !== 0;
            }
            if (project.repository) {
              await prepareProjectRepository(this.machines, id, project, async () => ({
                authentication: await this.repositoryDownloadAuthentication(id, project.repository),
                environment: await this.networkEnvironment(id),
              }), signal, log);
            }
            let prepare = 'set -eu\n';
            if (setupNeeded) prepare += project.setup + '\n';
            if (setupNeeded) {
              const result = await projectIdentityTask(this.machines, id, project,
                { command: prepare, environment: project.environment }, signal, log);
              if (result.code !== 0) {
                throw new AppError(result.stderr.slice(-2000) || `项目账号准备命令退出码 ${result.code}`, 409,
                  'PROJECT_SETUP_FAILED');
              }
            }
            // Only the clean controller publishes /etc markers, after task
            // descendants and the account ticket have both been retired.
            if (setupNeeded) await this.execute(id, `set -eu\ntouch ${marker}`, log, signal);
          };
          if (action === 'start' && !project.services?.length)
            await runProjectMain(this.machines, id, project, log, signal, prepareProject, !prepared);
          else await prepareProject();
          if (action === 'start' && project.services?.length)
            await runServices(this.machines, id, project, 'start', log, signal, service, !prepared);
          log('操作完成。\n');
        } catch (error) {
          throw new AppError(redactValues((error as Error).message, privateValues),
            error instanceof AppError ? error.status : 400, error instanceof AppError ? error.code : undefined);
        } finally {
          output.flush();
        }
      },
      {
        title: `项目${{ setup: '初始化', start: '启动', stop: '停止', terminal: '终端安装' }[action]}${service ? ` · ${service}` : ''}`,
        vmId: id,
        projectId: this.projects.current(id),
        action: service ? `${action}:${service}` : action,
      },
    );
  }
  /**
   * 入口 / Entry: Workspaces.runtime.
   * 功能：读取项目主命令和服务的原生运行状态、日志与完整账户票据。
   * Purpose: Reads original native main-command/service state, logs and complete account tickets.
   * 设计：观察不重新签发执行票据，旧会话或缺少完整证明返回不可核对状态；公开日志经过边界与脱敏检查。
   * Design: Observation does not issue execution tickets, incomplete legacy proof remains unverified and logs follow boundary/redaction checks.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: Promise<ProjectRuntime>；结果来自 / values from `{ status: services.some((s) => ['unconfirmed', 'prepared', 'migration-required'].includes(s.status)) ? 'unconfirmed' : servic…`; `{ status, log: redactValues([reason, output.stdout].filter(Boolean).join('\n'), privateValues), main: { status: mainStatus } …`.
   * 副作用 / Effects: `this.machines.exec().catch`; `this.machines.exec`; `services.push`; 更新 / updates `status`, `reason`, `hasMainReceipt`, `runtime`.
   * 拒绝 / Refusals: 条件 / conditions `project.services?.length`; `await scopes.hasReceipt(service.name)`; `runtime.record && ['running', 'exited', 'stopped'].includes(runtime.status)`; 异常 / errors `new AppError('服务 scope 与项目账号票据状态不符；请完成所属运行清理', 409, 'SERVICE_SCOPE_CHANGED')`; `new AppError('主命令 scope 与项目账号票据状态不符；请完成所属运行清理', 409, 'PROJECT_MAIN_SCOPE_CHANGED')`.
   * 失败处理：catch 分支执行 `signal?.throwIfAborted();`; `status = 'unconfirmed';`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `signal?.throwIfAborted();`; `status = 'unconfirmed';`; these statements determine whether a failure is absorbed or rejected again.
   */
  async runtime(id: string, signal?: AbortSignal): Promise<ProjectRuntime> {
    const project = await this.resolvedConfig(id);
    const privateValues = projectPrivateValues(project);
    if (project.services?.length) {
      const services = [];
      const scopes = new ProjectServiceScopes(this.machines, id, project);
      for (const service of project.services) {
        if (await scopes.hasReceipt(service.name)) {
          let status: string, reason = '';
          try {
            const runtime = await scopes.status(service.name, signal);
            status = runtime.status === 'absent' ? 'stopped' : runtime.status;
            if (runtime.record && ['running', 'exited', 'stopped'].includes(runtime.status)) {
              const identities = new ProjectRunScopes(this.machines);
              if (await identities.hasRun(id, runtime.record.projectId, runtime.record.runId)) {
                const active = await identities.readonlyActive(id, runtime.record.projectId, runtime.record.runId, signal);
                if (active !== (runtime.status !== 'stopped'))
                  throw new AppError('服务 scope 与项目账号票据状态不符；请完成所属运行清理', 409, 'SERVICE_SCOPE_CHANGED');
              } else if (runtime.status === 'running') {
                status = 'unconfirmed';
                reason = '此旧服务尚未接入项目账号；请先确认停止全部后代后重新启动。';
              }
            }
            if (status === 'exited') reason = '主 pane 已退出，仍保留服务归属；请停止并清理全部后代。';
            else if (status === 'prepared' || status === 'unconfirmed') reason = '服务启动或停止尚未确认；请先确认停止再重建。';
          } catch (error) {
            signal?.throwIfAborted();
            status = 'unconfirmed';
            reason = error instanceof Error ? error.message : String(error);
          }
          const output = await this.machines.exec(id,
            runtimeLogCommand(serviceLog(service.name, project), 8192),
            10000, signal).catch((error) => {
              signal?.throwIfAborted();
              return { code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
            });
          if (output.code !== 0) { status = 'unconfirmed'; reason += '\n服务日志读取未确认：' + output.stderr; }
          services.push({ name: service.name, status, log: redactValues([reason, output.stdout].filter(Boolean).join('\n'), privateValues) });
          continue;
        }
        const result = await this.machines.exec(
          id,
          `if tmux has-session -t =sakura-service-${project._workspace ? project._workspace + '-' : ''}${service.name} 2>/dev/null; then echo running; else echo stopped; fi`,
          10000,
          signal,
        );
        const status = result.stdout.split('\n')[0].trim();
        services.push({ name: service.name,
          status: result.code !== 0 || !['running', 'stopped'].includes(status) ? 'unconfirmed'
            : status === 'running' ? 'migration-required' : status,
          log: redactValues(result.code !== 0 || !['running', 'stopped'].includes(status)
            ? '旧服务状态读取未确认：' + result.stderr
            : status === 'running' ? '此旧服务尚未迁移到受管归属；请明确关闭旧会话后重新启动。旧日志归属无法核对，未读取。' : '', privateValues) });
      }
      return {
        status: services.some((s) => ['unconfirmed', 'prepared', 'migration-required'].includes(s.status))
          ? 'unconfirmed'
          : services.every((s) => s.status === 'running')
          ? 'running'
          : services.some((s) => s.status === 'running')
            ? 'partial'
            : services.some(s => s.status === 'exited') ? 'exited' : 'stopped',
        log: '',
        services,
      };
    }
    const mainScope = new ProjectMainScope(this.machines, id, project);
    let status: string, mainStatus: string, reason = '';
    let hasMainReceipt = false;
    try {
      hasMainReceipt = await mainScope.hasReceipt();
      const owned = hasMainReceipt ? await mainScope.status(signal) : null;
      let runtime = owned?.status || await legacyMainStatus(this.machines, id, project, signal);
      if (owned?.record && ['running', 'exited', 'stopped'].includes(runtime)) {
        const identities = new ProjectRunScopes(this.machines);
        if (await identities.hasRun(id, owned.record.projectId, owned.record.runId)) {
          const active = await identities.readonlyActive(id, owned.record.projectId, owned.record.runId, signal);
          if (active !== (runtime !== 'stopped'))
            throw new AppError('主命令 scope 与项目账号票据状态不符；请完成所属运行清理', 409, 'PROJECT_MAIN_SCOPE_CHANGED');
        } else if (runtime === 'running') {
          runtime = 'unconfirmed';
          reason = '此旧项目主命令尚未接入项目账号；请先确认停止全部后代后重新启动。';
        }
      }
      mainStatus = runtime;
      status = runtime === 'absent' ? 'stopped' : ['prepared', 'unmanaged'].includes(runtime) ? 'unconfirmed' : runtime;
      if (runtime === 'exited') reason = '项目主命令主 pane 已退出，仍保留运行归属；请停止并清理全部后代。';
      else if (runtime === 'unmanaged') reason = '旧项目主命令缺少可验证归属；请管理员检查并关闭旧会话及其后代后重新启动，未自动停止任何进程。' +
        (!hasMainReceipt ? '旧日志归属无法核对，未读取。' : '');
      else if ((runtime === 'prepared' || runtime === 'unconfirmed') && !reason) reason = '项目主命令启动或停止尚未确认；请先确认停止再重建。';
    } catch (error) {
      signal?.throwIfAborted();
      status = 'unconfirmed'; mainStatus = (error as AppError).code === 'PROJECT_MAIN_SCOPE_UNMANAGED' ? 'unmanaged' : 'unconfirmed';
      reason = error instanceof Error ? error.message : String(error);
    }
    const output = hasMainReceipt ? await this.machines.exec(id,
      runtimeLogCommand(projectLog(project), 16384), 10000, signal)
      .catch((error) => {
        signal?.throwIfAborted();
        return { code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
      }) : { code: 0, stdout: '', stderr: '' };
    if (output.code !== 0) { status = 'unconfirmed'; reason += '\n主命令日志读取未确认：' + output.stderr; }
    return { status, log: redactValues([reason, output.stdout].filter(Boolean).join('\n'), privateValues), main: { status: mainStatus } };
  }
  /**
   * 入口 / Entry: Workspaces.metrics.
   * 功能：把本层请求转交 `this.sampler.sample`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.sampler.sample` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.sampler.sample(id)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  metrics(id: string) {
    return this.sampler.sample(id);
  }
}
