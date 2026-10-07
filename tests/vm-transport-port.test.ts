/**
 * 回归范围（完整情景见下方用例与断言）：
 * - transport listeners receive the public port and the captured continuation context
 * - listener removal maps originals, removes the last duplicate and retains host cleanup handlers
 * - command and SFTP callbacks retain their public this and original context
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { vmTransportPort } from '../server/vm-transport-port.ts';
import { PassThrough } from 'node:stream';

test('transport listeners receive the public port and the captured continuation context', () => {
  const context = new AsyncLocalStorage<string>();
  const raw = new EventEmitter();
  const port = vmTransportPort(
    raw,
    'client',
    (work) => context.run('original', work),
    (work) => context.run('original', work),
  );
  const calls: string[] = [];
  const listener = (name: string) =>
    function (this: EventEmitter, value: string) {
      assert.equal(this, port);
      assert.equal(context.getStore(), 'original');
      calls.push(name + ':' + value);
    };
  const regular = listener('regular');
  assert.equal(port.on('ready', regular), port);
  port.once('ready', listener('once'));
  port.prependListener('ready', listener('prepend'));
  port.prependOnceListener('ready', listener('prependOnce'));
  assert.equal(port.listenerCount('ready', regular), 1);
  context.run('emitter', () => raw.emit('ready', 'first'));
  context.run('emitter', () => raw.emit('ready', 'second'));
  assert.deepEqual(calls, [
    'prependOnce:first',
    'prepend:first',
    'regular:first',
    'once:first',
    'prepend:second',
    'regular:second',
  ]);
  assert.equal(port.listenerCount('ready'), 2);
});

test('listener removal maps originals, removes the last duplicate and retains host cleanup handlers', () => {
  const raw = new EventEmitter();
  const port = vmTransportPort(raw, 'client', (work) => work());
  const calls: string[] = [];
  const duplicate = () => calls.push('duplicate');
  const middle = () => calls.push('middle');
  let hostCloses = 0;
  raw.on('close', () => {
    hostCloses++;
  });
  port.on('ready', duplicate);
  port.on('ready', middle);
  port.on('ready', duplicate);
  assert.equal(port.off('ready', duplicate), port);
  raw.emit('ready');
  assert.deepEqual(calls, ['duplicate', 'middle']);
  assert.equal(port.listenerCount('ready', duplicate), 1);
  assert.equal(port.removeListener('ready', duplicate), port);
  assert.equal(port.listenerCount('ready', duplicate), 0);
  port.once('ready', duplicate);
  port.off('ready', duplicate);
  port.prependOnceListener('close', duplicate);
  port.removeAllListeners('ready');
  assert.equal(port.listenerCount('ready'), 0);
  assert.equal(port.removeAllListeners(), port);
  raw.emit('close');
  assert.equal(hostCloses, 1);
  assert.deepEqual(calls, ['duplicate', 'middle']);
});

test('command and SFTP callbacks retain their public this and original context', () => {
  const context = new AsyncLocalStorage<string>();
  let execCallback: ((error: Error | undefined, value: string) => void) | undefined;
  let sftpCallback: ((error: Error | undefined, value?: object) => void) | undefined;
  let readCallback: ((error: Error | undefined, value: string) => void) | undefined;
  const ftp = Object.assign(new EventEmitter(), {
    readFile(_path: string, callback: typeof readCallback) {
      readCallback = callback;
    },
  });
  const raw = Object.assign(new EventEmitter(), {
    exec(_command: string, callback: typeof execCallback) {
      execCallback = callback;
    },
    sftp(callback: typeof sftpCallback) {
      sftpCallback = callback;
    },
  });
  const port = vmTransportPort(
    raw,
    'client',
    (work) => context.run('original', work),
    (work) => context.run('original', work),
  );
  let result = '';
  port.exec('memory-task', function (this: typeof raw, error, value) {
    assert.equal(this, port);
    assert.equal(context.getStore(), 'original');
    assert.equal(error, undefined);
    result = value;
  });
  context.run('emitter', () => execCallback!.call(raw, undefined, 'complete'));
  assert.equal(result, 'complete');
  let filePort: typeof ftp | undefined;
  port.sftp(function (this: typeof raw, error, value) {
    assert.equal(this, port);
    assert.equal(context.getStore(), 'original');
    assert.equal(error, undefined);
    filePort = value as typeof ftp;
  });
  context.run('emitter', () => sftpCallback!.call(raw, undefined, ftp));
  assert.notEqual(filePort, ftp);
  filePort!.readFile('/memory', function (this: typeof ftp, error, value) {
    assert.equal(this, filePort);
    assert.equal(context.getStore(), 'original');
    assert.equal(error, undefined);
    result = value;
  });
  context.run('emitter', () => readCallback!.call(ftp, undefined, 'contents'));
  assert.equal(result, 'contents');
});

test('admitted callback completion and close notifications survive cancellation while new commands stop', () => {
  let active = true;
  let pending: ((error?: Error) => void) | undefined;
  let ends = 0,
    destroys = 0,
    errors = 0,
    closes = 0;
  const raw = Object.assign(new EventEmitter(), {
    exec(_command: string, callback: typeof pending) {
      pending = callback;
    },
    end() {
      ends++;
      return raw;
    },
    destroy() {
      destroys++;
      return raw;
    },
  });
  const port = vmTransportPort(raw, 'client', (work) => {
    assert.ok(active, 'transport admission is inactive');
    return work();
  });
  const expected = new Error('cancelled');
  port.on('error', function (this: typeof raw, error) {
    assert.equal(this, port);
    assert.equal(error, expected);
    errors++;
    this.end();
  });
  port.once('close', function (this: typeof raw) {
    assert.equal(this, port);
    closes++;
  });
  let completed = false;
  const exec = port.exec;
  exec('memory-task', function (this: typeof raw, error) {
    assert.equal(this, port);
    assert.equal(error, expected);
    completed = true;
  });
  active = false;
  assert.throws(() => exec('memory-task', () => {}), /admission is inactive/);
  pending!.call(raw, expected);
  raw.emit('error', expected);
  assert.equal(port.destroy(), port);
  raw.emit('close');
  raw.emit('close');
  assert.deepEqual(
    { completed, errors, closes, ends, destroys },
    { completed: true, errors: 1, closes: 1, ends: 1, destroys: 1 },
  );
});

test('exclusive temporary-file removal consumes its receipt on success and preserves it on failure', () => {
  let active = true;
  const stream = new EventEmitter();
  let pending: ((error?: Error) => void) | undefined;
  const raw = Object.assign(new EventEmitter(), {
    createWriteStream(_path: string, _options: { flags: string }) {
      return stream;
    },
    unlink(_path: string, callback: typeof pending) {
      pending = callback;
    },
  });
  const port = vmTransportPort(raw, 'sftp', (work) => {
    assert.ok(active, 'inactive');
    return work();
  });
  port.createWriteStream('/temporary', { flags: 'wx' });
  stream.emit('open');
  active = false;
  const fail = new Error('retry');
  let observed: Error | undefined;
  port.unlink('/temporary', (error) => {
    observed = error;
  });
  pending!.call(raw, fail);
  assert.equal(observed, fail);
  port.unlink('/temporary', (error) => {
    observed = error;
  });
  pending!.call(raw, undefined);
  assert.equal(observed, undefined);
  assert.throws(() => port.unlink('/temporary', () => {}), /inactive/);
});

test('successful temporary-file rename consumes the original removal receipt', () => {
  let active = true;
  const stream = new EventEmitter();
  let pending: ((error?: Error) => void) | undefined;
  const raw = Object.assign(new EventEmitter(), {
    createWriteStream(_path: string, _options: { flags: string }) {
      return stream;
    },
    unlink(_path: string, callback: typeof pending) {
      pending = callback;
    },
    rename(_path: string, _next: string, callback: typeof pending) {
      pending = callback;
    },
  });
  const port = vmTransportPort(raw, 'sftp', (work) => {
    assert.ok(active, 'inactive');
    return work();
  });
  port.createWriteStream('/temporary', { flags: 'wx' });
  stream.emit('open');
  port.rename('/temporary', '/published', () => {});
  pending!.call(raw, undefined);
  active = false;
  assert.throws(() => port.unlink('/temporary', () => {}), /inactive/);
});

test('connection event handles return managed channels and retain admission for new acceptance', () => {
  const native = new EventEmitter();
  let active = true,
    accepted = 0;
  const channel = Object.assign(new PassThrough(), { _client: native });
  const port = vmTransportPort(native, 'client', (work) => {
    assert.equal(active, true, 'new acceptance requires the original admission');
    return work();
  });
  let accept!: () => typeof channel;
  port.on('connection', (_info, callback: () => typeof channel) => {
    accept = callback;
  });
  native.emit('connection', {}, () => {
    accepted++;
    return channel;
  });
  const stream = accept();
  assert.throws(() => Reflect.get(stream, '_client'), { code: 'PLUGIN_SERVICE_PRIVATE' });
  active = false;
  assert.throws(() => accept(), /original admission/);
  assert.equal(accepted, 1);
  stream.destroy();
});

test('pending SSH connection rejection retains its original one-use cleanup receipt after revocation', () => {
  for (const event of ['tcp connection', 'unix connection']) {
    const native = new EventEmitter();
    let active = true,
      accepted = 0,
      rejected = 0,
      callbackContext = false;
    const port = vmTransportPort(
      native,
      'client',
      (work) => {
        assert.ok(active, 'new acceptance requires the original admission');
        return work();
      },
      (work) => {
        callbackContext = true;
        try {
          return work();
        } finally {
          callbackContext = false;
        }
      },
    );
    let accept!: () => PassThrough, reject!: () => void;
    port.on(event, (_info, next: typeof accept, decline: typeof reject) => {
      accept = next;
      reject = decline;
    });
    native.emit(
      event,
      {},
      () => {
        accepted++;
        return new PassThrough();
      },
      () => {
        assert.equal(callbackContext, true);
        rejected++;
      },
    );
    active = false;
    assert.throws(() => accept(), /original admission/);
    reject();
    reject();
    assert.deepEqual({ accepted, rejected }, { accepted: 0, rejected: 1 });
    active = true;
    assert.throws(() => accept(), { code: 'PLUGIN_TRANSPORT_SETTLED' });
  }
});
