/**
 * 模块职责：统一写入 HTTP 响应头及 JSON，文档响应委托已验证快照入口发送。
 */
import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { validateResponseHead, validateResponseJson } from './operation-response.ts';
import { noteOperationBusinessResult, noteOperationResponseValidated } from './operation-results.ts';

export { sendDocumentJsonSnapshot as sendDocumentJson } from './operation-response.ts';

export function writeResponseHead(res: ServerResponse, status: number, headers: OutgoingHttpHeaders) {
  noteOperationBusinessResult(status);
  const media = headers['Content-Type'] ?? headers['content-type'];
  validateResponseHead(status, typeof media === 'string' ? media : undefined);
  return res.writeHead(status, headers);
}

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
