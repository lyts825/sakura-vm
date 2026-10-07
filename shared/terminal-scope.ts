/**
 * 模块职责（中文）：按实例与项目生成终端会话和存储标识，隔离不同工作项目的终端状态。
 * Module responsibility (English): Producing VM/project-scoped terminal and storage identities.
 * 详细范围（中文）：公开入口包括 terminalSessionName, terminalSessionPrefix, terminalStoreKey；职责覆盖生成按实例/项目隔离的终端和存储身份，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include terminalSessionName, terminalSessionPrefix, terminalStoreKey. The scope covers Producing VM/project-scoped terminal and storage identities. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
/** Stable identifiers shared by terminal creation, recovery, sharing and removal. */
/**
 * 中文：把项目身份和标签 ID 编成稳定终端会话名，使重连复用同一项目会话而不跨项目串线。
 * English: Encode project identity/tab ID as a stable terminal session name so reconnects reuse a project session without crossing project boundaries.
 * 中文：输入：projectId：当前项目标识；session：目标终端或桌面会话
 * English: Inputs: projectId: current project identifier; session: target terminal/desktop session
 * 中文：拒绝原因：终端项目或会话 ID 无效。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 终端项目或会话 ID 无效. These errors reach the direct caller or this function's catch handler
 */
export function terminalSessionName(projectId: string, session: string) {
  if (!/^(default|[a-f0-9]{16})$/.test(projectId) || !/^[a-z0-9-]{1,48}$/.test(session))
    throw new Error('终端项目或会话 ID 无效');
  return `${terminalSessionPrefix(projectId)}${session}`;
}

/**
 * 中文：计算项目终端会话前缀，用于列举或停止该项目会话，避免包含其他项目。
 * English: Compute a project terminal prefix for listing/stopping its sessions without including other projects.
 * 中文：输入：projectId：当前项目标识
 * English: Inputs: projectId: current project identifier
 * 中文：拒绝原因：终端项目 ID 无效。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 终端项目 ID 无效. These errors reach the direct caller or this function's catch handler
 */
export function terminalSessionPrefix(projectId: string) {
  if (!/^(default|[a-f0-9]{16})$/.test(projectId)) throw new Error('终端项目 ID 无效');
  return `sakura-terminal-${projectId}-`;
}

/**
 * 中文：构造按实例/项目隔离的浏览器终端状态键，支持多个工作区共享同一存储入口。
 * English: Build a VM/project-isolated browser terminal-state key so multiple workspaces can share storage safely.
 * 中文：输入：vmId：当前实例标识；projectId：当前项目标识
 * English: Inputs: vmId: current VM identifier; projectId: current project identifier
 */
export function terminalStoreKey(vmId: string, projectId?: string) {
  return projectId ? `${vmId}:${projectId}` : vmId;
}
