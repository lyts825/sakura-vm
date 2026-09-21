import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { MAX_TEXT_REQUEST_BYTES, readJsonBody, requestUrl } from '../server/http.ts';

async function server(t: TestContext) {
  const http = createServer(async (req, res) => {
    try {
      const value = await readJsonBody(req, req.url === '/text' ? MAX_TEXT_REQUEST_BYTES : 1024);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(value));
    } catch (error) {
      res.writeHead((error as { status: number }).status || 500);
      res.end((error as Error).message);
    }
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(async () => {
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  return `http://127.0.0.1:${(http.address() as { port: number }).port}`;
}

test('a full-size UTF-8 text file remains saveable when JSON escapes enlarge its request', async (t) => {
  const base = await server(t);
  const content = '\t'.repeat(1024 ** 2);
  const response = await fetch(base + '/text', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: '/workspace/text.txt', content }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content, content);
});

test('oversized JSON returns an HTTP error instead of resetting the client connection', async (t) => {
  const base = await server(t);
  const response = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'x'.repeat(1500001) }),
  });
  assert.equal(response.status, 413);
  assert.match(await response.text(), /请求内容过大/);
  const next = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"ok":true}',
  });
  assert.deepEqual(await next.json(), { ok: true });
});

test('a still-streaming oversized request receives 413 without an abrupt socket reset', async (t) => {
  const base = await server(t);
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(base, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode!));
    });
    t.after(() => req.destroy());
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('HTTP response timed out'));
    });
    // Do not end the upload: the server must reject before the client sends the rest.
    req.write('x'.repeat(1500001));
  });
  assert.equal(status, 413);
});

test('JSON limits are enforced for each route and malformed bodies retain useful errors', async (t) => {
  const base = await server(t);
  for (const [body, contentType, status] of [
    ['x'.repeat(1025), 'application/json', 413],
    ['{', 'application/json', 400],
    ['{}', 'text/plain', 415],
  ] as const) {
    const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': contentType }, body });
    assert.equal(response.status, status);
    await response.text();
  }
});

test('malformed upgrade URLs are rejected without throwing from the server event listener', () => {
  for (const value of ['http://[', 'http://127.0.0.1:invalid/ws/events', '//['])
    assert.equal(requestUrl(value, 7337), null);
  assert.equal(requestUrl('/ws/events?token=test', 7337)?.pathname, '/ws/events');
  assert.equal(requestUrl(undefined, 7337)?.pathname, '/');
});

test('shutdown cancels a JSON request that has not finished sending its body', async () => {
  const req = Object.assign(new Readable({ read() {} }), {
    headers: { 'content-type': 'application/json' },
  }) as IncomingMessage;
  const abort = new AbortController();
  const pending = readJsonBody(req, 1500000, abort.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  abort.abort();
  await rejected;
  assert.equal(req.destroyed, true);
});
