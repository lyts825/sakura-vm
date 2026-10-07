/**
 * 模块职责：回归验证模块，围绕 `ha-witness-maintenance` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ha-witness-maintenance`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: target and threshold replacement require a withdrawn source entry and preserve failed-attempt evidence; CLI migration refuses an active lock and never replaces an unknown legacy phase.
 */
const peerHandlers = new WeakMap<InstanceType<typeof HostPeers>, import('../server/host-peers.ts').HostPeerDependencies>();
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import { createServer as createTcpServer } from 'node:net';
import { join, resolve } from 'node:path';
import { generate } from 'selfsigned';
import { HaWitness, type HaWitnessReplicaInventory } from '../server/ha-witness-core.ts';
import { HaWitnessClient } from '../server/ha-witness-client.ts';
import { haWitnessServerConfigSchema, startHaWitnessServer, witnessVms } from '../server/ha-witness-server.ts';
import { maintainHaWitnessState } from '../server/ha-witness-maintenance.ts';
import { createHostImportReceiver } from '../server/host-import-receiver.ts';
import { HostPeers } from '../server/host-peers.ts';
import { haHttpsRequest } from '../server/ha-witness-http.ts';
import type { Machines } from '../server/machines.ts';
import type { Bundles } from '../server/bundles.ts';

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: request: import('node:http').IncomingMessage。
 * 结果：返回分支计算值（`body ? JSON.parse(body) : null`），以 Promise 交付。
 * Result: Return the branch-computed value (`body ? JSON.parse(body) : null`) through a Promise.
 * 状态影响 / State effects: `body`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `chunk.toString`, `JSON.parse`.
 */
