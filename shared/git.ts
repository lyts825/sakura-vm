/**
 * 模块职责（中文）：Git 变更和上游状态的公共视图，统一判断索引/工作树中的合并冲突。
 * Module responsibility (English): Representing Git changes/upstream state and recognizing conflicts.
 * 详细范围（中文）：公开入口包括 GitChange, isGitConflict, GitUpstream；职责覆盖表示 Git 变更及上游状态并识别冲突，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include GitChange, isGitConflict, GitUpstream. The scope covers Representing Git changes/upstream state and recognizing conflicts. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export type GitChange = { path: string; previous?: string; index: string; worktree: string };

/**
 * 中文：判断稳定 API 错误码是否表达 Git 乐观并发冲突，供界面进入重新核对流程。
 * English: Determine whether a stable API error code represents a Git optimistic-concurrency conflict so the UI can reconcile again.
 * 中文：输入：change：签名所示 GitChange 业务值
 * English: Inputs: change: the GitChange domain value in the signature
 */
export function isGitConflict(change: GitChange) {
  return ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(change.index + change.worktree);
}

export type GitUpstream = { name: string; remote: string; branch: string };
