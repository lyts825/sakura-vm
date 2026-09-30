import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { generate } from 'selfsigned';
import { HaWitnessClient } from '../server/ha-witness-client.ts';
import { HaWitness } from '../server/ha-witness-core.ts';
import { haWitnessServerConfigSchema, startHaWitnessServer } from '../server/ha-witness-server.ts';
import { checkHaWitnessDeployment } from '../server/ha-witness-preflight.ts';
import { observeHaFailoverDrill, prepareHaFailoverDrill } from '../server/ha-witness-drill.ts';

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
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
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
  let activeVmId = sourceVmId, bmcOffCount = 0, targetStartCount = 0;
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
  let observing: ReturnType<typeof observeHaFailoverDrill> | undefined;
  const drillAbort = new AbortController();
  let cliObserver: ChildProcess | undefined;
  let cliExited: Promise<number | null> | undefined;
  let cliOutput = '';
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
    config.listen.port = address.port;
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
    await assert.rejects(prepareHaFailoverDrill(config, sourceVmId), /基线未就绪/);
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
    const drillPlan = await prepareHaFailoverDrill(config, sourceVmId);
    const caFile = join(root, 'bmc-ca.pem');
    await writeFile(caFile, cert.cert);
    const caConfig = { ...config, vms: config.vms.map((item, index) => index ? item :
      { ...item, redfish: { ...item.redfish, fingerprint: undefined, caFile } }) };
    const caPlan = await prepareHaFailoverDrill(caConfig, sourceVmId);
    await writeFile(caFile, `${cert.cert}\n`);
    await assert.rejects(observeHaFailoverDrill(caConfig, caPlan,
      { output: join(root, 'changed-ca.jsonl') }), /配置不一致/,
    'changing CA contents at the same path invalidates a reviewed drill plan');
    await assert.rejects(observeHaFailoverDrill({ ...config,
      vms: config.vms.map((item, index) => index ? item : { ...item,
        traffic: { ...item.traffic, baseUrl: 'https://unreviewed.invalid/' } }) }, drillPlan,
    { output: join(root, 'unreviewed.jsonl') }), /配置不一致/);
    if (process.env.SAKURA_TEST_HA_WITNESS_ENTRY) {
      const cliEntry = resolve(process.env.SAKURA_TEST_HA_WITNESS_ENTRY);
      const cliConfig = join(root, 'cli-config.json'), cliPlan = join(root, 'cli-plan.json');
      await writeFile(cliConfig, JSON.stringify(config), { mode: 0o600, flush: true });
      const planned = await promisify(execFile)(process.execPath, [cliEntry, '--drill-plan',
        cliConfig, sourceVmId, '--output', cliPlan], { windowsHide: true, timeout: 15_000 });
      assert.equal(JSON.parse(planned.stdout).ready, true);
      const generated = JSON.parse(await readFile(cliPlan, 'utf8'));
      assert.equal(generated.replica.remoteVmId, remoteVmId);
      cliObserver = spawn(process.execPath, [cliEntry, '--observe', cliConfig,
        '--plan', cliPlan, '--output', join(root, 'cli-observations.jsonl'),
        '--timeout-seconds', '60'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      cliExited = new Promise((done, fail) => {
        cliObserver!.once('error', fail); cliObserver!.once('exit', done);
      });
      const ready = new Promise<void>((done, fail) => {
        const timer = setTimeout(() => fail(new Error(`compiled CLI baseline failed: ${cliOutput}`)), 15_000);
        const consume = (chunk: Buffer) => {
          cliOutput += chunk.toString();
          for (const line of cliOutput.split(/\r?\n/)) {
            try {
              const value = JSON.parse(line);
              if (value.phase === 'source' && value.sourceStartAllowed === true) {
                clearTimeout(timer); done();
              }
            } catch { /* A JSON line may still be incomplete. */ }
          }
        };
        cliObserver!.stdout!.on('data', consume); cliObserver!.stderr!.on('data', consume);
        void cliExited!.then(() => { clearTimeout(timer); fail(new Error(cliOutput)); }, fail);
      });
      await ready;
    }
    let baselineCaptured = () => {};
    const baseline = new Promise<void>((done) => { baselineCaptured = done; });
    observing = observeHaFailoverDrill(config, drillPlan, {
      output: join(root, 'observations.jsonl'), intervalMs: 25, timeoutMs: 30_000,
      signal: drillAbort.signal,
      onSample: (sample) => {
        if (sample.phase === 'source' && sample.sourceStartAllowed === true) baselineCaptured();
      },
    });
    await Promise.race([baseline, observing.then((result) => {
      throw new Error(`drill observer did not capture a baseline: ${JSON.stringify(result)}`);
    })]);
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
    targetIdentity = randomUUID();
    await witnessService.witness.sample();
    assert.equal(targetStartCount, 0, 'wrong target host identity must not activate a replica');
    assert.equal((await client.status({ sourceHostId, sourceVmId })).phase, 'fenced');
    bmcIdentity = randomUUID();
    await witnessService.close();
    witnessService = await startHaWitnessServer(config, () => clock);
    await witnessService.witness.drain();
    await witnessService.witness.sample();
    assert.equal(targetStartCount, 0, 'restarted witness must recheck a historical Off confirmation');
    assert.equal(bmcOffCount, 1, 'a durable fence is checked without replaying ForceOff');
    await assert.rejects(client.authorizeStart({ sourceHostId, sourceVmId }));
    bmcIdentity = sourceSystemUuid;
    targetIdentity = targetHostId;
    await witnessService.witness.sample();
    assert.equal(targetStartCount, 1);
    assert.equal(activeVmId, remoteVmId);
    assert.equal((await client.status({ sourceHostId, sourceVmId })).phase, 'promoted');
    assert.equal((await checkHaWitnessDeployment(config)).ok, true);
    const observed = await observing;
    assert.equal(observed.ok, true);
    assert.equal(observed.physicalNodeIndependenceVerified, false,
      'a same-computer fixture cannot certify three independent physical nodes');
    const evidence = await readFile(join(root, 'observations.jsonl'), 'utf8');
    for (const token of [sourceToken, secondSourceToken, targetToken, appToken, trafficToken])
      assert.equal(evidence.includes(token), false);
    const samples = evidence.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(samples[1].type, 'baseline');
    assert.equal(samples[1].sample.sourceStartAllowed, true);
    assert.equal(samples.at(-1).ok, true);
    assert.equal(samples.at(-2).sample.sourceStartAllowed, false);
    if (cliExited) {
      assert.equal(await cliExited, 0, cliOutput);
      const cliEvidence = (await readFile(join(root, 'cli-observations.jsonl'), 'utf8'))
        .trim().split('\n').map((line) => JSON.parse(line));
      assert.equal(cliEvidence[1].type, 'baseline');
      assert.equal(cliEvidence.at(-1).promotionObserved, true);
      assert.equal(cliEvidence.at(-1).physicalNodeIndependenceVerified, false);
      for (const token of [sourceToken, secondSourceToken, targetToken, appToken, trafficToken])
        assert.equal(JSON.stringify(cliEvidence).includes(token), false);
    }
    await assert.rejects(observeHaFailoverDrill(config, drillPlan,
      { output: join(root, 'observations.jsonl') }), { code: 'EEXIST' });
    poweredOff = false; targetRunning = false;
    await witnessService.close();
    witnessService = await startHaWitnessServer(config, () => clock);
    await witnessService.witness.drain();
    await witnessService.witness.sample();
    assert.equal(targetStartCount, 1, 'a revived source blocks restarting the promoted target');
    assert.equal(bmcOffCount, 1, 'a revived source is not blindly powered off again');
    await assert.rejects(client.authorizeStart({ sourceHostId, sourceVmId }));
    poweredOff = true;
    await witnessService.witness.sample();
    assert.equal(targetStartCount, 2, 'the same promoted replica is restarted after Off is confirmed');
    await assert.rejects(client.authorizeStart({ sourceHostId, sourceVmId }));
    targetRunning = false;
    assert.deepEqual(await client.rejoin({ sourceHostId, sourceVmId,
      dataReconciled: true }), { released: true, retiredRemoteVmId: remoteVmId });
    assert.equal(targetRetired, true);
    assert.deepEqual(await client.rejoin({ sourceHostId, sourceVmId, dataReconciled: true }),
      { released: true, retiredRemoteVmId: remoteVmId });
    await client.authorizeStart({ sourceHostId, sourceVmId });
  } finally {
    drillAbort.abort();
    if (cliObserver && cliObserver.exitCode === null && cliObserver.signalCode === null)
      cliObserver.kill('SIGTERM');
    await cliExited;
    await witnessService?.close();
    await observing;
    for (const server of servers) if (server.listening) await close(server);
    const path = await realpath(root);
    if (!basename(path).startsWith('sakura-ha-witness-network-') ||
        resolve(path) === resolve(tmpdir())) throw new Error('unsafe witness cleanup');
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
