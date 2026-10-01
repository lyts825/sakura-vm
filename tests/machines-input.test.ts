import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Machines } from '../server/machines.ts';
import { AppError } from '../server/model.ts';

class Channel extends EventEmitter {
  stderr = new EventEmitter();
  inputs: Buffer[] = [];
  closes = 0;
  onInput?: () => void;
  end(input: Buffer) { this.inputs.push(Buffer.from(input)); this.onInput?.(); return this; }
  close() { ++this.closes; this.emit('close', -1); }
}

function fixture() {
  const channel = new Channel(), client = new EventEmitter();
  const calls: { command: string; options?: unknown }[] = [];
  let connects = 0, ends = 0, destroys = 0, complete: ((error: Error | null, stream?: Channel) => void) | undefined;
  Object.assign(client, {
    exec: (command: string, options: unknown, callback?: typeof complete) => {
      calls.push({ command, options: callback ? options : undefined });
      complete = callback || options as typeof complete;
    },
    end: () => { ++ends; },
    destroy: () => { ++destroys; client.emit('close'); },
  });
  const machine = Object.create(Machines.prototype) as Machines;
  machine.connect = async () => { ++connects; return client as any; };
  const ready = async () => {
    await Promise.resolve(); await Promise.resolve();
    assert.ok(complete, 'command channel was requested');
    complete(null, channel);
  };
  return { machine, channel, client, calls, ready,
    rejectOpen: async (error: Error) => { await Promise.resolve(); await Promise.resolve(); complete!(error); },
    counts: () => ({ connects, ends, destroys }) };
}

test('bounded SSH input sends exact binary bytes and EOF outside the command argv', async () => {
  const f = fixture(), payload = Buffer.from('private\0文本\n$(unchanged)', 'utf8');
  const operation = f.machine.execInput('owned', '/fixed/helper --run fixed-id', payload);
  await f.ready();
  assert.deepEqual(f.channel.inputs, [payload]);
  assert.deepEqual(f.calls, [{ command: '/fixed/helper --run fixed-id', options: undefined }]);
  f.channel.emit('data', Buffer.from('result'));
  f.channel.stderr.emit('data', Buffer.from('warning'));
  f.channel.emit('close', 7);
  assert.deepEqual(await operation, { stdout: 'result', stderr: 'warning', code: 7 });
  assert.deepEqual(f.counts(), { connects: 1, ends: 1, destroys: 0 });
});

test('input is captured before a delayed connection and explicitly empty input still sends EOF', async () => {
  const f = fixture(), payload = Buffer.from('original');
  const operation = f.machine.execInput('owned', '/fixed/helper', payload);
  payload.fill(0);
  await f.ready(); f.channel.emit('close', 0); await operation;
  assert.equal(f.channel.inputs[0].toString(), 'original');
  const empty = fixture(), pending = empty.machine.execInput('owned', '/fixed/helper', Buffer.alloc(0));
  await empty.ready(); empty.channel.emit('close', 0); await pending;
  assert.deepEqual(empty.channel.inputs, [Buffer.alloc(0)]);
});

test('ordinary exec keeps stdin open and preserves agent forwarding and split UTF-8 output', async () => {
  const f = fixture(), seen: string[] = [];
  const operation = f.machine.exec('owned', 'ordinary command', 30000, undefined, text => seen.push(text), 'owned-agent');
  await f.ready();
  assert.deepEqual(f.calls[0].options, { agentForward: true });
  assert.equal(f.channel.inputs.length, 0);
  const bytes = Buffer.from('中文');
  f.channel.emit('data', bytes.subarray(0, 2)); f.channel.emit('data', bytes.subarray(2));
  f.channel.stderr.emit('data', Buffer.from('err')); f.channel.emit('close', 0);
  assert.deepEqual(await operation, { stdout: '中文', stderr: 'err', code: 0 });
  assert.equal(seen.join(''), '中文err');
});

