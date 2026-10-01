import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyReleaseManifest } from './release-manifest.mjs';

assert.equal(process.argv.length, 5,
  'Use node scripts/smoke-runtime-identity-http.mjs <stopped-53hCt6-fixture> <verified-new-release> <current-freeze-json>.');
assert.equal(process.platform, 'win32', 'This owned fixture has a Windows host.');
assert.deepEqual(process.execArgv, [], 'Use the default Node runtime without extra options.');
assert.equal((process.env.NODE_OPTIONS || '').trim(), '', 'NODE_OPTIONS must not inject preload or runtime options.');
const workspace = await realpath(resolve('.'));
assert.match(workspace, /^[dD]:\\/);
const parent = await realpath(join(workspace, '.data/boot-persistence-test-temp'));
const data = await realpath(resolve(process.argv[2]));
assert.equal(dirname(data), parent);
assert.equal(basename(data), 'sakura-boot-persistence-53hCt6');
assert.ok(!(await lstat(data)).isSymbolicLink());
const vmId = '24230cbf-609b-4823-a6b4-9f599a122dc8';
const records = JSON.parse(await readFile(join(data, 'machines.json'), 'utf8'));
assert.equal(records.length, 1); assert.equal(records[0].id, vmId);
assert.equal(records[0].name, 'boot-persistence-debian'); assert.equal(records[0].distro, 'debian');
assert.equal(records[0].bootstrapped, true);
assert.deepEqual(records[0].forwards, []);
for (const key of ['sandbox', 'storagePoolId', 'haPromotion', 'haRetirement', 'lastError']) assert.equal(records[0][key], undefined);
const machineDirectory = await realpath(join(data, 'machines', vmId));
assert.equal(dirname(machineDirectory), await realpath(join(data, 'machines')));
assert.equal(dirname(await realpath(join(machineDirectory, 'disk.qcow2'))), machineDirectory);
const digest = value => createHash('sha256').update(value).digest('hex');
const exactQemu = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "$r='" + data.replaceAll("'", "''") + "';$v='" + vmId + "';@(" +
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(sakura-qemu|qemu-system[^.]*)\\.exe$' -and $_.CommandLine -and $_.CommandLine.Contains($r) -and $_.CommandLine.Contains($v) }).Count"
], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }).trim());
const qemuIdentity = () => {
  const value = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$r='" + data.replaceAll("'", "''") + "';$v='" + vmId + "';$p=@(" +
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(sakura-qemu|qemu-system[^.]*)\\.exe$' -and $_.CommandLine -and $_.CommandLine.Contains($r) -and $_.CommandLine.Contains($v) });" +
    "if($p.Count -ne 1){throw 'Owned QEMU identity count changed'};" +
    "$p | ForEach-Object { @{pid=$_.ProcessId;created=$_.CreationDate.ToUniversalTime().ToString('o');argv=$_.CommandLine} } | ConvertTo-Json -Compress"
  ], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }).trim());
  const ports = [...value.argv.matchAll(/hostfwd=tcp:127\.0\.0\.1:(\d+)-:22/g)]; assert.equal(ports.length, 1);
  const port = Number(ports[0][1]); assert.ok(port >= 1024 && port <= 65535);
  return { pid: value.pid, created: value.created, argvSha256: digest(value.argv), sshPort: port };
};
assert.equal(exactQemu(), 0, 'The exact owned fixture must already be stopped.');
const priorFile = join(data, 'project-execution-identity-evidence.json');
const prior = JSON.parse(await readFile(priorFile, 'utf8'));
assert.equal(prior.vmId, vmId); assert.equal(prior.passed, true); assert.equal(prior.cleanup.vmStopped, true);
const historical = [];
for (const name of await readdir(data)) if (name.endsWith('.json') &&
    (name.includes('evidence') || /^compiled-project-identity-http-/.test(name))) {
  const file = join(data, name), metadata = await lstat(file);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size < 16 * 1024 * 1024);
  historical.push({ file, sha256: digest(await readFile(file)) });
}
// Historical proofs retain their original source attribution. They do not
// authorize this build or need to match the new source hashes.
const freezeFile = await realpath(resolve(process.argv[4]));
assert.equal(dirname(freezeFile), await realpath(join(workspace, '.data/network-remaining-test-temp')));
assert.match(basename(freezeFile), /^runtime-identity-freeze-[a-f0-9-]{36}\.json$/);
const freezeBytes = await readFile(freezeFile), freeze = JSON.parse(freezeBytes);
assert.equal(freeze.version, 1); assert.equal(freeze.frozen, true);
const required = ['server/runtime-versions.ts', 'server/runtime-probe.ts', 'server/runtime-config.ts',
  'server/runtime-install.ts', 'server/workspaces.ts', 'server/guest-task.ts', 'server/project-run-scope.ts',
  'server/project-identity.ts', 'server/project-main.ts', 'server/project-services.ts', 'server/project-service-scope.ts',
  'server/project-directory-migration.ts', 'server/project-terminals.ts', 'server/jobs.ts', 'plugins/runtimes/server.ts',
  'native/project-identity/controller.py', 'native/project-identity/launcher.c', 'native/project-identity/protocol.h'];
for (const file of required) assert.match(freeze.sourceSha256?.[file] || '', /^[a-f0-9]{64}$/);
const sources = { ...freeze.sourceSha256 };
for (const [file, sha256] of Object.entries(sources)) {
  assert.ok(/^(server|plugins|native)\/[A-Za-z0-9/_.-]+$/.test(file) && file.split('/').every(part => part && part !== '.' && part !== '..'));
  assert.match(sha256, /^[a-f0-9]{64}$/); assert.equal(digest(await readFile(join(workspace, file))), sha256, file);
}
for (const file of ['server/index.ts', 'server/sdk.ts', 'server/access-control.ts', 'server/project-permissions.ts',
  'plugins/projects/server.ts', 'scripts/cli.mjs', 'scripts/smoke-runtime-identity-http.mjs'])
  sources[file] = digest(await readFile(join(workspace, file)));
const serverRoot = await realpath(resolve(process.argv[3]));
assert.ok(serverRoot.startsWith(workspace + sep) && serverRoot !== data && !serverRoot.startsWith(data + sep));
const release = await verifyReleaseManifest(serverRoot);
const serverFile = join(serverRoot, '.sakura-server/index.js'), serverBytes = await readFile(serverFile);
assert.equal(digest(await readFile(join(serverRoot, 'scripts/cli.mjs'))), sources['scripts/cli.mjs']);
const native = JSON.parse(await readFile(join(serverRoot, '.sakura-server/assets/project-identity/manifest.json'), 'utf8'));
assert.equal(native.version, 1); assert.equal(native.files.length, 3);
assert.equal(new Set(native.files.map(file => file.name)).size, 3); assert.match(native.build, /^[a-f0-9]{64}$/);
for (const file of native.files) {
  assert.ok(['protocol.h', 'launcher.c', 'controller.py'].includes(file.name));
  assert.equal(digest(await readFile(join(serverRoot, '.sakura-server/assets/project-identity', file.name))), file.sha256);
  assert.equal(file.sha256, sources['native/project-identity/' + file.name]);
}
process.env.TEMP = process.env.TMP = parent;
const invocation = randomUUID(), proofFile = join(data, 'compiled-runtime-identity-http-' + invocation + '.json');
const bridgeFile = join(data, 'runtime-http-sigint-bridge-' + invocation + '.mjs');
const bridge = "import { pathToFileURL } from 'node:url';\n" +
  "const requestId=" + JSON.stringify(invocation) + ";const server=process.argv[2];const serverURL=pathToFileURL(server).href;\n" +
  "process.send?.({type:'runtime-http-client',pid:process.pid,node:process.version,execArgv:process.execArgv,server});\n" +
  "process.on('message', message => {\n" +
  " if (message?.type!=='owned-runtime-http-sigint'||message.requestId!==requestId)return;\n" +
  " const listeners=process.listenerCount('SIGINT');if(listeners<1){console.error('Production SIGINT handler absent');process.exit(1);}\n" +
  " process.send({type:'runtime-http-sigint-delivered',requestId,pid:process.pid,server,listeners},error=>{if(error)process.exit(1);process.emit('SIGINT');});\n" +
  "});\nawait import(serverURL);\nprocess.send?.({type:'runtime-http-imported',pid:process.pid,server,serverURL});\n";
