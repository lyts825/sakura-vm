/**
 * 模块职责：按实例与项目生成终端会话和存储标识，隔离不同工作项目的终端状态。
 */
/** Stable identifiers shared by terminal creation, recovery, sharing and removal. */
export function terminalSessionName(projectId: string, session: string) {
  if (!/^(default|[a-f0-9]{16})$/.test(projectId) || !/^[a-z0-9-]{1,48}$/.test(session))
    throw new Error('终端项目或会话 ID 无效');
  return `${terminalSessionPrefix(projectId)}${session}`;
}

export function terminalSessionPrefix(projectId: string) {
  if (!/^(default|[a-f0-9]{16})$/.test(projectId)) throw new Error('终端项目 ID 无效');
  return `sakura-terminal-${projectId}-`;
}

export function terminalStoreKey(vmId: string, projectId?: string) {
  return projectId ? `${vmId}:${projectId}` : vmId;
}
