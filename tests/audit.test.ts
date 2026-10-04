import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLog, auditFailure, traceExport, type AuditEvent } from '../server/audit.ts';
import { AppError } from '../shared/errors.ts';
import { OperationResults, noteOperationBusinessResult, noteOperationBusinessStarted, noteOperationResultActor } from '../server/operation-results.ts';
import { publicApiFailure } from '../server/api-errors.ts';
import { randomUUID } from 'node:crypto';
import { HostRuntime, withResourceContext } from '../server/host-runtime/index.ts';
import { withOperationCheck } from '../server/operation-context.ts';
import { stageOperationResponse, withOperationResponse } from '../server/operation-response.ts';
import { sendJson } from '../server/http-response.ts';
import { z } from 'zod';
import type { ServerResponse } from 'node:http';
import { AccessControl } from '../server/access-control.ts';
import { auditRejectedRequest, rejectedRequestAuditEvent } from '../server/application-http.ts';
import { operationEntries } from '../server/operation-catalog.ts';
const root = await mkdtemp(join(tmpdir(), 'sakura-audit-'));
after(() => rm(root, { recursive: true, force: true }));
const event: AuditEvent = {
  time: '2026-09-26T10:00:00.000Z',
  phase: 'start',
  kind: 'request',
  name: 'POST /api/vms',
  traceId: '1'.repeat(32),
  spanId: '2'.repeat(16),
};

test('rejected mutations record paired safe audit events while ordinary reads need no audit', async () => {
  const audit = new AuditLog(join(root, 'rejected-request'));
  const requestEvent = rejectedRequestAuditEvent({ method: 'POST', url: '/api/audit-smoke?token=QUERY_SECRET' })!;
  assert.equal(requestEvent.name, 'POST /api/audit-smoke');
  let auditFailed = false;
  const rejection = new AppError('BODY_SECRET private C:\\credentials\\token', 404, 'OPERATION_NOT_FOUND');
  await auditRejectedRequest(audit, requestEvent, rejection, () => { auditFailed = true; });
  const result = await audit.read();
  assert.equal(auditFailed, false); assert.equal(result.valid, true); assert.equal(result.records.length, 2);
  assert.deepEqual(result.records.map(record => record.event.phase), ['start', 'end']);
  assert.equal(result.records[1].event.status, 404);
  assert.equal(result.records[0].event.traceId, result.records[1].event.traceId);
  assert.doesNotMatch(JSON.stringify(result.records), /BODY_SECRET|QUERY_SECRET|credentials|token/);
  assert.equal(publicApiFailure(rejection, randomUUID()).status, 404);
  for (const method of ['GET', 'HEAD', 'OPTIONS'])
    assert.equal(rejectedRequestAuditEvent({ method, url: '/api/audit' }), undefined);
  assert.equal(rejectedRequestAuditEvent({ method: 'POST', url: '/static/asset' }), undefined);
  const read = operationEntries.find(entry => entry.declaration.method === 'GET' && entry.declaration.path === '/api/audit')!;
  const mutatingGet = { ...read, declaration: { ...read.declaration, mutating: true } };
  assert.equal(rejectedRequestAuditEvent({ method: 'GET', url: '/api/audit' }, [mutatingGet])?.operationId, read.declaration.id);
  const ticket = 'SensitiveTicket_' + 'a'.repeat(64);
  assert.equal(rejectedRequestAuditEvent({ method: 'POST', url: '/api/downloads/' + ticket })?.name,
    'POST /api/downloads/{ticket}');
  for (const path of ['/api/unknown/' + ticket, '/api/%00SECRET', '/api/' + 'a'.repeat(10000)]) {
    const safe = rejectedRequestAuditEvent({ method: 'POST', url: path })!;
    assert.ok(safe.name.length <= 200); assert.doesNotMatch(safe.name, /SensitiveTicket|SECRET|a{64}/);
  }
});