async function input(request: import('node:http').IncomingMessage) {
  let body = '';
  for await (const chunk of request) body += chunk.toString();
  return body ? JSON.parse(body) : null;
}
/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: server: Server。
 * 结果：返回分支计算值（``https://127.0.0.1:${address.port}/``），以 Promise 交付。
 * Result: Return the branch-computed value (``https://127.0.0.1:${address.port}/``) through a Promise.
 * 失败 / Failure: `new Error('missing port')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `server.address`.
 */
async function listen(server: Server) {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  return `https://127.0.0.1:${address.port}/`;
}

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `root, config, options, plan, first, replicas, sourceHostId, sourceVmId, targetHostId`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `root, config, options, plan, first, replicas, sourceHostId, sourceVmId, targetHostId`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `resolve`, `mkdir`, `mkdtemp`, `join`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture() {
  const parent = resolve('artifacts', 'ha-witness-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'maintenance-'));
  const cert = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
    notBeforeDate: new Date(Date.now() - 60_000), notAfterDate: new Date(Date.now() + 3600_000),
  });
  const fingerprint = new X509Certificate(cert.cert).fingerprint256;
  const sourceToken = randomBytes(32).toString('hex'), targetToken = randomBytes(32).toString('hex');
  const nextTargetToken = randomBytes(32).toString('hex'), appToken = randomBytes(32).toString('hex');
  const trafficToken = randomBytes(32).toString('hex');
  const sourceHostId = randomUUID(), sourceVmId = randomUUID(), targetHostId = randomUUID();
  const nextTargetHostId = randomUUID(), systemUuid = randomUUID();
  const identity = { sourceHostId, sourceVmId, targetHostId };
  const first = { ...identity, transferId: randomUUID(), remoteVmId: randomUUID(),
    snapshotId: randomUUID(), sha256: 'a'.repeat(64) };
  const history = { ...identity, transferId: randomUUID(), remoteVmId: randomUUID(),
    snapshotId: randomUUID(), sha256: 'b'.repeat(64) };
  const plan = { ...first, snapshotAt: new Date().toISOString(), maxReplicaAgeMinutes: 60 };
  let powerState = 'On', activeVmId: string = sourceVmId, controlWrites = 0;
  let loseRetireResponse = false, incompleteInventory = false, wrongInventoryIdentity = false;
  let extraOnRetire = false;
  const replicas: HaWitnessReplicaInventory['replicas'] = [
    { identity: first, status: 'stopped', retirement: null },
    { identity: history, status: 'stopped', retirement: null },
  ];
  const adapter = createServer({ cert: cert.cert, key: cert.private }, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: req; res。
   * 结果：返回分支计算值（`void (async () => { const url = new URL(req.url!, 'https://localhost'); if (url.…`）。
   * Result: Return the branch-computed value (`void (async () => { const url = new URL(req.url!, 'https://localhost'); if (url.…`).
   * 协作入口 / Collaborators: `(async () => { const url = new URL(req.url!, 'https://localhost'); if (url.…`.
   */
  (req, res) => void (/**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `replica.retirement`, `extraOnRetire`, `loseRetireResponse`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `assert.equal`, `res.end`, `JSON.stringify`, `res.writeHead`.
   * 检查边界 / Checked boundaries: `assert.equal(req.method, 'GET')`; `assert.equal(req.headers.authorization, `Bearer ${trafficToken}`)`.
   */
  async () => {
    const url = new URL(req.url!, 'https://localhost');
    if (url.pathname === '/redfish/v1/Systems/1') {
      assert.equal(req.method, 'GET');
      res.end(JSON.stringify({ UUID: systemUuid, PowerState: powerState })); return;
    }
    if (url.pathname === '/peer/status') {
      const id = req.headers.authorization === `Bearer ${targetToken}` ? targetHostId
        : req.headers.authorization === `Bearer ${nextTargetToken}` ? nextTargetHostId : null;
      if (!id) { res.writeHead(401); res.end('{}'); return; }
      res.end(JSON.stringify({ version: 1, id })); return;
    }
    if (url.pathname === '/status') {
      assert.equal(req.headers.authorization, `Bearer ${trafficToken}`);
      assert.equal(url.searchParams.get('sourceVmId'), sourceVmId);
      res.end(JSON.stringify({ activeVmId })); return;
    }
    assert.equal(req.headers.authorization, `Bearer ${targetToken}`);
    if (url.pathname === '/peer/replicas-status') {
      assert.equal(url.searchParams.get('sourceVmId'), sourceVmId);
      res.end(JSON.stringify({ version: 1, hostId: targetHostId, sourceHostId,
        sourceVmId: wrongInventoryIdentity ? randomUUID() : sourceVmId,
        complete: !incompleteInventory, replicas })); return;
    }
    const body = await input(req);
    const replica = replicas.find((item) => item.identity.remoteVmId === body.remoteVmId);
    assert.ok(replica);
    const expected = replica.identity;
    assert.deepEqual(body, { transferId: expected.transferId, remoteVmId: expected.remoteVmId,
      sourceVmId, snapshotId: expected.snapshotId, sha256: expected.sha256 });
    if (url.pathname === '/peer/replica-activate-check') {
      res.end(JSON.stringify({ ready: true, id: expected.remoteVmId, status: replica.status })); return;
    }
    assert.equal(url.pathname, '/peer/replica-retire');
    controlWrites++;
    if (replica.status !== 'stopped') { res.writeHead(409); res.end('{}'); return; }
    replica.retirement = { ...expected, retiredAt: new Date().toISOString() };
    if (extraOnRetire) {
      extraOnRetire = false;
      replicas.push({ identity: { ...history, transferId: randomUUID(),
        remoteVmId: randomUUID(), snapshotId: randomUUID() }, status: 'stopped', retirement: null });
    }
    if (loseRetireResponse) {
      loseRetireResponse = false; res.writeHead(503); res.end('{}'); return;
    }
    res.end(JSON.stringify({ id: expected.remoteVmId, retired: true }));
  })().catch((error) => { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }));
  const baseUrl = await listen(adapter);
  const certFile = join(root, 'cert.pem'), keyFile = join(root, 'key.pem');
  await writeFile(certFile, cert.cert); await writeFile(keyFile, cert.private);
  const config = haWitnessServerConfigSchema.parse({ version: 1,
    stateFile: join(root, 'state.json'), sourceToken,
    listen: { host: '127.0.0.1', port: 0, certFile, keyFile },
    vms: [{ sourceHostId, sourceVmId, targetHostId, failureThreshold: 2,
      redfish: { baseUrl, systemPath: '/redfish/v1/Systems/1', systemUuid,
        username: 'user', password: 'password', fingerprint },
      target: { baseUrl, token: targetToken, fingerprint },
      application: { url: `${baseUrl}health`, token: appToken, fingerprint },
      traffic: { baseUrl, token: trafficToken, fingerprint } }] });
  await HaWitness.initialize(config.stateFile, witnessVms(config));
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: label: string; mode: 'migrate' | 'reconfigure' | 'recover' = 'migrate'。
   * 结果：返回分支计算值（`({ mode, backupFile: join(root, `${label}-original.json`), output: join(root, `$…`）。
   * Result: Return the branch-computed value (`({ mode, backupFile: join(root, `${label}-original.json`), output: join(root, `$…`).
   * 协作入口 / Collaborators: `join`.
   */
  const options = (label: string, mode: 'migrate' | 'reconfigure' | 'recover' = 'migrate') => ({
    mode, backupFile: join(root, `${label}-original.json`), output: join(root, `${label}-receipt.json`),
  });
  return { root, config, options, plan, first, replicas, sourceHostId, sourceVmId, targetHostId,
    nextTargetHostId, nextTargetToken, sourceToken, fingerprint,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `powerState`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    power: (value: string) => { powerState = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `activeVmId`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    traffic: (value: string) => { activeVmId = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `loseRetireResponse`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    loseRetire: () => { loseRetireResponse = true; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `incompleteInventory`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    incomplete: (value: boolean) => { incompleteInventory = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `wrongInventoryIdentity`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    wrongIdentity: (value: boolean) => { wrongInventoryIdentity = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `extraOnRetire`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    addDuringRetire: () => { extraOnRetire = true; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`controlWrites`）。
     * Result: Return the branch-computed value (`controlWrites`).
     */
    controlWrites: () => controlWrites,
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`new Promise<void>((done) => adapter.close(() => done()))`）。
     * Result: Return the branch-computed value (`new Promise<void>((done) => adapter.close(() => done()))`).
     */
    close: () => new Promise<void>((done) => adapter.close(() => done())),
  };
}

for (const phase of ['source', 'fencing', 'fenced', 'promoted'] as const)
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `old.version`, `old.entries[f.sourceVmId]`, `f.replicas[0].status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `fixture`, `JSON.parse`, `readFile`, `f.power`.
   * 检查边界 / Checked boundaries: `assert.equal(result.ok, true)`; `assert.deepEqual(await readFile(f.options('migration').backupFile), before)`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test(`explicit legacy migration preserves ${phase} authority and performs only external reads`, async () => {
    const f = await fixture();
    try {
      const old = JSON.parse(await readFile(f.config.stateFile, 'utf8'));
      old.version = phase === 'source' ? 2 : 3;
      if (old.version === 2) delete old.bindings[f.sourceVmId].sourceSystemUuid;
      old.entries[f.sourceVmId] = { phase, plan: f.plan, lastHeartbeatAt: 123456,
        ...(phase === 'fenced' || phase === 'promoted' ? { fencedAt: 123457 } : {}) };
      if (phase === 'fenced' || phase === 'promoted') f.power('Off');
      if (phase === 'promoted') { f.replicas[0].status = 'running'; f.traffic(f.plan.remoteVmId); }
      await writeFile(f.config.stateFile, JSON.stringify(old));
      const before = await readFile(f.config.stateFile);
      const result = await maintainHaWitnessState(f.config, f.config, f.options('migration'));
      assert.equal(result.ok, true);
      assert.deepEqual(await readFile(f.options('migration').backupFile), before);
      const migrated = JSON.parse(await readFile(f.config.stateFile, 'utf8'));
      assert.equal(migrated.version, 4);
      assert.equal(migrated.entries[f.sourceVmId].phase, phase);
      assert.deepEqual(migrated.entries[f.sourceVmId].plan, f.plan);
      assert.equal(f.controlWrites(), 0);
    } finally { await f.close(); }
  });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: target and threshold replacement require a withdrawn source entry and preserve failed-attempt evidence
 * 状态影响 / State effects: `current.entries[f.sourceVmId]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `JSON.parse`, `readFile`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.equal(denied.ok, false)`; `assert.equal(denied.stateChanged, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('target and threshold replacement require a withdrawn source entry and preserve failed-attempt evidence', async () => {
  const f = await fixture();
  try {
    const current = JSON.parse(await readFile(f.config.stateFile, 'utf8'));
    const next = { ...f.config, vms: [{ ...f.config.vms[0], targetHostId: f.nextTargetHostId,
      failureThreshold: 3, target: { ...f.config.vms[0].target, token: f.nextTargetToken } }] };
    current.entries[f.sourceVmId] = { phase: 'promoted', plan: f.plan, lastHeartbeatAt: 123 };
    await writeFile(f.config.stateFile, JSON.stringify(current));
    const before = await readFile(f.config.stateFile);
    const denied = await maintainHaWitnessState(f.config, next, f.options('active-denial', 'reconfigure'));
    assert.equal(denied.ok, false);
    assert.equal(denied.stateChanged, false);
    assert.deepEqual(await readFile(f.config.stateFile), before);
    assert.deepEqual(await readFile(f.options('active-denial').backupFile), before);
    assert.equal(JSON.parse(await readFile(f.options('active-denial').output, 'utf8')).status, 'rejected');
    current.entries[f.sourceVmId] = { phase: 'source', plan: null, lastHeartbeatAt: 123 };
    await writeFile(f.config.stateFile, JSON.stringify(current));
    f.traffic(randomUUID());
    assert.equal((await maintainHaWitnessState(f.config, next,
      f.options('route-denial', 'reconfigure'))).ok, false);
    f.traffic(f.sourceVmId);
    const changed = await maintainHaWitnessState(f.config, next, f.options('changed', 'reconfigure'));
    assert.equal(changed.ok, true);
    const result = JSON.parse(await readFile(f.config.stateFile, 'utf8'));
    assert.equal(result.bindings[f.sourceVmId].targetHostId, f.nextTargetHostId);
    assert.equal(result.bindings[f.sourceVmId].failureThreshold, 3);
    assert.equal(result.entries[f.sourceVmId].plan, null);
    assert.equal(f.controlWrites(), 0);
    const configured = new HaWitness(f.config.stateFile, witnessVms(next), {
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: target and threshold replacement require a withdrawn source entry and preserve failed-attempt evidence
       */
      fence: async () => {}, /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: target and threshold replacement require a withdrawn source entry and preserve failed-attempt evidence
       */
      confirmFence: async () => {}, /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`'stopped'`），以 Promise 交付。
       * Result: Return the branch-computed value (`'stopped'`) through a Promise.
       * 验证场景 / Scenario: target and threshold replacement require a withdrawn source entry and preserve failed-attempt evidence
       */
      targetStatus: async () => 'stopped',
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: target and threshold replacement require a withdrawn source entry and preserve failed-attempt evidence
       */
      activate: async () => {}, /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回布尔判定，供用例选择路径或核对受控条件。
       * Result: Return a boolean decision for path selection or controlled-condition assertions.
       * 验证场景 / Scenario: target and threshold replacement require a withdrawn source entry and preserve failed-attempt evidence
       */
      applicationReady: async () => false, /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: target and threshold replacement require a withdrawn source entry and preserve failed-attempt evidence
       */
      switchTraffic: async () => {},
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`f.sourceVmId`），以 Promise 交付。
       * Result: Return the branch-computed value (`f.sourceVmId`) through a Promise.
       * 验证场景 / Scenario: target and threshold replacement require a withdrawn source entry and preserve failed-attempt evidence
       */
      trafficTarget: async () => f.sourceVmId, /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: target and threshold replacement require a withdrawn source entry and preserve failed-attempt evidence
       */
      retire: async () => {},
    });
    await configured.init();
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: CLI migration refuses an active lock and never replaces an unknown legacy phase
 * 状态影响 / State effects: `service`, `unknown.version`, `unknown.entries[f.sourceVmId].phase`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `join`, `writeFile`, `JSON.stringify`.
 * 检查边界 / Checked boundaries: `assert.rejects(maintainHaWitnessState(f.config, f.config, f.options('busy')), { code: 'HA_WITNESS_STATE_LOCKED' })`; `assert.rejects(promisify(execFile)(process.execPath, [ '--import', 'tsx', 'scripts/ha-witness.ts', '--migrate', configPath, '--bac…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('CLI migration refuses an active lock and never replaces an unknown legacy phase', async () => {
  const f = await fixture();
  let service: Awaited<ReturnType<typeof startHaWitnessServer>> | undefined;
  try {
    const configPath = join(f.root, 'config.json');
    await writeFile(configPath, JSON.stringify(f.config));
    service = await startHaWitnessServer(f.config);
    await assert.rejects(maintainHaWitnessState(f.config, f.config, f.options('busy')),
      { code: 'HA_WITNESS_STATE_LOCKED' });
    await service.close(); service = undefined;
    const unknown = JSON.parse(await readFile(f.config.stateFile, 'utf8'));
    unknown.version = 3; unknown.entries[f.sourceVmId].phase = 'unknown';
    await writeFile(f.config.stateFile, JSON.stringify(unknown));
    const before = await readFile(f.config.stateFile);
    await assert.rejects(promisify(execFile)(process.execPath, [
      '--import', 'tsx', 'scripts/ha-witness.ts', '--migrate', configPath,
      '--backup', f.options('unknown').backupFile, '--output', f.options('unknown').output,
    ], { cwd: process.cwd(), windowsHide: true }));
    assert.deepEqual(await readFile(f.config.stateFile), before);
    assert.equal(JSON.parse(await readFile(f.options('unknown').output, 'utf8')).stateChanged, false);
  } finally { await service?.close(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: damaged-state recovery holds all authority until every historical replica is stopped and retired
 * 状态影响 / State effects: `backup.entries[f.sourceVmId].plan`, `service`, `f.replicas[1].status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 失败 / Failure: `new Error('witness port missing')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `fixture`, `JSON.parse`, `readFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(result.ok, true)`; `assert.equal(await readFile(options.backupFile, 'utf8'), '{damaged authority')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('damaged-state recovery holds all authority until every historical replica is stopped and retired', async () => {
  const f = await fixture();
  let service: Awaited<ReturnType<typeof startHaWitnessServer>> | undefined;
  try {
    const backup = JSON.parse(await readFile(f.config.stateFile, 'utf8'));
    backup.entries[f.sourceVmId].plan = f.plan;
    const historical = join(f.root, 'known-backup.json');
    await writeFile(historical, JSON.stringify(backup));
    await writeFile(f.config.stateFile, '{damaged authority');
    const options = { ...f.options('recover', 'recover'), recoveryStateFile: historical };
    const result = await maintainHaWitnessState(f.config, f.config, options);
    assert.equal(result.ok, true);
    assert.equal(await readFile(options.backupFile, 'utf8'), '{damaged authority');
    const held = JSON.parse(await readFile(f.config.stateFile, 'utf8'));
    assert.equal(held.entries[f.sourceVmId].phase, 'source');
    assert.ok(held.entries[f.sourceVmId].recoveryHold);
    service = await startHaWitnessServer(f.config);
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('witness port missing');
    const client = new HaWitnessClient({ version: 1, token: f.sourceToken, fingerprint: f.fingerprint,
      url: `https://127.0.0.1:${address.port}/` });
    const identity = { sourceHostId: f.sourceHostId, sourceVmId: f.sourceVmId };
    await assert.rejects(client.authorizeStart(identity));
    await assert.rejects(client.heartbeat({ ...identity, failureThreshold: 2, plan: null }));
    await service.witness.sample();
    assert.equal(f.controlWrites(), 0, 'recovery hold must not fence or start anything');
    f.replicas[1].status = 'running';
    await assert.rejects(client.rejoin({ ...identity, dataReconciled: true }));
    assert.equal(f.controlWrites(), 0, 'historical running replica blocks all retirement work');
    f.replicas[1].status = 'stopped'; f.incomplete(true);
    await assert.rejects(client.rejoin({ ...identity, dataReconciled: true }));
    f.incomplete(false); f.wrongIdentity(true);
    await assert.rejects(client.rejoin({ ...identity, dataReconciled: true }));
    f.wrongIdentity(false); f.traffic(randomUUID());
    await assert.rejects(client.rejoin({ ...identity, dataReconciled: true }));
    assert.equal(f.controlWrites(), 0);
    f.traffic(f.sourceVmId); f.loseRetire();
    await assert.rejects(client.rejoin({ ...identity, dataReconciled: true }));
    assert.equal((await client.status(identity)).recoveryHeld, true);
    assert.equal(f.replicas[0].retirement?.remoteVmId, f.first.remoteVmId);
    await service.close(); service = await startHaWitnessServer({ ...f.config,
      listen: { ...f.config.listen, port: address.port } });
    await assert.rejects(client.authorizeStart(identity));
    f.addDuringRetire();
    await assert.rejects(client.rejoin({ ...identity, dataReconciled: true }));
    assert.equal((await client.status(identity)).recoveryHeld, true);
    const recovered = await client.rejoin({ ...identity, dataReconciled: true });
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.retiredVmIds?.length, 3);
    assert.ok(f.replicas.every((item) => item.retirement?.remoteVmId === item.identity.remoteVmId));
    await client.authorizeStart(identity);
    const writes = f.controlWrites();
    assert.deepEqual(await client.rejoin({ ...identity, dataReconciled: true }), recovered);
    assert.equal(f.controlWrites(), writes, 'lost successful rejoin ACK uses the durable complete receipt');
    await writeFile(join(f.root, 'recovery-result.json'), JSON.stringify({ ok: true,
      recovered, controlWrites: writes }, null, 2));
  } finally { await service?.close(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: production inventory includes starting and retired histories while excluding other authenticated origins
 * 状态影响 / State effects: `otherHost.migrationOrigin.sourceHostId`, `otherSource.migrationOrigin.sourceVmId`, `retired.haRetirement.snapshotId`, `first.migrationOrigin.sourceVmId`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `make`, `new Date().toISOString`, `[first, retired, otherHost, otherSource].map`.
 * 检查边界 / Checked boundaries: `assert.equal(result.complete, true)`; `assert.equal(result.replicas.length, 2)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('production inventory includes starting and retired histories while excluding other authenticated origins', async () => {
  const sourceHostId = randomUUID(), sourceVmId = randomUUID(), targetHostId = randomUUID();
  /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id: randomUUID(), migrationOrigin: { sourceHostId, sourceVmId, transferId: ra…`）。
   * Result: Return the branch-computed value (`({ id: randomUUID(), migrationOrigin: { sourceHostId, sourceVmId, transferId: ra…`).
   * 验证场景 / Scenario: production inventory includes starting and retired histories while excluding other authenticated origins
   * 协作入口 / Collaborators: `randomUUID`, `'a'.repeat`.
   */
  const make = () => ({ id: randomUUID(), migrationOrigin: { sourceHostId, sourceVmId,
    transferId: randomUUID(), snapshotId: randomUUID(), diskSha256: 'a'.repeat(64), targetName: 'ha' } });
  const first = make(), second = make(), otherHost = make(), otherSource = make();
  otherHost.migrationOrigin.sourceHostId = randomUUID();
  otherSource.migrationOrigin.sourceVmId = randomUUID();
  const retired = { ...second, haRetirement: { sourceHostId, sourceVmId,
    transferId: second.migrationOrigin.transferId, snapshotId: second.migrationOrigin.snapshotId,
    sha256: second.migrationOrigin.diskSha256, retiredAt: new Date().toISOString() } };
  const records = new Map([first, retired, otherHost, otherSource].map((vm) => [vm.id, vm]));
  const machines = { records, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: id: string。
   * 结果：返回分支计算值（`id === first.id ? 'starting' : 'stopped'`）。
   * Result: Return the branch-computed value (`id === first.id ? 'starting' : 'stopped'`).
   * 验证场景 / Scenario: production inventory includes starting and retired histories while excluding other authenticated origins
   */
  state: (id: string) => id === first.id ? 'starting' : 'stopped' } as unknown as Machines;
  const receiver = createHostImportReceiver(machines, { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({} as Bundles)`）。
   * Result: Return the branch-computed value (`({} as Bundles)`).
   * 验证场景 / Scenario: production inventory includes starting and retired histories while excluding other authenticated origins
   */
  bundles: () => ({} as Bundles),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: production inventory includes starting and retired histories while excluding other authenticated origins
     * 失败 / Failure: `new Error('background inventory must not require browser unlock')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    requireSessionUnlocked: () => { throw new Error('background inventory must not require browser unlock'); },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回布尔判定，供用例选择路径或核对受控条件。
     * Result: Return a boolean decision for path selection or controlled-condition assertions.
     * 验证场景 / Scenario: production inventory includes starting and retired histories while excluding other authenticated origins
     */
    migrationBlocked: () => false });
  const result = await receiver.inspectReplicas!({ requesterId: sourceHostId, sourceVmId, targetHostId });
  assert.equal(result.complete, true);
  assert.equal(result.replicas.length, 2);
  assert.equal(result.replicas.find((item) => item.identity.remoteVmId === first.id)?.status, 'starting');
  assert.equal(result.replicas.find((item) => item.identity.remoteVmId === second.id)?.retirement?.sha256,
    second.migrationOrigin.diskSha256);
  retired.haRetirement.snapshotId = randomUUID();
  await assert.rejects(receiver.inspectReplicas!({ requesterId: sourceHostId, sourceVmId, targetHostId }),
    /退役证据与导入记录不一致/);
  retired.haRetirement.snapshotId = second.migrationOrigin.snapshotId;
  Reflect.deleteProperty(first.migrationOrigin, 'sourceVmId');
  await assert.rejects(receiver.inspectReplicas!({ requesterId: sourceHostId, sourceVmId, targetHostId }),
    /归属不完整/);
  first.migrationOrigin.sourceVmId = sourceVmId;
  Reflect.deleteProperty(first.migrationOrigin, 'snapshotId');
  await assert.rejects(receiver.inspectReplicas!({ requesterId: sourceHostId, sourceVmId, targetHostId }),
    /归属不完整/);
});

for (const phase of ['fenced', 'promoted'] as const)
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `old.version`, `old.entries[f.sourceVmId]`, `service`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `fixture`, `JSON.parse`, `readFile`, `join`.
   * 检查边界 / Checked boundaries: `assert.equal(recovered.ok, true)`; `assert.equal(f.controlWrites(), 0, 'restored active phase must not run old fencing or promotion work')`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test(`recovery of a complete ${phase} legacy plan stays held across startup and retires every transfer`, async () => {
    const f = await fixture();
    let service: Awaited<ReturnType<typeof startHaWitnessServer>> | undefined;
    try {
      const old = JSON.parse(await readFile(f.config.stateFile, 'utf8'));
      old.version = 3;
      old.entries[f.sourceVmId] = { phase, plan: f.plan, lastHeartbeatAt: 123,
        fencedAt: 124, ...(phase === 'promoted' ? { promotedAt: 125 } : {}) };
      const known = join(f.root, 'legacy-backup.json');
      await writeFile(known, JSON.stringify(old));
      await writeFile(f.config.stateFile, 'damaged');
      const recovered = await maintainHaWitnessState(f.config, f.config,
        { ...f.options('legacy-recover', 'recover'), recoveryStateFile: known });
      assert.equal(recovered.ok, true);
      service = await startHaWitnessServer(f.config);
      await service.witness.sample();
      assert.equal(f.controlWrites(), 0, 'restored active phase must not run old fencing or promotion work');
      const identity = { sourceHostId: f.sourceHostId, sourceVmId: f.sourceVmId };
      await assert.rejects(service.witness.authorizeStart(identity));
      await service.witness.rejoin({ ...identity, dataReconciled: true });
      assert.ok(f.replicas.every((item) => !!item.retirement));
      assert.equal((await service.witness.authorizeStart(identity)).allowed, true);
    } finally { await service?.close(); await f.close(); }
  });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: missing state can be recovered only into a durable hold and leaves a missing-original record
 * 状态影响 / State effects: `service`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `join`, `rename`, `f.options`.
 * 检查边界 / Checked boundaries: `assert.equal(result.ok, true)`; `assert.equal(JSON.parse(await readFile(options.output, 'utf8')).missingOriginal, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('missing state can be recovered only into a durable hold and leaves a missing-original record', async () => {
  const f = await fixture();
  let service: Awaited<ReturnType<typeof startHaWitnessServer>> | undefined;
  try {
    const known = join(f.root, 'known-before-loss.json');
    await rename(f.config.stateFile, known);
    const options = { ...f.options('missing-recover', 'recover'), recoveryStateFile: known };
    const result = await maintainHaWitnessState(f.config, f.config, options);
    assert.equal(result.ok, true);
    assert.equal(JSON.parse(await readFile(options.output, 'utf8')).missingOriginal, true);
    assert.equal(JSON.parse(await readFile(options.backupFile, 'utf8')).kind, 'sakura-ha-missing-state');
    service = await startHaWitnessServer(f.config);
    await assert.rejects(service.witness.authorizeStart({ sourceHostId: f.sourceHostId, sourceVmId: f.sourceVmId }));
    await service.witness.sample();
    assert.equal(f.controlWrites(), 0);
  } finally { await service?.close(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: real paired inventory endpoint binds its requester and requires import plus failover permission
 * 状态影响 / State effects: `wrongReply`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 失败 / Failure: `new Error('missing port')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `resolve`, `mkdir`, `mkdtemp`, `join`.
 * 检查边界 / Checked boundaries: `assert.ok('pairing' in issued && issued.pairing)`; `assert.rejects(readInventory(), /HTTP 403/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('real paired inventory endpoint binds its requester and requires import plus failover permission', async () => {
  const parent = resolve('artifacts', 'ha-witness-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'inventory-peer-'));
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ platform: 'win32', arch: 'x64', cpus: 8, memoryTotal: 16 * 1024 ** 3, memoryF…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ platform: 'win32', arch: 'x64', cpus: 8, memoryTotal: 16 * 1024 ** 3, memoryF…`) through a Promise.
   * 验证场景 / Scenario: real paired inventory endpoint binds its requester and requires import plus failover permission
   */
  const metrics = async () => ({ platform: 'win32', arch: 'x64', cpus: 8,
    memoryTotal: 16 * 1024 ** 3, memoryFree: 8 * 1024 ** 3,
    load: [0, 0, 0], vmCount: 2, runningVms: 0 });
  const portServer = createTcpServer();
  await new Promise<void>((done) => portServer.listen(0, '127.0.0.1', done));
  const address = portServer.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  await new Promise<void>((done) => portServer.close(() => done()));
  const target = new HostPeers(metrics, join(root, 'target.json'), 'Inventory target', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  const sourceFile = join(root, 'source.json');
  const source = new HostPeers(metrics, sourceFile, 'Inventory source', undefined, undefined, undefined, peer => peerHandlers.get(peer) || {});
  try {
    await target.init(false); await source.init(false);
    await target.configure({ operation: 'listener', listener: {
      enabled: true, host: '127.0.0.1', port: address.port } });
    await target.init(true);
    const issued = await target.configure({ operation: 'create-code' });
    assert.ok('pairing' in issued && issued.pairing);
    const url = `https://127.0.0.1:${address.port}/`;
    await source.configure({ operation: 'connect', url, fingerprint: target.view().fingerprint,
      code: issued.pairing.value });
    const sourceVmId = randomUUID();
    const expectedSource = source.view().hostId, expectedTarget = target.view().hostId;
    let wrongReply = false, calls = 0;
    peerHandlers.set(target, { ...peerHandlers.get(target), importReceiver: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`null`），以 Promise 交付。
     * Result: Return the branch-computed value (`null`) through a Promise.
     * 验证场景 / Scenario: real paired inventory endpoint binds its requester and requires import plus failover permission
     */
    status: async () => null,
      /**
       * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
       * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: real paired inventory endpoint binds its requester and requires import plus failover permission
       * 失败 / Failure: `new Error('read-only inventory cannot import')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      receive: async () => { throw new Error('read-only inventory cannot import'); },
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: { requesterId, sourceVmId: requeste…。
       * 结果：返回受控对象，公开字段包括 `version, complete, hostId, sourceHostId, sourceVmId, replicas`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `version, complete, hostId, sourceHostId, sourceVmId, replicas`; the actual branch determines its shape.
       * 验证场景 / Scenario: real paired inventory endpoint binds its requester and requires import plus failover permission
       * 协作入口 / Collaborators: `assert.equal`, `randomUUID`.
       * 检查边界 / Checked boundaries: `assert.equal(requesterId, expectedSource)`; `assert.equal(requested, sourceVmId)`.
       */
      inspectReplicas: async ({ requesterId, sourceVmId: requested, targetHostId }) => {
        assert.equal(requesterId, expectedSource); assert.equal(requested, sourceVmId);
        assert.equal(targetHostId, expectedTarget); calls++;
        return { version: 1, complete: true, hostId: wrongReply ? randomUUID() : targetHostId,
          sourceHostId: requesterId, sourceVmId: requested, replicas: [] };
      } } });
    const credentials = JSON.parse(await readFile(sourceFile, 'utf8')).outbound[0];
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: query = `sourceVmId=${sourceVmId}`。
     * 结果：返回分支计算值（`haHttpsRequest( `${url}peer/replicas-status?${query}`, 'GET', undefined, { beare…`）。
     * Result: Return the branch-computed value (`haHttpsRequest( `${url}peer/replicas-status?${query}`, 'GET', undefined, { beare…`).
     * 验证场景 / Scenario: real paired inventory endpoint binds its requester and requires import plus failover permission
     * 协作入口 / Collaborators: `haHttpsRequest`, `target.view`.
     */
    const readInventory = (query = `sourceVmId=${sourceVmId}`) => haHttpsRequest(
      `${url}peer/replicas-status?${query}`, 'GET', undefined,
      { bearer: credentials.token, fingerprint: target.view().fingerprint });
    await assert.rejects(readInventory(), /HTTP 403/);
    const inboundId = target.view().incoming[0].id;
    await target.configure({ operation: 'allow-import', id: inboundId, enabled: true });
    await assert.rejects(readInventory(), /HTTP 403/);
    await target.configure({ operation: 'allow-failover', id: inboundId, enabled: true });
    const listed = await readInventory() as HaWitnessReplicaInventory;
    assert.equal(listed.complete, true); assert.equal(listed.sourceHostId, expectedSource);
    assert.equal(calls, 1);
    await assert.rejects(readInventory(`sourceVmId=${sourceVmId}&sourceHostId=${randomUUID()}`), /HTTP 400/);
    wrongReply = true;
    await assert.rejects(readInventory(), /HTTP 409/);
    await target.configure({ operation: 'allow-failover', id: inboundId, enabled: false });
    await assert.rejects(readInventory(), /HTTP 403/);
  } finally { await source.close(); await target.close(); }
});
