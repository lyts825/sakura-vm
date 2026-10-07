/**
 * 模块职责：回归验证模块，围绕 `remote-audit` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `remote-audit`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: remote audit requires object lock, anchors verified heads, renews retention and detects tampering; S3 adapter sends checksum and compliance retention and reads the exact locked version.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLog, type AuditEvent } from '../server/audit.ts';
import {
  RemoteAuditLock,
  S3RemoteAuditStore,
  type RemoteAuditObject,
  type RemoteAuditStore,
  type RemoteAuditTarget,
} from '../server/remote-audit.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-remote-audit-'));
assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
after(() => rm(root, { recursive: true, force: true }));
const event: AuditEvent = {
  time: '2026-09-26T10:00:00.000Z',
  phase: 'start',
  kind: 'request',
  name: 'POST /api/vms',
  traceId: '1'.repeat(32),
  spanId: '2'.repeat(16),
};
const target: RemoteAuditTarget = {
  bucket: 'locked-audit-bucket',
  region: 'us-east-1',
  prefix: 'team/audit',
  retentionDays: 7,
};

class MemoryStore implements RemoteAuditStore {
  enabled = false;
  objects = new Map<string, RemoteAuditObject>();
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`this.enabled`），以 Promise 交付。
   * Result: Return the branch-computed value (`this.enabled`) through a Promise.
   */
  async locked() {
    return this.enabled;
  }
  /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: _target: RemoteAuditTarget; key: string; body: string; retainUntil: Date。
   * 结果：返回分支计算值（`versionId`），以 Promise 交付。
   * Result: Return the branch-computed value (`versionId`) through a Promise.
   * 失败 / Failure: `new Error('duplicate')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `this.objects.has`, `String`, `this.objects.set`.
   */
  async put(_target: RemoteAuditTarget, key: string, body: string, retainUntil: Date) {
    if (this.objects.has(key)) throw new Error('duplicate');
    const versionId = String(this.objects.size + 1);
    this.objects.set(key, { body, versionId, mode: 'COMPLIANCE', retainUntil });
    return versionId;
  }
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: _target: RemoteAuditTarget; key: string; versionId: string。
   * 结果：返回分支计算值（`value`），以 Promise 交付。
   * Result: Return the branch-computed value (`value`) through a Promise.
   * 失败 / Failure: `new Error('missing')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `this.objects.get`.
   */
  async read(_target: RemoteAuditTarget, key: string, versionId?: string) {
    const value = this.objects.get(key);
    if (!value || (versionId && versionId !== value.versionId)) throw new Error('missing');
    return value;
  }
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: remote audit requires object lock, anchors verified heads, renews retention and detects tampering
 * 状态影响 / State effects: `store.enabled`, `time`, `corrupted.last.body`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `join`, `Date.parse`, `remote.init`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(remote.configure(target), /Object Lock/)`; `assert.equal(first.caughtUp, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('remote audit requires object lock, anchors verified heads, renews retention and detects tampering', async () => {
  const audit = new AuditLog(join(root, 'audit'));
  const store = new MemoryStore();
  const file = join(root, 'remote.json');
  let time = Date.parse('2026-09-28T00:00:00.000Z');
  const remote = new RemoteAuditLock(audit, file, store, () => time, 0);
  await remote.init();
  await assert.rejects(remote.configure(target), /Object Lock/);
  store.enabled = true;
  await remote.configure(target);
  await audit.record(event);
  const first = await remote.sync();
  assert.equal(first.caughtUp, true);
  assert.equal(first.last?.sequence, 1);
  assert.match(first.last!.key, /team\/audit\/sakura-audit\//);
  assert.equal(store.objects.size, 1);
  assert.ok(!JSON.stringify(await readFile(file, 'utf8')).includes('SECRET_ACCESS_KEY'));
  assert.equal((await remote.sync()).last?.versionId, first.last?.versionId);
  assert.equal(store.objects.size, 1);
  await audit.record({ ...event, phase: 'end', status: 200 });
  const second = await remote.sync();
  assert.equal(second.last?.sequence, 2);
  assert.equal(store.objects.size, 2);
  await assert.rejects(remote.configure({ ...target, bucket: 'another-bucket' }), /不能更换目标/);
  const object = store.objects.get(second.last!.key)!;
  store.objects.set(second.last!.key, { ...object, body: object.body + 'altered' });
  await assert.rejects(remote.verify(), /内容或不可变/);
  await assert.rejects(remote.sync(), /内容或不可变/);
  assert.match((await remote.status()).lastError || '', /内容或不可变/);
  store.objects.set(second.last!.key, { ...object, mode: 'GOVERNANCE' });
  await assert.rejects(remote.verify(), /内容或不可变/);
  store.objects.set(second.last!.key, object);
  await remote.verify();
  time += 6 * 86_400_000;
  const renewed = await remote.sync();
  assert.equal(renewed.last?.sequence, 2);
  assert.notEqual(renewed.last?.key, second.last?.key);
  assert.equal(store.objects.size, 3);
  await remote.close();
  const forkedAudit = new AuditLog(join(root, 'forked-audit'));
  await forkedAudit.record({ ...event, name: 'POST /api/forged' });
  await forkedAudit.record({ ...event, phase: 'end', status: 200 });
  await forkedAudit.record({ ...event, phase: 'end', status: 200 });
  const forked = new RemoteAuditLock(forkedAudit, file, store, () => time, 0);
  await forked.init();
  assert.equal((await forked.status()).local.valid, false);
  await assert.rejects(forked.sync(), /本地审计链校验失败/);
  await forked.close();
  const reopened = new RemoteAuditLock(audit, file, store, () => time, 0);
  await reopened.init();
  assert.equal((await reopened.verify()).last?.key, renewed.last?.key);
  await reopened.close();
  const corrupted = JSON.parse(await readFile(file, 'utf8'));
  corrupted.last.body = JSON.stringify({ ...JSON.parse(corrupted.last.body), sequence: 999 });
  await writeFile(file, JSON.stringify(corrupted));
  await assert.rejects(new RemoteAuditLock(audit, file, store, () => time, 0).init(), /本地记录损坏/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: S3 adapter sends checksum and compliance retention and reads the exact locked version
 * 状态影响 / State effects: `process.env.AWS_ACCESS_KEY_ID`, `process.env.AWS_SECRET_ACCESS_KEY`, `process.env.AWS_SESSION_TOKEN`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `createServer`, `server.address`, `assert.equal`, `store.locked`.
 * 检查边界 / Checked boundaries: `assert.equal(await store.locked(destination), true)`; `assert.equal(versionId, 'locked-version-1')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('S3 adapter sends checksum and compliance retention and reads the exact locked version', async () => {
  const oldKey = process.env.AWS_ACCESS_KEY_ID;
  const oldSecret = process.env.AWS_SECRET_ACCESS_KEY;
  const oldToken = process.env.AWS_SESSION_TOKEN;
  process.env.AWS_ACCESS_KEY_ID = 'test-access';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
  process.env.AWS_SESSION_TOKEN = 'test-session-token';
  const body = '{"anchor":true}';
  const retainUntil = new Date('2030-01-01T00:00:00.000Z');
  let uploaded = '';
  let lockedHeaders: Record<string, string | undefined> = {};
  const server = createServer(/**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: req; res。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: S3 adapter sends checksum and compliance retention and reads the exact locked version
   * 状态影响 / State effects: `uploaded`, `lockedHeaders`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `assert.equal`, `url.searchParams.has`, `res.setHeader`, `res.end`.
   * 检查边界 / Checked boundaries: `assert.equal(req.headers['x-amz-security-token'], 'test-session-token')`.
   */
  async (req, res) => {
    assert.equal(req.headers['x-amz-security-token'], 'test-session-token');
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.searchParams.has('object-lock')) {
      res.setHeader('content-type', 'application/xml');
      res.end(
        '<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>',
      );
      return;
    }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      uploaded = Buffer.concat(chunks).toString();
      lockedHeaders = {
        mode: req.headers['x-amz-object-lock-mode'] as string,
        until: req.headers['x-amz-object-lock-retain-until-date'] as string,
        checksum: req.headers['x-amz-checksum-sha256'] as string,
        conditional: req.headers['if-none-match'] as string,
      };
      res.setHeader('x-amz-version-id', 'locked-version-1');
      res.end();
      return;
    }
    if (req.method === 'HEAD') {
      res.setHeader('x-amz-version-id', 'locked-version-1');
      res.setHeader('x-amz-object-lock-mode', 'COMPLIANCE');
      res.setHeader('x-amz-object-lock-retain-until-date', retainUntil.toISOString());
      res.setHeader('content-length', String(Buffer.byteLength(uploaded)));
      res.end();
      return;
    }
    if (req.method === 'GET') {
      res.setHeader('content-length', String(Buffer.byteLength(uploaded)));
      res.end(uploaded);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const port = (server.address() as { port: number }).port;
    const destination = { ...target, endpoint: `http://127.0.0.1:${port}` };
    const store = new S3RemoteAuditStore();
    assert.equal(await store.locked(destination), true);
    const versionId = await store.put(destination, 'team/audit/check.json', body, retainUntil);
    assert.equal(versionId, 'locked-version-1');
    assert.equal(uploaded, body);
    assert.equal(lockedHeaders.mode, 'COMPLIANCE');
    assert.equal(Date.parse(lockedHeaders.until!), retainUntil.getTime());
    assert.equal(lockedHeaders.conditional, '*');
    assert.ok(lockedHeaders.checksum);
    const fetched = await store.read(destination, 'team/audit/check.json', versionId);
    assert.equal(fetched.body, body);
    assert.equal(fetched.versionId, versionId);
    assert.equal(fetched.mode, 'COMPLIANCE');
    assert.equal(fetched.retainUntil?.toISOString(), retainUntil.toISOString());
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    if (oldKey === undefined) delete process.env.AWS_ACCESS_KEY_ID;
    else process.env.AWS_ACCESS_KEY_ID = oldKey;
    if (oldSecret === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
    else process.env.AWS_SECRET_ACCESS_KEY = oldSecret;
    if (oldToken === undefined) delete process.env.AWS_SESSION_TOKEN;
    else process.env.AWS_SESSION_TOKEN = oldToken;
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: S3 audit rejects incomplete environment credentials before metadata or object requests
 * 状态影响 / State effects: `process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI`, `process.env.AWS_ACCESS_KEY_ID`, `process.env.AWS_SECRET_ACCESS_KEY`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Object.fromEntries`, `keys.map`, `t.after`, `createServer`.
 * 检查边界 / Checked boundaries: `assert.rejects(store.locked({ ...target, endpoint }), { code: 'REMOTE_AUDIT_CREDENTIALS_REQUIRED', })`; `assert.equal(requests, 0, 'Neither metadata nor the configured S3 endpoint may be contacted')`.
 */
test('S3 audit rejects incomplete environment credentials before metadata or object requests', async (t) => {
  const keys = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_CONTAINER_CREDENTIALS_FULL_URI'] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.writeHead(500).end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>((done) => server.close(() => done())));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI = endpoint + '/credentials';
  const store = new S3RemoteAuditStore();
  for (const [access, secret] of [
    ['', ''],
    ['access', ''],
    ['', 'secret'],
    [' ', 'secret'],
  ]) {
    process.env.AWS_ACCESS_KEY_ID = access;
    process.env.AWS_SECRET_ACCESS_KEY = secret;
    await assert.rejects(store.locked({ ...target, endpoint }), {
      code: 'REMOTE_AUDIT_CREDENTIALS_REQUIRED',
    });
  }
  assert.equal(requests, 0, 'Neither metadata nor the configured S3 endpoint may be contacted');
});
