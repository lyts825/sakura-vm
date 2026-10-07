/**
 * 模块职责：回归验证模块，围绕 `gpg-agent-scope` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `gpg-agent-scope`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: GPG resource fixes both host hashes and has only constant UUID source/home/endpoint paths; GPG assets use exact private SHA generations and compressed stdin without root command/environment.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Machines } from '../server/machines.ts';
import { AppError } from '../server/model.ts';
import { projectIdentitySchema } from '../server/project-identity.ts';
import { OwnedGpgForward, gpgHostSnapshotSha256, type GpgHostSnapshot } from '../server/gpg-agent-host.ts';
import { GpgAgentScopes, bindTaskGpg, isOwnedTaskGpg, gpgAgentResourceSchema, gpgAgentRecordSchema,
  gpgAgentSourcePath, gpgAgentSocketPath, gpgAgentHomePath, type GpgAgentContext } from '../server/gpg-agent-scope.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-gpg-scope-unit-'));
const source = await readFile(new URL('../server/gpg-agent-broker.py', import.meta.url));
const sha256 = createHash('sha256').update(source).digest('hex');
await writeFile(join(root, 'broker.py'), source);
await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: 1, file: 'broker.py', size: source.length, sha256 }));
after(async () => {
  const canonical = await realpath(root), parent = await realpath(tmpdir());
  assert.equal(dirname(canonical), parent); assert.ok(basename(canonical).startsWith('sakura-gpg-scope-unit-'));
  await rm(canonical, { recursive: true, force: true });
});

// Metadata-only host snapshot. No constructor below opens a user Agent or
// starts a helper; every native spawn option is a throwing test guard.
/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `hostSourceSha256`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `hostSourceSha256`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `'1'.repeat`, `'c'.repeat`, `'2'.repeat`, `gpgHostSnapshotSha256`.
 */
function snapshot(): GpgHostSnapshot {
  const directory = { id: '1:' + '1'.repeat(32), owner: 'S-1-5-21-100', aclSha256: '1'.repeat(64),
    attributes: 16, links: 1, directory: true, protectedAcl: true };
  const body = { version: 1 as const, hostHelperSha256: 'c'.repeat(64), pins: { kind: 'w32' as const,
    anchorPath: 'C:\\owned-gpg-unit', relativePath: 'S.gpg-agent.extra', anchor: directory, ancestors: [directory],
    descendants: [{ ...directory, id: '1:' + '2'.repeat(32), directory: false, attributes: 0 }],
    sourceFileSha256: '2'.repeat(64), port: 54321,
    process: { pid: 123, creationTime: '456', sid: directory.owner, image: 'C:\\owned-gpg-unit\\gpg-agent.exe' } } };
  return { ...body, hostSourceSha256: gpgHostSnapshotSha256(body) };
}
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: host = snapshot()。
 * 结果：返回受控对象，公开字段包括 `resource, identity, owner, sha256`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `resource, identity, owner, sha256`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `projectIdentitySchema.parse`, `identityId.replaceAll('-', '').slice`, `identityId.replaceAll`.
 */
function context(host = snapshot()): GpgAgentContext {
  const identityId = randomUUID();
  return { resource: { version: 1, kind: 'gpg-agent', leaseId: randomUUID(), brokerSha256: sha256, timeoutSeconds: 60,
    hostSourceSha256: host.hostSourceSha256, hostHelperSha256: host.hostHelperSha256 },
    identity: projectIdentitySchema.parse({ version: 1, phase: 'active', registryId: randomUUID(), projectId: 'default',
      identityId, revision: 1, uid: 20000, gid: 20000, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
      home: '/var/lib/sakura-project-homes/' + identityId, directory: '/workspace/owned', homeDevice: '1', homeInode: '2',
      directoryDevice: '1', directoryInode: '3', networkIsolation: 'private' }),
    owner: { kind: 'task', runId: randomUUID(), bootId: randomUUID() }, sha256: 'a'.repeat(64) };
}
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: inode: string; uid = 0; gid = 0; mode = 0o700; type = 0o40000。
 * 结果：返回分支计算值（`({ device: '1', inode, uid, gid, mode, type })`）。
 * Result: Return the branch-computed value (`({ device: '1', inode, uid, gid, mode, type })`).
 */
const object = (inode: string, uid = 0, gid = 0, mode = 0o700, type = 0o40000) => ({ device: '1', inode, uid, gid, mode, type });
/**
 * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
 * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
 * 输入 / Inputs: ctx: GpgAgentContext; phase: 'prepared' | 'closed' = 'prepared'。
 * 结果：返回受控对象，公开字段包括 `version, context, phase, scope, sourceDirectory, source, endpointDirectory, endpoint, homeDirectory`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `version, context, phase, scope, sourceDirectory, source, endpointDirectory, endpoint, homeDirectory`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `object`.
 */
