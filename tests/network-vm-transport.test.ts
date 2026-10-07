/**
 * 模块职责：回归验证模块，围绕 `network-vm-transport` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `network-vm-transport`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: VM transport retries a dropped SSH greeting but never replays an admitted command.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import ssh2 from 'ssh2';
import { createSshKey } from '../server/seed.ts';
import type { Machines } from '../server/machines.ts';
import type { Live } from '../server/vm-state.ts';

const directory = await mkdtemp(join(tmpdir(), 'sakura-network-ssh-'));
process.env.SAKURA_DATA_DIR = directory;
const { MachineTransport } = await import('../server/vm-transport.ts');
const { networkRuntime } = await import('../server/network/index.ts');
const { vmDir } = await import('../server/paths.ts');
const key = createSshKey();
after(async () => {
  await networkRuntime.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-network-ssh-'));
  await rm(directory, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: VM transport retries a dropped SSH greeting but never replays an admitted command
 * 状态影响 / State effects: `transport`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `createServer`, `randomUUID`, `mkdir`, `vmDir`.
 * 检查边界 / Checked boundaries: `assert.equal(connections, 2)`; `assert.rejects(transport.exec(id, 'one-side-effect', 2000))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('VM transport retries a dropped SSH greeting but never replays an admitted command', async () => {
  let connections = 0, commands = 0;
  const sockets = new Set<Socket>();
  const ssh = new ssh2.Server({ hostKeys: [key.privateText] }, (peer) => {
    peer.on('error', () => {});
    peer.on('authentication', (auth) => auth.accept());
    peer.on('ready', () => peer.on('session', (accept) => {
      accept().on('exec', () => { commands++; peer.end(); });
    }));
  });
  const tcp = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    if (++connections === 1) socket.end();
    else ssh.injectSocket(socket);
  });
  await new Promise<void>((done) => tcp.listen(0, '127.0.0.1', done));
  const id = randomUUID();
  await mkdir(vmDir(id), { recursive: true });
  await writeFile(join(vmDir(id), 'id_rsa'), key.privateText);
  const live = { status: 'running', sshPort: (tcp.address() as { port: number }).port,
    abort: new AbortController(), clients: new Set() } as Live;
  let transport: InstanceType<typeof MachineTransport>;
  const host = { live: new Map([[id, live]]), /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: VM transport retries a dropped SSH greeting but never replays an admitted command
   */
  requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args: Parameters<Machines['connect']>。
     * 结果：返回分支计算值（`transport.connect(...args)`）。
     * Result: Return the branch-computed value (`transport.connect(...args)`).
     * 验证场景 / Scenario: VM transport retries a dropped SSH greeting but never replays an admitted command
     * 协作入口 / Collaborators: `transport.connect`.
     */
    connect: (...args: Parameters<Machines['connect']>) => transport.connect(...args) };
  transport = new MachineTransport(host);
  try {
    const connection = await transport.connect(id, 2000);
    assert.equal(connections, 2);
    connection.destroy();
    await assert.rejects(transport.exec(id, 'one-side-effect', 2000));
    assert.equal(commands, 1);
    assert.equal(connections, 3);
  } finally {
    for (const client of live.clients) client.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((done) => tcp.close(() => done()));
    ssh.close();
  }
});
