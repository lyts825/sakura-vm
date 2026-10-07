/**
 * 模块职责：统一写入 HTTP 响应头及 JSON，文档响应委托已验证快照入口发送。
 * Module purpose: Writes HTTP heads and JSON consistently, delegating document responses to validated snapshot sending.
 */
import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { validateResponseHead, validateResponseJson } from './operation-response.ts';
import { noteOperationBusinessResult, noteOperationResponseValidated } from './operation-results.ts';

export { sendDocumentJsonSnapshot as sendDocumentJson } from './operation-response.ts';

/**
 * 入口 / Entry: writeResponseHead.
 * 功能：在统一写入 HTTP 响应头及 JSON中，校验并提交领域状态变更；本入口产生 `res.writeHead(status, headers)` 供上层消费（`http-response.ts`）。
 * Purpose: Validates and commits a domain state change in `http-response.ts`; this entry produces `res.writeHead(status, headers)` for its caller. Module context: Writes HTTP heads and JSON consistently, delegating document responses to validated snapshot sending.
 * 处理：通过 `noteOperationBusinessResult`, `validateResponseHead`, `res.writeHead` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `noteOperationBusinessResult`, `validateResponseHead`, `res.writeHead`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: res: ServerResponse; status: number; headers: OutgoingHttpHeaders
 * 输出 / Returns: `res.writeHead(status, headers)`.
 * 副作用 / Effects: `res.writeHead`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function writeResponseHead(res: ServerResponse, status: number, headers: OutgoingHttpHeaders) {
  noteOperationBusinessResult(status);
  const media = headers['Content-Type'] ?? headers['content-type'];
  validateResponseHead(status, typeof media === 'string' ? media : undefined);
  return res.writeHead(status, headers);
}

/**
 * 入口 / Entry: sendJson.
 * 功能：在统一写入 HTTP 响应头及 JSON中，执行此领域的具体处理步骤并返回其结果；本入口产生 `true` 供上层消费（`http-response.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-response.ts`; this entry produces `true` for its caller. Module context: Writes HTTP heads and JSON consistently, delegating document responses to validated snapshot sending.
 * 处理：通过 `noteOperationBusinessResult`, `validateResponseJson`, `noteOperationResponseValidated`, `res.writeHead` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `noteOperationBusinessResult`, `validateResponseJson`, `noteOperationResponseValidated`, `res.writeHead`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: res: ServerResponse; data: unknown; status: default=200; media: default='application/json'
 * 输出 / Returns: `true`.
 * 副作用 / Effects: `res.writeHead`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function sendJson(res: ServerResponse, data: unknown, status = 200, media = 'application/json') {
  noteOperationBusinessResult(status);
  const serialized = JSON.stringify(data);
  validateResponseJson(serialized === undefined ? undefined : JSON.parse(serialized), status, media, res);
  noteOperationResponseValidated();
  res.writeHead(status, {
    'Content-Type': media + '; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(serialized);
  return true;
}
