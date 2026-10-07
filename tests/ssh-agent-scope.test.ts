/**
 * 模块职责：回归验证模块，围绕 `ssh-agent-scope` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ssh-agent-scope`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: owned BaseAgent lists and signs a real self-created Ed25519 key over its own socket; owned connection budgets and cancellation never close another owner using the same source.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import type { Duplex } from 'node:stream';
import type { Machines } from '../server/machines.ts';
import { AppError } from '../server/model.ts';
import { projectIdentitySchema } from '../server/project-identity.ts';
import { OwnedForwardAgent, SshAgentScopes, bindTaskAgent, isOwnedTaskAgent, sshAgentRecordSchema,
  type SshAgentContext } from '../server/ssh-agent-scope.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-agent-scope-unit-'));
const source = await readFile(new URL('../server/ssh-agent-broker.py', import.meta.url));
const sha256 = createHash('sha256').update(source).digest('hex');
await writeFile(join(root, 'broker.py'), source);
await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: 1, file: 'broker.py', size: source.length, sha256 }));
after(async () => {
  const canonical = await realpath(root), parent = await realpath(tmpdir());
  assert.equal(dirname(canonical), parent); assert.ok(basename(canonical).startsWith('sakura-agent-scope-unit-'));
  await rm(canonical, { recursive: true, force: true });
});
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `resource, identity, owner, sha256`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `resource, identity, owner, sha256`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `projectIdentitySchema.parse`, `identityId.replaceAll('-', '').slice`, `identityId.replaceAll`.
 */
function context(): SshAgentContext {
  const identityId = randomUUID();
  return { resource: { version: 1, kind: 'ssh-agent', leaseId: randomUUID(), brokerSha256: sha256, timeoutSeconds: 60 },
    identity: projectIdentitySchema.parse({ version: 1, phase: 'active', registryId: randomUUID(), projectId: 'default',
      identityId, revision: 1, uid: 20000, gid: 20000, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
      home: '/var/lib/sakura-project-homes/' + identityId, directory: '/workspace/owned', homeDevice: '1', homeInode: '2',
      directoryDevice: '1', directoryInode: '3', networkIsolation: 'private' }),
    owner: { kind: 'task', runId: randomUUID(), bootId: randomUUID() }, sha256: 'a'.repeat(64) };
}
/**
 * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
 * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
 * 输入 / Inputs: ctx: SshAgentContext; phase: 'preparing' | 'ready' | 'failed' | 'closed' = 'closed'。
 * 结果：返回受控对象，公开字段包括 `version, context, phase, scope, source, endpointDirectory, endpoint, broker, failure`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `version, context, phase, scope, source, endpointDirectory, endpoint, broker, failure`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`.
 */
function record(ctx: SshAgentContext, phase: 'preparing' | 'ready' | 'failed' | 'closed' = 'closed') {
  return { version: 1, context: ctx, phase, scope: { device: '1', inode: '2', controlToken: randomUUID() },
    source: null, endpointDirectory: null, endpoint: null, broker: null, failure: null };
}
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: handle: (socket: Socket) => void。
 * 结果：返回受控对象，公开字段包括 `path, done`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `path, done`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `join`, `createServer`.
 */
async function ownServer(handle?: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: socket: Socket。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
(socket: Socket) => void) {
  const path = process.platform === 'win32' ? '\\\\.\\pipe\\sakura-agent-owned-' + randomUUID() : join(root, randomUUID());
  const peers = new Set<Socket>(), server = createServer(socket => {
    peers.add(socket); socket.on('error', () => {}); socket.once('close', () => peers.delete(socket)); handle?.(socket);
  });
  await new Promise<void>(resolve => server.listen(path, resolve));
  return { path, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `socket.destroy`.
   */
  done: async () => { for (const socket of peers) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve())); } };
}
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: agent: OwnedForwardAgent。
 * 结果：返回分支计算值（`new Promise<Socket>((resolve, reject) => agent.getStream((error, stream) => erro…`）。
 * Result: Return the branch-computed value (`new Promise<Socket>((resolve, reject) => agent.getStream((error, stream) => erro…`).
 */
function agentStream(agent: OwnedForwardAgent) {
  return new Promise<Socket>((resolve, reject) => agent.getStream((error, stream) =>
    error ? reject(error) : resolve(stream as Socket)));
}
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: value: Buffer | string。
 * 结果：返回分支计算值（`Buffer.concat([header, body])`）。
 * Result: Return the branch-computed value (`Buffer.concat([header, body])`).
 * 协作入口 / Collaborators: `Buffer.from`, `Buffer.alloc`, `header.writeUInt32BE`, `Buffer.concat`.
 */
const string = (value: Buffer | string) => { const body = Buffer.from(value), header = Buffer.alloc(4);
  header.writeUInt32BE(body.length); return Buffer.concat([header, body]); };
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: body: Buffer。
 * 结果：返回分支计算值（`string(body)`）。
 * Result: Return the branch-computed value (`string(body)`).
 * 协作入口 / Collaborators: `string`.
 */
