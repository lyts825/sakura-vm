import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Features } from '../server/features.ts';
import type { Machines } from '../server/machines.ts';

function fixture() {
  const machines = Object.assign(new EventEmitter(), {
    records: new Map(),
    live: new Map(),
    get: () => ({ name: 'vm' }),
    state: () => 'running',
  }) as unknown as Machines;
  const features = new Features(machines);
  const req = Object.assign(new EventEmitter(), { method: 'POST', headers: {} }) as IncomingMessage;
  const res = Object.assign(new EventEmitter(), {
    writableFinished: false,
    writeHead: () => {},
    end() {
      this.writableFinished = true;
    },
  }) as unknown as ServerResponse;
  return { features, req, res };
}

test('disconnect cancels an active import and permits a new import after cleanup', async () => {
  const { features, req, res } = fixture();
  let signal: AbortSignal | undefined;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  features.bundles.import = async (_name, _source, currentSignal) => {
    signal = currentSignal;
    started();
    await new Promise<void>((resolve) => {
      currentSignal?.addEventListener('abort', () => resolve(), { once: true });
    });
    currentSignal?.throwIfAborted();
    throw new Error('Expected cancellation');
  };
  const pending = features.route(
    req,
    res,
    new URL('http://localhost/api/import?name=example'),
    async () => ({}),
  );
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await began;
  res.emit('close');
  assert.equal(signal?.aborted, true);
  await rejected;
  assert.equal(res.listenerCount('close'), 0);
  features.bundles.import = async () => ({ id: 'new-vm' }) as any;
  assert.equal(
    await features.route(req, res, new URL('http://localhost/api/import?name=retry'), async () => ({})),
    true,
  );
  await features.close();
});

test('shutdown waits for request cleanup and rejects new feature operations', async () => {
  const { features, req, res } = fixture();
  let release!: () => void;
  let started!: () => void;
  let signal: AbortSignal | undefined;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  features.bundles.clone = async (_id, _name, _snapshot, currentSignal) => {
    signal = currentSignal;
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    currentSignal?.throwIfAborted();
    return {} as any;
  };
  const pending = features.route(req, res, new URL('http://localhost/api/vms/vm/clone'), async () => ({
    name: 'copy',
  }));
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await began;
  let finished = false;
  const closing = features.close().then(() => {
    finished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signal?.aborted, true);
  assert.equal(finished, false);
  await assert.rejects(
    features.route(req, res, new URL('http://localhost/api/images'), async () => ({})),
    /关闭/,
  );
  release();
  await rejected;
  await closing;
  assert.equal(finished, true);
});

test('shutdown also waits for in-flight read operations before releasing the runtime', async () => {
  const { features, req, res } = fixture();
  req.method = 'GET';
  let started!: () => void;
  let release!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  features.workspaces.runtime = async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { status: 'running', log: '' };
  };
  const pending = features.route(
    req,
    res,
    new URL('http://localhost/api/vms/vm/project-runtime'),
    async () => ({}),
  );
  await began;
  let finished = false;
  const closing = features.close().then(() => {
    finished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  release();
  await pending;
  await closing;
  assert.equal(res.listenerCount('close'), 0);
});
