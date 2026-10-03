import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { HostNetworkPool } from '../server/network/host-pool.ts';

const createPool = () =>
  new HostNetworkPool({ maxWorkers: 1, connectionsPerWorker: 4, scaleAt: 4, idleMs: 60_000 });

test('pool shutdown is shared, revokes pins and refuses capabilities after release', async () => {
  const pool = createPool();
  let revoked = 0;
  const released = pool.pin(() => assert.fail('Released pin must not receive failure'));
  await released.call('lookup', { hostname: 'localhost', options: {} });
  released.release();
  await assert.rejects(released.call('lookup', { hostname: 'localhost', options: {} }), /released/);
  pool.pin(() => revoked++);
  const close = pool.close();
  assert.equal(pool.close(), close);
  await close;
  assert.equal(revoked, 1);
  assert.deepEqual(pool.snapshot(), []);
  await assert.rejects(pool.lookup('localhost', {}), /closed/);
});

test('worker preserves the complete EOF tail when the receiver starts late', async () => {
  const payload = randomBytes(4 * 1024 * 1024);
  const expected = createHash('sha256').update(payload).digest('hex');
  const peer = createServer({ allowHalfOpen: true }, (socket) => {
    socket.on('error', () => {});
    socket.end(payload);
    socket.resume();
  });
  await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
  const pool = createPool();
  try {
    const socket = await pool.dial({ host: '127.0.0.1', port: (peer.address() as { port: number }).port });
    socket.end();
    await delay(100);
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of socket) {
      hash.update(chunk);
      size += chunk.length;
    }
    assert.equal(size, payload.length);
    assert.equal(hash.digest('hex'), expected);
  } finally {
    await pool.close();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
  }
});

test('cancelled DNS lookup refuses before starting a worker', async () => {
  const pool = createPool();
  const reason = new Error('scope disposed');
  try {
    await assert.rejects(
      pool.lookup('localhost', {}, AbortSignal.abort(reason)),
      (error) => error === reason,
    );
    assert.deepEqual(pool.snapshot(), []);
  } finally {
    await pool.close();
  }
});
