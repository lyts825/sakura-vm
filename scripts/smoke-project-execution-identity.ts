import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.argv.length, 3, 'Pass the released Debian boot-persistence fixture.');
assert.ok(process.execArgv.includes('--no-addons') && process.execArgv.includes('tsx'));
const parent = await realpath(resolve('.data/boot-persistence-test-temp'));
const root = await realpath(resolve(process.argv[2]));
assert.equal(dirname(root), parent); assert.equal(basename(root), 'sakura-boot-persistence-53hCt6');
const vmId = '24230cbf-609b-4823-a6b4-9f599a122dc8';
for (const file of ['boot-persistence-evidence.json', 'guest-task-input-evidence.json']) {
  const prior = JSON.parse(await readFile(join(root, file), 'utf8'));
  assert.equal(prior.vmId, vmId); assert.equal(prior.passed, true);
  assert.equal(prior.vmStopped ?? prior.cleanup.vmStopped, true);
}
const records = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
assert.equal(records.length, 1); assert.equal(records[0].id, vmId); assert.equal(records[0].distro, 'debian');
const proofPath = join(root, 'project-execution-identity-evidence.json');
await assert.rejects(readFile(proofPath), { code: 'ENOENT' });
const attemptPath = join(root, 'project-execution-identity-attempt-' + randomUUID() + '.json');
process.env.TEMP = process.env.TMP = parent;
process.env.SAKURA_DATA_DIR = root; process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/debian-12.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { quote } = await import('../server/files.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { ProjectTerminals } = await import('../server/project-terminals.ts');
const { ProjectExecution } = await import('../server/project-execution.ts');
const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
const { ProjectIdentities, projectIdentitySources } = await import('../server/project-identity.ts');
const { ServiceHealth } = await import('../server/service-health.ts');
const { Secrets } = await import('../server/secrets.ts');
const { vmDir } = await import('../server/model.ts');
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const files = ['server/project-execution.ts', 'server/project-run-scope.ts', 'server/guest-task.ts',
  'server/project-identity.ts', 'server/project-directory-migration.ts', 'server/workspaces.ts',
  'server/project-service-scope.ts', 'server/project-main.ts', 'server/project-services.ts',
  'server/project-terminals.ts', 'server/service-health.ts', 'server/jobs.ts', 'server/machines.ts', 'scripts/smoke-project-execution-identity.ts',
  'native/project-identity/protocol.h', 'native/project-identity/launcher.c', 'native/project-identity/controller.py'];
const sources: Record<string, string> = {};
for (const file of files) sources[file] = sha(await readFile(resolve(file)));
const identityBuild = (await projectIdentitySources()).manifest;
for (const file of identityBuild.files)
  assert.equal(sha(await readFile(resolve('native/project-identity', file.name))), file.sha256,
    'Packaged identity source must match the tested production bytes.');
const proof: any = { version: 1, fixture: root, vmId, distro: 'debian', startedAt: new Date().toISOString(),
  client: { node: process.version, pid: process.pid, execArgv: process.execArgv }, identityBuild,
  sourceSha256: sources, checks: [], cleanup: {}, passed: false };
await writeFile(attemptPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
const machines = new Machines(await createRuntime()), secrets = new Secrets(machines);
const workspaces = new Workspaces(machines, { secrets }), terminals = new ProjectTerminals(machines, workspaces);
const execution = new ProjectExecution(machines, terminals), migrations = new ProjectDirectoryMigrations(machines, workspaces);
const identities = new ProjectIdentities(machines);
const originalExec = machines.exec.bind(machines), originalInput = machines.execInput.bind(machines);
const marker = 'owned-project-command-' + randomUUID(), secret = 'owned-secret-' + randomUUID();
const secretName = 'owned-execution-' + randomUUID().slice(0, 8);
let initialized = false, loseStop = false, lostReplies = 0, lostRunReplies = 0, transportChecks = 0;
const stoppedReplyRunIds = new Set<string>();
let health: InstanceType<typeof ServiceHealth> | undefined;
const checkTransport = (command: string) => {
  assert.ok(!command.includes(secret), 'A root command argv contains a secret body.');
  assert.ok(!command.includes(marker), 'A root command argv contains the project command body.');
  transportChecks++;
};
machines.exec = async (...args) => {
  checkTransport(args[1]);
  const result = await originalExec(...args);
  const request = args[1].match(/\/controller\.py'\s+'([A-Za-z0-9+/=]+)'$/);
  if (loseStop && request) {
    const control = JSON.parse(Buffer.from(request[1], 'base64').toString());
    if (control.action === 'stop') {
      assert.equal(result.code, 0, result.stderr); stoppedReplyRunIds.add(control.runId); lostReplies++;
      throw new Error('Owned successful stop acknowledgement intentionally lost.');
    }
    if (control.action === 'run' && stoppedReplyRunIds.has(control.runId)) {
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).result.phase, 'closed'); lostRunReplies++;
      throw new Error('Owned exact closed-ticket read acknowledgement intentionally lost.');
    }
  }
  return result;
};
machines.execInput = async (...args) => { checkTransport(args[1]); return originalInput(...args); };
const guest = async (command: string) => {
  const result = await machines.exec(vmId, command, 15000);
  assert.equal(result.code, 0, result.stderr + result.stdout); return result.stdout.trim();
};
const python = (source: string) => '/usr/bin/python3 -I -S -c ' + quote(source);
const journal = async () => JSON.parse(await readFile(join(vmDir(vmId), 'project-identities', 'default.json'), 'utf8'));
async function start() {
  assert.equal(machines.state(vmId), 'stopped'); await machines.start(vmId);
  for (let n = 0; machines.state(vmId) === 'starting' && n < 600; n++) await delay(250);
  assert.equal(machines.state(vmId), 'running');
}
async function stop() {
  await guest('/bin/sync'); const done = machines.live.get(vmId)?.done;
  await machines.stop(vmId, true); if (done) await done;
  assert.equal(machines.state(vmId), 'stopped');
}
async function migrate() {
  const preview = await migrations.preview(vmId); assert.ok(preview.plan);
  const plan = preview.plan!;
  const applied = await migrations.apply(vmId, { action: 'apply', version: 1, reviewed: true,
    planId: plan.proposal.planId, sha256: plan.sha256 });
  assert.equal(applied.plan?.state, 'applied'); return applied.plan!.activatedIdentity!;
}
try {
  await machines.init(); initialized = true; assert.equal(machines.records.size, 1); await start();
  await workspaces.projects.update(vmId, 'default');
  const directory = '/srv/projects/execution-' + randomUUID();
  await guest('install -d -m 755 /srv/projects\nmkdir -m 700 -- ' + quote(directory));
  await secrets.save(vmId, { name: secretName, value: secret });
  await workspaces.save(vmId, { directory, template: 'none', command: '', setup: '', repository: '',
    environment: { OWNED_MESSAGE: '完整环境' }, secrets: { TOKEN: secretName } });
  const identity = await migrate(); assert.notEqual(identity.uid, 0);
  proof.checks.push({ name: 'explicit-directory-plan-and-fixed-account', identity, passed: true });

  const inspect = python(`import fcntl,json,os\nmarker=${JSON.stringify(marker)}\n` +
    `fields=open('/proc/self/status').read().splitlines()\nfds={}\nfor name in os.listdir('/proc/self/fd'):\n` +
    ` try:fds[name]=os.readlink('/proc/self/fd/'+name)\n except FileNotFoundError:pass\n` +
    `print(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'groups':os.getgroups(),'cwd':os.getcwd(),'home':os.environ['HOME'],` +
    `'message':os.environ['OWNED_MESSAGE'],'cgroup':open('/proc/self/cgroup').read().strip(),'net':os.readlink('/proc/self/ns/net'),` +
    `'caps':next(line for line in fields if line.startswith('CapEff:')),'nnp':next(line for line in fields if line.startswith('NoNewPrivs:')),` +
    `'fds':fds,'seals':fcntl.fcntl(3,1034)}))\n`);
  const result = await execution.run(vmId, { command: inspect, timeoutSeconds: 30 });
  assert.equal(result.scope, 'project'); assert.equal(result.code, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.equal(actual.uid, identity.uid); assert.equal(actual.gid, identity.gid); assert.deepEqual(actual.groups, []);
  assert.equal(actual.cwd, directory); assert.equal(actual.home, identity.home); assert.equal(actual.message, '完整环境');
  assert.match(actual.cgroup, /^0::\/sakura-task-[a-f0-9-]{36}$/); assert.match(actual.caps, /0+$/);
  assert.match(actual.nnp, /1$/); assert.equal(actual.seals, 15);
  assert.ok(Object.values(actual.fds).every(value => !String(value).includes('/sys/fs/cgroup') && !String(value).includes('control.lock')));
  assert.match(actual.fds['3'], /memfd:sakura/);
  assert.equal((await journal()).runs.at(-1).phase, 'closed');
  proof.checks.push({ name: 'default-public-command-uid-home-capabilities-and-fds', actual, passed: true });
  const redacted = await execution.run(vmId, { command: 'printf "%s\\n" "$TOKEN"; printf "%s" "$TOKEN" >&2; exit 23' });
  assert.equal(redacted.code, 23); assert.equal(redacted.stdout, '[私密配置已隐藏]\n');
  assert.equal(redacted.stderr, '[私密配置已隐藏]');
  proof.checks.push({ name: 'secret-output-redaction-and-nonzero-status', code: redacted.code, passed: true });

  const betaDirectory = '/srv/projects/neighbor-' + randomUUID();
  await guest('mkdir -m 700 -- ' + quote(betaDirectory));
  const index = await workspaces.projects.create(vmId, 'Owned execution neighbor ' + randomUUID().slice(0, 8), async () => {
    await workspaces.save(vmId, { directory: betaDirectory, template: 'none', command: '', setup: '', repository: '' });
  });
  const beta = await workspaces.projects.with(vmId, index.active, migrate);
  assert.notEqual(beta.uid, identity.uid);
  const denied = await execution.run(vmId, { command: python(`import os\n` +
    `try:os.open(${JSON.stringify(directory + '/forbidden')},os.O_WRONLY|os.O_CREAT,0o600)\n` +
    `except PermissionError:print('permission-denied')\nelse:raise RuntimeError('cross-account write succeeded')\n`) }, index.active);
  assert.equal(denied.code, 0, denied.stderr); assert.equal(denied.stdout, 'permission-denied\n');
  proof.checks.push({ name: 'neighbor-project-write-denied', uid: beta.uid, otherUid: identity.uid, passed: true });

  await workspaces.projects.with(vmId, 'default', async () => {
    const config = await workspaces.config(vmId); await workspaces.save(vmId, { ...config, networkIsolation: 'private' });
  });
  const privateResult = await execution.run(vmId, { command: python(`import json,os,socket\n` +
    `assert list(socket.if_nameindex())==[(1,'lo')]\n` +
    `s=socket.socket();s.settimeout(.5)\ntry:s.connect(('1.1.1.1',443))\nexcept OSError:pass\n` +
    `else:raise RuntimeError('outbound connected')\nprint(json.dumps({'uid':os.getuid(),'net':os.readlink('/proc/self/ns/net')}))\n`) }, 'default');
  proof.privateCommandResult = privateResult;
  assert.equal(privateResult.code, 0, JSON.stringify(privateResult));
  const isolated = JSON.parse(privateResult.stdout);
  assert.equal(isolated.uid, identity.uid); assert.notEqual(isolated.net, actual.net);
  proof.checks.push({ name: 'private-account-command-keeps-loopback-only-network', actual: isolated, passed: true });

  const childMarker = directory + '/cancel-' + randomUUID() + '.json', abort = new AbortController();
  const cancelled = execution.run(vmId, { command: python(`import json,os,signal,time\n` +
    `if os.fork()==0:\n os.setsid();signal.signal(signal.SIGTERM,signal.SIG_IGN)\n` +
    ` with open(${JSON.stringify(childMarker)},'w') as f:json.dump({'pid':os.getpid(),'uid':os.getuid(),'cgroup':open('/proc/self/cgroup').read().strip()},f)\n` +
    ` while True:time.sleep(1)\ntime.sleep(600)\n`), timeoutSeconds: 30 }, 'default', abort.signal);
  const outcome = cancelled.then(() => false, () => true);
  let child: any;
  for (let n = 0; n < 200; n++) {
    const view = await machines.exec(vmId, 'test -f ' + quote(childMarker) + ' && cat ' + quote(childMarker), 5000);
    if (view.code === 0) { child = JSON.parse(view.stdout); break; } await delay(50);
  }
  assert.ok(child); assert.equal(child.uid, identity.uid); abort.abort(); assert.equal(await outcome, true);
  await guest('test ! -e /sys/fs/cgroup/' + child.cgroup.slice(4));
  assert.equal((await journal()).runs.at(-1).phase, 'closed');
  proof.checks.push({ name: 'cancel-cleans-account-detached-descendant', child, passed: true });

  loseStop = true;
  await assert.rejects(execution.run(vmId, { command: 'true' }, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  loseStop = false; assert.ok(lostReplies > 0 && lostRunReplies > 0);
  const pending = (await journal()).runs.at(-1); assert.equal(pending.phase, 'active'); assert.ok(pending.run);
  const recovered = await execution.run(vmId, { command: 'printf recovered' }, 'default');
  assert.equal(recovered.code, 0, recovered.stderr); assert.equal(recovered.stdout, 'recovered');
  assert.equal((await journal()).runs.find((run: any) => run.runId === pending.runId).phase, 'closed');
  proof.checks.push({ name: 'lost-stop-and-read-acknowledgements-recovered-on-next-public-command',
    runId: pending.runId, lostReplies, lostRunReplies, passed: true });

  loseStop = true;
  await assert.rejects(execution.run(vmId, { command: 'true' }, 'default'), { code: 'PROJECT_IDENTITY_CLEANUP_FAILED' });
  loseStop = false; const old = (await journal()).runs.at(-1);
  await stop(); await start();
  const afterBoot = await execution.run(vmId, { command: 'id -u' }, 'default');
  assert.equal(afterBoot.code, 0, afterBoot.stderr); assert.equal(Number(afterBoot.stdout), identity.uid);
  const retired = (await journal()).runs.find((run: any) => run.runId === old.runId);
  assert.equal(retired.phase, 'closed'); assert.equal(retired.retirement.reason, 'guest-reboot');
  assert.notEqual(retired.retirement.bootId, old.owner.bootId); assert.deepEqual(retired.run, old.run);
  assert.equal((await identities.inspect(vmId, 'default'))?.uid, identity.uid);
  proof.checks.push({ name: 'real-cold-reboot-retires-old-ticket-and-preserves-account', retirement: retired.retirement, passed: true });

  const healthMarker = directory + '/health-' + randomUUID() + '.json';
  const healthCommand = python(`import hashlib,json,os\n` +
    `with open(${JSON.stringify(healthMarker)},'w') as f:json.dump({'uid':os.getuid(),'gid':os.getgid(),` +
    `'cgroup':open('/proc/self/cgroup').read().strip(),'net':os.readlink('/proc/self/ns/net'),` +
    `'secretSha256':hashlib.sha256(os.environ['TOKEN'].encode()).hexdigest()},f)\n`);
  const action = async (operation: 'start' | 'stop') => workspaces.projects.with(vmId, 'default', async () => {
    const key = workspaces.projects.key(vmId);
    await workspaces.run(vmId, operation); await workspaces.jobs.wait(key);
    const job = workspaces.jobs.view(key); assert.equal(job?.status, 'done', job?.error || job?.log);
  });
  await workspaces.projects.with(vmId, 'default', async () => {
    const config = await workspaces.config(vmId);
    await workspaces.save(vmId, { ...config, services: [{ name: 'api', command: 'sleep 600',
      health: { command: healthCommand, interval: 60, timeout: 30, failures: 1, restart: false } }] });
  });
  await action('start'); health = new ServiceHealth(machines, workspaces);
  await workspaces.projects.with(vmId, 'default', async () => { (await health!.expect(vmId, 'start'))(true); });
  await health.tick(Date.now());
  const healthData = JSON.parse(await guest('cat ' + quote(healthMarker)));
  assert.equal(healthData.uid, identity.uid); assert.equal(healthData.gid, identity.gid);
  assert.match(healthData.cgroup, /^0::\/sakura-task-[a-f0-9-]{36}$/);
  assert.equal(healthData.secretSha256, sha(Buffer.from(secret)));
  await workspaces.projects.with(vmId, 'default', async () => {
    assert.equal((await health!.view(vmId)).services[0].status, 'healthy');
  });
  const account = (await identities.inspect(vmId, 'default'))!;
  const oldNetwork = await identities.network(vmId, account); assert.ok(oldNetwork);
  await action('stop'); await guest('test ! -e /run/netns/sk-default');
  await action('start');
  const newNetwork = await identities.network(vmId, account); assert.ok(newNetwork);
  assert.equal(newNetwork.bootId, oldNetwork.bootId); assert.notEqual(newNetwork.generation, oldNetwork.generation);
  const afterRestart = await execution.run(vmId, { command: 'id -u' }, 'default');
  assert.equal(afterRestart.code, 0, afterRestart.stderr); assert.equal(Number(afterRestart.stdout), identity.uid);
  await action('stop'); await health.close(); health = undefined;
  proof.checks.push({ name: 'account-health-probe-and-same-boot-stop-restart', actual: healthData,
    oldGeneration: oldNetwork.generation, newGeneration: newNetwork.generation, passed: true });
  proof.transportChecks = transportChecks;
} catch (error) {
  proof.error = error instanceof Error ? error.message : String(error);
  proof.errorStack = error instanceof Error ? error.stack : undefined; console.error(proof.error);
} finally {
  loseStop = false;
  try { await health?.close(); await execution.close(); await terminals.close(); await workspaces.close(); proof.cleanup.servicesClosed = true; }
  catch (error) { proof.cleanup.serviceError = String(error); }
  if (initialized && machines.live.has(vmId)) {
    try { await stop(); proof.cleanup.synced = true; } catch (error) { proof.cleanup.stopError = String(error); }
  }
  try {
    if (initialized) proof.cleanup.vmStopped = machines.state(vmId) === 'stopped' && machines.live.size === 0;
    await secrets.remove(vmId, secretName); proof.cleanup.testSecretRemoved = true;
    await machines.close(); proof.cleanup.closed = true;
  } catch (error) { proof.cleanup.error = String(error); }
  proof.sourceUnchanged = true;
  for (const file of files) if (sha(await readFile(resolve(file))) !== sources[file]) proof.sourceUnchanged = false;
  proof.completedAt = new Date().toISOString();
  proof.passed = !proof.error && proof.checks.length === 9 && proof.sourceUnchanged && proof.cleanup.servicesClosed &&
    proof.cleanup.synced && proof.cleanup.vmStopped && proof.cleanup.testSecretRemoved && proof.cleanup.closed;
  await writeFile(attemptPath, JSON.stringify(proof, null, 2) + '\n');
  await writeFile(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ proof: proofPath, passed: proof.passed, checks: proof.checks.length,
    vmStopped: proof.cleanup.vmStopped }));
  if (!proof.passed) process.exitCode = 1;
}
