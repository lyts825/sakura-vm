/**
 * 模块职责：暂存并校验有限响应，完成审计前阻止发送字节；文档快照可重复发送已验证内容。
 * Module purpose: Stages/validates finite responses before audit publication; immutable document snapshots reuse validated wire bytes.
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
/**
 * 入口 / Entry: normalizedMedia.
 * 功能：在暂存并校验有限响应中，执行此领域的具体处理步骤并返回其结果；本入口产生 `media.split(';')[0].trim().toLowerCase()` 供上层消费（`operation-response.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-response.ts`; this entry produces `media.split(';')[0].trim().toLowerCase()` for its caller. Module context: Stages/validates finite responses before audit publication; immutable document snapshots reuse validated wire bytes.
 * 处理：通过 `media.split()[...].trim().toLowerCase`, `media.split()[...].trim`, `media.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `media.split()[...].trim().toLowerCase`, `media.split()[...].trim`, `media.split`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: media: string
 * 输出 / Returns: `media.split(';')[0].trim().toLowerCase()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const normalizedMedia = (media: string) => media.split(';')[0].trim().toLowerCase();

/** 变更操作先暂存有限响应，待审计及持久回执完成后再由调用方发布。 */
/**
 * 入口 / Entry: stageOperationResponse.
 * 功能：在暂存并校验有限响应中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ discard: restore, publish() { restore(); if (!argumentsEnd) invalid(response.getStore() || { id: 'finite-response' }, '有限响应…` 供上层消费（`operation-response.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-response.ts`; this entry produces `{ discard: restore, publish() { restore(); if (!argumentsEnd) invalid(response.getStore() || { id: 'finite-response' }, '有限响应…` for its caller. Module context: Stages/validates finite responses before audit publication; immutable document snapshots reuse validated wire bytes.
 * 输入 / Inputs: res: ServerResponse
 * 输出 / Returns: `{ discard: restore, publish() { restore(); if (!argumentsEnd) invalid(response.getStore() || { id: 'finite-response' }, '有限响应…`.
 * 副作用 / Effects: 更新 / updates `res.writeHead`, `res.end`, `res.write`, `res.flushHeaders`.
 */
