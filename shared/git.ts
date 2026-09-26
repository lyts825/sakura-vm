export type GitChange = { path: string; previous?: string; index: string; worktree: string };

export function isGitConflict(change: GitChange) {
  return ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(change.index + change.worktree);
}

export type GitUpstream = { name: string; remote: string; branch: string };
