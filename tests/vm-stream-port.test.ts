/**
 * 回归范围（完整情景见下方用例与断言）：
 * - managed streams support Node pipelines, callback identity and independently owned listener removal
 * - SFTP streams and SSH channel stderr retain public streaming interfaces
 * - pipeline cancellation and input failure finish the original managed stream
 */
import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import { vmStreamPort } from '../server/vm-stream-port.ts';
import { vmTransportPort } from '../server/vm-transport-port.ts';

test('managed streams support Node pipelines, callback identity and independently owned listener removal', async () => {
  const native = Object.assign(new PassThrough(), { sftp: {}, _client: {} });
  const port = vmStreamPort(native, (work) => work());
  for (const key of ['sftp', '_client', 'constructor'])
    assert.throws(() => Reflect.get(port, key), { code: 'PLUGIN_SERVICE_PRIVATE' });
  const chunks: Buffer[] = [];
  let fired = 0,
    hostFired = 0;
  native.on('original', () => {
    hostFired++;
  });
  port.on('original', () => {
    fired++;
  });
  port.removeAllListeners('original');
  native.emit('original');
  assert.equal(hostFired, 1);
  assert.equal(fired, 0);
  port.once('data', function (this: unknown) {
    assert.equal(this, port);
    fired++;
  });
  await pipeline(
    Readable.from(['a', 'b']),
    port,
    new Writable({
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    }),
  );
  assert.equal(Buffer.concat(chunks).toString(), 'ab');
  assert.equal(fired, 1);
});

test('SFTP streams and SSH channel stderr retain public streaming interfaces', async () => {
  const read = Object.assign(Readable.from(['contents']), { sftp: {} });
  const ftp = vmTransportPort({ createReadStream: () => read }, 'sftp', (work) => work());
  const stream = ftp.createReadStream();
  assert.throws(() => Reflect.get(stream, 'sftp'), { code: 'PLUGIN_SERVICE_PRIVATE' });
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  assert.equal(Buffer.concat(chunks).toString(), 'contents');
  const channel = Object.assign(new PassThrough(), { _client: {}, stderr: new PassThrough() });
  const client = vmTransportPort(
    {
      exec(callback: (error: null, value: typeof channel) => void) {
        callback(null, channel);
      },
    },
    'client',
    (work) => work(),
  );
  client.exec((_error, exposed) => {
    assert.throws(() => Reflect.get(exposed, '_client'), { code: 'PLUGIN_SERVICE_PRIVATE' });
    assert.throws(() => Reflect.get(exposed.stderr, '_channel'), { code: 'PLUGIN_SERVICE_PRIVATE' });
    exposed.destroy();
    exposed.stderr.destroy();
  });
});

test('pipeline cancellation and input failure finish the original managed stream', async () => {
  for (const abort of [false, true]) {
    const native = new PassThrough();
    const port = vmStreamPort(native, (work) => work());
    const source = new Readable({
      read() {
        this.push('partial');
        if (!abort) this.destroy(new Error('interrupted input'));
      },
    });
    const controller = new AbortController();
    const pending = pipeline(
      source,
      port,
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
      { signal: controller.signal },
    );
    const failure = assert.rejects(pending, abort ? { name: 'AbortError' } : /interrupted input/);
    if (abort) controller.abort();
    await failure;
    assert.equal(native.destroyed, true);
  }
});
