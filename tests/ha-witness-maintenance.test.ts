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

async function input(request: import('node:http').IncomingMessage) {
  let body = '';
  for await (const chunk of request) body += chunk.toString();
  return body ? JSON.parse(body) : null;
}
async function listen(server: Server) {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  return `https://127.0.0.1:${address.port}/`;
}

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
  const adapter = createServer({ cert: cert.cert, key: cert.private }, (req, res) => void (async () => {
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
  const options = (label: string, mode: 'migrate' | 'reconfigure' | 'recover' = 'migrate') => ({
    mode, backupFile: join(root, `${label}-original.json`), output: join(root, `${label}-receipt.json`),
  });
  return { root, config, options, plan, first, replicas, sourceHostId, sourceVmId, targetHostId,
    nextTargetHostId, nextTargetToken, sourceToken, fingerprint,
    power: (value: string) => { powerState = value; },
    traffic: (value: string) => { activeVmId = value; },
    loseRetire: () => { loseRetireResponse = true; },
    incomplete: (value: boolean) => { incompleteInventory = value; },
    wrongIdentity: (value: boolean) => { wrongInventoryIdentity = value; },
    addDuringRetire: () => { extraOnRetire = true; },
    controlWrites: () => controlWrites,
    close: () => new Promise<void>((done) => adapter.close(() => done())),
  };
}

for (const phase of ['source', 'fencing', 'fenced', 'promoted'] as const)
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
      fence: async () => {}, confirmFence: async () => {}, targetStatus: async () => 'stopped',
      activate: async () => {}, applicationReady: async () => false, switchTraffic: async () => {},
      trafficTarget: async () => f.sourceVmId, retire: async () => {},
    });
    await configured.init();
  } finally { await f.close(); }
});

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

test('production inventory includes starting and retired histories while excluding other authenticated origins', async () => {
  const sourceHostId = randomUUID(), sourceVmId = randomUUID(), targetHostId = randomUUID();
  const make = () => ({ id: randomUUID(), migrationOrigin: { sourceHostId, sourceVmId,
    transferId: randomUUID(), snapshotId: randomUUID(), diskSha256: 'a'.repeat(64), targetName: 'ha' } });
  const first = make(), second = make(), otherHost = make(), otherSource = make();
  otherHost.migrationOrigin.sourceHostId = randomUUID();
  otherSource.migrationOrigin.sourceVmId = randomUUID();
  const retired = { ...second, haRetirement: { sourceHostId, sourceVmId,
    transferId: second.migrationOrigin.transferId, snapshotId: second.migrationOrigin.snapshotId,
    sha256: second.migrationOrigin.diskSha256, retiredAt: new Date().toISOString() } };
  const records = new Map([first, retired, otherHost, otherSource].map((vm) => [vm.id, vm]));
  const machines = { records, state: (id: string) => id === first.id ? 'starting' : 'stopped' } as unknown as Machines;
  const receiver = createHostImportReceiver(machines, { bundles: () => ({} as Bundles),
    requireSessionUnlocked: () => { throw new Error('background inventory must not require browser unlock'); },
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

test('real paired inventory endpoint binds its requester and requires import plus failover permission', async () => {
  const parent = resolve('artifacts', 'ha-witness-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'inventory-peer-'));
  const metrics = async () => ({ platform: 'win32', arch: 'x64', cpus: 8,
    memoryTotal: 16 * 1024 ** 3, memoryFree: 8 * 1024 ** 3,
    load: [0, 0, 0], vmCount: 2, runningVms: 0 });
  const portServer = createTcpServer();
  await new Promise<void>((done) => portServer.listen(0, '127.0.0.1', done));
  const address = portServer.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  await new Promise<void>((done) => portServer.close(() => done()));
  const target = new HostPeers(metrics, join(root, 'target.json'), 'Inventory target');
  const sourceFile = join(root, 'source.json');
  const source = new HostPeers(metrics, sourceFile, 'Inventory source');
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
    target.setImportReceiver({ status: async () => null,
      receive: async () => { throw new Error('read-only inventory cannot import'); },
      inspectReplicas: async ({ requesterId, sourceVmId: requested, targetHostId }) => {
        assert.equal(requesterId, expectedSource); assert.equal(requested, sourceVmId);
        assert.equal(targetHostId, expectedTarget); calls++;
        return { version: 1, complete: true, hostId: wrongReply ? randomUUID() : targetHostId,
          sourceHostId: requesterId, sourceVmId: requested, replicas: [] };
      } });
    const credentials = JSON.parse(await readFile(sourceFile, 'utf8')).outbound[0];
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
