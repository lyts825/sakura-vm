import { AsyncLocalStorage } from 'node:async_hooks';
import type { ServerResponse } from 'node:http';
import type { HttpResponseContract } from '../shared/contracts/http-response.ts';
import { AppError } from '../shared/errors.ts';

type ResponseBinding = { id: string; contract?: HttpResponseContract };
const response = new AsyncLocalStorage<ResponseBinding>();
const validated = new WeakMap<ServerResponse, { binding: ResponseBinding; status: number; media: string }>();

type DocumentOperation = 'core.openapi' | 'core.sdk';
declare const documentSnapshotBrand: unique symbol;
/** Only this module can associate a document snapshot with validated, immutable wire bytes. */
export type DocumentJsonSnapshot = { readonly [documentSnapshotBrand]: true };
type DocumentSnapshotProof = {
  id: DocumentOperation;
  contract: HttpResponseContract;
  schema: NonNullable<HttpResponseContract['schema']>;
  status: number;
  media: string;
  serialized: string;
};
const documentSnapshots = new WeakMap<DocumentJsonSnapshot, DocumentSnapshotProof>();
const normalizedMedia = (media: string) => media.split(';')[0].trim().toLowerCase();

/** The admitted operation owns its response, including asynchronous stream setup. */
export function withOperationResponse<T>(binding: ResponseBinding, work: () => T): T {
  return response.run(binding, work);
}

function invalid(binding: ResponseBinding, detail: string): never {
  throw new AppError(`操作 ${binding.id} 的响应不符合契约：${detail}`, 502, 'INVALID_OPERATION_RESPONSE');
}

export function validateResponseHead(status: number, media?: string) {
  const binding = response.getStore();
  if (!binding?.contract) return;
  const contract = binding.contract;
  // Shared admission and domain failures have their own error envelope. Protocol-level
  // errors (for example GraphQL 400) may explicitly opt into the operation schema.
  if (status >= 400 && !contract.statuses.includes(status)) return;
  if (!contract.statuses.includes(status)) invalid(binding, `未声明状态 ${status}`);
  if (contract.kind === 'empty') {
    if (media) invalid(binding, '空响应不能声明媒体类型');
  } else if (contract.media && media?.split(';')[0].trim().toLowerCase() !== contract.media.toLowerCase()) {
    invalid(binding, '媒体类型不匹配');
  }
}

/** Validate serialized JSON, so optional undefined fields and toJSON match the wire. */
export function validateResponseJson(value: unknown, status: number, media = 'application/json', res?: ServerResponse) {
  const binding = response.getStore();
  if (!binding?.contract) return;
  const contract = binding.contract;
  if (status >= 400 && !contract.statuses.includes(status)) return;
  validateResponseHead(status, media);
  if (contract.kind !== 'json' || !contract.schema) invalid(binding, '未声明 JSON 响应');
  const result = contract.schema.safeParse(value);
  if (!result.success) {
    // Paths explain contract drift without including credentials or response contents.
    const paths = result.error.issues.slice(0, 5).map(issue => issue.path.join('.') || '<root>');
    invalid(binding, `字段 ${paths.join(', ')}`);
  }
  if (res) validated.set(res, { binding, status, media: normalizedMedia(media) });
}

/** Create a document snapshot once, using the same serialized-JSON validation as sendJson. */
export function createDocumentJsonSnapshot(id: DocumentOperation, data: unknown): DocumentJsonSnapshot {
  const binding = response.getStore();
  if ((id !== 'core.openapi' && id !== 'core.sdk') || !binding?.contract || binding.id !== id)
    invalid(binding || { id }, '文档快照缺少当前操作绑定');
  const contract = binding.contract;
  const status = 200, media = 'application/json';
  if (contract.kind !== 'json' || !contract.schema) invalid(binding, '文档快照需要 JSON 契约');
  const schema = contract.schema;
  validateResponseHead(status, media);
  const serialized = JSON.stringify(data);
  validateResponseJson(serialized === undefined ? undefined : JSON.parse(serialized), status, media);
  if (serialized === undefined) invalid(binding, '文档快照没有 JSON 内容');
  const snapshot = Object.freeze({}) as DocumentJsonSnapshot;
  documentSnapshots.set(snapshot, { id, contract, schema, status, media, serialized });
  if (!isCurrentDocumentJsonSnapshot(snapshot)) invalid(binding, '文档快照验证期间响应契约发生变化');
  return snapshot;
}

/** A cache entry becomes unusable if its operation, contract, schema, status or media changed. */
export function isCurrentDocumentJsonSnapshot(snapshot: DocumentJsonSnapshot): boolean {
  const proof = documentSnapshots.get(snapshot), binding = response.getStore();
  return !!proof && !!binding?.contract && binding.id === proof.id && binding.contract === proof.contract &&
    binding.contract.kind === 'json' && binding.contract.schema === proof.schema &&
    binding.contract.statuses.includes(proof.status) &&
    normalizedMedia(binding.contract.media || '') === proof.media;
}

/** Keep wire bytes private so callers cannot substitute another payload after validation. */
export function sendDocumentJsonSnapshot(res: ServerResponse, snapshot: DocumentJsonSnapshot) {
  const binding = response.getStore();
  if (!isCurrentDocumentJsonSnapshot(snapshot))
    invalid(binding || { id: 'document' }, '文档快照与当前响应契约不匹配');
  const proof = documentSnapshots.get(snapshot)!;
  validateResponseHead(proof.status, proof.media);
  validated.set(res, { binding: binding!, status: proof.status, media: proof.media });
  res.writeHead(proof.status, {
    'Content-Type': proof.media + '; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(proof.serialized);
  return true;
}

/** A newly added handler cannot bypass a declared JSON contract by writing raw bytes. */
export function guardOperationResponse(res: ServerResponse, binding: ResponseBinding) {
  const original = res.writeHead;
  res.writeHead = function (this: ServerResponse, ...args: [number, unknown?, unknown?]) {
    const status = args[0];
    // General HTTP failures are emitted outside the admitted handler's context.
    // Protocol errors emitted inside it have already passed sendJson validation.
    if (status >= 200 && status < 400) {
      const headers = typeof args[1] === 'string' ? args[2] : args[1];
      const entries: [string, unknown][] = Array.isArray(headers)
        ? Array.from({ length: headers.length / 2 }, (_, index) => [String(headers[index * 2]), headers[index * 2 + 1]])
        : Object.entries((headers || {}) as Record<string, unknown>);
      const contentType = entries.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? res.getHeader('content-type');
      const media = typeof contentType === 'string' ? contentType.split(';')[0].trim().toLowerCase() : undefined;
      withOperationResponse(binding, () => validateResponseHead(status, media));
      if (binding.contract?.kind === 'json') {
        const proof = validated.get(res);
        if (!proof || proof.binding.id !== binding.id || proof.binding.contract !== binding.contract ||
          proof.status !== status || proof.media !== media) invalid(binding, 'JSON 响应未经过结构校验');
      }
    }
    return Reflect.apply(original, this, args);
  } as ServerResponse['writeHead'];
}
