/**
 * 模块职责：缓存已验证的 JSON 文档响应快照，复用时核对快照是否仍为当前内容。
 * Module purpose: Caches validated static JSON document snapshots and rechecks whether each snapshot still matches current contracts.
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

  /**
   * 入口 / Entry: DocumentResponseCache.get.
   * 功能：在缓存已验证的 JSON 文档响应快照中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `prior` / `snapshot` 供上层消费（`DocumentResponseCache`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `DocumentResponseCache`; this entry produces `prior` / `snapshot` for its caller. Module context: Caches validated static JSON document snapshots and rechecks whether each snapshot still matches current contracts.
   * 处理：通过 `inline.sort`, `this.snapshots.clear`, `this.snapshots.get`, `isCurrentDocumentJsonSnapshot` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.sort`, `this.snapshots.clear`, `this.snapshots.get`, `isCurrentDocumentJsonSnapshot`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `key !== this.key`; `prior && isCurrentDocumentJsonSnapshot(prior)`.
   * 输入 / Inputs: kind: DocumentKind; version: number; enabled: Iterable<string>; port: number; build: () => unknown
   * 输出 / Returns: `prior`; `snapshot`.
   * 副作用 / Effects: `this.snapshots.clear`; `createDocumentJsonSnapshot`; `this.snapshots.set`; 更新 / updates `this.key`.
   * 拒绝 / Refusals: 条件 / conditions `kind !== 'openapi' && kind !== 'sdk'`; 异常 / errors `new Error('Unsupported API document')`.
   */
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
