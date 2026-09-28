import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLog, traceExport, type AuditEvent } from '../server/audit.ts';
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
  for (const mode of ['content', 'truncated', 'seal'] as const) {
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
    const reader = new AuditLog(folder);
    assert.equal((await reader.read()).valid, false);
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
