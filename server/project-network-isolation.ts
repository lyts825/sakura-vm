import type { Machines } from './machines.ts';
import type { Project } from './workspaces.ts';
import { AppError } from './model.ts';
import { quote } from './files.ts';

/** Names are derived only from validated project IDs, never from user labels. */
export function projectNetworkNamespace(project: Project) {
  if (project.networkIsolation !== 'private') return null;
  const projectId = project._workspace || 'default';
  if (!/^(default|[a-f0-9]{16})$/.test(projectId))
    throw new AppError('项目 ID 无效，无法创建网络命名空间');
  return `sk-${projectId}`;
}

export function projectNetworkCommand(project: Project, script: string) {
  const namespace = projectNetworkNamespace(project);
  return `${namespace ? `ip netns exec ${namespace} ` : ''}sh -lc ${quote(script)}`;
}

/** Interactive shell for a saved private project, with the same route checks as managed commands. */
export function projectPrivateShellCommand(project: Project) {
  const namespace = projectNetworkNamespace(project);
  if (!namespace) throw new AppError('当前项目未启用私有网络', 409);
  return `set -eu\n` +
    `if ! ip netns exec ${namespace} true >/dev/null 2>&1; then ` +
      `echo '请先启动私有网络项目' >&2; exit 1; fi\n` +
    `test "$(ip -n ${namespace} -o link show | wc -l)" -eq 1\n` +
    `test "$(ip -n ${namespace} -o -4 route show | wc -l)" -eq 0\n` +
    `test "$(ip -n ${namespace} -o -6 route show | wc -l)" -eq 0\n` +
    `cd ${quote(project.directory)}\n` +
    `exec ip netns exec ${namespace} sh -l`;
}

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