const proof = { version: 1, invocation, passed: false, phase: 'initializing', fixture: data, vmId, distro: 'debian',
  startedAt: new Date().toISOString(), client: { node: process.version, pid: process.pid, execArgv: process.execArgv },
  serverRoot, serverSha256: digest(serverBytes), releaseFingerprint: release.fingerprint,
  identityBuild: native.build, frozenStamp: { file: freezeFile, sha256: digest(freezeBytes) }, sourceSha256: sources,
  previousEvidence: { files: historical, attribution: 'Historical proofs remain byte-for-byte with their original source hashes.' },
  signalBridge: { file: bridgeFile, sha256: digest(bridge), deliveries: [],
    mode: 'private IPC invokes production SIGINT handler; Windows native console delivery is not asserted' },
  cases: [], cleanup: {}, officialNode: { version: '22.12.0', source: 'https://nodejs.org/dist/v22.12.0/' } };
// This must precede settings changes, native module initialization and VM start.
await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
const persist = () => writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n');
const saved = new Map(), protectedHostFiles = [], createdMarkers = new Map();
let server, exited, output = '', sdk, Client, started = false, stopped = true, previousActive, project, identity,
  oldGuestState, rootMarker, unknownPrefix, unknownIdentity, hostSettingsRestored = false, activeRestored = false, shutDownCleanly = false,
  observer, observerIdentity;
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const python = source => '/usr/bin/python3 -I -S -c ' + quote(source);
const pythonJson = value => 'json.loads(' + JSON.stringify(JSON.stringify(value)) + ')';
const apiPath = { vmId }, requests = [];
const route = (name, method = 'GET', body, client = sdk, signal) => client.request('/api/vms/' + vmId + '/' + name,
  { method, query: { project: project.id }, ...(body === undefined ? {} : { body }), signal: signal || AbortSignal.timeout(90_000) });