function record(ctx: GpgAgentContext, phase: 'prepared' | 'closed' = 'prepared') {
  return { version: 1, context: ctx, phase, scope: null, sourceDirectory: object('4'), source: null,
    endpointDirectory: null, endpoint: null, homeDirectory: null, home: null, redirect: null, broker: null,
    homeCleanup: null, failure: null };
}
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: ctx: GpgAgentContext。
 * 结果：返回分支计算值（`new OwnedGpgForward(host, new AbortController().signal, { spawn: () => { throw n…`）。
 * Result: Return the branch-computed value (`new OwnedGpgForward(host, new AbortController().signal, { spawn: () => { throw n…`).
 * 协作入口 / Collaborators: `snapshot`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(ctx.resource.hostSourceSha256, host.hostSourceSha256)`.
 */
function owner(ctx: GpgAgentContext) {
  const host = snapshot(); assert.equal(ctx.resource.hostSourceSha256, host.hostSourceSha256);
  return new OwnedGpgForward(host, new AbortController().signal, { /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 失败 / Failure: `new Error('unit must not spawn native helper')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  spawn: () => { throw new Error('unit must not spawn native helper'); } });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GPG resource fixes both host hashes and has only constant UUID source/home/endpoint paths
 * 协作入口 / Collaborators: `snapshot`, `scopes.resource`, `assert.equal`, `gpgAgentSourcePath`.
 * 检查边界 / Checked boundaries: `assert.equal(resource.brokerSha256, sha256)`; `assert.equal(resource.hostSourceSha256, host.hostSourceSha256)`.
 */
