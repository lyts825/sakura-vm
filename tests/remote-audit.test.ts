import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLog, type AuditEvent } from '../server/audit.ts';
import { RemoteAuditLock, S3RemoteAuditStore, type RemoteAuditObject,
  type RemoteAuditStore, type RemoteAuditTarget } from '../server/remote-audit.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-remote-audit-'));
assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
after(() => rm(root, { recursive: true, force: true }));
const event: AuditEvent = { time: '2026-09-26T10:00:00.000Z', phase: 'start',
  kind: 'request', name: 'POST /api/vms', traceId: '1'.repeat(32), spanId: '2'.repeat(16) };
const target: RemoteAuditTarget = { bucket: 'locked-audit-bucket', region: 'us-east-1',
  prefix: 'team/audit', retentionDays: 7 };

class MemoryStore implements RemoteAuditStore {
  enabled = false;
  objects = new Map<string, RemoteAuditObject>();
  async locked() { return this.enabled; }
  async put(_target: RemoteAuditTarget, key: string, body: string, retainUntil: Date) {
    if (this.objects.has(key)) throw new Error('duplicate');
    const versionId = String(this.objects.size + 1);
    this.objects.set(key, { body, versionId, mode: 'COMPLIANCE', retainUntil });
    return versionId;
  }
  async read(_target: RemoteAuditTarget, key: string, versionId?: string) {
    const value = this.objects.get(key);
    if (!value || (versionId && versionId !== value.versionId)) throw new Error('missing');
    return value;
  }
}

test('remote audit requires object lock, anchors verified heads, renews retention and detects tampering',
  async () => {
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
    await assert.rejects(remote.configure({ ...target, bucket: 'another-bucket' }),
      /不能更换目标/);
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
    await assert.rejects(new RemoteAuditLock(audit, file, store,
      () => time, 0).init(), /本地记录损坏/);
  });

test('S3 adapter sends checksum and compliance retention and reads the exact locked version',
  async () => {
    const oldKey = process.env.AWS_ACCESS_KEY_ID;
    const oldSecret = process.env.AWS_SECRET_ACCESS_KEY;
    process.env.AWS_ACCESS_KEY_ID = 'test-access';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
    const body = '{"anchor":true}';
    const retainUntil = new Date('2030-01-01T00:00:00.000Z');
    let uploaded = '';
    let lockedHeaders: Record<string, string | undefined> = {};
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.searchParams.has('object-lock')) {
        res.setHeader('content-type', 'application/xml');
        res.end('<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>');
        return;
      }
      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        uploaded = Buffer.concat(chunks).toString();
        lockedHeaders = { mode: req.headers['x-amz-object-lock-mode'] as string,
          until: req.headers['x-amz-object-lock-retain-until-date'] as string,
          checksum: req.headers['x-amz-checksum-sha256'] as string,
          conditional: req.headers['if-none-match'] as string };
        res.setHeader('x-amz-version-id', 'locked-version-1');
        res.end(); return;
      }
      if (req.method === 'HEAD') {
        res.setHeader('x-amz-version-id', 'locked-version-1');
        res.setHeader('x-amz-object-lock-mode', 'COMPLIANCE');
        res.setHeader('x-amz-object-lock-retain-until-date', retainUntil.toISOString());
        res.setHeader('content-length', String(Buffer.byteLength(uploaded)));
        res.end(); return;
      }
      if (req.method === 'GET') {
        res.setHeader('content-length', String(Buffer.byteLength(uploaded)));
        res.end(uploaded); return;
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
    }
  });
