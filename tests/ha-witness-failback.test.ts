import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import { join, resolve } from 'node:path';
import { generate } from 'selfsigned';
import { HaWitness, type HaWitnessActions } from '../server/ha-witness-core.ts';
import { HaWitnessClient } from '../server/ha-witness-client.ts';
import { startHaWitnessServer, witnessVms } from '../server/ha-witness-server.ts';
import { checkHaWitnessDeployment } from '../server/ha-witness-preflight.ts';

async function directory(label: string) {
  const parent = resolve('artifacts', 'ha-witness-tests');
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, `${label}-`));
}

async function fixture() {
  const root = await directory('failback');
  const file = join(root, 'state.json');
  const sourceHostId = randomUUID(), sourceVmId = randomUUID(), targetHostId = randomUUID();
  const vm = { sourceHostId, sourceVmId, targetHostId, failureThreshold: 2,
    failbackBinding: 'f'.repeat(64) };
  const identity = { sourceHostId, sourceVmId };
  const plan = { ...identity, targetHostId, transferId: randomUUID(),
    remoteVmId: randomUUID(), snapshotId: randomUUID(), sha256: 'a'.repeat(64),
    snapshotAt: new Date(100_000).toISOString(), maxReplicaAgeMinutes: 60 };
  let time = 100_000, target: 'stopped' | 'running' = 'stopped';
  let sourceHealthy = false, retired = false;
  let traffic: string = sourceVmId;
  let denyRetire = false, denyRestore = false, loseRestoreResponse = false;
  let restoreCount = 0, retireCount = 0, activateCount = 0;
  const actions: HaWitnessActions = {
    fence: async () => {}, confirmFence: async () => {},
    targetStatus: async (_vm, candidate) => {
      assert.deepEqual(candidate, plan); return target;
    },
    activate: async () => { assert.equal(retired, false); target = 'running'; activateCount++; },
    applicationReady: async () => true,
    switchTraffic: async () => { traffic = plan.remoteVmId; },
    trafficTarget: async () => traffic,
    retire: async (_vm, candidate) => {
      assert.deepEqual(candidate, plan);
      retireCount++;
      if (target !== 'stopped' || denyRetire) throw new Error('retirement not confirmed');
      retired = true;
    },
    sourceApplicationReady: async () => sourceHealthy,
    restoreTraffic: async (candidateVm, candidate) => {
      assert.equal(candidateVm.sourceVmId, sourceVmId);
      assert.equal(candidate.remoteVmId, plan.remoteVmId);
      assert.equal(retired, true);
      restoreCount++;
      if (denyRestore) throw new Error('restore rejected');
      traffic = sourceVmId;
      if (loseRestoreResponse) throw new Error('restore response lost');
    },
  };
  await HaWitness.initialize(file, [vm]);
  const witness = new HaWitness(file, [vm], actions, () => time);
  await witness.init();
  const promote = async () => {
    await witness.heartbeat({ ...identity, failureThreshold: 2, plan });
    time = 130_000;
    await witness.sample();
    assert.equal((await witness.status(identity)).phase, 'promoted');
  };
  const heartbeat = () => witness.heartbeat({ ...identity, failureThreshold: 2, plan: null });
  return { root, file, vm, plan, identity, witness, actions, promote, heartbeat,
    target: (value: 'stopped' | 'running') => { target = value; },
    healthy: (value: boolean) => { sourceHealthy = value; },
    denyRetire: (value: boolean) => { denyRetire = value; },
    denyRestore: (value: boolean) => { denyRestore = value; },
    loseRestoreResponse: (value: boolean) => { loseRestoreResponse = value; },
    traffic: (value: string) => { traffic = value; },
    counts: () => ({ restoreCount, retireCount, activateCount }),
    reopen: async () => {
      const reopened = new HaWitness(file, [vm], actions, () => time);
      await reopened.init(); return reopened;
    } };
}