test('a failed rejection audit never replaces the primary rejection, including primitive throws', async () => {
  for (const phase of ['start', 'end']) {
    const audit = new AuditLog(join(root, 'rejected-audit-' + phase));
    const original = audit.record.bind(audit);
    audit.record = async value => {
      if (value.phase === phase) throw new AppError('private audit secret', 503, 'AUDIT_UNAVAILABLE');
      return original(value);
    };
    for (const error of [new AppError('private rejection secret', 401, 'OPERATION_FORBIDDEN'), null, undefined, 0, false]) {
      let auditFailed = false;
      await auditRejectedRequest(audit, { kind: 'request', name: 'POST /api/audit-smoke' }, error,
        () => { auditFailed = true; });
      assert.equal(auditFailed, true);
      const failure = publicApiFailure(error, randomUUID(), auditFailed);
      assert.equal(failure.status, error instanceof AppError ? 401 : 500);
      assert.deepEqual(failure.dto.auditFailure, { code: 'AUDIT_UNAVAILABLE' });
      assert.doesNotMatch(JSON.stringify(failure.dto), /private|secret/);
    }
  }
});

test('falsy failures have a stable receipt code and never imply a failed execution after admission', async () => {
  const results = new OperationResults(join(root, 'falsy-receipts'));
  for (const error of [null, undefined, 0, false]) {
    const before = await results.start(randomUUID(), 'test.preflight', 'local-owner');
    await results.finish(before, error, false, false, true);
    const rejected = await results.get(before.correlationId, 'local-owner');
    assert.equal(rejected.outcome, 'failed'); assert.equal(rejected.executed, false);
    assert.equal(rejected.errorCode, 'INTERNAL_ERROR');
    const after = await results.start(randomUUID(), 'test.admitted', 'local-owner');
    await results.begin(after);
    await results.finish(after, error, false, false, true);
    const uncertain = await results.get(after.correlationId, 'local-owner');
    assert.equal(uncertain.outcome, 'unknown'); assert.equal(uncertain.executed, true);
    assert.equal(uncertain.errorCode, 'INTERNAL_ERROR');
  }
});

test('end audit failure preserves the exact business exception and attaches a separate safe diagnostic', async () => {
  const audit = new AuditLog(join(root, 'primary-failure'));
  const original = audit.record.bind(audit);
  const secondary = new AppError('private C:\\secrets\\audit.key', 503, 'AUDIT_UNAVAILABLE');
  audit.record = async value => { if (value.phase === 'end') throw secondary; return original(value); };
  const business = new AppError('private C:\\secrets\\business.key', 409, 'BUSINESS_CONFLICT');
  await assert.rejects(audit.span({ kind: 'request', name: 'failure' }, async () => { throw business; }),
    error => error === business);
  assert.equal(auditFailure(business), secondary);
  assert.equal(Object.keys(business).includes('auditFailure'), false);
  const failure = publicApiFailure(business, randomUUID());
  assert.equal(failure.status, 409);
  assert.equal(failure.dto.code, 'BUSINESS_CONFLICT');
  assert.deepEqual(failure.dto.auditFailure, { code: 'AUDIT_UNAVAILABLE' });
  assert.doesNotMatch(JSON.stringify(failure.dto), /secrets|audit.key|business.key/);
  for (const protectedError of [Object.freeze(new Error('frozen')),
    Object.defineProperty(new Error('existing property'), 'auditFailure', { value: 'existing' }), null, undefined]) {
    let caught: unknown, rejected = false;
    try { await audit.span({ kind: 'request', name: 'protected-failure' }, async () => { throw protectedError; }); }
    catch (error) { caught = error; rejected = true; }
    assert.equal(rejected, true); assert.equal(caught, protectedError);
    if (protectedError) assert.equal(auditFailure(protectedError), secondary);
  }
  const results = new OperationResults(join(root, 'primitive-audit'));
  for (const primary of [null, undefined, 'primitive failure']) {
    const receipt = await results.start(randomUUID(), 'test.primitive', 'local-owner');
    let caught: unknown, rejected = false;
    try { await results.run(receipt, () => audit.span({ kind: 'request', name: 'primitive' }, async () => {
      await results.begin(receipt); throw primary;
    })); } catch (error) { caught = error; rejected = true; }
    assert.equal(rejected, true); assert.equal(caught, primary);
    await results.finish(receipt, caught, false, false, true);
    const persisted = await results.get(receipt.correlationId, 'local-owner');
    assert.equal(persisted.auditRecorded, false); assert.equal(persisted.executed, true);
    assert.equal(persisted.outcome, 'unknown');
    const safe = publicApiFailure(caught, receipt.correlationId, results.auditFailed(receipt));
    assert.equal(safe.status, 500); assert.equal(safe.dto.code, 'INTERNAL_ERROR');
    assert.deepEqual(safe.dto.auditFailure, { code: 'AUDIT_UNAVAILABLE' });
  }
});

