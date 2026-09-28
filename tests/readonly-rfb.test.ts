import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ReadOnlyRfb } from '../server/readonly-rfb.ts';

const version = Buffer.from('RFB 003.008\n');
const setup = Buffer.concat([version, Buffer.from([1, 1])]);
const framebufferRequest = Buffer.from([3, 0, 0, 0, 0, 0, 0, 0, 64, 64]);

test('read-only RFB passes fragmented setup and framebuffer requests unchanged', async () => {
  const filter = new ReadOnlyRfb();
  const output: Buffer[] = [];
  filter.on('data', (chunk: Buffer) => output.push(chunk));
  const pixelFormat = Buffer.alloc(20);
  const encodings = Buffer.from([2, 0, 0, 1, 0, 0, 0, 0]);
  const continuous = Buffer.from([150, 1, 0, 0, 0, 0, 0, 0, 64, 64]);
  const fence = Buffer.from([248, 0, 0, 0, 0, 0, 0, 1, 2, 65, 66]);
  const expected = Buffer.concat([setup, pixelFormat, encodings, framebufferRequest, continuous, fence]);
  filter.write(expected.subarray(0, 4));
  filter.write(expected.subarray(4, 13));
  filter.write(expected.subarray(13, 25));
  filter.end(expected.subarray(25));
  await once(filter, 'end');
  assert.deepEqual(Buffer.concat(output), expected);
});

test('read-only RFB removes the clipboard pseudo-encoding before it reaches the guest', async () => {
  const filter = new ReadOnlyRfb();
  const output: Buffer[] = [];
  filter.on('data', (chunk: Buffer) => output.push(chunk));
  const encodings = Buffer.from([2, 0, 0, 2, 0, 0, 0, 0, 0xc0, 0xa1, 0xe5, 0xce]);
  filter.end(Buffer.concat([setup, encodings]));
  await once(filter, 'end');
  assert.deepEqual(Buffer.concat(output), Buffer.concat([
    setup, Buffer.from([2, 0, 0, 1, 0, 0, 0, 0]),
  ]));
});

for (const [name, input] of [
  ['keyboard', Buffer.from([4, 1, 0, 0, 0, 0, 0, 65])],
  ['pointer', Buffer.from([5, 1, 0, 10, 0, 20])],
  ['clipboard', Buffer.from([6, 0, 0, 0, 0, 0, 0, 1, 65])],
  ['desktop resize', Buffer.from([251, 0, 0, 0])],
  ['unknown extension', Buffer.from([255, 0])],
  ['fence request', Buffer.from([248, 0, 0, 0, 128, 0, 0, 0, 0])],
] as const)
  test(`read-only RFB rejects ${name} before forwarding any input`, async () => {
    const filter = new ReadOnlyRfb();
    const output: Buffer[] = [];
    filter.on('data', (chunk: Buffer) => output.push(chunk));
    filter.write(setup);
    const error = new Promise<Error>((resolve) => filter.once('error', resolve));
    filter.write(input);
    assert.match((await error).message, /forbidden|fence/);
    assert.deepEqual(Buffer.concat(output), setup);
  });

test('read-only RFB rejects security negotiation and oversized encoding requests', async () => {
  const security = new ReadOnlyRfb();
  security.write(version);
  const denied = new Promise<Error>((resolve) => security.once('error', resolve));
  security.write(Buffer.from([2]));
  assert.match((await denied).message, /no-auth/);

  const encoding = new ReadOnlyRfb();
  encoding.write(setup);
  const tooMany = new Promise<Error>((resolve) => encoding.once('error', resolve));
  encoding.write(Buffer.from([2, 0, 1, 1]));
  assert.match((await tooMany).message, /encodings/);
});
