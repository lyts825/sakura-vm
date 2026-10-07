/**
 * 模块职责（中文）：协调文件编辑器的离开保护和保存确认，避免保存返回覆盖请求期间新增的编辑。
 * Module responsibility (English): Coordinating leave guards and save baselines without losing subsequent edits.
 * 详细范围（中文）：公开入口包括 FileEdit, dirtyEdit, registerEditorGuard, mayLeaveEditor, completeFileSave；职责覆盖协调离开保护与保存基线，避免丢失继续输入的文本，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include FileEdit, dirtyEdit, registerEditorGuard, mayLeaveEditor, completeFileSave. The scope covers Coordinating leave guards and save baselines without losing subsequent edits. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export type FileEdit = {
  path: string;
  content: string;
  fresh?: boolean;
  baseContent?: string;
  version?: string;
};
/**
 * 中文：比较当前文件文本与保存基线，空编辑状态返回 false；用于离开保护而非根据网络忙碌判断脏状态。
 * English: Compare current file text with its saved baseline; an absent edit returns false. Drive leave protection from content rather than network busy state.
 * 中文：输入：edit：当前文件编辑项
 * English: Inputs: edit: current file edit
 */
export const dirtyEdit = (edit: FileEdit | null) =>
  !!edit && (edit.fresh ? !!edit.content : edit.content !== (edit.baseContent ?? edit.content));
let leaveGuard: (/** 中文：异步询问是否允许离开，false 保留编辑器和草稿；这是 公共类型 的调用契约 | English: Asynchronously decide departure, using false to retain the editor/drafts; this is the callable contract of the public type | 中文：结果：Promise<boolean>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<boolean>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<boolean>) | undefined;
// 卸载只能移除自己注册的保护函数；较晚卸载的旧编辑器不能清掉已经接管的新保护。
/**
 * 中文：登记当前编辑器离开确认函数并返回清理函数；清理仅移除自己的登记，旧编辑器卸载不能删除新编辑器已接管的保护。
 * English: Register the current editor's leave-confirmation function and return cleanup. Remove only that registration so a late old unmount cannot erase a newer editor's guard.
 * 中文：输入：guard：签名所示 () => Promise<boolean> 业务值
 * English: Inputs: guard: the () => Promise<boolean> domain value in the signature
 * 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用
 * English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary
 */
export function registerEditorGuard(guard: /** 中文：异步判断是否允许离开编辑器，false 阻止导航以保留草稿；这是 registerEditorGuard 的调用契约 | English: Asynchronously decide editor departure, using false to block navigation and retain drafts; this is the callable contract of registerEditorGuard | 中文：结果：Promise<boolean>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<boolean>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<boolean>) {
  leaveGuard = guard;
  return () => {
    if (leaveGuard === guard) leaveGuard = undefined;
  };
}
/**
 * 中文：询问已登记编辑器保护回调，未登记时允许离开；由编辑器决定草稿保存、放弃或取消导航。
 * English: Ask the registered editor guard, permitting departure when none exists; the editor decides save/discard/cancel navigation.
 */
export async function mayLeaveEditor() {
  return leaveGuard ? leaveGuard() : true;
}

// A save persists the submitted draft. Text entered while that request is in
// flight must stay in the editor, including a newly created file's next draft.
/**
 * 中文：没有后续草稿或仍是提交对象时清掉编辑状态；同一路径已有新草稿则仅更新基线，其他文件保持原样。
 * English: Clear edit state when no later draft exists or it is still the submitted object. For a newer draft of the same path, update only the baseline; leave other files unchanged.
 * 中文：输入：current：本次核对时仍活动的状态；submitted：请求发出时固定的编辑快照
 * English: Inputs: current: state still active at reconciliation; submitted: edit snapshot fixed when issuing the request
 * 中文：结果：FileEdit | null，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: FileEdit | null carrying the described computation/transport result; throwing branches do not provide success
 */
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