test('enabling accounts binds only the enabling receipt to the confirmed owner after an end audit failure', async () => {
  const directory = join(root, 'enable-accounts'), results = new OperationResults(directory);
  const access = new AccessControl(join(root, 'enabled-access.json')); await access.init();
  const historical = await results.start(randomUUID(), 'test.previous-local', 'local-owner');
  await results.finish(historical, new Error('previous failure'), false);
  const receipt = await results.start(randomUUID(), 'core.access.enable', 'local-owner');
  const audit = new AuditLog(join(root, 'enable-audit'));
  audit.record = async value => { if (value.phase === 'end') throw new AppError('private audit path', 503, 'AUDIT_UNAVAILABLE'); return {} as any; };
  let failure: unknown;
  try { await results.run(receipt, () => audit.span({ kind: 'request', name: 'core.access.enable' }, async () => {
    await results.begin(receipt); await access.enable({ password: 'owner-password-with-enough-characters' });
    noteOperationResultActor(access.users().find(account => account.role === 'owner')!.id);
    noteOperationBusinessResult(200);
  })); } catch (error) { failure = error; }
  await results.finish(receipt, failure, false);
  const login = await access.login({ username: 'owner', password: 'owner-password-with-enough-characters' });
  const restart = new OperationResults(directory);
  const confirmed = await restart.get(receipt.correlationId, 'account', login.principal.id);
  assert.equal(confirmed.outcome, 'succeeded'); assert.equal(confirmed.auditRecorded, false);
  await assert.rejects(restart.get(receipt.correlationId, 'account', randomUUID()), { status: 403 });
  await assert.rejects(restart.get(historical.correlationId, 'account', login.principal.id), { status: 403 });
});

test('end audit keeps captured actor and target identity after the operation revokes its own authority', async () => {
  const audit = new AuditLog(join(root, 'revoked-authority'));
  const identity = { owner: 'core:application', actorId: randomUUID(), vmId: randomUUID(), projectId: 'default' };
  let authorized = true;
  await withResourceContext(identity, () => withOperationCheck(async () => {
    if (!authorized) throw new AppError('revoked credential', 401);
  }, () => audit.span({ kind: 'request', name: 'logout' }, async () => { authorized = false; })));
  const result = await audit.read();
  assert.equal(result.valid, true); assert.equal(result.records.length, 2);
  for (const record of result.records) {
    assert.equal(record.event.actorId, identity.actorId);
    assert.equal(record.event.vmId, identity.vmId);
    assert.equal(record.event.projectId, identity.projectId);
  }
});

