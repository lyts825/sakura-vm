/**
 * 模块职责：缓存已验证的 JSON 文档响应快照，复用时核对快照是否仍为当前内容。
 */
import {
  createDocumentJsonSnapshot,
  isCurrentDocumentJsonSnapshot,
  type DocumentJsonSnapshot,
} from './operation-response.ts';

type DocumentKind = 'openapi' | 'sdk';

/** One catalogue generation, with at most its two static public API documents. */
export class DocumentResponseCache {
  private key?: string;
  private readonly snapshots = new Map<DocumentKind, DocumentJsonSnapshot>();

  get(kind: DocumentKind, version: number, enabled: Iterable<string>, port: number, build: () => unknown) {
    if (kind !== 'openapi' && kind !== 'sdk') throw new Error('Unsupported API document');
    const key = JSON.stringify([version, port, [...enabled].sort()]);
    if (key !== this.key) {
      this.snapshots.clear();
      this.key = key;
    }
    const prior = this.snapshots.get(kind);
    if (prior && isCurrentDocumentJsonSnapshot(prior)) return prior;
    const snapshot = createDocumentJsonSnapshot(kind === 'openapi' ? 'core.openapi' : 'core.sdk', build());
    this.snapshots.set(kind, snapshot);
    return snapshot;
  }
}
