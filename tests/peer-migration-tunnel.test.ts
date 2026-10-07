/**
 * 模块职责：回归验证模块，围绕 `peer-migration-tunnel` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `peer-migration-tunnel`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: migration streams use pinned peer TLS, session authority and revocable local forwards.
 */
const peerHandlers = new WeakMap<InstanceType<typeof HostPeers>, import('../server/host-peers.ts').HostPeerDependencies>();
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { HostPeers } from '../server/host-peers.ts';
import { createSshKey, seedIso } from '../server/seed.ts';

/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`({ platform: process.platform, arch: process.arch, cpus: 4, memoryTotal: 8 * 102…`），以 Promise 交付。
 * Result: Return the branch-computed value (`({ platform: process.platform, arch: process.arch, cpus: 4, memoryTotal: 8 * 102…`) through a Promise.
 */
const status = async () => ({ platform: process.platform, arch: process.arch,
  cpus: 4, memoryTotal: 8 * 1024 ** 3, memoryFree: 4 * 1024 ** 3,
  load: [0, 0, 0], vmCount: 0, runningVms: 0 });

/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: server: Server。
 * 结果：返回分支计算值（`address.port`），以 Promise 交付。
 * Result: Return the branch-computed value (`address.port`) through a Promise.
 * 失败 / Failure: `new Error('No test port')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `server.address`.
 */
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  return address.port;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: migration streams use pinned peer TLS, session authority and revocable local forwards
 * 状态影响 / State effects: `target`, `forward`, `client`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 失败 / Failure: `new Error('No pairing code')`; `new Error('Refusing unexpected test cleanup path')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `createServer`.
 * 检查边界 / Checked boundaries: `assert.rejects(source.prepareLiveTarget(outbound.id, prepare), /HTTP 403/)`; `assert.throws(() => target.registerMigrationSession(inbound.requesterId, { disk: echoPort, state: echoPort }), /权限/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('migration streams use pinned peer TLS, session authority and revocable local forwards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-peer-stream-'));
  const echo = createServer((socket) => {
    socket.on('error', () => {}); // Revoking the tunnel can reset this fixture connection.
    socket.pipe(socket);
  });
  const targetFile = join(root, 'target.json');
  const sourceFile = join(root, 'source.json');
  let target = new HostPeers(status, targetFile, 'Target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  const source = new HostPeers(status, sourceFile, 'Source', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  let forward: Awaited<ReturnType<HostPeers['openMigrationForward']>> | undefined;
  let client: Socket | undefined;
  try {
    const reserved = createServer();
    const peerPort = await listen(reserved);
    // Release the temporary reservation before starting the HTTPS listener.
    await new Promise<void>((resolve) => reserved.close(() => resolve()));
    await target.init(false);
    await target.configure({ operation: 'listener', listener: {
      enabled: true, host: '127.0.0.1', port: peerPort,
    } });
    await target.close();
    target = new HostPeers(status, targetFile, 'Target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
    await target.init(true);
    await source.init(false);
    const issued = await target.configure({ operation: 'create-code' });
    if (!('pairing' in issued) || !issued.pairing) throw new Error('No pairing code');
    await source.configure({ operation: 'connect', url: `https://127.0.0.1:${peerPort}/`,
      fingerprint: target.view().fingerprint, code: issued.pairing.value });
    const inbound = target.view().incoming[0];
    const outbound = source.view().outbound[0];
    const echoPort = await listen(echo);
    const identity = { key: createSshKey().privateText,
      seedBase64: seedIso({ 'meta-data': 'source', 'user-data': 'setup' }).toString('base64') };
    const prepare = { transferId: randomUUID(), sourceVmId: randomUUID(),
      config: { name: 'migrated' }, ...identity };
    await assert.rejects(source.prepareLiveTarget(outbound.id, prepare), /HTTP 403/);
    assert.throws(() => target.registerMigrationSession(inbound.requesterId,
      { disk: echoPort, state: echoPort }), /权限/);
    await target.configure({ operation: 'allow-import', id: inbound.id, enabled: true });
    await target.configure({ operation: 'allow-activate', id: inbound.id, enabled: true });
    const prepared = { targetVmId: randomUUID(), sessionId: randomUUID(),
      targetDiskNode: '#block23', diskPort: echoPort, statePort: echoPort };
    peerHandlers.set(target, { ...peerHandlers.get(target), liveMigrationReceiver: { /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: input。
     * 结果：返回分支计算值（`prepared`），以 Promise 交付。
     * Result: Return the branch-computed value (`prepared`) through a Promise.
     * 验证场景 / Scenario: migration streams use pinned peer TLS, session authority and revocable local forwards
     * 协作入口 / Collaborators: `assert.equal`, `assert.deepEqual`, `Buffer.from`.
     * 检查边界 / Checked boundaries: `assert.equal(input.requesterId, inbound.requesterId)`; `assert.equal(input.transferId, prepare.transferId)`.
     */
    prepare: async (input) => {
      assert.equal(input.requesterId, inbound.requesterId);
      assert.equal(input.transferId, prepare.transferId);
      assert.equal(input.key, identity.key);
      assert.deepEqual(input.seed, Buffer.from(identity.seedBase64, 'base64'));
      return prepared;
    }, /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: input。
     * 结果：返回受控对象，公开字段包括 `targetVmId, status, originStatus`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `targetVmId, status, originStatus`; the actual branch determines its shape.
     * 验证场景 / Scenario: migration streams use pinned peer TLS, session authority and revocable local forwards
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(input.requesterId, inbound.requesterId)`; `assert.equal(input.sessionId, prepared.sessionId)`.
     */
    complete: async (input) => {
      assert.equal(input.requesterId, inbound.requesterId);
      assert.equal(input.sessionId, prepared.sessionId);
      return { targetVmId: prepared.targetVmId,
        status: 'starting' as const, originStatus: 'received' as const };
    }, /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: input。
     * 结果：返回受控对象，公开字段包括 `targetVmId, aborted`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `targetVmId, aborted`; the actual branch determines its shape.
     * 验证场景 / Scenario: migration streams use pinned peer TLS, session authority and revocable local forwards
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(input.requesterId, inbound.requesterId)`; `assert.equal(input.sessionId, prepared.sessionId)`.
     */
    abort: async (input) => {
      assert.equal(input.requesterId, inbound.requesterId);
      assert.equal(input.sessionId, prepared.sessionId);
      assert.equal(input.sourceRunning, true);
      return { targetVmId: prepared.targetVmId, aborted: true as const };
    }, /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: input。
     * 结果：返回受控对象，公开字段包括 `targetVmId, status, originStatus`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `targetVmId, status, originStatus`; the actual branch determines its shape.
     * 验证场景 / Scenario: migration streams use pinned peer TLS, session authority and revocable local forwards
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(input.requesterId, inbound.requesterId)`.
     */
    status: async (input) => {
      assert.equal(input.requesterId, inbound.requesterId);
      return { targetVmId: prepared.targetVmId,
        status: 'paused' as const, originStatus: 'prepared' as const };
    } } });
    assert.deepEqual(await source.prepareLiveTarget(outbound.id, prepare), prepared);
    assert.equal((await source.inspectLiveTarget(outbound.id, {
      targetVmId: prepared.targetVmId, transferId: prepare.transferId,
    })).originStatus, 'prepared');
    assert.equal((await source.completeLiveTarget(outbound.id, {
      targetVmId: prepared.targetVmId, transferId: prepare.transferId,
      sessionId: prepared.sessionId,
    })).originStatus, 'received');
    assert.deepEqual(await source.abortLiveTarget(outbound.id, {
      targetVmId: prepared.targetVmId, transferId: prepare.transferId,
      sessionId: prepared.sessionId, sourceRunning: true,
    }), { targetVmId: prepared.targetVmId, aborted: true });
    assert.throws(() => target.registerMigrationSession(inbound.requesterId,
      { disk: 80, state: echoPort }), /端口无效/);
    const session = target.registerMigrationSession(inbound.requesterId,
      { disk: echoPort, state: echoPort, qmp: echoPort,
        targetDiskNode: 'sakura-disk' });
    await assert.rejects(source.targetMigrationQmp(outbound.id, session,
      'system_reset'), /Invalid option|invalid_value|Invalid input/i);
    await assert.rejects(source.targetMigrationQmp(outbound.id, session,
      'migrate-incoming', { uri: `tcp:0.0.0.0:${echoPort}`, 'exit-on-error': false }),
    /HTTP 400/);
    forward = await source.openMigrationForward(outbound.id, session, 'disk');
    client = createConnection({ host: '127.0.0.1', port: forward.port });
    client.on('error', () => {});
    await once(client, 'connect', { signal: AbortSignal.timeout(10_000) });
    const received = once(client, 'data', { signal: AbortSignal.timeout(10_000) });
    client.write('verified migration bytes');
    assert.equal((await received)[0].toString(), 'verified migration bytes');
    // Revocation may close with EOF or ECONNRESET; both must finish with close.
    const closed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Revoked migration stream did not close')), 10_000);
      client!.once('close', () => { clearTimeout(timer); resolve(); });
    });
    await target.configure({ operation: 'allow-activate', id: inbound.id, enabled: false });
    await closed;
    assert.throws(() => target.registerMigrationSession(inbound.requesterId,
      { disk: echoPort, state: echoPort }), /权限/);
  } finally {
    client?.destroy();
    await forward?.close();
    await source.close();
    await target.close();
    if (echo.listening) await new Promise<void>((resolve) => echo.close(() => resolve()));
    const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
    if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
        !basename(resolved).startsWith('sakura-peer-stream-'))
      throw new Error('Refusing unexpected test cleanup path');
    await rm(resolved, { recursive: true, force: true });
  }
});
