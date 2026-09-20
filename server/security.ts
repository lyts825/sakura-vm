import type { IncomingHttpHeaders } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
export function sameOrigin(headers: IncomingHttpHeaders, port: number) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  return (
    hosts.includes(headers.host || '') &&
    headers['sec-fetch-site'] !== 'cross-site' &&
    (!headers.origin || hosts.some((h) => `http://${h}` === headers.origin))
  );
}
export function tokenMatches(value: unknown, token: string) {
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value),
    b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
