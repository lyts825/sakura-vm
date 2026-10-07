/**
 * 模块职责：解析请求 URL、媒体类型及有界 JSON/表单请求体，超限或类型不符时拒绝读取。
 * Module purpose: Parses URLs, media types and bounded JSON/form bodies, refusing unsupported media and oversized input.
 */
import type { IncomingMessage } from 'node:http';
import { AppError } from '../shared/errors.ts';
import { MAX_TEXT_BYTES } from './files.ts';

// JSON can encode each content byte as a six-character \uXXXX escape.
export const MAX_TEXT_REQUEST_BYTES = MAX_TEXT_BYTES * 6 + 65536;

/**
 * 入口 / Entry: requestUrl.
 * 功能：在解析请求 URL、媒体类型及有界 JSON/表单请求体中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new URL(value || '/', `http://127.0.0.1:${port}`)` / `null` 供上层消费（`http.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `http.ts`; this entry produces `new URL(value || '/', `http://127.0.0.1:${port}`)` / `null` for its caller. Module context: Parses URLs, media types and bounded JSON/form bodies, refusing unsupported media and oversized input.
 * 输入 / Inputs: value: string | undefined; port: number
 * 输出 / Returns: URL | null；结果来自 / values from `new URL(value || '/', `http://127.0.0.1:${port}`)`; `null`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败处理：catch 分支执行 `return null;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return null;`; these statements determine whether a failure is absorbed or rejected again.
 */
export function requestUrl(value: string | undefined, port: number): URL | null {
  try {
    return new URL(value || '/', `http://127.0.0.1:${port}`);
  } catch {
    return null;
  }
}

export const DEFAULT_JSON_REQUEST_BYTES = 1500000;
const jsonBodies = new WeakMap<IncomingMessage, Promise<{ bytes: number; input: unknown }>>();

/**
 * 入口 / Entry: requestMediaType.
 * 功能：在解析请求 URL、媒体类型及有界 JSON/表单请求体中，执行此领域的具体处理步骤并返回其结果；本入口产生 `req.headers['content-type']?.split(';')[0].trim().toLowerCase()` 供上层消费（`http.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `http.ts`; this entry produces `req.headers['content-type']?.split(';')[0].trim().toLowerCase()` for its caller. Module context: Parses URLs, media types and bounded JSON/form bodies, refusing unsupported media and oversized input.
 * 处理：通过 `req.headers[...].split()[...].trim().toLowerCase`, `req.headers[...].split()[...].trim`, `req.headers[...].split` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `req.headers[...].split()[...].trim().toLowerCase`, `req.headers[...].split()[...].trim`, `req.headers[...].split`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: req: Pick<IncomingMessage, 'headers'>
 * 输出 / Returns: `req.headers['content-type']?.split(';')[0].trim().toLowerCase()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const requestMediaType = (req: Pick<IncomingMessage, 'headers'>) =>
  req.headers['content-type']?.split(';')[0].trim().toLowerCase();
/**
 * 入口 / Entry: requestHasBody.
 * 功能：从当前输入或状态计算 `Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] !== undefined`，供调用方后续验证或使用。
 * Purpose: Computes `Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] !== undefined` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: req: Pick<IncomingMessage, 'headers'>
 * 输出 / Returns: `Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] !== undefined`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export const requestHasBody = (req: Pick<IncomingMessage, 'headers'>) =>
  Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] !== undefined;

/** Preserve form multiplicity for protocol readers such as the SAML callback. */
/**
 * 入口 / Entry: readFormBody.
 * 功能：在解析请求 URL、媒体类型及有界 JSON/表单请求体中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `new URLSearchParams(Buffer.concat(chunks).toString('utf8'))` 供上层消费（`http.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `http.ts`; this entry produces `new URLSearchParams(Buffer.concat(chunks).toString('utf8'))` for its caller. Module context: Parses URLs, media types and bounded JSON/form bodies, refusing unsupported media and oversized input.
 * 处理：通过 `requestMediaType`, `chunks.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `requestMediaType`, `chunks.push`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: req: IncomingMessage; maxBytes: number
 * 输出 / Returns: `new URLSearchParams(Buffer.concat(chunks).toString('utf8'))`.
 * 副作用 / Effects: `requestMediaType`; `chunks.push`; 更新 / updates `size`.
 * 拒绝 / Refusals: 条件 / conditions `requestMediaType(req) !== 'application/x-www-form-urlencoded'`; `size > maxBytes`; 异常 / errors `new AppError('需要 application/x-www-form-urlencoded 请求', 415)`; `new AppError('表单内容过大', 413)`.
 */
