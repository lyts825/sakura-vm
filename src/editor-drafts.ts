import { type FileEdit, dirtyEdit } from './file-editor-state';

export type EditorDraft = FileEdit & { id: string };
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
export function saveDraftResult(drafts: EditorDraft[], submitted: EditorDraft, version: string) {
  return drafts.map((draft) =>
    draft.id === submitted.id && draft.path === submitted.path
      ? { ...draft, fresh: false, baseContent: submitted.content, version }
      : draft,
  );
}
export function anyDirty(drafts: EditorDraft[]) {
  return drafts.some(dirtyEdit);
}