test('a committed execution marker survives restart and anonymous outcomes never use a shared account key', async () => {
  const directory = join(root, 'execution-marker'), results = new OperationResults(directory), actor = randomUUID();
  const receipt = await results.start(randomUUID(), 'test.mutate', 'account', actor);
  await results.begin(receipt);
  const restarted = await new OperationResults(directory).get(receipt.correlationId, 'account', actor);
  assert.equal(restarted.outcome, 'unknown'); assert.equal(restarted.executed, true); assert.equal(restarted.delivery, 'unknown');
  const beforeExecution = await results.start(randomUUID(), 'test.not-started', 'account', actor);
  assert.equal((await new OperationResults(directory).get(beforeExecution.correlationId, 'account', actor)).executed, false);
  const anonymous = await results.start(randomUUID(), 'test.login', 'anonymous:' + randomUUID());
  assert.equal(results.queryable(anonymous), false);
  await assert.rejects(results.get(anonymous.correlationId, 'account', actor), { status: 403 });
  await results.run(anonymous, async () => { await results.begin(anonymous); noteOperationResultActor(actor); noteOperationBusinessResult(200); });
  await results.finish(anonymous);
  assert.equal(results.queryable(anonymous), true);
  assert.equal((await results.get(anonymous.correlationId, 'account', actor)).outcome, 'succeeded');
  await assert.rejects(results.get(anonymous.correlationId, 'account', randomUUID()), { status: 403 });
  const staged = await results.start(randomUUID(), 'test.staged', 'account', actor);
  await results.run(staged, async () => { await results.begin(staged); noteOperationBusinessResult(200); });
  await results.finish(staged, undefined, undefined, true);
  assert.equal((await results.get(staged.correlationId, 'account', actor)).delivery, 'pending');
  const uncertainDelivery = await new OperationResults(directory).get(staged.correlationId, 'account', actor);
  assert.equal(uncertainDelivery.outcome, 'succeeded'); assert.equal(uncertainDelivery.delivery, 'unknown');
  await results.finish(staged, undefined, true);
  assert.equal((await results.get(staged.correlationId, 'account', actor)).delivery, 'sent');
});

test('completed business remains queryable after response validation and finite responses cannot flush before audit', async () => {
  const results = new OperationResults(join(root, 'invalid-response'));
  const receipt = await results.start(randomUUID(), 'test.response', 'local-owner');
  const emitted: unknown[] = [];
  const res = { writeHead: (...args: unknown[]) => { emitted.push(args); }, end: (...args: unknown[]) => { emitted.push(args); },
    write: () => { emitted.push('raw'); return true; }, flushHeaders: () => { emitted.push('flush'); } } as unknown as ServerResponse;
  const staged = stageOperationResponse(res);
  let failure: unknown;
  try { await results.run(receipt, async () => {
    await results.begin(receipt);
    return withOperationResponse({ id: 'test.response', contract: { kind: 'json', media: 'application/json', statuses: [200],
      schema: z.object({ ok: z.boolean() }).strict() } }, () => sendJson(res, { ok: 'invalid' }));
  }); } catch (error) { failure = error; }
  await results.finish(receipt, failure, false);
  assert.equal((failure as AppError).code, 'INVALID_OPERATION_RESPONSE');
  const result = await new OperationResults(join(root, 'invalid-response')).get(receipt.correlationId, 'local-owner');
  assert.equal(result.outcome, 'succeeded'); assert.equal(result.executed, true); assert.equal(result.responseValidated, false);
  assert.throws(() => res.write('bypass'), { code: 'INVALID_OPERATION_RESPONSE' });
  assert.throws(() => res.flushHeaders(), { code: 'INVALID_OPERATION_RESPONSE' });
  assert.deepEqual(emitted, []); staged.discard();
  const unfinished = stageOperationResponse(res);
  assert.throws(() => unfinished.publish(), { code: 'INVALID_OPERATION_RESPONSE' });
});

test('receipt inventory bounds individual records and keeps corrupt records without blocking healthy mutations', async () => {
  const directory = join(root, 'bounded-receipts'); await mkdir(directory);
  const corrupt = randomUUID(), oversized = randomUUID();
  await writeFile(join(directory, corrupt + '.json'), 'broken');
  await writeFile(join(directory, oversized + '.json'), 'x'.repeat(8193));
  const results = new OperationResults(directory), receipt = await results.start(randomUUID(), 'test.healthy', 'local-owner');
  await results.run(receipt, async () => { await results.begin(receipt); noteOperationBusinessResult(200); });
  await results.finish(receipt);
  assert.equal((await results.get(receipt.correlationId, 'local-owner')).outcome, 'succeeded');
  await assert.rejects(results.get(corrupt, 'local-owner'), { code: 'OPERATION_RESULT_UNAVAILABLE' });
  await assert.rejects(results.get(oversized, 'local-owner'), { code: 'OPERATION_RESULT_UNAVAILABLE' });
  assert.equal(await readFile(join(directory, corrupt + '.json'), 'utf8'), 'broken');
});