test('GPG resource fixes both host hashes and has only constant UUID source/home/endpoint paths', async () => {
  const scopes = new GpgAgentScopes({} as Machines, { sourceDirectory: root }), host = snapshot();
  const resource = await scopes.resource(60, host);
  assert.equal(resource.brokerSha256, sha256); assert.equal(resource.hostSourceSha256, host.hostSourceSha256);
  assert.equal(resource.hostHelperSha256, host.hostHelperSha256);
  const lease = resource.leaseId;
  assert.equal(gpgAgentSourcePath(lease), `/run/sakura-gpg-forwards/sources/${lease}/agent`);
  assert.equal(gpgAgentSocketPath(lease), `/run/sakura-gpg-sockets/${lease}/agent`);
  assert.equal(gpgAgentHomePath(lease), `/run/sakura-gpg-data/${lease}/home`);
  assert.throws(() => gpgAgentSourcePath('../foreign'));
  assert.equal(gpgAgentResourceSchema.safeParse({ ...resource, hostHelperSha256: 'bad' }).success, false);
  assert.equal(gpgAgentResourceSchema.safeParse({ ...resource, sourcePath: '/tmp/foreign' }).success, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GPG assets use exact private SHA generations and compressed stdin without root command/environment
 * 协作入口 / Collaborators: `context`, `scopes.install`, `assert.rejects`, `'d'.repeat`.
 * 检查边界 / Checked boundaries: `assert.rejects(scopes.install('owned', { ...ctx.resource, brokerSha256: 'd'.repeat(64) }, new AbortController().signal), { code: '…`; `assert.equal(commands.length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('GPG assets use exact private SHA generations and compressed stdin without root command/environment', async () => {
  const ctx = context(), commands: string[] = [];
  const machines = { /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; command: string; bytes: Buffer。
   * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
   * 验证场景 / Scenario: GPG assets use exact private SHA generations and compressed stdin without root command/environment
   * 协作入口 / Collaborators: `commands.push`, `assert.deepEqual`, `inflateSync`, `assert.ok`.
   * 检查边界 / Checked boundaries: `assert.deepEqual(inflateSync(bytes), source)`; `assert.ok(command.includes('O_NOFOLLOW') && command.includes('O_EXCL') && command.includes('st_nlink==1'))`.
   */
  execInput: async (_id: string, command: string, bytes: Buffer) => {
    commands.push(command); assert.deepEqual(inflateSync(bytes), source);
    assert.ok(command.includes('O_NOFOLLOW') && command.includes('O_EXCL') && command.includes('st_nlink==1'));
    assert.ok(!command.includes(source.toString()) && !command.includes(source.toString('base64')));
    return { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true, sha256 }) };
  } } as unknown as Machines;
  const scopes = new GpgAgentScopes(machines, { sourceDirectory: root });
  await scopes.install('owned', ctx.resource, new AbortController().signal);
  await assert.rejects(scopes.install('owned', { ...ctx.resource, brokerSha256: 'd'.repeat(64) }, new AbortController().signal),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(commands.length, 1);
  const run = scopes.command('run', ctx, 'fixed-native-launcher-metadata');
  assert.ok(run.startsWith('# SAKURA_GPG_AGENT_RUN'));
  assert.ok(!run.includes('SSH_AUTH_SOCK') && !run.includes('SAKURA_GPG_AGENT_SOURCE') && !run.includes('GNUPGHOME='));
  assert.throws(() => scopes.command('read', ctx, 'unexpected-launcher'));
  const invalid = await mkdtemp(join(root, 'invalid-'));
  await writeFile(join(invalid, 'manifest.json'), JSON.stringify({ version: 1, file: '../broker.py', size: source.length, sha256 }));
  await assert.rejects(new GpgAgentScopes(machines, { sourceDirectory: invalid }).resource(60, snapshot()),
    { code: 'PROJECT_IDENTITY_AGENT_ASSET_INVALID' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: prepare has an exact nullable pre-RUN receipt and refuses reply paths, scope adoption and live replacement
 * 状态影响 / State effects: `result`, `replaceLive`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `context`, `randomUUID`, `gpgAgentSourcePath`, `record`.
 * 检查边界 / Checked boundaries: `assert.equal((await scopes.prepare(id, ctx, new AbortController().signal)).record.scope, null)`; `assert.rejects(scopes.prepare(id, ctx, new AbortController().signal), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('prepare has an exact nullable pre-RUN receipt and refuses reply paths, scope adoption and live replacement', async () => {
  const ctx = context(), live = {}, id = randomUUID(); let result = { phase: 'prepared', context: ctx,
    sourcePath: gpgAgentSourcePath(ctx.resource.leaseId), record: record(ctx) };
  let replaceLive = false;
  const machines = { live: new Map([[id, live]]), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; command: string。
   * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
   * 验证场景 / Scenario: prepare has an exact nullable pre-RUN receipt and refuses reply paths, scope adoption and live replacement
   * 协作入口 / Collaborators: `assert.ok`, `command.startsWith`, `machines.live.set`, `JSON.stringify`.
   * 检查边界 / Checked boundaries: `assert.ok(command.startsWith('# SAKURA_GPG_AGENT_PREPARE'))`.
   */
  exec: async (_id: string, command: string) => {
    assert.ok(command.startsWith('# SAKURA_GPG_AGENT_PREPARE'));
    if (replaceLive) machines.live.set(id, {} as never);
    return { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true, result }) };
  } } as unknown as Machines;
  const scopes = new GpgAgentScopes(machines);
  assert.equal((await scopes.prepare(id, ctx, new AbortController().signal)).record.scope, null);
  result = { ...result, sourcePath: '/tmp/unowned' };
  await assert.rejects(scopes.prepare(id, ctx, new AbortController().signal), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  result = { phase: 'prepared', context: ctx, sourcePath: gpgAgentSourcePath(ctx.resource.leaseId), record: record(ctx) };
  replaceLive = true;
  await assert.rejects(scopes.prepare(id, ctx, new AbortController().signal), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  result = { ...result, sourcePath: gpgAgentSourcePath(ctx.resource.leaseId),
    record: { ...record(ctx), scope: { device: '1', inode: '8', controlToken: randomUUID() } } as never };
  await assert.rejects(scopes.prepare(id, ctx, new AbortController().signal), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unconfirmed host close keeps the same owner and blocks all guest cleanup until exact retry
 * 协作入口 / Collaborators: `context`, `randomUUID`, `owner`, `bindTaskGpg`.
 * 检查边界 / Checked boundaries: `assert.throws(() => bindTaskGpg(machines, id, ctx, bridge, live as never), { code: 'PROJECT_IDENTITY_HOST_CHANGED' })`; `assert.rejects(scopes.cleanup(id, ctx), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`.
 */
test('unconfirmed host close keeps the same owner and blocks all guest cleanup until exact retry', async t => {
  const ctx = context(), live = {}, id = randomUUID(), bridge = owner(ctx); let controls = 0;
  const machines = { live: new Map([[id, live]]), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
   * 验证场景 / Scenario: unconfirmed host close keeps the same owner and blocks all guest cleanup until exact retry
   * 协作入口 / Collaborators: `JSON.stringify`.
   */
  exec: async () => {
    ++controls; return { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true,
      result: { phase: 'closed', context: ctx, record: null } }) };
  } } as unknown as Machines;
  const release = bindTaskGpg(machines, id, ctx, bridge, live as never), scopes = new GpgAgentScopes(machines);
  assert.throws(() => bindTaskGpg(machines, id, ctx, bridge, live as never), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  const close = t.mock.method(bridge, 'close', async () => { throw new AppError('physical close pending', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'); });
  await assert.rejects(scopes.cleanup(id, ctx), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  release(); assert.equal(isOwnedTaskGpg(machines, id, ctx, bridge), true); assert.equal(controls, 0);
  close.mock.restore(); await scopes.cleanup(id, ctx);
  assert.equal(controls, 1); assert.equal(bridge.helperCount, 0); assert.equal(bridge.streamCount, 0);
  assert.equal(isOwnedTaskGpg(machines, id, ctx, bridge), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cleanup retries only the immutable resource and cannot follow changed context or captured live
 * 协作入口 / Collaborators: `context`, `randomUUID`, `owner`, `bindTaskGpg`.
 * 检查边界 / Checked boundaries: `assert.rejects(scopes.cleanup(id, { ...ctx, sha256: 'f'.repeat(64) }), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' })`; `assert.equal(commands.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cleanup retries only the immutable resource and cannot follow changed context or captured live', async t => {
  const ctx = context(), live = {}, id = randomUUID(), bridge = owner(ctx), commands: string[] = []; let attempts = 0;
  const machines = { live: new Map([[id, live]]), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; command: string。
   * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
   * 验证场景 / Scenario: cleanup retries only the immutable resource and cannot follow changed context or captured live
   * 失败 / Failure: `new Error('own simulated lost reply')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `commands.push`, `JSON.stringify`, `record`.
   */
  exec: async (_id: string, command: string) => {
    commands.push(command); if (++attempts < 3) throw new Error('own simulated lost reply');
    return { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true,
      result: { phase: 'closed', context: ctx, record: record(ctx, 'closed') } }) };
  } } as unknown as Machines;
  bindTaskGpg(machines, id, ctx, bridge, live as never);
  const scopes = new GpgAgentScopes(machines);
  await assert.rejects(scopes.cleanup(id, { ...ctx, sha256: 'f'.repeat(64) }), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(commands.length, 0);
  await scopes.cleanup(id, ctx); assert.equal(commands.length, 3); assert.equal(new Set(commands).size, 1);
  assert.ok(commands.every(command => !command.includes('SAKURA_GPG_AGENT_INSTALL') && !command.includes('SSH_AUTH_SOCK')));
  const next = context(), nextBridge = owner(next), nextLive = {};
  machines.live.set(id, nextLive as never); bindTaskGpg(machines, id, next, nextBridge, nextLive as never);
  const realClose = nextBridge.close.bind(nextBridge);
  t.mock.method(nextBridge, 'close', async () => { await realClose(); machines.live.set(id, {} as never); });
  await assert.rejects(scopes.cleanup(id, next), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  assert.equal(commands.length, 3, 'changed live cannot trigger a root cleanup in another instance');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a stopped original host owner can clean its exact old context through the captured new guest live
 * 协作入口 / Collaborators: `context`, `randomUUID`, `owner`, `bindTaskGpg`.
 * 检查边界 / Checked boundaries: `assert.equal(isOwnedTaskGpg(machines, id, ctx, bridge), false, 'old host owner cannot authorize a new run')`; `assert.deepEqual(commands, [scopes.command('cleanup', ctx)])`.
 */
test('a stopped original host owner can clean its exact old context through the captured new guest live', async () => {
  const ctx = context(), originalLive = {}, currentLive = {}, id = randomUUID(), bridge = owner(ctx);
  const commands: string[] = [];
  const machines = { live: new Map([[id, originalLive]]), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; command: string。
   * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
   * 验证场景 / Scenario: a stopped original host owner can clean its exact old context through the captured new guest live
   * 协作入口 / Collaborators: `assert.equal`, `machines.live.get`, `commands.push`, `JSON.stringify`.
   * 检查边界 / Checked boundaries: `assert.equal(machines.live.get(id), currentLive)`.
   */
  exec: async (_id: string, command: string) => {
    assert.equal(machines.live.get(id), currentLive); commands.push(command);
    return { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true,
      result: { phase: 'closed', context: ctx, record: record(ctx, 'closed') } }) };
  } } as unknown as Machines;
  bindTaskGpg(machines, id, ctx, bridge, originalLive as never);
  machines.live.set(id, currentLive as never);
  assert.equal(isOwnedTaskGpg(machines, id, ctx, bridge), false, 'old host owner cannot authorize a new run');
  const scopes = new GpgAgentScopes(machines); await scopes.cleanup(id, ctx);
  assert.deepEqual(commands, [scopes.command('cleanup', ctx)]);
  assert.equal(bridge.helperCount, 0); assert.equal(bridge.streamCount, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an old owner stays registered if the captured new live changes during its physical host close
 * 协作入口 / Collaborators: `context`, `randomUUID`, `owner`, `bindTaskGpg`.
 * 检查边界 / Checked boundaries: `assert.rejects(scopes.cleanup(id, ctx), (error: unknown) => { assert.ok(error instanceof AppError); assert.equal(error.status, 503…`; `assert.equal(controls, 0)`.
 */
test('an old owner stays registered if the captured new live changes during its physical host close', async t => {
  const ctx = context(), originalLive = {}, currentLive = {}, replacementLive = {}, id = randomUUID(), bridge = owner(ctx);
  let controls = 0;
  const machines = { live: new Map([[id, originalLive]]), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
   * 验证场景 / Scenario: an old owner stays registered if the captured new live changes during its physical host close
   * 协作入口 / Collaborators: `JSON.stringify`.
   */
  exec: async () => {
    ++controls; return { code: 0, stderr: '', stdout: JSON.stringify({ version: 1, ok: true,
      result: { phase: 'closed', context: ctx, record: null } }) };
  } } as unknown as Machines;
  const release = bindTaskGpg(machines, id, ctx, bridge, originalLive as never), scopes = new GpgAgentScopes(machines);
  machines.live.set(id, currentLive as never); const physicalClose = bridge.close.bind(bridge);
  const close = t.mock.method(bridge, 'close', async () => { await physicalClose(); machines.live.set(id, replacementLive as never); });
  await assert.rejects(scopes.cleanup(id, ctx), (error: unknown) => {
    assert.ok(error instanceof AppError); assert.equal(error.status, 503);
    assert.equal(error.code, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    assert.ok(error.message.includes('Agent cleanup live changed before exec')); return true;
  });
  release(); assert.equal(controls, 0);
  assert.throws(() => bindTaskGpg(machines, id, ctx, bridge, replacementLive as never), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  close.mock.restore(); await scopes.cleanup(id, ctx); assert.equal(controls, 1);
  assert.equal(bridge.helperCount, 0); assert.equal(bridge.streamCount, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cleanup reports fixed refusal, actual exit, JSON/schema/context and transport reasons without remote secrets
 * 状态影响 / State effects: `recovered`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `context`, `randomUUID`, `owner`, `bindTaskGpg`.
 * 检查边界 / Checked boundaries: `assert.rejects(scopes.cleanup(id, ctx), (error: unknown) => { assert.ok(error instanceof AppError); assert.equal(error.status, 503…`; `assert.equal(isOwnedTaskGpg(machines, id, ctx, bridge), true)`.
 */
test('cleanup reports fixed refusal, actual exit, JSON/schema/context and transport reasons without remote secrets', async () => {
  const secret = 'REMOTE_PRIVATE_KEY_SENTINEL';
  const cases = [
    { code: 1, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ok: false, code: 'GPG_AGENT_SOURCE_CLOSE_UNCONFIRMED', detail: null })`）。
     * Result: Return the branch-computed value (`({ ok: false, code: 'GPG_AGENT_SOURCE_CLOSE_UNCONFIRMED', detail: null })`).
     * 验证场景 / Scenario: cleanup reports fixed refusal, actual exit, JSON/schema/context and transport reasons without remote secrets
     */
    value: () => ({ ok: false, code: 'GPG_AGENT_SOURCE_CLOSE_UNCONFIRMED', detail: null }),
      reason: 'exec code 1; broker refusal GPG_AGENT_SOURCE_CLOSE_UNCONFIRMED' },
    { code: 1, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ok: false, code: 'GPG_AGENT_HOME_DATA_NAME', detail: null })`）。
     * Result: Return the branch-computed value (`({ ok: false, code: 'GPG_AGENT_HOME_DATA_NAME', detail: null })`).
     * 验证场景 / Scenario: cleanup reports fixed refusal, actual exit, JSON/schema/context and transport reasons without remote secrets
     */
    value: () => ({ ok: false, code: 'GPG_AGENT_HOME_DATA_NAME', detail: null }),
      reason: 'exec code 1; broker refusal GPG_AGENT_HOME_DATA_NAME' },
    { code: 7, raw: secret, reason: 'exec code 7; reply JSON invalid' },
    { code: 9, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: ctx: GpgAgentContext。
     * 结果：返回分支计算值（`({ version: 1, ok: true, result: { phase: 'closed', context: ctx, record: null }…`）。
     * Result: Return the branch-computed value (`({ version: 1, ok: true, result: { phase: 'closed', context: ctx, record: null }…`).
     * 验证场景 / Scenario: cleanup reports fixed refusal, actual exit, JSON/schema/context and transport reasons without remote secrets
     */
    value: (ctx: GpgAgentContext) => ({ version: 1, ok: true,
      result: { phase: 'closed', context: ctx, record: null } }), reason: 'exec code 9; unexpected successful reply' },
    { code: 0, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: ctx: GpgAgentContext。
     * 结果：返回分支计算值（`({ version: 1, ok: true, result: { phase: 'closed', context: ctx, record: { ...r…`）。
     * Result: Return the branch-computed value (`({ version: 1, ok: true, result: { phase: 'closed', context: ctx, record: { ...r…`).
     * 验证场景 / Scenario: cleanup reports fixed refusal, actual exit, JSON/schema/context and transport reasons without remote secrets
     * 协作入口 / Collaborators: `record`, `object`.
     */
    value: (ctx: GpgAgentContext) => ({ version: 1, ok: true, result: { phase: 'closed', context: ctx,
      record: { ...record(ctx, 'closed'), home: { ...object('7', 20000, 20000), mode: secret } } } }),
      reason: 'exec code 0; reply schema path result.record.home.mode' },
    { code: 1, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ok: false, code: 'GPG_AGENT_' + secret, detail: null })`）。
     * Result: Return the branch-computed value (`({ ok: false, code: 'GPG_AGENT_' + secret, detail: null })`).
     * 验证场景 / Scenario: cleanup reports fixed refusal, actual exit, JSON/schema/context and transport reasons without remote secrets
     */
    value: () => ({ ok: false, code: 'GPG_AGENT_' + secret, detail: null }), reason: 'exec code 1; reply schema path' },
    { code: 1, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ok: false, code: 'GPG_AGENT_HOME_DATA_OWNER', detail: secret })`）。
     * Result: Return the branch-computed value (`({ ok: false, code: 'GPG_AGENT_HOME_DATA_OWNER', detail: secret })`).
     * 验证场景 / Scenario: cleanup reports fixed refusal, actual exit, JSON/schema/context and transport reasons without remote secrets
     */
    value: () => ({ ok: false, code: 'GPG_AGENT_HOME_DATA_OWNER', detail: secret }), reason: 'exec code 1; reply schema path' },
    { code: 0, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ version: 1, ok: true, result: { phase: 'closed', context: context(), record: …`）。
     * Result: Return the branch-computed value (`({ version: 1, ok: true, result: { phase: 'closed', context: context(), record: …`).
     * 验证场景 / Scenario: cleanup reports fixed refusal, actual exit, JSON/schema/context and transport reasons without remote secrets
     * 协作入口 / Collaborators: `context`.
     */
    value: () => ({ version: 1, ok: true, result: { phase: 'closed', context: context(), record: null } }),
      reason: 'exec code 0; reply context changed' },
    { code: 0, throws: true, reason: 'Agent cleanup transport failed' },
  ];
  for (const candidate of cases) {
    const ctx = context(), id = randomUUID(), live = {}, bridge = owner(ctx), commands: string[] = [];
    let recovered = false;
    const machines = { live: new Map([[id, live]]), /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
     * 验证场景 / Scenario: cleanup reports fixed refusal, actual exit, JSON/schema/context and transport reasons without remote secrets
     * 失败 / Failure: `new Error(secret)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `commands.push`, `JSON.stringify`, `candidate.value!`.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (!recovered && candidate.throws) throw new Error(secret);
      return { code: recovered ? 0 : candidate.code, stderr: secret,
        stdout: recovered ? JSON.stringify({ version: 1, ok: true, result: { phase: 'closed', context: ctx, record: null } })
          : candidate.raw ?? JSON.stringify(candidate.value!(ctx)) };
    } } as unknown as Machines;
    const release = bindTaskGpg(machines, id, ctx, bridge, live as never), scopes = new GpgAgentScopes(machines);
    await assert.rejects(scopes.cleanup(id, ctx), (error: unknown) => {
      assert.ok(error instanceof AppError); assert.equal(error.status, 503);
      assert.equal(error.code, 'PROJECT_IDENTITY_CLEANUP_FAILED'); assert.ok(error.message.includes(candidate.reason), error.message);
      assert.ok(!error.message.includes(secret)); return true;
    });
    release(); assert.equal(isOwnedTaskGpg(machines, id, ctx, bridge), true);
    assert.equal(commands.length, 3); assert.equal(new Set(commands).size, 1);
    recovered = true; await scopes.cleanup(id, ctx);
    assert.equal(commands.length, 4); assert.equal(isOwnedTaskGpg(machines, id, ctx, bridge), false);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a reply from a replaced guest live cannot mark its exact owner cleaned
 * 状态影响 / State effects: `replace`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `context`, `randomUUID`, `owner`, `bindTaskGpg`.
 * 检查边界 / Checked boundaries: `assert.rejects(scopes.cleanup(id, ctx), (error: unknown) => { assert.ok(error instanceof AppError); assert.equal(error.status, 503…`; `assert.equal(attempts, 1)`.
 */
test('a reply from a replaced guest live cannot mark its exact owner cleaned', async () => {
  const ctx = context(), id = randomUUID(), live = {}, replacement = {}, bridge = owner(ctx); let attempts = 0, replace = true;
  const machines = { live: new Map([[id, live]]), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
   * 验证场景 / Scenario: a reply from a replaced guest live cannot mark its exact owner cleaned
   * 协作入口 / Collaborators: `machines.live.set`, `JSON.stringify`, `record`.
   */
  exec: async () => {
    ++attempts; if (replace) machines.live.set(id, replacement as never);
    return { code: 0, stderr: 'REMOTE_SECRET', stdout: JSON.stringify({ version: 1, ok: true,
      result: { phase: 'closed', context: ctx, record: record(ctx, 'closed') } }) };
  } } as unknown as Machines;
  const release = bindTaskGpg(machines, id, ctx, bridge, live as never), scopes = new GpgAgentScopes(machines);
  await assert.rejects(scopes.cleanup(id, ctx), (error: unknown) => {
    assert.ok(error instanceof AppError); assert.equal(error.status, 503);
    assert.equal(error.code, 'PROJECT_IDENTITY_CLEANUP_FAILED');
    assert.ok(error.message.includes('Agent cleanup live changed after exec')); assert.ok(!error.message.includes('REMOTE_SECRET')); return true;
  });
  release(); assert.equal(attempts, 1);
  assert.throws(() => bindTaskGpg(machines, id, ctx, bridge, replacement as never), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  replace = false; await scopes.cleanup(id, ctx); assert.equal(attempts, 2);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unminted bridges, host-hash mismatch and one owner reused for another lease are refused
 * 协作入口 / Collaborators: `context`, `randomUUID`, `owner`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.throws(() => bindTaskGpg(machines, id, ctx, { close: async () => {} } as never, live as never), { code: 'PROJECT_IDENTITY_H…`; `assert.throws(() => bindTaskGpg(machines, id, { ...ctx, resource: { ...ctx.resource, hostHelperSha256: 'd'.repeat(64) } }, bridge,…`.
 */
test('unminted bridges, host-hash mismatch and one owner reused for another lease are refused', async () => {
  const ctx = context(), live = {}, id = randomUUID(), bridge = owner(ctx);
  const machines = { live: new Map([[id, live]]) } as unknown as Machines;
  assert.throws(() => bindTaskGpg(machines, id, ctx, { /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: unminted bridges, host-hash mismatch and one owner reused for another lease are refused
   */
  close: async () => {} } as never, live as never),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.throws(() => bindTaskGpg(machines, id, { ...ctx, resource: { ...ctx.resource, hostHelperSha256: 'd'.repeat(64) } },
    bridge, live as never), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  bindTaskGpg(machines, id, ctx, bridge, live as never);
  assert.throws(() => bindTaskGpg(machines, id, context(), bridge, live as never), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  await bridge.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: record schemas distinguish original and frozen home and reject unknown child directory transitions
 * 状态影响 / State effects: `candidate.homeCleanup.directories[0]!.original.uid`, `candidate.homeCleanup.directories[0]!.original`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `context`, `record`, `assert.equal`, `gpgAgentRecordSchema.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(gpgAgentRecordSchema.safeParse({ ...value, phase: 'ready' }).success, false)`; `assert.equal(gpgAgentRecordSchema.safeParse(candidate).success, true)`.
 */
test('record schemas distinguish original and frozen home and reject unknown child directory transitions', () => {
  const ctx = context(), value = record(ctx, 'closed');
  assert.equal(gpgAgentRecordSchema.safeParse({ ...value, phase: 'ready' }).success, false);
  const original = object('7', 20000, 20000), frozen = { ...original, uid: 0, gid: 0, mode: 0o700 };
  const candidate = { ...value, homeDirectory: object('6', 0, 20000, 0o710), home: original,
    homeCleanup: { phase: 'removing', frozenHome: frozen,
      directories: [{ path: ['private-keys-v1.d'], phase: 'freeze-intent', original: object('9', 20000, 20000),
        frozen: object('9') }] } };
  assert.equal(gpgAgentRecordSchema.safeParse(candidate).success, true);
  assert.equal(gpgAgentRecordSchema.safeParse({ ...candidate, homeCleanup: { ...candidate.homeCleanup,
    frozenHome: { ...frozen, inode: '999' } } }).success, false);
  candidate.homeCleanup.directories[0]!.original.uid = 0;
  assert.equal(gpgAgentRecordSchema.safeParse(candidate).success, false);
  candidate.homeCleanup.directories[0]!.original = object('9', 20000, 20000, 0o755);
  assert.equal(gpgAgentRecordSchema.safeParse(candidate).success, true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: registered backup directories keep exact frozen inode/account checks and reject path traversal
 * 协作入口 / Collaborators: `context`, `object`, `record`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(gpgAgentRecordSchema.safeParse(candidate).success, true)`; `assert.equal(gpgAgentRecordSchema.safeParse({ ...candidate, homeCleanup: { ...candidate.homeCleanup, directories: [{ ...child, pat…`.
 */
test('registered backup directories keep exact frozen inode/account checks and reject path traversal', () => {
  const ctx = context(), home = object('7', ctx.identity.uid, ctx.identity.gid), original = object('8', ctx.identity.uid, ctx.identity.gid);
  const child = { path: ['backup~'], phase: 'frozen', original, frozen: { ...original, uid: 0, gid: 0, mode: 0o700 } };
  const candidate = { ...record(ctx, 'closed'), home, homeDirectory: object('6', 0, ctx.identity.gid, 0o710),
    homeCleanup: { phase: 'removing', frozenHome: { ...home, uid: 0, gid: 0, mode: 0o700 }, directories: [child] } };
  assert.equal(gpgAgentRecordSchema.safeParse(candidate).success, true);
  for (const path of ['.', '..', '../backup~', 'backup~/foreign', 'backup~\\foreign'])
    assert.equal(gpgAgentRecordSchema.safeParse({ ...candidate, homeCleanup: { ...candidate.homeCleanup,
      directories: [{ ...child, path: [path] }] } }).success, false);
  assert.equal(gpgAgentRecordSchema.safeParse({ ...candidate, homeCleanup: { ...candidate.homeCleanup,
    directories: [{ ...child, original: { ...original, uid: original.uid + 1 } }] } }).success, false);
  assert.equal(gpgAgentRecordSchema.safeParse({ ...candidate, homeCleanup: { ...candidate.homeCleanup,
    directories: [{ ...child, frozen: { ...child.frozen, inode: '999' } }] } }).success, false);
});

for (const [scenario, purpose] of Object.entries({ context: 'strict ownership and prepared scope',
  peer: 'all UID/GID values, capabilities, NNP, boot and exact cgroup', protocol: 'binary D, pipelining, statuses, repeated inquiry, END and CAN',
  frames: 'bounded lines, buffered revocation and ancillary FD close', cleanup: 'root freeze and bounded no-follow data removal',
  retry: 'durable child freeze intent after a simulated crash', foreign: 'unknown root child and replaced top inode rejection',
  admission: 'nullable preparation and exactly one scope adoption', absence: 'missing, prepared and closed leases prove exact absence',
  partial: 'known partial home and post-rmdir recovery without guessing routing inodes',
  budgets: '4096 entries, 128 directories, 16 levels and 262144 record bytes',
  source: 'root-private sources pin mode, peer birth, pidfd and all UID/GID values',
  exclusive: 'other prepared records accepted and live source reuse refused',
  modes: 'owned directory modes and exact chown/chmod crash transitions',
  backups: 'GnuPG ~ backups clean under root freeze while foreign UID and replaced directories stay refused',
  'source-close': 'closed original sshd socket residue cleans while live peers, kernel sockets, replacements and neighbors stay protected',
  'source-ended': 'original Linux process retirement distinguishes live births, PID reuse, zombies and unknown read errors',
  'source-kernel': 'exact Unix kernel socket paths and table budgets gate residual inode removal' })) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `spawnSync`, `fileURLToPath`, `assert.equal`, `assert.deepEqual`.
   * 检查边界 / Checked boundaries: `assert.equal(result.status, 0, result.stderr || result.error?.message)`; `assert.deepEqual(JSON.parse(result.stdout), { scenario, passed: true, modelOnly: true })`.
   */
  test(`production Python broker model: ${purpose}`, () => {
    const result = spawnSync('python', ['-I', '-S', fileURLToPath(new URL('./gpg-agent-broker-model.py', import.meta.url)),
      scenario, fileURLToPath(new URL('../server/gpg-agent-broker.py', import.meta.url))], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.deepEqual(JSON.parse(result.stdout), { scenario, passed: true, modelOnly: true });
  });
}
