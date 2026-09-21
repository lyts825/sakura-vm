export type FileEdit = {
  path: string;
  content: string;
  fresh?: boolean;
  baseContent?: string;
  version?: string;
};
export const dirtyEdit = (edit: FileEdit | null) =>
  !!edit && (edit.fresh ? !!edit.content : edit.content !== (edit.baseContent ?? edit.content));
let leaveGuard: (() => Promise<boolean>) | undefined;
export function registerEditorGuard(guard: () => Promise<boolean>) {
  leaveGuard = guard;
  return () => {
    if (leaveGuard === guard) leaveGuard = undefined;
  };
}
export async function mayLeaveEditor() {
  return leaveGuard ? leaveGuard() : true;
}

// A save persists the submitted draft. Text entered while that request is in
// flight must stay in the editor, including a newly created file's next draft.
export function completeFileSave(current: FileEdit | null, submitted: FileEdit): FileEdit | null {
  if (!current || current === submitted) return null;
  return current.path === submitted.path
    ? {
        ...current,
        fresh: false,
        ...(submitted.baseContent !== undefined ? { baseContent: submitted.content } : {}),
      }
    : current;
}