test('full receipt capacity evicts confirmed terminal history while retaining unknown outcomes', async () => {
  const directory = join(root, 'receipt-retention'); await mkdir(directory);
  const unknownId = randomUUID();
  const baseline = { operationId: 'test.old', sessionKey: 'local-owner', executed: true, startedAt: '2026-01-01T00:00:00.000Z',
    responseValidated: true, auditRecorded: true, delivery: 'sent' };
  for (let offset = 0; offset < 2000; offset += 50) await Promise.all(Array.from({ length: 50 }, (_, index) => {
    const number = offset + index, correlationId = number === 0 ? unknownId : randomUUID();
    return writeFile(join(directory, correlationId + '.json'), JSON.stringify({ ...baseline, correlationId,
      outcome: number === 0 ? 'unknown' : 'succeeded' }));
  }));
  const results = new OperationResults(directory);
  await results.start(randomUUID(), 'test.new', 'local-owner');
  assert.equal((await results.get(unknownId, 'local-owner')).outcome, 'unknown');
  assert.equal((await readdir(directory)).length, 1001);
});

test('durable outcome queries distinguish a completed mutation, uncertain side effects and audit start rejection', async () => {
  const directory = join(root, 'outcomes'), results = new OperationResults(directory);
  const actor = randomUUID();
  const audit = new AuditLog(join(root, 'outcome-audit'));
  audit.record = async value => { if (value.phase === 'end') throw new AppError('internal audit path', 503, 'AUDIT_UNAVAILABLE'); return {} as any; };
  const receipt = await results.start(randomUUID(), 'test.mutate', 'account', actor);
  let mutations = 0;
  let failure: unknown;
  try { await results.run(receipt, () => audit.span({ kind: 'request', name: 'test.mutate' }, async () => {
    noteOperationBusinessStarted(); mutations++; noteOperationBusinessResult(201); return { ok: true };
  })); } catch (error) { failure = error; }
  await results.finish(receipt, failure, false);
  assert.equal(mutations, 1);
  const afterRestart = new OperationResults(directory);
  const completed = await afterRestart.get(receipt.correlationId, 'account', actor);
  assert.equal(completed.outcome, 'succeeded'); assert.equal(completed.executed, true);
  assert.equal(completed.auditRecorded, false); assert.equal(completed.responseStatus, 201);
  await assert.rejects(afterRestart.get(receipt.correlationId, 'account', randomUUID()), { status: 403 });
  assert.doesNotMatch(JSON.stringify(completed), /actorId|sessionKey|internal audit path/);
  const uncertain = await results.start(randomUUID(), 'test.uncertain', 'account', actor);
  results.run(uncertain, () => noteOperationBusinessStarted());
  await results.finish(uncertain, new Error('failed after a side effect'), false);
  assert.equal((await results.get(uncertain.correlationId, 'account', actor)).outcome, 'unknown');
  const rejected = await results.start(randomUUID(), 'test.not-started', 'account', actor);
  await results.finish(rejected, new AppError('audit unavailable', 503, 'AUDIT_UNAVAILABLE'), false);
  assert.equal((await results.get(rejected.correlationId, 'account', actor)).executed, false);
  assert.equal((await results.get(rejected.correlationId, 'account', actor)).outcome, 'failed');
});

test('resource admission inherits audit span identity without changing the durable audit format', async () => {
  const audit = new AuditLog(join(root, 'resources')), runtime = new HostRuntime();
  let resourceTrace = '', resourceSpan = '';
  await withResourceContext({ owner: 'plugin:build', operationId: 'owned-operation' }, () =>
    audit.span({ kind: 'job', name: 'build' }, async () => {
      const lease = await runtime.acquire({ owner: 'plugin:build', kind: 'job', label: 'build', cost: { jobs: 1 } });
      const resource = runtime.snapshot().resources[0];
      assert.equal(resource.identity.operationId, 'owned-operation');
      resourceTrace = resource.identity.traceId!; resourceSpan = resource.identity.spanId!;
      lease.release();
    }));
  const entries = await audit.read();
  assert.equal(entries.valid, true);
  assert.equal(entries.records[0].event.traceId, resourceTrace);
  assert.equal(entries.records[0].event.spanId, resourceSpan);
  assert.equal(entries.records.length, 2);
  runtime.close(); await audit.close();
});