const packet = (body: Buffer) => string(body);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: owned BaseAgent lists and signs a real self-created Ed25519 key over its own socket
 * 协作入口 / Collaborators: `generateKeyPairSync`, `Buffer.from`, `publicKey.export`, `Buffer.concat`.
 * 检查边界 / Checked boundaries: `assert.equal(keys.length, 1)`; `assert.deepEqual(keys[0].getPublicSSH(), key)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('owned BaseAgent lists and signs a real self-created Ed25519 key over its own socket', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
  const key = Buffer.concat([string('ssh-ed25519'), string(raw)]);
  const server = await ownServer(/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: socket。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: owned BaseAgent lists and signs a real self-created Ed25519 key over its own socket
   * 协作入口 / Collaborators: `Buffer.alloc`, `socket.on`.
   */
  socket => {
    let pending = Buffer.alloc(0);
    socket.on('data', /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: bytes。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: owned BaseAgent lists and signs a real self-created Ed25519 key over its own socket
     * 状态影响 / State effects: `pending`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `Buffer.concat`, `pending.readUInt32BE`, `pending.subarray`, `Buffer.alloc`.
     * 检查边界 / Checked boundaries: `assert.equal(request[0], 13)`; `assert.deepEqual(read(), key)`.
     */
    bytes => {
      pending = Buffer.concat([pending, bytes]);
      if (pending.length < 4 || pending.length < pending.readUInt32BE() + 4) return;
      const request = pending.subarray(4, pending.readUInt32BE() + 4); pending = Buffer.alloc(0);
      if (request[0] === 11) socket.write(packet(Buffer.concat([Buffer.from([12, 0, 0, 0, 1]), string(key), string('unit-owned')])));
      else {
        assert.equal(request[0], 13); let offset = 1;
        /**
         * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
         * English: Read or resolve observable fixture state for business calls or subsequent assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`value`）。
         * Result: Return the branch-computed value (`value`).
         * 验证场景 / Scenario: owned BaseAgent lists and signs a real self-created Ed25519 key over its own socket
         * 状态影响 / State effects: `offset`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
         * 协作入口 / Collaborators: `request.readUInt32BE`, `request.subarray`.
         */
        const read = () => { const size = request.readUInt32BE(offset); offset += 4;
          const value = request.subarray(offset, offset + size); offset += size; return value; };
        assert.deepEqual(read(), key); const data = read();
        socket.write(packet(Buffer.concat([Buffer.from([14]), string(Buffer.concat([string('ssh-ed25519'), string(sign(null, data, privateKey))]))])));
      }
    });
  });
  const agent = new OwnedForwardAgent(server.path, new AbortController().signal);
  try {
    const keys = await new Promise<any[]>((resolve, reject) => agent.getIdentities((error, keys) => error ? reject(error) : resolve(keys!)));
    assert.equal(keys.length, 1); assert.deepEqual(keys[0].getPublicSSH(), key);
    const data = Buffer.from('only our unit-owned key signs this request');
    const signature = await new Promise<Buffer>((resolve, reject) => agent.sign(keys[0], data, {},
      (error, value) => error ? reject(error) : resolve(value!)));
    assert.equal(verify(null, data, publicKey, signature), true);
    await agent.close(); assert.equal(agent.streamCount, 0);
    await assert.rejects(agentStream(agent), /closed/);
  } finally { await agent.close(); await server.done(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: owned connection budgets and cancellation never close another owner using the same source
 * 协作入口 / Collaborators: `ownServer`, `Promise.all`, `Array.from`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(agentStream(first), /budget/)`; `assert.ok(streams.every(stream => stream.destroyed))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('owned connection budgets and cancellation never close another owner using the same source', async () => {
  const server = await ownServer(), cancel = new AbortController(), first = new OwnedForwardAgent(server.path, cancel.signal);
  const neighbor = new OwnedForwardAgent(server.path, new AbortController().signal);
  try {
    const streams = await Promise.all(Array.from({ length: 8 }, () => agentStream(first)));
    await assert.rejects(agentStream(first), /budget/); const other = await agentStream(neighbor);
    cancel.abort(); await first.close(); assert.ok(streams.every(stream => stream.destroyed));
    assert.equal(neighbor.streamCount, 1); assert.equal(other.destroyed, false);
    await assert.rejects(agentStream(first), /closed/);
  } finally { await first.close(); await neighbor.close(); await server.done(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: late actual host close is recoverable and an execution release cannot lose its unconfirmed owner
 * 状态影响 / State effects: `stream.destroy`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `ownServer`, `context`, `randomUUID`, `agentStream`.
 * 检查边界 / Checked boundaries: `assert.rejects(closing, { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal(isOwnedTaskAgent(machines, vmId, ctx.owner.runId, agent), true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('late actual host close is recoverable and an execution release cannot lose its unconfirmed owner', async t => {
  const server = await ownServer(), ctx = context(), live = {}, vmId = randomUUID();
  const agent = new OwnedForwardAgent(server.path, new AbortController().signal), stream = await agentStream(agent);
  let controls = 0;
  const machines = { live: new Map([[vmId, live]]), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
   * 验证场景 / Scenario: late actual host close is recoverable and an execution release cannot lose its unconfirmed owner
   * 协作入口 / Collaborators: `JSON.stringify`.
   */
  exec: async () => { ++controls;
    return { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true, result: { phase: 'closed', context: ctx, record: null } }) }; }
  } as unknown as Machines;
  const release = bindTaskAgent(machines, vmId, ctx, agent, live as never), scopes = new SshAgentScopes(machines);
  const destroy = stream.destroy.bind(stream); stream.destroy = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`stream`）。
   * Result: Return the branch-computed value (`stream`).
   * 验证场景 / Scenario: late actual host close is recoverable and an execution release cannot lose its unconfirmed owner
   */
  () => stream;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const closing = scopes.cleanup(vmId, ctx), failure = assert.rejects(closing, { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
    t.mock.timers.tick(5000); await failure;
    release(); assert.equal(isOwnedTaskAgent(machines, vmId, ctx.owner.runId, agent), true);
    assert.equal(controls, 0, 'no guest success can hide unconfirmed host streams');
    const closed = once(stream, 'close'); destroy(); await closed;
    await scopes.cleanup(vmId, ctx); assert.equal(controls, 1); assert.equal(agent.streamCount, 0);
    assert.equal(isOwnedTaskAgent(machines, vmId, ctx.owner.runId, agent), false);
    await assert.rejects(agentStream(agent), /closed/);
  } finally { t.mock.timers.reset(); stream.destroy = destroy; destroy(); await agent.close(); await server.done(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: assets require exact packaged manifests and are staged by private raw-hash generation over stdin
 * 协作入口 / Collaborators: `context`, `scopes.install`, `assert.equal`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.equal(commands.length, 1)`; `assert.rejects(scopes.install('owned', { ...ctx.resource, brokerSha256: 'b'.repeat(64) }, new AbortController().signal), { code: '…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('assets require exact packaged manifests and are staged by private raw-hash generation over stdin', async () => {
  const ctx = context(), commands: string[] = [];
  const machines = { /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; command: string; bytes: Buffer。
   * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
   * 验证场景 / Scenario: assets require exact packaged manifests and are staged by private raw-hash generation over stdin
   * 协作入口 / Collaborators: `commands.push`, `assert.deepEqual`, `inflateSync`, `assert.ok`.
   * 检查边界 / Checked boundaries: `assert.deepEqual(inflateSync(bytes), source)`; `assert.ok(command.includes('O_NOFOLLOW') && command.includes('O_EXCL') && command.includes('st_nlink==1'))`.
   */
  execInput: async (_id: string, command: string, bytes: Buffer) => {
    commands.push(command); assert.deepEqual(inflateSync(bytes), source);
    assert.ok(command.includes('O_NOFOLLOW') && command.includes('O_EXCL') && command.includes('st_nlink==1'));
    assert.ok(!command.includes(source.toString()) && !command.includes(source.toString('base64')));
    return { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true, sha256 }) };
  } } as unknown as Machines;
  const scopes = new SshAgentScopes(machines, { sourceDirectory: root });
  await scopes.install('owned', ctx.resource, new AbortController().signal); assert.equal(commands.length, 1);
  await assert.rejects(scopes.install('owned', { ...ctx.resource, brokerSha256: 'b'.repeat(64) }, new AbortController().signal),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  const invalid = await mkdtemp(join(root, 'invalid-'));
  await writeFile(join(invalid, 'manifest.json'), JSON.stringify({ version: 1, file: '../broker.py', size: source.length, sha256 }));
  await assert.rejects(new SshAgentScopes(machines, { sourceDirectory: invalid }).resource(60),
    { code: 'PROJECT_IDENTITY_AGENT_ASSET_INVALID' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: readonly resource replies are strict and cleanup retries the exact immutable request without installation
 * 状态影响 / State effects: `value.context`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `context`, `randomUUID`, `record`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal((await scopes.readonly(vmId, ctx)).record?.context.owner.runId, ctx.owner.runId)`; `assert.equal(attempts, 3)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('readonly resource replies are strict and cleanup retries the exact immutable request without installation', async () => {
  const ctx = context(), commands: string[] = [], live = {}, vmId = randomUUID(); let attempts = 0;
  const value = record(ctx);
  const machines = { live: new Map([[vmId, live]]), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; command: string。
   * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
   * 验证场景 / Scenario: readonly resource replies are strict and cleanup retries the exact immutable request without installation
   * 失败 / Failure: `new Error('lost cleanup connection')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `commands.push`, `command.startsWith`, `JSON.stringify`.
   */
  exec: async (_id: string, command: string) => {
    commands.push(command);
    if (command.startsWith('# SAKURA_SSH_AGENT_CLEANUP') && ++attempts < 3) throw new Error('lost cleanup connection');
    return { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true, result: { phase: value.phase, context: ctx, record: value } }) };
  } } as unknown as Machines;
  const scopes = new SshAgentScopes(machines);
  assert.equal((await scopes.readonly(vmId, ctx)).record?.context.owner.runId, ctx.owner.runId);
  await scopes.cleanup(vmId, ctx); assert.equal(attempts, 3);
  assert.ok(commands.every(command => !command.includes('SAKURA_SSH_AGENT_INSTALL') && !command.includes('SSH_AUTH_SOCK')));
  assert.equal(new Set(commands.slice(1)).size, 1, 'retries never follow another lease or generation');
  assert.equal(sshAgentRecordSchema.safeParse({ ...value, phase: 'ready' }).success, false);
  value.context = { ...ctx, sha256: 'c'.repeat(64) };
  await assert.rejects(scopes.readonly(vmId, ctx), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
});

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: body: string。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `spawnSync`, `assert.equal`, `assert.ok`, `result.stdout.includes`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 0, result.stderr || result.error?.message)`; `assert.ok(result.stdout.includes('passed'), result.stdout)`.
 */
function python(body: string) {
  const result = spawnSync('python', ['-I', '-S', '-c',
    'import json,sys,types,copy,stat,struct,time,io,os\n' +
    'sys.modules["fcntl"]=types.SimpleNamespace(LOCK_EX=2,LOCK_UN=8,flock=lambda *a:None)\n' +
    'for i,name in enumerate(["O_NOFOLLOW","O_CLOEXEC","O_NONBLOCK","O_DIRECTORY"]):\n if not hasattr(os,name):setattr(os,name,1<<(20+i))\n' +
    'ns={"__name__":"unit_fixture"}\nexec(compile(sys.stdin.read(),"broker.py","exec"),ns)\n' + body],
    { input: source, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message); assert.ok(result.stdout.includes('passed'), result.stdout);
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`python(` events=[]; scenario='proc'; fake=types.SimpleNamespace(pidfd_open=lambd…`）。
 * Result: Return the branch-computed value (`python(` events=[]; scenario='proc'; fake=types.SimpleNamespace(pidfd_open=lambd…`).
 * 验证场景 / Scenario: Process construction failures close every acquired descriptor, including malformed proc stat
 * 协作入口 / Collaborators: `python`.
 */
test('Process construction failures close every acquired descriptor, including malformed proc stat', () => python(`
events=[]; scenario='proc'; fake=types.SimpleNamespace(pidfd_open=lambda *a:71,close=lambda fd:events.append(fd))
fake.O_RDONLY=0; fake.O_DIRECTORY=1; fake.O_NOFOLLOW=2; fake.O_CLOEXEC=4; fake.O_NONBLOCK=8
def opened(*a,**kw):
 if scenario=='proc': raise FileNotFoundError('departed process')
 return 72
fake.open=opened; ns['os']=fake
Process=ns['Process']; Process.read=lambda *a:b'bad stat'
for scenario,expected in [('proc',[71]),('stat',[72,71])]:
 events.clear()
 try: Process(33)
 except (FileNotFoundError,IndexError): pass
 else: raise AssertionError('constructor accepted absent/invalid process')
 assert events==expected,(events,expected)
print('passed')
`));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`python(` events=[];bad='owner';sourceinfo={'device':'1','inode':'8','uid':20000,…`）。
 * Result: Return the branch-computed value (`python(` events=[];bad='owner';sourceinfo={'device':'1','inode':'8','uid':20000,…`).
 * 验证场景 / Scenario: source validation pins no-follow root parent/socket and cleans partial constructor failures
 * 协作入口 / Collaborators: `python`.
 */
test('source validation pins no-follow root parent/socket and cleans partial constructor failures', () => python(`
events=[];bad='owner';sourceinfo={'device':'1','inode':'8','uid':20000,'gid':0,'mode':0o600,'type':stat.S_IFSOCK}
parentinfo={'device':'1','inode':'7','uid':0,'gid':0,'mode':0o700,'type':stat.S_IFDIR}
peer=types.SimpleNamespace(pid=25,start='50',alive=lambda:None,close=lambda:events.append('peerclose'))
ns['directory']=lambda *a,**kw:71;ns['info']=lambda value:value
ns['os']=types.SimpleNamespace(listdir=lambda fd:['agent'],fstat=lambda fd:parentinfo.copy(),stat=lambda *a,**kw:sourceinfo.copy(),close=lambda fd:events.append(('close',fd)))
probe=types.SimpleNamespace(close=lambda:events.append('probeclose'))
ns['Source'].connect_raw=lambda self:probe;ns['credentials']=lambda stream:(25,0,0)
def process(pid):
 if bad=='proc':raise FileNotFoundError('source died')
 return peer
ns['Process']=process
for bad,code in [('owner','SOURCE_OWNER'),('proc',None)]:
 sourceinfo['uid']=20000 if bad=='owner' else 0;events.clear()
 try:ns['Source']('/tmp/owned-channel/agent')
 except ns['Refused'] as error:assert str(error)==code
 except FileNotFoundError:assert code is None
 else:raise AssertionError('accepted invalid source')
 assert ('close',71) in events
 if bad=='proc':assert 'probeclose' in events
bad='good';sourceinfo['uid']=0;value=ns['Source']('/tmp/owned-channel/agent')
value.check();sourceinfo['inode']='99'
try:value.connect()
except ns['Refused'] as error:assert str(error)=='SOURCE_REPLACED'
else:raise AssertionError('followed a replacement source')
value.close();assert 'peerclose' in events
print('passed')
`));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`python(` events=[];children=['source-a','source-b'];parentinfo={'device':'1','in…`）。
 * Result: Return the branch-computed value (`python(` events=[];children=['source-a','source-b'];parentinfo={'device':'1','in…`).
 * 验证场景 / Scenario: independent forwarded sources can share a root0700 parent while exact leaf, parent and peer replacements remain refused
 * 协作入口 / Collaborators: `python`.
 */
test('independent forwarded sources can share a root0700 parent while exact leaf, parent and peer replacements remain refused', () => python(`
events=[];children=['source-a','source-b'];parentinfo={'device':'1','inode':'7','uid':0,'gid':0,'mode':0o700,'type':stat.S_IFDIR}
sockets={name:{'device':'1','inode':str(8+index),'uid':0,'gid':0,'mode':0o600,'type':stat.S_IFSOCK} for index,name in enumerate(children)}
peers={'source-a':(25,'50'),'source-b':(26,'51')};current_starts={pid:start for pid,start in peers.values()}
class Peer:
 def __init__(self,pid):self.pid=pid;self.start=current_starts[pid]
 def alive(self):ns['require'](current_starts[self.pid]==self.start,'PROCESS_CHANGED')
 def close(self):events.append(('peer-close',self.pid))
class Wire:
 def __init__(self,name):self.name=name
 def close(self):events.append(('wire-close',self.name))
def directory(path,mode=None,**kw):
 assert path=='/root/.ssh/agent' and mode==0o700 and kw=={'source':True}
 ns['require'](parentinfo['uid']==0 and parentinfo['gid']==0 and parentinfo['mode']==0o700,'DIRECTORY_OWNER')
 return 71
def lookup(name,dir_fd=None,follow_symlinks=True):
 assert dir_fd==71 and follow_symlinks is False
 assert name in children
 return sockets[name].copy()
ns['directory']=directory;ns['info']=lambda value:value
ns['os']=types.SimpleNamespace(listdir=lambda fd:children.copy(),fstat=lambda fd:parentinfo.copy(),stat=lookup,close=lambda fd:events.append(('fd-close',fd)))
ns['Process']=Peer;ns['Source'].connect_raw=lambda self:Wire(self.name)
ns['credentials']=lambda stream:(peers[stream.name][0],0,0)
a=ns['Source']('/root/.ssh/agent/source-a');b=ns['Source']('/root/.ssh/agent/source-b')
assert a.record()['parent']==b.record()['parent'] and a.record()['socket']!=b.record()['socket']
assert a.record()['peer']!=b.record()['peer']
for names in [['source-a','source-b','neighbor'],['source-a','source-b'],['source-a','source-b','another-neighbor']]:
 children[:]=names;a.check();b.check()
 stream=a.connect();stream.close();stream=b.connect();stream.close()
def refused(operation,code):
 try:operation()
 except ns['Refused'] as error:assert str(error)==code,(str(error),code)
 else:raise AssertionError('accepted replaced source: '+code)
sockets['source-a']['inode']='99';refused(a.connect,'SOURCE_REPLACED');sockets['source-a']['inode']='8'
parentinfo['inode']='88';refused(a.check,'SOURCE_REPLACED');parentinfo['inode']='7'
current_starts[25]='500';refused(a.check,'PROCESS_CHANGED');current_starts[25]='50'
peers['source-a']=(26,'51');before=len(events);refused(a.connect,'SOURCE_PEER_CHANGED')
assert ('wire-close','source-a') in events[before:];peers['source-a']=(25,'50')
parentinfo['mode']=0o755;refused(a.check,'DIRECTORY_OWNER');parentinfo['mode']=0o700
a.check();b.check();a.close();b.close()
assert ('peer-close',25) in events and ('peer-close',26) in events
print('passed')
`));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`python(` events=[];parent={'device':'1','inode':'7','uid':0,'gid':0,'mode':0o700…`）。
 * Result: Return the branch-computed value (`python(` events=[];parent={'device':'1','inode':'7','uid':0,'gid':0,'mode':0o700…`).
 * 验证场景 / Scenario: forwarded socket permissions stay pinned behind the root0700 parent without changing the sshd object
 * 协作入口 / Collaborators: `python`.
 */
test('forwarded socket permissions stay pinned behind the root0700 parent without changing the sshd object', () => python(`
events=[];parent={'device':'1','inode':'7','uid':0,'gid':0,'mode':0o700,'type':stat.S_IFDIR}
leaf={'device':'1','inode':'8','uid':0,'gid':0,'mode':0o755,'type':stat.S_IFSOCK}
peer=types.SimpleNamespace(pid=25,start='50',alive=lambda:None,close=lambda:events.append('peer-close'))
def directory(path,mode=None,**kw):
 assert path=='/tmp/ssh-owned' and mode==0o700 and kw=={'source':True}
 ns['require'](parent['uid']==0 and parent['gid']==0 and parent['mode']==0o700,'DIRECTORY_OWNER')
 return 71
def lookup(name,**kw):
 assert name=='agent' and kw=={'dir_fd':71,'follow_symlinks':False}
 return leaf.copy()
ns['directory']=directory;ns['info']=lambda value:value
ns['os']=types.SimpleNamespace(fstat=lambda fd:parent.copy(),stat=lookup,close=lambda fd:events.append(('fd-close',fd)))
ns['Process']=lambda pid:peer;ns['credentials']=lambda stream:(25,0,0)
ns['Source'].connect_raw=lambda self:types.SimpleNamespace(close=lambda:events.append('wire-close'))
def refused(operation,code):
 try:operation()
 except ns['Refused'] as error:assert str(error)==code,(str(error),code)
 else:raise AssertionError('accepted '+code)
for mode in [0o755,0o777]:
 leaf['mode']=mode;a=ns['Source']('/tmp/ssh-owned/agent');a.check();a.connect().close()
 assert a.record()['socket']['mode']==mode and leaf['mode']==mode
 leaf['mode']=0o600;refused(a.check,'SOURCE_REPLACED');leaf['mode']=mode
 for field,bad,code in [('uid',20000,'SOURCE_REPLACED'),('gid',20000,'SOURCE_REPLACED'),('type',stat.S_IFREG,'SOURCE_REPLACED')]:
  old=leaf[field];leaf[field]=bad;refused(a.check,code);leaf[field]=old
 for bad in [0o750,0o755,0o770,0o777]:
  parent['mode']=bad;refused(a.check,'DIRECTORY_OWNER');parent['mode']=0o700
 a.close()
for field,bad in [('uid',20000),('gid',20000),('type',stat.S_IFREG)]:
 old=leaf[field];leaf[field]=bad;refused(lambda:ns['Source']('/tmp/ssh-owned/agent'),'SOURCE_OWNER');leaf[field]=old
assert set(str(item) for item in events)<=set([str(('fd-close',71)),'wire-close','peer-close'])
print('passed')
`));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`python(` ctx=json.loads(${JSON.stringify(JSON.stringify(context()))});events=[] …`）。
 * Result: Return the branch-computed value (`python(` ctx=json.loads(${JSON.stringify(JSON.stringify(context()))});events=[] …`).
 * 验证场景 / Scenario: the locked broker still rejects another unresolved lease with the identical complete source tuple
 * 协作入口 / Collaborators: `python`, `JSON.stringify`, `context`.
 */
test('the locked broker still rejects another unresolved lease with the identical complete source tuple', () => python(`
ctx=json.loads(${JSON.stringify(JSON.stringify(context()))});events=[]
source={'path':'/root/.ssh/agent/source-a','parent':{'device':'1','inode':'7','uid':0,'gid':0,'mode':0o700,'type':stat.S_IFDIR},
 'socket':{'device':'1','inode':'8','uid':0,'gid':0,'mode':0o600,'type':stat.S_IFSOCK},'peer':{'pid':25,'startTicks':'50'}}
class Source:
 def __init__(self,path):assert path==source['path']
 def record(self):return source.copy()
 def close(self):events.append('source-close')
ns['Source']=Source;ns['Process']=lambda pid:types.SimpleNamespace(pid=pid,start='60',close=lambda:events.append('process-close'))
ns['signal']=types.SimpleNamespace(SIGTERM=15,SIGHUP=1,SIGINT=2,signal=lambda *a:None)
ns['directory']=lambda path,mode:90 if path==ns['RECORDS'] and mode==0o700 else (_ for _ in ()).throw(AssertionError('unexpected directory'))
ns['os']=types.SimpleNamespace(getpid=lambda:27,environ={'SAKURA_SSH_AGENT_SOURCE':source['path']},listdir=lambda fd:[ns['record_name'](ctx),'another-lease.json'],close=lambda fd:events.append(('fd-close',fd)))
ns['regular']=lambda fd,name:json.dumps({'version':1,'phase':'ready','source':source}).encode()
ns['save_record']=lambda value:events.append(('save',value['phase'],value['failure']))
value={'version':1,'context':ctx,'phase':'preparing','scope':{'device':'1','inode':'2','controlToken':'00000000-0000-4000-8000-000000000001'},
 'source':None,'endpointDirectory':None,'endpoint':None,'broker':None,'failure':None}
ns['broker'](ctx,value,80)
assert value['phase']=='failed' and value['failure']=='SOURCE_SHARED'
assert value['source']==source and value['endpoint'] is None
assert 'source-close' in events and ('fd-close',80) in events and ('fd-close',90) in events
print('passed')
`));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`python(String.raw` ctx=json.loads(${JSON.stringify(JSON.stringify(context()))});…`）。
 * Result: Return the branch-computed value (`python(String.raw` ctx=json.loads(${JSON.stringify(JSON.stringify(context()))});…`).
 * 验证场景 / Scenario: peer identity uses original pidfd/start, exact full cgroup and caps/NNP on every check
 * 协作入口 / Collaborators: `python`, `JSON.stringify`, `context`.
 */
test('peer identity uses original pidfd/start, exact full cgroup and caps/NNP on every check', () => python(String.raw`
ctx=json.loads(${JSON.stringify(JSON.stringify(context()))}); p=object.__new__(ns['Process']); p.pid=32;p.pidfd=70;p.directory=71;p.start='42'
cg=b'0::/sakura-task-'+ctx['owner']['runId'].encode()+b'\n'; changed=False; capabilities=b'0000000000000000'; nnp=b'1'
def read(name,limit):
 if name=='stat': return b'32 (odd)\n name) S 1 2 3 '+b'0 '*15+b'42 0 0'
 if name=='cgroup': return b'0::/sakura-task-other\n' if changed else cg
 return b'Uid:\t20000 20000 20000 20000\nGid:\t20000 20000 20000 20000\nNoNewPrivs:\t'+nnp+b'\nCapEff:\t'+capabilities+b'\n'
p.read=read; ns['select']=types.SimpleNamespace(select=lambda *a:([],[],[])); ns['boot']=lambda:ctx['owner']['bootId']
ns['directory']=lambda path:90; ns['os']=types.SimpleNamespace(fstat=lambda fd:types.SimpleNamespace(st_dev=1,st_ino=2),close=lambda fd:None)
scope={'device':'1','inode':'2'}; p.task(ctx,scope)
def reject(code):
 try: p.task(ctx,scope)
 except ns['Refused'] as error: assert str(error)==code,str(error)
 else: raise AssertionError('accepted '+code)
changed=True; reject('PEER_SCOPE'); changed=False
capabilities=b'0000000000000001'; reject('PEER_PRIVILEGES'); capabilities=b'0000000000000000'
nnp=b'0'; reject('PEER_PRIVILEGES'); nnp=b'1'
scope['inode']='3'; reject('CGROUP_CHANGED')
print('passed')
`));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`python(` class Wire: def __init__(self,data):self.data=data;self.sent=b'' def se…`）。
 * Result: Return the branch-computed value (`python(` class Wire: def __init__(self,data):self.data=data;self.sent=b'' def se…`).
 * 验证场景 / Scenario: framed relay bounds lengths, requests and bytes and rechecks revocation before returning a response
 * 协作入口 / Collaborators: `python`.
 */
test('framed relay bounds lengths, requests and bytes and rechecks revocation before returning a response', () => python(`
class Wire:
 def __init__(self,data):self.data=data;self.sent=b''
 def settimeout(self,value):pass
 def recv(self,count):part=self.data[:count];self.data=self.data[count:];return part
 def send(self,data):self.sent+=data;return len(data)
def packet(data):return struct.pack('!I',len(data))+data
deadline=time.monotonic()+20
for length in [0,262145]:
 try:ns['frame'](Wire(struct.pack('!I',length)),deadline,lambda:None)
 except ns['Refused'] as error:assert str(error)=='PROTOCOL_SIZE'
 else:raise AssertionError('accepted frame length')
request=Wire(packet(b'one'));response=Wire(packet(b'signature'));revoked=False
original=ns['frame']
def frame(stream,*args):
 global revoked
 value=original(stream,*args)
 if stream is response:revoked=True
 return value
ns['frame']=frame
def check():ns['require'](not revoked,'RESOURCE_REVOKED')
try:ns['relay'](request,response,deadline,check)
except ns['Refused'] as error:assert str(error)=='RESOURCE_REVOKED'
else:raise AssertionError('forwarded after revocation')
assert request.sent==b'' and response.sent==packet(b'one')
ns['frame']=original;ns['MAX_REQUESTS']=2;ns['MAX_SESSION_BYTES']=20
request=Wire(packet(b'12345')*2);response=Wire(packet(b'12345')*2)
try:ns['relay'](request,response,deadline,lambda:None)
except ns['Refused'] as error:assert str(error)=='PROTOCOL_BUDGET'
else:raise AssertionError('accepted byte budget')
assert len(request.sent)==9
print('passed')
`));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`python(String.raw` ctx=json.loads(${JSON.stringify(JSON.stringify(context()))});…`）。
 * Result: Return the branch-computed value (`python(String.raw` ctx=json.loads(${JSON.stringify(JSON.stringify(context()))});…`).
 * 验证场景 / Scenario: a failed broker ready receipt refuses the native launcher before any protected payload execution
 * 协作入口 / Collaborators: `python`, `JSON.stringify`, `context`.
 */
test('a failed broker ready receipt refuses the native launcher before any protected payload execution', () => python(String.raw`
ctx=json.loads(${JSON.stringify(JSON.stringify(context()))}); events=[]; reads=0
ns['task_scope']=lambda context:(77,{'device':'1','inode':'2','controlToken':'00000000-0000-4000-8000-000000000001'})
ns['open']=lambda *a,**kw:io.StringIO('0::/sakura-task-'+ctx['owner']['runId']+'\n')
ns['locked']=lambda **kw:78;ns['save_record']=lambda value:events.append('save')
def read(context):
 global reads
 reads+=1
 return None if reads==1 else {'phase':'failed','failure':'SOURCE_INVALID'}
ns['read_record']=read
ns['os']=types.SimpleNamespace(path=types.SimpleNamespace(lexists=lambda path:False),fork=lambda:88,close=lambda fd:events.append(('close',fd)),execve=lambda *a:events.append('EXEC'))
try:ns['run'](ctx,'/fixed/native --metadata')
except ns['Refused'] as error:assert str(error)=='SOURCE_INVALID'
else:raise AssertionError('accepted failed ready')
assert 'EXEC' not in events
print('passed')
`));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`python(` ctx=json.loads(${JSON.stringify(JSON.stringify(context()))}); endpoint=…`）。
 * Result: Return the branch-computed value (`python(` ctx=json.loads(${JSON.stringify(JSON.stringify(context()))}); endpoint=…`).
 * 验证场景 / Scenario: closed/no-record cleanup checks the socket root and rejects any revived lease without deleting it
 * 协作入口 / Collaborators: `python`, `JSON.stringify`, `context`.
 */
test('closed/no-record cleanup checks the socket root and rejects any revived lease without deleting it', () => python(`
ctx=json.loads(${JSON.stringify(JSON.stringify(context()))}); endpoint=ns['SOCKETS']+'/'+ctx['resource']['leaseId']; present={ns['RECORDS'],ns['SOCKETS']}; events=[]; rootmode=0o755
value={'phase':'closed','source':None};ns['stopped']=lambda context:ctx['owner']['bootId'];ns['locked']=lambda:80;ns['read_record']=lambda context:value
def directory(path,*a,**kw):
 if path==ns['SOCKETS']:ns['require'](rootmode==0o755,'DIRECTORY_OWNER');events.append('rootchecked')
 return 81
def lookup(name,**kw):
 if endpoint not in present:raise FileNotFoundError(name)
 return object()
ns['directory']=directory;ns['os']=types.SimpleNamespace(path=types.SimpleNamespace(lexists=lambda path:path in present),close=lambda fd:None,stat=lookup)
assert ns['cleanup'](ctx)['phase']=='closed' and 'rootchecked' in events
present.add(endpoint)
try:ns['cleanup'](ctx)
except ns['Refused'] as error:assert str(error)=='CLOSED_ENDPOINT_PRESENT'
else:raise AssertionError('accepted a revived endpoint')
present.remove(endpoint);present.remove(ns['RECORDS']);rootmode=0o700
try:ns['cleanup'](ctx)
except ns['Refused'] as error:assert str(error)=='DIRECTORY_OWNER'
else:raise AssertionError('accepted unknown socket root')
print('passed')
`));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`python(` ctx=json.loads(${JSON.stringify(JSON.stringify(context()))});endpoint=n…`）。
 * Result: Return the branch-computed value (`python(` ctx=json.loads(${JSON.stringify(JSON.stringify(context()))});endpoint=n…`).
 * 验证场景 / Scenario: partially unlinked endpoints retry by original inode, and replacements stay untouched
 * 协作入口 / Collaborators: `python`, `JSON.stringify`, `context`.
 */
test('partially unlinked endpoints retry by original inode, and replacements stay untouched', () => python(`
ctx=json.loads(${JSON.stringify(JSON.stringify(context()))});endpoint=ns['SOCKETS']+'/'+ctx['resource']['leaseId'];present=True;children=['agent'];rmdir_fail=True;events=[]
meta={'device':'1','inode':'9','uid':0,'gid':20000,'mode':0o710,'type':stat.S_IFDIR};sock={'device':'1','inode':'10','uid':20000,'gid':20000,'mode':0o600,'type':stat.S_IFSOCK}
value={'phase':'failed','source':None,'endpointDirectory':meta.copy(),'endpoint':sock.copy()}
ns['stopped']=lambda context:ctx['owner']['bootId'];ns['locked']=lambda:70;ns['read_record']=lambda context:value;ns['save_record']=lambda item:events.append('closed')
ns['directory']=lambda path,*a,**kw:71 if path==endpoint else 72
ns['info']=lambda item:item
def lookup(name,dir_fd=None,**kw):return sock.copy() if name=='agent' else meta.copy()
def unlink(name,**kw):children.remove(name);events.append('unlink')
def remove(name,**kw):
 global present,rmdir_fail
 if rmdir_fail:rmdir_fail=False;raise OSError('first rmdir reply failure')
 present=False;events.append('rmdir')
ns['os']=types.SimpleNamespace(path=types.SimpleNamespace(lexists=lambda path:present if path==endpoint else True),close=lambda fd:None,fstat=lambda fd:meta.copy(),stat=lookup,listdir=lambda fd:children.copy(),unlink=unlink,rmdir=remove,fsync=lambda fd:None)
try:ns['cleanup'](ctx)
except OSError:pass
else:raise AssertionError('first removal should be interrupted')
assert children==[] and value['phase']=='failed'
meta['inode']='99'
try:ns['cleanup'](ctx)
except ns['Refused'] as error:assert str(error)=='ENDPOINT_REPLACED'
else:raise AssertionError('accepted replaced parent')
assert present and events==['unlink']
meta['inode']='9';assert ns['cleanup'](ctx)['phase']=='closed' and not present
assert events==['unlink','rmdir','closed']
print('passed')
`));
