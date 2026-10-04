import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { validateResponseHead, validateResponseJson } from './operation-response.ts';

export { sendDocumentJsonSnapshot as sendDocumentJson } from './operation-response.ts';

export function writeResponseHead(res: ServerResponse, status: number, headers: OutgoingHttpHeaders) {
  const media = headers['Content-Type'] ?? headers['content-type'];
  validateResponseHead(status, typeof media === 'string' ? media : undefined);
  return res.writeHead(status, headers);
}

export function sendJson(res: ServerResponse, data: unknown, status = 200, media = 'application/json') {
  const serialized = JSON.stringify(data);
  validateResponseJson(serialized === undefined ? undefined : JSON.parse(serialized), status, media, res);
  res.writeHead(status, {
    'Content-Type': media + '; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(serialized);
  return true;
}