test('invalid or oversized input is rejected before connecting; the exact limit is accepted', async () => {
  const invalid = fixture();
  for (const input of [Buffer.alloc(128 * 1024 + 1), 'not a Buffer'])
    await assert.rejects(invalid.machine.execInput('owned', '/fixed/helper', input as Buffer),
      error => error instanceof AppError && error.status === 413 && error.code === 'GUEST_INPUT_INVALID');
  assert.equal(invalid.counts().connects, 0);
  const full = fixture(), operation = full.machine.execInput('owned', '/fixed/helper', Buffer.alloc(128 * 1024, 0x61));
  await full.ready(); full.channel.emit('close', 0); await operation;
  assert.equal(full.channel.inputs[0].length, 128 * 1024);
});

test('cancellation before channel creation sends no payload and closes a late channel', async () => {
  const f = fixture(), controller = new AbortController();
  const operation = f.machine.execInput('owned', '/fixed/helper', Buffer.from('private'), 30000, controller.signal);
  const rejected = assert.rejects(operation, error => error instanceof AppError && error.status === 409);
  await Promise.resolve(); await Promise.resolve(); controller.abort(); await rejected;
  await f.ready();
  assert.equal(f.channel.inputs.length, 0); assert.equal(f.channel.closes, 1);
  assert.equal(f.counts().destroys, 1); assert.equal(f.counts().ends, 1);
});

test('cancellation during input destroys the connection and ignores late output', async () => {
  const f = fixture(), controller = new AbortController();
  f.channel.onInput = () => controller.abort();
  const operation = f.machine.execInput('owned', '/fixed/helper', Buffer.from('private'), 30000, controller.signal);
  const rejected = assert.rejects(operation, error => error instanceof AppError && error.status === 409);
  await f.ready(); await rejected;
  f.channel.emit('data', Buffer.from('late')); f.channel.emit('close', 0);
  assert.equal(f.counts().destroys, 1); assert.equal(f.client.listenerCount('close'), 0);
});

test('input transport timeout destroys the connection', async () => {
  const f = fixture(), operation = f.machine.execInput('owned', '/fixed/helper', Buffer.from('private'), 25);
  const rejected = assert.rejects(operation, error => error instanceof AppError && error.status === 408);
  await f.ready(); await rejected;
  assert.equal(f.counts().destroys, 1); assert.equal(f.counts().ends, 1);
});

test('broken pipe and synchronous input failure remain errors and close the connection', async () => {
  for (const synchronous of [false, true]) {
    const f = fixture();
    f.channel.onInput = () => {
      if (synchronous) throw new Error('input pipe closed');
      f.channel.emit('error', Object.assign(new Error('input pipe closed'), { code: 'EPIPE' }));
    };
    const operation = f.machine.execInput('owned', '/fixed/helper', Buffer.from('private'));
    const rejected = assert.rejects(operation, /input pipe closed/);
    await f.ready(); await rejected;
    assert.equal(f.counts().ends, 1);
    assert.equal(f.channel.closes, synchronous ? 1 : 0);
  }
});

test('early command failure and channel-open failure preserve the actual failure', async () => {
  const early = fixture(), operation = early.machine.execInput('owned', '/fixed/helper', Buffer.from('private'));
  await early.ready(); early.channel.emit('close', 126);
  assert.equal((await operation).code, 126);
  const failed = fixture(), opening = failed.machine.execInput('owned', '/fixed/helper', Buffer.from('private'));
  const rejected = assert.rejects(opening, /open refused/);
  await failed.rejectOpen(new Error('open refused')); await rejected;
  assert.equal(failed.channel.inputs.length, 0); assert.equal(failed.counts().ends, 1);
});

test('output budget remains enforced for commands carrying input', async () => {
  const f = fixture(), operation = f.machine.execInput('owned', '/fixed/helper', Buffer.from('private'));
  const rejected = assert.rejects(operation, /输出超过 1 MiB/);
  await f.ready(); f.channel.emit('data', Buffer.alloc(1024 * 1024 + 1)); await rejected;
  assert.equal(f.channel.closes, 1); assert.equal(f.counts().ends, 1);
});