test('audit serializes concurrent append, verifies restart and excludes arbitrary data fields', async () => {
  const folder = join(root, 'ordered'),
    audit = new AuditLog(folder);
  await Promise.all(Array.from({ length: 20 }, () => audit.record(event)));
  const result = await new AuditLog(folder).read(10);
  assert.equal(result.valid, true);
  assert.equal(result.sequence, 20);
  assert.deepEqual(
    result.records.map((entry) => entry.sequence),
    Array.from({ length: 10 }, (_, index) => index + 11),
  );
  assert.equal((await audit.read(0, undefined,
    { sequence: 11, hash: result.records[0].hash })).valid, true);
  assert.equal((await audit.read(0, undefined,
    { sequence: 11, hash: 'f'.repeat(64) })).valid, false);
  assert.throws(() => audit.record({ ...event, password: 'never log' } as any));
  assert.ok(!JSON.stringify(result).includes('never log'));
});

test('audit detects changed content, truncation and forged seals before permitting more writes', async () => {
  for (const mode of ['content', 'truncated', 'seal', 'syntax'] as const) {
    const folder = join(root, mode),
      audit = new AuditLog(folder);
    await audit.record(event);
    await audit.record({ ...event, phase: 'end', status: 200 });
    const file = join(folder, 'events.jsonl'),
      content = await readFile(file, 'utf8');
    if (mode === 'content') await writeFile(file, content.replace('POST /api/vms', 'POST /api/bad'));
    if (mode === 'truncated') await writeFile(file, content.split('\n')[0] + '\n');
    if (mode === 'seal')
      await writeFile(join(folder, 'seal.json'), '{"sequence":1,"hash":"fake","mac":"fake"}');
    if (mode === 'syntax') await writeFile(file, 'PRIVATE_SECRET C:\\private\\sensitive.key\n');
    const reader = new AuditLog(folder);
    const invalid = await reader.read();
    assert.equal(invalid.valid, false);
    if (!invalid.valid) assert.equal(invalid.error, '审计日志校验失败，请检查本机审计存储');
    assert.doesNotMatch(JSON.stringify(invalid), /PRIVATE_SECRET|sensitive.key|private|sakura-audit-/);
    await assert.rejects(reader.record(event), { code: 'AUDIT_UNAVAILABLE' });
  }
});

test('traces retain request/task parentage and failure status without logging command output', async () => {
  const audit = new AuditLog(join(root, 'spans'));
  await audit.span(
    { kind: 'request', name: 'POST /api/action' },
    async () => {
      await audit.span({ kind: 'job', name: 'build' }, async () => {});
      await assert.rejects(
        audit.span({ kind: 'job', name: 'test' }, async () => {
          throw new Error('SECRET OUTPUT');
        }),
      );
    },
    () => 202,
  );
  const result = await audit.read();
  assert.equal(result.valid, true);
  const spans: any[] = traceExport(result.records).resourceSpans[0].scopeSpans[0].spans;
  assert.equal(spans.length, 3);
  const parent = spans.find((span) => span.name.startsWith('POST'))!;
  for (const child of spans.filter((span) => !span.name.startsWith('POST'))) {
    assert.equal(child.parentSpanId, parent.spanId);
    assert.equal(child.traceId, parent.traceId);
    assert.ok(BigInt(child.endTimeUnixNano) >= BigInt(child.startTimeUnixNano));
  }
  assert.equal(spans.find((span) => span.name === 'test').status.code, 2);
  assert.ok(!JSON.stringify(result).includes('SECRET OUTPUT'));
});
