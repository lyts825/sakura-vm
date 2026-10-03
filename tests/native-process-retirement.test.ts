import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { runViaNativeHost } from '../.vendor/posixloom/dist/src/core/process/native.js';
import {
  encodeNativeFrame,
  NATIVE_MAX_FRAME_BYTES,
} from '../.vendor/posixloom/dist/src/core/process/protocol.js';

for (const receipt of [false, true])
  test(`native cancellation waits for close and ${receipt ? 'accepts' : 'requires'} a retirement receipt`, async (context) => {
    let kills = 0;
    const child = Object.assign(new EventEmitter(), {
      pid: 1234,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill() {
        kills++;
        return true;
      },
    });
    context.mock.method(childProcess, 'spawn', () => child);
    syncBuiltinESMExports();
    context.after(() => {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const abort = new AbortController();
    let completed = false;
    const result = runViaNativeHost({
      hostPath: 'fixture',
      program: 'fixture',
      args: [],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      cancelGraceMs: 1,
      signal: abort.signal,
    });
    void result.then(() => {
      completed = true;
    });
    const frame = (data: object) => child.stdout.write(encodeNativeFrame({ protocolVersion: 1, ...data }));
    frame({ type: 'hello', maxFrameBytes: NATIVE_MAX_FRAME_BYTES });
    frame({ type: 'started', pid: 4321 });
    abort.abort();
    if (receipt) frame({ type: 'exit', outcome: 'cancelled', code: 130 });
    await delay(10);
    assert.ok(kills >= 1);
    assert.equal(completed, false, 'kill/terminal frame is insufficient without host close');
    child.emit('close', 0, null);
    assert.deepEqual(
      (await result).outcome,
      receipt ? { kind: 'cancelled' } : { kind: 'crashed', errorCode: 'NATIVE_HOST_CLEANUP_UNCONFIRMED' },
    );
  });

test('native spawn failure waits for close without inventing a live child tree', async (context) => {
  const child = Object.assign(new EventEmitter(), {
    pid: undefined,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill() {
      return false;
    },
  });
  context.mock.method(childProcess, 'spawn', () => child);
  syncBuiltinESMExports();
  context.after(() => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });
  let completed = false;
  const result = runViaNativeHost({
    hostPath: 'fixture',
    program: 'fixture',
    args: [],
    cwd: process.cwd(),
    env: {},
    timeoutMs: 5000,
    maxOutputBytes: 1024,
  });
  void result.then(() => {
    completed = true;
  });
  child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
  await delay(0);
  assert.equal(completed, false);
  child.emit('close', -1, null);
  assert.deepEqual((await result).outcome, { kind: 'spawn-failed', errorCode: 'ENOENT' });
});