export async function readFormBody(req: IncomingMessage, maxBytes: number) {
  if (requestMediaType(req) !== 'application/x-www-form-urlencoded')
    throw new AppError('需要 application/x-www-form-urlencoded 请求', 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new AppError('表单内容过大', 413);
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

/**
 * 入口 / Entry: consumeJsonBody.
 * 功能：在解析请求 URL、媒体类型及有界 JSON/表单请求体中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ bytes: size, input: JSON.parse(Buffer.concat(chunks).toString()) as unknown }` 供上层消费（`http.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `http.ts`; this entry produces `{ bytes: size, input: JSON.parse(Buffer.concat(chunks).toString()) as unknown }` for its caller. Module context: Parses URLs, media types and bounded JSON/form bodies, refusing unsupported media and oversized input.
 * 处理：通过 `signal.throwIfAborted`, `requestMediaType`, `signal.addEventListener`, `chunks.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `requestMediaType`, `signal.addEventListener`, `chunks.push`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: req: IncomingMessage; maxBytes: number; signal: AbortSignal optional
 * 输出 / Returns: `{ bytes: size, input: JSON.parse(Buffer.concat(chunks).toString()) as unknown }`.
 * 副作用 / Effects: `requestMediaType`; `signal.addEventListener`; `chunks.push`; 更新 / updates `size`.
 * 拒绝 / Refusals: 条件 / conditions `requestMediaType(req) !== 'application/json'`; `size > maxBytes`; 异常 / errors `new AppError('需要 application/json 请求', 415)`; `new AppError('请求内容过大', 413)`.
 * 收尾：退出 try 区域时始终执行 `signal?.removeEventListener('abort', abort);`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `signal?.removeEventListener('abort', abort);`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `throw new AppError('JSON 格式错误');`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `throw new AppError('JSON 格式错误');`; these statements determine whether a failure is absorbed or rejected again.
 */
async function consumeJsonBody(req: IncomingMessage, maxBytes: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (requestMediaType(req) !== 'application/json')
    throw new AppError('需要 application/json 请求', 415);
  const chunks: Buffer[] = [];
  let size = 0;
  /**
   * 入口 / Entry: consumeJsonBody.abort.
   * 功能：在解析请求 URL、媒体类型及有界 JSON/表单请求体中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`http.ts`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `http.ts`; the calls and state transitions below complete the operation. Module context: Parses URLs, media types and bounded JSON/form bodies, refusing unsupported media and oversized input.
   * 处理：通过 `req.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `req.destroy`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `req.destroy`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const abort = () => {
    req.destroy(signal?.reason);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for await (const data of req) {
      size += data.length;
      if (size > maxBytes) throw new AppError('请求内容过大', 413);
      chunks.push(data);
    }
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener('abort', abort);
  }
  try {
    return { bytes: size, input: JSON.parse(Buffer.concat(chunks).toString()) as unknown };
  } catch {
    throw new AppError('JSON 格式错误');
  }
}

/** A bounded preflight and the domain handler share one physical body read.
 * Every reader retains its own byte limit and cancellation check. The weak
 * cache is request-local and never persists bodies or credentials. */
/**
 * 入口 / Entry: readJsonBody.
 * 功能：在解析请求 URL、媒体类型及有界 JSON/表单请求体中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `structuredClone(body.input)` 供上层消费（`http.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `http.ts`; this entry produces `structuredClone(body.input)` for its caller. Module context: Parses URLs, media types and bounded JSON/form bodies, refusing unsupported media and oversized input.
 * 处理：通过 `signal.throwIfAborted`, `jsonBodies.get`, `consumeJsonBody`, `jsonBodies.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `jsonBodies.get`, `consumeJsonBody`, `jsonBodies.set`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!pending`.
 * 输入 / Inputs: req: IncomingMessage; maxBytes: default=DEFAULT_JSON_REQUEST_BYTES; signal: AbortSignal optional
 * 输出 / Returns: `structuredClone(body.input)`.
 * 副作用 / Effects: `jsonBodies.set`; 更新 / updates `pending`.
 * 拒绝 / Refusals: 条件 / conditions `body.bytes > maxBytes`; 异常 / errors `new AppError('请求内容过大', 413)`.
 */
export async function readJsonBody(req: IncomingMessage, maxBytes = DEFAULT_JSON_REQUEST_BYTES, signal?: AbortSignal) {
  signal?.throwIfAborted();
  let pending = jsonBodies.get(req);
  if (!pending) {
    pending = consumeJsonBody(req, maxBytes, signal);
    jsonBodies.set(req, pending);
  }
  const body = await pending;
  signal?.throwIfAborted();
  if (body.bytes > maxBytes) throw new AppError('请求内容过大', 413);
  return structuredClone(body.input);
}
