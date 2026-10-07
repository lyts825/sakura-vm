/**
 * 模块职责（中文）：管理按路径保存的编辑草稿与保存结果，保留请求发出后继续输入的内容。
 * Module responsibility (English): Restoring drafts and retaining edits made while a save was in flight.
 * 详细范围（中文）：公开入口包括 EditorDraft, restoreDrafts, saveDraftResult, anyDirty；职责覆盖恢复草稿并在保存确认后保留请求期间的新编辑，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include EditorDraft, restoreDrafts, saveDraftResult, anyDirty. The scope covers Restoring drafts and retaining edits made while a save was in flight. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { type FileEdit, dirtyEdit } from './file-editor-state';

export type EditorDraft = FileEdit & { id: string };
/**
 * 中文：把未知缓存值规范为至多 20 个草稿，过滤无绝对路径、文本缺失或重复路径，修补缺失/重复 ID；保留有效保存基线和版本，不执行存储读取。
 * English: Normalize an unknown cached value into at most twenty drafts. Filter nonabsolute/missing-text/duplicate paths, repair missing/duplicate IDs and preserve valid saved baselines/versions; this function does not read storage.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 * 中文：结果：EditorDraft[]，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: EditorDraft[] carrying the described computation/transport result; throwing branches do not provide success
 */
export function restoreDrafts(value: unknown): EditorDraft[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const paths = new Set<string>(),
    ids = new Set<string>();
  return values
    .filter((item) => {
      if (
        !item ||
        typeof item.path !== 'string' ||
        !item.path.startsWith('/') ||
        typeof item.content !== 'string' ||
        paths.has(item.path)
      )
        return false;
      paths.add(item.path);
      return true;
    })
    .slice(0, 20)
    .map((item) => {
      const id = typeof item.id === 'string' && item.id && !ids.has(item.id) ? item.id : crypto.randomUUID();
      ids.add(id);
      return {
        id,
        path: item.path,
        content: item.content,
        fresh: item.fresh === true,
        baseContent: typeof item.baseContent === 'string' ? item.baseContent : undefined,
        version: typeof item.version === 'string' ? item.version : undefined,
      };
    });
}
// 保存响应只更新提交时的基线和版本，当前草稿正文保留，因此请求期间继续输入的文本仍被标为未保存。
/**
 * 中文：仅更新与提交 ID 和路径相同草稿的保存基线及版本，保留当前正文；请求期间继续输入仍是未保存状态，不能被旧提交内容覆盖。
 * English: Update only the saved baseline/version of drafts matching the submitted ID and path, retaining their current text. Edits made while saving remain unsaved instead of being overwritten by the older submission.
 * 中文：输入：drafts：当前保留的编辑草稿集合；submitted：请求发出时固定的编辑快照；version：读取票号、内容版本或契约版本
 * English: Inputs: drafts: currently retained editing drafts; submitted: edit snapshot fixed when issuing the request; version: read ticket/content/contract version
 */
export function saveDraftResult(drafts: EditorDraft[], submitted: EditorDraft, version: string) {
  return drafts.map((draft) =>
    draft.id === submitted.id && draft.path === submitted.path
      ? { ...draft, fresh: false, baseContent: submitted.content, version }
      : draft,
  );
}
/**
 * 中文：判断任一编辑草稿是否偏离保存基线，用于关闭页面和导航前的统一离开保护。
 * English: Determine whether any draft differs from its saved baseline, supporting a shared guard before page closure/navigation.
 * 中文：输入：drafts：当前保留的编辑草稿集合
 * English: Inputs: drafts: currently retained editing drafts
 */
export function anyDirty(drafts: EditorDraft[]) {
  return drafts.some(dirtyEdit);
}
