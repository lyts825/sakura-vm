/**
 * 模块职责：协调文件编辑器的离开保护和保存确认，避免保存返回覆盖请求期间新增的编辑。
 */
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
// 卸载只能移除自己注册的保护函数；较晚卸载的旧编辑器不能清掉已经接管的新保护。
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