test('failback releases only a retired target, persists exact identity and waits for source health', async () => {
  const f = await fixture();
  await f.promote();
  await assert.rejects(f.witness.rejoin({ ...f.identity, dataReconciled: true }), /retirement/);
  await assert.rejects(f.witness.authorizeStart(f.identity), { code: 'HA_WITNESS_FENCED' });
  f.target('stopped');
  const released = await f.witness.rejoin({ ...f.identity, dataReconciled: true });
  assert.deepEqual(released, { released: true, retiredRemoteVmId: f.plan.remoteVmId, failback: 'pending' });
  const saved = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(saved.version, 4);
  assert.deepEqual(saved.entries[f.vm.sourceVmId].failback.plan, f.plan);
  await f.witness.sample();
  assert.match((await f.witness.status(f.identity)).error || '', /存活心跳/);
  await f.heartbeat();
  await f.witness.sample();
  assert.match((await f.witness.status(f.identity)).error || '', /健康检查/);
  assert.equal(f.counts().restoreCount, 0);
  assert.equal((await f.witness.authorizeStart(f.identity)).allowed, true);
  await assert.rejects(f.witness.heartbeat({ ...f.identity, failureThreshold: 2,
    plan: { ...f.plan, transferId: randomUUID() } }), /回切尚未完成/);
  f.healthy(true); f.denyRetire(true);
  await f.witness.sample();
  assert.equal(f.counts().restoreCount, 0, 'a missing renewed retirement proof cannot restore routing');
  f.denyRetire(false); f.denyRestore(true);
  await f.witness.sample();
  assert.equal((await f.witness.status(f.identity)).failback?.phase, 'pending');
  assert.match((await f.witness.status(f.identity)).error || '', /restore rejected/);
  f.denyRestore(false);
  await f.witness.sample();
  assert.equal((await f.witness.status(f.identity)).failback?.phase, 'completed');
  assert.equal((await f.witness.status(f.identity)).error, null);
  assert.equal(f.counts().activateCount, 1, 'returning must not restart the retired target');
  const reopened = await f.reopen();
  assert.deepEqual(await reopened.rejoin({ ...f.identity, dataReconciled: true }),
    { ...released, failback: 'completed' });
  const before = f.counts();
  await reopened.sample();
  assert.deepEqual(f.counts(), before, 'completed routing must not be rewritten');
});

test('a restored route with a lost response resumes after restart without a second restore write', async () => {
  const f = await fixture();
  await f.promote(); f.target('stopped');
  await f.witness.rejoin({ ...f.identity, dataReconciled: true });
  await f.heartbeat(); f.healthy(true); f.loseRestoreResponse(true);
  await f.witness.sample();
  assert.equal(f.counts().restoreCount, 1);
  assert.equal((await f.witness.status(f.identity)).failback?.phase, 'pending');
  const reopened = await f.reopen();
  await reopened.sample();
  assert.equal(f.counts().restoreCount, 1);
  assert.equal((await reopened.status(f.identity)).failback?.phase, 'completed');
  await assert.rejects(new HaWitness(f.file, [{ ...f.vm, failbackBinding: 'd'.repeat(64) }],
    f.actions).init(), { code: 'HA_WITNESS_STATE_MISMATCH' });
});

test('automatic failback cannot overwrite traffic redirected to an unknown third VM', async () => {
  const f = await fixture();
  await f.promote(); f.target('stopped');
  await f.witness.rejoin({ ...f.identity, dataReconciled: true });
  await f.heartbeat(); f.healthy(true); f.traffic(randomUUID());
  await f.witness.sample();
  assert.equal(f.counts().restoreCount, 0);
  assert.equal((await f.witness.status(f.identity)).failback?.phase, 'pending');
  assert.match((await f.witness.status(f.identity)).error || '', /未知实例/);
  const reopened = await f.reopen();
  await reopened.sample();
  assert.equal(f.counts().restoreCount, 0, 'restart must retain the unknown-route refusal');
});

