import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { uploadFiles, type UploadProgress } from '../src/transfers.ts';

class Request {
  static sent: Request[] = [];
  static respond: (request: Request) => void;
  status = 200;
  responseText = '';
  url = '';
  headers = new Map<string, string>();
  upload = { onprogress: null as null | ((event: { loaded: number }) => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  onabort: null | (() => void) = null;
  aborted = false;
  file?: File;
  open(method: string, url: string) {
    assert.equal(method, 'PUT');
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }
  send(file: File) {
    this.file = file;
    Request.sent.push(this);
    queueMicrotask(() => Request.respond(this));
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}
function fixture(t: TestContext, respond: (request: Request) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
  Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, writable: true, value: Request });
  Request.sent = [];
  Request.respond = respond;
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'XMLHttpRequest', descriptor);
    else Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
  });
  const abort = new AbortController();
  const progress: UploadProgress[] = [];
  const options = {
    files: [new File(['abc'], 'first.bin'), new File(['12345'], 'second.bin')],
    token: 'test-token',
    url: (name: string) => '/upload/' + name,
    signal: abort.signal,
    progress: (value: UploadProgress) => progress.push(value),
  };
  return { abort, progress, options };
}

test('multi-file uploads report cumulative progress and release event handlers after success', async (t) => {
  const { options, progress } = fixture(t, (req) => {
    req.upload.onprogress?.({ loaded: req.file!.size });
    req.onload?.();
  });
  await uploadFiles(options);
  assert.deepEqual(
    progress.map((p) => p.loaded),
    [0, 3, 3, 8],
  );
  assert.ok(progress.every((p) => p.total === 8 && p.count === 2));
  assert.deepEqual(
    Request.sent.map((req) => req.url),
    ['/upload/first.bin', '/upload/second.bin'],
  );
  for (const req of Request.sent) {
    assert.equal(req.headers.get('X-Sakura-Token'), 'test-token');
    assert.equal(req.onload, null);
    assert.equal(req.upload.onprogress, null);
  }
});

test('cancelling an active batch aborts the request and never sends subsequent files', async (t) => {
  const { abort, options } = fixture(t, () => abort.abort());
  await assert.rejects(uploadFiles(options), { name: 'AbortError' });
  assert.equal(Request.sent.length, 1);
  assert.equal(Request.sent[0].aborted, true);
  assert.equal(Request.sent[0].onabort, null);
});

test('failed upload preserves server feedback, stops the batch and permits a fresh retry', async (t) => {
  const { options } = fixture(t, (req) => {
    req.status = 409;
    req.responseText = JSON.stringify({ error: '目标已存在' });
    req.onload?.();
  });
  await assert.rejects(uploadFiles(options), /first.bin.*目标已存在/);
  assert.equal(Request.sent.length, 1);
  Request.respond = (req) => req.onload?.();
  await uploadFiles(options);
  assert.equal(Request.sent.length, 3);
});

test('oversized later files and already-cancelled batches are rejected before any upload', async (t) => {
  const { options, abort } = fixture(t, (req) => req.onload?.());
  const large = new File([], 'large.bin');
  Object.defineProperty(large, 'size', { value: 2 * 1024 ** 3 + 1 });
  await assert.rejects(uploadFiles({ ...options, files: [...options.files, large] }), /large.bin.*2 GiB/);
  abort.abort();
  await assert.rejects(uploadFiles(options), { name: 'AbortError' });
  assert.equal(Request.sent.length, 0);
});
