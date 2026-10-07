/**
 * 模块职责：生成项目网络命名空间命令及准备检查，限制命名并区分宿主与私有网络执行。
 * Module purpose: Builds namespace preparation/check/execution commands with restricted naming and host/private network separation.
 */
import type { VmAccess as Machines } from './vm-access.ts';
import type { Project } from './project-config.ts';
import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';

/** Names are derived only from validated project IDs, never from user labels. */
/**
 * 入口 / Entry: projectNetworkNamespace.
 * 功能：在生成项目网络命名空间命令及准备检查中，执行此领域的具体处理步骤并返回其结果；本入口产生 `null` / ``sk-${projectId}`` 供上层消费（`project-network-isolation.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-network-isolation.ts`; this entry produces `null` / ``sk-${projectId}`` for its caller. Module context: Builds namespace preparation/check/execution commands with restricted naming and host/private network separation.
 * 处理：通过 `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `project.networkIsolation !== 'private'`.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: `null`; ``sk-${projectId}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!/^(default|[a-f0-9]{16})$/.test(projectId)`; 异常 / errors `new AppError('项目 ID 无效，无法创建网络命名空间')`.
 */
export function projectNetworkNamespace(project: Project) {
  if (project.networkIsolation !== 'private') return null;
  const projectId = project._workspace || 'default';
  if (!/^(default|[a-f0-9]{16})$/.test(projectId))
    throw new AppError('项目 ID 无效，无法创建网络命名空间');
  return `sk-${projectId}`;
}

/**
 * 入口 / Entry: projectNetworkCommand.
 * 功能：在生成项目网络命名空间命令及准备检查中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``sh -lc ${quote(script)}`` / ``sh -ec ${quote(`${projectNetworkCheckScript(namespace)}\nip netns exec ${namespace} sh -lc ${quote(script)}`)}`` 供上层消费（`project-network-isolation.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-network-isolation.ts`; this entry produces ``sh -lc ${quote(script)}`` / ``sh -ec ${quote(`${projectNetworkCheckScript(namespace)}\nip netns exec ${namespace} sh -lc ${quote(script)}`)}`` for its caller. Module context: Builds namespace preparation/check/execution commands with restricted naming and host/private network separation.
 * 处理：通过 `projectNetworkNamespace`, `quote`, `projectNetworkCheckScript` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `projectNetworkNamespace`, `quote`, `projectNetworkCheckScript`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!namespace`.
 * 输入 / Inputs: project: Project; script: string
 * 输出 / Returns: ``sh -lc ${quote(script)}``; ``sh -ec ${quote(`${projectNetworkCheckScript(namespace)}\nip netns exec ${namespace} sh -lc ${quote(script)}`)}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectNetworkCommand(project: Project, script: string) {
  const namespace = projectNetworkNamespace(project);
  if (!namespace) return `sh -lc ${quote(script)}`;
  return `sh -ec ${quote(`${projectNetworkCheckScript(namespace)}\nip netns exec ${namespace} sh -lc ${quote(script)}`)}`;
}

/**
 * 入口 / Entry: projectNetworkCheckScript.
 * 功能：从当前输入或状态计算 ``if ! ip netns exec ${namespace} true >/dev/null 2>&1; then ` + `echo '请先启动私有网络项目' >&2; exit 1; fi\n` + `sakura_links=$(ip -n…`，供调用方后续验证或使用。
 * Purpose: Computes ``if ! ip netns exec ${namespace} true >/dev/null 2>&1; then ` + `echo '请先启动私有网络项目' >&2; exit 1; fi\n` + `sakura_links=$(ip -n…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: namespace: string
 * 输出 / Returns: ``if ! ip netns exec ${namespace} true >/dev/null 2>&1; then ` + `echo '请先启动私有网络项目' >&2; exit 1; fi\n` + `sakura_links=$(ip -n…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function projectNetworkCheckScript(namespace: string) {
  return `if ! ip netns exec ${namespace} true >/dev/null 2>&1; then ` +
      `echo '请先启动私有网络项目' >&2; exit 1; fi\n` +
    `sakura_links=$(ip -n ${namespace} -o link show) || exit 1\n` +
    `if [ "$(printf '%s\\n' "$sakura_links" | wc -l)" -ne 1 ]; then ` +
      `echo '项目命名空间已有额外网络接口，拒绝执行' >&2; exit 1; fi\n` +
    `sakura_ipv4=$(ip -n ${namespace} -o -4 route show) || exit 1\n` +
    `sakura_ipv6=$(ip -n ${namespace} -o -6 route show) || exit 1\n` +
    `if [ -n "$sakura_ipv4" ] || [ -n "$sakura_ipv6" ]; then ` +
      `echo '项目命名空间已有网络路由，拒绝执行' >&2; exit 1; fi`;
}

/** Interactive shell for a saved private project, with the same route checks as managed commands. */
/**
 * 入口 / Entry: projectPrivateShellCommand.
 * 功能：在生成项目网络命名空间命令及准备检查中，执行此领域的具体处理步骤并返回其结果；本入口产生 ``set -eu\n` + `${projectNetworkCheckScript(namespace)}\n` + `cd ${quote(project.directory)}\n` + `exec ip netns exec ${namesp…` 供上层消费（`project-network-isolation.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-network-isolation.ts`; this entry produces ``set -eu\n` + `${projectNetworkCheckScript(namespace)}\n` + `cd ${quote(project.directory)}\n` + `exec ip netns exec ${namesp…` for its caller. Module context: Builds namespace preparation/check/execution commands with restricted naming and host/private network separation.
 * 处理：通过 `projectNetworkNamespace`, `projectNetworkCheckScript`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `projectNetworkNamespace`, `projectNetworkCheckScript`, `quote`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project
 * 输出 / Returns: ``set -eu\n` + `${projectNetworkCheckScript(namespace)}\n` + `cd ${quote(project.directory)}\n` + `exec ip netns exec ${namesp…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!namespace`; 异常 / errors `new AppError('当前项目未启用私有网络', 409)`.
 */
