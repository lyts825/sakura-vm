/**
 * 模块职责：Git 变更和上游状态的公共视图，统一判断索引/工作树中的合并冲突。
 */
export type GitChange = { path: string; previous?: string; index: string; worktree: string };

export function isGitConflict(change: GitChange) {
  return ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(change.index + change.worktree);
}

export type GitUpstream = { name: string; remote: string; branch: string };
