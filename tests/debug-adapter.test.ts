import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Duplex } from 'node:stream';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { DapTransport } from '../server/dap-transport.ts';
import { DebugAdapter } from '../server/debug-adapter.ts';

function channel() {
  const sent: Buffer[] = [];
  const stream = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, callback) { sent.push(Buffer.from(chunk)); callback(); },
  });
  return { stream, sent };
}
function frame(value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}
function decode(buffer: Buffer) {
  return JSON.parse(buffer.subarray(buffer.indexOf('\r\n\r\n') + 4).toString('utf8'));
}

test('DAP transport assembles split frames, resolves requests and buffers early events', async () => {
  const { stream, sent } = channel();
  const transport = new DapTransport(stream);
  const request = transport.request('initialize', { clientID: 'sakura' });
  const outgoing = decode(sent[0]);
  assert.equal(outgoing.command, 'initialize');
  const response = frame({ seq: 2, type: 'response', request_seq: outgoing.seq,
    command: 'initialize', success: true, body: { supportsConfigurationDoneRequest: true } });
  stream.push(response.subarray(0, 7));
  stream.push(response.subarray(7));
  assert.deepEqual(await request, { supportsConfigurationDoneRequest: true });
  stream.push(frame({ seq: 3, type: 'event', event: 'initialized', body: { ready: true } }));
  assert.deepEqual(await transport.waitFor('initialized'), { ready: true });
  transport.close();
  await assert.rejects(transport.waitFor('stopped'), /连接已关闭/);
});

test('DAP transport rejects protocol errors and an oversized frame', async () => {
  const { stream, sent } = channel();
  const transport = new DapTransport(stream);
  const request = transport.request('stackTrace');
  stream.push(frame({ seq: 2, type: 'response', request_seq: decode(sent[0]).seq,
    command: 'stackTrace', success: false, message: 'invalid frame' }));
  await assert.rejects(request, /invalid frame/);
  const waiting = transport.waitFor('stopped');
  stream.push(Buffer.from('Content-Length: 4194305\r\n\r\n'));
  await assert.rejects(waiting, /响应长度无效/);
});

test('debug sessions reject concurrent starts and paths outside the current project', async () => {
  let release!: (value: { directory: string }) => void;
  const pending = new Promise<{ directory: string }>((resolve) => { release = resolve; });
  let first = true;
  const workspaces = { config: async () => first ? (first = false, pending) : { directory: '/workspace/app' } };
  const machines = { exec: async () => ({ code: 1, stdout: '', stderr: '' }) };
  const debuggerService = new DebugAdapter(machines as unknown as Machines, workspaces as unknown as Workspaces);
  const starting = debuggerService.start('vm', { path: '/workspace/app/main.py', breakpoints: [2] });
  await assert.rejects(debuggerService.start('vm', { path: '/workspace/app/main.py', breakpoints: [] }), /正在启动/);
  release({ directory: '/workspace/app' });
  await assert.rejects(starting, /请先保存/);
  await assert.rejects(debuggerService.start('vm', { path: '/workspace/other/main.py', breakpoints: [] }), /当前项目/);
  await assert.rejects(debuggerService.start('vm', { path: '/workspace/app/main.js', breakpoints: [] }), /Python/);
  await assert.rejects(debuggerService.start('vm', { path: '/workspace/app/main.py', breakpoints: [0] }), /断点行号/);
});