test('a failed durable rejoin write never grants source start or attempts traffic restoration', async () => {
  const f = await fixture();
  await f.promote(); f.target('stopped');
  await rename(f.file, join(f.root, 'before-failed-rejoin.json'));
  await mkdir(f.file);
  await assert.rejects(f.witness.rejoin({ ...f.identity, dataReconciled: true }));
  await assert.rejects(f.witness.authorizeStart(f.identity), { code: 'HA_WITNESS_STORAGE_UNAVAILABLE' });
  assert.equal(f.counts().restoreCount, 0);
});

async function listen(server: Server) {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  return `https://127.0.0.1:${address.port}/`;
}
async function input(request: import('node:http').IncomingMessage) {
  let body = '';
  for await (const chunk of request) body += chunk.toString();
  return body ? JSON.parse(body) : null;
}

test('HTTPS failback authenticates exact source health and retire identity before restoring traffic', async () => {
  const root = await directory('failback-https');
  const cert = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
    notBeforeDate: new Date(Date.now() - 60_000), notAfterDate: new Date(Date.now() + 3600_000),
  });
  const fingerprint = new X509Certificate(cert.cert).fingerprint256;
  const sourceToken = randomBytes(32).toString('hex'), targetToken = randomBytes(32).toString('hex');
  const appToken = randomBytes(32).toString('hex'), trafficToken = randomBytes(32).toString('hex');
  const sourceHostId = randomUUID(), sourceVmId = randomUUID(), targetHostId = randomUUID();
  const sourceSystemUuid = randomUUID(), remoteVmId = randomUUID();
  let activeVmId = sourceVmId, sourceReady = false, targetRunning = false, retired = false;
  let healthIdentity = sourceVmId, retirementIdentity = remoteVmId;
  let restoreRefused = true, restoreCount = 0;
  let time = Date.now();
  const plan = { sourceHostId, sourceVmId, targetHostId, remoteVmId,
    transferId: randomUUID(), snapshotId: randomUUID(), sha256: 'a'.repeat(64),
    snapshotAt: new Date(time).toISOString(), maxReplicaAgeMinutes: 60 };
  const adapter = createServer({ cert: cert.cert, key: cert.private }, (req, res) => void (async () => {
    const url = new URL(req.url!, 'https://localhost');
    if (url.pathname === '/redfish/v1/Systems/1') {
      res.end(JSON.stringify({ UUID: sourceSystemUuid, PowerState: 'Off' })); return;
    }
    if (url.pathname === '/peer/status') {
      assert.equal(req.headers.authorization, `Bearer ${targetToken}`);
      res.end(JSON.stringify({ version: 1, id: targetHostId })); return;
    }
    if (url.pathname.startsWith('/peer/replica-')) {
      assert.equal(req.headers.authorization, `Bearer ${targetToken}`);
      assert.deepEqual(await input(req), { transferId: plan.transferId, remoteVmId,
        sourceVmId, snapshotId: plan.snapshotId, sha256: plan.sha256 });
      if (url.pathname === '/peer/replica-retire') {
        if (targetRunning) { res.writeHead(409); res.end('{}'); return; }
        retired = true; res.end(JSON.stringify({ id: retirementIdentity, retired: true })); return;
      }
      if (url.pathname === '/peer/replica-activate') {
        assert.equal(retired, false); targetRunning = true;
        res.end(JSON.stringify({ id: remoteVmId, status: 'running' })); return;
      }
      res.end(JSON.stringify({ ready: true, id: remoteVmId,
        status: targetRunning ? 'running' : 'stopped' })); return;
    }
    if (url.pathname === '/health') {
      assert.equal(req.headers.authorization, `Bearer ${appToken}`);
      const requestedVmId = url.searchParams.get('vmId');
      assert.ok(requestedVmId === sourceVmId || requestedVmId === remoteVmId);
      res.end(JSON.stringify({ vmId: requestedVmId === sourceVmId ? healthIdentity : remoteVmId,
        ready: requestedVmId === sourceVmId ? sourceReady : targetRunning })); return;
    }
    assert.equal(req.headers.authorization, `Bearer ${trafficToken}`);
    if (url.pathname === '/activate') {
      assert.deepEqual(await input(req), { sourceVmId, targetVmId: remoteVmId });
      activeVmId = remoteVmId;
    } else if (url.pathname === '/restore') {
      assert.deepEqual(await input(req), { sourceVmId, retiredVmId: remoteVmId });
      assert.equal(retired, true); assert.equal(sourceReady, true);
      restoreCount++;
      if (restoreRefused) { res.writeHead(409); res.end('{}'); return; }
      activeVmId = sourceVmId;
    } else {
      assert.equal(url.pathname, '/status');
      assert.equal(url.searchParams.get('sourceVmId'), sourceVmId);
    }
    res.end(JSON.stringify({ accepted: true, activeVmId }));
  })().catch((error) => { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }));
  let service: Awaited<ReturnType<typeof startHaWitnessServer>> | undefined;
  try {
    const baseUrl = await listen(adapter);
    const certFile = join(root, 'cert.pem'), keyFile = join(root, 'key.pem');
    await writeFile(certFile, cert.cert); await writeFile(keyFile, cert.private);
    const application = { url: `${baseUrl}health`, token: appToken, fingerprint };
    const config = { version: 1 as const, stateFile: join(root, 'state.json'), sourceToken,
      listen: { host: '127.0.0.1', port: 0, certFile, keyFile },
      vms: [{ sourceHostId, sourceVmId, targetHostId, failureThreshold: 2,
        redfish: { baseUrl, systemPath: '/redfish/v1/Systems/1', systemUuid: sourceSystemUuid,
          username: 'user', password: 'password', fingerprint },
        target: { baseUrl, token: targetToken, fingerprint }, application,
        traffic: { baseUrl, token: trafficToken, fingerprint }, failback: { application } }] };
    await HaWitness.initialize(config.stateFile, witnessVms(config));
    service = await startHaWitnessServer(config, () => time);
    const address = service.server.address();
    if (!address || typeof address === 'string') throw new Error('witness port missing');
    const client = new HaWitnessClient({ version: 1, token: sourceToken, fingerprint,
      url: `https://127.0.0.1:${address.port}/` });
    const identity = { sourceHostId, sourceVmId };
    await client.heartbeat({ ...identity, failureThreshold: 2, plan });
    time += 30_000; await service.witness.sample();
    assert.equal((await client.status(identity)).phase, 'promoted');
    await assert.rejects(client.rejoin({ ...identity, dataReconciled: true }));
    await assert.rejects(client.authorizeStart(identity));
    targetRunning = false;
    assert.equal((await client.rejoin({ ...identity, dataReconciled: true })).failback, 'pending');
    await client.authorizeStart(identity);
    await client.heartbeat({ ...identity, failureThreshold: 2, plan: null });
    sourceReady = true; healthIdentity = randomUUID();
    await service.witness.sample();
    assert.equal(restoreCount, 0, 'a healthy reply for another VM cannot restore traffic');
    healthIdentity = sourceVmId;
    retirementIdentity = randomUUID();
    await service.witness.sample();
    assert.equal(restoreCount, 0, 'a retirement reply for another replica cannot restore traffic');
    assert.equal((await client.status(identity)).failback?.phase, 'pending');
    retirementIdentity = remoteVmId;
    await service.witness.sample();
    assert.equal((await client.status(identity)).failback?.phase, 'pending');
    assert.equal(activeVmId, remoteVmId);
    restoreRefused = false; await service.witness.sample();
    assert.equal(activeVmId, sourceVmId);
    assert.equal((await client.status(identity)).failback?.phase, 'completed');
    const verified = await checkHaWitnessDeployment(config);
    assert.equal(verified.ok, true);
    assert.equal(verified.vms[0].failback?.phase, 'completed');
    await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true,
      retired, restoreCount, activeVmId, sourceVmId, remoteVmId }, null, 2));
  } finally {
    await service?.close();
    await new Promise<void>((done) => adapter.close(() => done()));
  }
});
