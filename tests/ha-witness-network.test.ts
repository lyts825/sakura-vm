import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { generate } from 'selfsigned';
import { HaWitnessClient } from '../server/ha-witness-client.ts';
import { HaWitness } from '../server/ha-witness-core.ts';
import { haWitnessServerConfigSchema, startHaWitnessServer } from '../server/ha-witness-server.ts';
import { checkHaWitnessDeployment } from '../server/ha-witness-preflight.ts';

async function listen(server: Server) {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test port');
  return `https://127.0.0.1:${address.port}/`;
}
async function close(server: Server) {
  await new Promise<void>((done) => server.close(() => done()));
}
async function input(request: import('node:http').IncomingMessage) {
  let body = '';
  for await (const chunk of request) body += chunk.toString();
  return body ? JSON.parse(body) : null;
}

test('independent HTTPS witness powers off source before promoting a paired target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-ha-witness-network-'));
  const cert = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 60_000),
    notAfterDate: new Date(Date.now() + 3600_000),
  });
  const fingerprint = new X509Certificate(cert.cert).fingerprint256;
  const tls = { cert: cert.cert, key: cert.private };
  const sourceToken = randomBytes(32).toString('hex');
  const secondSourceToken = randomBytes(32).toString('hex');
  const targetToken = randomBytes(32).toString('hex');
  const appToken = randomBytes(32).toString('hex');
  const trafficToken = randomBytes(32).toString('hex');
  const sourceHostId = randomUUID(), sourceVmId = randomUUID();
  const secondSourceHostId = randomUUID(), secondSourceVmId = randomUUID();
  const targetHostId = randomUUID(), remoteVmId = randomUUID();
  const transferId = randomUUID(), snapshotId = randomUUID();
  const sourceSystemUuid = randomUUID();
  let bmcIdentity = sourceSystemUuid;
  let changeIdentityAfterForceOff = false;
  let poweredOff = false, targetRunning = false, targetRetired = false;
  let activeVmId = '', bmcOffCount = 0, targetStartCount = 0;
  let targetIdentity = targetHostId;
  const sourceAt = Date.now(), plan = {
    sourceHostId, sourceVmId, targetHostId, transferId, remoteVmId, snapshotId,
    sha256: 'a'.repeat(64), snapshotAt: new Date(sourceAt).toISOString(),
    maxReplicaAgeMinutes: 10,
  };
  const bmc = createServer(tls, (req, res) => void (async () => {
    assert.equal(req.headers.authorization,
      `Basic ${Buffer.from('admin:password').toString('base64')}`);
    if (req.method === 'POST') {
      assert.equal(req.url, '/redfish/v1/Systems/1/Actions/ComputerSystem.Reset');
      assert.deepEqual(await input(req), { ResetType: 'ForceOff' });
      poweredOff = true; bmcOffCount++;
      if (changeIdentityAfterForceOff) bmcIdentity = randomUUID();
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ UUID: bmcIdentity,
      PowerState: poweredOff ? 'Off' : 'On' }));
  })());
  const target = createServer(tls, (req, res) => void (async () => {
    assert.equal(req.headers.authorization, `Bearer ${targetToken}`);
    if (req.method === 'GET' && req.url === '/peer/status') {
      res.end(JSON.stringify({ version: 1, id: targetIdentity }));
      return;
    }
    const payload = await input(req);
    assert.deepEqual(payload, { transferId, remoteVmId,
      sha256: plan.sha256, sourceVmId, snapshotId });
    const status = targetRunning ? 'running' : 'stopped';
    let result: unknown;
    if (req.url === '/peer/replica-activate-check')
      result = { ready: true, id: remoteVmId, status };
    else if (req.url === '/peer/replica-activate') {
      assert.equal(poweredOff, true);
      targetRunning = true; targetStartCount++;
      result = { id: remoteVmId, status: 'running' };
    } else if (req.url === '/peer/replica-retire') {
      assert.equal(targetRunning, false);
      targetRetired = true;
      result = { id: remoteVmId, retired: true };
    } else throw new Error(`unexpected target path ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
  })());
  const app = createServer(tls, (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${appToken}`);
    assert.equal(new URL(req.url!, 'https://localhost').searchParams.get('vmId'), remoteVmId);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ready: targetRunning, vmId: remoteVmId }));
  });
  const traffic = createServer(tls, (req, res) => void (async () => {
    assert.equal(req.headers.authorization, `Bearer ${trafficToken}`);
    if (req.method === 'POST') {
      assert.deepEqual(await input(req), { sourceVmId, targetVmId: remoteVmId });
      activeVmId = remoteVmId;
      res.end(JSON.stringify({ accepted: true, activeVmId }));
    } else {
      const source = new URL(req.url!, 'https://localhost').searchParams.get('sourceVmId');
      assert.ok(source === sourceVmId || source === secondSourceVmId);
      res.end(JSON.stringify({ activeVmId }));
    }
  })());
  const servers = [bmc, target, app, traffic];
  let witnessService: Awaited<ReturnType<typeof startHaWitnessServer>> | undefined;
  try {
    const [bmcUrl, targetUrl, appUrl, trafficUrl] = await Promise.all(
      servers.map((server) => listen(server)));
    const certFile = join(root, 'cert.pem'), keyFile = join(root, 'key.pem');
    await writeFile(certFile, cert.cert);
    await writeFile(keyFile, cert.private);
    let clock = sourceAt;
    const stateFile = join(root, 'state.json');
    await HaWitness.initialize(stateFile, [
      { sourceHostId, sourceVmId, targetHostId, failureThreshold: 2,
        sourceSystemUuid },
      { sourceHostId: secondSourceHostId, sourceVmId: secondSourceVmId,
        targetHostId, failureThreshold: 2, sourceSystemUuid },
    ]);
    const firstVm = { sourceHostId, sourceVmId, targetHostId, failureThreshold: 2,
      redfish: { baseUrl: bmcUrl, systemPath: '/redfish/v1/Systems/1',
        systemUuid: sourceSystemUuid,
        username: 'admin', password: 'password', fingerprint },
      target: { baseUrl: targetUrl, fingerprint, token: targetToken },
      application: { url: `${appUrl}health`, token: appToken, fingerprint },
      traffic: { baseUrl: trafficUrl, token: trafficToken, fingerprint },
    };
    const config = { version: 1 as const,
      listen: { host: '127.0.0.1', port: 0, certFile, keyFile },
      stateFile, sourceTokens: { [sourceHostId]: sourceToken,
        [secondSourceHostId]: secondSourceToken },
      vms: [firstVm, { ...firstVm, sourceHostId: secondSourceHostId,
        sourceVmId: secondSourceVmId }],
    };
    assert.equal(haWitnessServerConfigSchema.safeParse({ ...config,
      sourceTokens: undefined, sourceToken }).success, false,
    'one shared credential must not authorize two source hosts');
    assert.equal(haWitnessServerConfigSchema.safeParse({ ...config,
      sourceTokens: { [sourceHostId]: sourceToken,
        [secondSourceHostId]: sourceToken } }).success, false);
    assert.equal(haWitnessServerConfigSchema.safeParse({ ...config,
      sourceTokens: undefined, sourceToken, vms: [firstVm] }).success, true,
    'single-source configurations retain their existing token format');
    assert.equal(haWitnessServerConfigSchema.safeParse({ ...config,
      vms: [{ ...firstVm, redfish: { ...firstVm.redfish,
        systemUuid: undefined } }] }).success, false);
    await assert.rejects(checkHaWitnessDeployment({ ...config,
      vms: [{ ...firstVm, redfish: { ...firstVm.redfish,
        systemUuid: randomUUID() } }, config.vms[1]] }), /持久登记不一致/);
    const initialPreflight = await checkHaWitnessDeployment(config);
    assert.equal(initialPreflight.ok, true);
    assert.equal(initialPreflight.vms[0].armed, false);
    assert.equal(initialPreflight.vms[0].checks.replica, null);
    bmcIdentity = randomUUID();
    const wrongBmc = await checkHaWitnessDeployment(config);
    assert.equal(wrongBmc.ok, false);
    assert.equal(wrongBmc.vms[0].checks.redfish.ok, false);
    bmcIdentity = sourceSystemUuid;
    targetIdentity = randomUUID();
    const wrongPeer = await checkHaWitnessDeployment(config);
    assert.equal(wrongPeer.ok, false);
    assert.equal(wrongPeer.vms[0].checks.target.ok, false);
    targetIdentity = targetHostId;
    assert.equal(bmcOffCount, 0);
    assert.equal(targetStartCount, 0);
    witnessService = await startHaWitnessServer(config, () => clock);
    const address = witnessService.server.address();
    if (!address || typeof address === 'string') throw new Error('witness port missing');
    const client = new HaWitnessClient({ version: 1,
      url: `https://127.0.0.1:${address.port}/`, fingerprint, token: sourceToken });
    const secondClient = new HaWitnessClient({ version: 1,
      url: `https://127.0.0.1:${address.port}/`, fingerprint, token: secondSourceToken });
    const wrongFingerprint = fingerprint.replace(/^../, fingerprint.startsWith('00') ? 'FF' : '00');
    await assert.rejects(new HaWitnessClient({ version: 1,
      url: `https://127.0.0.1:${address.port}/`, fingerprint: wrongFingerprint,
      token: sourceToken }).authorizeStart({ sourceHostId, sourceVmId }), /指纹/);
    await assert.rejects(new HaWitnessClient({ version: 1,
      url: `https://127.0.0.1:${address.port}/`, fingerprint,
      token: randomBytes(32).toString('hex') }).authorizeStart({ sourceHostId, sourceVmId }));
    await client.authorizeStart({ sourceHostId, sourceVmId });
    await secondClient.authorizeStart({ sourceHostId: secondSourceHostId,
      sourceVmId: secondSourceVmId });
    await assert.rejects(client.authorizeStart({ sourceHostId: secondSourceHostId,
      sourceVmId: secondSourceVmId }));
    await assert.rejects(secondClient.heartbeat({ sourceHostId, sourceVmId,
      failureThreshold: 2, plan: null }));
    assert.equal((await client.heartbeat({ sourceHostId, sourceVmId,
      failureThreshold: 2, plan })).armed, true);
    const armedPreflight = await checkHaWitnessDeployment(config);
    assert.equal(armedPreflight.ok, true);
    assert.equal(armedPreflight.vms[0].armed, true);
    assert.equal(armedPreflight.vms[0].checks.replica?.ok, true);
    assert.equal(armedPreflight.vms[0].checks.application?.ok, true);
    assert.equal(bmcOffCount, 0);
    assert.equal(targetStartCount, 0);
    clock = sourceAt + 30_000;
    bmcIdentity = randomUUID();
    await witnessService.witness.sample();
    assert.equal((await client.status({ sourceHostId, sourceVmId })).phase, 'fencing');
    assert.equal(bmcOffCount, 0, 'wrong BMC identity must not receive ForceOff');
    assert.equal(targetStartCount, 0);
    bmcIdentity = sourceSystemUuid;
    changeIdentityAfterForceOff = true;
    await witnessService.witness.sample();
    assert.equal(bmcOffCount, 1);
    assert.equal(targetStartCount, 0,
      'an identity change after ForceOff must not confirm fencing');
    assert.equal((await client.status({ sourceHostId, sourceVmId })).phase, 'fencing');
    bmcIdentity = sourceSystemUuid;
    changeIdentityAfterForceOff = false;
    await witnessService.witness.sample();
    assert.equal(targetStartCount, 1);
    assert.equal(activeVmId, remoteVmId);
    assert.equal((await client.status({ sourceHostId, sourceVmId })).phase, 'promoted');
    assert.equal((await checkHaWitnessDeployment(config)).ok, true);
    await assert.rejects(client.authorizeStart({ sourceHostId, sourceVmId }));
    targetRunning = false;
    assert.deepEqual(await client.rejoin({ sourceHostId, sourceVmId,
      dataReconciled: true }), { released: true, retiredRemoteVmId: remoteVmId });
    assert.equal(targetRetired, true);
    await client.authorizeStart({ sourceHostId, sourceVmId });
  } finally {
    await witnessService?.close();
    for (const server of servers) if (server.listening) await close(server);
    const path = await realpath(root);
    if (!basename(path).startsWith('sakura-ha-witness-network-') ||
        resolve(path) === resolve(tmpdir())) throw new Error('unsafe witness cleanup');
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