function bounded(promise, timeoutMs, message) {
  let timer;
  return Promise.race([promise, new Promise((_done, fail) => { timer = setTimeout(() => fail(Error(message)), timeoutMs); })])
    .finally(() => clearTimeout(timer));
}
async function requestSigint(child, completion, timeoutMs) {
  assert.equal(child.connected, true, 'Owned test process IPC must still be connected.');
  await bounded(new Promise((done, fail) => child.send({ type: 'owned-runtime-http-sigint', requestId: invocation },
    error => error ? fail(error) : done())), 5_000, 'Owned SIGINT delivery acknowledgement timed out.');
  return bounded(completion, timeoutMs, 'Production SIGINT handler did not finish cleanup.');
}
function signalReceipt(pid) {
  const receipt = proof.signalBridge.deliveries.find(value => value.pid === pid);
  assert.ok(receipt); assert.equal(receipt.requestId, invocation); assert.equal(receipt.server, serverFile);
  assert.ok(Number.isInteger(receipt.listeners) && receipt.listeners >= 1); return receipt;
}
async function guest(command, signal = AbortSignal.timeout(60_000)) {
  const value = await sdk.call('core.vms.exec', { path: apiPath, body: { scope: 'instance', command }, signal });
  assert.equal(value.code, 0, value.stderr + value.stdout); return value.stdout.trim();
}
async function uid(source) {
  const value = await sdk.call('core.vms.exec', { path: apiPath, query: { project: project.id },
    body: { command: python(source), timeoutSeconds: 30 }, signal: AbortSignal.timeout(45_000) });
  assert.equal(value.scope, 'project'); assert.equal(value.projectId, project.id);
  assert.equal(value.code, 0, value.stderr + value.stdout); return value.stdout.trim();
}
const guestPython = (source, signal) => guest(python(source), signal);
async function observe(source) {
  assert.ok(observer, 'Owned read-only observer must already be authenticated.');
  return new Promise((done, fail) => {
    let channel, total = 0, stdout = '', stderr = '', finished = false;
    const timer = setTimeout(() => { channel?.destroy(); finish(Error('Bounded observer read timed out.')); }, 15_000);
    const finish = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); error ? fail(error) : done(value); };
    observer.exec('/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C ' + python(source), (error, stream) => {
      if (error) return finish(error); channel = stream;
      const consume = (bytes, standard) => {
        total += bytes.length;
        if (total > 256 * 1024) { stream.destroy(); finish(Error('Observer output exceeded its metadata budget.')); return; }
        const text = bytes.toString('utf8'); if (standard) stdout += text; else stderr += text;
      };
      stream.on('data', bytes => consume(bytes, true)); stream.stderr.on('data', bytes => consume(bytes, false));
      stream.once('error', error => finish(error)); stream.once('close', code => {
        if (code !== 0) return finish(Error('Owned observer refused metadata: ' + stderr.slice(0, 1024)));
        finish(undefined, stdout.trim());
      });
    });
  });
}
async function initializeObserver() {
  const metadata = JSON.parse(await guestPython('import base64,hashlib,json,os,stat\nkeys=[]\n' +
    'for kind in ("ed25519","rsa","ecdsa"):\n p="/etc/ssh/ssh_host_"+kind+"_key.pub"\n' +
    ' try:f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)\n except FileNotFoundError:continue\n' +
    ' try:\n  i=os.fstat(f);assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and i.st_size<16384\n  keys.append(hashlib.sha256(base64.b64decode(os.read(f,16385).split()[1],validate=True)).hexdigest())\n' +
    ' finally:os.close(f)\nprint(json.dumps({"bootId":open("/proc/sys/kernel/random/boot_id").read().strip(),"hostKeys":keys}))'));
  assert.match(metadata.bootId, /^[a-f0-9-]{36}$/); assert.ok(metadata.hostKeys.length > 0);
  const qemu = qemuIdentity(), keyFile = join(machineDirectory, 'id_rsa'), keyStat = await lstat(keyFile);
  assert.ok(keyStat.isFile() && !keyStat.isSymbolicLink() && keyStat.size < 16384);
  assert.equal(dirname(await realpath(keyFile)), machineDirectory);
  const { Client: SSHClient } = await import('ssh2');
  const keyOwner = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[System.IO.File]::GetAccessControl(' + "'" + keyFile.replaceAll("'", "''") + "'" +
      ').GetOwner([System.Security.Principal.NTAccount]).Value'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }).trim();
  const privateKey = await readFile(keyFile); observer = new SSHClient();
  const keySha256 = digest(privateKey);
  observer.on('error', () => {});
  try {
    await new Promise((done, fail) => {
      observer.once('ready', done); observer.once('error', fail);
      observer.connect({ host: '127.0.0.1', port: qemu.sshPort, username: 'root', privateKey,
        readyTimeout: 15000, hostHash: 'sha256', hostVerifier: fingerprint => metadata.hostKeys.includes(fingerprint) });
    });
  } finally { privateKey.fill(0); }
  assert.deepEqual(qemuIdentity(), qemu);
  assert.equal(await observe('print(open("/proc/sys/kernel/random/boot_id").read().strip())'), metadata.bootId);
  observerIdentity = { ...metadata, qemu, privateKeyFile: keyFile,
    privateKeyFileIdentity: { device: String(keyStat.dev), inode: String(keyStat.ino), bytes: keyStat.size,
      owner: keyOwner, mode: keyStat.mode, sha256: keySha256 },
    scope: 'Read-only system Python metadata observer for this exact fixture; application execution remains the compiled API.' };
  proof.observer = observerIdentity;
}
async function guestTickets() {
  return JSON.parse(await guestPython("import hashlib,json,os,stat\np='/run/sakura-project-identities/runs';r={}\n" +
    "if os.path.lexists(p):\n assert stat.S_ISDIR(os.lstat(p).st_mode) and not stat.S_ISLNK(os.lstat(p).st_mode)\n" +
    " names=sorted(os.listdir(p));assert len(names)<=1024\n for name in names:\n" +
    "  f=os.open(p+'/'+name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);i=os.fstat(f)\n" +
    "  try:\n   assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and i.st_nlink==1 and i.st_size<=16384\n   b=os.read(f,16385);assert len(b)==i.st_size;r[name]=hashlib.sha256(b).hexdigest()\n" +
    "  finally:os.close(f)\nprint(json.dumps(r))"));
}
async function journal() { return JSON.parse(await readFile(join(machineDirectory, 'project-identities', project.id + '.json'), 'utf8')); }
async function closed() {
  const value = await journal();
  for (const run of value.runs) { assert.equal(run.phase, 'closed'); if (run.run) assert.equal(run.run.phase, 'closed'); }
  const ids = value.runs.map(run => run.runId);
  for (const id of ids) assert.match(id, /^[a-f0-9-]{36}$/);
  await guestPython('import os\nfor ident in ' + JSON.stringify(ids) + ':\n' +
    ' assert not os.path.lexists("/sys/fs/cgroup/sakura-task-"+ident)\n assert not os.path.lexists("/run/sakura-guest-tasks/"+ident)');
  return { runs: value.runs.length, allClosed: true, controlDirectoriesAbsent: true, cgroupsAbsent: true };
}
async function readMarker(file) {
  const value = JSON.parse(await observe('import json,os,stat\np=' + JSON.stringify(file) +
    '\nf=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);i=os.fstat(f)\n' +
    'try:\n assert stat.S_ISREG(i.st_mode) and i.st_uid==' + identity.uid + ' and i.st_nlink==1 and stat.S_IMODE(i.st_mode)==0o600 and i.st_size<=16384\n' +
    ' b=os.read(f,16385);assert len(b)==i.st_size;print(json.dumps({"value":json.loads(b),"device":str(i.st_dev),"inode":str(i.st_ino)}))\nfinally:os.close(f)'));
  createdMarkers.set(file, { device: value.device, inode: value.inode, uid: identity.uid }); return value.value;
}
async function waitMarker(file) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const found = await observe('import os,stat\np=' + JSON.stringify(file) + '\nprint("present" if os.path.lexists(p) and stat.S_ISREG(os.lstat(p).st_mode) and os.lstat(p).st_size>0 else "absent")');
    if (found === 'present') return readMarker(file);
    await delay(100);
  }
  throw Error('Project version process did not publish its owned marker.');
}
async function observeActive(report) {
  const runId = report.cgroup.split('sakura-task-')[1]; assert.match(runId, /^[a-f0-9-]{36}$/);
  const entry = (await journal()).runs.find(value => value.runId === runId); assert.ok(entry && entry.phase !== 'closed');
  assert.equal(entry.owner.bootId, observerIdentity.bootId); assert.equal(entry.owner.runId, runId);
  const actual = JSON.parse(await observe('import json,os,stat,struct\nreport=' + pythonJson(report) + '\n' +
    'assert open("/proc/sys/kernel/random/boot_id").read().strip()==' + JSON.stringify(observerIdentity.bootId) + '\n' +
    'p="/proc/"+str(report["pid"]);fields=open(p+"/stat").read().rsplit(") ",1)[1].split();assert fields[0] not in ("Z","X") and fields[19]==report["ticks"]\n' +
    'status=dict(line.split(":",1) for line in open(p+"/status") if ":" in line);assert all(int(part)==report["uid"] for part in status["Uid"].split())\n' +
    'assert open(p+"/cgroup").read().strip()==report["cgroup"]\nns=os.stat(p+"/ns/net");assert str(ns.st_ino)==report["networkInode"]\n' +
    'name=report["cgroup"].split("/",1)[1];cg="/sys/fs/cgroup/"+name;info=os.lstat(cg);assert stat.S_ISDIR(info.st_mode)\n' +
    'assert report["pid"] in [int(item) for item in open(cg+"/cgroup.procs").read().split()]\n' +
    'run_id=' + JSON.stringify(runId) + ';f=os.open("/run/sakura-project-identities/runs/"+run_id+".bin",os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);i=os.fstat(f)\n' +
    'try:\n assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and stat.S_IMODE(i.st_mode)==0o600 and i.st_nlink==1 and i.st_size==1024\n b=os.read(f,1025);assert len(b)==1024\nfinally:os.close(f)\n' +
    'v=struct.unpack("<8s4I5Q37s37s17s37s37s65s64s32s634s",b);assert v[0]==b"SKIDR001" and v[1:5]==(1,1,2,0) and not any(v[18])\n' +
    'def text(value):\n s=value.split(b"\\0",1);assert len(s)==2 and not any(s[1]);return s[0].decode("utf-8","strict")\n' +
    'strings=[text(part) for part in v[10:18]];expected=' + pythonJson(entry.identity) + '\n' +
    'assert strings[:5]==[expected["registryId"],expected["identityId"],expected["projectId"],run_id,' + JSON.stringify(observerIdentity.bootId) + ']\n' +
    'assert strings[5]==' + JSON.stringify(native.build) + ' and strings[6]==name and strings[7]=="sk-"+expected["projectId"]\n' +
    'assert v[5]==expected["revision"] and v[6:8]==(ns.st_dev,ns.st_ino) and v[8:10]==(info.st_dev,info.st_ino)\n' +
    'print(json.dumps({"runId":run_id,"guestTicketPhase":"active","bootId":strings[4],"pid":report["pid"],"ticks":fields[19],"cgroupDevice":str(info.st_dev),"cgroupInode":str(info.st_ino),"networkInode":str(ns.st_ino)}))'));
  assert.deepEqual(qemuIdentity(), observerIdentity.qemu); return actual;
}
function validateReport(value) {
  assert.equal(value.uid, identity.uid); assert.equal(value.euid, identity.uid); assert.equal(value.gid, identity.gid);
  assert.deepEqual(value.groups, []); assert.equal(value.home, identity.home); assert.equal(value.cwd, project.directory);
  assert.equal(value.noNewPrivs, '1'); for (const content of Object.values(value.caps)) assert.match(content, /^0+$/);
  assert.equal(value.bodyPresent, true); assert.equal(value.rootWriteDenied, true);
  assert.match(value.cgroup, /^0::\/sakura-task-[a-f0-9-]{36}$/); assert.notEqual(value.networkInode, proof.rootNetworkInode);
}
async function mode(value) {
  await uid('import os\np=' + JSON.stringify(project.directory) + '\nopen(p+"/mode","w").write(' + JSON.stringify(value) + ')\n' +
    'try:os.unlink(p+"/version-report.json")\nexcept FileNotFoundError:pass');
  createdMarkers.delete(project.directory + '/version-report.json');
}
async function check(name, action) {
  proof.phase = name; await persist();
  const began = Date.now(), detail = await action();
  proof.cases.push({ name, passed: true, elapsedMs: Date.now() - began, ...(detail === undefined ? {} : { detail }) }); await persist();
}
async function runCli(action) {
  const child = spawn(process.execPath, [join(serverRoot, 'scripts/cli.mjs'), 'runtimes', records[0].name, action],
    { cwd: serverRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SAKURA_PORT: String(proof.port), SAKURA_TOKEN: '' } });
  let stdout = '', stderr = '', failure, total = 0;
  const timer = setTimeout(() => { failure = Error('Released CLI exceeded its deadline.'); child.kill('SIGKILL'); }, 90_000);
  const collect = (stream, append) => stream.on('data', bytes => {
    total += bytes.length;
    if (total > 131072) { failure = Error('Released CLI output limit.'); child.kill('SIGKILL'); return; }
    append(bytes.toString());
  });
  collect(child.stdout, text => stdout += text); collect(child.stderr, text => stderr += text);
  let result;
  try { result = await new Promise((done, fail) => { child.once('error', fail); child.once('close', (code, signal) => done({ code, signal })); }); }
  finally { clearTimeout(timer); }
  if (failure) throw failure;
  assert.equal(result.code, 0, stderr || stdout);
  return { value: JSON.parse(stdout), executable: process.execPath, runtime: process.version,
    argv: [join(serverRoot, 'scripts/cli.mjs'), 'runtimes', records[0].name, action], defaultNodeOptions: true, ...result };
}
async function guestPreservation() {
  return JSON.parse(await guestPython("import hashlib,json,os,pwd,stat\nr={'bindings':{},'uids':{},'accounts':{}}\n" +
    "for label,p in (('bindings','/var/lib/sakura/project-identities/projects'),('uids','/var/lib/sakura/project-identities/uids')):\n" +
    " if not os.path.isdir(p):continue\n names=sorted(os.listdir(p));assert len(names)<=4096\n for name in names:\n" +
    "  f=os.open(p+'/'+name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);i=os.fstat(f)\n" +
    "  try:\n   assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and i.st_nlink==1 and i.st_size<=16384\n   b=os.read(f,16385);assert len(b)==i.st_size;r[label][name]=hashlib.sha256(b).hexdigest()\n" +
    "  finally:os.close(f)\n" +
    "for a in pwd.getpwall():\n if not a.pw_name.startswith('skp'):continue\n h=os.lstat(a.pw_dir);r['accounts'][a.pw_name]={'uid':a.pw_uid,'gid':a.pw_gid,'home':a.pw_dir,'shell':a.pw_shell,'device':str(h.st_dev),'inode':str(h.st_ino),'mode':stat.S_IMODE(h.st_mode)}\nprint(json.dumps(r))"));
}
try {
  for (const name of ['plugins.json', 'access-control.json', 'project-permissions.json']) {
    const file = join(data, name), bytes = await readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    assert.ok(!bytes || bytes.length < 2 * 1024 * 1024); saved.set(file, bytes);
  }
  const previousAccess = saved.get(join(data, 'access-control.json'));
  assert.ok(!previousAccess || JSON.parse(previousAccess).enabled === false, 'Owned fixture must start without account mode.');
  await writeFile(bridgeFile, bridge, { flag: 'wx' });
  await writeFile(join(data, 'plugins.json'), JSON.stringify({ schemaVersion: 3, plugins: ['projects', 'runtimes'], packs: [] }));
  const listener = createServer();
  await new Promise((done, fail) => listener.once('error', fail).listen(0, '127.0.0.1', done));
  const port = listener.address().port; await new Promise(done => listener.close(done)); proof.port = port;
  const origin = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, [bridgeFile, serverFile], { cwd: serverRoot, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, SAKURA_DATA_DIR: data, SAKURA_PORT: String(port),
      SAKURA_IMAGE_DIR: join(workspace, '.data/images'), SAKURA_IMAGE_PATH: join(workspace, '.data/images/debian-12.qcow2') } });
  proof.serverPid = server.pid; await persist();
  server.stdout.on('data', bytes => output = (output + bytes).slice(-65536));
  server.stderr.on('data', bytes => output = (output + bytes).slice(-65536));
  server.on('message', message => {
    if (message?.type === 'runtime-http-client') proof.serverClient = message;
    else if (message?.type === 'runtime-http-imported') proof.serverImport = message;
    else if (message?.type === 'runtime-http-sigint-delivered') proof.signalBridge.deliveries.push(message);
  });
  exited = new Promise((done, fail) => { server.once('close', (code, signal) => done({ code, signal })); server.once('error', fail); });
  let bootstrap = '';
  for (let n = 0; n < 180; n++) {
    assert.equal(server.exitCode, null, output);
    try { const response = await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(1000) }); if (response.ok) { bootstrap = (await response.json()).token; break; } } catch {}
    await delay(200);
  }
  assert.match(bootstrap, /^[a-f0-9]{64}$/);
  const generated = await fetch(origin + '/api/sdk', { headers: { 'X-Sakura-Token': bootstrap } });
  assert.equal(generated.status, 200);
  const generatedSdk = await generated.json(); proof.sdkSha256 = digest(generatedSdk.content);
  Client = (await import('data:text/javascript;base64,' + Buffer.from(generatedSdk.content).toString('base64'))).SakuraClient;
  const fetcher = async (url, options) => { const response = await fetch(url, options), parsed = new URL(url);
    if (parsed.pathname.endsWith('/runtimes')) requests.push({ method: options.method || 'GET', status: response.status }); return response; };
  sdk = new Client({ baseUrl: origin, fetcher });
  await check('compiled-service-generated-sdk-and-scope', async () => {
    const spec = await sdk.request('/api/openapi');
    assert.equal(spec['x-sakura-route-prefixes'].find(item => item.owner === 'runtimes' && item.path === '/api/vms/:vmId/runtimes')?.projectScoped, true);
    const initial = await sdk.call('core.vms.get', { path: apiPath }); assert.equal(initial.status, 'stopped');
    assert.equal((await sdk.call('core.vms.list')).length, 1);
    assert.equal((await fetch(origin + '/api/vms/' + vmId + '/runtimes')).status, 401);
    assert.equal(proof.serverClient.server, serverFile); assert.deepEqual(proof.serverClient.execArgv, []);
    assert.equal(proof.serverClient.pid, server.pid); assert.equal(proof.serverImport.server, serverFile);
    assert.equal(proof.serverImport.pid, server.pid);
  });
  started = true; stopped = false; proof.cleanup.vmStartAttempted = true; await persist();
  await sdk.call('core.vms.start', { path: apiPath });
  const deadline = Date.now() + 300000;
  while ((await sdk.call('core.vms.get', { path: apiPath })).status !== 'running') { assert.ok(Date.now() < deadline); await delay(500); }
  const catalog = await sdk.request('/api/vms/' + vmId + '/projects'); previousActive = catalog.active;
  assert.ok(catalog.projects.length < 20);
  for (const entry of catalog.projects) {
    const file = join(machineDirectory, 'project' + (entry.id === 'default' ? '' : '-' + entry.id) + '.json');
    try { protectedHostFiles.push({ file, sha256: digest(await readFile(file)) }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const journals = join(machineDirectory, 'project-identities');
  for (const name of await readdir(journals)) if (/^(default|[a-f0-9]{16})\.json$/.test(name)) {
    const file = join(journals, name); protectedHostFiles.push({ file, sha256: digest(await readFile(file)) });
  }
  oldGuestState = await guestPreservation();
  await initializeObserver();
  proof.rootNetworkInode = await guestPython('import os\nprint(os.stat("/proc/self/ns/net").st_ino)');
  await check('new-reviewed-project-directory-and-account', async () => {
    const directory = '/srv/projects/runtime-http-' + invocation;
    await guest('mkdir -m 700 -- ' + quote(directory));
    const config = { directory, template: 'none', networkIsolation: 'private',
      environment: { PATH: directory + '/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', OWNED_RUNTIME_CANARY: randomUUID() } };
    const created = await sdk.request('/api/vms/' + vmId + '/projects', { method: 'POST',
      body: { action: 'create', name: 'Owned runtime HTTP ' + invocation.slice(0, 8), config } });
    project = { id: created.active, directory, config };
    const preview = await route('project-directory-migration', 'POST', { action: 'preview', version: 1 });
    assert.equal(preview.plan.state, 'preview'); assert.equal(preview.projectId, project.id);
    assert.equal(await guest('stat -c %u ' + quote(directory)), '0');
    const applied = await route('project-directory-migration', 'POST', { action: 'apply', version: 1, reviewed: true,
      planId: preview.plan.proposal.planId, sha256: preview.plan.sha256 });
    assert.equal(applied.plan.state, 'applied'); identity = applied.plan.activatedIdentity;
    assert.ok(identity.uid > 0); assert.equal(identity.projectId, project.id);
    assert.equal(await guest('stat -c %u:%g:%a ' + quote(directory)), identity.uid + ':' + identity.gid + ':700');
    return { projectId: project.id, directory, identity };
  });
  rootMarker = '/var/lib/sakura/runtime-http-deny-' + invocation;
  await guest('mkdir -m 700 -- ' + quote(rootMarker));
  const nodeBody = ['#!/usr/bin/python3', 'import json,os,time', 'BASE=' + JSON.stringify(project.directory),
    's=dict(line.split(":",1) for line in open("/proc/self/status") if ":" in line)',
    'denied=False', 'try:open(' + JSON.stringify(rootMarker + '/forbidden') + ',"w").write("root-executed-project-version")',
    'except PermissionError:denied=True',
    'v={"uid":os.getuid(),"euid":os.geteuid(),"gid":os.getgid(),"groups":os.getgroups(),"home":os.environ.get("HOME"),"cwd":os.getcwd(),"networkInode":str(os.stat("/proc/self/ns/net").st_ino),"pid":os.getpid(),"ticks":open("/proc/self/stat").read().rsplit(") ",1)[1].split()[19],"cgroup":open("/proc/self/cgroup").read().strip(),"noNewPrivs":s["NoNewPrivs"].strip(),"caps":{key:s[key].strip() for key in ("CapInh","CapPrm","CapEff","CapBnd","CapAmb")},"rootWriteDenied":denied,"bodyPresent":bool(os.environ.get("OWNED_RUNTIME_CANARY"))}',
    'f=os.open(BASE+"/version-report.json",os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)',
    'try:os.write(f,json.dumps(v).encode());os.fsync(f)', 'finally:os.close(f)',
    'm=open(BASE+"/mode").read().strip()', 'if m=="loop":', ' while True:time.sleep(1)',
    'else:os.write(1,b"v99.31.41\\n")', ''].join('\n');
  await uid('import os\np=' + JSON.stringify(project.directory) + '\nos.mkdir(p+"/bin",0o700)\n' +
    'open(p+"/bin/node","w").write(' + JSON.stringify(nodeBody) + ');os.chmod(p+"/bin/node",0o700)\n' +
    'open(p+"/mode","w").write("normal");open(p+"/.nvmrc","w").write("v99.31\\n");open(p+"/.python-version","w").write("3\\n")');
  await check('uncached-get-does-not-probe-or-issue-tickets', async () => {
    const before = await guestTickets(), host = digest(await readFile(join(journals, project.id + '.json')));
    for (let n = 0; n < 300; n++) {
      const value = await route('runtimes'); assert.equal(value.probe.state, 'unprobed');
      assert.deepEqual(value.actual, { node: '', python: '' }); assert.deepEqual(value.declared, {}); assert.deepEqual(value.mismatches, []);
      assert.equal(value.probe.checkedAt, null); assert.equal(value.probe.bootId, null);
    }
    assert.deepEqual(await guestTickets(), before); assert.equal(digest(await readFile(join(journals, project.id + '.json'))), host);
    await guest('test ! -e ' + quote(project.directory + '/version-report.json'));
    return { polls: 300, guestRunHash: digest(JSON.stringify(before)), hostJournalHash: host };
  });
  await check('explicit-sdk-probe-full-project-uid-and-cache', async () => {
    const before = await guestTickets(), value = await route('runtimes', 'POST', { action: 'probe' });
    assert.equal(value.actual.node, '99.31.41'); assert.equal(value.declared.node, '99.31'); assert.equal(value.declared.python, '3');
    assert.equal(value.probe.state, 'cached'); assert.ok(value.probe.checkedAt); assert.equal(value.mismatches.length, 0);
    const report = await readMarker(project.directory + '/version-report.json'); validateReport(report);
    const after = await guestTickets(); assert.equal(Object.keys(after).length, Object.keys(before).length + 1);
    const markerHash = digest(JSON.stringify(report));
    for (let n = 0; n < 200; n++) assert.equal((await route('runtimes')).probe.checkedAt, value.probe.checkedAt);
    assert.deepEqual(await guestTickets(), after); assert.equal(digest(JSON.stringify(await readMarker(project.directory + '/version-report.json'))), markerHash);
    return { report, sampling: value.probe, polls: 200, cleanup: await closed() };
  });
  await check('strict-post-refuses-before-issuance', async () => {
    const before = await guestTickets();
    for (const body of [{ action: 'probe', node: '22.12.0' }, { action: 'select', environment: {} }, { action: 'install', tool: 'node', version: '22.12.0', command: 'id' }])
      await assert.rejects(route('runtimes', 'POST', body), error => error.status === 400);
    assert.deepEqual(await guestTickets(), before);
  });
  await check('http-probe-cancellation-settles-complete-ticket', async () => {
    await mode('loop'); const controller = new AbortController();
    const pending = route('runtimes', 'POST', { action: 'probe' }, sdk, controller.signal);
    const settled = pending.then(() => ({ status: 'fulfilled' }), error => ({ status: 'rejected', name: error.name }));
    const report = await waitMarker(project.directory + '/version-report.json'); validateReport(report);
    const admitted = await observeActive(report);
    controller.abort(); const outcome = await bounded(settled, 15_000, 'Cancelled HTTP probe did not settle.');
    assert.equal(outcome.status, 'rejected'); assert.equal(outcome.name, 'AbortError');
    const deadline = Date.now() + 90_000;
    for (;;) { const view = await route('runtimes'); if (view.probe.state !== 'running') break; assert.ok(Date.now() < deadline); await delay(100); }
    const cleanup = await closed();
    const alive = JSON.parse(await observe('import json,os\np="/proc/' + report.pid + '/stat"\ntry:\n f=open(p).read().rsplit(") ",1)[1].split();v=f[0] not in ("Z","X") and f[19]==' + JSON.stringify(report.ticks) + '\nexcept FileNotFoundError:v=False\nprint(json.dumps(v))'));
    assert.equal(alive, false); await mode('normal'); return { report, admitted, outcome, cleanup, markerProcessExited: true };
  });
  await check('clear-selection-and-unknown-prefix-remain-guarded', async () => {
    const cleared = await route('runtimes', 'POST', { action: 'select' }); assert.deepEqual(cleared.runtimes, {});
    const suffix = parseInt(invocation.slice(0, 4), 16), version = '99.' + (100 + suffix % 800) + '.' + (100 + Math.floor(suffix / 800));
    unknownPrefix = '/opt/sakura-runtimes/node-' + version;
    unknownIdentity = JSON.parse(await guestPython('import json,os,stat\np=' + JSON.stringify(unknownPrefix) +
      '\nassert not os.path.lexists(p) and not os.path.lexists("/var/lib/sakura/runtime-versions/node-' + version + '.json")\n' +
      'root=os.path.dirname(p)\nif not os.path.lexists(root):\n os.mkdir(root,0o755);f=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)\n try:os.fchmod(f,0o755)\n finally:os.close(f)\n' +
      'i=os.lstat(root);assert stat.S_ISDIR(i.st_mode) and i.st_uid==0 and stat.S_IMODE(i.st_mode)==0o755\n' +
      'os.mkdir(p,0o700);os.mkdir(p+"/bin",0o700);open(p+"/bin/node","w").write("#!/bin/sh\\necho v' + version + '\\n");os.chmod(p+"/bin/node",0o700)\n' +
      'i=os.lstat(p);print(json.dumps({"device":str(i.st_dev),"inode":str(i.st_ino)}))'));
    const configuration = await route('project'), tickets = await guestTickets();
    await assert.rejects(route('runtimes', 'POST', { action: 'select', node: version }), error =>
      error.status === 409 && ['RUNTIME_DESTINATION_UNKNOWN', 'RUNTIME_PATH_ABSENT'].includes(error.code));
    assert.deepEqual((await route('project')).project, configuration.project); assert.deepEqual(await guestTickets(), tickets);
    return { unknownVersion: version, unchangedConfigVersion: configuration.version };
  });
  await check('real-api-official-node-install-ready-and-uid-selection', async () => {
    const before = requests.length;
    const job = await route('runtimes', 'POST', { action: 'install', tool: 'node', version: '22.12.0' });
    assert.equal(requests[before].status, 202); assert.equal(job.status, 'running'); assert.ok(job.id);
    const deadline = Date.now() + 1_800_000; let view;
    for (;;) {
      view = await route('runtimes'); assert.equal(view.job.id, job.id);
      if (view.job.status !== 'running') break;
      assert.ok(Date.now() < deadline, 'Official Node installation deadline.'); await delay(500);
    }
    assert.equal(view.job.status, 'done', view.job.error || view.job.log);
    const installed = JSON.parse(await guestPython('import hashlib,json,os,stat\np="/var/lib/sakura/runtime-versions/node-22.12.0.json"\n' +
      'f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);i=os.fstat(f)\n' +
      'try:\n assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and stat.S_IMODE(i.st_mode)==0o600 and i.st_nlink==1 and i.st_size<=16384\n r=json.loads(os.read(f,16385))\nfinally:os.close(f)\n' +
      'assert r["phase"]=="ready" and r["tool"]=="node" and r["requestedVersion"]=="22.12.0" and r["architecture"]=="x86_64"\n' +
      'assert r["managedPath"] is None and r["managedInfo"] is None\n' +
      'assert not os.path.lexists(r["stage"]) and not os.path.lexists("/sys/fs/cgroup/"+r["scope"]["name"]) and not os.path.lexists("/run/sakura-guest-tasks/"+r["scope"]["name"].removeprefix("sakura-task-"))\n' +
      'root="/opt/sakura-runtimes/node-22.12.0";directory=os.lstat(root);assert stat.S_ISDIR(directory.st_mode) and directory.st_uid==0 and stat.S_IMODE(directory.st_mode)==0o755\n' +
      'assert r["artifactInfo"]=={"device":str(directory.st_dev),"inode":str(directory.st_ino)}\n' +
      'b=root+"/bin/node";f=os.open(b,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);i=os.fstat(f);h=hashlib.sha256()\n' +
      'try:\n assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and not i.st_mode&0o022 and i.st_size<=268435456\n assert r["executableInfo"]=={"device":str(i.st_dev),"inode":str(i.st_ino)}\n while True:\n  d=os.read(f,1048576)\n  if not d:break\n  h.update(d)\nfinally:os.close(f)\n' +
      'assert h.hexdigest()==r["executableSha256"]\nprint(json.dumps(r))'));
    const selected = await route('runtimes', 'POST', { action: 'select', node: '22.12.0' }); assert.equal(selected.runtimes.node, '22.12.0');
    const exact = await route('runtimes', 'POST', { action: 'probe' }); assert.equal(exact.actual.node, '22.12.0'); assert.equal(exact.selected.node, '22.12.0');
    const ability = JSON.parse(await sdk.call('core.vms.exec', { path: apiPath, query: { project: project.id }, body: {
      command: '/opt/sakura-runtimes/node-22.12.0/bin/node -e ' + quote('const fs=require("node:fs");console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),home:process.env.HOME,cwd:process.cwd(),version:process.versions.node,status:fs.readFileSync("/proc/self/status","utf8"),networkInode:fs.statSync("/proc/self/ns/net",{bigint:true}).ino.toString()}))') }
    }).then(value => { assert.equal(value.code, 0); assert.equal(value.scope, 'project'); return value.stdout; }));
    assert.equal(ability.uid, identity.uid); assert.equal(ability.gid, identity.gid); assert.equal(ability.home, identity.home);
    assert.equal(ability.cwd, project.directory); assert.equal(ability.version, '22.12.0'); assert.notEqual(ability.networkInode, proof.rootNetworkInode);
    assert.match(ability.status, /NoNewPrivs:\s+1/); for (const field of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.match(ability.status, new RegExp(field + ':\\s+0+'));
    delete ability.status; return { jobId: job.id, readyReceipt: installed, ability, sampling: exact.probe, cleanup: await closed() };
  });
  await check('released-default-node-cli-inspect-and-explicit-probe', async () => {
    const before = await guestTickets(), inspected = await runCli('inspect'); assert.equal(inspected.value.actual.node, '22.12.0');
    assert.deepEqual(await guestTickets(), before);
    const probed = await runCli('probe'); assert.equal(probed.value.actual.node, '22.12.0'); assert.equal(probed.value.probe.state, 'cached');
    assert.equal(Object.keys(await guestTickets()).length, Object.keys(before).length + 1);
    return { inspect: { runtime: inspected.runtime, executable: inspected.executable, argv: inspected.argv,
      defaultNodeOptions: inspected.defaultNodeOptions }, probe: { ...probed.value.probe, argv: probed.argv }, cleanup: await closed() };
  });
  await check('account-mode-owner-only-runtimes-with-readable-project-control', async () => {
    const ownerPassword = 'owned-runtime-' + randomUUID();
    await sdk.request('/api/access/enable', { method: 'POST', body: { password: ownerPassword } }); await sdk.login('owner', ownerPassword);
    const memberPassword = 'owned-member-' + randomUUID(), memberUsername = 'runtime_http_' + invocation.slice(0, 8),
      member = await sdk.request('/api/access/members', { method: 'POST', body: { username: memberUsername, password: memberPassword } });
    await sdk.request('/api/access/project-permissions', { method: 'PUT', query: { vmId, projectId: project.id },
      body: { roles: [{ id: 'runtime-reader', name: 'Owned runtime reader', permissions: ['read', 'write', 'execute'] }],
        grants: [{ accountId: member.id, roleId: 'runtime-reader' }] } });
    const client = new Client({ baseUrl: origin }); await client.login(memberUsername, memberPassword);
    assert.equal((await route('project', 'GET', undefined, client)).project.directory, project.directory);
    const before = await guestTickets();
    for (const [method, body] of [['GET', undefined], ['POST', { action: 'probe' }], ['POST', { action: 'select' }],
      ['POST', { action: 'install', tool: 'node', version: '22.12.0' }]])
      await assert.rejects(route('runtimes', method, body, client), error => error.status === 403);
    assert.deepEqual(await guestTickets(), before); assert.equal((await route('runtimes')).actual.node, '22.12.0');
    await client.logout(); return { memberRequests: 4, guestRunsUnchanged: true };
  });
  await check('old-projects-identities-and-proof-files-remain-original', async () => {
    const next = await guestPreservation();
    for (const key of ['bindings', 'uids', 'accounts']) for (const [name, value] of Object.entries(oldGuestState[key])) assert.deepEqual(next[key][name], value);
    for (const entry of [...protectedHostFiles, ...historical]) assert.equal(digest(await readFile(entry.file)), entry.sha256, entry.file);
    return { oldBindings: Object.keys(oldGuestState.bindings).length, oldAccounts: Object.keys(oldGuestState.accounts).length };
  });
  await route('runtimes', 'POST', { action: 'select' }); await mode('loop');
  await sdk.request('/api/vms/' + vmId + '/projects', { method: 'POST', body: { action: 'select', projectId: previousActive } });
  activeRestored = (await sdk.request('/api/vms/' + vmId + '/projects')).active === previousActive; assert.equal(activeRestored, true);
  await guest('/bin/sync'); proof.cleanup.synced = true; proof.cleanup.syncPhase = 'before admitting final observed probe; its marker and ticket publish with fsync';
  proof.phase = 'production-sigint-handler-pending-probe'; await persist();
  const pending = route('runtimes', 'POST', { action: 'probe' });
  const settled = pending.then(() => ({ failed: false }), error => ({ failed: true, name: error.name }));
  const shutdownReport = await waitMarker(project.directory + '/version-report.json'); validateReport(shutdownReport);
  const shutdownRunId = shutdownReport.cgroup.split('sakura-task-')[1]; assert.match(shutdownRunId, /^[a-f0-9-]{36}$/);
  const shutdownAdmitted = await observeActive(shutdownReport);
  await persist();
  const result = await requestSigint(server, exited, 90_000), delivered = signalReceipt(server.pid);
  assert.equal(result.code, 0, output); assert.equal(result.signal, null); shutDownCleanly = true;
  const outcome = await bounded(settled, 15_000, 'Pending probe response did not settle after shutdown.');
  assert.equal(outcome.failed, true); assert.equal(exactQemu(), 0); stopped = true;
  const shutdownJournal = await journal(), shutdownRun = shutdownJournal.runs.find(run => run.runId === shutdownRunId);
  assert.equal(shutdownRun.phase, 'closed'); assert.equal(shutdownRun.run.phase, 'closed'); assert.equal(shutdownRun.retirement, undefined);
  proof.cases.push({ name: 'production-sigint-handler-cancels-probe-before-vm-stop', passed: true,
    detail: { shutdownReport, admitted: shutdownAdmitted, runId: shutdownRunId, run: shutdownRun.run, serverExitCode: result.code,
      signalDelivery: proof.signalBridge.mode, delivered, outcome, qemuMatches: 0 } }); await persist();
  proof.primaryServer = { pid: proof.serverPid, client: proof.serverClient, imported: proof.serverImport, exit: result };
  observer?.end(); observer = undefined;
  // The guest stays stopped. Restore the original account settings offline,
  // then start only the same compiled control service for public state checks.
  for (const name of ['access-control.json', 'project-permissions.json']) {
    const file = join(data, name), bytes = saved.get(file);
    if (bytes) await writeFile(file, bytes); else await rm(file, { force: true });
  }
  await check('service-restart-observes-stopped-live-zero-and-restored-active-project', async () => {
    assert.equal(exactQemu(), 0);
    const listener = createServer();
    await new Promise((done, fail) => listener.once('error', fail).listen(0, '127.0.0.1', done));
    const port = listener.address().port; await new Promise(done => listener.close(done));
    const origin = 'http://127.0.0.1:' + port;
    server = spawn(process.execPath, [bridgeFile, serverFile], { cwd: serverRoot, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, SAKURA_DATA_DIR: data, SAKURA_PORT: String(port),
        SAKURA_IMAGE_DIR: join(workspace, '.data/images'), SAKURA_IMAGE_PATH: join(workspace, '.data/images/debian-12.qcow2') } });
    output = ''; proof.recoveryServer = { pid: server.pid, port, guestStarted: false }; await persist();
    server.stdout.on('data', bytes => output = (output + bytes).slice(-65536));
    server.stderr.on('data', bytes => output = (output + bytes).slice(-65536));
    server.on('message', message => {
      if (message?.type === 'runtime-http-client') proof.recoveryServer.client = message;
      else if (message?.type === 'runtime-http-imported') proof.recoveryServer.imported = message;
      else if (message?.type === 'runtime-http-sigint-delivered') proof.signalBridge.deliveries.push(message);
    });
    exited = new Promise((done, fail) => { server.once('close', (code, signal) => done({ code, signal })); server.once('error', fail); });
    let ready = false;
    for (let n = 0; n < 180; n++) {
      assert.equal(server.exitCode, null, output);
      try { const reply = await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(1000) }); if (reply.ok) { ready = true; break; } } catch {}
      await delay(200);
    }
    assert.equal(ready, true); sdk = new Client({ baseUrl: origin });
    const publicMachines = await sdk.call('core.vms.list'); assert.equal(publicMachines.length, 1);
    assert.equal(publicMachines[0].id, vmId); assert.equal(publicMachines[0].status, 'stopped'); assert.equal(publicMachines[0].poweredOn, false);
    assert.equal((await sdk.request('/api/vms/' + vmId + '/projects')).active, previousActive);
    const sample = await route('runtimes'); assert.equal(sample.probe.state, 'unprobed'); assert.equal(sample.probe.bootId, null);
    assert.equal(exactQemu(), 0); assert.deepEqual(await journal(), shutdownJournal);
    assert.deepEqual(proof.recoveryServer.client.execArgv, []); assert.equal(proof.recoveryServer.client.server, serverFile);
    assert.equal(proof.recoveryServer.client.pid, server.pid); assert.equal(proof.recoveryServer.imported.server, serverFile);
    assert.equal(proof.recoveryServer.imported.pid, server.pid);
    const ended = await requestSigint(server, exited, 30_000); proof.recoveryServer.signalDelivery = signalReceipt(server.pid);
    assert.equal(ended.code, 0, output); assert.equal(ended.signal, null); assert.equal(exactQemu(), 0);
    proof.recoveryServer.exit = ended; proof.cleanup.publicLiveEntries = publicMachines.filter(value => value.poweredOn).length;
    return { publicStatus: publicMachines[0].status, poweredOn: false, liveEntries: proof.cleanup.publicLiveEntries,
      activeProject: previousActive, serviceRestartOnly: true, serverExit: ended };
  });
} catch (error) {
  proof.error = (error instanceof Error ? error.message : String(error)).slice(0, 8192); console.error(proof.error);
} finally {
  const cleanupFailures = [];
  const cleanupCheck = async (name, action) => {
    try { return await action(); }
    catch (error) { cleanupFailures.push({ name, error: String(error).slice(0, 2048) }); }
  };
  proof.cleanup.vmStartAttempted = started;
  if (server?.exitCode === null && sdk) {
    if (previousActive && !activeRestored) try {
      await sdk.request('/api/vms/' + vmId + '/projects', { method: 'POST', body: { action: 'select', projectId: previousActive },
        signal: AbortSignal.timeout(10_000) });
      activeRestored = (await sdk.request('/api/vms/' + vmId + '/projects', { signal: AbortSignal.timeout(10_000) })).active === previousActive;
    } catch (error) { proof.cleanup.activeFailure = String(error).slice(0, 2048); }
    if (started) try { if (exactQemu() > 0) { await guest('/bin/sync', AbortSignal.timeout(5_000)); proof.cleanup.synced = true; } }
    catch (error) { proof.cleanup.syncFailure = String(error).slice(0, 2048); }
    await cleanupCheck('production-sigint-handler', () => requestSigint(server, exited, 90_000));
  }
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    proof.cleanup.forcedServerTermination = true; server.kill('SIGKILL');
  }
  if (exited) await cleanupCheck('owned-server-exit', () => bounded(exited, 10_000, 'Owned test process exit unconfirmed.'));
  observer?.end();
  await cleanupCheck('owned-qemu-state', async () => { stopped = exactQemu() === 0; proof.cleanup.exactQemuMatches = exactQemu(); });
  // Only the captured settings are restored, after the exact control process
  // has exited. An unconfirmed process leaves the false proof for recovery.
  await cleanupCheck('original-host-settings', async () => {
    assert.ok(!server?.pid || server.exitCode !== null || server.signalCode !== null, 'Control process must exit before settings restoration.');
    for (const [file, bytes] of saved) {
      if (bytes) await writeFile(file, bytes); else await rm(file, { force: true });
    }
    for (const [file, bytes] of saved) {
      const current = await readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
      assert.equal(current === undefined ? null : digest(current), bytes === undefined ? null : digest(bytes));
    }
    hostSettingsRestored = true;
  });
  proof.cleanup.hostSettingsRestored = hostSettingsRestored; proof.cleanup.activeProjectRestored = activeRestored;
  proof.cleanup.retainedArtifacts = { projectDirectory: project?.directory || null, unknownPrefix: unknownPrefix || null,
    rootMarker: rootMarker || null, unknownIdentity: unknownIdentity || null,
    markers: [...createdMarkers].map(([file, expected]) => ({ file, ...expected })),
    reason: 'Evidence stays in the owned stopped fixture; no observer writes, old registrations or tickets are deleted.' };
  proof.cleanup.vmStopped = stopped; proof.cleanup.liveEntries = proof.cleanup.publicLiveEntries ?? null;
  proof.cleanup.cleanSigintHandler = shutDownCleanly;
  proof.cleanup.serverExitCode = server?.exitCode; proof.cleanup.serverSignalCode = server?.signalCode;
  await cleanupCheck('frozen-source-bytes', async () => {
    proof.sourceUnchanged = true;
    for (const [file, sha256] of Object.entries(sources)) if (digest(await readFile(join(workspace, file))) !== sha256) proof.sourceUnchanged = false;
  });
  await cleanupCheck('historical-proof-bytes', async () => {
    proof.oldProofsUnchanged = true;
    for (const entry of historical) if (digest(await readFile(entry.file)) !== entry.sha256) proof.oldProofsUnchanged = false;
  });
  await cleanupCheck('verified-release-bytes', async () => { proof.releaseUnchanged = (await verifyReleaseManifest(serverRoot)).fingerprint === release.fingerprint; });
  await cleanupCheck('frozen-stamp-bytes', async () => { proof.freezeUnchanged = digest(await readFile(freezeFile)) === digest(freezeBytes); });
  await cleanupCheck('private-bridge-bytes', async () => { proof.bridgeUnchanged = digest(await readFile(bridgeFile)) === digest(bridge); });
  proof.cleanup.failures = cleanupFailures;
  proof.finishedAt = new Date().toISOString();
  proof.passed = !proof.error && proof.cases.length === 13 && stopped && proof.cleanup.liveEntries === 0 && proof.cleanup.synced && activeRestored &&
    hostSettingsRestored && shutDownCleanly && proof.sourceUnchanged && proof.oldProofsUnchanged &&
    proof.releaseUnchanged && proof.freezeUnchanged && proof.bridgeUnchanged && !proof.cleanup.forcedServerTermination && cleanupFailures.length === 0;
  if (proof.error) proof.serverOutput = output.slice(-16384);
  await persist(); console.log(JSON.stringify({ proof: proofFile, passed: proof.passed, cases: proof.cases.length, vmStopped: stopped }));
  if (!proof.passed) process.exitCode = 1;
}