export function stageOperationResponse(res: ServerResponse) {
  const head = res.writeHead, end = res.end, write = res.write, flush = res.flushHeaders;
  let argumentsHead: unknown[] | undefined, argumentsEnd: unknown[] | undefined;
  res.writeHead =
  /**
   * 中文功能：捕获待提交的 writeHead 参数并设置响应状态，暂不写出 HTTP 头，返回原 response 保持链式调用。
   * English: Captures pending writeHead arguments and sets response status without publishing HTTP headers, returning the original response for chaining.
   * 所属 / Owner: stageOperationResponse.
   * 输入 / Inputs: ...args: unknown[].
   */
  function (...args: unknown[]) { argumentsHead = args; res.statusCode = args[0] as number; return res; } as ServerResponse['writeHead'];
  res.end =
  /**
   * 中文功能：捕获待提交的 end 参数而暂不结束响应，返回原 response 供事务提交后恢复发送。
   * English: Captures pending end arguments without ending the response, returning it for sending after transaction commit.
   * 所属 / Owner: stageOperationResponse.
   * 输入 / Inputs: ...args: unknown[].
   */
  function (...args: unknown[]) { argumentsEnd = args; return res; } as ServerResponse['end'];
  /**
   * 入口 / Entry: stageOperationResponse.rejectStreaming.
   * 功能：在暂存并校验有限响应中，执行此领域的具体处理步骤并返回其结果；本入口产生 `invalid(response.getStore() || { id: 'finite-response' }, '有限响应不能在提交审计前发送流式字节')` 供上层消费（`operation-response.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-response.ts`; this entry produces `invalid(response.getStore() || { id: 'finite-response' }, '有限响应不能在提交审计前发送流式字节')` for its caller. Module context: Stages/validates finite responses before audit publication; immutable document snapshots reuse validated wire bytes.
   * 处理：通过 `invalid`, `response.getStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `invalid`, `response.getStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `invalid(response.getStore() || { id: 'finite-response' }, '有限响应不能在提交审计前发送流式字节')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const rejectStreaming = () => invalid(response.getStore() || { id: 'finite-response' }, '有限响应不能在提交审计前发送流式字节');
  res.write = rejectStreaming as ServerResponse['write'];
  res.flushHeaders = rejectStreaming;
  /**
   * 入口 / Entry: stageOperationResponse.restore.
   * 功能：在暂存并校验有限响应中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `res.writeHead`, `res.end`, `res.write`（`operation-response.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-response.ts`; the outcome is recorded in `res.writeHead`, `res.end`, `res.write`. Module context: Stages/validates finite responses before audit publication; immutable document snapshots reuse validated wire bytes.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `res.writeHead`, `res.end`, `res.write`, `res.flushHeaders`.
   */
  const restore = () => { res.writeHead = head; res.end = end; res.write = write; res.flushHeaders = flush; };
  return {
    discard: restore,
    /**
     * 入口 / Entry: stageOperationResponse.publish.
     * 功能：在暂存并校验有限响应中，校验并提交领域状态变更；完成下述调用及状态处理（`operation-response.ts`）。
     * Purpose: Validates and commits a domain state change in `operation-response.ts`; the calls and state transitions below complete the operation. Module context: Stages/validates finite responses before audit publication; immutable document snapshots reuse validated wire bytes.
     * 处理：通过 `restore`, `invalid`, `response.getStore`, `Reflect.apply` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `restore`, `invalid`, `response.getStore`, `Reflect.apply`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `!argumentsEnd`; `argumentsHead`; `argumentsEnd`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    publish() {
      restore();
      if (!argumentsEnd) invalid(response.getStore() || { id: 'finite-response' }, '有限响应缺少结束边界');
      if (argumentsHead) Reflect.apply(head, res, argumentsHead);
      if (argumentsEnd) Reflect.apply(end, res, argumentsEnd);
    },
  };
}

/** 已准入操作持有响应契约上下文，异步建立的流也继续使用同一绑定。 */
/**
 * 入口 / Entry: withOperationResponse.
 * 功能：把本层请求转交 `response.run`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `response.run` and propagates the provider result or rejection.
 * 输入 / Inputs: binding: ResponseBinding; work: () => T
 * 输出 / Returns: T；结果来自 / values from `response.run(binding, work)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function withOperationResponse<T>(binding: ResponseBinding, work: () => T): T {
  return response.run(binding, work);
}

/**
 * 入口 / Entry: invalid.
 * 功能：在暂存并校验有限响应中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`operation-response.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-response.ts`; the calls and state transitions below complete the operation. Module context: Stages/validates finite responses before audit publication; immutable document snapshots reuse validated wire bytes.
 * 输入 / Inputs: binding: ResponseBinding; detail: string
 * 输出 / Returns: never.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 异常 / errors `new AppError(`操作 ${binding.id} 的响应不符合契约：${detail}`, 502, 'INVALID_OPERATION_RESPONSE')`.
 */
function invalid(binding: ResponseBinding, detail: string): never {
  throw new AppError(`操作 ${binding.id} 的响应不符合契约：${detail}`, 502, 'INVALID_OPERATION_RESPONSE');
}

/**
 * 入口 / Entry: validateResponseHead.
 * 功能：在暂存并校验有限响应中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`operation-response.ts`）。
 * Purpose: Checks admission, input or resource ownership in `operation-response.ts`; this entry produces `void` for its caller. Module context: Stages/validates finite responses before audit publication; immutable document snapshots reuse validated wire bytes.
 * 处理：通过 `response.getStore`, `contract.statuses.includes`, `invalid`, `media.split()[...].trim().toLowerCase` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `response.getStore`, `contract.statuses.includes`, `invalid`, `media.split()[...].trim().toLowerCase`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!binding?.contract`; `status >= 400 && !contract.statuses.includes(status)`; `!contract.statuses.includes(status)`.
 * 输入 / Inputs: status: number; media: string optional
 * 输出 / Returns: `void`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
/**
 * 入口 / Entry: validateResponseJson.
 * 功能：在暂存并校验有限响应中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`operation-response.ts`）。
 * Purpose: Checks admission, input or resource ownership in `operation-response.ts`; this entry produces `void` for its caller. Module context: Stages/validates finite responses before audit publication; immutable document snapshots reuse validated wire bytes.
 * 处理：通过 `response.getStore`, `contract.statuses.includes`, `runtimeTimings.start`, `validateResponseHead` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `response.getStore`, `contract.statuses.includes`, `runtimeTimings.start`, `validateResponseHead`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!binding?.contract`; `status >= 400 && !contract.statuses.includes(status)`; `contract.kind !== 'json' || !contract.schema`.
 * 输入 / Inputs: value: unknown; status: number; media: default='application/json'; res: ServerResponse optional
 * 输出 / Returns: `void`.
 * 副作用 / Effects: `runtimeTimings.start`; `validated.set`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 收尾：退出 try 区域时始终执行 `finish();`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `finish();`; these steps also apply to exceptional exits.
 */
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
/**
 * 入口 / Entry: createDocumentJsonSnapshot.
 * 功能：在暂存并校验有限响应中，执行此领域的具体处理步骤并返回其结果；本入口产生 `snapshot` 供上层消费（`operation-response.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-response.ts`; this entry produces `snapshot` for its caller. Module context: Stages/validates finite responses before audit publication; immutable document snapshots reuse validated wire bytes.
 * 处理：通过 `response.getStore`, `invalid`, `validateResponseHead`, `validateResponseJson` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `response.getStore`, `invalid`, `validateResponseHead`, `validateResponseJson`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `(id !== 'core.openapi' && id !== 'core.sdk') || !binding?.contract || binding.id !== id`; `contract.kind !== 'json' || !contract.schema`; `serialized === undefined`.
 * 输入 / Inputs: id: DocumentOperation; data: unknown
 * 输出 / Returns: DocumentJsonSnapshot；结果来自 / values from `snapshot`.
 * 副作用 / Effects: `documentSnapshots.set`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
/**
 * 入口 / Entry: isCurrentDocumentJsonSnapshot.
 * 功能：在暂存并校验有限响应中，执行此领域的具体处理步骤并返回其结果；本入口产生 `!!proof && !!binding?.contract && binding.id === proof.id && binding.contract === proof.contract && binding.contract.kind ===…` 供上层消费（`operation-response.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-response.ts`; this entry produces `!!proof && !!binding?.contract && binding.id === proof.id && binding.contract === proof.contract && binding.contract.kind ===…` for its caller. Module context: Stages/validates finite responses before audit publication; immutable document snapshots reuse validated wire bytes.
 * 处理：通过 `documentSnapshots.get`, `response.getStore`, `binding.contract.statuses.includes`, `normalizedMedia` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `documentSnapshots.get`, `response.getStore`, `binding.contract.statuses.includes`, `normalizedMedia`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: snapshot: DocumentJsonSnapshot
 * 输出 / Returns: boolean；结果来自 / values from `!!proof && !!binding?.contract && binding.id === proof.id && binding.contract === proof.contract && binding.contract.kind ===…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function isCurrentDocumentJsonSnapshot(snapshot: DocumentJsonSnapshot): boolean {
  const proof = documentSnapshots.get(snapshot), binding = response.getStore();
  return !!proof && !!binding?.contract && binding.id === proof.id && binding.contract === proof.contract &&
    binding.contract.kind === 'json' && binding.contract.schema === proof.schema &&
    binding.contract.statuses.includes(proof.status) &&
    normalizedMedia(binding.contract.media || '') === proof.media;
}

/** 已验证字节保存在模块私有表内，调用方无法在校验后替换快照正文。 */
/**
 * 入口 / Entry: sendDocumentJsonSnapshot.
 * 功能：在暂存并校验有限响应中，执行此领域的具体处理步骤并返回其结果；本入口产生 `true` 供上层消费（`operation-response.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-response.ts`; this entry produces `true` for its caller. Module context: Stages/validates finite responses before audit publication; immutable document snapshots reuse validated wire bytes.
 * 处理：通过 `response.getStore`, `isCurrentDocumentJsonSnapshot`, `invalid`, `documentSnapshots.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `response.getStore`, `isCurrentDocumentJsonSnapshot`, `invalid`, `documentSnapshots.get`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!isCurrentDocumentJsonSnapshot(snapshot)`.
 * 输入 / Inputs: res: ServerResponse; snapshot: DocumentJsonSnapshot
 * 输出 / Returns: `true`.
 * 副作用 / Effects: `validated.set`; `res.writeHead`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
/**
 * 入口 / Entry: guardOperationResponse.
 * 功能：在暂存并校验有限响应中，核对调用资格、输入或资源归属；处理结果记录到 `res.writeHead`（`operation-response.ts`）。
 * Purpose: Checks admission, input or resource ownership in `operation-response.ts`; the outcome is recorded in `res.writeHead`. Module context: Stages/validates finite responses before audit publication; immutable document snapshots reuse validated wire bytes.
 * 输入 / Inputs: res: ServerResponse; binding: ResponseBinding
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 更新 / updates `res.writeHead`.
 */
export function guardOperationResponse(res: ServerResponse, binding: ResponseBinding) {
  const original = res.writeHead;
  /**
   * 入口 / Entry: guardOperationResponse.callback@144.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: this: ServerResponse; args: [number, unknown?, unknown?]
   * 输出 / Returns: `Reflect.apply(original, this, args)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
