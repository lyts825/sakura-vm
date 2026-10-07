/**
 * 模块职责：回归验证模块，围绕 `core-sftp` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `core-sftp`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: an upload disconnect rejects even when cleanup queues a request on the closed SFTP channel; cancellation settles SFTP work even while it is awaiting a cleanup callback.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import ssh2, { type Connection, type SFTPWrapper } from 'ssh2';
import type { Engine } from '../server/runtime.ts';
import { createSshKey } from '../server/seed.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-core-sftp-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
const key = createSshKey();
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-core-sftp-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext; ready: (ftp: SFTPWrapper, peer: Connection) => void。
 * 结果：返回受控对象，公开字段包括 `machines, id, live`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, id, live`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `server.listen`, `once`, `machines.init`, `randomUUID`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture(t: TestContext, ready: /**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: ftp: SFTPWrapper; peer: Connection。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(ftp: SFTPWrapper, peer: Connection) => void) {
  const peers = new Set<Connection>();
  const server = new ssh2.Server({ hostKeys: [key.privateText] }, (peer) => {
    peers.add(peer);
    peer.on('error', () => {});
    peer.on('close', () => peers.delete(peer));
    peer.on('authentication', (context) => context.accept());
    peer.on('ready', () =>
      peer.on('session', (accept) => {
        accept().on('sftp', (acceptSftp) => ready(acceptSftp(), peer));
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const machines = new Machines({} as Engine, fakeVmNetwork);
  await machines.init();
  const id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'sftp-test' }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  await mkdir(vmDir(id));
  await writeFile(join(vmDir(id), 'id_rsa'), key.privateText);
  const live = {
    status: 'running' as const,
    accelerator: 'tcg' as const,
    startedAt: new Date().toISOString(),
    sshPort: (server.address() as { port: number }).port,
    qmpPort: 0,
    agentPort: 0,
    serialPort: 0,
    abort: new AbortController(),
    bootAbort: new AbortController(),
    done: Promise.resolve(),
    clients: new Set<import('ssh2').Client>(),
  };
  machines.live.set(id, live);
  t.after(async () => {
    for (const client of live.clients) client.destroy();
    for (const peer of peers) peer.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { machines, id, live };
}

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: operation: Promise<unknown>。
 * 结果：返回分支计算值（`result`），以 Promise 交付。
 * Result: Return the branch-computed value (`result`) through a Promise.
 * 协作入口 / Collaborators: `Promise.race`, `operation.then`, `delay`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(result instanceof Error, `SFTP operation remained ${String(result)}`)`.
 */
async function rejectionWithin(operation: Promise<unknown>) {
  const result = await Promise.race([
    operation.then(
      () => 'resolved',
      (error: unknown) => error,
    ),
    delay(1000, 'pending', { ref: false }),
  ]);
  assert.ok(result instanceof Error, `SFTP operation remained ${String(result)}`);
  return result;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an upload disconnect rejects even when cleanup queues a request on the closed SFTP channel
 * 协作入口 / Collaborators: `fixture`, `rejectionWithin`, `machines.writeGuestFile`.
 */
test('an upload disconnect rejects even when cleanup queues a request on the closed SFTP channel', async (t) => {
  const { machines, id } = await fixture(t, (ftp, peer) => {
    ftp.on('LSTAT', (request) => ftp.status(request, 2));
    ftp.on('OPEN', (request) => ftp.handle(request, Buffer.from('file')));
    ftp.on('FSETSTAT', (request) => ftp.status(request, 0));
    ftp.on('WRITE', () => peer.end());
  });
  await rejectionWithin(machines.writeGuestFile(id, '/workspace/disconnected.txt', 'content', false));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancellation settles SFTP work even while it is awaiting a cleanup callback
 * 协作入口 / Collaborators: `fixture`, `machines.sftp`, `assert.equal`, `rejectionWithin`.
 * 检查边界 / Checked boundaries: `assert.equal((await rejectionWithin(operation)).name, 'AbortError')`.
 */
test('cancellation settles SFTP work even while it is awaiting a cleanup callback', async (t) => {
  const { machines, id } = await fixture(t, () => {});
  const abort = new AbortController();
  const operation = machines.sftp(
    id,
    async (ftp) => {
      queueMicrotask(() => abort.abort());
      try {
        await new Promise<void>((resolve, reject) =>
          ftp.lstat('/workspace/file', (error) => (error ? reject(error) : resolve())),
        );
      } finally {
        await new Promise<void>((resolve) => ftp.unlink('/workspace/temp', () => resolve()));
      }
    },
    abort.signal,
  );
  assert.equal((await rejectionWithin(operation)).name, 'AbortError');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SFTP protocol errors reject the operation without an unhandled error event
 * 协作入口 / Collaborators: `fixture`, `machines.sftp`, `rejectionWithin`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(handled, true)`; `assert.match(error.message, /malformed SFTP response/)`.
 */
test('SFTP protocol errors reject the operation without an unhandled error event', async (t) => {
  const { machines, id } = await fixture(t, () => {});
  let handled = false;
  const operation = machines.sftp(id, async (ftp) => {
    queueMicrotask(() => {
      handled = ftp.listenerCount('error') > 0;
      // Keep the regression process alive when testing the broken implementation.
      if (!handled) ftp.on('error', () => {});
      ftp.emit('error', new Error('malformed SFTP response'));
    });
    return new Promise<never>(() => {});
  });
  const error = await rejectionWithin(operation);
  assert.equal(handled, true);
  assert.match(error.message, /malformed SFTP response/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SFTP disconnect signals local work before rejecting the enclosing operation
 * 协作入口 / Collaborators: `fixture`, `machines.sftp`, `rejectionWithin`, `finishLocal`.
 * 检查边界 / Checked boundaries: `assert.equal(connectionSignal?.aborted, true)`; `assert.equal(committed, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SFTP disconnect signals local work before rejecting the enclosing operation', async (t) => {
  let disconnect!: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const { machines, id } = await fixture(t, (_ftp, peer) => {
    disconnect = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`peer.end()`）。
     * Result: Return the branch-computed value (`peer.end()`).
     * 验证场景 / Scenario: SFTP disconnect signals local work before rejecting the enclosing operation
     * 协作入口 / Collaborators: `peer.end`.
     */
    () => peer.end();
  });
  let connectionSignal: AbortSignal | undefined;
  let finishLocal!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  let cleaned = false;
  let committed = false;
  const operation = machines.sftp(id, /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: _ftp; transportSignal。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: SFTP disconnect signals local work before rejecting the enclosing operation
   * 状态影响 / State effects: `connectionSignal`, `committed`, `cleaned`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `disconnect`, `transportSignal?.throwIfAborted`.
   */
  async (_ftp, transportSignal) => {
    connectionSignal = transportSignal;
    disconnect();
    try {
      await new Promise<void>((resolve) => {
        finishLocal = resolve;
      });
      transportSignal?.throwIfAborted();
      committed = true;
    } finally {
      cleaned = true;
    }
  });
  await rejectionWithin(operation);
  finishLocal();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(connectionSignal?.aborted, true);
  assert.equal(committed, false);
  assert.equal(cleaned, true);
});
