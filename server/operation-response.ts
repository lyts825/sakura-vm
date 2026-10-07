/**
 * 模块职责：暂存并校验有限响应，完成审计前阻止发送字节；文档快照可重复发送已验证内容。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ServerResponse } from 'node:http';
import type { HttpResponseContract } from '../shared/contracts/http-response.ts';
import { AppError } from '../shared/errors.ts';
import { runtimeTimings } from './runtime-timings.ts';

type ResponseBinding = { id: string; contract?: HttpResponseContract };
const response = new AsyncLocalStorage<ResponseBinding>();
const validated = new WeakMap<ServerResponse, { binding: ResponseBinding; status: number; media: string }>();

type DocumentOperation = 'core.openapi' | 'core.sdk';
declare const documentSnapshotBrand: unique symbol;
/** 只有本模块能把文档快照关联到已验证且不可变的线路字节，调用方不能自行伪造。 */
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

/** 变更操作先暂存有限响应，待审计及持久回执完成后再由调用方发布。 */
export function stageOperationResponse(res: ServerResponse) {
  const head = res.writeHead, end = res.end, write = res.write, flush = res.flushHeaders;
  let argumentsHead: unknown[] | undefined, argumentsEnd: unknown[] | undefined;
  res.writeHead = function (...args: unknown[]) { argumentsHead = args; res.statusCode = args[0] as number; return res; } as ServerResponse['writeHead'];
  res.end = function (...args: unknown[]) { argumentsEnd = args; return res; } as ServerResponse['end'];
  const rejectStreaming = () => invalid(response.getStore() || { id: 'finite-response' }, '有限响应不能在提交审计前发送流式字节');
  res.write = rejectStreaming as ServerResponse['write'];
  res.flushHeaders = rejectStreaming;
  const restore = () => { res.writeHead = head; res.end = end; res.write = write; res.flushHeaders = flush; };
  return {
    discard: restore,
    publish() {
      restore();
      if (!argumentsEnd) invalid(response.getStore() || { id: 'finite-response' }, '有限响应缺少结束边界');
      if (argumentsHead) Reflect.apply(head, res, argumentsHead);
      if (argumentsEnd) Reflect.apply(end, res, argumentsEnd);
    },
  };
}

/** 已准入操作持有响应契约上下文，异步建立的流也继续使用同一绑定。 */
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

/** 检查发送方准备的线路 JSON 值，使 undefined 字段及 toJSON 转换按实际发送内容校验。 */
export function validateResponseJson(value: unknown, status: number, media = 'application/json', res?: ServerResponse) {
  const binding = response.getStore();
  if (!binding?.contract) return;
  const contract = binding.contract;
  if (status >= 400 && !contract.statuses.includes(status)) return;
  const finish = runtimeTimings.start('http', 'response');
  try {
    validateResponseHead(status, media);
    if (contract.kind !== 'json' || !contract.schema) invalid(binding, '未声明 JSON 响应');
    const result = contract.schema.safeParse(value);
    if (!result.success) {
      // 只报告少量字段路径解释契约偏差，不把凭证或响应正文放进错误消息。
      const paths = result.error.issues.slice(0, 5).map(issue => issue.path.join('.') || '<root>');
      invalid(binding, `字段 ${paths.join(', ')}`);
    }
    if (res) validated.set(res, { binding, status, media: normalizedMedia(media) });
  } finally {
    finish();
  }
}

/** 创建并验证静态文档的序列化快照，复用 sendJson 的同一线路 JSON 契约。 */
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

/** 操作、契约对象、schema、状态或媒体类型任一改变，原缓存快照即失去发送资格。 */
export function isCurrentDocumentJsonSnapshot(snapshot: DocumentJsonSnapshot): boolean {
  const proof = documentSnapshots.get(snapshot), binding = response.getStore();
  return !!proof && !!binding?.contract && binding.id === proof.id && binding.contract === proof.contract &&
    binding.contract.kind === 'json' && binding.contract.schema === proof.schema &&
    binding.contract.statuses.includes(proof.status) &&
    normalizedMedia(binding.contract.media || '') === proof.media;
}

/** 已验证字节保存在模块私有表内，调用方无法在校验后替换快照正文。 */
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

/** 响应头发布前要求当前 JSON 校验证明，防止新处理器直接写字节绕过契约。 */
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
