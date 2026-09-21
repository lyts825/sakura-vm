export type FileEdit = { path: string; content: string; fresh?: boolean };

// A save persists the submitted draft. Text entered while that request is in
// flight must stay in the editor, including a newly created file's next draft.
export function completeFileSave(current: FileEdit | null, submitted: FileEdit): FileEdit | null {
  if (!current || current === submitted) return null;
  return current.path === submitted.path ? { ...current, fresh: false } : current;
}