export function projectPrivateShellCommand(project: Project) {
  const namespace = projectNetworkNamespace(project);
  if (!namespace) throw new AppError('当前项目未启用私有网络', 409);
  return `set -eu\n` +
    `${projectNetworkCheckScript(namespace)}\n` +
    `cd ${quote(project.directory)}\n` +
    `exec ip netns exec ${namespace} sh -l`;
}

/**
 * 入口 / Entry: ensureProjectNetworkScript.
 * 功能：在生成项目网络命名空间命令及准备检查中，执行此领域的具体处理步骤并返回其结果；本入口产生 `''` / ``if ! ip netns list >/dev/null 2>&1; then ${install}; fi\n` + `ip netns list >/dev/null\n` + `if ! ip netns exec ${namespace}…` 供上层消费（`project-network-isolation.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-network-isolation.ts`; this entry produces `''` / ``if ! ip netns list >/dev/null 2>&1; then ${install}; fi\n` + `ip netns list >/dev/null\n` + `if ! ip netns exec ${namespace}…` for its caller. Module context: Builds namespace preparation/check/execution commands with restricted naming and host/private network separation.
 * 处理：通过 `projectNetworkNamespace` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `projectNetworkNamespace`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!namespace`.
 * 输入 / Inputs: project: Project; distro: string
 * 输出 / Returns: `''`; ``if ! ip netns list >/dev/null 2>&1; then ${install}; fi\n` + `ip netns list >/dev/null\n` + `if ! ip netns exec ${namespace}…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function ensureProjectNetworkScript(project: Project, distro: string) {
  const namespace = projectNetworkNamespace(project);
  if (!namespace) return '';
  const install = distro === 'alpine'
    ? 'apk add --no-cache --timeout 30 iproute2'
    : 'export DEBIAN_FRONTEND=noninteractive; apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update && apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y iproute2';
  return `if ! ip netns list >/dev/null 2>&1; then ${install}; fi\n` +
    `ip netns list >/dev/null\n` +
    `if ! ip netns exec ${namespace} true >/dev/null 2>&1; then ip netns add ${namespace}; fi\n` +
    `ip -n ${namespace} link set lo up\n` +
    `test "$(ip -n ${namespace} -o link show | wc -l)" -eq 1\n` +
    `ip -n ${namespace} -4 route show >/dev/null\n` +
    `ip -n ${namespace} -6 route show >/dev/null\n` +
    `test "$(ip -n ${namespace} -o -4 route show | wc -l)" -eq 0\n` +
    `test "$(ip -n ${namespace} -o -6 route show | wc -l)" -eq 0\n`;
}

/**
 * 入口 / Entry: removeProjectNetwork.
 * 功能：在生成项目网络命名空间命令及准备检查中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`project-network-isolation.ts`）。
 * Purpose: Ends, revokes or cleans resources owned by this domain action in `project-network-isolation.ts`; this entry produces `void` for its caller. Module context: Builds namespace preparation/check/execution commands with restricted naming and host/private network separation.
 * 处理：通过 `projectNetworkNamespace`, `machines.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `projectNetworkNamespace`, `machines.exec`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!namespace`.
 * 输入 / Inputs: machines: Machines; id: string; project: Project; signal: AbortSignal optional
 * 输出 / Returns: `void`.
 * 副作用 / Effects: `machines.exec`.
 * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError(result.stderr || '无法清理项目网络命名空间', 409)`.
 */
export async function removeProjectNetwork(machines: Machines, id: string,
  project: Project, signal?: AbortSignal) {
  const namespace = projectNetworkNamespace(project);
  if (!namespace) return;
  const result = await machines.exec(id,
    `if ip netns exec ${namespace} true >/dev/null 2>&1; then ` +
      `if [ -n "$(ip netns pids ${namespace})" ]; then ` +
      `echo '项目网络命名空间仍有进程' >&2; exit 1; fi; ` +
      `ip netns del ${namespace}; fi`, 10000, signal);
  if (result.code !== 0) throw new AppError(result.stderr || '无法清理项目网络命名空间', 409);
}
