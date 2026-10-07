/**
 * 模块职责：回归验证模块，围绕 `core` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `core`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: configuration rejects traversal, command injection, invalid limits and duplicate ports; host, origin, fetch-site and token gate reject rebinding and cross-origin requests.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { createSchema, checkedId, guestPath } from '../server/model.ts';
import { seedIso, createSshKey, userData } from '../server/seed.ts';
import { sameOrigin, tokenMatches } from '../server/security.ts';
import { qmp } from '../server/qmp.ts';
import ssh2 from 'ssh2';
const { utils } = ssh2;

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: configuration rejects traversal, command injection, invalid limits and duplicate ports
 * 协作入口 / Collaborators: `assert.equal`, `createSchema.safeParse`, `assert.deepEqual`, `createSchema.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(createSchema.safeParse({ name }).success, false)`; `assert.equal(createSchema.safeParse({ name: 'alpine', ...patch }).success, false)`.
 */
test('configuration rejects traversal, command injection, invalid limits and duplicate ports', () => {
  for (const name of ['../disk', 'a;rm', 'a b', '-accel', 'C:\\disk', 'A'])
    assert.equal(createSchema.safeParse({ name }).success, false);
  for (const patch of [
    { cpus: 0 },
    { cpus: 9 },
    { cpus: 1.5 },
    { memoryMiB: 128 },
    { memoryMiB: Infinity },
    { diskGiB: 1 },
    { accelerator: 'shell' },
    { executable: 'powershell' },
    {
      forwards: [
        { host: 8080, guest: 80 },
        { host: 8080, guest: 22 },
      ],
    },
  ])
    assert.equal(createSchema.safeParse({ name: 'alpine', ...patch }).success, false);
  assert.deepEqual(createSchema.parse({ name: 'alpine' }), {
    name: 'alpine',
    cpus: 2,
    memoryMiB: 512,
    diskGiB: 8,
    accelerator: 'auto',
    forwards: [],
  });
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: host, origin, fetch-site and token gate reject rebinding and cross-origin requests
 * 协作入口 / Collaborators: `assert.equal`, `sameOrigin`, `tokenMatches`.
 * 检查边界 / Checked boundaries: `assert.equal(sameOrigin({ host: '127.0.0.1:7337', origin: 'http://127.0.0.1:7337' }, 7337), true)`; `assert.equal(sameOrigin({ host: 'localhost:7337' }, 7337), true)`.
 */
test('host, origin, fetch-site and token gate reject rebinding and cross-origin requests', () => {
  assert.equal(sameOrigin({ host: '127.0.0.1:7337', origin: 'http://127.0.0.1:7337' }, 7337), true);
  assert.equal(sameOrigin({ host: 'localhost:7337' }, 7337), true);
  for (const headers of [
    { host: 'evil.example:7337' },
    { host: '127.0.0.1:7337', origin: 'http://evil.example' },
    { host: '127.0.0.1:7337', origin: 'null' },
    { host: '127.0.0.1:7337', 'sec-fetch-site': 'cross-site' },
    { host: '127.0.0.1:7338' },
  ])
    assert.equal(sameOrigin(headers, 7337), false);
  assert.equal(tokenMatches('abc', 'abc'), true);
  for (const input of [undefined, ['abc'], 'ab', 'abd']) assert.equal(tokenMatches(input, 'abc'), false);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: managed disk paths accept only UUIDs and guest paths cannot contain protocol control bytes
 * 协作入口 / Collaborators: `assert.equal`, `checkedId`, `assert.throws`, `guestPath`.
 * 检查边界 / Checked boundaries: `assert.equal(checkedId('92688083-ff25-d98f-4419-4356f9ec93df'), '92688083-ff25-d98f-4419-4356f9ec93df')`; `assert.throws(() => checkedId(id))`.
 */
test('managed disk paths accept only UUIDs and guest paths cannot contain protocol control bytes', () => {
  assert.equal(checkedId('92688083-ff25-d98f-4419-4356f9ec93df'), '92688083-ff25-d98f-4419-4356f9ec93df');
  for (const id of ['../../', '92688083----------------------------', 'C:\\', ''])
    assert.throws(() => checkedId(id));
  for (const path of ['relative', '/tmp/\0file', '/tmp/\nfile', null]) assert.throws(() => guestPath(path));
  assert.equal(guestPath('/workspace/中文.txt'), '/workspace/中文.txt');
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: NoCloud ISO directory extents point to the actual UTF-8 bootstrap files
 * 状态影响 / State effects: `recovered[name.split('.;')[0].toLowerCase()]`, `at`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `seedIso`, `image.subarray`, `assert.equal`, `pvd.toString`.
 * 检查边界 / Checked boundaries: `assert.equal(pvd.toString('ascii', 1, 6), 'CD001')`; `assert.equal(pvd.toString('ascii', 40, 72).trim(), 'CIDATA')`.
 */
test('NoCloud ISO directory extents point to the actual UTF-8 bootstrap files', () => {
  const files = { 'meta-data': 'instance-id: test\n', 'user-data': '#!/bin/sh\nprintf 你好\n' };
  const image = seedIso(files),
    pvd = image.subarray(16 * 2048);
  assert.equal(pvd.toString('ascii', 1, 6), 'CD001');
  assert.equal(pvd.toString('ascii', 40, 72).trim(), 'CIDATA');
  assert.equal(pvd.readUInt32LE(80) * 2048, image.length);
  let at = 20 * 2048;
  const recovered: Record<string, string> = {};
  while (image[at]) {
    const length = image[at];
    const name = image.toString('ascii', at + 33, at + 33 + image[at + 32]);
    if (name.includes(';1'))
      recovered[name.split('.;')[0].toLowerCase()] = image.toString(
        'utf8',
        image.readUInt32LE(at + 2) * 2048,
        image.readUInt32LE(at + 2) * 2048 + image.readUInt32LE(at + 10),
      );
    at += length;
  }
  assert.deepEqual(recovered, files);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: per-instance SSH keys match and bootstrap never enables password login
 * 协作入口 / Collaborators: `createSshKey`, `utils.parseKey`, `assert.ok`, `Array.isArray`.
 * 检查边界 / Checked boundaries: `assert.ok(!(privateKey instanceof Error))`; `assert.ok(!(publicKey instanceof Error))`.
 */
test('per-instance SSH keys match and bootstrap never enables password login', () => {
  const pair = createSshKey();
  const privateKey = utils.parseKey(pair.privateText);
  const publicKey = utils.parseKey(pair.publicText);
  assert.ok(!(privateKey instanceof Error));
  assert.ok(!(publicKey instanceof Error));
  if (
    !(privateKey instanceof Error) &&
    !(publicKey instanceof Error) &&
    !Array.isArray(privateKey) &&
    !Array.isArray(publicKey)
  )
    assert.deepEqual(privateKey.getPublicSSH(), publicKey.getPublicSSH());
  const script = userData('alpine', pair.publicText);
  assert.match(script, /PasswordAuthentication no/);
  assert.match(script, /FAST_STARTUP=yes/);
  assert.match(script, /rc-update del tiny-cloud-main default/);
  assert.ok(!script.includes(pair.privateText));
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: QMP handles fragmented greeting, capabilities, async events and command errors
 * 协作入口 / Collaborators: `createServer`, `server.listen`, `once`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(qmp((server.address() as { port: number }).port, 'invalid'), /not supported/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('QMP handles fragmented greeting, capabilities, async events and command errors', async () => {
  const server = createServer(/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: socket。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: QMP handles fragmented greeting, capabilities, async events and command errors
   * 协作入口 / Collaborators: `socket.write`, `setImmediate`, `socket.on`.
   */
  (socket) => {
    socket.write('{"QMP":');
    setImmediate(() => socket.write('{"version":{}}}\r\n'));
    let input = '';
    socket.on('data', /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: data。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: QMP handles fragmented greeting, capabilities, async events and command errors
     * 状态影响 / State effects: `input`, `at`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `input.indexOf`, `JSON.parse`, `input.slice`, `socket.write`.
     */
    (data) => {
      input += data;
      let at;
      while ((at = input.indexOf('\n')) >= 0) {
        const msg = JSON.parse(input.slice(0, at));
        input = input.slice(at + 1);
        socket.write(JSON.stringify({ event: 'RESUME' }) + '\n');
        socket.write(
          JSON.stringify(
            msg.execute === 'qmp_capabilities'
              ? { return: {}, id: msg.id }
              : { error: { desc: 'not supported' }, id: msg.id },
          ) + '\n',
        );
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await assert.rejects(qmp((server.address() as { port: number }).port, 'invalid'), /not supported/);
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
  }
});

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: t: TestContext; connected: (socket: Socket) => void。
 * 结果：返回分支计算值（`(server.address() as { port: number }).port`），以 Promise 交付。
 * Result: Return the branch-computed value (`(server.address() as { port: number }).port`) through a Promise.
 * 协作入口 / Collaborators: `createServer`, `server.listen`, `once`, `t.after`.
 */
async function qmpPeer(t: TestContext, connected: /**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: socket: Socket。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    connected(socket);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return (server.address() as { port: number }).port;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: QMP rejects malformed JSON values without throwing outside its promise
 * 协作入口 / Collaborators: `qmpPeer`, `assert.rejects`, `qmp`.
 * 检查边界 / Checked boundaries: `assert.rejects(qmp(port, 'query-status'), /Invalid QMP response/)`.
 */
test('QMP rejects malformed JSON values without throwing outside its promise', async (t) => {
  const port = await qmpPeer(t, (socket) => socket.write('null\n'));
  await assert.rejects(qmp(port, 'query-status'), /Invalid QMP response/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: QMP capability errors stop negotiation before sending the requested command
 * 协作入口 / Collaborators: `qmpPeer`, `assert.rejects`, `qmp`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(qmp(port, 'query-status'), /capabilities denied/)`; `assert.deepEqual(received, ['qmp_capabilities'])`.
 */
test('QMP capability errors stop negotiation before sending the requested command', async (t) => {
  const received: string[] = [];
  const port = await qmpPeer(t, (socket) => {
    socket.write('{"QMP":{"version":{}}}\n');
    socket.on('data', (data) => {
      const request = JSON.parse(data.toString());
      received.push(request.execute);
      socket.write(JSON.stringify({ error: { desc: 'capabilities denied' }, id: request.id }) + '\n');
    });
  });
  await assert.rejects(qmp(port, 'query-status'), /capabilities denied/);
  assert.deepEqual(received, ['qmp_capabilities']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: QMP reports a graceful disconnect immediately instead of waiting for timeout
 * 协作入口 / Collaborators: `qmpPeer`, `performance.now`, `assert.rejects`, `qmp`.
 * 检查边界 / Checked boundaries: `assert.rejects(qmp(port, 'query-status'), /QMP closed/)`; `assert.ok(performance.now() - began < 1000)`.
 */
test('QMP reports a graceful disconnect immediately instead of waiting for timeout', async (t) => {
  const port = await qmpPeer(t, (socket) => socket.end());
  const began = performance.now();
  await assert.rejects(qmp(port, 'query-status'), /QMP closed/);
  assert.ok(performance.now() - began < 1000);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: QMP preserves multibyte text split across TCP reads
 * 协作入口 / Collaborators: `qmpPeer`, `assert.equal`, `qmp`.
 * 检查边界 / Checked boundaries: `assert.equal(await qmp(port, 'human-monitor-command'), '你好')`.
 */
test('QMP preserves multibyte text split across TCP reads', async (t) => {
  const port = await qmpPeer(t, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: socket。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: QMP preserves multibyte text split across TCP reads
   * 协作入口 / Collaborators: `socket.write`, `socket.on`.
   */
  (socket) => {
    socket.write('{"QMP":{"version":{}}}\n');
    socket.on('data', (data) => {
      const request = JSON.parse(data.toString());
      if (request.id === 'hello') socket.write('{"return":{},"id":"hello"}\n');
      else {
        const response = Buffer.from('{"return":"你好","id":"command"}\n');
        const split = response.indexOf(Buffer.from('你')) + 1;
        socket.write(response.subarray(0, split));
        setTimeout(() => socket.write(response.subarray(split)), 20);
      }
    });
  });
  assert.equal(await qmp(port, 'human-monitor-command'), '你好');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: QMP retries a refused connection before any command was sent
 * 协作入口 / Collaborators: `createServer`, `reservation.listen`, `once`, `reservation.address`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await answer, { running: true })`; `assert.equal(commands, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('QMP retries a refused connection before any command was sent', async (t) => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  let commands = 0;
  const sockets = new Set<Socket>();
  const server = createServer(/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: socket。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: QMP retries a refused connection before any command was sent
   * 协作入口 / Collaborators: `sockets.add`, `socket.on`, `socket.write`.
   */
  (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('{"QMP":{"version":{}}}\n');
    socket.on('data', (data) => {
      const request = JSON.parse(data.toString());
      if (request.id === 'hello') socket.write('{"return":{},"id":"hello"}\n');
      else {
        commands++;
        socket.write('{"return":{"running":true},"id":"command"}\n');
      }
    });
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const answer = qmp(port, 'query-status', undefined, 2000);
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  assert.deepEqual(await answer, { running: true });
  assert.equal(commands, 1);
});
