import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { listenHttpServer } from '../server/http-listener.ts';
import { ResourceScope } from '../server/resource-scope.ts';
import { OperationTracker, requestScope } from '../server/operation-scope.ts';

test('failed initialization cleans partial resources in dependency order and continues after failure', async () => {
  const scope = new ResourceScope(),
    events: string[] = [];
  scope.own(
    'runtime',
    {
      close() {
        events.push('runtime');
      },
    },
    30,
  );
  scope.own(
    'plugins',
    {
      close() {
        events.push('plugins');
        throw new Error('cleanup');
      },
    },
    20,
  );
  const partial = scope.own(
    'listener',
    {
      async init() {
        events.push('partial-init');
        throw new Error('start');
      },
      close() {
        events.push('listener');
      },
    },
    10,
  );
  await assert.rejects(partial.init(), /start/);
  const closing = scope.close();
  assert.equal(scope.close(), closing);
  await assert.rejects(closing, (error: AggregateError) => {
    assert.equal(error.errors.length, 1);
    assert.match(error.errors[0].message, /plugins/);
    assert.match(error.errors[0].cause.message, /cleanup/);
    return true;
  });
  assert.deepEqual(events, ['partial-init', 'listener', 'plugins', 'runtime']);
  assert.throws(() => scope.defer('late', () => {}), /closing/);
});

test('transferring runtime ownership avoids double disposal, equal-priority resources close in reverse order', async () => {
  const scope = new ResourceScope(),
    events: string[] = [];
  const disown = scope.defer('runtime', () => events.push('old-owner'));
  scope.defer('machines', () => events.push('machines'));
  disown();
  scope.defer('transport', () => events.push('transport'));
  await scope.close();
  await scope.close();
  assert.deepEqual(events, ['transport', 'machines']);
});

test('operation accounting survives failure, nested work and repeated release', async () => {
  const tracker = new OperationTracker(),
    release = tracker.enter();
  await assert.rejects(
    tracker.run(async () => {
      assert.equal(tracker.active, 2);
      throw new Error('operation failed');
    }),
    /operation failed/,
  );
  assert.equal(tracker.active, 1);
  release();
  release();
  assert.equal(tracker.active, 0);
});

test('request disconnect cancels work and releasing the scope removes both listeners', () => {
  const req = Object.assign(new EventEmitter(), { aborted: false }) as unknown as IncomingMessage;
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableFinished: false,
  }) as unknown as ServerResponse;
  const scope = requestScope(req, res);
  res.emit('close');
  assert.equal(scope.signal.aborted, true);
  scope.dispose();
  scope.dispose();
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
});

test('a failed HTTP bind rejects startup and releases temporary event listeners', async () => {
  const occupied = createServer(),
    candidate = createServer();
  const initialListening = candidate.listeners('listening');
  try {
    await listenHttpServer(occupied, 0, '127.0.0.1');
    const port = (occupied.address() as { port: number }).port;
    await assert.rejects(listenHttpServer(candidate, port, '127.0.0.1'), { code: 'EADDRINUSE' });
    assert.equal(candidate.listenerCount('error'), 0);
    assert.deepEqual(candidate.listeners('listening'), initialListening);
    assert.equal(candidate.listening, false);
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    candidate.close();
  }
});
